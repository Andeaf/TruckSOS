-- Etapa 7.5: Număr de înmatriculare opțional pe camioanele salvate
-- Rulează în Supabase Studio → SQL Editor
-- Non-distructiv: coloană nullable, camioanele existente rămân cu NULL.
-- Simetric cu announcements.plate_number (Etapa 7.4). Normalizare (uppercase +
-- trim) doar client-side. Fără CHECK de format, fără schimbare de RLS
-- (trucks are deja policy "driver owns trucks" FOR ALL).

ALTER TABLE trucks ADD COLUMN IF NOT EXISTS plate_number text;
