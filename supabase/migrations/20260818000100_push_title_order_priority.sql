-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 18 aug 2026 — Push: prioritate mare + titlu de canal + ordine WhatsApp
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (re-rulabilă).
--
-- Trei schimbări cerute de user pe 18 aug:
--   1. `priority: 'high'` pe fiecare push — fără el, FCM livrează cu prioritate
--      „normal" și Android (Doze / optimizarea de baterie, vizibil pe Samsung)
--      amână notificarea cu minute bune. iOS ajungea oricum instant (sound =>
--      APNs prioritar), acum ambele platforme se comportă la fel.
--   2. Titlul notificării = titlul conversației. La conversațiile private era
--      deja corect (numele expeditorului); la canalul global titlul era tot
--      numele expeditorului — devine numele canalului în limba destinatarului
--      (cheie nouă `channel_name` în push_text, aliniată cu i18n `channels.global`
--      din aplicație), expeditorul rămâne pe fiecare linie din corp.
--   3. Ordinea liniilor din corp INVERSATĂ: cel mai nou mesaj JOS, ca pe
--      WhatsApp (era cel mai nou sus). Compromis asumat: pe celula Android
--      restrânsă (o singură linie) se vede acum cel mai VECHI necitit din listă.
--
-- Doar CREATE OR REPLACE — semnăturile nu se schimbă, nu e nevoie de DROP.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. push_text: cheia nouă `channel_name` ─────────────────────────────────
-- Textele identice cu `channels.global` din src/i18n/locales/{ro,en,de}.json.
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
    WHEN 'channel_name' THEN
      CASE p_lang WHEN 'en' THEN 'TruckSOS Community'
                  WHEN 'de' THEN 'TruckSOS Gemeinschaft'
                  ELSE 'Comunitate TruckSOS' END
    ELSE ''
  END;
$$;

-- ── 2. notify_push: priority high ────────────────────────────────────────────
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
      'channelId', 'default',
      -- FCM „high": livrare imediată și în Doze; fără el Samsung amâna minute.
      'priority',  'high'
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

-- ── 3. Chat privat: aceleași ≤5 necitite, dar cel mai nou JOS ────────────────
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

  -- Ultimele ≤5 necitite (subinterogarea ia cele mai NOI 5), agregate CRONOLOGIC:
  -- cel mai nou pe ultima linie, ca pe WhatsApp (cerut 18 aug; înainte era invers).
  -- Redarea per mesaj = exact CASE-ul din 19.6b (text / 📎 fișier / marker atașament).
  SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at ASC) INTO v_body
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

-- ── 4. Canal global: titlu = numele canalului, cel mai nou JOS ───────────────
CREATE OR REPLACE FUNCTION on_channel_message_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $body$
DECLARE
  v_rec    record;
  v_sender text;
  v_lang   text;
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
    v_lang := user_lang(v_rec.user_id);

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

    -- Cele mai noi ≤5 necitite, agregate cronologic (cel mai nou JOS — 18 aug).
    SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at ASC) INTO v_body
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

    -- Titlul = numele canalului în limba destinatarului (ca în aplicație);
    -- expeditorul se vede oricum pe fiecare linie din corp (stil grup WhatsApp).
    v_title := push_text(v_lang, 'channel_name');
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

-- ── 5. Verificare ────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'notify_push' AND pronargs = 5)      AS notify_push_5args,
  (SELECT position('priority' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'notify_push' AND pronargs = 5)                                  AS are_priority_high,
  (SELECT push_text('en', 'channel_name'))                                           AS nume_canal_en,
  (SELECT position('created_at ASC' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'on_message_notify')                                             AS chat_ordine_asc,
  (SELECT position('created_at ASC' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'on_channel_message_notify')                                     AS canal_ordine_asc;
-- Așteptat: 1, true, 'TruckSOS Community', true, true.
