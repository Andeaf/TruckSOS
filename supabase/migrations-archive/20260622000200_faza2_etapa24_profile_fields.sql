-- Etapa 2.4: Câmpuri profil mecanic + acces controlat la phone
-- Rulează în Supabase Studio → SQL Editor

-- 1. Coloane noi pe profiles (nullable, backward-compatible)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS specialization TEXT,
  ADD COLUMN IF NOT EXISTS activity_zone  TEXT,
  ADD COLUMN IF NOT EXISTS phone          TEXT;

-- 2. RPC controlat pentru numărul de telefon
--    Returnează phone DOAR dacă auth.uid() are o conversație activă cu mecanicul.
--    Niciun client nu trebuie să citească profiles.phone direct pentru cross-user.
CREATE OR REPLACE FUNCTION get_mechanic_phone(p_mechanic_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_phone TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE mechanic_id = p_mechanic_id
      AND driver_id = auth.uid()
  ) THEN
    RETURN NULL;
  END IF;

  SELECT phone INTO v_phone FROM profiles WHERE id = p_mechanic_id;
  RETURN v_phone;
END;
$$;

-- Verificare:
-- SELECT specialization, activity_zone, phone FROM profiles LIMIT 3;
-- SELECT get_mechanic_phone('<uuid-mecanic>');
