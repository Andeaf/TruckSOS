-- Faza 6.2 (PLAN_1.1_FIX #18; plan: .claude/wip/faza6/PLAN-faza6.md, decizia D3): coada de ștergere Storage
-- `app.storage_gc_queue` + RPC-urile Edge Function-ului `storage-gc` (service_role în env-ul propriu). Ștergerile de
-- obiecte Storage declanșate din bază (retenție, ciorne expirate, rapoarte închise) NU mai trec prin `storage_api_delete`
-- (pg_net cu `service_role_key` din Vault — aceeași expunere respinsă la faza 3 pentru kick-uri); apelanții vechi ai
-- `storage_api_delete` rămân până la faza 9.
--
-- Orfanii (pozele rămase fără rând: anunț șters de șofer pe 1.0.x, upload reușit + insert eșuat) se detectează la cerere, din
-- `storage.objects`, doar pentru folderele cu index propriu: `announcements/<id>/…` (app.announcements + announcement_photos)
-- și `market/<id>/…` (market_listings + market_listing_photos). `chat/`, `channel/`, `avatars/` NU se scanează (rândul e în
-- mesaj/profil; un obiect fără referință acolo poate fi legitim — avatar vechi încă semnat).
-- Obiectele mai noi de 24 h nu sunt considerate orfane (upload în curs: obiectul există, rândul vine imediat după).
--
-- EF `storage-gc` (verify_jwt = false, poarta `x-push-secret` cu același secret ca faza 3 — decizia D4): DRY-RUN implicit,
-- șterge doar cu secretul EF `STORAGE_GC_APPLY=true` (David, după raportul primei rulări).
-- Cron `storage-gc-daily` (04:50): kick DOAR dacă coada are rânduri sau e duminică (scanarea săptămânală a orfanilor).
--
-- Rollback: supabase/rollback/20261109000400_storage_gc.sql (refuză dacă 20261109000500_retention e aplicată; cron scos,
-- RPC-uri și tabel șterse — rândurile din coadă se pierd, obiectele rămân în Storage).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('app.announcements') IS NULL THEN RAISE EXCEPTION 'cere faza 4 (app.announcements)'; END IF;
  IF to_regclass('app.storage_gc_queue') IS NOT NULL THEN RAISE EXCEPTION 'app.storage_gc_queue exista deja: migrarea a fost aplicata?'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'cere pg_cron + pg_net';
  END IF;
END $$;

-- ── 1. Coada ────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE app.storage_gc_queue (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket     text NOT NULL DEFAULT 'photos',
  name       text NOT NULL,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, name)
);
COMMENT ON TABLE app.storage_gc_queue IS 'Faza 6.2: obiecte Storage de șters de EF storage-gc (service_role). Scrisă de retenție / scanarea de orfani; fără GRANT, doar prin funcții.';
ALTER TABLE app.storage_gc_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.storage_gc_queue FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE app.storage_gc_queue TO service_role;  -- convenția repo-ului (check-migrations); `app` nu e expusă prin API

-- Folosită de retenție (20261109000500) și de scanare: pune căi în coadă, fără dubluri. Întoarce câte a adăugat.
CREATE FUNCTION app.storage_gc_enqueue(p_names text[], p_reason text, p_bucket text DEFAULT 'photos')
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_names IS NULL OR cardinality(p_names) = 0 THEN RETURN 0; END IF;
  INSERT INTO app.storage_gc_queue (bucket, name, reason)
  SELECT p_bucket, n, COALESCE(p_reason, 'unknown')
    FROM unnest(p_names) AS n
   WHERE n IS NOT NULL AND n <> ''
  ON CONFLICT (bucket, name) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION app.storage_gc_enqueue(text[], text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── 2. Scanarea orfanilor (folderele cu index propriu; obiecte mai vechi de 24 h) ──────────────────
CREATE FUNCTION app.storage_gc_scan_orphans()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ann integer;
  v_mkt integer;
BEGIN
  -- announcements/<announcement_id>/<file>: fără rând în announcement_photos cu exact acea cale (anunț șters → rândul a
  -- căzut prin cascadă; upload reușit + insert eșuat → rândul n-a existat niciodată; în ambele cazuri aplicația nu-l mai
  -- poate afișa)
  SELECT app.storage_gc_enqueue(COALESCE(array_agg(o.name), '{}'), 'orphan_announcement_photo') INTO v_ann
    FROM storage.objects o
   WHERE o.bucket_id = 'photos'
     AND o.name LIKE 'announcements/%'
     AND o.created_at < now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM public.announcement_photos ap WHERE ap.storage_path = o.name);
  -- market/<listing_id>/<file>: fără rând în market_listing_photos cu acea cale
  SELECT app.storage_gc_enqueue(COALESCE(array_agg(o.name), '{}'), 'orphan_market_photo') INTO v_mkt
    FROM storage.objects o
   WHERE o.bucket_id = 'photos'
     AND o.name LIKE 'market/%'
     AND o.created_at < now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM public.market_listing_photos mp WHERE mp.storage_path = o.name);
  RETURN COALESCE(v_ann, 0) + COALESCE(v_mkt, 0);
END;
$function$;
REVOKE EXECUTE ON FUNCTION app.storage_gc_scan_orphans() FROM PUBLIC, anon, authenticated, service_role;

-- ── 3. RPC-uri pentru EF (public, SECURITY DEFINER, EXECUTE doar service_role) ────────────────────
-- p_scan = true → întâi caută orfanii (duminica, din kick), apoi întoarce coada. Fără stare de „claim”: EF-ul șterge și
-- apelează finish; dacă moare între ele, rândurile rămân și se reiau (remove pe o cale inexistentă nu e eroare).
CREATE FUNCTION public.storage_gc_claim(p_limit integer DEFAULT 500, p_scan boolean DEFAULT false)
 RETURNS TABLE (id bigint, bucket text, name text, reason text, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_scan THEN
    PERFORM app.storage_gc_scan_orphans();
  END IF;
  RETURN QUERY
    SELECT q.id, q.bucket, q.name, q.reason, q.created_at
      FROM app.storage_gc_queue q
     ORDER BY q.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 2000));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.storage_gc_claim(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_gc_claim(integer, boolean) TO service_role;

CREATE FUNCTION public.storage_gc_finish(p_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN 0; END IF;
  DELETE FROM app.storage_gc_queue q WHERE q.id = ANY (p_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.storage_gc_finish(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_gc_finish(bigint[]) TO service_role;

-- ── 4. Kick-ul (același tipar și același secret ca faza 3; fără Authorization) ─────────────────────
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

-- ── 5. Verificări ───────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_table_privilege('anon', 'app.storage_gc_queue', 'SELECT') OR has_table_privilege('authenticated', 'app.storage_gc_queue', 'SELECT') THEN
    RAISE EXCEPTION 'storage_gc_queue: anon/authenticated nu trebuie sa aiba drepturi';
  END IF;
  IF has_function_privilege('authenticated', 'public.storage_gc_claim(integer, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.storage_gc_finish(bigint[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC-urile storage-gc trebuie sa fie doar pentru service_role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storage-gc-daily') THEN
    RAISE EXCEPTION 'cron storage-gc-daily lipseste';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
