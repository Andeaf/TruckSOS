-- Etapa 12.4: Triggerele care trimit notificările
-- Rulează în Supabase Studio → SQL Editor, DUPĂ etapa 12.2.
--
-- Evenimente: mesaj nou, ofertă nouă pe anunțul meu, oferta mea acceptată, anunț nou.
-- Chatul global NU notifică (ar fi spam) și nimeni nu e notificat de propria acțiune.

-- ─── 1. Limba destinatarului ────────────────────────────────────────────────
-- Textul notificării se compune pe SERVER, deci Postgres trebuie să știe limba
-- userului. Clientul o scrie aici la fiecare schimbare din Setări.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS lang text NOT NULL DEFAULT 'ro';

-- Șabloanele de text, per limbă. `%s` se completează cu `format()` la apel.
CREATE OR REPLACE FUNCTION push_text(p_lang text, p_key text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_key
    WHEN 'application_title' THEN
      CASE p_lang WHEN 'en' THEN 'New offer'
                  WHEN 'de' THEN 'Neues Angebot'
                  ELSE 'Ofertă nouă' END
    WHEN 'application_body' THEN
      CASE p_lang WHEN 'en' THEN '%s offered to help you'
                  WHEN 'de' THEN '%s bietet dir Hilfe an'
                  ELSE '%s s-a oferit să te ajute' END
    WHEN 'accepted_title' THEN
      CASE p_lang WHEN 'en' THEN 'Offer accepted'
                  WHEN 'de' THEN 'Angebot angenommen'
                  ELSE 'Ofertă acceptată' END
    WHEN 'accepted_body' THEN
      CASE p_lang WHEN 'en' THEN '%s accepted your offer'
                  WHEN 'de' THEN '%s hat dein Angebot angenommen'
                  ELSE '%s ți-a acceptat oferta' END
    WHEN 'announcement_title' THEN
      CASE p_lang WHEN 'en' THEN 'New announcement'
                  WHEN 'de' THEN 'Neue Anzeige'
                  ELSE 'Anunț nou' END
    WHEN 'photo' THEN
      CASE p_lang WHEN 'en' THEN 'Photo'
                  WHEN 'de' THEN 'Foto'
                  ELSE 'Poză' END
    ELSE ''
  END;
$$;

CREATE OR REPLACE FUNCTION user_lang(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(lang, 'ro') FROM profiles WHERE id = p_user_id;
$$;

-- ─── 2. Mesaj nou în conversație → celălalt participant ─────────────────────
CREATE OR REPLACE FUNCTION on_message_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_recipient uuid;
  v_sender    text;
  v_lang      text;
  v_body      text;
BEGIN
  SELECT CASE WHEN c.driver_id = NEW.sender_id THEN c.mechanic_id ELSE c.driver_id END
    INTO v_recipient
  FROM conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_recipient IS NULL OR v_recipient = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_sender FROM profiles WHERE id = NEW.sender_id;
  v_lang := user_lang(v_recipient);

  -- Mesajele-poză n-au text: arătăm un marcaj, nu o bulă goală.
  v_body := CASE
    WHEN NEW.content IS NULL OR NEW.content = '' THEN push_text(v_lang, 'photo')
    ELSE left(NEW.content, 120)
  END;

  PERFORM notify_push(
    v_recipient,
    COALESCE(v_sender, ''),
    v_body,
    jsonb_build_object('type', 'conversation', 'id', NEW.conversation_id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_notify ON messages;
CREATE TRIGGER messages_notify
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION on_message_notify();

-- ─── 3. Ofertă nouă pe anunțul meu → șoferul ────────────────────────────────
CREATE OR REPLACE FUNCTION on_application_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_driver   uuid;
  v_mechanic text;
  v_lang     text;
BEGIN
  SELECT driver_id INTO v_driver FROM announcements WHERE id = NEW.announcement_id;
  IF v_driver IS NULL OR v_driver = NEW.mechanic_id THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_mechanic FROM profiles WHERE id = NEW.mechanic_id;
  v_lang := user_lang(v_driver);

  PERFORM notify_push(
    v_driver,
    push_text(v_lang, 'application_title'),
    format(push_text(v_lang, 'application_body'), COALESCE(v_mechanic, '')),
    jsonb_build_object('type', 'announcement', 'id', NEW.announcement_id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_notify ON applications;
CREATE TRIGGER applications_notify
  AFTER INSERT ON applications
  FOR EACH ROW EXECUTE FUNCTION on_application_notify();

-- ─── 4. Oferta mea a fost acceptată → mecanicul ─────────────────────────────
CREATE OR REPLACE FUNCTION on_application_accepted_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_driver_name text;
  v_lang        text;
BEGIN
  SELECT p.full_name INTO v_driver_name
  FROM announcements a
  JOIN profiles p ON p.id = a.driver_id
  WHERE a.id = NEW.announcement_id;

  v_lang := user_lang(NEW.mechanic_id);

  PERFORM notify_push(
    NEW.mechanic_id,
    push_text(v_lang, 'accepted_title'),
    format(push_text(v_lang, 'accepted_body'), COALESCE(v_driver_name, '')),
    jsonb_build_object('type', 'application', 'id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_accepted_notify ON applications;
CREATE TRIGGER applications_accepted_notify
  AFTER UPDATE OF status ON applications
  FOR EACH ROW
  WHEN (NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted')
  EXECUTE FUNCTION on_application_accepted_notify();

-- ─── 5. Anunț nou → toți mecanicii, cu filtrul opțional de rază ─────────────
-- Regula raza: dacă mecanicul ȘI-A SETAT o rază, dar anunțul n-are coordonate
-- (sau mecanicul n-are poziție), anunțul NU se trimite — altfel raza n-ar însemna
-- nimic. Mecanicii fără rază (NULL) primesc tot, ca până acum.
CREATE OR REPLACE FUNCTION on_announcement_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_mechanic record;
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  FOR v_mechanic IN
    SELECT id, COALESCE(lang, 'ro') AS lang
    FROM profiles
    WHERE role = 'mechanic'
      AND id <> NEW.driver_id
      AND push_enabled
      AND (
        notify_radius_km IS NULL
        OR (
          NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND distance_km(latitude, longitude, NEW.latitude, NEW.longitude) <= notify_radius_km
        )
      )
  LOOP
    PERFORM notify_push(
      v_mechanic.id,
      push_text(v_mechanic.lang, 'announcement_title'),
      NEW.location,
      jsonb_build_object('type', 'feed', 'id', NEW.id)
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS announcements_notify ON announcements;
CREATE TRIGGER announcements_notify
  AFTER INSERT ON announcements
  FOR EACH ROW EXECUTE FUNCTION on_announcement_notify();

-- ─── 6. Verificări (manual) ─────────────────────────────────────────────────
--   a) De pe alt cont, trimite-mi un mesaj → primesc notificare cu numele expeditorului.
--   b) Mecanic: aplică la anunțul meu → șoferul primește „Ofertă nouă".
--   c) Șofer: acceptă oferta → mecanicul primește „Ofertă acceptată".
--   d) Șofer: publică anunț CU coordonate → mecanicii cu rază care acoperă distanța primesc;
--      cei cu rază prea mică, NU. Anunț FĂRĂ coordonate → doar mecanicii fără rază setată.
--   e) Nimeni nu primește notificare pentru propria acțiune.
