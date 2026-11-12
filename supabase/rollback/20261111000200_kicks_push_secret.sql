-- Rollback pentru 20261111000200_kicks_push_secret (faza 9): cron-ul cleanup-announcements-hourly revine la Bearer cu service_role_key din Vault, storage_api_delete la DELETE direct pe Storage API, kick_storage_gc la forma fără argument; storage-gc-hourly dispare. ATENȚIE: cere din nou secretul `service_role_key` în Vault (dacă a fost șters după 9.3, pozele șterse din SQL rămân orfane și anunțurile nu mai expiră) și EF-ul cleanup-announcements în varianta veche (cu verify_jwt) — altfel cron-ul primește 401. Rândurile `sql_delete` deja puse în coadă rămân și sunt șterse de EF storage-gc.
-- Generat de .claude/wip/faza9/gen-rollbacks.mjs; funcțiile și comenzile cron restaurate sunt copiate byte cu byte din migrările originale.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea rollback-urilor fazei 9: 300 → 200 → 100.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('storage-gc-hourly', 'storage-gc-daily', 'cleanup-announcements-hourly');

-- app.kick_storage_gc: textul din 20261109000400 (faza 6.2)
DROP FUNCTION IF EXISTS app.kick_storage_gc(boolean);
CREATE FUNCTION app.kick_storage_gc()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
  v_scan boolean := (EXTRACT(DOW FROM now()) = 0);  -- duminica: scanarea orfanilor
BEGIN
  IF NOT v_scan AND NOT EXISTS (SELECT 1 FROM app.storage_gc_queue) THEN
    RETURN;
  END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'push_kick_secret' LIMIT 1;
  IF v_secret IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := 'https://shgagwnxgliixrzeibmt.supabase.co/functions/v1/storage-gc',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body    := jsonb_build_object('scan', v_scan),
    timeout_milliseconds := 90000
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION app.kick_storage_gc() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('storage-gc-daily', '50 4 * * *', $cron$ SELECT app.kick_storage_gc(); $cron$);

-- public.storage_api_delete: textul din baseline 20261031000300
CREATE OR REPLACE FUNCTION public.storage_api_delete(p_bucket text, p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key  text;
  v_path text;
BEGIN
  IF p_name IS NULL OR p_name = '' THEN RETURN; END IF;

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key'
   LIMIT 1;
  IF v_key IS NULL THEN
    RAISE WARNING 'storage_api_delete: secretul service_role_key lipseste din Vault; % ramane orfan', p_name;
    RETURN;
  END IF;

  -- Căile sunt generate de aplicație (folder/uuid/uuid.ext) — sigure în URL; escape
  -- minimal doar pentru caracterele care ar rupe calea, dacă ar apărea vreodată.
  v_path := replace(replace(replace(replace(replace(p_name,
              '%', '%25'), ' ', '%20'), '#', '%23'), '?', '%3F'), '+', '%2B');

  PERFORM net.http_delete(
    url := 'https://shgagwnxgliixrzeibmt.supabase.co/storage/v1/object/' || p_bucket || '/' || v_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 10000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'storage_api_delete: % (%/%)', SQLERRM, p_bucket, p_name;
END; $function$;
REVOKE ALL ON FUNCTION public.storage_api_delete(p_bucket text, p_name text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_api_delete(p_bucket text, p_name text) TO service_role;

-- cron-ul cleanup-announcements-hourly: comanda din baseline 20261031000300
DROP FUNCTION IF EXISTS app.kick_cleanup_announcements();
SELECT cron.schedule('cleanup-announcements-hourly', '17 * * * *', $cron$
  select net.http_post(
    url     := 'https://shgagwnxgliixrzeibmt.supabase.co/functions/v1/cleanup-announcements',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'service_role_key' limit 1
      )
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$);
