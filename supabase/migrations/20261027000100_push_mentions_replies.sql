-- ─────────────────────────────────────────────────────────────────────────────
-- 27 oct 2026 — NOTIFICĂRI DISTINCTE PENTRU REPLY ȘI MENȚIUNI, FĂRĂ PAUZĂ (PLAN_1.1, Faza G1)
--
-- Cum se rulează: Supabase Studio → SQL Editor, `BEGIN;` + fișier + `COMMIT;` (repetiție:
-- `BEGIN;` + fișier + `ROLLBACK;`). Rollback real: supabase/rollback/20261027_push_mentions_replies.sql
-- Ordinea migrărilor 1.1: 20261025 (A1, rulată) → 20261026 (B1) → 20261027 (acest fișier) → 20261028 (H1).
--
-- DOAR SERVER, compatibilă cu 1.0.x: clienții vechi primesc push-ul nou, navighează pe
-- `data.type`/`data.id` ca până acum și ignoră cheile noi `message_id`/`kind`. Coloana nouă din
-- `profiles` are DEFAULT, deci `select('*')` și `update(...)` din 1.0.x merg neschimbate.
--
-- CE SE SCHIMBĂ
--   1. push_text: cheile noi `mention_title` („%s te-a menționat”) și `reply_title` („%s ți-a răspuns”),
--      cu plasă de regresie: cele 8 chei existente × 3 limbi trebuie să rămână identice.
--   2. profiles.mention_push_enabled boolean NOT NULL DEFAULT true — comutator nou în Setări (G2).
--   3. direct_push_state + direct_push_allowed(): anti-spam per pereche (destinatar, expeditor):
--      cel mult un push la 30 s și 10 pe oră (D12). Nu depinde de pauza canalului.
--   4. on_channel_message_notify(): ÎNTÂI destinatarii „adresați” (autorul mesajului citat ∪
--      utilizatorii din `mentions`, max 5) primesc imediat un push propriu, fără pauza de 2 min,
--      indiferent de preferința de canal (D11), dar respectând push_enabled, mention_push_enabled,
--      blocările și vizibilitatea since-join (pr.created_at <= NEW.created_at, ca RLS-ul); apoi
--      digest-ul de până acum pentru restul membrilor. Tag `mention-<canal>` = celulă proprie pe
--      Android (tag/collapseId), fir separat pe iOS (threadId); dismiss-ul din client potrivește pe
--      data.type/id, deci dispare la deschiderea canalului.
--   5. on_message_notify() (chat privat, fără pauză oricum): titlul devine „X ți-a răspuns” / „X te-a
--      menționat” când mesajul e reply la destinatar sau îl menționează; corpul rămâne.
--   6. REGULA ZERO: toată logica de push din ambele triggere stă într-un bloc EXCEPTION — o eroare
--      de notificare NU blochează niciodată INSERT-ul mesajului.
-- ─────────────────────────────────────────────────────────────────────────────

SET LOCAL lock_timeout = '5s';

-- ── 1. push_text: rescrisă ÎNTREAGĂ (IMMUTABLE, nu se pot adăuga ramuri separat) ──
-- Corpul = cel din 20260908_market_push_and_badge.sql + două chei.
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
    -- 27 oct 2026 (1.1): mențiuni și răspunsuri; %s = numele expeditorului.
    WHEN 'mention_title' THEN
      CASE p_lang WHEN 'en' THEN '%s mentioned you'
                  WHEN 'de' THEN '%s hat dich erwähnt'
                  ELSE '%s te-a menționat' END
    WHEN 'reply_title' THEN
      CASE p_lang WHEN 'en' THEN '%s replied to you'
                  WHEN 'de' THEN '%s hat dir geantwortet'
                  ELSE '%s ți-a răspuns' END
    ELSE ''
  END;
$$;

-- Plasă de regresie: cele 8 chei vechi × 3 limbi trebuie să dea EXACT textele de până acum.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('%s/%s: „%s” ≠ „%s”', e.lang, e.key, push_text(e.lang, e.key), e.expected), '; ')
    INTO v_bad
    FROM (VALUES
      ('ro','application_title','Ofertă nouă'), ('en','application_title','New offer'), ('de','application_title','Neues Angebot'),
      ('ro','application_body','%s s-a oferit să te ajute'), ('en','application_body','%s offered to help you'), ('de','application_body','%s bietet dir Hilfe an'),
      ('ro','accepted_title','Ofertă acceptată'), ('en','accepted_title','Offer accepted'), ('de','accepted_title','Angebot angenommen'),
      ('ro','accepted_body','%s ți-a acceptat oferta'), ('en','accepted_body','%s accepted your offer'), ('de','accepted_body','%s hat dein Angebot angenommen'),
      ('ro','announcement_title','Anunț nou'), ('en','announcement_title','New announcement'), ('de','announcement_title','Neue Anzeige'),
      ('ro','photo','Poză'), ('en','photo','Photo'), ('de','photo','Foto'),
      ('ro','channel_name','Comunitate TruckSOS'), ('en','channel_name','TruckSOS Community'), ('de','channel_name','TruckSOS Gemeinschaft'),
      ('ro','market_title','Anunț nou pe Market'), ('en','market_title','New listing on Market'), ('de','market_title','Neue Anzeige im Markt'),
      ('xx','channel_name','Comunitate TruckSOS')   -- limbă necunoscută → română
    ) AS e(lang, key, expected)
   WHERE push_text(e.lang, e.key) IS DISTINCT FROM e.expected;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'G1: push_text a schimbat texte existente: %', v_bad;
  END IF;
END $$;

-- ── 2. Comutatorul nou (DEFAULT constant → fără rescrierea tabelului) ────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mention_push_enabled boolean NOT NULL DEFAULT true;

-- ── 3. Anti-spam per pereche (destinatar, expeditor) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.direct_push_state (
  user_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_id        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_start     timestamptz NOT NULL DEFAULT now(),
  count_in_window  integer     NOT NULL DEFAULT 1,
  last_pushed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sender_id)
);
ALTER TABLE public.direct_push_state ENABLE ROW LEVEL SECURITY;
-- Fără politici: îl citește și îl scrie DOAR direct_push_allowed() (SECURITY DEFINER).
REVOKE ALL ON public.direct_push_state FROM anon;
REVOKE ALL ON public.direct_push_state FROM authenticated;
GRANT  ALL ON public.direct_push_state TO service_role;

-- Întoarce true (și înregistrează) dacă destinatarul mai poate primi acum un push direct de la
-- acest expeditor: minimum 30 s între două push-uri și cel mult 10 pe oră (D12).
CREATE OR REPLACE FUNCTION public.direct_push_allowed(p_user uuid, p_sender uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_gap  constant interval := interval '30 seconds';
  v_max_hour constant integer  := 10;
  v_st       public.direct_push_state%ROWTYPE;
BEGIN
  SELECT * INTO v_st FROM direct_push_state
   WHERE user_id = p_user AND sender_id = p_sender
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO direct_push_state (user_id, sender_id) VALUES (p_user, p_sender);
    RETURN true;
  END IF;
  IF v_st.last_pushed_at > now() - v_min_gap THEN
    RETURN false;
  END IF;
  IF v_st.window_start < now() - interval '1 hour' THEN
    UPDATE direct_push_state
       SET window_start = now(), count_in_window = 1, last_pushed_at = now()
     WHERE user_id = p_user AND sender_id = p_sender;
    RETURN true;
  END IF;
  IF v_st.count_in_window >= v_max_hour THEN
    RETURN false;
  END IF;
  UPDATE direct_push_state
     SET count_in_window = count_in_window + 1, last_pushed_at = now()
   WHERE user_id = p_user AND sender_id = p_sender;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.direct_push_allowed(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Retenție: starea mai veche de 7 zile nu mai contează. Același nume = idempotent.
SELECT cron.schedule(
  'cleanup-direct-push-state-daily',
  '53 3 * * *',
  $JOB$ DELETE FROM public.direct_push_state WHERE last_pushed_at < now() - interval '7 days'; $JOB$
);

-- ── 4. Canal: destinatarii adresați întâi, apoi digest-ul de până acum ──────
-- Corpul digest-ului = 20260914_channel_push_digest.sql, neschimbat în logică; în plus:
-- blocul „adresați” înaintea buclei și excluderea lor din buclă (v_done).
CREATE OR REPLACE FUNCTION public.on_channel_message_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $body$
DECLARE
  v_cooldown constant interval := interval '2 minutes';
  v_rec      record;
  v_addr     record;
  v_sender   text;
  v_lang     text;
  v_cursor   timestamptz;
  v_since    timestamptz;
  v_count    integer;
  v_body     text;
  v_title    text;
  v_line_new text;
  v_short    text;
  v_done     uuid[] := '{}';
BEGIN
  SELECT full_name INTO v_sender FROM profiles WHERE id = NEW.sender_id;

  -- Linia mesajului curent (corpul de pe iOS + plasa de siguranță a digest-ului).
  v_short := COALESCE(
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
  v_line_new := left(COALESCE(v_sender, '?'), 24) || ': ' || v_short;

  -- ── 4a. Adresați: autorul mesajului citat ∪ mențiunile (max 5), imediat, fără pauză ──
  FOR v_addr IN
    SELECT DISTINCT ON (x.user_id) x.user_id, x.kind
      FROM (
        SELECT m.sender_id AS user_id, 'reply'::text AS kind, 0::bigint AS ord
          FROM channel_messages m
         WHERE NEW.reply_to_id IS NOT NULL AND m.id = NEW.reply_to_id
        UNION ALL
        SELECT (t.e->>'id')::uuid, 'mention', t.ord
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(NEW.mentions) = 'array' THEN NEW.mentions ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS t(e, ord)
         WHERE (t.e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) x
      JOIN profiles pr ON pr.id = x.user_id
     WHERE x.user_id <> NEW.sender_id
       AND pr.push_enabled
       AND pr.mention_push_enabled
       AND pr.deleted_at IS NULL
       AND pr.created_at <= NEW.created_at                -- since-join, ca RLS-ul și ca digest-ul
       AND NOT is_block_between(NEW.sender_id, x.user_id)
     ORDER BY x.user_id, x.ord                            -- reply (ord 0) are prioritate la dubluri
     LIMIT 5
  LOOP
    IF NOT direct_push_allowed(v_addr.user_id, NEW.sender_id) THEN
      -- Peste limită: NU-l pierdem; rămâne în digest-ul obișnuit de mai jos.
      CONTINUE;
    END IF;
    v_lang  := user_lang(v_addr.user_id);
    v_title := format(push_text(v_lang, v_addr.kind || '_title'), left(COALESCE(v_sender, '?'), 24));

    PERFORM notify_push(
      v_addr.user_id,
      v_title,
      left(v_short, 140),
      jsonb_build_object('type', 'channel', 'id', NEW.channel_id,
                         'message_id', NEW.id, 'kind', v_addr.kind),
      'mention-' || NEW.channel_id,
      v_title,
      left(v_short, 140)
    );
    -- Digest-ul nu trebuie să-i repete mesajul: cursorul lui de push devine „acum”.
    INSERT INTO channel_push_state (user_id, channel_id, last_pushed_at)
    VALUES (v_addr.user_id, NEW.channel_id, now())
    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_pushed_at = now();
    v_done := v_done || v_addr.user_id;
  END LOOP;

  -- ── 4b. Digest-ul de până acum, pentru restul membrilor ──
  FOR v_rec IN
    SELECT p.user_id, pr.created_at AS joined_at, st.last_pushed_at
    FROM channel_push_prefs p
    JOIN profiles pr ON pr.id = p.user_id
    LEFT JOIN channel_push_state st
           ON st.user_id = p.user_id AND st.channel_id = p.channel_id
    WHERE p.channel_id = NEW.channel_id
      AND p.enabled
      AND p.user_id <> NEW.sender_id
      AND NOT (p.user_id = ANY (v_done))
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
EXCEPTION WHEN OTHERS THEN
  -- Regula zero: notificarea nu are voie să blocheze mesajul.
  RAISE WARNING 'on_channel_message_notify: % (mesaj %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$body$;

-- ── 5. Chat privat: titlu de reply / mențiune (fără pauză, ca până acum) ────
-- Corpul = 20260914_push_ios_threads_channel_cooldown.sql §4 + alegerea titlului + EXCEPTION.
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
  v_ios_title text;
  v_line_new  text;
  v_kind      text;
  v_data      jsonb;
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

  -- 27 oct 2026: mesajul e reply la destinatar sau îl menționează → titlu explicit.
  v_kind := NULL;
  IF NEW.reply_to_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM messages q WHERE q.id = NEW.reply_to_id AND q.sender_id = v_recipient) THEN
    v_kind := 'reply';
  ELSIF jsonb_typeof(NEW.mentions) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mentions) e WHERE e->>'id' = v_recipient::text) THEN
    v_kind := 'mention';
  END IF;

  v_data := jsonb_build_object('type', 'conversation', 'id', NEW.conversation_id);
  IF v_kind IS NOT NULL THEN
    v_title     := format(push_text(v_lang, v_kind || '_title'), left(COALESCE(v_sender, ''), 24));
    v_ios_title := v_title;
    v_data      := v_data || jsonb_build_object('message_id', NEW.id, 'kind', v_kind);
  ELSE
    v_title := COALESCE(v_sender, '');
    IF v_count > 1 THEN
      v_title := v_title || ' (' || v_count || ')';
    END IF;
    v_ios_title := COALESCE(v_sender, '');
  END IF;

  PERFORM notify_push(
    v_recipient,
    v_title,
    v_body,
    v_data,
    'conversation-' || NEW.conversation_id,
    v_ios_title,
    v_line_new
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'on_message_notify: % (mesaj %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$$;

-- Funcțiile-trigger nu se apelează direct; convenția rămâne (idempotent).
REVOKE EXECUTE ON FUNCTION public.on_channel_message_notify() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_message_notify()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.push_text(text, text)       FROM PUBLIC, anon;

-- ── 6. Verificare (eșec = EXCEPTION = nimic nu se aplică) ────────────────────
DO $$
DECLARE
  v_bad text := '';
BEGIN
  IF push_text('ro', 'mention_title') <> '%s te-a menționat' OR push_text('de', 'reply_title') <> '%s hat dir geantwortet' THEN
    v_bad := v_bad || ' [push_text fără cheile noi]';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'mention_push_enabled') THEN
    v_bad := v_bad || ' [profiles.mention_push_enabled lipsește]';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.direct_push_state'::regclass) THEN
    v_bad := v_bad || ' [direct_push_state fără RLS]';
  END IF;
  IF has_table_privilege('anon', 'public.direct_push_state', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'public.direct_push_state', 'SELECT, INSERT, UPDATE, DELETE') THEN
    v_bad := v_bad || ' [direct_push_state are grant-uri pentru client]';
  END IF;
  IF has_function_privilege('anon', 'public.direct_push_allowed(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.direct_push_allowed(uuid,uuid)', 'EXECUTE') THEN
    v_bad := v_bad || ' [direct_push_allowed executabilă de client]';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'channel_messages_notify' AND tgenabled <> 'D')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'messages_notify' AND tgenabled <> 'D') THEN
    v_bad := v_bad || ' [triggerele de push lipsesc sau sunt dezactivate]';
  END IF;
  IF pg_get_functiondef('public.on_channel_message_notify()'::regprocedure) NOT LIKE '%EXCEPTION WHEN OTHERS%'
     OR pg_get_functiondef('public.on_message_notify()'::regprocedure) NOT LIKE '%EXCEPTION WHEN OTHERS%' THEN
    v_bad := v_bad || ' [triggerele fără bloc EXCEPTION]';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'cleanup-direct-push-state-daily') <> 1 THEN
    v_bad := v_bad || ' [jobul cron lipsește]';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'G1 verificare EȘUATĂ:%', v_bad;
  END IF;
  RAISE NOTICE 'G1 verificare: PASS';
END $$;

-- Rezumat (ultimul rezultat afișat). Așteptat: toate PASS.
SELECT 1 AS nr, 'push_text: chei noi + cele vechi neschimbate' AS verificare, 'PASS' AS stare,
       push_text('ro', 'mention_title') || ' / ' || push_text('en', 'reply_title') AS detaliu
UNION ALL
SELECT 2, 'profiles.mention_push_enabled există, default true',
       CASE WHEN column_default = 'true' AND is_nullable = 'NO' THEN 'PASS' ELSE 'FAIL' END, column_default
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'mention_push_enabled'
UNION ALL
SELECT 3, 'direct_push_state: RLS, fără grant client, service_role ALL',
       CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.direct_push_state'::regclass)
                 AND NOT has_table_privilege('authenticated', 'public.direct_push_state', 'SELECT')
                 AND has_table_privilege('service_role', 'public.direct_push_state', 'SELECT, INSERT, UPDATE, DELETE')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 4, 'triggerele de push active, cu EXCEPTION',
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN ('channel_messages_notify', 'messages_notify') AND tgenabled <> 'D') = 2
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 5, 'job cron cleanup-direct-push-state-daily',
       CASE WHEN (SELECT count(*) FROM cron.job WHERE jobname = 'cleanup-direct-push-state-daily') = 1 THEN 'PASS' ELSE 'FAIL' END, ''
ORDER BY nr;
