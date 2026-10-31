-- Etapa 7.3a: Căutare mecanici — extensia unaccent + RPC search_mechanics
-- Rulează în Supabase Studio → SQL Editor
-- Nu modifică nimic din schema existentă (doar extensie + funcție nouă)

-- ─── 1. Extensia unaccent ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ─── 2. RPC search_mechanics ─────────────────────────────────────────────────
-- SECURITY INVOKER: rulează sub RLS-ul apelantului (profiles_select_all permite
-- deja SELECT pe orice profil pentru orice user autentificat).
-- Insensibil la majuscule (lower) și diacritice (unaccent), pe ambele părți:
-- „stefan" găsește „Ștefan", iar „Ștefan" tastat cu diacritice găsește „Stefan".
CREATE OR REPLACE FUNCTION search_mechanics(p_query text)
RETURNS TABLE (id uuid, full_name text, specialization text, activity_zone text)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT p.id, p.full_name, p.specialization, p.activity_zone
  FROM profiles p
  WHERE p.role = 'mechanic'
    AND extensions.unaccent(replace(lower(p.full_name), 'ß', 'ss'))
        LIKE '%' || extensions.unaccent(replace(lower(p_query), 'ß', 'ss')) || '%'
  ORDER BY p.full_name
  LIMIT 30;
$$;

-- ─── 3. Verificări (rulează manual, nu fac parte din migrare) ───────────────
-- a) Diacritice românești (așteptat: 't'):
--      SELECT extensions.unaccent('ț');
-- b) ß german — regula default diferă între versiuni de Postgres; replace()-ul
--    din funcție acoperă cazul indiferent de rezultat. Verificare informativă:
--      SELECT extensions.unaccent('Groß');
-- c) Căutare completă (după ce există un profil de mecanic cu diacritice):
--      SELECT * FROM search_mechanics('stefan');
