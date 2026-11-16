SELECT 'tabelele fazei 3 in app (asteptat 4/4: channel_events,moderation_notices,push_queue,push_tickets)' AS k,
       string_agg(c.relname, ',' ORDER BY c.relname) AS v
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'app' AND c.relkind = 'r' AND c.relname IN ('push_queue', 'push_tickets', 'channel_events', 'moderation_notices')
UNION ALL
SELECT 'RLS pornit pe cele 4 tabele (asteptat 4)', count(*)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'app' AND c.relname IN ('push_queue', 'push_tickets', 'channel_events', 'moderation_notices') AND c.relrowsecurity
UNION ALL
SELECT 'anon/authenticated fara niciun drept pe push_queue/push_tickets/channel_events (asteptat 0)', count(*)::text
  FROM information_schema.role_table_grants g
 WHERE g.table_schema = 'app' AND g.table_name IN ('push_queue', 'push_tickets', 'channel_events') AND g.grantee IN ('anon', 'authenticated')
UNION ALL
SELECT 'view public.moderation_notices security_invoker (asteptat security_invoker=true)',
       coalesce((SELECT array_to_string(c.reloptions, ',') FROM pg_class c WHERE c.oid = 'public.moderation_notices'::regclass), 'LIPSESTE')
UNION ALL
SELECT 'drepturi authenticated pe view-ul moderation_notices (asteptat SELECT + UPDATE doar read_at)',
       (SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants
         WHERE table_schema = 'public' AND table_name = 'moderation_notices' AND grantee = 'authenticated')
       || ' | coloane UPDATE: ' ||
       coalesce((SELECT string_agg(column_name, ',') FROM information_schema.role_column_grants
         WHERE table_schema = 'public' AND table_name = 'moderation_notices' AND grantee = 'authenticated' AND privilege_type = 'UPDATE'), '-')
UNION ALL
SELECT 'joburi cron ale fazei (asteptat 5: channel-digests,cleanup-cron-run-details-daily,cleanup-push-queue-daily,push-dispatch,push-receipts)',
       string_agg(jobname || '[' || schedule || ']', ' ' ORDER BY jobname)
  FROM cron.job WHERE jobname IN ('push-dispatch', 'channel-digests', 'push-receipts', 'cleanup-push-queue-daily', 'cleanup-cron-run-details-daily')
UNION ALL
SELECT 'functii-trigger care mai contin net.http_post (asteptat 0)', count(*)::text
  FROM (SELECT DISTINCT t.tgfoid FROM pg_trigger t WHERE NOT t.tgisinternal) tr
  JOIN pg_proc p ON p.oid = tr.tgfoid
 WHERE p.prosrc ILIKE '%net.http_post%'
UNION ALL
SELECT 'notify_push scrie in coada, fara net.http_post (asteptat true)',
       (prosrc ILIKE '%app.push_queue%' AND prosrc NOT ILIKE '%net.http_post%')::text
  FROM pg_proc WHERE oid = 'public.notify_push(uuid,text,text,jsonb,text,text,text)'::regprocedure
UNION ALL
SELECT 'RPC-urile EF (asteptat 4: claim_push_batch,finish_push_batch,finish_push_receipts,pending_push_receipts)',
       string_agg(p.proname, ',' ORDER BY p.proname)
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('claim_push_batch', 'finish_push_batch', 'pending_push_receipts', 'finish_push_receipts')
UNION ALL
SELECT 'EXECUTE anon/authenticated pe RPC-urile EF (asteptat 0)', count(*)::text
  FROM pg_proc p, unnest(ARRAY['anon', 'authenticated']) r(role)
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('claim_push_batch', 'finish_push_batch', 'pending_push_receipts', 'finish_push_receipts')
   AND has_function_privilege(r.role, p.oid, 'EXECUTE')
UNION ALL
SELECT 'EXECUTE service_role pe RPC-urile EF (asteptat 4)', count(*)::text
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('claim_push_batch', 'finish_push_batch', 'pending_push_receipts', 'finish_push_receipts')
   AND has_function_privilege('service_role', p.oid, 'EXECUTE')
UNION ALL
SELECT 'admin_delete_* / admin_ban_user cu p_reason (asteptat 5)', count(*)::text
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('admin_delete_message', 'admin_delete_announcement', 'admin_delete_listing', 'admin_delete_review', 'admin_ban_user')
   AND 'p_reason' = ANY (p.proargnames)
UNION ALL
SELECT 'semnaturi vechi admin_delete_* fara p_reason ramase (asteptat 0)', count(*)::text
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('admin_delete_message', 'admin_delete_announcement', 'admin_delete_listing', 'admin_delete_review')
   AND NOT ('p_reason' = ANY (p.proargnames))
UNION ALL
SELECT 'trigger reports_notify_admins pe public.reports (asteptat 1)', count(*)::text
  FROM pg_trigger WHERE tgname = 'reports_notify_admins' AND tgrelid = 'public.reports'::regclass
UNION ALL
SELECT 'secretul push_kick_secret in Vault (asteptat 64 = hex de 32 octeti)',
       coalesce((SELECT length(decrypted_secret)::text FROM vault.decrypted_secrets WHERE name = 'push_kick_secret'), 'LIPSESTE')
UNION ALL
SELECT 'net._http_response lizibil (push_stats are nevoie)', (SELECT count(*)::text FROM net._http_response)
UNION ALL
SELECT 'push_stats() ruleaza (queued|sending|oldest_queued_at|channel_events_pending|expired_48h)',
       (SELECT queued || '|' || sending || '|' || coalesce(oldest_queued_at::text, '-') || '|' || channel_events_pending || '|' || expired_48h FROM app.push_stats())
UNION ALL
SELECT 'extversion pg_cron (asteptat >= 1.5 pentru ''5 seconds'')', extversion FROM pg_extension WHERE extname = 'pg_cron'
UNION ALL
SELECT 'istoric migrari (ultimele 5 versiuni)', string_agg(version, ',' ORDER BY version)
  FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5) h;
