-- Etapa 13.2a: Mecanici favoriți — tabel `favorite_mechanics` + RLS
-- Rulează în Supabase Studio → SQL Editor
--
-- PLAN_FAZA13.md §2.1. Join-table pur: perechea (șofer, mecanic) E identitatea →
-- cheie primară compusă, fără id surogat (nu referim rândul de nicăieri).
-- Non-distructiv: doar tabel nou + politici noi.

-- ─── 1. Tabelul ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorite_mechanics (
  driver_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mechanic_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, mechanic_id)   -- UNIQUE pe pereche + indexul interogării dominante
);

-- ─── 2. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE favorite_mechanics ENABLE ROW LEVEL SECURITY;

-- Șoferul își vede DOAR propriile favorite. Mecanicii nu văd cine i-a favorit:
-- nu există nicio politică SELECT pe mechanic_id — intenționat.
DROP POLICY IF EXISTS favorites_select_own ON favorite_mechanics;
CREATE POLICY favorites_select_own ON favorite_mechanics
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

-- INSERT: doar pentru sine, și doar către un profil care chiar e mecanic.
DROP POLICY IF EXISTS favorites_insert_own ON favorite_mechanics;
CREATE POLICY favorites_insert_own ON favorite_mechanics
  FOR INSERT TO authenticated
  WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = favorite_mechanics.mechanic_id AND p.role = 'mechanic'
    )
  );

-- DELETE: doar propriile favorite. Fără UPDATE policy — un favorit nu se modifică,
-- doar se adaugă/șterge.
DROP POLICY IF EXISTS favorites_delete_own ON favorite_mechanics;
CREATE POLICY favorites_delete_own ON favorite_mechanics
  FOR DELETE TO authenticated
  USING (driver_id = auth.uid());

-- ─── 3. Verificări (manual, nu fac parte din migrare) ───────────────────────
-- Pregătire: șofer A, șofer B, mecanic M (toate id-uri reale din profiles).
--
-- PERMIS (ca A):
--   a) INSERT INTO favorite_mechanics(driver_id, mechanic_id) VALUES (A, M);  → OK
--   b) SELECT * FROM favorite_mechanics;                                      → doar rândurile lui A
--   c) DELETE FROM favorite_mechanics WHERE mechanic_id = M;                  → OK
-- BLOCAT:
--   d) Ca A: INSERT cu driver_id = B                 → refuzat (driver_id = auth.uid())
--   e) Ca A: INSERT cu mechanic_id = B (șofer!)      → refuzat (role check)
--   f) Ca M (mecanic): SELECT * FROM favorite_mechanics; → 0 rânduri (nu vede cine l-a favorit)
--   g) INSERT duplicat pe aceeași pereche            → eroare de cheie primară (PK compus)
