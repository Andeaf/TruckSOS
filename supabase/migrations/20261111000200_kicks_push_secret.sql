-- Faza 9.3 (plan: .claude/wip/faza9/PLAN-faza9.md, APROBAT de David 9 nov 2026 cu C9.1 și C9.2; decizia D9.3): ultimele două locuri
-- care trimiteau cheia `service_role_key` din Vault prin pg_net (header-ele stau în clar în net.http_request_queue / net._http_response)
-- trec pe tiparul fazei 3:
--   1. cron-ul `cleanup-announcements-hourly` → app.kick_cleanup_announcements() cu `x-push-secret` (Vault `push_kick_secret`), fără
--      `Authorization`; EF-ul `cleanup-announcements` primește poarta checkPushSecret (verify_jwt = false) — deploy ÎNAINTE de migrare
--      (fereastra de cutover: EF nou + cron vechi → 401 de la poarta EF-ului, cel mult o rulare orară; EF vechi cu
--      verify_jwt pornit + cron nou fără Authorization → 401 de la gateway).
--   2. public.storage_api_delete(bucket, name) (semnătura neschimbată; apelanții admin_delete_* / delete_message rămân) nu mai face
--      DELETE pe Storage API cu service_role: pune calea în coada fazei 6 (app.storage_gc_enqueue, motiv 'sql_delete'), consumată de EF
--      `storage-gc`.
--   3. C9.2: coada se consumă la cel mult o oră — cron nou `storage-gc-hourly` (kick doar dacă există rânduri); scanarea orfanilor rămâne
--      duminica, DOAR din jobul zilnic (kick_storage_gc(p_scan) primește parametrul; implicit: fără scanare).
--   4. Dovada că lista e completă: blocul DO final ridică excepție dacă vreo funcție din public/app mai conține 'service_role_key'.
-- PRECONDIȚIE (C9.1): faza 6 aplicată ȘI EF storage-gc cu STORAGE_GC_APPLY=true (altfel după 9.3 nu s-ar mai șterge nimic din Storage).
-- Postgres nu vede secretul EF; verificăm ce se poate: obiectele fazei 6 există și coada nu are rânduri mai vechi de 48 h (semn că GC-ul
-- chiar șterge). Restul e în documentul de aplicare (curl → dry_run: false).
-- Rollback: supabase/rollback/20261111000200_kicks_push_secret.sql (cron-ul vechi cu Bearer, storage_api_delete și kick_storage_gc byte
-- cu byte din migrările originale, storage-gc-hourly scos).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('app.storage_gc_queue') IS NULL OR to_regprocedure('app.storage_gc_enqueue(text[], text, text)') IS NULL
     OR to_regprocedure('app.kick_storage_gc()') IS NULL THEN
    RAISE EXCEPTION 'cere faza 6 (20261109000400_storage_gc)';
  END IF;
  IF to_regprocedure('app.kick_push_dispatch()') IS NULL THEN RAISE EXCEPTION 'cere faza 3 (20261102000100_push_queue)'; END IF;
  IF to_regprocedure('app.kick_cleanup_announcements()') IS NOT NULL THEN RAISE EXCEPTION 'kick_cleanup_announcements exista deja: migrarea a fost aplicata?'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-announcements-hourly') THEN RAISE EXCEPTION 'cron cleanup-announcements-hourly lipsa'; END IF;
  -- C9.1: coada Storage trebuie să fie consumată (STORAGE_GC_APPLY=true); rânduri > 48 h = GC încă în dry-run → nu mutăm ștergerile în coadă
  IF EXISTS (SELECT 1 FROM app.storage_gc_queue q WHERE q.created_at < now() - interval '48 hours') THEN
    RAISE EXCEPTION 'C9.1: app.storage_gc_queue are randuri mai vechi de 48 h - EF storage-gc nu sterge (STORAGE_GC_APPLY lipsa?)';
  END IF;
END $$;

-- ── 1. Kick-ul pentru cleanup-announcements (același tipar ca app.kick_push_dispatch) ────────────────────────
CREATE FUNCTION app.kick_cleanup_announcements()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'push_kick_secret' LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE WARNING 'kick_cleanup_announcements: push_kick_secret lipseste din Vault; anunturile nu expira';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := 'https://shgagwnxgliixrzeibmt.supabase.co/functions/v1/cleanup-announcements',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION app.kick_cleanup_announcements() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('cleanup-announcements-hourly');
SELECT cron.schedule('cleanup-announcements-hourly', '17 * * * *', $cron$ SELECT app.kick_cleanup_announcements(); $cron$);

-- ── 2. storage_api_delete → coadă (semnătura și drepturile neschimbate; apelanții din SQL nu se ating) ────────
CREATE OR REPLACE FUNCTION public.storage_api_delete(p_bucket text, p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Faza 9.3 (D9.3): fără pg_net + service_role; obiectul intră în coada fazei 6 și e șters de EF storage-gc în ≤ 1 h (cron orar).
  IF p_name IS NULL OR p_name = '' THEN RETURN; END IF;
  PERFORM app.storage_gc_enqueue(ARRAY[p_name], 'sql_delete', COALESCE(NULLIF(p_bucket, ''), 'photos'));
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'storage_api_delete: % (%/%)', SQLERRM, p_bucket, p_name;
END; $function$;
REVOKE ALL ON FUNCTION public.storage_api_delete(p_bucket text, p_name text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_api_delete(p_bucket text, p_name text) TO service_role;

-- ── 3. C9.2: kick-ul Storage cu parametru de scanare + cron orar ──────────────────────────────────────────────
-- Textul fazei 6, cu p_scan: NULL/false = fără scanare (orar), true = scanarea orfanilor (jobul zilnic, duminica). Semnătura veche
-- (fără argumente) dispare; cron-ul zilnic e reprogramat cu noul apel.
DROP FUNCTION app.kick_storage_gc();
CREATE FUNCTION app.kick_storage_gc(p_scan boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
  v_scan boolean := COALESCE(p_scan, false);
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
REVOKE EXECUTE ON FUNCTION app.kick_storage_gc(boolean) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('storage-gc-daily');
SELECT cron.schedule('storage-gc-daily', '50 4 * * *', $cron$ SELECT app.kick_storage_gc(EXTRACT(DOW FROM now()) = 0); $cron$);
SELECT cron.schedule('storage-gc-hourly', '35 * * * *', $cron$ SELECT app.kick_storage_gc(false); $cron$);

-- ── 4. Verificări: nicio funcție nu mai conține secretul; cron-urile fără Authorization ──────────────────────
DO $$
DECLARE v_left text;
BEGIN
  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v_left
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'app') AND p.prosrc ILIKE '%service_role_key%';
  IF v_left IS NOT NULL THEN RAISE EXCEPTION 'functii care mai contin service_role_key: %', v_left; END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE command ILIKE '%service_role_key%' OR command ILIKE '%Authorization%') THEN
    RAISE EXCEPTION 'cron.job mai contine Authorization / service_role_key';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('cleanup-announcements-hourly', 'storage-gc-daily', 'storage-gc-hourly') AND active) <> 3 THEN
    RAISE EXCEPTION 'cron-urile fazei 9.3 lipsesc';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.storage_api_delete(text, text)'::regprocedure) ILIKE '%http_delete%' THEN
    RAISE EXCEPTION 'storage_api_delete mai face http_delete';
  END IF;
END $$;
