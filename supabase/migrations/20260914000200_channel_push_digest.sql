-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 14 sept 2026 (b) — Canal: push-ul conține DOAR mesajele apărute de la
-- ultimul push (digest), nu ultimele ≤5 necitite + PAUZA scade de la 30 la 2 min
-- (decizia userului, 15 sept): destul cât să taie rafalele de mesaje la câteva
-- secunde distanță, fără să întârzie o discuție vie.
-- Rulează în Supabase Studio → SQL Editor, DUPĂ 20260914_push_ios_threads_channel_cooldown.
-- Idempotentă (doar CREATE OR REPLACE).
--
-- DE CE: plângerea exactă a utilizatorilor era „șterg notificarea din bară și
-- vine din nou exact aceeași". În date (14 sept, 19:47–19:56): 25 de mesaje pe
-- canal în 9 minute, 7 dintre ele în 26 de secunde, fiecare cu push la ~207
-- tokenuri (fan-out 1×, zero rafale fără mesaj nou). Fiecare push repeta
-- aceleași ≤5 linii necitite, doar ultima era nouă → celula ștearsă „revenea"
-- identică la câteva secunde. Pauza (migrarea anterioară, acum 2 min) taie
-- rafala; migrarea asta garantează că nici push-ul de după pauză nu mai
-- re-afișează linii deja trimise: fereastra corpului începe de la
-- GREATEST(last_read_at, last_pushed_at). Titlul „(N)" rămâne numărul TOTAL
-- de necitite (de la last_read_at), ca omul să știe că sunt mai multe.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION on_channel_message_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $body$
DECLARE
  -- Pauza între două push-uri de canal către același membru care NU a deschis
  -- canalul între timp. Singurul loc de reglat (30 min → 2 min pe 15 sept).
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

  -- Linia mesajului curent (corpul de pe iOS + plasa de siguranță).
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

    -- PAUZA: a primit deja un push de canal în ultimele 2 min și n-a deschis
    -- canalul de atunci → nu-l mai batem la cap; vede „(N)" la următorul push.
    IF v_rec.last_pushed_at IS NOT NULL
       AND v_rec.last_pushed_at > now() - v_cooldown
       AND (v_cursor IS NULL OR v_cursor < v_rec.last_pushed_at) THEN
      CONTINUE;
    END IF;

    v_lang := user_lang(v_rec.user_id);

    -- Numărul TOTAL de necitite (de la ultima deschidere a canalului).
    SELECT count(*) INTO v_count FROM (
      SELECT 1
      FROM channel_messages m
      WHERE m.channel_id = NEW.channel_id
        AND m.sender_id <> v_rec.user_id
        AND m.deleted_at IS NULL
        AND (v_cursor IS NULL OR m.created_at > v_cursor)
        AND m.created_at >= v_rec.joined_at            -- ca RLS-ul (2 sept)
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      LIMIT 100
    ) c;

    -- Corpul = DOAR ce n-a mai fost trimis: de la ultimul push (sau de la
    -- ultima citire, dacă e mai recentă). GREATEST ignoră NULL-urile.
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
        AND m.created_at >= v_rec.joined_at            -- ca RLS-ul (2 sept)
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      ORDER BY m.created_at DESC
      LIMIT 5
    ) sub;

    -- Mesajul curent e mereu vizibil destinatarului (e scris ACUM, deci după
    -- înscrierea lui și după ultimul push), plasă de siguranță.
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
      v_title,                  -- iOS: numele canalului + „(N)"
      v_line_new                -- iOS: doar mesajul nou
    );

    INSERT INTO channel_push_state (user_id, channel_id, last_pushed_at)
    VALUES (v_rec.user_id, NEW.channel_id, now())
    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_pushed_at = now();
  END LOOP;
  RETURN NEW;
END;
$body$;

-- ── Verificare ──────────────────────────────────────────────────────────────
-- Așteptat: digest=true, pauza_2min=true.
SELECT
  (SELECT position('v_since' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'on_channel_message_notify')   AS digest,
  (SELECT position('interval ''2 minutes''' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'on_channel_message_notify')   AS pauza_2min;
