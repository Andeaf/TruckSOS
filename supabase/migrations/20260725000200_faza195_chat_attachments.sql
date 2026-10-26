-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 19.5 — Atașamente în chat: anunț Market / mecanic recomandat / fișier
-- Rulează în Supabase Studio → SQL Editor. Idempotentă.
--
-- Decizii (25 iul): paritate privat + canal global; fișiere max 10 MB (limita e
-- client-side; serverul nu impune — bucketul e privat, doar participanții scriu);
-- storage refolosește folderele EXISTENTE chat/{convId}/ și channel/{channelId}/
-- (politicile de acolo nu discriminează extensia) → ZERO politici Storage noi.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Coloane noi ──────────────────────────────────────────────────────────
-- Mesaj privat: mecanic recomandat + fișier (listing_id există din 19.4).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recommended_mechanic_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_size integer;

-- Mesaj de canal: paritate completă — inclusiv listing_id, care exista doar pe messages.
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES market_listings(id) ON DELETE SET NULL;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS recommended_mechanic_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS file_size integer;

-- ── 2. CHECK anti-mesaj-gol învață și fișierele ─────────────────────────────
-- Formula curentă (faza14_e23): deleted_at IS NOT NULL OR content <> '' OR image_path.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_text_or_image;
ALTER TABLE messages ADD CONSTRAINT messages_text_or_image
  CHECK (deleted_at IS NOT NULL OR content <> '' OR image_path IS NOT NULL OR file_path IS NOT NULL);

ALTER TABLE channel_messages DROP CONSTRAINT IF EXISTS channel_messages_text_or_image;
ALTER TABLE channel_messages ADD CONSTRAINT channel_messages_text_or_image
  CHECK (deleted_at IS NOT NULL OR content <> '' OR image_path IS NOT NULL OR file_path IS NOT NULL);

-- ── 3. delete_message: tombstone golește ȘI fișierul ────────────────────────
-- Corpul = ULTIMA versiune (faza14_e5, cu guard-ul „nu șterge dovada unui raport
-- pending") + colectarea/golirea file_path și ștergerea obiectului din Storage.
CREATE OR REPLACE FUNCTION delete_message(p_table text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_path text;
  v_old_file text;
  v_reported boolean;
BEGIN
  IF p_table = 'messages' THEN
    SELECT image_path, file_path INTO v_old_path, v_old_file FROM messages
      WHERE id = p_id AND sender_id = auth.uid() AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE messages
       SET content = '', image_path = NULL,
           file_path = NULL, file_name = NULL, file_size = NULL,
           deleted_at = now()
     WHERE id = p_id;
  ELSIF p_table = 'channel_messages' THEN
    SELECT image_path, file_path INTO v_old_path, v_old_file FROM channel_messages
      WHERE id = p_id AND sender_id = auth.uid() AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE channel_messages
       SET content = '', image_path = NULL,
           file_path = NULL, file_name = NULL, file_size = NULL,
           deleted_at = now()
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;

  IF v_old_path IS NOT NULL OR v_old_file IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM reports r
      WHERE r.message_id = p_id AND r.message_table = p_table AND r.status = 'pending'
    ) INTO v_reported;
    IF NOT v_reported THEN
      DELETE FROM storage.objects
       WHERE bucket_id = 'photos' AND name IN (v_old_path, v_old_file);
    END IF;
  END IF;
END; $$;

-- ── 4. edit_message: mesajele-fișier NU se editează (ca pozele) ─────────────
CREATE OR REPLACE FUNCTION edit_message(p_table text, p_id uuid, p_content text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF length(btrim(p_content)) = 0 THEN RAISE EXCEPTION 'empty'; END IF;
  IF p_table = 'messages' THEN
    UPDATE messages SET content = p_content, edited_at = now()
      WHERE id = p_id AND sender_id = auth.uid()
        AND deleted_at IS NULL AND image_path IS NULL AND file_path IS NULL
        AND created_at > now() - interval '3 minutes';
  ELSIF p_table = 'channel_messages' THEN
    UPDATE channel_messages SET content = p_content, edited_at = now()
      WHERE id = p_id AND sender_id = auth.uid()
        AND deleted_at IS NULL AND image_path IS NULL AND file_path IS NULL
        AND created_at > now() - interval '3 minutes';
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
END; $$;

-- ── 5. Push: mesajul-fișier arată numele fișierului, nu „Poză" ──────────────
-- Corpul = versiunea din faza12_e124; DOAR compunerea v_body se schimbă.
CREATE OR REPLACE FUNCTION on_message_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_recipient uuid;
  v_sender    text;
  v_lang      text;
  v_body      text;
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

  -- Text → textul; fișier → 📎 numele; poză (fără text) → marcajul „Poză".
  v_body := CASE
    WHEN NEW.content IS NOT NULL AND NEW.content <> '' THEN left(NEW.content, 120)
    WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 118)
    ELSE push_text(v_lang, 'photo')
  END;

  PERFORM notify_push(
    v_recipient,
    COALESCE(v_sender, ''),
    v_body,
    jsonb_build_object('type', 'conversation', 'id', NEW.conversation_id)
  );
  RETURN NEW;
END;
$$;

-- ── 6. Purja Faza 15: fișierele intră în ștergerea contului ─────────────────
-- Corpul = ULTIMA versiune (faza19_e193, cu pasul (e) market); pașii (c)/(d) și
-- tombstone-urile din PASUL 1 acoperă acum și file_path (același guard de dovadă).
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

REVOKE ALL ON FUNCTION _purge_user_data(uuid) FROM public;

-- ── Verificări (manual) ─────────────────────────────────────────────────────
-- a) INSERT mesaj cu content='', fără image_path/file_path  → refuzat de CHECK.
-- b) Mesaj-fișier + delete_message                          → tombstone + obiect șters.
-- c) Mesaj-fișier RAPORTAT (pending) + delete_message       → obiectul RĂMÂNE (dovadă).
-- d) Push la mesaj-fișier                                   → body „📎 nume.pdf".
-- e) SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';
--    (coloanele noi curg singure prin publicația existentă — nimic de făcut)
