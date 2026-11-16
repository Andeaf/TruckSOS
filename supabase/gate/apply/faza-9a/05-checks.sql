SELECT 'app.client_errors: rls|drepturi anon+authenticated|randuri (asteptat true|0|0)' AS k,
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.client_errors'::regclass)::text || '|' ||
       (SELECT count(*) FROM information_schema.role_table_grants g WHERE g.table_schema = 'app' AND g.table_name = 'client_errors' AND g.grantee IN ('anon', 'authenticated'))::text || '|' ||
       (SELECT count(*) FROM app.client_errors)::text AS v
UNION ALL
SELECT 'report_client_error: EXECUTE authenticated|anon (asteptat true|false)',
       has_function_privilege('authenticated', 'public.report_client_error(text, text, text, text, text, text, text)', 'EXECUTE')::text || '|' ||
       has_function_privilege('anon', 'public.report_client_error(text, text, text, text, text, text, text)', 'EXECUTE')::text
UNION ALL
SELECT 'admin_client_errors + admin_health: EXECUTE authenticated|anon (asteptat true|false)',
       (has_function_privilege('authenticated', 'public.admin_client_errors(integer, integer)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.admin_health()', 'EXECUTE'))::text || '|' ||
       (has_function_privilege('anon', 'public.admin_client_errors(integer, integer)', 'EXECUTE') OR has_function_privilege('anon', 'public.admin_health()', 'EXECUTE'))::text
UNION ALL
SELECT 'scrub_client_text: interna (asteptat false)',
       (has_function_privilege('authenticated', 'app.scrub_client_text(text, integer)', 'EXECUTE') OR has_function_privilege('anon', 'app.scrub_client_text(text, integer)', 'EXECUTE'))::text
UNION ALL
SELECT 'scrub: e-mail + id + telefon (asteptat a [email] b [id] c [phone] d)',
       app.scrub_client_text('a ion.pop@example.com b 0f8fad5b-d9cb-469f-a165-70867728950e c +40 712 345 678 d', 200)
UNION ALL
SELECT 'scrub: tokenuri (asteptat [token] x [token] y)',
       app.scrub_client_text('Bearer abc.def-ghi x eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghij y', 200)
UNION ALL
SELECT 'cron cleanup-client-errors-daily: schedule|active (asteptat 44 3 * * *|true)', schedule || '|' || active::text
  FROM cron.job WHERE jobname = 'cleanup-client-errors-daily'
UNION ALL
SELECT 'admin_health ca postgres (fara JWT) e refuzat cu not_admin - se verifica din panoul admin, nu de aici (informativ)', 'vezi pasul A3'
UNION ALL
SELECT 'coada Storage: randuri|mai vechi de 48 h (informativ; al doilea numar = precondiția 9.3, trebuie 0)',
       (SELECT count(*) FROM app.storage_gc_queue)::text || '|' || (SELECT count(*) FROM app.storage_gc_queue WHERE created_at < now() - interval '48 hours')::text
UNION ALL
SELECT 'joburi cron esuate in 24 h (informativ; ce va arata cardul Sanatate)',
       COALESCE((SELECT string_agg(DISTINCT COALESCE(j.jobname, d.jobid::text), ', ')
                   FROM cron.job_run_details d LEFT JOIN cron.job j ON j.jobid = d.jobid
                  WHERE d.status = 'failed' AND d.start_time > now() - interval '24 hours'), '(niciunul)');
