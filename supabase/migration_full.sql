-- =============================================================================
-- TruckSOS — Schema completă (Fazele 1-4)
-- Folosește acest fișier pentru a recrea schema de la zero pe un DB nou.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOC 1 — Fundație: tabele de bază, trigger, RPC accept_announcement, RLS
-- (Query original: 1)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('driver', 'mechanic')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  description text NOT NULL,
  location text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'resolved', 'cancelled')),
  mechanic_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  truck_make text,
  truck_model text,
  truck_year smallint,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL UNIQUE REFERENCES announcements(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mechanic_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  mechanic_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  price_type text NOT NULL CHECK (price_type IN ('fixed', 'hourly')),
  price_amount numeric(10,2) NOT NULL CHECK (price_amount > 0),
  currency text NOT NULL DEFAULT 'RON',
  message text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, mechanic_id)
);

CREATE TABLE trucks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  make text NOT NULL,
  model text NOT NULL,
  year smallint NOT NULL,
  nickname text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexuri
CREATE INDEX idx_applications_announcement ON applications(announcement_id);
CREATE INDEX idx_applications_mechanic     ON applications(mechanic_id);
CREATE INDEX idx_trucks_driver             ON trucks(driver_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOC 2 — Coloane adiționale pe profiles + RLS complet
-- (Queries originale: 2, 3, 4, 6)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS specialization text,
  ADD COLUMN IF NOT EXISTS activity_zone  text,
  ADD COLUMN IF NOT EXISTS phone          text;

-- RLS
ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE trucks        ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles_select_all"  ON profiles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "profiles_insert_own"  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own"  ON profiles FOR UPDATE USING (auth.uid() = id);

-- announcements
CREATE POLICY "announcements_select_driver" ON announcements
  FOR SELECT USING (driver_id = auth.uid());

CREATE POLICY "announcements_select_mechanic_open" ON announcements
  FOR SELECT USING (
    status = 'open' AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'mechanic')
  );

CREATE POLICY "announcements_select_mechanic_accepted" ON announcements
  FOR SELECT USING (mechanic_id = auth.uid());

CREATE POLICY "announcements_insert_driver" ON announcements
  FOR INSERT WITH CHECK (
    driver_id = auth.uid() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'driver')
  );

CREATE POLICY "announcements_update_resolve" ON announcements
  FOR UPDATE
  USING (driver_id = auth.uid() AND status = 'accepted')
  WITH CHECK (driver_id = auth.uid() AND status = 'resolved');

CREATE POLICY "announcements_update_cancel" ON announcements
  FOR UPDATE
  USING (driver_id = auth.uid() AND status = 'open')
  WITH CHECK (driver_id = auth.uid() AND status = 'cancelled');

CREATE POLICY "driver can delete own non-accepted announcements" ON announcements
  FOR DELETE USING (driver_id = auth.uid() AND status != 'accepted');

-- conversations
CREATE POLICY "conversations_select_participant" ON conversations
  FOR SELECT USING (driver_id = auth.uid() OR mechanic_id = auth.uid());

-- messages
CREATE POLICY "messages_select_participant" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE id = conversation_id
        AND (driver_id = auth.uid() OR mechanic_id = auth.uid())
    )
  );

CREATE POLICY "messages_insert_participant" ON messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM conversations
      WHERE id = conversation_id
        AND (driver_id = auth.uid() OR mechanic_id = auth.uid())
    )
  );

-- applications
CREATE POLICY "mechanic sees own applications" ON applications
  FOR SELECT USING (mechanic_id = auth.uid());

CREATE POLICY "driver sees applications to own announcements" ON applications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM announcements
      WHERE announcements.id = applications.announcement_id
        AND announcements.driver_id = auth.uid()
    )
  );

CREATE POLICY "mechanic can apply" ON applications
  FOR INSERT WITH CHECK (mechanic_id = auth.uid());

-- trucks
CREATE POLICY "driver owns trucks" ON trucks
  FOR ALL
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOC 3 — RPC-uri
-- (Queries originale: 4, 8, 12)
-- ─────────────────────────────────────────────────────────────────────────────

-- accept_announcement (vechi, păstrat pentru compatibilitate)
CREATE OR REPLACE FUNCTION accept_announcement(p_announcement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_driver_id uuid;
  v_mechanic_id uuid := auth.uid();
BEGIN
  SELECT driver_id INTO v_driver_id
  FROM announcements
  WHERE id = p_announcement_id AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  UPDATE announcements
  SET status = 'accepted', mechanic_id = v_mechanic_id, updated_at = now()
  WHERE id = p_announcement_id;

  INSERT INTO conversations (announcement_id, driver_id, mechanic_id)
  VALUES (p_announcement_id, v_driver_id, v_mechanic_id);
END;
$$;

-- apply_to_announcement
CREATE OR REPLACE FUNCTION apply_to_announcement(
  p_announcement_id uuid,
  p_price_type      text,
  p_price_amount    numeric,
  p_currency        text DEFAULT 'RON',
  p_message         text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
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

-- accept_application
CREATE OR REPLACE FUNCTION accept_application(
  p_application_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_announcement_id uuid;
  v_mechanic_id     uuid;
  v_driver_id       uuid;
  v_conv_id         uuid;
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

  UPDATE applications
  SET status = 'rejected'
  WHERE announcement_id = v_announcement_id AND id != p_application_id;

  UPDATE applications
  SET status = 'accepted'
  WHERE id = p_application_id;

  UPDATE announcements
  SET status = 'accepted', mechanic_id = v_mechanic_id, updated_at = now()
  WHERE id = v_announcement_id;

  INSERT INTO conversations(announcement_id, driver_id, mechanic_id)
  VALUES (v_announcement_id, v_driver_id, v_mechanic_id)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;

-- reject_application
CREATE OR REPLACE FUNCTION reject_application(
  p_application_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
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

-- get_mechanic_phone
CREATE OR REPLACE FUNCTION get_mechanic_phone(p_mechanic_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_phone text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE mechanic_id = p_mechanic_id AND driver_id = auth.uid()
  ) THEN
    RETURN NULL;
  END IF;
  SELECT phone INTO v_phone FROM profiles WHERE id = p_mechanic_id;
  RETURN v_phone;
END;
$$;

-- get_driver_phone
CREATE OR REPLACE FUNCTION get_driver_phone(p_driver_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_phone text;
BEGIN
  SELECT p.phone INTO v_phone
  FROM profiles p
  WHERE p.id = p_driver_id
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.driver_id = p_driver_id AND c.mechanic_id = auth.uid()
    );
  RETURN v_phone;
END;
$$;
