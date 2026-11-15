SELECT 'export_my_data exista (faza 6.4; asteptat true)' AS k, (to_regprocedure('public.export_my_data()') IS NOT NULL)::text AS v
UNION ALL
SELECT 'export_my_data are cheile fazei 8.2 - app.profile_terms (asteptat true)',
       COALESCE((SELECT prosrc LIKE '%app.profile_terms%' FROM pg_proc WHERE oid = to_regprocedure('public.export_my_data()')), false)::text
UNION ALL
SELECT 'reports.announcement_id exista (faza 8.3; asteptat true)',
       EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.reports'::regclass AND attname = 'announcement_id' AND NOT attisdropped)::text
UNION ALL
SELECT 'cheia reports_filed e deja in export (asteptat false; true = migrarea e deja aplicata -> STOP)',
       COALESCE((SELECT prosrc LIKE '%reports_filed%' FROM pg_proc WHERE oid = to_regprocedure('public.export_my_data()')), false)::text
UNION ALL
SELECT 'istoric migrari (ultimele 6 versiuni)', string_agg(version, ',' ORDER BY version)
  FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 6) h;
