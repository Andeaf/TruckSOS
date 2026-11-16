SELECT 'cele patru functii exista (asteptat 4)' AS k,
       (SELECT count(*)::text FROM unnest(ARRAY['public.unread_counts()', 'public.channel_unread_count(uuid)', 'public.mark_conversation_read(uuid, timestamptz)', 'public.mark_channel_read(uuid, timestamptz)']) f WHERE to_regprocedure(f) IS NOT NULL) AS v
UNION ALL
SELECT 'toate SECURITY DEFINER cu search_path gol (asteptat 4)',
       (SELECT count(*)::text FROM pg_proc p WHERE p.oid = ANY (SELECT to_regprocedure(f)::oid FROM unnest(ARRAY['public.unread_counts()', 'public.channel_unread_count(uuid)', 'public.mark_conversation_read(uuid, timestamptz)', 'public.mark_channel_read(uuid, timestamptz)']) f)
          AND p.prosecdef AND array_to_string(p.proconfig, ',') = 'search_path=""')
UNION ALL
SELECT 'EXECUTE pentru anon (asteptat 0 din 4)',
       (SELECT count(*)::text FROM unnest(ARRAY['public.unread_counts()', 'public.channel_unread_count(uuid)', 'public.mark_conversation_read(uuid, timestamptz)', 'public.mark_channel_read(uuid, timestamptz)']) f WHERE to_regprocedure(f) IS NOT NULL AND has_function_privilege('anon', f, 'EXECUTE'))
UNION ALL
SELECT 'EXECUTE pentru authenticated (asteptat 4 din 4)',
       (SELECT count(*)::text FROM unnest(ARRAY['public.unread_counts()', 'public.channel_unread_count(uuid)', 'public.mark_conversation_read(uuid, timestamptz)', 'public.mark_channel_read(uuid, timestamptz)']) f WHERE to_regprocedure(f) IS NOT NULL AND has_function_privilege('authenticated', f, 'EXECUTE'))
UNION ALL
SELECT 'EXECUTE pentru service_role (asteptat 4 din 4)',
       (SELECT count(*)::text FROM unnest(ARRAY['public.unread_counts()', 'public.channel_unread_count(uuid)', 'public.mark_conversation_read(uuid, timestamptz)', 'public.mark_channel_read(uuid, timestamptz)']) f WHERE to_regprocedure(f) IS NOT NULL AND has_function_privilege('service_role', f, 'EXECUTE'))
UNION ALL
SELECT 'tipurile intoarse (asteptat TABLE(conversation_id uuid, unread integer)|integer|timestamp with time zone|timestamp with time zone)',
       (SELECT string_agg(pg_get_function_result(to_regprocedure(f)), '|' ORDER BY ord) FROM unnest(ARRAY['public.unread_counts()', 'public.channel_unread_count(uuid)', 'public.mark_conversation_read(uuid, timestamptz)', 'public.mark_channel_read(uuid, timestamptz)']) WITH ORDINALITY AS t(f, ord)
         WHERE to_regprocedure(f) IS NOT NULL)
UNION ALL
SELECT 'publicatia supabase_realtime: cele 5 tabele ale chatului, neatinse (asteptat 5)',
       (SELECT count(*)::text FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
          AND tablename IN ('messages', 'message_reads', 'conversations', 'channel_messages', 'channel_reads'))
UNION ALL
SELECT 'authenticated: INSERT|UPDATE pe message_reads si pe channel_reads, neschimbate (asteptat true|true|true|true)',
       has_table_privilege('authenticated', 'public.message_reads', 'INSERT')::text || '|' || has_table_privilege('authenticated', 'public.message_reads', 'UPDATE')::text || '|' ||
       has_table_privilege('authenticated', 'public.channel_reads', 'INSERT')::text || '|' || has_table_privilege('authenticated', 'public.channel_reads', 'UPDATE')::text
UNION ALL
SELECT 'istoric migrari (ultimele 6 versiuni; 20261113000100 dupa repair)', string_agg(version, ',' ORDER BY version)
  FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 6) h;
