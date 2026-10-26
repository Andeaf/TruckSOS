-- Etapa 9.2.1: Poze în chatul privat — `messages.image_path` + RLS Storage folder `chat/`
-- Rulează în Supabase Studio → SQL Editor
--
-- PLAN_FAZA9.md §2.2: o poză = un mesaj = o bulă (fără tabel de join). Stocăm PATH-ul
-- din bucket-ul privat `photos` (folder `chat/{conversation_id}/{uuid}.jpg`), nu URL-ul.
-- Realtime nu cere schimbări: handler-ul existent pasează `payload.new` integral,
-- deci `image_path` ajunge singur la celălalt participant.
--
-- Non-distructiv: coloană nouă (nullable) + un CHECK care e deja satisfăcut de toate
-- rândurile existente (au `content` nevid).

-- ─── 1. Coloana ─────────────────────────────────────────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_path text;

-- `content` rămâne NOT NULL. Pt. mesaj-imagine punem content = '' + image_path plin.
-- CHECK-ul interzice mesajul complet gol (nici text, nici poză) — R7.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_text_or_image;
ALTER TABLE messages ADD CONSTRAINT messages_text_or_image
  CHECK (content <> '' OR image_path IS NOT NULL);

-- ─── 2. RLS Storage — folder `chat/` ────────────────────────────────────────
-- Path: chat/{conversation_id}/{uuid}.jpg → (storage.foldername(name))[2] = conversation_id.
-- Vizibilitate = participanții conversației (oglindește RLS-ul de pe `messages`).

-- INSERT (upload): doar un participant al conversației.
CREATE POLICY "photos_insert_chat" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = 'chat'
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND (c.driver_id = auth.uid() OR c.mechanic_id = auth.uid())
    )
  );

-- SELECT (citire / URL semnat): tot participanții. Politica asta = controlul de acces
-- la afișare: `createSignedUrl` reușește DOAR dacă ea permite SELECT-ul.
CREATE POLICY "photos_select_chat" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = 'chat'
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND (c.driver_id = auth.uid() OR c.mechanic_id = auth.uid())
    )
  );

-- Fără DELETE pe `chat/`: mesajele din chat nu se șterg (chat permanent, decizie F1).

-- ─── 3. Verificări (manual — R4: acces legitim + acces BLOCAT) ──────────────
-- ACCES LEGITIM:
--   a) Ca participant: upload la `chat/<conv-id>/x.jpg` → OK; createSignedUrl → URL.
--   b) Celălalt participant: createSignedUrl pe aceeași poză → URL.
-- ACCES BLOCAT:
--   c) Ca user din AFARA conversației: upload → refuzat; createSignedUrl → refuzat.
-- CHECK:
--   d) INSERT mesaj cu content='' ȘI image_path NULL → refuzat de messages_text_or_image.
--
-- Politicile pt. folderul `channel/` se adaugă în Etapa 9.2.4.
