-- Amprenta catalogului (faza 2 → metoda din §8.15 PLAN_1.1_FIX, extinsă la schema `app` și la view-uri pentru faza 4).
-- Doar SELECT. Aceeași interogare înainte de migrare, după migrare, după rollback și după re-aplicare;
-- `rollback` e corect dacă amprenta „după rollback” = amprenta „înainte”, iar re-aplicarea = „după migrare”.
-- Ieșire: cat | key | val, sortată (psql -A -t), fără dependență de OID-uri (numele prin regclass/regprocedure).
SELECT cat || ' | ' || key || ' | ' || val
FROM (
  SELECT 'policy' AS cat, schemaname || '.' || tablename || '.' || policyname AS key,
         permissive || '|' || array_to_string(ARRAY(SELECT r::text FROM unnest(roles) r ORDER BY 1), ',') || '|' || cmd
         || '|' || coalesce(qual, '-') || '|' || coalesce(with_check, '-') AS val
    FROM pg_policies WHERE schemaname IN ('public', 'app', 'storage')
  UNION ALL
  SELECT 'function', n.nspname || '.' || p.oid::regprocedure::text,
         md5(btrim(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
         || '|' || p.provolatile::text || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '-')
         || '|' || pg_get_function_result(p.oid)
         || '|' || coalesce(array_to_string(ARRAY(SELECT x::text FROM unnest(p.proacl) x ORDER BY 1), ','), 'NULL')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'app')
  UNION ALL
  SELECT 'constraint', conrelid::regclass::text || '.' || conname, contype::text || '|' || pg_get_constraintdef(oid) || '|' || convalidated::text
    FROM pg_constraint WHERE connamespace IN ('public'::regnamespace, 'app'::regnamespace)
  UNION ALL
  SELECT 'index', schemaname || '.' || indexname, indexdef FROM pg_indexes WHERE schemaname IN ('public', 'app', 'storage')
  UNION ALL
  SELECT 'trigger', t.tgrelid::regclass::text || '.' || t.tgname, t.tgfoid::regprocedure::text || '|' || t.tgtype::text || '|' || t.tgenabled::text
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'app', 'storage', 'auth')
  UNION ALL
  SELECT 'view', c.oid::regclass::text, md5(pg_get_viewdef(c.oid, true)) || '|' || coalesce(array_to_string(c.reloptions, ','), '-')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'app') AND c.relkind = 'v'
  UNION ALL
  SELECT 'column', c.oid::regclass::text || '.' || a.attname,
         a.attnum::text || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
         || '|' || a.attgenerated::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
   WHERE n.nspname IN ('public', 'app') AND c.relkind IN ('r', 'p', 'v')
  UNION ALL
  SELECT 'column_priv', c.oid::regclass::text || ':' || r.rolname,
         array_to_string(ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                                  AND has_column_privilege(r.rolname, c.oid, a.attnum, 'SELECT') ORDER BY 1), ',')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
   WHERE n.nspname IN ('public', 'app') AND c.relkind IN ('r', 'v', 'p')
  UNION ALL
  SELECT 'bucket', id, public::text || '|' || coalesce(file_size_limit::text, '-') || '|' || coalesce(array_to_string(allowed_mime_types, ','), '-')
    FROM storage.buckets
  UNION ALL
  SELECT 'cron', jobname, schedule || '|' || command || '|' || active::text FROM cron.job
  UNION ALL
  SELECT 'schema', nspname, coalesce(array_to_string(ARRAY(SELECT x::text FROM unnest(nspacl) x ORDER BY 1), ','), 'NULL')
    FROM pg_namespace WHERE nspname IN ('public', 'storage', 'extensions', 'app')
  UNION ALL
  SELECT 'table_priv', c.oid::regclass::text || ':' || r.rolname,
         array_to_string(ARRAY(SELECT pr FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pr
                                WHERE has_table_privilege(r.rolname, c.oid, pr) ORDER BY 1), ',')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
   WHERE n.nspname IN ('public', 'app', 'storage') AND c.relkind IN ('r', 'v', 'p')
  UNION ALL
  SELECT 'default_acl', pg_get_userbyid(defaclrole) || '|' || CASE WHEN defaclnamespace = 0 THEN 'GLOBAL' ELSE defaclnamespace::regnamespace::text END || '|' || defaclobjtype::text,
         array_to_string(ARRAY(SELECT x::text FROM unnest(defaclacl) x ORDER BY 1), ',')
    FROM pg_default_acl
  UNION ALL
  SELECT 'rls', c.oid::regclass::text, c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'app', 'storage') AND c.relkind IN ('r', 'p')
  UNION ALL
  SELECT 'publication', pubname || '.' || schemaname || '.' || tablename, '-' FROM pg_publication_tables
) f
ORDER BY 1 COLLATE "C";
