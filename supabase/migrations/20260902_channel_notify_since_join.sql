-- ─────────────────────────────────────────────────────────────────────────────
-- 2 sept 2026 — Notificarea de canal respectă „vezi doar de la înscriere încoace"
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (doar CREATE OR REPLACE).
--
-- Migrarea 20260723 a dat canalului global semantică de grup WhatsApp: RLS-ul
-- (`channel_messages_select_since_join`) arată unui utilizator DOAR mesajele scrise
-- după crearea contului său. Triggerul `on_channel_message_notify` rulează însă
-- SECURITY DEFINER, deci ocolește RLS-ul — și număra/afișa TOT istoricul necitit.
--
-- Cât timp notificările de canal erau opt-in și le avea o singură persoană, nu se
-- vedea. După ce implicitul a devenit „pornit" (20260902_channel_push_default_on),
-- măsurat: **715 mesaje numărate pentru 105 utilizatori care nu le pot deschide** —
-- adică o notificare cu titlul „Comunitate TruckSOS (9)" și, în corp, text din
-- mesaje pe care aplicația refuză să i le arate. Nu doar un număr greșit: e conținut
-- scurs pe lângă politica de vizibilitate.
--
-- FIX: data înscrierii se ia o dată, în bucla de destinatari (`pr.created_at`), și
-- filtrează ambele subinterogări. Restul funcției e neatins (marcajul 🎥 din
-- 20260823, ordinea cronologică din 20260818, gruparea prin tag).
-- ─────────────────────────────────────────────────────────────────────────────

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
    -- `joined_at` vine din aceeași interogare: zero cost în plus per destinatar.
    SELECT p.user_id, pr.created_at AS joined_at
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
        AND m.created_at >= v_rec.joined_at            -- ← nou: ca RLS-ul
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
        AND m.created_at >= v_rec.joined_at            -- ← nou: ca RLS-ul
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      ORDER BY m.created_at DESC
      LIMIT 5
    ) sub;

    -- Mesajul curent e mereu vizibil destinatarului (e scris ACUM, deci după
    -- înscrierea lui), așa că ramura asta rămâne corectă ca plasă de siguranță.
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

-- ── Verificare ──────────────────────────────────────────────────────────────
-- Așteptat: joined_at=true, video_marker=true, ordine_asc=true, trigger=1.
SELECT
  (SELECT position('joined_at' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'on_channel_message_notify')          AS filtru_joined_at,
  (SELECT position('🎥' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'on_channel_message_notify')          AS video_marker_pastrat,
  (SELECT position('created_at ASC' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'on_channel_message_notify')          AS ordine_asc_pastrata,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'channel_messages_notify')             AS trigger_ok;
