SELECT 'functia app.stamp_created_at_client exista deja (asteptat false; true = migrarea e deja aplicata -> STOP)' AS k,
       (to_regprocedure('app.stamp_created_at_client()') IS NOT NULL)::text AS v
UNION ALL
SELECT 'triggere BEFORE INSERT pe public.messages, in ordinea rularii (asteptat aaa_rate_limit,ban_guard_ins)', (SELECT COALESCE(string_agg(t.tgname::text, ',' ORDER BY t.tgname::text COLLATE "C"), '')
          FROM pg_trigger t WHERE t.tgrelid = 'public.messages'::regclass AND NOT t.tgisinternal AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4)
UNION ALL
SELECT 'triggere BEFORE INSERT pe public.channel_messages (asteptat aaa_rate_limit,ban_guard_ins)', (SELECT COALESCE(string_agg(t.tgname::text, ',' ORDER BY t.tgname::text COLLATE "C"), '')
          FROM pg_trigger t WHERE t.tgrelid = 'public.channel_messages'::regclass AND NOT t.tgisinternal AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4)
UNION ALL
SELECT 'authenticated: INSERT pe messages / channel_messages (asteptat true|true)',
       has_table_privilege('authenticated', 'public.messages', 'INSERT')::text || '|' || has_table_privilege('authenticated', 'public.channel_messages', 'INSERT')::text
UNION ALL
SELECT 'authenticated: UPDATE pe messages / channel_messages (asteptat false|false; altfel created_at s-ar putea schimba prin UPDATE)',
       has_table_privilege('authenticated', 'public.messages', 'UPDATE')::text || '|' || has_table_privilege('authenticated', 'public.channel_messages', 'UPDATE')::text
UNION ALL
SELECT 'messages cu created_at NULL (informativ; migrarea nu le atinge)', (SELECT count(*)::text FROM public.messages WHERE created_at IS NULL)
UNION ALL
SELECT 'messages cu created_at in viitor, peste 5 minute (informativ; asteptat 0)', (SELECT count(*)::text FROM public.messages WHERE created_at > now() + interval '5 minutes')
UNION ALL
SELECT 'channel_messages cu created_at in viitor, peste 5 minute (informativ; asteptat 0)', (SELECT count(*)::text FROM public.channel_messages WHERE created_at > now() + interval '5 minutes')
UNION ALL
SELECT 'istoric migrari (ultimele 6 versiuni)', string_agg(version, ',' ORDER BY version)
  FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 6) h;
