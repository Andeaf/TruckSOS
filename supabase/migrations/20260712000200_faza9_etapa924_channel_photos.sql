-- Etapa 9.2.4: Poze în canalul global — `channel_messages.image_path` + RLS Storage `channel/`
-- Rulează în Supabase Studio → SQL Editor
--
-- Simetric cu Etapa 9.2.1 (chat privat), cu o singură diferență de acces: canalele
-- sunt GLOBALE, deci orice utilizator autentificat poate urca și citi poze — exact
-- ca la `channel_messages` (PLAN_CHAT_GLOBAL.md). Path: `channel/{channel_id}/{uuid}.jpg`.
--
-- Non-distructiv: coloană nouă (nullable) + CHECK satisfăcut de rândurile existente.

-- ─── 1. Coloana ─────────────────────────────────────────────────────────────
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS image_path text;

ALTER TABLE channel_messages DROP CONSTRAINT IF EXISTS channel_messages_text_or_image;
ALTER TABLE channel_messages ADD CONSTRAINT channel_messages_text_or_image
  CHECK (content <> '' OR image_path IS NOT NULL);

-- ─── 2. RLS Storage — folder `channel/` ─────────────────────────────────────
-- Canal global: orice authenticated. Verificăm totuși că folderul e `channel` și că
-- al 2-lea segment e un canal REAL — altfel folderul ar deveni un depozit liber
-- în care oricine urcă orice path inventat.
--
-- ATENȚIE la `objects.name`, calificat explicit: `channels` ARE o coloană `name`,
-- iar în interiorul subinterogării un `name` necalificat s-ar lega de EA, nu de
-- path-ul fișierului — politica ar compara id-ul canalului cu numele canalului și
-- ar refuza orice upload, tăcut. (La `chat/` și `announcements/` a mers doar fiindcă
-- `conversations`/`announcements` nu au coloană `name`.)

DROP POLICY IF EXISTS "photos_insert_channel" ON storage.objects;
CREATE POLICY "photos_insert_channel" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(objects.name))[1] = 'channel'
    AND EXISTS (
      SELECT 1 FROM channels c
      WHERE c.id::text = (storage.foldername(objects.name))[2]
    )
  );

DROP POLICY IF EXISTS "photos_select_channel" ON storage.objects;
CREATE POLICY "photos_select_channel" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(objects.name))[1] = 'channel'
    AND EXISTS (
      SELECT 1 FROM channels c
      WHERE c.id::text = (storage.foldername(objects.name))[2]
    )
  );

-- Fără DELETE: mesajele de canal nu se șterg (chat permanent).

-- ─── 3. Verificări (manual) ─────────────────────────────────────────────────
--   a) Ca oricare user autentificat: trimite poză în canal → apare la toți ceilalți.
--   b) Upload pe `channel/<uuid-inexistent>/x.jpg` → refuzat (canalul nu există).
--   c) INSERT mesaj cu content='' ȘI image_path NULL → refuzat de CHECK.
