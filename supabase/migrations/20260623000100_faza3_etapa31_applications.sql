-- Etapa 3.1: Tabel applications + RLS + RPC-uri
-- Rulează în Supabase Studio → SQL Editor

-- ─── 1. Tabel applications ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  mechanic_id     UUID NOT NULL REFERENCES profiles(id)      ON DELETE CASCADE,
  price_type      TEXT NOT NULL CHECK (price_type IN ('fixed', 'hourly')),
  price_amount    NUMERIC(10,2) NOT NULL CHECK (price_amount > 0),
  currency        TEXT NOT NULL DEFAULT 'RON',
  message         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, mechanic_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_announcement ON applications(announcement_id);
CREATE INDEX IF NOT EXISTS idx_applications_mechanic     ON applications(mechanic_id);

-- ─── 2. RLS ───────────────────────────────────────────────────────────────
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

-- Mecanicul vede propriile candidaturi
CREATE POLICY "mechanic sees own applications"
  ON applications FOR SELECT
  USING (mechanic_id = auth.uid());

-- Șoferul vede candidaturile la anunțurile sale
CREATE POLICY "driver sees applications to own announcements"
  ON applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM announcements
      WHERE announcements.id = applications.announcement_id
        AND announcements.driver_id = auth.uid()
    )
  );

-- Mecanicul poate crea o candidatură (UNIQUE constraint previne duplicatele)
CREATE POLICY "mechanic can apply"
  ON applications FOR INSERT
  WITH CHECK (mechanic_id = auth.uid());

-- Nimeni nu face UPDATE direct (statusul e controlat exclusiv prin RPC-uri)

-- ─── 3. RPC apply_to_announcement ────────────────────────────────────────
CREATE OR REPLACE FUNCTION apply_to_announcement(
  p_announcement_id UUID,
  p_price_type      TEXT,
  p_price_amount    NUMERIC,
  p_currency        TEXT DEFAULT 'RON',
  p_message         TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM announcements
    WHERE id = p_announcement_id AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'announcement_not_open';
  END IF;

  INSERT INTO applications(announcement_id, mechanic_id, price_type, price_amount, currency, message)
  VALUES (p_announcement_id, auth.uid(), p_price_type, p_price_amount, p_currency, p_message);
END;
$$;

-- ─── 4. RPC accept_application ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION accept_application(
  p_application_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_announcement_id UUID;
  v_mechanic_id     UUID;
  v_driver_id       UUID;
  v_conv_id         UUID;
BEGIN
  SELECT a.announcement_id, a.mechanic_id, ann.driver_id
  INTO v_announcement_id, v_mechanic_id, v_driver_id
  FROM applications a
  JOIN announcements ann ON ann.id = a.announcement_id
  WHERE a.id = p_application_id
    AND ann.driver_id = auth.uid()
    AND a.status = 'pending'
    AND ann.status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_found_or_unauthorized';
  END IF;

  -- Respinge toate celelalte candidaturi pentru același anunț
  UPDATE applications
  SET status = 'rejected'
  WHERE announcement_id = v_announcement_id
    AND id != p_application_id;

  -- Acceptă candidatura aleasă
  UPDATE applications
  SET status = 'accepted'
  WHERE id = p_application_id;

  -- Actualizează anunțul
  UPDATE announcements
  SET status = 'accepted', mechanic_id = v_mechanic_id, updated_at = now()
  WHERE id = v_announcement_id;

  -- Creează conversația
  INSERT INTO conversations(announcement_id, driver_id, mechanic_id)
  VALUES (v_announcement_id, v_driver_id, v_mechanic_id)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;

-- ─── 5. RPC reject_application ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_application(
  p_application_id UUID
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE applications
  SET status = 'rejected'
  WHERE id = p_application_id
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM announcements ann
      JOIN applications a ON a.announcement_id = ann.id
      WHERE a.id = p_application_id
        AND ann.driver_id = auth.uid()
        AND ann.status = 'open'
    );
END;
$$;

-- ─── Verificare ──────────────────────────────────────────────────────────
-- SELECT * FROM applications LIMIT 5;
-- SELECT apply_to_announcement('<ann-id>', 'fixed', 150);
-- SELECT accept_application('<app-id>');
