-- ============================================================================
-- Migrare 5 aug 2026 — Serie șasiu + postare anunțuri pentru mecanici
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (re-rulabilă).
-- ============================================================================

-- ── 1. Seria de șasiu (VIN) ────────────────────────────────────────────────
-- Nullable: rândurile istorice rămân NULL; obligativitatea e client-side la
-- anunțuri NOI (același tipar ca plate_number — Faza 7.4/7.5). Fără CHECK de
-- format (seriile diferă între producători/ani); normalizare (uppercase+trim)
-- doar client-side. Fără schimbare de RLS: coloana e vizibilă oriunde e
-- vizibil anunțul/camionul.
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS chassis_number text;
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS chassis_number text;

-- ── 2. Mecanicii pot posta anunțuri ────────────────────────────────────────
-- Politică ADITIVĂ (cea de driver, announcements_insert_driver, rămâne
-- neatinsă — stilul Faza 16.8). Restul lanțului e deja pe bază de PROPRIETAR,
-- nu de rol, deci funcționează neschimbat:
--   • accept_application / accept_announcement: ann.driver_id = auth.uid();
--   • pozele anunțului (9.0.1 / 9.1.1): a.driver_id = auth.uid();
--   • ratings (9.4.1): driver_id = proprietarul anunțului, indiferent de rol;
--   • conversațiile same-role (19.6): driver_id = inițiator, mechanic_id =
--     destinatar, fără garanție de rol;
--   • push on_announcement_notify: exclude autorul și notifică doar mecanicii
--     din rază — corect și pentru anunțurile postate de mecanici.
DROP POLICY IF EXISTS "announcements_insert_mechanic" ON announcements;
CREATE POLICY "announcements_insert_mechanic" ON announcements
  FOR INSERT WITH CHECK (
    driver_id = auth.uid() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'mechanic')
  );

-- ── 3. Verificare (toate trebuie să întoarcă 1) ────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'announcements' AND column_name = 'chassis_number') AS ann_chassis,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'trucks' AND column_name = 'chassis_number') AS trucks_chassis,
  (SELECT count(*) FROM pg_policies
    WHERE tablename = 'announcements' AND policyname = 'announcements_insert_mechanic') AS policy_mechanic;
