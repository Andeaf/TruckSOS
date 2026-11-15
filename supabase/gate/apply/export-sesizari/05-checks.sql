SELECT 'export_my_data are cheia reports_filed (asteptat true)' AS k,
       (SELECT prosrc LIKE '%reports_filed%' FROM pg_proc WHERE oid = 'public.export_my_data()'::regprocedure)::text AS v
UNION ALL
SELECT 'export_my_data NU contine content_snapshot / image_path_snapshot (asteptat false)',
       (SELECT prosrc LIKE ANY (ARRAY['%content_snapshot%', '%image_path_snapshot%']) FROM pg_proc WHERE oid = 'public.export_my_data()'::regprocedure)::text
UNION ALL
SELECT 'export_my_data NU contine reporter_email ca valoare exportata (asteptat false)',
       (SELECT prosrc LIKE '%r.reporter_email%' FROM pg_proc WHERE oid = 'public.export_my_data()'::regprocedure)::text
UNION ALL
SELECT 'cheile fazei 8.2 au ramas - app.profile_terms si app.consent_log (asteptat true)',
       (SELECT prosrc LIKE '%app.profile_terms%' AND prosrc LIKE '%app.consent_log%' FROM pg_proc WHERE oid = 'public.export_my_data()'::regprocedure)::text
UNION ALL
SELECT 'SECURITY DEFINER + search_path gol (asteptat true|search_path="")',
       (SELECT prosecdef::text || '|' || array_to_string(proconfig, ',') FROM pg_proc WHERE oid = 'public.export_my_data()'::regprocedure)
UNION ALL
SELECT 'EXECUTE anon (asteptat false)', has_function_privilege('anon', 'public.export_my_data()', 'EXECUTE')::text
UNION ALL
SELECT 'EXECUTE authenticated (asteptat true)', has_function_privilege('authenticated', 'public.export_my_data()', 'EXECUTE')::text
UNION ALL
SELECT 'un singur overload export_my_data in public (asteptat 1)',
       (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'export_my_data')
UNION ALL
SELECT 'istoric migrari (ultimele 6 versiuni; 20261112000100 dupa repair)', string_agg(version, ',' ORDER BY version)
  FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 6) h;
