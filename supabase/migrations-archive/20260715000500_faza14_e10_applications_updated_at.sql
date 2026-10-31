-- Faza 14 Etapa 10: applications.updated_at pentru bulina de „Candidaturi"
-- Rulează în Supabase Studio → SQL Editor.
--
-- Bulina de pe tab-ul Candidaturi se aprinde când s-a schimbat ceva de la ultima vizită
-- (acceptată/respinsă). Ne trebuie un timestamp de modificare pe applications. Aditiv:
-- coloană NOT NULL DEFAULT now() (rândurile existente primesc `now()` la migrare) + trigger
-- care o bumpează la orice UPDATE. RPC-urile existente (accept/reject/dismiss/resubmit)
-- fac UPDATE pe applications → trigger-ul se declanșează singur, fără să le atingem.

ALTER TABLE applications ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_applications_updated_at ON applications;
CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Verificare (manual) ────────────────────────────────────────────────────
--   accept_application(<id>) apoi SELECT updated_at → mai nou decât created_at.
