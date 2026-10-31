-- Etapa 2.1: Câmpuri opționale camion pe announcements
-- Rulează în Supabase Studio → SQL Editor

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS truck_make  TEXT,
  ADD COLUMN IF NOT EXISTS truck_model TEXT,
  ADD COLUMN IF NOT EXISTS truck_year  SMALLINT;

-- Verificare: SELECT truck_make, truck_model, truck_year FROM announcements LIMIT 5;
