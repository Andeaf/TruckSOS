-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 17 sept 2026 — „Versiune nouă disponibilă" (recomandare de update în app)
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (IF NOT EXISTS / DROP+CREATE
-- policy / ON CONFLICT DO NOTHING). Fără efect asupra clienților vechi.
--
-- CE FACE: o tabelă cu versiunea LIVE per platformă + linkul de magazin. Aplicația
-- (din 1.0.6) o citește la fiecare deschidere / revenire din fundal, o compară cu
-- versiunea instalată (expo-constants → app.json „version") și, dacă e mai veche,
-- arată un mesaj scurt cu „Mai târziu" și „Actualizează" (→ Play / App Store),
-- cel mult o dată la 24h per dispozitiv (AsyncStorage). Vezi hooks/use-update-prompt.ts.
--
-- LA FIECARE RELEASE, după ce versiunea e efectiv LIVE pe magazinul respectiv
-- (iOS poate întârzia după review — de aceea rânduri separate):
--   UPDATE app_versions SET latest_version = '1.0.6', updated_at = now()
--    WHERE platform IN ('android', 'ios');
-- Valoarea trebuie să fie exact „version" din app.json al build-ului publicat.
-- Comparația e numerică pe segmente („1.0.10" > „1.0.9").
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tabela ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_versions (
  platform       text        PRIMARY KEY CHECK (platform IN ('android', 'ios')),
  latest_version text        NOT NULL CHECK (latest_version ~ '^\d+(\.\d+){1,3}$'),
  store_url      text        NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_versions IS
  'Versiunea live per platformă; aplicația recomandă update-ul dacă e mai veche (17 sept 2026).';

-- ── 2. RLS: citire pentru orice cont logat, scriere doar admin ───────────────
ALTER TABLE app_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_versions_select_authenticated" ON app_versions;
CREATE POLICY "app_versions_select_authenticated" ON app_versions
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Adminul poate actualiza din client (Faza 16: is_admin()); INSERT/DELETE doar din Studio.
DROP POLICY IF EXISTS "app_versions_update_admin" ON app_versions;
CREATE POLICY "app_versions_update_admin" ON app_versions
  FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- ── 3. Valorile de pornire = ce e live ACUM (1.0.5 pe ambele, din 12 sept) ──
INSERT INTO app_versions (platform, latest_version, store_url) VALUES
  ('android', '1.0.5', 'https://play.google.com/store/apps/details?id=com.andeaf.trucksos'),
  ('ios',     '1.0.5', 'https://apps.apple.com/app/trucksos/id6801003473')
ON CONFLICT (platform) DO NOTHING;

-- ── 4. Verificare ────────────────────────────────────────────────────────────
SELECT platform, latest_version, store_url, updated_at FROM app_versions ORDER BY platform;
