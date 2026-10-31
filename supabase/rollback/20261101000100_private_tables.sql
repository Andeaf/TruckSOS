-- ROLLBACK pentru 20261101000100_private_tables.sql — `BEGIN;` + fișier + `COMMIT;`.
-- Readuce exact starea de dinainte (verificat în CI cu amprenta catalogului, supabase/gate/fingerprint.sql):
-- view-urile și triggerele INSTEAD OF dispar, tabelele se întorc în `public` (OID-urile, politicile, triggerele,
-- FK-urile urmează), grant-ul de tabel pentru anon pe tabelele de bază se scoate și listele de coloane pentru anon
-- se pun la loc (REVOKE pe tabel șterge și drepturile pe coloane), funcțiile revin la textul din producție
-- (29 oct 2026, baseline), get_own_profile() revine pe tipul tabelului, limita revine la versiunea 20261031000200.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('app.profiles') IS NULL OR to_regclass('app.announcements') IS NULL THEN
    RAISE EXCEPTION 'rollback private_tables: app.profiles / app.announcements nu există (migrarea nu e aplicată)';
  END IF;
END $$;

-- 1. View-urile (triggerele INSTEAD OF cad cu ele) și funcțiile lor; get_own_profile pe tipul view-ului.
DROP FUNCTION public.get_own_profile();
DROP VIEW public.announcements;
DROP VIEW public.profiles;
DROP FUNCTION app.profiles_view_insert();
DROP FUNCTION app.profiles_view_update();
DROP FUNCTION app.profiles_view_delete();
DROP FUNCTION app.announcements_view_insert();
DROP FUNCTION app.announcements_view_update();
DROP FUNCTION app.announcements_view_delete();
DROP FUNCTION app.viewer_is_admin();

-- 2. Tabelele înapoi în public.
ALTER TABLE app.profiles SET SCHEMA public;
ALTER TABLE app.announcements SET SCHEMA public;

-- 3. anon: fără SELECT pe tot tabelul; listele de coloane din producție la loc.
REVOKE SELECT ON TABLE public.profiles FROM anon;
REVOKE SELECT ON TABLE public.announcements FROM anon;
GRANT SELECT (id, full_name, role, created_at, specialization, activity_zone, rating_avg, rating_count, avatar_path, company_name)
  ON TABLE public.profiles TO anon;
GRANT SELECT (id, driver_id, description, location, status, created_at, truck_make, truck_model, truck_year, lat_approx, lng_approx)
  ON TABLE public.announcements TO anon;

-- 4. Limita de anunțuri: textul din 20261031000200 (plafon 5, fără flag-ul app.via_view).
CREATE OR REPLACE FUNCTION app.limit_announcements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  -- UPDATE: contează doar redeschiderea (repost_announcement). INSERT: întotdeauna — garda
  -- announcements_guard_client forțează oricum status = 'open' pentru orice INSERT de client.
  IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM 'open' OR OLD.status = 'open') THEN RETURN NEW; END IF;
  -- Cel mult 5 deschise simultan (29 oct 2026; era 3 în 20261031000100).
  IF (SELECT count(*) FROM public.announcements WHERE driver_id = auth.uid() AND status = 'open' AND id <> NEW.id) >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements_open';
  END IF;
  IF NOT app.rate_limit_ok('announcement_day', interval '24 hours', 10)
     OR NOT app.rate_limit_ok('announcement_week', interval '7 days', 30) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements';
  END IF;
  RETURN NEW;
END; $function$;

-- 5. Funcțiile, cu textul exact din producție (CREATE OR REPLACE păstrează ACL-ul).
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
  SELECT deleted_at INTO v_deleted FROM profiles WHERE id = p_uid;
  IF NOT FOUND OR v_deleted IS NOT NULL THEN
    RETURN '{}';
  END IF;

  -- ── PASUL 0: colectăm căile Storage ÎNAINTE de orice DELETE/UPDATE ──
  -- a) avatarul propriu
  SELECT avatar_path INTO v_avatar FROM profiles WHERE id = p_uid;
  IF v_avatar IS NOT NULL THEN
    v_paths := v_paths || v_avatar;
  END IF;

  -- b) pozele anunțurilor lui de depanare
  SELECT COALESCE(array_agg(ap.storage_path), '{}')
  INTO v_ann
  FROM announcement_photos ap
  JOIN announcements a ON a.id = ap.announcement_id
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
  DELETE FROM announcements       WHERE driver_id   = p_uid;
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

  -- ── PASUL 3: scrub PII pe profil → piatră-funerară ──
  -- 25 oct 2026 (A1): + address / vat_number / company_name / contact_email — rămâneau
  -- pe piatra funerară și erau citibile de orice cont logat (profiles_select_all).
  UPDATE profiles SET
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

CREATE OR REPLACE FUNCTION public.accept_announcement(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid;
  v_mechanic_id uuid := auth.uid();
BEGIN
  SELECT driver_id INTO v_driver_id
  FROM announcements
  WHERE id = p_announcement_id AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  IF is_block_between(v_driver_id, v_mechanic_id) THEN
    RAISE EXCEPTION 'Announcement not available';   -- identic — nedetectabil
  END IF;

  UPDATE announcements
  SET status = 'accepted', mechanic_id = v_mechanic_id, updated_at = now()
  WHERE id = p_announcement_id;

  INSERT INTO conversations (announcement_id, driver_id, mechanic_id)
  VALUES (p_announcement_id, v_driver_id, v_mechanic_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.accept_application(p_application_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_announcement_id UUID;
  v_mechanic_id     UUID;
  v_driver_id       UUID;
  v_conv_id         UUID;
BEGIN
  SELECT a.announcement_id, a.mechanic_id, ann.driver_id
  INTO v_announcement_id, v_mechanic_id, v_driver_id
  FROM applications a
  JOIN announcements ann ON ann.id = a.announcement_id
  WHERE a.id = p_application_id
    AND ann.driver_id = auth.uid()
    AND a.status = 'pending'
    AND ann.status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_found_or_unauthorized';
  END IF;

  -- Respinge toate celelalte candidaturi pentru același anunț
  UPDATE applications
  SET status = 'rejected'
  WHERE announcement_id = v_announcement_id
    AND id != p_application_id;

  -- Acceptă candidatura aleasă
  UPDATE applications
  SET status = 'accepted'
  WHERE id = p_application_id;

  -- Actualizează anunțul
  UPDATE announcements
  SET status = 'accepted', mechanic_id = v_mechanic_id, updated_at = now()
  WHERE id = v_announcement_id;

  -- Creează conversația
  INSERT INTO conversations(announcement_id, driver_id, mechanic_id)
  VALUES (v_announcement_id, v_driver_id, v_mechanic_id)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_target_role text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT role INTO v_target_role FROM profiles WHERE id = p_uid;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF v_target_role = 'admin' THEN RAISE EXCEPTION 'cannot_ban_admin'; END IF;

  UPDATE profiles
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

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_build_object(
    'users_total',      (SELECT count(*) FROM profiles WHERE deleted_at IS NULL),
    'users_drivers',    (SELECT count(*) FROM profiles WHERE role = 'driver'   AND deleted_at IS NULL),
    'users_mechanics',  (SELECT count(*) FROM profiles WHERE role = 'mechanic' AND deleted_at IS NULL),
    'users_banned',     (SELECT count(*) FROM profiles WHERE banned_at IS NOT NULL),
    'users_new_7d',     (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '7 days'),
    'users_new_30d',    (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '30 days'),
    'ann_open',         (SELECT count(*) FROM announcements WHERE status = 'open'),
    'ann_accepted',     (SELECT count(*) FROM announcements WHERE status = 'accepted'),
    'ann_resolved',     (SELECT count(*) FROM announcements WHERE status = 'resolved'),
    'ann_cancelled',    (SELECT count(*) FROM announcements WHERE status = 'cancelled'),
    'reports_pending',  (SELECT count(*) FROM reports WHERE status = 'pending'),
    'conversations',    (SELECT count(*) FROM conversations),
    'messages',         (SELECT count(*) FROM messages) + (SELECT count(*) FROM channel_messages)
  ) INTO v;
  RETURN v;
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_announcement(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_driver uuid; r record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT driver_id INTO v_driver FROM announcements WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  FOR r IN SELECT storage_path FROM announcement_photos WHERE announcement_id = p_id LOOP
    PERFORM storage_api_delete('photos', r.storage_path);
  END LOOP;

  UPDATE applications SET status = 'rejected' WHERE announcement_id = p_id AND status = 'pending';

  DELETE FROM announcements WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_announcement', 'announcement', p_id, jsonb_build_object('driver_id', v_driver));
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_list_channel_messages(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT cm.id, cm.content, cm.image_path, cm.deleted_at, cm.deleted_by_admin, cm.created_at,
           cm.sender_id, s.full_name AS sender_name
    FROM channel_messages cm
    LEFT JOIN profiles s ON s.id = cm.sender_id
    ORDER BY cm.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_list_recent_announcements(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT a.id, a.description, a.location, a.status, a.created_at,
           a.driver_id, d.full_name AS driver_name,
           (SELECT count(*) FROM announcement_photos ap WHERE ap.announcement_id = a.id) AS photo_count,
           (SELECT count(*) FROM announcement_views av WHERE av.announcement_id = a.id) AS view_count
    FROM announcements a
    LEFT JOIN profiles d ON d.id = a.driver_id
    ORDER BY a.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_list_recent_listings(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT l.id, l.title, l.description, l.price, l.currency, l.category, l.status,
           l.created_at, l.seller_id, s.full_name AS seller_name,
           (SELECT count(*) FROM market_listing_photos mp WHERE mp.listing_id = l.id) AS photo_count
    FROM market_listings l
    LEFT JOIN profiles s ON s.id = l.seller_id
    ORDER BY l.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_list_recent_reviews(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT r.id, r.stars, r.comment, r.created_at,
           r.mechanic_id, m.full_name AS mechanic_name,
           r.driver_id,   d.full_name AS driver_name
    FROM ratings r
    LEFT JOIN profiles m ON m.id = r.mechanic_id
    LEFT JOIN profiles d ON d.id = r.driver_id
    WHERE r.comment IS NOT NULL AND r.comment <> ''
    ORDER BY r.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_list_reports(p_status text DEFAULT 'pending'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT r.id, r.reason, r.details, r.content_snapshot, r.image_path_snapshot,
           r.message_id, r.message_table, r.status, r.created_at,
           r.listing_id, l.title AS listing_title,
           r.reporter_id, rep.full_name AS reporter_name,
           r.reported_user_id, tgt.full_name AS reported_name, tgt.banned_at AS reported_banned_at
    FROM reports r
    LEFT JOIN profiles rep ON rep.id = r.reporter_id
    LEFT JOIN profiles tgt ON tgt.id = r.reported_user_id
    LEFT JOIN market_listings l ON l.id = r.listing_id
    WHERE (p_status = 'all' OR r.status = p_status)
    ORDER BY r.created_at DESC
    LIMIT 200
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_purge_accounts(p_from timestamp with time zone, p_to timestamp with time zone, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_accounts jsonb;
  v_count integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF NOT p_dry_run THEN
    -- Faza 11 (is_admin cu aal2) activează ștergerea; până atunci funcția nu șterge nimic.
    RAISE EXCEPTION 'purge_disabled_until_phase_11';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '31 days'
     OR p_to > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'bad_interval';
  END IF;
  SELECT count(*), coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'email', c.email,
           'role', c.role,
           'provider', c.provider,
           'created_at', c.created_at,
           'last_sign_in_at', c.last_sign_in_at,
           'email_confirmed', c.email_confirmed,
           'criterion', CASE
             WHEN c.role IS NULL THEN 'fara_profil'
             WHEN NOT c.email_confirmed THEN 'email_neconfirmat'
             WHEN c.last_sign_in_at IS NULL OR c.last_sign_in_at < c.created_at + interval '1 minute' THEN 'nelogat_dupa_inscriere'
             ELSE 'profil_gol_fara_activitate' END
         ) ORDER BY c.created_at), '[]'::jsonb)
    INTO v_count, v_accounts
    FROM (
      SELECT u.id, u.email, u.created_at, u.last_sign_in_at,
             (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
             (SELECT p.role FROM public.profiles p WHERE p.id = u.id) AS role,
             (SELECT string_agg(i.provider, ',') FROM auth.identities i WHERE i.user_id = u.id) AS provider
        FROM auth.users u
       WHERE u.created_at >= p_from AND u.created_at < p_to
         AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id
                            AND (p.role = 'admin' OR p.phone IS NOT NULL OR p.company_name IS NOT NULL OR p.avatar_path IS NOT NULL))
         AND NOT EXISTS (SELECT 1 FROM public.announcements a WHERE a.driver_id = u.id OR a.mechanic_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.sender_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.channel_messages cm WHERE cm.sender_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.applications ap WHERE ap.mechanic_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.driver_id = u.id OR c.mechanic_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.market_listings l WHERE l.seller_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.ratings r WHERE r.driver_id = u.id OR r.mechanic_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.reports rp WHERE rp.reporter_id = u.id OR rp.reported_user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.trucks t WHERE t.driver_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.favorite_mechanics f WHERE f.driver_id = u.id OR f.mechanic_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.push_tokens pt WHERE pt.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.owner_id = u.id::text)
    ) c;
  RETURN jsonb_build_object('dry_run', true, 'count', v_count, 'accounts', v_accounts);
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_search_announcements(p_query text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_q text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  v_q := trim(coalesce(p_query, ''));
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT a.id, a.description, a.location, a.status, a.created_at,
           a.driver_id, d.full_name AS driver_name,
           (SELECT count(*) FROM announcement_photos ap WHERE ap.announcement_id = a.id) AS photo_count,
           (SELECT count(*) FROM announcement_views av WHERE av.announcement_id = a.id) AS view_count
    FROM announcements a
    LEFT JOIN profiles d ON d.id = a.driver_id
    WHERE v_q = ''
       OR a.description  ILIKE '%' || v_q || '%'
       OR a.location     ILIKE '%' || v_q || '%'
       OR a.plate_number ILIKE '%' || v_q || '%'
       OR d.full_name    ILIKE '%' || v_q || '%'
    ORDER BY a.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_search_users(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_q text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  v_q := coalesce(trim(p_query), '');
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.full_name) INTO v FROM (
    SELECT p.id, p.full_name, p.role, p.avatar_path, p.deleted_at,
           p.banned_at, p.banned_until, u.email
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.role <> 'admin'
      AND (v_q = ''
           OR p.full_name ILIKE '%' || v_q || '%'
           OR u.email    ILIKE '%' || v_q || '%')
    LIMIT 50
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_unban_user(p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE profiles SET banned_at = NULL, banned_until = NULL, ban_reason = NULL WHERE id = p_uid;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'unban_user', 'user', p_uid, '{}'::jsonb);
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed text[] := ARRAY[
    'full_name','phone','address','vat_number',
    'specialization','activity_zone','company_name','contact_email'
  ];
  v_bad text;
  v_old jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' OR p_fields = '{}'::jsonb THEN
    RAISE EXCEPTION 'no_fields';
  END IF;

  SELECT k INTO v_bad
  FROM jsonb_object_keys(p_fields) AS k
  WHERE k <> ALL (v_allowed)
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'field_not_allowed: %', v_bad;
  END IF;

  -- Sanity minimal: numele nu poate deveni gol (restul coloanelor sunt nullable).
  IF p_fields ? 'full_name' AND nullif(trim(p_fields->>'full_name'), '') IS NULL THEN
    RAISE EXCEPTION 'full_name_empty';
  END IF;

  -- Valorile VECHI, cu lock pe rând (FOR UPDATE): auditul reflectă exact starea
  -- pe care a suprascris-o ACEST apel, chiar sub apeluri concurente.
  SELECT jsonb_build_object(
    'full_name', full_name, 'phone', phone, 'address', address,
    'vat_number', vat_number, 'specialization', specialization,
    'activity_zone', activity_zone, 'company_name', company_name,
    'contact_email', contact_email
  ) INTO v_old
  FROM profiles WHERE id = p_uid FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;

  -- UPDATE STATIC (fără SQL dinamic — zero risc de injecție prin numele cheilor):
  -- doar cheile PREZENTE în p_fields se modifică; valoare goală/null → coloana devine NULL.
  UPDATE profiles SET
    full_name      = CASE WHEN p_fields ? 'full_name'      THEN trim(p_fields->>'full_name')                ELSE full_name      END,
    phone          = CASE WHEN p_fields ? 'phone'          THEN nullif(trim(p_fields->>'phone'), '')          ELSE phone          END,
    address        = CASE WHEN p_fields ? 'address'        THEN nullif(trim(p_fields->>'address'), '')        ELSE address        END,
    vat_number     = CASE WHEN p_fields ? 'vat_number'     THEN nullif(trim(p_fields->>'vat_number'), '')     ELSE vat_number     END,
    specialization = CASE WHEN p_fields ? 'specialization' THEN nullif(trim(p_fields->>'specialization'), '') ELSE specialization END,
    activity_zone  = CASE WHEN p_fields ? 'activity_zone'  THEN nullif(trim(p_fields->>'activity_zone'), '')  ELSE activity_zone  END,
    company_name   = CASE WHEN p_fields ? 'company_name'   THEN nullif(trim(p_fields->>'company_name'), '')   ELSE company_name   END,
    contact_email  = CASE WHEN p_fields ? 'contact_email'  THEN nullif(trim(p_fields->>'contact_email'), '')  ELSE contact_email  END
  WHERE id = p_uid;

  -- Trasabilitate completă: vechi (doar cheile atinse) + nou.
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'update_profile', 'user', p_uid,
    jsonb_build_object(
      'old', (SELECT jsonb_object_agg(k, v_old -> k) FROM jsonb_object_keys(p_fields) AS k),
      'new', p_fields
    )
  );
END; $function$
;

CREATE OR REPLACE FUNCTION public.admin_user_detail(p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT to_jsonb(d) INTO v FROM (
    SELECT
      p.id, p.full_name, p.role, p.avatar_path, p.specialization, p.activity_zone,
      p.company_name, p.contact_email, p.address, p.vat_number, p.phone,
      p.rating_avg, p.rating_count,
      p.deleted_at, p.banned_at, p.banned_until, p.ban_reason,
      u.email, u.created_at AS registered_at,
      (SELECT count(*) FROM announcements a WHERE a.driver_id = p.id)              AS announcements_count,
      (SELECT count(*) FROM applications ap WHERE ap.mechanic_id = p.id)           AS applications_count,
      (SELECT count(*) FROM reports r WHERE r.reported_user_id = p.id)             AS reports_received,
      (SELECT count(*) FROM reports r WHERE r.reporter_id = p.id)                  AS reports_made
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_uid
  ) d;
  IF v IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  RETURN v;
END; $function$
;

CREATE OR REPLACE FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text DEFAULT 'RON'::text, p_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid;
BEGIN
  SELECT driver_id INTO v_driver_id
  FROM announcements
  WHERE id = p_announcement_id AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'announcement_not_open';
  END IF;

  IF is_block_between(v_driver_id, auth.uid()) THEN
    RAISE EXCEPTION 'announcement_not_open';   -- identic cu cazul de mai sus — nedetectabil
  END IF;

  INSERT INTO applications(announcement_id, mechanic_id, price_type, price_amount, currency, message)
  VALUES (p_announcement_id, auth.uid(), p_price_type, p_price_amount, p_currency, p_message);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.block_user(p_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_target = v_me THEN
    RAISE EXCEPTION 'cannot_block_self';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_target) THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  INSERT INTO blocked_users(blocker_id, blocked_id)
  VALUES (v_me, p_target)
  ON CONFLICT DO NOTHING;          -- idempotent (dublu-tap, retry de rețea)

  -- Auto-reject candidaturi pending între cei doi, SIMETRIC (§1.7.1):
  --   • eu șofer → candidaturile mecanicului blocat la anunțurile mele;
  --   • eu mecanic → propriile candidaturi la anunțurile blocatului.
  -- O respingere e un eveniment banal — nedetectabil ca semnal de blocare.
  UPDATE applications a
  SET status = 'rejected'
  FROM announcements ann
  WHERE a.announcement_id = ann.id
    AND a.status = 'pending'
    AND (
      (ann.driver_id = v_me AND a.mechanic_id = p_target)
      OR (a.mechanic_id = v_me AND ann.driver_id = p_target)
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dismiss_application(p_application_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM applications a
  USING announcements ann
  WHERE a.id = p_application_id
    AND a.mechanic_id = auth.uid()
    AND a.announcement_id = ann.id
    AND (a.status = 'rejected' OR ann.status = 'cancelled');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_dismissable';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_driver_phone(p_driver_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
BEGIN
  IF is_block_between(auth.uid(), p_driver_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_driver_id AND role IN ('driver', 'admin')
  ) THEN
    RETURN NULL;
  END IF;
  SELECT p.phone INTO v_phone
  FROM profiles p
  WHERE p.id = p_driver_id
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE ((c.driver_id = p_driver_id AND c.mechanic_id = auth.uid())
          OR (c.mechanic_id = p_driver_id AND c.driver_id = auth.uid()))
        AND c.listing_id IS NULL                     -- Faza 19: idem
    );
  RETURN v_phone;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_mechanic_phone(p_mechanic_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
BEGIN
  IF is_block_between(auth.uid(), p_mechanic_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_mechanic_id AND role IN ('mechanic', 'admin')
  ) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE ((c.mechanic_id = p_mechanic_id AND c.driver_id = auth.uid())
        OR (c.driver_id = p_mechanic_id AND c.mechanic_id = auth.uid()))
      AND c.listing_id IS NULL                       -- Faza 19: marketul NU deblochează telefonul
  ) THEN
    RETURN NULL;
  END IF;
  SELECT phone INTO v_phone FROM profiles WHERE id = p_mechanic_id;
  RETURN v_phone;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin(p_uid uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_uid AND role = 'admin');
$function$
;

CREATE OR REPLACE FUNCTION public.is_banned(p_uid uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_uid
      AND banned_at IS NOT NULL
      AND (banned_until IS NULL OR banned_until > now())
  );
$function$
;

CREATE OR REPLACE FUNCTION public.notify_mechanics_new_announcement(p_announcement public.announcements)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_mechanic record;
BEGIN
  FOR v_mechanic IN
    SELECT profiles.id, COALESCE(lang, 'ro') AS lang
    FROM profiles
    WHERE role = 'mechanic'
      AND profiles.id <> p_announcement.driver_id
      AND push_enabled
      AND NOT is_block_between(p_announcement.driver_id, profiles.id)   -- Faza 18
      AND (
        notify_radius_km IS NULL
        OR (
          p_announcement.latitude IS NOT NULL AND p_announcement.longitude IS NOT NULL
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND distance_km(latitude, longitude, p_announcement.latitude, p_announcement.longitude)
              <= notify_radius_km
        )
      )
  LOOP
    PERFORM notify_push(
      v_mechanic.id,
      push_text(v_mechanic.lang, 'announcement_title'),
      p_announcement.location,
      jsonb_build_object('type', 'feed', 'id', p_announcement.id)
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb DEFAULT '{}'::jsonb, p_tag text DEFAULT NULL::text, p_ios_title text DEFAULT NULL::text, p_ios_body text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_enabled boolean;
  v_token   record;
  v_payload jsonb;
BEGIN
  -- Comutatorul global din Setări.
  SELECT push_enabled INTO v_enabled FROM profiles WHERE id = p_user_id;
  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  -- Conturile banate nu primesc push (indiferent de preferință) — 18.4b.
  IF is_banned(p_user_id) THEN
    RETURN;
  END IF;

  FOR v_token IN SELECT token, platform FROM push_tokens WHERE user_id = p_user_id LOOP
    IF v_token.platform = 'ios' AND p_tag IS NOT NULL THEN
      -- iPhone, notificare de fir (conversație/canal): o celulă PER MESAJ,
      -- stivuite pe fir prin thread-id, ca WhatsApp. Fără collapseId: pe iOS
      -- înlocuirea re-afișa bannerul cu același conținut la fiecare mesaj.
      -- Fără channelId (câmp doar-Android). Ștergerea din bară la citire rămâne
      -- pe client (dismissThreadNotifications filtrează după data.type/id).
      v_payload := jsonb_build_object(
        'to',       v_token.token,
        'title',    COALESCE(p_ios_title, p_title),
        'body',     COALESCE(p_ios_body,  p_body),
        'data',     p_data,
        'sound',    'default',
        'priority', 'high',
        'threadId', p_tag
      );
    ELSE
      -- Android + tokenuri fără platformă cunoscută (aplicații nemigrate):
      -- comportamentul de până acum.
      v_payload := jsonb_build_object(
        'to',        v_token.token,
        'title',     p_title,
        'body',      p_body,
        'data',      p_data,
        'sound',     'default',
        'channelId', 'default',
        -- FCM „high": livrare imediată și în Doze; fără el Samsung amâna minute.
        'priority',  'high'
      );
      -- `tag` (Android) înlocuiește celula din bară; `collapseId` coalescează în
      -- tranzit și, pe iOS-urile nemigrate, înlocuiește celula.
      IF p_tag IS NOT NULL THEN
        v_payload := v_payload || jsonb_build_object('tag', p_tag, 'collapseId', p_tag);
      END IF;
    END IF;

    PERFORM net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := v_payload
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.on_application_accepted_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_driver_name text;
  v_lang        text;
BEGIN
  SELECT p.full_name INTO v_driver_name
  FROM announcements a
  JOIN profiles p ON p.id = a.driver_id
  WHERE a.id = NEW.announcement_id;

  v_lang := user_lang(NEW.mechanic_id);

  PERFORM notify_push(
    NEW.mechanic_id,
    push_text(v_lang, 'accepted_title'),
    format(push_text(v_lang, 'accepted_body'), COALESCE(v_driver_name, '')),
    jsonb_build_object('type', 'application', 'id', NEW.id)
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.on_application_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_driver   uuid;
  v_mechanic text;
  v_lang     text;
BEGIN
  SELECT driver_id INTO v_driver FROM announcements WHERE id = NEW.announcement_id;
  IF v_driver IS NULL OR v_driver = NEW.mechanic_id THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_mechanic FROM profiles WHERE id = NEW.mechanic_id;
  v_lang := user_lang(v_driver);

  PERFORM notify_push(
    v_driver,
    push_text(v_lang, 'application_title'),
    format(push_text(v_lang, 'application_body'), COALESCE(v_mechanic, '')),
    jsonb_build_object('type', 'announcement', 'id', NEW.announcement_id)
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.on_channel_message_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cooldown constant interval := interval '2 minutes';
  v_rec      record;
  v_addr     record;
  v_sender   text;
  v_lang     text;
  v_cursor   timestamptz;
  v_since    timestamptz;
  v_count    integer;
  v_body     text;
  v_title    text;
  v_line_new text;
  v_short    text;
  v_done     uuid[] := '{}';
BEGIN
  SELECT full_name INTO v_sender FROM profiles WHERE id = NEW.sender_id;

  -- Linia mesajului curent (corpul de pe iOS + plasa de siguranță a digest-ului).
  v_short := COALESCE(
    NULLIF(NEW.content, ''),
    CASE
      WHEN NEW.file_name IS NOT NULL
           AND lower(NEW.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                       THEN '🎥 ' || left(NEW.file_name, 98)
      WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 98)
      WHEN NEW.listing_id IS NOT NULL THEN '🏷️'
      WHEN NEW.recommended_mechanic_id IS NOT NULL THEN '👤'
      WHEN NEW.announcement_id IS NOT NULL THEN '📍'
      ELSE '📷'
    END
  );
  v_line_new := left(COALESCE(v_sender, '?'), 24) || ': ' || v_short;

  -- ── 4a. Adresați: autorul mesajului citat ∪ mențiunile (max 5), imediat, fără pauză ──
  FOR v_addr IN
    SELECT DISTINCT ON (x.user_id) x.user_id, x.kind
      FROM (
        SELECT m.sender_id AS user_id, 'reply'::text AS kind, 0::bigint AS ord
          FROM channel_messages m
         WHERE NEW.reply_to_id IS NOT NULL AND m.id = NEW.reply_to_id
        UNION ALL
        SELECT (t.e->>'id')::uuid, 'mention', t.ord
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(NEW.mentions) = 'array' THEN NEW.mentions ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS t(e, ord)
         WHERE (t.e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) x
      JOIN profiles pr ON pr.id = x.user_id
     WHERE x.user_id <> NEW.sender_id
       AND pr.push_enabled
       AND pr.mention_push_enabled
       AND pr.deleted_at IS NULL
       AND pr.created_at <= NEW.created_at                -- since-join, ca RLS-ul și ca digest-ul
       AND NOT is_block_between(NEW.sender_id, x.user_id)
     ORDER BY x.user_id, x.ord                            -- reply (ord 0) are prioritate la dubluri
     LIMIT 5
  LOOP
    IF NOT direct_push_allowed(v_addr.user_id, NEW.sender_id) THEN
      -- Peste limită: NU-l pierdem; rămâne în digest-ul obișnuit de mai jos.
      CONTINUE;
    END IF;
    v_lang  := user_lang(v_addr.user_id);
    v_title := format(push_text(v_lang, v_addr.kind || '_title'), left(COALESCE(v_sender, '?'), 24));

    PERFORM notify_push(
      v_addr.user_id,
      v_title,
      left(v_short, 140),
      jsonb_build_object('type', 'channel', 'id', NEW.channel_id,
                         'message_id', NEW.id, 'kind', v_addr.kind),
      'mention-' || NEW.channel_id,
      v_title,
      left(v_short, 140)
    );
    -- Digest-ul nu trebuie să-i repete mesajul: cursorul lui de push devine „acum”.
    INSERT INTO channel_push_state (user_id, channel_id, last_pushed_at)
    VALUES (v_addr.user_id, NEW.channel_id, now())
    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_pushed_at = now();
    v_done := v_done || v_addr.user_id;
  END LOOP;

  -- ── 4b. Digest-ul de până acum, pentru restul membrilor ──
  FOR v_rec IN
    SELECT p.user_id, pr.created_at AS joined_at, st.last_pushed_at
    FROM channel_push_prefs p
    JOIN profiles pr ON pr.id = p.user_id
    LEFT JOIN channel_push_state st
           ON st.user_id = p.user_id AND st.channel_id = p.channel_id
    WHERE p.channel_id = NEW.channel_id
      AND p.enabled
      AND p.user_id <> NEW.sender_id
      AND NOT (p.user_id = ANY (v_done))
      AND pr.push_enabled
      AND pr.deleted_at IS NULL
      AND NOT is_block_between(NEW.sender_id, p.user_id)
  LOOP
    SELECT last_read_at INTO v_cursor
      FROM channel_reads
     WHERE channel_id = NEW.channel_id AND user_id = v_rec.user_id;

    IF v_rec.last_pushed_at IS NOT NULL
       AND v_rec.last_pushed_at > now() - v_cooldown
       AND (v_cursor IS NULL OR v_cursor < v_rec.last_pushed_at) THEN
      CONTINUE;
    END IF;

    v_lang := user_lang(v_rec.user_id);

    SELECT count(*) INTO v_count FROM (
      SELECT 1
      FROM channel_messages m
      WHERE m.channel_id = NEW.channel_id
        AND m.sender_id <> v_rec.user_id
        AND m.deleted_at IS NULL
        AND (v_cursor IS NULL OR m.created_at > v_cursor)
        AND m.created_at >= v_rec.joined_at
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      LIMIT 100
    ) c;

    v_since := GREATEST(v_cursor, v_rec.last_pushed_at);

    SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at ASC) INTO v_body
    FROM (
      SELECT m.created_at,
             left(COALESCE(pr.full_name, '?'), 24) || ': ' ||
             CASE
               WHEN m.content IS NOT NULL AND m.content <> '' THEN left(m.content, 100)
               WHEN m.file_name IS NOT NULL
                    AND lower(m.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                                THEN '🎥 ' || left(m.file_name, 98)
               WHEN m.file_name IS NOT NULL THEN '📎 ' || left(m.file_name, 98)
               WHEN m.listing_id IS NOT NULL THEN '🏷️'
               WHEN m.recommended_mechanic_id IS NOT NULL THEN '👤'
               WHEN m.announcement_id IS NOT NULL THEN '📍'
               ELSE '📷'
             END AS line
      FROM channel_messages m
      JOIN profiles pr ON pr.id = m.sender_id
      WHERE m.channel_id = NEW.channel_id
        AND m.sender_id <> v_rec.user_id
        AND m.deleted_at IS NULL
        AND (v_since IS NULL OR m.created_at > v_since)
        AND m.created_at >= v_rec.joined_at
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      ORDER BY m.created_at DESC
      LIMIT 5
    ) sub;

    IF v_body IS NULL THEN
      v_count := GREATEST(v_count, 1);
      v_body  := v_line_new;
    END IF;

    v_title := push_text(v_lang, 'channel_name');
    IF v_count > 1 THEN
      v_title := v_title || ' (' || v_count || ')';
    END IF;

    PERFORM notify_push(
      v_rec.user_id,
      v_title,
      v_body,
      jsonb_build_object('type', 'channel', 'id', NEW.channel_id),
      'channel-' || NEW.channel_id,
      v_title,
      v_line_new
    );

    INSERT INTO channel_push_state (user_id, channel_id, last_pushed_at)
    VALUES (v_rec.user_id, NEW.channel_id, now())
    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_pushed_at = now();
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Regula zero: notificarea nu are voie să blocheze mesajul.
  RAISE WARNING 'on_channel_message_notify: % (mesaj %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.on_market_listing_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user record;
  v_body text;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  v_body := NEW.title || ' · ' || trim_scale(NEW.price)::text || ' ' || NEW.currency;

  FOR v_user IN
    SELECT profiles.id, COALESCE(lang, 'ro') AS lang
    FROM profiles
    WHERE profiles.id <> NEW.seller_id          -- nu te anunți pe tine
      AND deleted_at IS NULL                    -- Faza 15: pietre funerare
      AND push_enabled                          -- comutatorul global din Setări
      AND market_push_enabled                   -- comutatorul de Market (8 sept)
      AND NOT is_block_between(NEW.seller_id, profiles.id)  -- Faza 18
  LOOP
    PERFORM notify_push(
      v_user.id,
      push_text(v_user.lang, 'market_title'),
      v_body,
      jsonb_build_object('type', 'listing', 'id', NEW.id)
    );
  END LOOP;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.on_message_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_recipient uuid;
  v_sender    text;
  v_lang      text;
  v_cursor    timestamptz;
  v_count     integer;
  v_body      text;
  v_title     text;
  v_ios_title text;
  v_line_new  text;
  v_kind      text;
  v_data      jsonb;
BEGIN
  SELECT CASE WHEN c.driver_id = NEW.sender_id THEN c.mechanic_id ELSE c.driver_id END
    INTO v_recipient
  FROM conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_recipient IS NULL OR v_recipient = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_sender FROM profiles WHERE id = NEW.sender_id;
  v_lang := user_lang(v_recipient);

  v_line_new := CASE
    WHEN NEW.content IS NOT NULL AND NEW.content <> '' THEN left(NEW.content, 120)
    WHEN NEW.file_name IS NOT NULL
         AND lower(NEW.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                     THEN '🎥 ' || left(NEW.file_name, 118)
    WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 118)
    WHEN NEW.listing_id IS NOT NULL THEN '🏷️'
    WHEN NEW.recommended_mechanic_id IS NOT NULL THEN '👤'
    WHEN NEW.announcement_id IS NOT NULL THEN '📍'
    ELSE push_text(v_lang, 'photo')
  END;

  SELECT last_read_at INTO v_cursor
    FROM message_reads
   WHERE conversation_id = NEW.conversation_id AND user_id = v_recipient;

  SELECT count(*) INTO v_count
    FROM messages m
   WHERE m.conversation_id = NEW.conversation_id
     AND m.sender_id = NEW.sender_id
     AND m.deleted_at IS NULL
     AND (v_cursor IS NULL OR m.created_at > v_cursor);

  SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at ASC) INTO v_body
  FROM (
    SELECT m.created_at,
           CASE
             WHEN m.content IS NOT NULL AND m.content <> '' THEN left(m.content, 120)
             WHEN m.file_name IS NOT NULL
                  AND lower(m.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                              THEN '🎥 ' || left(m.file_name, 118)
             WHEN m.file_name IS NOT NULL THEN '📎 ' || left(m.file_name, 118)
             WHEN m.listing_id IS NOT NULL THEN '🏷️'
             WHEN m.recommended_mechanic_id IS NOT NULL THEN '👤'
             WHEN m.announcement_id IS NOT NULL THEN '📍'
             ELSE push_text(v_lang, 'photo')
           END AS line
    FROM messages m
    WHERE m.conversation_id = NEW.conversation_id
      AND m.sender_id = NEW.sender_id
      AND m.deleted_at IS NULL
      AND (v_cursor IS NULL OR m.created_at > v_cursor)
    ORDER BY m.created_at DESC
    LIMIT 5
  ) sub;

  IF v_body IS NULL THEN
    v_count := 1;
    v_body  := v_line_new;
  END IF;

  -- 27 oct 2026: mesajul e reply la destinatar sau îl menționează → titlu explicit.
  v_kind := NULL;
  IF NEW.reply_to_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM messages q WHERE q.id = NEW.reply_to_id AND q.sender_id = v_recipient) THEN
    v_kind := 'reply';
  ELSIF jsonb_typeof(NEW.mentions) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mentions) e WHERE e->>'id' = v_recipient::text) THEN
    v_kind := 'mention';
  END IF;

  v_data := jsonb_build_object('type', 'conversation', 'id', NEW.conversation_id);
  IF v_kind IS NOT NULL THEN
    v_title     := format(push_text(v_lang, v_kind || '_title'), left(COALESCE(v_sender, ''), 24));
    v_ios_title := v_title;
    v_data      := v_data || jsonb_build_object('message_id', NEW.id, 'kind', v_kind);
  ELSE
    v_title := COALESCE(v_sender, '');
    IF v_count > 1 THEN
      v_title := v_title || ' (' || v_count || ')';
    END IF;
    v_ios_title := COALESCE(v_sender, '');
  END IF;

  PERFORM notify_push(
    v_recipient,
    v_title,
    v_body,
    v_data,
    'conversation-' || NEW.conversation_id,
    v_ios_title,
    v_line_new
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'on_message_notify: % (mesaj %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_mechanic_rating(p_mechanic uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE profiles p SET
    rating_avg   = coalesce((SELECT round(avg(stars)::numeric, 1) FROM ratings WHERE mechanic_id = p_mechanic), 0),
    rating_count = (SELECT count(*) FROM ratings WHERE mechanic_id = p_mechanic)
  WHERE p.id = p_mechanic;
$function$
;

CREATE OR REPLACE FUNCTION public.record_announcement_view(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR is_admin() THEN RETURN; END IF;
  INSERT INTO announcement_views (announcement_id, viewer_id)
  SELECT a.id, auth.uid()
    FROM announcements a
   WHERE a.id = p_announcement_id
     AND a.driver_id IS DISTINCT FROM auth.uid()
  ON CONFLICT DO NOTHING;
END; $function$
;

CREATE OR REPLACE FUNCTION public.reject_application(p_application_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE applications
  SET status = 'rejected'
  WHERE id = p_application_id
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM announcements ann
      JOIN applications a ON a.announcement_id = ann.id
      WHERE a.id = p_application_id
        AND ann.driver_id = auth.uid()
        AND ann.status = 'open'
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.repost_announcement(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row announcements;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE announcements
     SET status = 'open',
         created_at = now()
   WHERE id = p_announcement_id
     AND driver_id = auth.uid()
     AND status = 'cancelled'
     AND created_at < now() - interval '30 hours'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  PERFORM notify_mechanics_new_announcement(v_row);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_open_announcement(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE announcements
     SET status = 'resolved'
   WHERE id = p_announcement_id
     AND driver_id = auth.uid()
     AND status IN ('open', 'cancelled');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  UPDATE applications
     SET status = 'rejected'
   WHERE announcement_id = p_announcement_id
     AND status = 'pending';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resubmit_application(p_application_id uuid, p_price_type text, p_price_amount numeric, p_currency text DEFAULT 'RON'::text, p_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE applications a
  SET status       = 'pending',
      price_type   = p_price_type,
      price_amount = p_price_amount,
      currency     = p_currency,
      message      = p_message
  FROM announcements ann
  WHERE a.id              = p_application_id
    AND a.mechanic_id     = auth.uid()
    AND a.status          = 'rejected'
    AND a.announcement_id = ann.id
    AND ann.status        = 'open'
    AND NOT is_block_between(a.mechanic_id, ann.driver_id);   -- Faza 18: perechea blocată nu recandidează
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_resubmittable';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_mechanics(p_query text)
 RETURNS TABLE(id uuid, full_name text, specialization text, activity_zone text, rating_avg numeric, rating_count integer, avatar_path text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p.id, p.full_name, p.specialization, p.activity_zone,
         p.rating_avg, p.rating_count, p.avatar_path
  FROM profiles p
  WHERE p.role = 'mechanic'
    AND p.deleted_at IS NULL
    AND NOT is_block_between(p.id, auth.uid())
    AND app.search_norm(p.full_name) LIKE '%' || app.like_escape(app.search_norm(p_query)) || '%' ESCAPE '\'
  ORDER BY p.full_name
  LIMIT 30;
$function$
;

CREATE OR REPLACE FUNCTION public.search_users(p_query text)
 RETURNS TABLE(id uuid, full_name text, role text, specialization text, activity_zone text, rating_avg numeric, rating_count integer, avatar_path text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p.id, p.full_name, p.role::text, p.specialization, p.activity_zone,
         p.rating_avg, p.rating_count, p.avatar_path
  FROM profiles p
  WHERE p.role IN ('driver', 'mechanic')
    AND p.deleted_at IS NULL
    AND p.id <> auth.uid()
    AND NOT is_block_between(p.id, auth.uid())
    AND app.search_norm(p.full_name) LIKE '%' || app.like_escape(app.search_norm(p_query)) || '%' ESCAPE '\'
  ORDER BY p.full_name
  LIMIT 30;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_channel_push_prefs_for_channel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO channel_push_prefs (user_id, channel_id, enabled)
  SELECT p.id, NEW.id, true FROM profiles p WHERE p.deleted_at IS NULL
  ON CONFLICT (user_id, channel_id) DO NOTHING;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_announcements_hidden(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE announcements a
     SET hidden_from_history = true
   WHERE a.driver_id = auth.uid()
     AND a.hidden_from_history = false
     AND (p_ids IS NULL OR a.id = ANY(p_ids));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.start_direct_conversation(p_mechanic_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_conv   uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_mechanic_id = v_caller THEN
    RAISE EXCEPTION 'cannot_contact_self';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_mechanic_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'target_not_mechanic';
  END IF;

  IF is_blocked_by(v_caller, p_mechanic_id) THEN
    RAISE EXCEPTION 'blocked_by_you';
  END IF;
  IF is_blocked_by(p_mechanic_id, v_caller) THEN
    RAISE EXCEPTION 'target_not_mechanic';   -- identic cu inexistent — nedetectabil
  END IF;

  SELECT id INTO v_conv
  FROM conversations
  WHERE is_direct
    AND ((driver_id = v_caller AND mechanic_id = p_mechanic_id)
      OR (driver_id = p_mechanic_id AND mechanic_id = v_caller))
  LIMIT 1;

  IF NOT FOUND THEN
    -- Trigger-ul ban_guard_ins de pe conversations se aplică și aici.
    INSERT INTO conversations (announcement_id, driver_id, mechanic_id, is_direct)
    VALUES (NULL, v_caller, p_mechanic_id, true)
    RETURNING id INTO v_conv;
  END IF;

  DELETE FROM conversation_deletions
  WHERE conversation_id = v_conv AND user_id = v_caller;

  RETURN v_conv;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.user_lang(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ SELECT COALESCE(lang, 'ro') FROM public.profiles WHERE id = p_user_id; $function$
;

-- 6. get_own_profile() pe tipul tabelului, cu ACL-ul din producție.
CREATE FUNCTION public.get_own_profile()
 RETURNS SETOF public.profiles
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.* FROM public.profiles p WHERE p.id = auth.uid();
$function$;
REVOKE EXECUTE ON FUNCTION public.get_own_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_own_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_own_profile() TO service_role;

NOTIFY pgrst, 'reload schema';

SELECT 'rollback private_tables: tabele în public = ' || (SELECT count(*) FROM pg_class WHERE oid IN ('public.profiles'::regclass, 'public.announcements'::regclass) AND relkind = 'r')
       || ', view-uri rămase în app = ' || (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relname IN ('profiles', 'announcements')) AS verificare;
