-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK pentru 20261027_push_mentions_replies.sql — readuce funcțiile de push la
-- versiunile din 20260914 și scoate obiectele noi. `BEGIN;` + fișier + `COMMIT;`.
-- ATENȚIE: DROP COLUMN mention_push_enabled e sigur DOAR înainte ca 1.1.0 să fie
-- publicată (clientul 1.1 scrie coloana din Setări). După release, lasă coloana.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL lock_timeout = '5s';

-- 1. push_text = versiunea din 20260908_market_push_and_badge.sql
CREATE OR REPLACE FUNCTION public.push_text(p_lang text, p_key text)
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
    WHEN 'market_title' THEN
      CASE p_lang WHEN 'en' THEN 'New listing on Market'
                  WHEN 'de' THEN 'Neue Anzeige im Markt'
                  ELSE 'Anunț nou pe Market' END
    ELSE ''
  END;
$$;

-- 2. canal = versiunea din 20260914_channel_push_digest.sql
CREATE OR REPLACE FUNCTION public.on_channel_message_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $body$
DECLARE
  v_cooldown constant interval := interval '2 minutes';
  v_rec      record;
  v_sender   text;
  v_lang     text;
  v_cursor   timestamptz;
  v_since    timestamptz;
  v_count    integer;
  v_body     text;
  v_title    text;
  v_line_new text;
BEGIN
  SELECT full_name INTO v_sender FROM profiles WHERE id = NEW.sender_id;

  v_line_new := left(COALESCE(v_sender, '?'), 24) || ': ' || COALESCE(
    NULLIF(NEW.content, ''),
    CASE
      WHEN NEW.file_name IS NOT NULL
           AND lower(NEW.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                       THEN '🎥 ' || left(NEW.file_name, 98)
      WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 98)
      WHEN NEW.listing_id IS NOT NULL THEN '🏷️'
      WHEN NEW.recommended_mechanic_id IS NOT NULL THEN '👤'
      WHEN NEW.announcement_id IS NOT NULL THEN '📍'
      ELSE '📷'
    END
  );

  FOR v_rec IN
    SELECT p.user_id, pr.created_at AS joined_at, st.last_pushed_at
    FROM channel_push_prefs p
    JOIN profiles pr ON pr.id = p.user_id
    LEFT JOIN channel_push_state st
           ON st.user_id = p.user_id AND st.channel_id = p.channel_id
    WHERE p.channel_id = NEW.channel_id
      AND p.enabled
      AND p.user_id <> NEW.sender_id
      AND pr.push_enabled
      AND pr.deleted_at IS NULL
      AND NOT is_block_between(NEW.sender_id, p.user_id)
  LOOP
    SELECT last_read_at INTO v_cursor
      FROM channel_reads
     WHERE channel_id = NEW.channel_id AND user_id = v_rec.user_id;

    IF v_rec.last_pushed_at IS NOT NULL
       AND v_rec.last_pushed_at > now() - v_cooldown
       AND (v_cursor IS NULL OR v_cursor < v_rec.last_pushed_at) THEN
      CONTINUE;
    END IF;

    v_lang := user_lang(v_rec.user_id);

    SELECT count(*) INTO v_count FROM (
      SELECT 1
      FROM channel_messages m
      WHERE m.channel_id = NEW.channel_id
        AND m.sender_id <> v_rec.user_id
        AND m.deleted_at IS NULL
        AND (v_cursor IS NULL OR m.created_at > v_cursor)
        AND m.created_at >= v_rec.joined_at
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      LIMIT 100
    ) c;

    v_since := GREATEST(v_cursor, v_rec.last_pushed_at);

    SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at ASC) INTO v_body
    FROM (
      SELECT m.created_at,
             left(COALESCE(pr.full_name, '?'), 24) || ': ' ||
             CASE
               WHEN m.content IS NOT NULL AND m.content <> '' THEN left(m.content, 100)
               WHEN m.file_name IS NOT NULL
                    AND lower(m.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                                THEN '🎥 ' || left(m.file_name, 98)
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
        AND (v_since IS NULL OR m.created_at > v_since)
        AND m.created_at >= v_rec.joined_at
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      ORDER BY m.created_at DESC
      LIMIT 5
    ) sub;

    IF v_body IS NULL THEN
      v_count := GREATEST(v_count, 1);
      v_body  := v_line_new;
    END IF;

    v_title := push_text(v_lang, 'channel_name');
    IF v_count > 1 THEN
      v_title := v_title || ' (' || v_count || ')';
    END IF;

    PERFORM notify_push(
      v_rec.user_id,
      v_title,
      v_body,
      jsonb_build_object('type', 'channel', 'id', NEW.channel_id),
      'channel-' || NEW.channel_id,
      v_title,
      v_line_new
    );

    INSERT INTO channel_push_state (user_id, channel_id, last_pushed_at)
    VALUES (v_rec.user_id, NEW.channel_id, now())
    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_pushed_at = now();
  END LOOP;
  RETURN NEW;
END;
$body$;

-- 3. chat privat = versiunea din 20260914_push_ios_threads_channel_cooldown.sql §4
CREATE OR REPLACE FUNCTION public.on_message_notify()
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
  v_line_new  text;
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

  v_line_new := CASE
    WHEN NEW.content IS NOT NULL AND NEW.content <> '' THEN left(NEW.content, 120)
    WHEN NEW.file_name IS NOT NULL
         AND lower(NEW.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                     THEN '🎥 ' || left(NEW.file_name, 118)
    WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 118)
    WHEN NEW.listing_id IS NOT NULL THEN '🏷️'
    WHEN NEW.recommended_mechanic_id IS NOT NULL THEN '👤'
    WHEN NEW.announcement_id IS NOT NULL THEN '📍'
    ELSE push_text(v_lang, 'photo')
  END;

  SELECT last_read_at INTO v_cursor
    FROM message_reads
   WHERE conversation_id = NEW.conversation_id AND user_id = v_recipient;

  SELECT count(*) INTO v_count
    FROM messages m
   WHERE m.conversation_id = NEW.conversation_id
     AND m.sender_id = NEW.sender_id
     AND m.deleted_at IS NULL
     AND (v_cursor IS NULL OR m.created_at > v_cursor);

  SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at ASC) INTO v_body
  FROM (
    SELECT m.created_at,
           CASE
             WHEN m.content IS NOT NULL AND m.content <> '' THEN left(m.content, 120)
             WHEN m.file_name IS NOT NULL
                  AND lower(m.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                              THEN '🎥 ' || left(m.file_name, 118)
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

  IF v_body IS NULL THEN
    v_count := 1;
    v_body  := v_line_new;
  END IF;

  v_title := COALESCE(v_sender, '');
  IF v_count > 1 THEN
    v_title := v_title || ' (' || v_count || ')';
  END IF;

  PERFORM notify_push(
    v_recipient,
    v_title,
    v_body,
    jsonb_build_object('type', 'conversation', 'id', NEW.conversation_id),
    'conversation-' || NEW.conversation_id,
    COALESCE(v_sender, ''),
    v_line_new
  );
  RETURN NEW;
END;
$$;

-- 4. obiectele noi
SELECT cron.unschedule('cleanup-direct-push-state-daily')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-direct-push-state-daily');
DROP FUNCTION IF EXISTS public.direct_push_allowed(uuid, uuid);
DROP TABLE IF EXISTS public.direct_push_state;
-- DOAR înainte de release-ul 1.1.0 (vezi antetul):
ALTER TABLE public.profiles DROP COLUMN IF EXISTS mention_push_enabled;

SELECT (push_text('ro', 'mention_title') = '') AS chei_noi_scoase,
       to_regclass('public.direct_push_state') IS NULL AS tabel_scos;
