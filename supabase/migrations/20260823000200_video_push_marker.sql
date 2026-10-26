-- ─────────────────────────────────────────────────────────────────────────────
-- 23 aug 2026 — Push: mesajele-VIDEO din chat apar cu 🎥, nu cu 📎
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (CREATE OR REPLACE).
-- Necesită migrarea 20260818 rulată (corpurile de mai jos = acelea + un singur
-- WHEN nou per CASE: extensie video → '🎥 nume', înaintea ramurii generice 📎).
--
-- Video în chat (23 aug) REFOLOSEȘTE conducta de fișiere (file_path/file_name/
-- file_size) — nicio coloană nouă; singura urmă server-side e acest marcaj.
-- Extensiile = VIDEO_FILE_EXTENSIONS din src/lib/storage.ts (ține-le sincron).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Chat privat ───────────────────────────────────────────────────────────
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
    v_body := CASE
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
    'conversation-' || NEW.conversation_id
  );
  RETURN NEW;
END;
$$;

-- ── 2. Canal global ──────────────────────────────────────────────────────────
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
    v_lang := user_lang(v_rec.user_id);

    SELECT last_read_at INTO v_cursor
      FROM channel_reads
     WHERE channel_id = NEW.channel_id AND user_id = v_rec.user_id;

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
        AND (v_cursor IS NULL OR m.created_at > v_cursor)
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      ORDER BY m.created_at DESC
      LIMIT 5
    ) sub;

    IF v_body IS NULL THEN
      v_count := 1;
      v_body := left(COALESCE(v_sender, '?'), 24) || ': ' || COALESCE(
        NULLIF(NEW.content, ''),
        CASE
          WHEN NEW.file_name IS NOT NULL
               AND lower(NEW.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                           THEN '🎥 ' || left(NEW.file_name, 98)
          WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 98)
          ELSE '📷'
        END
      );
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
      'channel-' || NEW.channel_id
    );
  END LOOP;
  RETURN NEW;
END;
$body$;

-- ── 3. Verificare ────────────────────────────────────────────────────────────
SELECT
  (SELECT position('🎥' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'on_message_notify')          AS chat_video_marker,
  (SELECT position('🎥' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'on_channel_message_notify')  AS canal_video_marker,
  (SELECT position('created_at ASC' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'on_message_notify')          AS ordinea_18aug_pastrata;
-- Așteptat: true, true, true.
