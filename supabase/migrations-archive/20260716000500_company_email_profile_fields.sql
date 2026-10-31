-- Câmpuri noi de profil (ambele roluri): firma la care lucrează + email de contact.
-- Rulează în Supabase Studio → SQL Editor.
--
-- Ambele sunt PUBLICE (semnal de încredere / metodă de contact), la fel ca
-- specialization / activity_zone: `profiles_select_all` (auth.uid() IS NOT NULL)
-- permite deja citirea oricărui rând, deci NU e nevoie de politici sau RPC noi.
-- (Spre deosebire de `phone`, care rămâne dezvăluit doar prin get_*_phone.)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS company_name  TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

-- Verificare:
-- SELECT company_name, contact_email FROM profiles LIMIT 3;
