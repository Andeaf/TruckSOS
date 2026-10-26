-- Faza 15 — Etapa 15.4: ascunde conturile șterse (piatră-funerară) din căutarea de mecanici.
-- Rulează în Supabase Studio → SQL Editor, după 20260716_faza15_schema.sql.
--
-- Un mecanic șters (deleted_at NOT NULL) NU trebuie să apară în rezultatele de căutare — altfel
-- un șofer ar putea încerca să-l contacteze/favoriteze. Tipul returnat rămâne identic (același
-- apel din client), deci CREATE OR REPLACE e suficient (fără DROP).

CREATE OR REPLACE FUNCTION search_mechanics(p_query text)
RETURNS TABLE (
  id uuid,
  full_name text,
  specialization text,
  activity_zone text,
  rating_avg numeric,
  rating_count integer,
  avatar_path text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT p.id, p.full_name, p.specialization, p.activity_zone,
         p.rating_avg, p.rating_count, p.avatar_path
  FROM profiles p
  WHERE p.role = 'mechanic'
    AND p.deleted_at IS NULL                       -- Faza 15: fără conturi șterse
    AND extensions.unaccent(replace(lower(p.full_name), 'ß', 'ss'))
        LIKE '%' || extensions.unaccent(replace(lower(p_query), 'ß', 'ss')) || '%'
  ORDER BY p.full_name
  LIMIT 30;
$$;

-- ─── Verificare (manual) ────────────────────────────────────────────────────
--   Șterge (purge) un mecanic de test, apoi:  SELECT * FROM search_mechanics('<numele lui>');
--   → NU mai apare.
