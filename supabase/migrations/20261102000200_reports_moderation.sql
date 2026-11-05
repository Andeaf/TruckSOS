-- Faza 3.3 (PLAN_1.1_FIX #24, partea de server; plan: .claude/wip/faza3/PLAN-faza3.md):
--   1. un raport nou → push către toți administratorii („Raport nou” + motivul), prin coadă (faza 3.1);
--   2. app.moderation_notices: motivarea acțiunilor de moderare către proprietarul conținutului (DSA art. 17),
--      citită în 1.1 prin view-ul public.moderation_notices (ecranul vine în faza 7); push la creare;
--   3. admin_delete_message / announcement / listing / review primesc `p_reason text DEFAULT NULL` (DROP + CREATE:
--      semnătura veche nu se poate schimba cu OR REPLACE); apelurile din 1.0.x fără p_reason se rezolvă la aceeași
--      funcție (NULL). admin_ban_user (are deja p_reason) scrie notice-ul; push-ul la ban nu se poate livra pentru că
--      funcția șterge tokenii (comportament păstrat; vezi planul, punct deschis).
-- Depinde de 20261102000100 (notify_push prin coadă). Clienții 1.0.x: nimic nou de afișat; push-urile noi deschid
-- aplicația (tipuri `report` / `moderation` necunoscute lor → ecranul principal).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('app.push_queue') IS NULL THEN RAISE EXCEPTION 'cere 20261102000100_push_queue'; END IF;
  IF to_regclass('app.moderation_notices') IS NOT NULL THEN RAISE EXCEPTION 'app.moderation_notices exista deja'; END IF;
END $$;

-- ── 1. Textele de push: chei noi (restul neschimbat) ───────────────────────────────────────────────
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
    -- 2 nov 2026 (faza 3.3): rapoarte către admini și motivarea moderării către proprietar (DSA art. 17).
    WHEN 'report_title' THEN
      CASE p_lang WHEN 'en' THEN 'New report'
                  WHEN 'de' THEN 'Neue Meldung'
                  ELSE 'Raport nou' END
    WHEN 'moderation_title' THEN
      CASE p_lang WHEN 'en' THEN 'Moderation notice'
                  WHEN 'de' THEN 'Moderationshinweis'
                  ELSE 'Notificare de moderare' END
    WHEN 'moderation_message_deleted' THEN
      CASE p_lang WHEN 'en' THEN 'A message of yours was removed by a moderator'
                  WHEN 'de' THEN 'Eine deiner Nachrichten wurde von einem Moderator entfernt'
                  ELSE 'Un mesaj al tău a fost șters de un moderator' END
    WHEN 'moderation_announcement_deleted' THEN
      CASE p_lang WHEN 'en' THEN 'Your announcement was removed by a moderator'
                  WHEN 'de' THEN 'Deine Anzeige wurde von einem Moderator entfernt'
                  ELSE 'Anunțul tău a fost șters de un moderator' END
    WHEN 'moderation_listing_deleted' THEN
      CASE p_lang WHEN 'en' THEN 'Your Market listing was removed by a moderator'
                  WHEN 'de' THEN 'Deine Markt-Anzeige wurde von einem Moderator entfernt'
                  ELSE 'Anunțul tău din Market a fost șters de un moderator' END
    WHEN 'moderation_review_deleted' THEN
      CASE p_lang WHEN 'en' THEN 'Your review was removed by a moderator'
                  WHEN 'de' THEN 'Deine Bewertung wurde von einem Moderator entfernt'
                  ELSE 'Recenzia ta a fost ștearsă de un moderator' END
    WHEN 'moderation_banned' THEN
      CASE p_lang WHEN 'en' THEN 'Your account was suspended'
                  WHEN 'de' THEN 'Dein Konto wurde gesperrt'
                  ELSE 'Contul tău a fost suspendat' END
    ELSE ''
  END;
$function$;
-- drepturile de azi, neschimbate (CREATE OR REPLACE le păstrează; repetate pentru convenția check-migrations)
REVOKE ALL ON FUNCTION public.push_text(p_lang text, p_key text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.push_text(p_lang text, p_key text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.push_text(p_lang text, p_key text) TO service_role;

-- ── 2. Notificările de moderare ────────────────────────────────────────────────────────────────────
CREATE TABLE app.moderation_notices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('message_deleted', 'announcement_deleted', 'listing_deleted', 'review_deleted', 'banned')),
  reason      text,
  target_type text,
  target_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
COMMENT ON TABLE app.moderation_notices IS 'Faza 3.3: motivarea acțiunilor de moderare către proprietar (DSA art. 17); citită prin public.moderation_notices.';
CREATE INDEX moderation_notices_user_idx ON app.moderation_notices (user_id, created_at DESC);
ALTER TABLE app.moderation_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY moderation_notices_select_own ON app.moderation_notices FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY moderation_notices_update_own ON app.moderation_notices FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
REVOKE ALL ON TABLE app.moderation_notices FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE (read_at) ON TABLE app.moderation_notices TO authenticated;   -- view-ul security_invoker cere drepturi pe bază
GRANT ALL ON TABLE app.moderation_notices TO service_role;

CREATE VIEW public.moderation_notices WITH (security_invoker = true) AS
  SELECT id, user_id, kind, reason, target_type, target_id, created_at, read_at FROM app.moderation_notices;
REVOKE ALL ON TABLE public.moderation_notices FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE (read_at) ON TABLE public.moderation_notices TO authenticated;
GRANT ALL ON TABLE public.moderation_notices TO service_role;

-- scrie notice-ul și pune push-ul în coadă (verificările obișnuite sunt în notify_push)
CREATE FUNCTION app.notify_moderation(p_user_id uuid, p_kind text, p_reason text, p_target_type text, p_target_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_id   uuid;
  v_lang text;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO app.moderation_notices (user_id, kind, reason, target_type, target_id)
  VALUES (p_user_id, p_kind, NULLIF(btrim(p_reason), ''), p_target_type, p_target_id)
  RETURNING id INTO v_id;
  v_lang := public.user_lang(p_user_id);
  PERFORM public.notify_push(
    p_user_id,
    public.push_text(v_lang, 'moderation_title'),
    public.push_text(v_lang, 'moderation_' || p_kind)
      || CASE WHEN NULLIF(btrim(p_reason), '') IS NOT NULL THEN ': ' || left(btrim(p_reason), 140) ELSE '' END,
    jsonb_build_object('type', 'moderation', 'id', v_id)
  );
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION app.notify_moderation(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Raport nou → adminii ────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.on_report_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin record;
  v_body  text;
BEGIN
  v_body := left(COALESCE(NEW.reason, '') || CASE WHEN NULLIF(btrim(NEW.details), '') IS NOT NULL THEN ': ' || btrim(NEW.details) ELSE '' END, 140);
  FOR v_admin IN
    SELECT p.id, COALESCE(p.lang, 'ro') AS lang
      FROM app.profiles p
     WHERE p.role = 'admin' AND p.deleted_at IS NULL AND p.id <> NEW.reporter_id
  LOOP
    PERFORM public.notify_push(
      v_admin.id,
      public.push_text(v_admin.lang, 'report_title'),
      v_body,
      jsonb_build_object('type', 'report', 'id', NEW.id)
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'on_report_notify: % (raport %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.on_report_notify() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reports_notify_admins AFTER INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.on_report_notify();

-- ── 4. Acțiunile de moderare: p_reason + notice + push către proprietar ────────────────────────────
-- Textele de bază sunt cele din 20261101000100 (admin_ban_user, admin_delete_announcement) și din baseline
-- (admin_delete_listing/message/review); singurele adăugiri sunt p_reason, PERFORM app.notify_moderation și
-- motivul în admin_audit_log.
DROP FUNCTION public.admin_delete_message(text, uuid);
CREATE FUNCTION public.admin_delete_message(p_table text, p_id uuid, p_reason text DEFAULT NULL)
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
                             'had_file', v_old_file IS NOT NULL,
                             'reason', p_reason));
  PERFORM app.notify_moderation(v_sender, 'message_deleted', p_reason, p_table, p_id);
END; $function$;
REVOKE ALL ON FUNCTION public.admin_delete_message(p_table text, p_id uuid, p_reason text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_message(p_table text, p_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_message(p_table text, p_id uuid, p_reason text) TO service_role;

DROP FUNCTION public.admin_delete_announcement(uuid);
CREATE FUNCTION public.admin_delete_announcement(p_id uuid, p_reason text DEFAULT NULL)
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
  VALUES (auth.uid(), 'delete_announcement', 'announcement', p_id, jsonb_build_object('driver_id', v_driver, 'reason', p_reason));
  PERFORM app.notify_moderation(v_driver, 'announcement_deleted', p_reason, 'announcement', p_id);
END; $function$;
REVOKE ALL ON FUNCTION public.admin_delete_announcement(p_id uuid, p_reason text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_announcement(p_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_announcement(p_id uuid, p_reason text) TO service_role;

DROP FUNCTION public.admin_delete_listing(uuid);
CREATE FUNCTION public.admin_delete_listing(p_id uuid, p_reason text DEFAULT NULL)
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
  VALUES (auth.uid(), 'delete_listing', 'listing', p_id, jsonb_build_object('seller_id', v_seller, 'reason', p_reason));
  PERFORM app.notify_moderation(v_seller, 'listing_deleted', p_reason, 'listing', p_id);
END; $function$;
REVOKE ALL ON FUNCTION public.admin_delete_listing(p_id uuid, p_reason text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_listing(p_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_listing(p_id uuid, p_reason text) TO service_role;

DROP FUNCTION public.admin_delete_review(uuid);
CREATE FUNCTION public.admin_delete_review(p_id uuid, p_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_mechanic uuid; v_driver uuid;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT mechanic_id, driver_id INTO v_mechanic, v_driver FROM ratings WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  DELETE FROM ratings WHERE id = p_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_review', 'review', p_id, jsonb_build_object('mechanic_id', v_mechanic, 'driver_id', v_driver, 'reason', p_reason));
  PERFORM app.notify_moderation(v_driver, 'review_deleted', p_reason, 'review', p_id);
END; $function$;
REVOKE ALL ON FUNCTION public.admin_delete_review(p_id uuid, p_reason text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_review(p_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_review(p_id uuid, p_reason text) TO service_role;

-- admin_ban_user: semnătura neschimbată; notice-ul se scrie ÎNAINTE de ban (notify_push ar refuza un cont banat,
-- iar tokenii sunt șterși imediat după — push-ul nu pleacă; notice-ul rămâne pentru ecranul din 1.1).
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

  INSERT INTO app.moderation_notices (user_id, kind, reason, target_type, target_id)
  VALUES (p_uid, 'banned', NULLIF(btrim(p_reason), ''), 'user', p_uid);

  UPDATE app.profiles
     SET banned_at    = now(),
         banned_until = p_until,
         ban_reason   = p_reason
   WHERE id = p_uid;

  DELETE FROM push_tokens WHERE user_id = p_uid;   -- igienă: dispozitivele curente nu mai primesc

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ban_user', 'user', p_uid,
          jsonb_build_object('reason', p_reason, 'until', p_until));
END; $function$;
REVOKE EXECUTE ON FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone) TO service_role;

-- ── 4b. Ștergerea contului curăță și notice-urile (review 2 nov; evidența DSA rămâne în admin_audit_log) ──
-- >>> purge_user_data (generat de gen-purge.mjs)
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
  DELETE FROM app.moderation_notices WHERE user_id  = p_uid;   -- faza 3.3: evidența DSA rămâne în admin_audit_log

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
-- <<< purge_user_data

-- ── 5. Verificări + PostgREST ──────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('admin_delete_message', 'admin_delete_announcement', 'admin_delete_listing', 'admin_delete_review')) <> 4 THEN
    RAISE EXCEPTION 'admin_delete_*: trebuie exact o semnatura per functie (fara overload, PostgREST ar da 300)';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_delete_message(text, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_delete_message fara EXECUTE pentru authenticated';
  END IF;
  IF has_table_privilege('anon', 'public.moderation_notices', 'SELECT') THEN
    RAISE EXCEPTION 'moderation_notices vizibil pentru anon';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reports_notify_admins' AND tgrelid = 'public.reports'::regclass) THEN
    RAISE EXCEPTION 'trigger reports_notify_admins lipsa';
  END IF;
  IF public.push_text('de', 'moderation_banned') = '' OR public.push_text('ro', 'report_title') = '' THEN
    RAISE EXCEPTION 'push_text: cheile noi lipsesc';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
