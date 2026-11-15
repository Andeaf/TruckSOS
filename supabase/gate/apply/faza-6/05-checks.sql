SELECT 'CHECK-ul de status al anunturilor contine draft (asteptat true)' AS k,
       (pg_get_constraintdef(oid) LIKE '%draft%')::text AS v
  FROM pg_constraint WHERE conrelid = 'app.announcements'::regclass AND conname = 'announcements_status_check'
UNION ALL
SELECT 'garda accepta draft la INSERT (asteptat true)',
       (prosrc LIKE '%WHEN NEW.status = ''draft'' THEN ''draft''%' AND prosrc LIKE '%OLD.status <> ''draft''%')::text
  FROM pg_proc WHERE oid = 'public.guard_announcement_client_writes()'::regprocedure
UNION ALL
SELECT 'politica announcements_update_publish (asteptat 1)', count(*)::text
  FROM pg_policies WHERE schemaname = 'app' AND tablename = 'announcements' AND policyname = 'announcements_update_publish'
UNION ALL
SELECT 'triggere de push pe app.announcements (asteptat announcements_notify, announcements_notify_publish)',
       string_agg(tgname, ', ' ORDER BY tgname)
  FROM pg_trigger WHERE tgrelid = 'app.announcements'::regclass AND tgname LIKE 'announcements_notify%'
UNION ALL
SELECT 'default market_push_enabled tabel|view (asteptat false|false)',
       (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
         WHERE d.adrelid = 'app.profiles'::regclass AND a.attname = 'market_push_enabled')
       || '|' ||
       (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
         WHERE d.adrelid = 'public.profiles'::regclass AND a.attname = 'market_push_enabled')
UNION ALL
SELECT 'conturi cu market_push_enabled = true (informativ: conturile vechi raman true)', count(*)::text FROM app.profiles WHERE market_push_enabled
UNION ALL
SELECT 'tabelele noi in app (asteptat 2/2: apple_tokens,storage_gc_queue)', string_agg(c.relname, ',' ORDER BY c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'app' AND c.relkind = 'r' AND c.relname IN ('apple_tokens', 'storage_gc_queue')
UNION ALL
SELECT 'RLS + fara drepturi anon/authenticated pe cele 2 tabele (asteptat 2 rls, 0 drepturi)',
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'app' AND c.relname IN ('apple_tokens', 'storage_gc_queue') AND c.relrowsecurity)::text
       || ' rls, ' ||
       (SELECT count(*) FROM information_schema.role_table_grants g
         WHERE g.table_schema = 'app' AND g.table_name IN ('apple_tokens', 'storage_gc_queue') AND g.grantee IN ('anon', 'authenticated'))::text || ' drepturi'
UNION ALL
SELECT 'RPC-urile service_role (asteptat 5: read_apple_token,record_account_deletion,storage_gc_claim,storage_gc_finish,store_apple_token)',
       string_agg(p.proname, ',' ORDER BY p.proname)
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('store_apple_token', 'read_apple_token', 'record_account_deletion', 'storage_gc_claim', 'storage_gc_finish')
UNION ALL
SELECT 'EXECUTE anon/authenticated pe RPC-urile service_role (asteptat 0)', count(*)::text
  FROM pg_proc p, unnest(ARRAY['anon', 'authenticated']) r(role)
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('store_apple_token', 'read_apple_token', 'record_account_deletion', 'storage_gc_claim', 'storage_gc_finish')
   AND has_function_privilege(r.role, p.oid, 'EXECUTE')
UNION ALL
SELECT 'export_my_data: EXECUTE authenticated|anon (asteptat true|false)',
       has_function_privilege('authenticated', 'public.export_my_data()', 'EXECUTE')::text || '|' || has_function_privilege('anon', 'public.export_my_data()', 'EXECUTE')::text
UNION ALL
SELECT 'cota export (asteptat 2/24h in sursa)', (prosrc LIKE '%interval ''24 hours'', 2)%')::text FROM pg_proc WHERE oid = 'public.export_my_data()'::regprocedure
UNION ALL
SELECT 'joburi cron noi (asteptat 2: apply-retention-daily[5 4 * * *] storage-gc-daily[50 4 * * *])',
       string_agg(jobname || '[' || schedule || ']', ' ' ORDER BY jobname)
  FROM cron.job WHERE jobname IN ('apply-retention-daily', 'storage-gc-daily')
UNION ALL
SELECT 'admin_update_profile mascheaza auditul (asteptat true)',
       (prosrc LIKE '%audit_mask_profile_fields%')::text FROM pg_proc WHERE oid = 'public.admin_update_profile(uuid, jsonb)'::regprocedure
UNION ALL
SELECT 'secretul apple_token_key in Vault (asteptat 64; LIPSESTE = pasul Apple amanat, store refuza, read NULL)',
       coalesce((SELECT length(decrypted_secret)::text FROM vault.decrypted_secrets WHERE name = 'apple_token_key'), 'LIPSESTE')
UNION ALL
SELECT 'secretul push_kick_secret in Vault (asteptat 64; il foloseste si kick_storage_gc)',
       coalesce((SELECT length(decrypted_secret)::text FROM vault.decrypted_secrets WHERE name = 'push_kick_secret'), 'LIPSESTE')
UNION ALL
SELECT 'coada storage_gc (asteptat 0 inainte de prima scanare)', (SELECT count(*)::text FROM app.storage_gc_queue)
UNION ALL
SELECT 'retentie DRY-RUN (contoarele a ceea ce AR face prima rulare; de citit de David inainte de cron)', app.apply_retention(true)::text
UNION ALL
SELECT 'istoric migrari (ultimele 8 versiuni)', string_agg(version, ',' ORDER BY version)
  FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 8) h;
