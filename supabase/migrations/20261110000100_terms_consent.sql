-- Faza 8.2 (PLAN_1.1_FIX #22; plan: .claude/wip/faza8/PLAN-faza8.md, APROBAT de David 9 nov 2026, D8.2 = DA, D8.3 = DA cu C8.2):
-- consimțământul la termeni + confirmarea vârstei (18+), cu dovadă pe server.
--   1. app.profiles + terms_accepted_at / terms_version / age_confirmed_at (nullable; clienții 1.0.x nu le scriu; la trecerea pe 1.1
--      utilizatorul acceptă o dată, prin foaia „Termenii s-au actualizat”). NU se expun prin view-ul public.profiles (ar cere
--      rescrierea celor 25 de coloane cu măști și a triggerelor INSTEAD OF) — se citesc prin RPC-ul my_terms_status().
--   2. app.consent_log: fiecare acceptare (uid, versiune, dată, vârstă confirmată, sursă). FĂRĂ FK către profiles / auth.users:
--      dovada supraviețuiește ștergerii contului (D8.2) și se șterge la 3 ani de la acceptare (pas nou în app.apply_retention).
--   3. RPC-uri: accept_terms(p_version, p_source) scrie coloanele + jurnalul; my_terms_status() întoarce starea proprie.
-- Clienții 1.0.6–1.0.8: nimic nou (coloane nullable, funcții noi neapelate).
-- Rollback: supabase/rollback/20261110000100_terms_consent.sql (coloanele, tabelul și RPC-urile dispar; apply_retention revine la
-- textul fazei 6; DOVEZILE DE ACCEPTARE SE PIERD — export înainte cu SELECT * FROM app.consent_log).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('app.profiles') IS NULL THEN RAISE EXCEPTION 'cere faza 4 (app.profiles)'; END IF;
  IF to_regprocedure('app.apply_retention(boolean)') IS NULL THEN RAISE EXCEPTION 'cere 20261109000500_retention (faza 6)'; END IF;
  IF to_regprocedure('app.rate_limit_ok(text, interval, integer)') IS NULL THEN RAISE EXCEPTION 'cere app.rate_limit_ok'; END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'app.profiles'::regclass AND attname = 'terms_version' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'app.profiles.terms_version exista deja: migrarea a fost aplicata?';
  END IF;
  IF to_regclass('app.consent_log') IS NOT NULL THEN RAISE EXCEPTION 'app.consent_log exista deja'; END IF;
END $$;

-- ── 1. Coloanele de consimțământ (nullable, fără default: NULL = „nu a acceptat versiunea curentă”) ────────────────
ALTER TABLE app.profiles
  ADD COLUMN terms_accepted_at timestamptz,
  ADD COLUMN terms_version     text,
  ADD COLUMN age_confirmed_at  timestamptz;
COMMENT ON COLUMN app.profiles.terms_version IS 'Faza 8.2: versiunea Termenilor acceptată ultima dată (ex. 1.1.0); NULL la conturile 1.0.x până acceptă în 1.1. Scrisă doar de accept_terms().';
COMMENT ON COLUMN app.profiles.terms_accepted_at IS 'Faza 8.2: momentul ultimei acceptări a Termenilor (accept_terms).';
COMMENT ON COLUMN app.profiles.age_confirmed_at IS 'Faza 8.2: momentul confirmării „am cel puțin 18 ani” (accept_terms).';

-- ── 2. Jurnalul acceptărilor (dovadă istorică; fără FK — D8.2) ────────────────────────────────────────────────
CREATE TABLE app.consent_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL,
  version       text NOT NULL,
  accepted_at   timestamptz NOT NULL DEFAULT now(),
  age_confirmed boolean NOT NULL DEFAULT false,
  source        text NOT NULL CHECK (source IN ('signup', 'update'))
);
COMMENT ON TABLE app.consent_log IS 'Faza 8.2: fiecare acceptare a Termenilor (uid, versiune, dată, 18+, sursă). Fără FK: rămâne după ștergerea contului; retenție 3 ani (apply_retention). Scris doar de accept_terms().';
CREATE INDEX consent_log_user_idx ON app.consent_log (user_id, accepted_at DESC);
CREATE INDEX consent_log_accepted_idx ON app.consent_log (accepted_at);
ALTER TABLE app.consent_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.consent_log FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE app.consent_log TO service_role;  -- convenția repo-ului (check-migrations); `app` nu e expusă prin API

-- ── 3. RPC-uri ─────────────────────────────────────────────────────────────────────────────────────────────────
-- accept_terms: scrie cele 3 coloane + rândul din jurnal. p_version = versiunea afișată în texte (ex. '1.1.0'); formatul e verificat
-- (1–16 caractere din [0-9.-]) ca jurnalul să nu primească text liber. Rata: 20/oră (dublu-tap, reîncercări pe rețea slabă).
CREATE FUNCTION public.accept_terms(p_version text, p_source text DEFAULT 'update')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_version IS NULL OR p_version !~ '^[0-9][0-9.-]{0,15}$' THEN RAISE EXCEPTION 'bad_version'; END IF;
  IF p_source IS NULL OR p_source NOT IN ('signup', 'update') THEN RAISE EXCEPTION 'bad_source'; END IF;
  IF NOT app.rate_limit_ok('accept_terms', interval '1 hour', 20) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'accept_terms';
  END IF;

  UPDATE app.profiles
     SET terms_version     = p_version,
         terms_accepted_at = v_now,
         age_confirmed_at  = v_now
   WHERE id = v_uid AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  INSERT INTO app.consent_log (user_id, version, accepted_at, age_confirmed, source)
  VALUES (v_uid, p_version, v_now, true, p_source);

  RETURN jsonb_build_object('terms_version', p_version, 'terms_accepted_at', v_now, 'age_confirmed_at', v_now);
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_terms(p_version text, p_source text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_terms(p_version text, p_source text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_terms(p_version text, p_source text) TO service_role;

-- my_terms_status: starea proprie (citită o dată la pornirea sesiunii). Profil lipsă → NULL-uri (contul nou încă n-are profil).
CREATE FUNCTION public.my_terms_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_build_object('terms_version', p.terms_version, 'terms_accepted_at', p.terms_accepted_at, 'age_confirmed_at', p.age_confirmed_at)
       FROM app.profiles p WHERE p.id = auth.uid()),
    jsonb_build_object('terms_version', NULL, 'terms_accepted_at', NULL, 'age_confirmed_at', NULL));
$function$;
REVOKE ALL ON FUNCTION public.my_terms_status() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_terms_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_terms_status() TO service_role;

-- ── 4. Retenția: jurnalul de consimțământ > 3 ani (pasul 7, după conversații) ─────────────────────────────────
-- Textul din 20261109000500 (faza 6), neschimbat, + pasul 7 (consent_log_deleted) înaintea NOTICE-ului.
-- >>> apply_retention (generat de .claude/wip/faza8/gen-sql.mjs din 20261109000500_retention.sql)
CREATE OR REPLACE FUNCTION app.apply_retention(p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  c_closed_days   constant interval := interval '90 days';
  c_draft_age     constant interval := interval '24 hours';
  c_views_days    constant interval := interval '90 days';
  c_reports_age   constant interval := interval '12 months';
  c_audit_age     constant interval := interval '12 months';
  c_conv_age      constant interval := interval '24 months';
  c_consent_age   constant interval := interval '3 years';    -- faza 8.2 (D8.2)
  v_out   jsonb := jsonb_build_object('dry_run', p_dry_run, 'ran_at', now());
  v_n     integer;
  v_paths text[];
  v_ids   uuid[];
BEGIN
  -- 1. plăcuță / VIN / GPS pe anunțurile închise
  BEGIN
    IF p_dry_run THEN
      SELECT count(*) INTO v_n FROM app.announcements a
       WHERE a.status IN ('resolved', 'cancelled') AND a.updated_at < now() - c_closed_days
         AND (a.plate_number IS NOT NULL OR a.chassis_number IS NOT NULL OR a.latitude IS NOT NULL OR a.longitude IS NOT NULL);
    ELSE
      UPDATE app.announcements a
         SET plate_number = NULL, chassis_number = NULL, latitude = NULL, longitude = NULL
       WHERE a.status IN ('resolved', 'cancelled') AND a.updated_at < now() - c_closed_days
         AND (a.plate_number IS NOT NULL OR a.chassis_number IS NOT NULL OR a.latitude IS NOT NULL OR a.longitude IS NOT NULL);
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    v_out := v_out || jsonb_build_object('closed_announcements_anonymized', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('closed_announcements_error', SQLERRM);
  END;

  -- 2. ciorne abandonate (7.2)
  BEGIN
    SELECT COALESCE(array_agg(a.id), '{}') INTO v_ids FROM app.announcements a
     WHERE a.status = 'draft' AND a.created_at < now() - c_draft_age;
    IF NOT p_dry_run AND cardinality(v_ids) > 0 THEN
      SELECT COALESCE(array_agg(ap.storage_path), '{}') INTO v_paths FROM public.announcement_photos ap WHERE ap.announcement_id = ANY (v_ids);
      PERFORM app.storage_gc_enqueue(v_paths, 'expired_draft');
      DELETE FROM app.announcements a WHERE a.id = ANY (v_ids);
    END IF;
    v_out := v_out || jsonb_build_object('drafts_deleted', cardinality(v_ids));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('drafts_error', SQLERRM);
  END;

  -- 3. vizualizări
  BEGIN
    IF p_dry_run THEN
      SELECT count(*) INTO v_n FROM public.announcement_views v WHERE v.viewed_at < now() - c_views_days;
    ELSE
      DELETE FROM public.announcement_views v WHERE v.viewed_at < now() - c_views_days;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    v_out := v_out || jsonb_build_object('views_deleted', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('views_error', SQLERRM);
  END;

  -- 4. rapoarte închise
  BEGIN
    SELECT COALESCE(array_agg(r.id), '{}') INTO v_ids FROM public.reports r
     WHERE r.status IN ('reviewed', 'dismissed') AND r.created_at < now() - c_reports_age;
    IF NOT p_dry_run AND cardinality(v_ids) > 0 THEN
      -- image_path_snapshot NU e o copie: trigger-ul reports_snapshot_from_source copiază exact image_path-ul mesajului
      -- (review 9 nov). Se șterge din Storage DOAR dacă niciun mesaj viu (privat sau din canal) nu mai referă calea.
      SELECT COALESCE(array_agg(r.image_path_snapshot), '{}') INTO v_paths FROM public.reports r
       WHERE r.id = ANY (v_ids) AND r.image_path_snapshot IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.image_path = r.image_path_snapshot OR m.file_path = r.image_path_snapshot)
         AND NOT EXISTS (SELECT 1 FROM public.channel_messages cm WHERE cm.image_path = r.image_path_snapshot OR cm.file_path = r.image_path_snapshot);
      PERFORM app.storage_gc_enqueue(v_paths, 'expired_report_snapshot');
      DELETE FROM public.reports r WHERE r.id = ANY (v_ids);
    END IF;
    v_out := v_out || jsonb_build_object('reports_deleted', cardinality(v_ids));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('reports_error', SQLERRM);
  END;

  -- 5. jurnalul admin
  BEGIN
    IF p_dry_run THEN
      SELECT count(*) INTO v_n FROM public.admin_audit_log l WHERE l.created_at < now() - c_audit_age;
    ELSE
      DELETE FROM public.admin_audit_log l WHERE l.created_at < now() - c_audit_age;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    v_out := v_out || jsonb_build_object('audit_deleted', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('audit_error', SQLERRM);
  END;

  -- 6. conversații inactive de 24 luni (mesajele și citirile cad prin cascadă)
  BEGIN
    SELECT COALESCE(array_agg(c.id), '{}') INTO v_ids
      FROM public.conversations c
     WHERE c.created_at < now() - c_conv_age
       AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id AND m.created_at >= now() - c_conv_age);
    IF NOT p_dry_run AND cardinality(v_ids) > 0 THEN
      SELECT COALESCE(array_agg(p), '{}') INTO v_paths
        FROM (SELECT m.image_path AS p FROM public.messages m WHERE m.conversation_id = ANY (v_ids) AND m.image_path IS NOT NULL
              UNION ALL
              SELECT m.file_path FROM public.messages m WHERE m.conversation_id = ANY (v_ids) AND m.file_path IS NOT NULL) x;
      PERFORM app.storage_gc_enqueue(v_paths, 'expired_conversation');
      DELETE FROM public.conversations c WHERE c.id = ANY (v_ids);
    END IF;
    v_out := v_out || jsonb_build_object('conversations_deleted', cardinality(v_ids));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('conversations_error', SQLERRM);
  END;

  -- 7. jurnalul de consimțământ (faza 8.2, D8.2): 3 ani de la acceptare, indiferent dacă contul mai există
  BEGIN
    IF p_dry_run THEN
      SELECT count(*) INTO v_n FROM app.consent_log l WHERE l.accepted_at < now() - c_consent_age;
    ELSE
      DELETE FROM app.consent_log l WHERE l.accepted_at < now() - c_consent_age;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    v_out := v_out || jsonb_build_object('consent_log_deleted', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('consent_log_error', SQLERRM);
  END;

  RAISE NOTICE 'apply_retention: %', v_out::text;
  RETURN v_out;
END;
$function$;
REVOKE EXECUTE ON FUNCTION app.apply_retention(boolean) FROM PUBLIC, anon, authenticated, service_role;
-- <<< apply_retention

-- ── 5. Verificări + PostgREST ──────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_table_privilege('anon', 'app.consent_log', 'SELECT') OR has_table_privilege('authenticated', 'app.consent_log', 'SELECT') THEN
    RAISE EXCEPTION 'consent_log: anon/authenticated nu trebuie sa aiba drepturi';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.accept_terms(text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.my_terms_status()', 'EXECUTE') THEN
    RAISE EXCEPTION 'accept_terms / my_terms_status fara EXECUTE pentru authenticated';
  END IF;
  IF has_function_privilege('anon', 'public.accept_terms(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'accept_terms executabil de anon';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'app.apply_retention(boolean)'::regprocedure) NOT LIKE '%consent_log_deleted%' THEN
    RAISE EXCEPTION 'apply_retention: pasul consent_log lipseste';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
