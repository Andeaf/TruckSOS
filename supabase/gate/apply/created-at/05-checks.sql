SELECT 'triggerul aaa_created_at_server pe ambele tabele, activ, BEFORE INSERT FOR EACH ROW (asteptat 2)' AS k,
       (SELECT count(*)::text FROM pg_trigger t
         WHERE t.tgname = 'aaa_created_at_server' AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 7
           AND t.tgrelid IN ('public.messages'::regclass, 'public.channel_messages'::regclass)
           AND t.tgfoid = 'app.stamp_created_at_client()'::regprocedure) AS v
UNION ALL
SELECT 'triggere BEFORE INSERT pe public.messages, in ordinea rularii (asteptat aaa_created_at_server,aaa_rate_limit,ban_guard_ins)', (SELECT COALESCE(string_agg(t.tgname::text, ',' ORDER BY t.tgname::text COLLATE "C"), '')
          FROM pg_trigger t WHERE t.tgrelid = 'public.messages'::regclass AND NOT t.tgisinternal AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4)
UNION ALL
SELECT 'triggere BEFORE INSERT pe public.channel_messages (asteptat aaa_created_at_server,aaa_rate_limit,ban_guard_ins)', (SELECT COALESCE(string_agg(t.tgname::text, ',' ORDER BY t.tgname::text COLLATE "C"), '')
          FROM pg_trigger t WHERE t.tgrelid = 'public.channel_messages'::regclass AND NOT t.tgisinternal AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4)
UNION ALL
SELECT 'functia e SECURITY INVOKER, search_path gol (asteptat false|search_path="")',
       (SELECT prosecdef::text || '|' || array_to_string(proconfig, ',') FROM pg_proc WHERE oid = 'app.stamp_created_at_client()'::regprocedure)
UNION ALL
SELECT 'EXECUTE anon / authenticated pe functia triggerului (asteptat false)',
       (has_function_privilege('anon', 'app.stamp_created_at_client()', 'EXECUTE')
        OR has_function_privilege('authenticated', 'app.stamp_created_at_client()', 'EXECUTE'))::text
UNION ALL
SELECT 'mesaje / mesaje de canal cu created_at in viitor (asteptat 0|0; altfel aceleasi numere ca la pasul 0 - randuri vechi)',
       (SELECT count(*)::text FROM public.messages WHERE created_at > now() + interval '1 minute') || '|' ||
       (SELECT count(*)::text FROM public.channel_messages WHERE created_at > now() + interval '1 minute')
UNION ALL
SELECT 'istoric migrari (ultimele 6 versiuni; 20261112000200 dupa repair)', string_agg(version, ',' ORDER BY version)
  FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 6) h;
