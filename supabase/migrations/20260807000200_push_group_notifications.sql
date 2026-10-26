-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 7 aug 2026 — Notificări GRUPATE pe conversație / canal
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (re-rulabilă).
--
-- Cerința userului: mai multe mesaje de la aceeași persoană (sau de pe canalul
-- general) să ocupe O SINGURĂ celulă în bara de notificări — celula arată
-- ultimul mesaj, iar expandată arată ultimele câteva. Mecanismul (Expo Push API,
-- docs.expo.dev/push-notifications/sending-notifications):
--   • `tag` (Android) — o notificare nouă cu același tag O ÎNLOCUIEȘTE pe cea
--     deja afișată în bară;
--   • `collapseId` (pe iOS devine apns-collapse-id) — același efect de
--     înlocuire pe iOS + coalescere în tranzit pe ambele platforme.
-- Tag-ul de fir: 'conversation-<id>' respectiv 'channel-<id>'.
--
-- Corpul push-ului devine lista ultimelor ≤5 mesaje NECITITE (cea mai nouă
-- PRIMA — pe celula restrânsă Android se vede doar prima linie, adică ultimul
-- mesaj; expandarea BigText arată toate liniile). Titlul primește „(N)" când
-- sunt mai multe necitite. „Necitit" = mai nou decât cursorul destinatarului
-- din message_reads / channel_reads (fără cursor: totul e necitit).
--
-- Ștergerea celulei din bară la deschiderea conversației o face CLIENTUL
-- (dismissThreadNotifications în src/lib/push.ts, agățat de mark-read).
-- Push-urile de anunțuri/oferte rămân neatinse (evenimente distincte = celule
-- distincte).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. notify_push: parametru nou p_tag (tag Android + collapseId iOS) ───────
-- Semnătura veche cu 4 argumente TREBUIE ștearsă întâi: un CREATE cu al 5-lea
-- parametru DEFAULT ar crea o supraîncărcare, iar apelurile existente cu 4
-- argumente (triggerele de anunțuri/oferte) ar deveni ambigue („not unique").
DROP FUNCTION IF EXISTS notify_push(uuid, text, text, jsonb);

CREATE OR REPLACE FUNCTION notify_push(
  p_user_id uuid,
  p_title   text,
  p_body    text,
  p_data    jsonb DEFAULT '{}'::jsonb,
  p_tag     text  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_enabled boolean;
  v_token   record;
  v_payload jsonb;
BEGIN
  -- Comutatorul global din Setări.
  SELECT push_enabled INTO v_enabled FROM profiles WHERE id = p_user_id;
  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  -- Conturile banate nu primesc push (indiferent de preferință) — 18.4b.
  IF is_banned(p_user_id) THEN
    RETURN;
  END IF;

  FOR v_token IN SELECT token FROM push_tokens WHERE user_id = p_user_id LOOP
    v_payload := jsonb_build_object(
      'to',        v_token.token,
      'title',     p_title,
      'body',      p_body,
      'data',      p_data,
      'sound',     'default',
      'channelId', 'default'
    );
    -- Ambele câmpuri primesc același fir: `tag` e doar-Android (înlocuire în
    -- bară), `collapseId` acoperă iOS; pe Android collapseId doar coalescează
    -- în tranzit (dispozitiv offline → ajunge numai ultimul push al firului).
    IF p_tag IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object('tag', p_tag, 'collapseId', p_tag);
    END IF;

    PERFORM net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := v_payload
    );
  END LOOP;
END;
$$;

-- ── 2. Chat privat: corp cu ultimele ≤5 necitite + tag pe conversație ────────
CREATE OR REPLACE FUNCTION on_message_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_recipient uuid;
  v_sender    text;
  v_lang      text;
  v_cursor    timestamptz;
  v_count     integer;
  v_body      text;
  v_title     text;
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

  -- Cursorul de citire al destinatarului (poate lipsi = nimic citit).
  SELECT last_read_at INTO v_cursor
    FROM message_reads
   WHERE conversation_id = NEW.conversation_id AND user_id = v_recipient;

  SELECT count(*) INTO v_count
    FROM messages m
   WHERE m.conversation_id = NEW.conversation_id
     AND m.sender_id = NEW.sender_id
     AND m.deleted_at IS NULL
     AND (v_cursor IS NULL OR m.created_at > v_cursor);

  -- Ultimele ≤5 necitite, cea mai nouă prima (prima linie = celula restrânsă).
  -- Redarea per mesaj = exact CASE-ul din 19.6b (text / 📎 fișier / marker atașament).
  SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at DESC) INTO v_body
  FROM (
    SELECT m.created_at,
           CASE
             WHEN m.content IS NOT NULL AND m.content <> '' THEN left(m.content, 120)
             WHEN m.file_name IS NOT NULL THEN '📎 ' || left(m.file_name, 118)
             WHEN m.listing_id IS NOT NULL THEN '🏷️'
             WHEN m.recommended_mechanic_id IS NOT NULL THEN '👤'
             WHEN m.announcement_id IS NOT NULL THEN '📍'
             ELSE push_text(v_lang, 'photo')
           END AS line
    FROM messages m
    WHERE m.conversation_id = NEW.conversation_id
      AND m.sender_id = NEW.sender_id
      AND m.deleted_at IS NULL
      AND (v_cursor IS NULL OR m.created_at > v_cursor)
    ORDER BY m.created_at DESC
    LIMIT 5
  ) sub;

  -- Plasă de siguranță (cursor „din viitor" etc.): măcar mesajul curent.
  IF v_body IS NULL THEN
    v_count := 1;
    v_body := CASE
      WHEN NEW.content IS NOT NULL AND NEW.content <> '' THEN left(NEW.content, 120)
      WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 118)
      WHEN NEW.listing_id IS NOT NULL THEN '🏷️'
      WHEN NEW.recommended_mechanic_id IS NOT NULL THEN '👤'
      WHEN NEW.announcement_id IS NOT NULL THEN '📍'
      ELSE push_text(v_lang, 'photo')
    END;
  END IF;

  v_title := COALESCE(v_sender, '');
  IF v_count > 1 THEN
    v_title := v_title || ' (' || v_count || ')';   -- limbă-neutru
  END IF;

  PERFORM notify_push(
    v_recipient,
    v_title,
    v_body,
    jsonb_build_object('type', 'conversation', 'id', NEW.conversation_id),
    'conversation-' || NEW.conversation_id
  );
  RETURN NEW;
END;
$$;

-- ── 3. Canal global: același tratament, cu prefix de expeditor pe linii ──────
CREATE OR REPLACE FUNCTION on_channel_message_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $body$
DECLARE
  v_rec    record;
  v_sender text;
  v_cursor timestamptz;
  v_count  integer;
  v_body   text;
  v_title  text;
BEGIN
  SELECT full_name INTO v_sender FROM profiles WHERE id = NEW.sender_id;

  FOR v_rec IN
    SELECT p.user_id
    FROM channel_push_prefs p
    JOIN profiles pr ON pr.id = p.user_id
    WHERE p.channel_id = NEW.channel_id
      AND p.enabled
      AND p.user_id <> NEW.sender_id
      AND pr.push_enabled
      AND pr.deleted_at IS NULL
      AND NOT is_block_between(NEW.sender_id, p.user_id)
  LOOP
    -- Corpul diferă per destinatar (cursor + blocări proprii) → construit în buclă;
    -- fan-out-ul e mic (notificările de canal sunt opt-in).
    SELECT last_read_at INTO v_cursor
      FROM channel_reads
     WHERE channel_id = NEW.channel_id AND user_id = v_rec.user_id;

    -- Numărul e plafonat la 100 (fără cursor = tot istoricul ar fi „necitit").
    SELECT count(*) INTO v_count FROM (
      SELECT 1
      FROM channel_messages m
      WHERE m.channel_id = NEW.channel_id
        AND m.sender_id <> v_rec.user_id
        AND m.deleted_at IS NULL
        AND (v_cursor IS NULL OR m.created_at > v_cursor)
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      LIMIT 100
    ) c;

    SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at DESC) INTO v_body
    FROM (
      SELECT m.created_at,
             left(COALESCE(pr.full_name, '?'), 24) || ': ' ||
             CASE
               WHEN m.content IS NOT NULL AND m.content <> '' THEN left(m.content, 100)
               WHEN m.file_name IS NOT NULL THEN '📎 ' || left(m.file_name, 98)
               WHEN m.listing_id IS NOT NULL THEN '🏷️'
               WHEN m.recommended_mechanic_id IS NOT NULL THEN '👤'
               WHEN m.announcement_id IS NOT NULL THEN '📍'
               ELSE '📷'
             END AS line
      FROM channel_messages m
      JOIN profiles pr ON pr.id = m.sender_id
      WHERE m.channel_id = NEW.channel_id
        AND m.sender_id <> v_rec.user_id
        AND m.deleted_at IS NULL
        AND (v_cursor IS NULL OR m.created_at > v_cursor)
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      ORDER BY m.created_at DESC
      LIMIT 5
    ) sub;

    IF v_body IS NULL THEN
      v_count := 1;
      v_body := left(COALESCE(v_sender, '?'), 24) || ': ' || COALESCE(
        NULLIF(NEW.content, ''),
        CASE WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 98) ELSE '📷' END
      );
    END IF;

    v_title := COALESCE(v_sender, 'TruckSOS');
    IF v_count > 1 THEN
      v_title := v_title || ' (' || v_count || ')';
    END IF;

    PERFORM notify_push(
      v_rec.user_id,
      v_title,
      v_body,
      jsonb_build_object('type', 'channel', 'id', NEW.channel_id),
      'channel-' || NEW.channel_id
    );
  END LOOP;
  RETURN NEW;
END;
$body$;

-- ── 4. Verificare (3 / 1 / 1) ────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'notify_push' AND pronargs = 5) AS notify_push_5args,
  (SELECT count(*) FROM pg_proc WHERE proname = 'notify_push' AND pronargs = 4) AS notify_push_4args_ramas_0,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'messages_notify')            AS trigger_mesaje,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'channel_messages_notify')    AS trigger_canal;
-- Așteptat: notify_push_5args=1, notify_push_4args_ramas_0=0, ambele triggere=1.
