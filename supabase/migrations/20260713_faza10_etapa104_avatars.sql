-- Etapa 10.4: Poze de profil — `profiles.avatar_path` + RLS Storage `avatars/`
-- Rulează în Supabase Studio → SQL Editor
--
-- Path: `avatars/{user_id}/{uuid}.jpg`. UUID nou la fiecare upload (NU nume fix pe
-- user): cu nume fix, după schimbarea pozei, `expo-image` și URL-ul semnat vechi
-- (TTL 1h) ar servi în continuare poza veche. Path nou = URL nou = zero cache stale.
-- `user_id` rămâne segment de folder, deci RLS-ul îl poate verifica.
--
-- Non-distructiv: coloană nouă, nullable.

-- ─── 1. Coloana ─────────────────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_path text;

-- ─── 2. RLS Storage — folder `avatars/` ─────────────────────────────────────
-- Scriere/ștergere: doar în PROPRIUL folder (al 2-lea segment = auth.uid()).
-- Citire: orice utilizator autentificat (decizie de plan — avatarele sunt publice
-- între useri, altfel nu s-ar vedea în chatul global, unde nu există relație 1-la-1).
--
-- Calificăm `objects.name` explicit, ca la Etapa 9.2.4 (aici nu avem subinterogări
-- pe alte tabele, deci ambiguitatea nu apare — dar păstrăm convenția).

DROP POLICY IF EXISTS "photos_insert_avatar" ON storage.objects;
CREATE POLICY "photos_insert_avatar" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(objects.name))[1] = 'avatars'
    AND (storage.foldername(objects.name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "photos_select_avatar" ON storage.objects;
CREATE POLICY "photos_select_avatar" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(objects.name))[1] = 'avatars'
  );

DROP POLICY IF EXISTS "photos_delete_avatar" ON storage.objects;
CREATE POLICY "photos_delete_avatar" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(objects.name))[1] = 'avatars'
    AND (storage.foldername(objects.name))[2] = auth.uid()::text
  );

-- Fără politică UPDATE: nu facem upsert, path-ul e mereu nou.

-- ─── 3. Verificări (manual) ─────────────────────────────────────────────────
--   a) Îmi urc avatarul din profil → apare imediat; `profiles.avatar_path` e setat.
--   b) Upload pe `avatars/<alt-user-id>/x.jpg` → refuzat (INSERT policy).
--   c) Alt utilizator autentificat vede avatarul meu (SELECT permis).
--   d) Ștergerea avatarului → obiectul dispare din bucket, `avatar_path` devine NULL.
