-- Etapa 7.4: Număr de înmatriculare opțional pe anunțuri
-- Rulează în Supabase Studio → SQL Editor
-- Non-distructiv: coloană nullable, anunțurile existente rămân cu NULL.
-- Fără CHECK de format (formatele diferă între RO/DE/UE); normalizare
-- (uppercase + trim) doar client-side. Fără schimbare de RLS: coloana e
-- vizibilă oriunde e vizibil anunțul (decizie aprobată în PLAN_FAZA7.md §8.4).

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS plate_number text;
