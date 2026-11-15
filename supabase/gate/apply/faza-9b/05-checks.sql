SELECT 'cron cleanup-announcements-hourly: schedule|comanda cu kick|fara Authorization (asteptat 17 * * * *|true|true)' AS k,
       schedule || '|' || (command LIKE '%app.kick_cleanup_announcements()%')::text || '|' || (command NOT ILIKE '%authorization%' AND command NOT ILIKE '%vault%')::text AS v
  FROM cron.job WHERE jobname = 'cleanup-announcements-hourly'
UNION ALL
SELECT 'cron storage-gc-hourly: schedule|active (asteptat 35 * * * *|true)', schedule || '|' || active::text
  FROM cron.job WHERE jobname = 'storage-gc-hourly'
UNION ALL
SELECT 'cron storage-gc-daily: schedule|scanare doar duminica (asteptat 50 4 * * *|true)', schedule || '|' || (command LIKE '%DOW%')::text
  FROM cron.job WHERE jobname = 'storage-gc-daily'
UNION ALL
SELECT 'functii din TOATE schemele care mai contin service_role_key (asteptat gol)',
       COALESCE((SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname)
                   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE p.prosrc ILIKE '%service_role_key%'), '')
UNION ALL
SELECT 'comenzi cron cu service_role_key / Authorization (asteptat 0)',
       (SELECT count(*) FROM cron.job WHERE command ILIKE '%service_role_key%' OR command ILIKE '%authorization%')::text
UNION ALL
SELECT 'storage_api_delete: fara http_delete|fara vault|pune in coada (asteptat true|true|true)',
       (prosrc NOT ILIKE '%http_delete%')::text || '|' || (prosrc NOT ILIKE '%vault%')::text || '|' || (prosrc LIKE '%app.storage_gc_enqueue%')::text
  FROM pg_proc WHERE oid = 'public.storage_api_delete(text, text)'::regprocedure
UNION ALL
SELECT 'storage_api_delete: EXECUTE service_role|authenticated|anon (asteptat true|false|false)',
       has_function_privilege('service_role', 'public.storage_api_delete(text, text)', 'EXECUTE')::text || '|' ||
       has_function_privilege('authenticated', 'public.storage_api_delete(text, text)', 'EXECUTE')::text || '|' ||
       has_function_privilege('anon', 'public.storage_api_delete(text, text)', 'EXECUTE')::text
UNION ALL
SELECT 'kick_storage_gc: forma veche disparuta|forma noua exista (asteptat true|true)',
       (to_regprocedure('app.kick_storage_gc()') IS NULL)::text || '|' || (to_regprocedure('app.kick_storage_gc(boolean)') IS NOT NULL)::text
UNION ALL
SELECT 'kick-urile: EXECUTE anon / authenticated (asteptat false)',
       (has_function_privilege('anon', 'app.kick_cleanup_announcements()', 'EXECUTE') OR has_function_privilege('authenticated', 'app.kick_cleanup_announcements()', 'EXECUTE')
        OR has_function_privilege('anon', 'app.kick_storage_gc(boolean)', 'EXECUTE') OR has_function_privilege('authenticated', 'app.kick_storage_gc(boolean)', 'EXECUTE'))::text
UNION ALL
SELECT 'Vault: push_kick_secret exista (asteptat 64)', COALESCE((SELECT length(decrypted_secret)::text FROM vault.decrypted_secrets WHERE name = 'push_kick_secret'), 'LIPSA')
UNION ALL
SELECT 'Vault: service_role_key inca exista (informativ; se sterge de mana dupa cateva zile fara Authorization in net.http_request_queue)',
       (EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key'))::text
UNION ALL
SELECT 'coada Storage: randuri|mai vechi de 48 h (al doilea trebuie 0)',
       (SELECT count(*) FROM app.storage_gc_queue)::text || '|' || (SELECT count(*) FROM app.storage_gc_queue WHERE created_at < now() - interval '48 hours')::text;
