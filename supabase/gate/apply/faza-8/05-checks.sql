SELECT 'app.profile_terms: rls|drepturi anon+authenticated (asteptat true|0)' AS k,
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.profile_terms'::regclass)::text || '|' ||
       (SELECT count(*) FROM information_schema.role_table_grants g WHERE g.table_schema = 'app' AND g.table_name = 'profile_terms' AND g.grantee IN ('anon', 'authenticated'))::text AS v
UNION ALL
SELECT 'app.profiles NEATINS: coloane tabel|coloane view public.profiles (asteptat egale: 25|25)',
       (SELECT count(*) FROM pg_attribute WHERE attrelid = 'app.profiles'::regclass AND attnum > 0 AND NOT attisdropped)::text || '|' ||
       (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped)::text
UNION ALL
SELECT 'app.consent_log: rls|FK|drepturi anon+authenticated (asteptat true|0|0)',
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.consent_log'::regclass)::text || '|' ||
       (SELECT count(*) FROM pg_constraint WHERE conrelid = 'app.consent_log'::regclass AND contype = 'f')::text || '|' ||
       (SELECT count(*) FROM information_schema.role_table_grants g WHERE g.table_schema = 'app' AND g.table_name = 'consent_log' AND g.grantee IN ('anon', 'authenticated'))::text
UNION ALL
SELECT 'accept_terms + my_terms_status: EXECUTE authenticated|anon (asteptat true|false)',
       (has_function_privilege('authenticated', 'public.accept_terms(text, text)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.my_terms_status()', 'EXECUTE'))::text
       || '|' || (has_function_privilege('anon', 'public.accept_terms(text, text)', 'EXECUTE') OR has_function_privilege('anon', 'public.my_terms_status()', 'EXECUTE'))::text
UNION ALL
SELECT 'export_my_data contine terms + consent_log (asteptat true)', (prosrc LIKE '%app.profile_terms%' AND prosrc LIKE '%app.consent_log%')::text
  FROM pg_proc WHERE oid = 'public.export_my_data()'::regprocedure
UNION ALL
SELECT 'apply_retention contine pasii consent_log + profile_terms (asteptat true)', (prosrc LIKE '%consent_log_deleted%' AND prosrc LIKE '%deleted_profile_terms%')::text
  FROM pg_proc WHERE oid = 'app.apply_retention(boolean)'::regprocedure
UNION ALL
SELECT 'conturi care au acceptat termenii (informativ: 0 inainte de build-ul 1.1)', count(*)::text FROM app.profile_terms
UNION ALL
SELECT 'reports.reporter_id nullable (asteptat false = NOT attnotnull)', attnotnull::text
  FROM pg_attribute WHERE attrelid = 'public.reports'::regclass AND attname = 'reporter_id'
UNION ALL
SELECT 'coloanele noi pe reports (asteptat announcement_id,reporter_email,source)', string_agg(attname, ',' ORDER BY attname)
  FROM pg_attribute WHERE attrelid = 'public.reports'::regclass AND attname IN ('reporter_email', 'source', 'announcement_id') AND NOT attisdropped
UNION ALL
SELECT 'constrangerile noi pe reports (asteptat 4)', count(*)::text
  FROM pg_constraint WHERE conrelid = 'public.reports'::regclass
   AND conname IN ('reports_source_check', 'reports_public_has_email', 'reports_reporter_email_length', 'reports_announcement_id_fkey')
UNION ALL
SELECT 'reports_reason_check contine illegal (asteptat true)', (pg_get_constraintdef(oid) LIKE '%illegal%')::text
  FROM pg_constraint WHERE conrelid = 'public.reports'::regclass AND conname = 'reports_reason_check'
UNION ALL
SELECT 'on_report_notify cu IS DISTINCT FROM (C8.1; asteptat true)', (prosrc LIKE '%IS DISTINCT FROM NEW.reporter_id%')::text
  FROM pg_proc WHERE oid = 'public.on_report_notify()'::regprocedure
UNION ALL
SELECT 'admin_list_reports intoarce source + reporter_email (asteptat true)', (prosrc LIKE '%r.source, r.reporter_email%')::text
  FROM pg_proc WHERE oid = 'public.admin_list_reports(text)'::regprocedure
UNION ALL
SELECT 'app.report_ip_events: rls|drepturi anon+authenticated (asteptat true|0)',
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.report_ip_events'::regclass)::text || '|' ||
       (SELECT count(*) FROM information_schema.role_table_grants g WHERE g.table_schema = 'app' AND g.table_name = 'report_ip_events' AND g.grantee IN ('anon', 'authenticated'))::text
UNION ALL
SELECT 'insert_public_report: EXECUTE service_role|anon|authenticated (asteptat true|false|false)',
       has_function_privilege('service_role', 'public.insert_public_report(text, text, uuid, text, text, text, text)', 'EXECUTE')::text || '|' ||
       has_function_privilege('anon', 'public.insert_public_report(text, text, uuid, text, text, text, text)', 'EXECUTE')::text || '|' ||
       has_function_privilege('authenticated', 'public.insert_public_report(text, text, uuid, text, text, text, text)', 'EXECUTE')::text
UNION ALL
SELECT 'grant-urile authenticated pe reports neschimbate (asteptat INSERT,SELECT)', string_agg(privilege_type, ',' ORDER BY privilege_type)
  FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'reports' AND grantee = 'authenticated'
UNION ALL
SELECT 'cron cleanup-report-ip-events-hourly (asteptat 1 activ)', count(*)::text
  FROM cron.job WHERE jobname = 'cleanup-report-ip-events-hourly' AND active
UNION ALL
SELECT 'rapoarte publice existente (informativ: 0 la aplicare)', count(*)::text FROM public.reports WHERE source = 'public'
UNION ALL
SELECT 'rapoarte din app cu source=app (informativ: = toate rapoartele de azi)', count(*)::text FROM public.reports WHERE source = 'app'
UNION ALL
SELECT 'secretul push_kick_secret in Vault (asteptat 64; neatins de faza 8)', coalesce((SELECT length(decrypted_secret)::text FROM vault.decrypted_secrets WHERE name = 'push_kick_secret'), 'LIPSESTE')
UNION ALL
SELECT 'retentie DRY-RUN (consent_log_deleted asteptat 0 la aplicare)', (app.apply_retention(true))::text;
