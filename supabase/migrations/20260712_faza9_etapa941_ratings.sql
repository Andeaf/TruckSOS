-- Etapa 9.4.1: Rating mecanici — tabel `ratings` + medie denormalizată + trigger + RLS
-- Rulează în Supabase Studio → SQL Editor
--
-- PLAN_FAZA9.md §4–§5. Reguli de business impuse în DB, nu doar în UI:
--   • un șofer evaluează un mecanic DOAR dacă are cu el un anunț `resolved`;
--   • un singur rating per pereche (șofer, mecanic) — se actualizează prin upsert;
--   • media se ține denormalizat pe `profiles` (rating_avg, rating_count), întreținută
--     de trigger: rating-ul se scrie RAR și se citește DES (listă candidați, căutare,
--     profil mecanic) — clasic caz de denormalizare.
--
-- Review-urile sunt ANONIME în UI (doar stele + comentariu). `driver_id` rămâne în DB
-- pentru UNIQUE + RLS, dar NU se expune niciodată numele șoferului.
--
-- Non-distructiv: tabel nou + 2 coloane noi cu default + funcții/trigger noi.
-- `search_mechanics` se recreează cu 2 coloane în plus (DROP necesar: se schimbă
-- tipul returnat; semnătura apelului rămâne aceeași, deci codul existent nu se rupe).

-- ─── 1. Tabelul ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mechanic_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  driver_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mechanic_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_mechanic ON ratings(mechanic_id);

-- ─── 2. Medie denormalizată pe profiles ─────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS rating_avg   numeric(2,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count integer      NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION recompute_mechanic_rating(p_mechanic uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles p SET
    rating_avg   = coalesce((SELECT round(avg(stars)::numeric, 1) FROM ratings WHERE mechanic_id = p_mechanic), 0),
    rating_count = (SELECT count(*) FROM ratings WHERE mechanic_id = p_mechanic)
  WHERE p.id = p_mechanic;
$$;

CREATE OR REPLACE FUNCTION ratings_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM recompute_mechanic_rating(coalesce(NEW.mechanic_id, OLD.mechanic_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ratings_recompute ON ratings;
CREATE TRIGGER ratings_recompute
  AFTER INSERT OR UPDATE OR DELETE ON ratings
  FOR EACH ROW EXECUTE FUNCTION ratings_after_change();

-- `updated_at` la modificarea unui rating (upsert repetat = UPDATE).
CREATE OR REPLACE FUNCTION ratings_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ratings_set_updated_at ON ratings;
CREATE TRIGGER ratings_set_updated_at
  BEFORE UPDATE ON ratings
  FOR EACH ROW EXECUTE FUNCTION ratings_touch_updated_at();

-- ─── 3. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

-- SELECT: orice utilizator autentificat vede rating-urile (media e publică).
-- Anonimatul se face în UI: query-ul de review-uri NU aduce numele șoferului.
DROP POLICY IF EXISTS ratings_select_all ON ratings;
CREATE POLICY ratings_select_all ON ratings
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- INSERT: doar șoferul, doar dacă are un anunț `resolved` cu acel mecanic.
-- (Ștergerea din istoric e SOFT tocmai ca anunțul să rămână aici — Etapa 9.3.)
DROP POLICY IF EXISTS ratings_insert_own ON ratings;
CREATE POLICY ratings_insert_own ON ratings
  FOR INSERT TO authenticated
  WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.driver_id = auth.uid()
        AND a.mechanic_id = ratings.mechanic_id
        AND a.status = 'resolved'
    )
  );

-- UPDATE: proprietarul rating-ului; condiția `resolved` re-verificată în WITH CHECK.
DROP POLICY IF EXISTS ratings_update_own ON ratings;
CREATE POLICY ratings_update_own ON ratings
  FOR UPDATE TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.driver_id = auth.uid()
        AND a.mechanic_id = ratings.mechanic_id
        AND a.status = 'resolved'
    )
  );

-- DELETE: doar proprietarul (retragerea evaluării).
DROP POLICY IF EXISTS ratings_delete_own ON ratings;
CREATE POLICY ratings_delete_own ON ratings
  FOR DELETE TO authenticated
  USING (driver_id = auth.uid());

-- ─── 4. search_mechanics: + rating_avg, rating_count ────────────────────────
-- DROP necesar: se schimbă tipul returnat (2 coloane în plus). Apelul din client
-- rămâne identic (`p_query`), deci nimic nu se rupe.
DROP FUNCTION IF EXISTS search_mechanics(text);
CREATE FUNCTION search_mechanics(p_query text)
RETURNS TABLE (
  id uuid,
  full_name text,
  specialization text,
  activity_zone text,
  rating_avg numeric,
  rating_count integer
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT p.id, p.full_name, p.specialization, p.activity_zone, p.rating_avg, p.rating_count
  FROM profiles p
  WHERE p.role = 'mechanic'
    AND extensions.unaccent(replace(lower(p.full_name), 'ß', 'ss'))
        LIKE '%' || extensions.unaccent(replace(lower(p_query), 'ß', 'ss')) || '%'
  ORDER BY p.full_name
  LIMIT 30;
$$;

-- ─── 5. Verificări (manual) ─────────────────────────────────────────────────
-- Pregătire: șofer A cu anunț `resolved` având mechanic_id = M; mecanic N fără anunț comun.
--
-- PERMIS:
--   a) Ca A: insert into ratings(mechanic_id, driver_id, stars) values (M, A, 5) → OK.
--   b) Ca A: upsert pe aceeași pereche cu stars=3 → UPDATE, iar profiles.rating_avg(M)
--      devine 3.0, rating_count rămâne 1 (trigger).
-- BLOCAT:
--   c) Ca A: insert cu mechanic_id = N (fără anunț resolved comun) → refuzat de RLS.
--   d) Ca A: insert cu driver_id = alt user → refuzat (driver_id = auth.uid()).
--   e) Ca șofer B: update pe rating-ul lui A → 0 rânduri.
-- MEDIA:
--   f) select rating_avg, rating_count from profiles where id = M; → recalculate de trigger.
