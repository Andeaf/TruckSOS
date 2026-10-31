-- Etapa 8.1: Coordonate GPS opționale pe anunțuri
-- Rulează în Supabase Studio → SQL Editor
-- Non-distructiv: coloane nullable, anunțurile existente rămân cu NULL și
-- trec ambele CHECK-uri prin ramura `IS NULL`. Zero migrare de date.
-- Fără schimbare de RLS: coordonatele sunt vizibile oriunde e vizibil anunțul
-- (decizie aprobată în PLAN_FAZA8.md §1). Fără PostGIS: doar stocare + link
-- Google Maps, niciun query de proximitate (PLAN_FAZA8.md §2).

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS latitude  double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

-- Interval valid: lat ∈ [-90, 90], long ∈ [-180, 180]. NULL permis (opțional).
ALTER TABLE announcements
  ADD CONSTRAINT announcements_coords_range CHECK (
    (latitude  IS NULL OR latitude  BETWEEN  -90 AND  90) AND
    (longitude IS NULL OR longitude BETWEEN -180 AND 180)
  );

-- Ambele sau niciuna — o singură coordonată nu are sens.
ALTER TABLE announcements
  ADD CONSTRAINT announcements_coords_both CHECK (
    (latitude IS NULL) = (longitude IS NULL)
  );
