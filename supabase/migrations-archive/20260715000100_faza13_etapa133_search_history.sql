-- Etapa 13.3a: Istoric căutări — tabel `search_history` + RLS
-- Rulează în Supabase Studio → SQL Editor
--
-- PLAN_FAZA13.md §2.2. Join-table pur, ca `favorite_mechanics`: PK compus
-- (driver_id, mechanic_id) → dedup impus de DB, nu de client (upsert).
-- Non-distructiv: doar tabel nou + index + politici noi.

-- ─── 1. Tabelul ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_history (
  driver_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mechanic_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  searched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, mechanic_id)   -- dedup pe pereche; al 2-lea tap = UPDATE searched_at
);

-- Interogarea dominantă: „ultimele 10 ale șoferului", ordonate desc după dată.
CREATE INDEX IF NOT EXISTS idx_search_history_recent
  ON search_history (driver_id, searched_at DESC);

-- ─── 2. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE search_history ENABLE ROW LEVEL SECURITY;

-- Șoferul își vede DOAR propriul istoric; mecanicii nu văd cine i-a căutat.
DROP POLICY IF EXISTS history_select_own ON search_history;
CREATE POLICY history_select_own ON search_history
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

DROP POLICY IF EXISTS history_insert_own ON search_history;
CREATE POLICY history_insert_own ON search_history
  FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid());

-- ATENȚIE (R3): upsert-ul supabase-js = INSERT ... ON CONFLICT DO UPDATE →
-- cere și UPDATE policy, altfel al doilea tap pe același mecanic pică TĂCUT pe RLS.
DROP POLICY IF EXISTS history_update_own ON search_history;
CREATE POLICY history_update_own ON search_history
  FOR UPDATE TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

-- DELETE: X-ul de pe intrarea de istoric, fără confirmare.
DROP POLICY IF EXISTS history_delete_own ON search_history;
CREATE POLICY history_delete_own ON search_history
  FOR DELETE TO authenticated
  USING (driver_id = auth.uid());

-- ─── 3. Verificări (manual, nu fac parte din migrare) ───────────────────────
-- Pregătire: șofer A, șofer B, mecanic M (id-uri reale din profiles).
--
-- PERMIS (ca A):
--   a) INSERT INTO search_history(driver_id, mechanic_id) VALUES (A, M);      → OK
--   b) Upsert a 2-a oară pe aceeași pereche (ON CONFLICT DO UPDATE):
--        INSERT INTO search_history(driver_id, mechanic_id) VALUES (A, M)
--        ON CONFLICT (driver_id, mechanic_id) DO UPDATE SET searched_at = now();
--      → tot 1 rând, searched_at actualizat (confirmă UPDATE policy — R3!)
--   c) SELECT * FROM search_history;                                          → doar rândurile lui A
--   d) DELETE FROM search_history WHERE mechanic_id = M;                      → OK
-- BLOCAT:
--   e) Ca A: INSERT cu driver_id = B                  → refuzat (driver_id = auth.uid())
--   f) Ca B: SELECT * FROM search_history;            → nu vede rândurile lui A
