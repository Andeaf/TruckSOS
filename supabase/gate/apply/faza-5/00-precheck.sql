SELECT 'functiile fazei 5 care exista deja (asteptat 0; altfel migrarea e deja aplicata -> STOP)' AS k,
       (SELECT count(*)::text FROM unnest(ARRAY['public.unread_counts()', 'public.channel_unread_count(uuid)', 'public.mark_conversation_read(uuid, timestamptz)', 'public.mark_channel_read(uuid, timestamptz)']) f WHERE to_regprocedure(f) IS NOT NULL) AS v
UNION ALL
SELECT 'faza 4 aplicata: app.profiles exista (asteptat true)', (to_regclass('app.profiles') IS NOT NULL)::text
UNION ALL
SELECT 'indexurile folosite exista: idx_messages_conversation_created | idx_channel_messages_channel_created (asteptat true|true)',
       (to_regclass('public.idx_messages_conversation_created') IS NOT NULL)::text || '|' || (to_regclass('public.idx_channel_messages_channel_created') IS NOT NULL)::text
UNION ALL
SELECT 'publicatia supabase_realtime: cele 5 tabele ale chatului (asteptat 5; altfel migrarea se opreste singura)',
       (SELECT count(*)::text FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
          AND tablename IN ('messages', 'message_reads', 'conversations', 'channel_messages', 'channel_reads'))
UNION ALL
SELECT 'triggerul aaa_created_at_server (20261112000200) pe messages + channel_messages (asteptat 2 = 20261112000200 e aplicata inaintea fazei 5, ordinea hotarata; 0 = inca neaplicata -> vezi documentul)',
       (SELECT count(*)::text FROM pg_trigger t WHERE t.tgname = 'aaa_created_at_server' AND NOT t.tgisinternal
          AND t.tgrelid IN ('public.messages'::regclass, 'public.channel_messages'::regclass))
UNION ALL
SELECT 'authenticated: INSERT|UPDATE pe message_reads si pe channel_reads (asteptat true|true|true|true: drumul 1.0.x, upsert direct)',
       has_table_privilege('authenticated', 'public.message_reads', 'INSERT')::text || '|' || has_table_privilege('authenticated', 'public.message_reads', 'UPDATE')::text || '|' ||
       has_table_privilege('authenticated', 'public.channel_reads', 'INSERT')::text || '|' || has_table_privilege('authenticated', 'public.channel_reads', 'UPDATE')::text
UNION ALL
SELECT 'messages cu created_at NULL (informativ; asemenea randuri nu se numara ca necitite intr-o conversatie niciodata deschisa)',
       (SELECT count(*)::text FROM public.messages WHERE created_at IS NULL)
UNION ALL
SELECT 'mesaje NESTERSE cu created_at in viitor, peste 5 minute: messages|channel_messages (informativ; asteptat 0|0)',
       (SELECT count(*)::text FROM public.messages WHERE deleted_at IS NULL AND created_at > now() + interval '5 minutes') || '|' ||
       (SELECT count(*)::text FROM public.channel_messages WHERE deleted_at IS NULL AND created_at > now() + interval '5 minutes')
UNION ALL
SELECT 'cursoare de citire in viitor, peste 5 minute: message_reads|channel_reads (informativ; sunt aduse inapoi la primul apel mark_*_read)',
       (SELECT count(*)::text FROM public.message_reads WHERE last_read_at > now() + interval '5 minutes') || '|' ||
       (SELECT count(*)::text FROM public.channel_reads WHERE last_read_at > now() + interval '5 minutes')
UNION ALL
SELECT 'istoric migrari (ultimele 6 versiuni)', string_agg(version, ',' ORDER BY version)
  FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 6) h;
