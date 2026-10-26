-- Fix: caută și șterge ORICE constraint CHECK pe coloana status, indiferent de nume
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  FOR v_conname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.announcements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE announcements DROP CONSTRAINT %I', v_conname);
  END LOOP;
END $$;

-- Adaugă constraint nou cu toate 4 valorile
ALTER TABLE announcements
  ADD CONSTRAINT announcements_status_check
  CHECK (status IN ('open', 'accepted', 'resolved', 'cancelled'));

-- Verificare: trebuie să returneze un singur rând cu cele 4 valori
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.announcements'::regclass
  AND contype = 'c';
