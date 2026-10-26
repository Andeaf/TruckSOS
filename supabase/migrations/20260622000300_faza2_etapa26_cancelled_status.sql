-- Etapa 2.6: Adaugă 'cancelled' la CHECK constraint pe announcements.status
-- Rulează în Supabase Studio → SQL Editor

ALTER TABLE announcements
  DROP CONSTRAINT IF EXISTS announcements_status_check;

ALTER TABLE announcements
  ADD CONSTRAINT announcements_status_check
  CHECK (status IN ('open', 'accepted', 'resolved', 'cancelled'));

-- Verificare:
-- INSERT INTO announcements(driver_id, description, location, status)
-- VALUES (auth.uid(), 'test', 'test', 'cancelled');  -- trebuie să meargă
