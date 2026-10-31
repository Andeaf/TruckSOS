-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 19 — Etapa 19.3: Raportare + moderare + purjă pentru Market
-- Rulează în Supabase Studio → SQL Editor, DUPĂ etapa191 + etapa192. Idempotentă.
-- Cerință App Review: marketul e suprafață UGC → raportabil + moderabil + purjabil.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. reports: a treia formă de țintă — anunț de market (aditiv) ──────────
-- Modelul existent: reported_user_id (mereu) + opțional message_id/message_table.
-- Adăugăm listing_id; snapshot-ul refolosește content_snapshot (titlu+descriere) și
-- image_path_snapshot (cover-ul) — dovada supraviețuiește ștergerii anunțului.
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES market_listings(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_reporter_listing
  ON reports(reporter_id, listing_id) WHERE listing_id IS NOT NULL;

-- ─── 2. admin_list_reports: titlul anunțului la rapoartele de market ────────
-- Return jsonb → CREATE OR REPLACE suficient; câmpuri noi: listing_id, listing_title
-- (LEFT JOIN — NULL pentru rapoartele de mesaj/utilizator; titlul „live", snapshot-ul
-- rămâne dovada dacă anunțul a dispărut).
CREATE OR REPLACE FUNCTION admin_list_reports(p_status text DEFAULT 'pending')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;

-- ─── 3. Moderare: listare + ștergere anunțuri de market (clone etapa 16.6) ──
CREATE OR REPLACE FUNCTION admin_list_recent_listings(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;

-- Șterge obiectele Storage ale pozelor, apoi anunțul (cascade market_listing_photos;
-- conversations.listing_id → SET NULL; reports.listing_id → SET NULL, snapshot rămâne). + audit.
CREATE OR REPLACE FUNCTION admin_delete_listing(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seller uuid; r record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT seller_id INTO v_seller FROM market_listings WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  FOR r IN SELECT storage_path FROM market_listing_photos WHERE listing_id = p_id LOOP
    DELETE FROM storage.objects WHERE bucket_id = 'photos' AND name = r.storage_path;
  END LOOP;

  DELETE FROM market_listings WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_listing', 'listing', p_id, jsonb_build_object('seller_id', v_seller));
END; $$;

-- ─── 4. Purja Faza 15: anunțurile de market intră în ștergerea contului ─────
-- CREATE OR REPLACE pe motorul _purge_user_data — corpul original din 20260716_faza15_purge.sql
-- + pasul (e) de colectare a pozelor de market + DELETE-ul din PASUL 2. Edge Function-ul
-- delete-account rămâne NEATINS (array-ul de căi acoperă și marketul).
CREATE OR REPLACE FUNCTION _purge_user_data(p_uid uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted timestamptz;
  v_paths   text[] := '{}';
  v_avatar  text;
  v_ann     text[];
  v_chat    text[];
  v_chan    text[];
  v_market  text[];
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

  -- ── PASUL 1: tombstone pentru mesajele-poză ale lui ──
  UPDATE messages m
  SET content = '', image_path = NULL, deleted_at = now()
  WHERE m.sender_id = p_uid
    AND m.image_path IS NOT NULL
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );

  UPDATE channel_messages cm
  SET content = '', image_path = NULL, deleted_at = now()
  WHERE cm.sender_id = p_uid
    AND cm.image_path IS NOT NULL
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
  UPDATE profiles SET
    full_name      = '',
    avatar_path    = NULL,
    phone          = NULL,
    specialization = NULL,
    activity_zone  = NULL,
    latitude       = NULL,
    longitude      = NULL,
    push_enabled   = false,
    deleted_at     = now()
  WHERE id = p_uid;

  RETURN v_paths;
END;
$$;

-- Re-aplicăm garanția de acces (CREATE OR REPLACE păstrează grant-urile, dar explicit e gratis).
REVOKE ALL ON FUNCTION _purge_user_data(uuid) FROM public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificări (Studio):
--  a) Raport pe anunț: INSERT reports cu listing_id + reported_user_id=seller → OK;
--     al doilea raport al aceluiași reporter pe același anunț → 23505 (unique).
--  b) admin_list_reports() → rapoartele de market au listing_id + listing_title.
--  c) admin_delete_listing → pozele dispar din Storage, conversațiile rămân
--     (listing_id NULL), raportul rămâne cu snapshot, + linie de audit 'delete_listing'.
--  d) Purjă cont de test cu anunț de market cu poze → căile pozelor apar în array-ul
--     întors, anunțul dispare, conversația de market a cumpărătorului supraviețuiește.
--  e) Toate RPC-urile admin cu JWT normal → not_admin.
-- ─────────────────────────────────────────────────────────────────────────────
