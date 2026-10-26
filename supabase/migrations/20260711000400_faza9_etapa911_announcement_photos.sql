-- Etapa 9.1.1: Poze pe anunțuri — tabel `announcement_photos` + RLS
-- Rulează în Supabase Studio → SQL Editor
--
-- PLAN_FAZA9.md §2.1: tabel normalizat (nu array pe announcements) — RLS per rând,
-- ordonare, cascade delete cu anunțul. Stocăm PATH-ul din Storage (bucket `photos`,
-- folder `announcements/`), nu URL-ul. Politicile RLS oglindesc EXACT vizibilitatea
-- anunțului (identic cu politicile de Storage din Etapa 9.0.1) — consistență.
--
-- Non-distructiv: tabel nou; nu atinge nimic existent.

-- ─── 1. Tabel ───────────────────────────────────────────────────────────────
CREATE TABLE announcement_photos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  storage_path    text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcement_photos_ann ON announcement_photos(announcement_id);

ALTER TABLE announcement_photos ENABLE ROW LEVEL SECURITY;

-- ─── 2. RLS ─────────────────────────────────────────────────────────────────
-- SELECT: oglindește vizibilitatea anunțului — șofer-proprietar, mecanic asignat,
-- sau (anunț open ȘI caller mecanic). Identic cu SELECT-ul din announcements.
CREATE POLICY "announcement_photos_select" ON announcement_photos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.id = announcement_photos.announcement_id
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

-- INSERT: doar șoferul-proprietar al anunțului.
CREATE POLICY "announcement_photos_insert" ON announcement_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.id = announcement_photos.announcement_id
        AND a.driver_id = auth.uid()
    )
  );

-- DELETE: doar șoferul-proprietar (pt. „elimină poză").
CREATE POLICY "announcement_photos_delete" ON announcement_photos
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.id = announcement_photos.announcement_id
        AND a.driver_id = auth.uid()
    )
  );

-- Fără UPDATE: rândurile sunt imutabile (poza se șterge + se re-adaugă).

-- ─── 3. Verificări (rulează manual — R4: acces legitim + acces BLOCAT) ───────
-- Pregătire: șofer A cu un anunț `open` + o poză (rând inserat pe announcement_id-ul
-- lui A). Un mecanic M și un al doilea șofer B.
--
-- ACCES LEGITIM (SELECT trebuie să întoarcă rândul):
--   a) Ca șofer A: SELECT * FROM announcement_photos WHERE announcement_id = '<A>';
--   b) Ca mecanic M cât timp anunțul e `open`: același SELECT → vede rândul.
--
-- ACCES BLOCAT (SELECT trebuie să întoarcă 0 rânduri):
--   c) Ca șofer B: SELECT ... WHERE announcement_id = '<A>' → gol.
--   d) Ca mecanic M după ce anunțul devine `resolved`/`cancelled` și M NU e asignat → gol.
--   e) INSERT ca șofer B pe announcement_id-ul lui A → refuzat de WITH CHECK.
--
-- (Se testează complet din aplicație la Etapa 9.1.5, când mecanicul vede pozele.)
