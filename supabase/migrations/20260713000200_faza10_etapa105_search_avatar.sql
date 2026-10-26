-- Etapa 10.5: `search_mechanics` întoarce și `avatar_path`
-- Rulează în Supabase Studio → SQL Editor
--
-- DROP necesar: se schimbă tipul returnat (o coloană în plus) — exact ca la Etapa 9.4.1,
-- când s-au adăugat rating_avg/rating_count. Apelul din client rămâne identic (`p_query`).
-- Depinde de Etapa 10.4 (coloana `profiles.avatar_path`).

DROP FUNCTION IF EXISTS search_mechanics(text);
CREATE FUNCTION search_mechanics(p_query text)
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
    AND extensions.unaccent(replace(lower(p.full_name), 'ß', 'ss'))
        LIKE '%' || extensions.unaccent(replace(lower(p_query), 'ß', 'ss')) || '%'
  ORDER BY p.full_name
  LIMIT 30;
$$;

-- ─── Verificare (manual) ────────────────────────────────────────────────────
--   SELECT id, full_name, avatar_path FROM search_mechanics('a');
