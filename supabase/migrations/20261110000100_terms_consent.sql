-- Faza 8.2 (PLAN_1.1_FIX #22; plan: .claude/wip/faza8/PLAN-faza8.md, APROBAT de David 9 nov 2026, D8.2 = DA, D8.3 = DA cu C8.2):
-- consimțământul la termeni + confirmarea vârstei (18+), cu dovadă pe server.
--   1. app.profile_terms (un rând per cont: versiunea acceptată, momentul acceptării, momentul confirmării vârstei). Fără rând =
--      „nu a acceptat versiunea curentă” (starea conturilor 1.0.x; la trecerea pe 1.1 utilizatorul acceptă o dată, prin foaia
--      „Termenii s-au actualizat”). Se citește prin RPC-ul my_terms_status().
--      DE CE TABEL SEPARAT ȘI NU COLOANE PE app.profiles (prima variantă, respinsă de CI la poarta 4.1, 10 nov 2026): triggerele
--      INSTEAD OF ale view-ului public.profiles (faza 4) fac `RETURNING * INTO NEW` din app.profiles, deci ORICE coloană nouă pe
--      tabel face ca rândul întors (28 de coloane) să nu mai aibă structura view-ului (25) → toate INSERT-urile și UPDATE-urile
--      prin view pică („returned row structure does not match the structure of the triggering table”) — adică drumul
--      clienților 1.0.x. app.profiles și triggerele lui rămân NEATINSE.
--   2. app.consent_log: fiecare acceptare (uid, versiune, dată, vârstă confirmată, sursă). FĂRĂ FK către profiles / auth.users:
--      dovada supraviețuiește ștergerii contului (D8.2) și se șterge la 3 ani de la acceptare (pas nou în app.apply_retention).
--   3. RPC-uri: accept_terms(p_version, p_source) scrie starea + jurnalul; my_terms_status() întoarce starea proprie.
--   4. apply_retention: pasul 7 (consent_log > 3 ani) și pasul 8 (starea din profile_terms a conturilor șterse — profilul rămâne
--      piatră funerară, deci cascada FK nu se declanșează; dovada rămâne în consent_log). export_my_data: + `terms`, `consent_log`.
-- Clienții 1.0.6–1.0.8: nimic nou (tabele și funcții noi, neapelate; nimic schimbat pe app.profiles).
-- Rollback: supabase/rollback/20261110000100_terms_consent.sql (tabelele și RPC-urile dispar; apply_retention revine la
-- textul fazei 6; DOVEZILE DE ACCEPTARE SE PIERD — export înainte cu SELECT * FROM app.consent_log).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('app.profiles') IS NULL THEN RAISE EXCEPTION 'cere faza 4 (app.profiles)'; END IF;
  IF to_regprocedure('app.apply_retention(boolean)') IS NULL THEN RAISE EXCEPTION 'cere 20261109000500_retention (faza 6)'; END IF;
  IF to_regprocedure('app.rate_limit_ok(text, interval, integer)') IS NULL THEN RAISE EXCEPTION 'cere app.rate_limit_ok'; END IF;
  IF to_regprocedure('public.export_my_data()') IS NULL THEN RAISE EXCEPTION 'cere 20261109000600_export_my_data (faza 6)'; END IF;
  IF to_regclass('app.profile_terms') IS NOT NULL THEN RAISE EXCEPTION 'app.profile_terms exista deja: migrarea a fost aplicata?'; END IF;
  IF to_regclass('app.consent_log') IS NOT NULL THEN RAISE EXCEPTION 'app.consent_log exista deja'; END IF;
END $$;

-- ── 1. Starea consimțământului (un rând per cont; dispare odată cu profilul) ──────────────────────────────────
-- FK-ul către app.profiles ia doar un lock SHARE ROW EXCLUSIVE scurt pe tabelul referit (nu rescrie nimic, nu adaugă coloane).
CREATE TABLE app.profile_terms (
  user_id           uuid PRIMARY KEY REFERENCES app.profiles(id) ON DELETE CASCADE,
  terms_version     text NOT NULL,
  terms_accepted_at timestamptz NOT NULL,
  age_confirmed_at  timestamptz NOT NULL
);
COMMENT ON TABLE app.profile_terms IS 'Faza 8.2: versiunea Termenilor acceptată ultima dată de fiecare cont (ex. 1.1.0), momentul acceptării și al confirmării „am cel puțin 18 ani”. Fără rând = neacceptat (conturile 1.0.x până acceptă în 1.1). Scris doar de accept_terms(). Tabel separat: o coloană nouă pe app.profiles ar rupe triggerele INSTEAD OF ale view-ului public.profiles.';
ALTER TABLE app.profile_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.profile_terms FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE app.profile_terms TO service_role;  -- convenția repo-ului (check-migrations); `app` nu e expusă prin API

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
-- accept_terms: scrie starea (upsert în app.profile_terms) + rândul din jurnal. p_version = versiunea afișată în texte (ex. '1.1.0'); formatul e verificat
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

  IF NOT EXISTS (SELECT 1 FROM app.profiles p WHERE p.id = v_uid AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  INSERT INTO app.profile_terms (user_id, terms_version, terms_accepted_at, age_confirmed_at)
  VALUES (v_uid, p_version, v_now, v_now)
  ON CONFLICT (user_id) DO UPDATE
     SET terms_version     = EXCLUDED.terms_version,
         terms_accepted_at = EXCLUDED.terms_accepted_at,
         age_confirmed_at  = EXCLUDED.age_confirmed_at;

  INSERT INTO app.consent_log (user_id, version, accepted_at, age_confirmed, source)
  VALUES (v_uid, p_version, v_now, true, p_source);

  RETURN jsonb_build_object('terms_version', p_version, 'terms_accepted_at', v_now, 'age_confirmed_at', v_now);
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_terms(p_version text, p_source text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_terms(p_version text, p_source text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_terms(p_version text, p_source text) TO service_role;

-- my_terms_status: starea proprie (citită o dată la pornirea sesiunii). Fără rând (cont 1.0.x sau cont nou, încă fără profil) → NULL-uri.
CREATE FUNCTION public.my_terms_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_build_object('terms_version', t.terms_version, 'terms_accepted_at', t.terms_accepted_at, 'age_confirmed_at', t.age_confirmed_at)
       FROM app.profile_terms t WHERE t.user_id = auth.uid()),
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

  -- 8. starea de consimțământ a conturilor șterse (faza 8.2): profilul rămâne piatră funerară, deci cascada FK a lui
  --    app.profile_terms nu se declanșează; rândul de stare se șterge aici (cel târziu a doua zi), dovada rămâne în
  --    app.consent_log până la 3 ani (D8.2)
  BEGIN
    IF p_dry_run THEN
      SELECT count(*) INTO v_n FROM app.profile_terms t JOIN app.profiles p ON p.id = t.user_id WHERE p.deleted_at IS NOT NULL;
    ELSE
      DELETE FROM app.profile_terms t USING app.profiles p WHERE p.id = t.user_id AND p.deleted_at IS NOT NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    v_out := v_out || jsonb_build_object('deleted_profile_terms', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('deleted_profile_terms_error', SQLERRM);
  END;

  RAISE NOTICE 'apply_retention: %', v_out::text;
  RETURN v_out;
END;
$function$;
REVOKE EXECUTE ON FUNCTION app.apply_retention(boolean) FROM PUBLIC, anon, authenticated, service_role;
-- <<< apply_retention

-- ── 5. Exportul GDPR („Descarcă datele mele”) include consimțământul ──────────────────────────────────────────
-- Textul din 20261109000600 (faza 6.4), neschimbat, + cheile `terms` (starea din app.profile_terms) și `consent_log`
-- (istoricul acceptărilor). Politica promite „un fișier cu toate datele tale”; cu starea într-un tabel separat ea nu mai
-- vine odată cu `profile` (review 10 nov).
-- >>> export_my_data (generat de .claude/wip/faza8/gen-sql.mjs din 20261109000600_export_my_data.sql)
CREATE OR REPLACE FUNCTION public.export_my_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  c_msg_cap constant integer := 10000;
  v_msgs jsonb;
  v_msgs_total bigint;
  v_cmsgs jsonb;
  v_cmsgs_total bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  -- 2 cereri / 24 h (decizia lui David, 9 nov: un răspuns pierdut pe rețea slabă nu trebuie să blocheze o cerere GDPR o zi)
  IF NOT app.rate_limit_ok('export', interval '24 hours', 2) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'export';
  END IF;

  SELECT count(*) INTO v_msgs_total FROM public.messages m WHERE m.sender_id = v_uid;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_msgs
    FROM (SELECT m.id, m.conversation_id, m.content, m.created_at, m.edited_at, m.deleted_at, m.reply_to_id,
                 m.image_path, m.file_path, m.file_name, m.file_size, m.listing_id, m.announcement_id
            FROM public.messages m WHERE m.sender_id = v_uid ORDER BY m.created_at DESC LIMIT c_msg_cap) x;

  SELECT count(*) INTO v_cmsgs_total FROM public.channel_messages cm WHERE cm.sender_id = v_uid;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_cmsgs
    FROM (SELECT cm.id, cm.channel_id, cm.content, cm.created_at, cm.edited_at, cm.deleted_at, cm.reply_to_id,
                 cm.image_path, cm.file_path, cm.file_name, cm.listing_id, cm.announcement_id
            FROM public.channel_messages cm WHERE cm.sender_id = v_uid ORDER BY cm.created_at DESC LIMIT c_msg_cap) x;

  RETURN jsonb_build_object(
    'exported_at', now(),
    'user_id', v_uid,
    'profile', (SELECT to_jsonb(p) FROM app.profiles p WHERE p.id = v_uid),
    -- faza 8.2: starea consimțământului (tabel separat de profil) și istoricul acceptărilor
    'terms', (SELECT to_jsonb(t) - 'user_id' FROM app.profile_terms t WHERE t.user_id = v_uid),
    'consent_log', (SELECT COALESCE(jsonb_agg(jsonb_build_object('version', l.version, 'accepted_at', l.accepted_at,
                             'age_confirmed', l.age_confirmed, 'source', l.source) ORDER BY l.accepted_at), '[]'::jsonb)
                      FROM app.consent_log l WHERE l.user_id = v_uid),
    'trucks', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.trucks t WHERE t.driver_id = v_uid),
    'announcements', (
      SELECT COALESCE(jsonb_agg(
               to_jsonb(a) - 'lat_approx' - 'lng_approx'
               || jsonb_build_object('photos', (SELECT COALESCE(jsonb_agg(ap.storage_path ORDER BY ap.created_at), '[]'::jsonb)
                                                   FROM public.announcement_photos ap WHERE ap.announcement_id = a.id))
               ORDER BY a.created_at), '[]'::jsonb)
        FROM app.announcements a WHERE a.driver_id = v_uid),
    'applications', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ap.id, 'announcement_id', ap.announcement_id, 'price_type', ap.price_type,
               'price_amount', ap.price_amount, 'currency', ap.currency, 'message', ap.message, 'status', ap.status,
               'created_at', ap.created_at, 'updated_at', ap.updated_at) ORDER BY ap.created_at), '[]'::jsonb)
        FROM public.applications ap WHERE ap.mechanic_id = v_uid),
    'market_listings', (
      SELECT COALESCE(jsonb_agg(
               to_jsonb(l) || jsonb_build_object('photos', (SELECT COALESCE(jsonb_agg(mp.storage_path ORDER BY mp.position), '[]'::jsonb)
                                                              FROM public.market_listing_photos mp WHERE mp.listing_id = l.id))
               ORDER BY l.created_at), '[]'::jsonb)
        FROM public.market_listings l WHERE l.seller_id = v_uid),
    'messages_sent', jsonb_build_object('total', v_msgs_total, 'truncated', v_msgs_total > c_msg_cap, 'items', v_msgs),
    'channel_messages_sent', jsonb_build_object('total', v_cmsgs_total, 'truncated', v_cmsgs_total > c_msg_cap, 'items', v_cmsgs),
    'ratings_given', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('mechanic_id', r.mechanic_id, 'stars', r.stars, 'comment', r.comment,
               'created_at', r.created_at, 'updated_at', r.updated_at) ORDER BY r.created_at), '[]'::jsonb)
        FROM public.ratings r WHERE r.driver_id = v_uid),
    'favorite_mechanics', (SELECT COALESCE(jsonb_agg(jsonb_build_object('mechanic_id', f.mechanic_id, 'created_at', f.created_at) ORDER BY f.created_at), '[]'::jsonb)
                             FROM public.favorite_mechanics f WHERE f.driver_id = v_uid),
    'blocked_users', (SELECT COALESCE(jsonb_agg(jsonb_build_object('blocked_id', b.blocked_id, 'created_at', b.created_at) ORDER BY b.created_at), '[]'::jsonb)
                        FROM public.blocked_users b WHERE b.blocker_id = v_uid),
    'search_history', (SELECT COALESCE(jsonb_agg(jsonb_build_object('mechanic_id', s.mechanic_id, 'searched_at', s.searched_at) ORDER BY s.searched_at), '[]'::jsonb)
                         FROM public.search_history s WHERE s.driver_id = v_uid),
    'channel_push_prefs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('channel_id', c.channel_id, 'enabled', c.enabled, 'updated_at', c.updated_at)), '[]'::jsonb)
                             FROM public.channel_push_prefs c WHERE c.user_id = v_uid),
    'moderation_notices', (SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY n.created_at), '[]'::jsonb) FROM app.moderation_notices n WHERE n.user_id = v_uid),
    'push_devices', (SELECT COALESCE(jsonb_agg(jsonb_build_object('platform', pt.platform, 'app_build', pt.app_build, 'updated_at', pt.updated_at)), '[]'::jsonb)
                       FROM public.push_tokens pt WHERE pt.user_id = v_uid)
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.export_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_my_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data() TO service_role;
-- <<< export_my_data

-- ── 6. Verificări + PostgREST ──────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.export_my_data()'::regprocedure) NOT LIKE '%app.profile_terms%' THEN
    RAISE EXCEPTION 'export_my_data: cheile de consimtamant lipsesc';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'app.apply_retention(boolean)'::regprocedure) NOT LIKE '%deleted_profile_terms%' THEN
    RAISE EXCEPTION 'apply_retention: pasul profile_terms lipseste';
  END IF;
  IF has_table_privilege('anon', 'app.consent_log', 'SELECT') OR has_table_privilege('authenticated', 'app.consent_log', 'SELECT') THEN
    RAISE EXCEPTION 'consent_log: anon/authenticated nu trebuie sa aiba drepturi';
  END IF;
  IF has_table_privilege('anon', 'app.profile_terms', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'app.profile_terms', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'profile_terms: anon/authenticated nu trebuie sa aiba drepturi';
  END IF;
  -- Garda lecției din 10 nov: app.profiles trebuie să aibă exact coloanele view-ului public.profiles (triggerele INSTEAD OF
  -- întorc rândul tabelului în structura view-ului).
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'app.profiles'::regclass AND attnum > 0 AND NOT attisdropped)
     <> (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped) THEN
    RAISE EXCEPTION 'app.profiles si view-ul public.profiles nu mai au acelasi numar de coloane: scrierile prin view ar pica';
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
