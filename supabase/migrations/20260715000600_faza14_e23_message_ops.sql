-- Faza 14 Etapele 2+3: ștergere-cu-urmă (tombstone) + editare mesaje
-- Rulează în Supabase Studio → SQL Editor. Rulează ÎNAINTE de faza14_e5_reports.sql.
--
-- Non-distructiv: coloane noi nullable + relaxarea unui CHECK (rămâne satisfăcut de
-- toate rândurile existente). RPC-uri SECURITY DEFINER pentru ștergere/editare, ca
-- regulile (proprietar, fereastra de 3 min) să nu se poată ocoli prin API direct.

-- ─── 1. Coloane noi pe messages ȘI channel_messages ─────────────────────────
ALTER TABLE messages         ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;
ALTER TABLE messages         ADD COLUMN IF NOT EXISTS edited_at   timestamptz;
ALTER TABLE messages         ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS edited_at   timestamptz;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES channel_messages(id) ON DELETE SET NULL;

-- ─── 2. ⚠️ Relaxarea CHECK-ului „text sau imagine" (Faza 9) ──────────────────
-- Tombstone golește content='' ȘI image_path=NULL → ar viola vechiul CHECK.
-- Adăugăm ramura `deleted_at IS NOT NULL`. Rândurile existente (deleted_at NULL,
-- content nevid sau imagine) rămân valide.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_text_or_image;
ALTER TABLE messages ADD CONSTRAINT messages_text_or_image
  CHECK (deleted_at IS NOT NULL OR content <> '' OR image_path IS NOT NULL);

ALTER TABLE channel_messages DROP CONSTRAINT IF EXISTS channel_messages_text_or_image;
ALTER TABLE channel_messages ADD CONSTRAINT channel_messages_text_or_image
  CHECK (deleted_at IS NOT NULL OR content <> '' OR image_path IS NOT NULL);

-- ─── 3. RPC delete_message (tombstone) ──────────────────────────────────────
-- Golește conținutul (decizie §2.3: un utilizator tehnic n-ar mai putea citi textul
-- prin API) și marchează deleted_at. Șterge poza din Storage (sender-scoped, fiindcă
-- RPC-ul a verificat deja proprietarul). NOTĂ: guard-ul „nu șterge dovada unui raport"
-- se adaugă în faza14_e5_reports.sql (când tabela `reports` există) prin CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION delete_message(p_table text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old_path text;
BEGIN
  IF p_table = 'messages' THEN
    SELECT image_path INTO v_old_path FROM messages
      WHERE id = p_id AND sender_id = auth.uid() AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE messages SET content = '', image_path = NULL, deleted_at = now() WHERE id = p_id;
  ELSIF p_table = 'channel_messages' THEN
    SELECT image_path INTO v_old_path FROM channel_messages
      WHERE id = p_id AND sender_id = auth.uid() AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE channel_messages SET content = '', image_path = NULL, deleted_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;

  IF v_old_path IS NOT NULL THEN
    DELETE FROM storage.objects WHERE bucket_id = 'photos' AND name = v_old_path;
  END IF;
END; $$;

-- ─── 4. RPC edit_message (fereastră de 3 minute, server-side) ────────────────
-- Doar text (image_path IS NULL), doar proprietarul, doar în 3 min de la created_at
-- INIȚIAL (nu se resetează la editare — nu atingem created_at). Setează edited_at.
CREATE OR REPLACE FUNCTION edit_message(p_table text, p_id uuid, p_content text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF length(btrim(p_content)) = 0 THEN RAISE EXCEPTION 'empty'; END IF;
  IF p_table = 'messages' THEN
    UPDATE messages SET content = p_content, edited_at = now()
      WHERE id = p_id AND sender_id = auth.uid()
        AND deleted_at IS NULL AND image_path IS NULL
        AND created_at > now() - interval '3 minutes';
  ELSIF p_table = 'channel_messages' THEN
    UPDATE channel_messages SET content = p_content, edited_at = now()
      WHERE id = p_id AND sender_id = auth.uid()
        AND deleted_at IS NULL AND image_path IS NULL
        AND created_at > now() - interval '3 minutes';
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
END; $$;

-- ─── 5. Politica DELETE moartă de pe channel_messages (Faza 6) ───────────────
-- Ștergerea se face acum prin tombstone (UPDATE via RPC), nu prin DELETE de rând.
-- O cale unică e mai curată decât două cu semantici diferite.
DROP POLICY IF EXISTS "channel_messages_delete_own" ON channel_messages;

-- ─── 6. Realtime — UPDATE (tombstone/editare) trebuie să ajungă la ceilalți ──
-- channel_messages e deja REPLICA IDENTITY FULL + în publicație (Faza 6).
-- messages: ne asigurăm de FULL (subscripțiile filtrate + payload-ul de UPDATE îl cer).
ALTER TABLE messages REPLICA IDENTITY FULL;
-- Adăugăm messages în publicație doar dacă nu e deja (idempotent — nu dă eroare la re-rulare).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;

-- ─── Verificări (manual) ────────────────────────────────────────────────────
--   a) delete_message('messages', <id-propriu>)   → bula devine tombstone la ambii.
--   b) delete_message pe mesajul altuia            → EXCEPTION not_allowed.
--   c) edit_message în < 3 min                     → content nou + edited_at.
--   d) edit_message după 3 min / pe poză / al altuia → EXCEPTION not_allowed.
