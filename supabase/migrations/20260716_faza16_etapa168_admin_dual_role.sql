-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 16 — Etapa 16.8: Rol dual pentru admin (poate folosi aplicația și ca șofer/mecanic)
-- Rulează în Supabase Studio → SQL Editor. Necesită 16.0 (is_admin()).
-- ─────────────────────────────────────────────────────────────────────────────
-- Politici ADITIVE `is_admin()` — NU modific politicile existente (rămân intacte).
-- Consecință acceptată: în fluxurile de șofer/mecanic adminul apare ca utilizator REAL
-- (numele lui) în anunțuri/candidaturi/chat. DAR rămâne NEdescoperibil ca mecanic:
-- `search_mechanics` filtrează în continuare role='mechanic', deci adminul nu apare în căutare.
--
-- Ce merge DEJA fără relaxare (bazate pe proprietate/participare, fără rol):
--   • upload/ștergere poze pe anunțul propriu (photos_* + announcement_photos_* = driver_id owner)
--   • update/delete anunț propriu, camioane, mesaje (participant), candidatură (mechanic_id=self),
--     acceptarea unei candidaturi (proprietar anunț).
-- Ce NU e acoperit (secundar): start_direct_conversation cere role='driver' — adminul-ca-șofer
--   nu poate INIȚIA un chat direct către un mecanic; dar poate discuta pe fluxul anunț → accept.

-- Feed mecanic + citire anunțuri
DROP POLICY IF EXISTS "announcements_select_admin" ON announcements;
CREATE POLICY "announcements_select_admin" ON announcements
  FOR SELECT USING (is_admin());

-- Postare anunț ca șofer
DROP POLICY IF EXISTS "announcements_insert_admin" ON announcements;
CREATE POLICY "announcements_insert_admin" ON announcements
  FOR INSERT WITH CHECK (driver_id = auth.uid() AND is_admin());

-- Vede pozele anunțurilor din feed (obiecte Storage — bucket privat, altfel URL-ul semnat pică)
DROP POLICY IF EXISTS "photos_select_admin" ON storage.objects;
CREATE POLICY "photos_select_admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'photos' AND is_admin());

-- Vede rândurile din announcement_photos
DROP POLICY IF EXISTS "announcement_photos_select_admin" ON announcement_photos;
CREATE POLICY "announcement_photos_select_admin" ON announcement_photos
  FOR SELECT USING (is_admin());

-- Verificare:
--  Ca admin (din aplicație, „Intră ca mecanic"): feed-ul arată anunțurile open + pozele lor.
--  Ca admin („Intră ca șofer"): poți posta un anunț (cu poze) și îl vezi în lista ta.
--  search_mechanics('...') NU întoarce contul admin (rămâne nedescoperibil ca mecanic).
