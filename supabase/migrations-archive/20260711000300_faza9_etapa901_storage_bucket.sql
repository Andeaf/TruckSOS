-- Etapa 9.0.1: Supabase Storage — bucket privat `photos` + RLS folder `announcements/`
-- Rulează în Supabase Studio → SQL Editor
--
-- Temelia Fazei 9 (PLAN_FAZA9.md §1). Un SINGUR bucket privat `photos` cu foldere:
--   announcements/{announcement_id}/{uuid}.jpg   ← această migrare
--   chat/{conversation_id}/{uuid}.jpg            ← Etapa 9.2
--   channel/{channel_id}/{uuid}.jpg              ← Etapa 9.2.4
-- Bucket PRIVAT: accesul se face prin signed URLs, iar `createSignedUrl` reușește
-- doar dacă RLS-ul de SELECT de mai jos permite. Deci politicile SELECT = controlul
-- de acces la afișare. Stocăm PATH-ul în DB, nu URL-ul.
--
-- Non-distructiv: creează bucket + politici noi pe storage.objects; nu atinge
-- niciun tabel existent. `storage.foldername(name)` întoarce segmentele de folder
-- (fără numele fișierului): pt. `announcements/<id>/<f>.jpg` → {announcements, <id>}.

-- ─── 1. Bucket privat `photos` ──────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('photos', 'photos', false)
ON CONFLICT (id) DO NOTHING;

-- ─── 2. RLS pe storage.objects — folder `announcements/` ────────────────────
-- (RLS e deja activ pe storage.objects în Supabase; adăugăm doar politici.)

-- INSERT (upload): doar șoferul-proprietar al anunțului poate urca poze pe el.
-- Anunțul există deja la momentul upload-ului (întâi inserăm anunțul, apoi pozele).
CREATE POLICY "photos_insert_announcement" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = 'announcements'
    AND EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.id::text = (storage.foldername(name))[2]
        AND a.driver_id = auth.uid()
    )
  );

-- SELECT (citire / URL semnat): oglindește EXACT vizibilitatea din announcements —
-- șoferul-proprietar, mecanicul asignat, sau (anunț open ȘI caller mecanic).
CREATE POLICY "photos_select_announcement" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = 'announcements'
    AND EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.id::text = (storage.foldername(name))[2]
        AND (
          a.driver_id = auth.uid()
          OR a.mechanic_id = auth.uid()
          OR (
            a.status = 'open'
            AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'mechanic')
          )
        )
    )
  );

-- DELETE: doar șoferul-proprietar (pt. „elimină poză" + curățare la ștergere anunț).
CREATE POLICY "photos_delete_announcement" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = 'announcements'
    AND EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.id::text = (storage.foldername(name))[2]
        AND a.driver_id = auth.uid()
    )
  );

-- ─── 3. Verificări (rulează manual — R4: acces legitim + acces BLOCAT) ───────
-- Pregătire: ai nevoie de un anunț `open` al unui șofer A și de un al doilea
-- utilizator (mecanic M și/sau alt șofer B). Testează din aplicație sau din
-- SQL Editor autentificat ca fiecare user.
--
-- ACCES LEGITIM (trebuie să REUȘEASCĂ):
--   a) Ca șofer A: upload la `announcements/<id-anunt-A>/test.jpg` → OK.
--   b) Ca șofer A: createSignedUrl pe acel path → întoarce URL.
--   c) Ca mecanic M (cât timp anunțul e `open`): createSignedUrl → întoarce URL.
--
-- ACCES BLOCAT (trebuie să EȘUEZE / rând 0):
--   d) Ca șofer B (alt șofer): upload pe `announcements/<id-anunt-A>/...` → refuzat.
--   e) Ca șofer B: createSignedUrl pe poza lui A → refuzat (nu e proprietar,
--      nu e mecanic asignat, nu e mecanic pe anunț open).
--   f) Ca mecanic M după ce anunțul devine `cancelled`/`resolved` și M NU e
--      mecanic_id asignat: createSignedUrl → refuzat.
--   g) Ca șofer B: delete pe poza lui A → refuzat.
--
-- Politicile pt. folderele `chat/` și `channel/` se adaugă în Etapa 9.2.
