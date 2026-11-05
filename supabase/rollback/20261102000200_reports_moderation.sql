-- Rollback pentru 20261102000200_reports_moderation (faza 3.3): trigger-ul de rapoarte și notificările de
-- moderare dispar, admin_delete_* revin la semnăturile fără p_reason (textele din baseline / 20261101000100),
-- push_text la cheile de dinainte. Generat de .claude/wip/faza3/gen-rollback-2.mjs; blocurile sunt copiate byte cu byte.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea rollback-urilor: întâi 3.3 (acesta), apoi 3.1.

-- Gardă: _purge_user_data din varianta 3.1 șterge din app.push_queue — dacă 3.1 a fost deja dat înapoi, orice ștergere de cont ar pica.
DO $$
BEGIN
  IF to_regclass('app.push_queue') IS NULL THEN
    RAISE EXCEPTION 'rollback 3.3: app.push_queue nu exista (3.1 a fost dat inapoi inaintea lui 3.3) - ordinea corecta e 3.3 apoi 3.1';
  END IF;
END $$;

DROP TRIGGER IF EXISTS reports_notify_admins ON public.reports;
DROP FUNCTION IF EXISTS public.on_report_notify();

DROP FUNCTION IF EXISTS public.admin_delete_message(text, uuid, text);
DROP FUNCTION IF EXISTS public.admin_delete_announcement(uuid, text);
DROP FUNCTION IF EXISTS public.admin_delete_listing(uuid, text);
DROP FUNCTION IF EXISTS public.admin_delete_review(uuid, text);

CREATE OR REPLACE FUNCTION public.admin_delete_message(p_table text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_old_path text; v_old_file text; v_sender uuid;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  IF p_table = 'messages' THEN
    SELECT image_path, file_path, sender_id INTO v_old_path, v_old_file, v_sender
      FROM messages WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
    UPDATE messages
       SET content = '', image_path = NULL,
           file_path = NULL, file_name = NULL, file_size = NULL,
           deleted_at = now(), deleted_by_admin = true
     WHERE id = p_id;
  ELSIF p_table = 'channel_messages' THEN
    SELECT image_path, file_path, sender_id INTO v_old_path, v_old_file, v_sender
      FROM channel_messages WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
    UPDATE channel_messages
       SET content = '', image_path = NULL,
           file_path = NULL, file_name = NULL, file_size = NULL,
           deleted_at = now(), deleted_by_admin = true
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;

  PERFORM storage_api_delete('photos', v_old_path);
  PERFORM storage_api_delete('photos', v_old_file);

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_message', 'message', p_id,
          jsonb_build_object('table', p_table, 'sender_id', v_sender,
                             'had_image', v_old_path IS NOT NULL,
                             'had_file', v_old_file IS NOT NULL));
END; $function$;
REVOKE ALL ON FUNCTION public.admin_delete_message(p_table text, p_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_message(p_table text, p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_message(p_table text, p_id uuid) TO service_role;

-- public.admin_delete_announcement: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_delete_announcement(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_driver uuid; r record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT driver_id INTO v_driver FROM app.announcements WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  FOR r IN SELECT storage_path FROM announcement_photos WHERE announcement_id = p_id LOOP
    PERFORM storage_api_delete('photos', r.storage_path);
  END LOOP;

  UPDATE applications SET status = 'rejected' WHERE announcement_id = p_id AND status = 'pending';

  DELETE FROM app.announcements WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_announcement', 'announcement', p_id, jsonb_build_object('driver_id', v_driver));
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_delete_announcement(p_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_announcement(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_announcement(p_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_listing(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_seller uuid; r record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT seller_id INTO v_seller FROM market_listings WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  FOR r IN SELECT storage_path FROM market_listing_photos WHERE listing_id = p_id LOOP
    PERFORM storage_api_delete('photos', r.storage_path);
  END LOOP;

  DELETE FROM market_listings WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_listing', 'listing', p_id, jsonb_build_object('seller_id', v_seller));
END; $function$;
REVOKE ALL ON FUNCTION public.admin_delete_listing(p_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_listing(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_listing(p_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_review(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_mechanic uuid;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT mechanic_id INTO v_mechanic FROM ratings WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  DELETE FROM ratings WHERE id = p_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_review', 'review', p_id, jsonb_build_object('mechanic_id', v_mechanic));
END; $function$;
REVOKE ALL ON FUNCTION public.admin_delete_review(p_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_review(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_review(p_id uuid) TO service_role;

-- public.admin_ban_user: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_target_role text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT role INTO v_target_role FROM app.profiles WHERE id = p_uid;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF v_target_role = 'admin' THEN RAISE EXCEPTION 'cannot_ban_admin'; END IF;

  UPDATE app.profiles
     SET banned_at    = now(),
         banned_until = p_until,
         ban_reason   = p_reason
   WHERE id = p_uid;

  DELETE FROM push_tokens WHERE user_id = p_uid;   -- igienÄƒ: dispozitivele curente nu mai primesc

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ban_user', 'user', p_uid,
          jsonb_build_object('reason', p_reason, 'until', p_until));
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION public.push_text(p_lang text, p_key text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_key
    WHEN 'application_title' THEN
      CASE p_lang WHEN 'en' THEN 'New offer'
                  WHEN 'de' THEN 'Neues Angebot'
                  ELSE 'Ofertă nouă' END
    WHEN 'application_body' THEN
      CASE p_lang WHEN 'en' THEN '%s offered to help you'
                  WHEN 'de' THEN '%s bietet dir Hilfe an'
                  ELSE '%s s-a oferit să te ajute' END
    WHEN 'accepted_title' THEN
      CASE p_lang WHEN 'en' THEN 'Offer accepted'
                  WHEN 'de' THEN 'Angebot angenommen'
                  ELSE 'Ofertă acceptată' END
    WHEN 'accepted_body' THEN
      CASE p_lang WHEN 'en' THEN '%s accepted your offer'
                  WHEN 'de' THEN '%s hat dein Angebot angenommen'
                  ELSE '%s ți-a acceptat oferta' END
    WHEN 'announcement_title' THEN
      CASE p_lang WHEN 'en' THEN 'New announcement'
                  WHEN 'de' THEN 'Neue Anzeige'
                  ELSE 'Anunț nou' END
    WHEN 'photo' THEN
      CASE p_lang WHEN 'en' THEN 'Photo'
                  WHEN 'de' THEN 'Foto'
                  ELSE 'Poză' END
    WHEN 'channel_name' THEN
      CASE p_lang WHEN 'en' THEN 'TruckSOS Community'
                  WHEN 'de' THEN 'TruckSOS Gemeinschaft'
                  ELSE 'Comunitate TruckSOS' END
    WHEN 'market_title' THEN
      CASE p_lang WHEN 'en' THEN 'New listing on Market'
                  WHEN 'de' THEN 'Neue Anzeige im Markt'
                  ELSE 'Anunț nou pe Market' END
    -- 27 oct 2026 (1.1): mențiuni și răspunsuri; %s = numele expeditorului.
    WHEN 'mention_title' THEN
      CASE p_lang WHEN 'en' THEN '%s mentioned you'
                  WHEN 'de' THEN '%s hat dich erwähnt'
                  ELSE '%s te-a menționat' END
    WHEN 'reply_title' THEN
      CASE p_lang WHEN 'en' THEN '%s replied to you'
                  WHEN 'de' THEN '%s hat dir geantwortet'
                  ELSE '%s ți-a răspuns' END
    ELSE ''
  END;
$function$;
REVOKE ALL ON FUNCTION public.push_text(p_lang text, p_key text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.push_text(p_lang text, p_key text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.push_text(p_lang text, p_key text) TO service_role;

-- _purge_user_data revine la varianta 3.1 (șterge coada, nu și notice-urile — care dispar odată cu tabelul)
-- public._purge_user_data: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public._purge_user_data(p_uid uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted timestamptz;
  v_paths   text[] := '{}';
  v_avatar  text;
  v_ann     text[];
  v_chat    text[];
  v_chan    text[];
  v_market  text[];
  v_files   text[];
BEGIN
  -- ── Idempotență: dacă profilul nu există sau e deja piatră-funerară, nu facem nimic ──
  SELECT deleted_at INTO v_deleted FROM app.profiles WHERE id = p_uid;
  IF NOT FOUND OR v_deleted IS NOT NULL THEN
    RETURN '{}';
  END IF;

  -- ── PASUL 0: colectăm căile Storage ÎNAINTE de orice DELETE/UPDATE ──
  -- a) avatarul propriu
  SELECT avatar_path INTO v_avatar FROM app.profiles WHERE id = p_uid;
  IF v_avatar IS NOT NULL THEN
    v_paths := v_paths || v_avatar;
  END IF;

  -- b) pozele anunțurilor lui de depanare
  SELECT COALESCE(array_agg(ap.storage_path), '{}')
  INTO v_ann
  FROM announcement_photos ap
  JOIN app.announcements a ON a.id = ap.announcement_id
  WHERE a.driver_id = p_uid;
  v_paths := v_paths || v_ann;

  -- c) pozele lui din chat privat — DOAR cele care NU sunt dovadă într-un raport `pending`
  SELECT COALESCE(array_agg(m.image_path), '{}')
  INTO v_chat
  FROM messages m
  WHERE m.sender_id = p_uid
    AND m.image_path IS NOT NULL
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_chat;

  -- d) pozele lui din canale — același tratament + guard de dovadă
  SELECT COALESCE(array_agg(cm.image_path), '{}')
  INTO v_chan
  FROM channel_messages cm
  WHERE cm.sender_id = p_uid
    AND cm.image_path IS NOT NULL
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_chan;

  -- e) FAZA 19: pozele anunțurilor lui de MARKET (rândurile cascadează cu anunțul,
  --    obiectele Storage nu — identic cu pozele de depanare)
  SELECT COALESCE(array_agg(mp.storage_path), '{}')
  INTO v_market
  FROM market_listing_photos mp
  JOIN market_listings l ON l.id = mp.listing_id
  WHERE l.seller_id = p_uid;
  v_paths := v_paths || v_market;

  -- f) FAZA 19.5: fișierele lui din chat privat + canale (guard de dovadă identic)
  SELECT COALESCE(array_agg(m.file_path), '{}')
  INTO v_files
  FROM messages m
  WHERE m.sender_id = p_uid
    AND m.file_path IS NOT NULL
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_files;

  SELECT COALESCE(array_agg(cm.file_path), '{}')
  INTO v_files
  FROM channel_messages cm
  WHERE cm.sender_id = p_uid
    AND cm.file_path IS NOT NULL
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_files;

  -- ── PASUL 1: tombstone pentru mesajele-poză ȘI mesajele-fișier ale lui ──
  UPDATE messages m
  SET content = '', image_path = NULL,
      file_path = NULL, file_name = NULL, file_size = NULL,
      deleted_at = now()
  WHERE m.sender_id = p_uid
    AND (m.image_path IS NOT NULL OR m.file_path IS NOT NULL)
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );

  UPDATE channel_messages cm
  SET content = '', image_path = NULL,
      file_path = NULL, file_name = NULL, file_size = NULL,
      deleted_at = now()
  WHERE cm.sender_id = p_uid
    AND (cm.image_path IS NOT NULL OR cm.file_path IS NOT NULL)
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );

  -- ── PASUL 2: ȘTERGERI explicite ──
  DELETE FROM app.announcements       WHERE driver_id   = p_uid;
  -- FAZA 19: anunțurile de market (cascade market_listing_photos; conversations.listing_id
  -- → SET NULL — conversațiile SUPRAVIEȚUIESC, ca la anunțurile de depanare; rapoartele pe
  -- anunțuri rămân ANONIMIZATE prin piatra-funerară + snapshot).
  DELETE FROM market_listings     WHERE seller_id   = p_uid;
  DELETE FROM trucks              WHERE driver_id   = p_uid;
  DELETE FROM applications        WHERE mechanic_id = p_uid;
  DELETE FROM ratings             WHERE driver_id   = p_uid;
  DELETE FROM ratings             WHERE mechanic_id = p_uid;
  DELETE FROM favorite_mechanics  WHERE driver_id   = p_uid OR mechanic_id = p_uid;
  DELETE FROM search_history      WHERE driver_id   = p_uid OR mechanic_id = p_uid;
  DELETE FROM message_reads       WHERE user_id     = p_uid;
  DELETE FROM conversation_deletions WHERE user_id  = p_uid;
  DELETE FROM channel_reads       WHERE user_id     = p_uid;
  DELETE FROM push_tokens         WHERE user_id     = p_uid;
  -- Faza 3.1 (review 2 nov): profilul rămâne piatră funerară, deci cascada de pe app.push_queue nu se declanșează;
  -- conținutul push-urilor (titluri/corpuri de mesaje) și biletele (tokeni) se șterg explicit.
  DELETE FROM app.push_queue      WHERE user_id     = p_uid;

  -- ── PASUL 3: scrub PII pe profil → piatră-funerară ──
  -- 25 oct 2026 (A1): + address / vat_number / company_name / contact_email — rămâneau
  -- pe piatra funerară și erau citibile de orice cont logat (profiles_select_all).
  UPDATE app.profiles SET
    full_name      = '',
    avatar_path    = NULL,
    phone          = NULL,
    specialization = NULL,
    activity_zone  = NULL,
    latitude       = NULL,
    longitude      = NULL,
    address        = NULL,
    vat_number     = NULL,
    company_name   = NULL,
    contact_email  = NULL,
    push_enabled   = false,
    deleted_at     = now()
  WHERE id = p_uid;

  RETURN v_paths;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public._purge_user_data(p_uid uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._purge_user_data(p_uid uuid) TO service_role;

DROP FUNCTION IF EXISTS app.notify_moderation(uuid, text, text, text, uuid);
DROP VIEW IF EXISTS public.moderation_notices;
DROP TABLE IF EXISTS app.moderation_notices;

DO $$
BEGIN
  IF to_regclass('app.moderation_notices') IS NOT NULL THEN RAISE EXCEPTION 'rollback: moderation_notices inca exista'; END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('admin_delete_message', 'admin_delete_announcement', 'admin_delete_listing', 'admin_delete_review')) <> 4 THEN
    RAISE EXCEPTION 'rollback: admin_delete_* nu sunt exact 4';
  END IF;
  IF public.push_text('ro', 'report_title') <> '' THEN RAISE EXCEPTION 'rollback: push_text are inca cheile noi'; END IF;
  RAISE NOTICE 'rollback reports_moderation: ok';
END $$;
NOTIFY pgrst, 'reload schema';
