-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 19.6b — Mesaje DOAR-atașament (fără text) — 26 iul 2026. Idempotentă.
--
-- Cerința userului: recomandările / anunțurile / produsele se pot trimite și fără
-- să scrii un mesaj. CHECK-ul anti-mesaj-gol acceptă acum orice mesaj care poartă
-- măcar UN context; push-ul arată un marker pe tipul atașamentului.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_text_or_image;
ALTER TABLE messages ADD CONSTRAINT messages_text_or_image
  CHECK (
    deleted_at IS NOT NULL
    OR content <> ''
    OR image_path IS NOT NULL
    OR file_path IS NOT NULL
    OR listing_id IS NOT NULL
    OR recommended_mechanic_id IS NOT NULL
    OR announcement_id IS NOT NULL
  );

ALTER TABLE channel_messages DROP CONSTRAINT IF EXISTS channel_messages_text_or_image;
ALTER TABLE channel_messages ADD CONSTRAINT channel_messages_text_or_image
  CHECK (
    deleted_at IS NOT NULL
    OR content <> ''
    OR image_path IS NOT NULL
    OR file_path IS NOT NULL
    OR listing_id IS NOT NULL
    OR recommended_mechanic_id IS NOT NULL
    OR announcement_id IS NOT NULL
  );

-- Push: mesajul doar-atașament nu mai cade pe marcajul „Poză" — marker pe tip.
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

  v_body := CASE
    WHEN NEW.content IS NOT NULL AND NEW.content <> '' THEN left(NEW.content, 120)
    WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 118)
    WHEN NEW.listing_id IS NOT NULL THEN '🏷️'
    WHEN NEW.recommended_mechanic_id IS NOT NULL THEN '👤'
    WHEN NEW.announcement_id IS NOT NULL THEN '📍'
    ELSE push_text(v_lang, 'photo')
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

-- Verificare: INSERT mesaj cu content='' + listing_id valid → acceptat;
-- cu toate contextele NULL și content='' → respins de CHECK.
