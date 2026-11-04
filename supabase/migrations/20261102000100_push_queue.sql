-- Faza 3.1 (PLAN_1.1_FIX #6, #31, #4 restul; §8 pct 1 latență ≤ 10 s; plan: .claude/wip/faza3/PLAN-faza3.md):
-- push-urile NU mai pleacă din triggere prin net.http_post (sincron, câte un apel per token, buclă pe toți
-- membrii canalului / toți mecanicii), ci se scriu într-o coadă `app.push_queue`; Edge Function-ul `push-dispatch`
-- (pg_cron la 5 s, doar când coada are rânduri scadente) le trimite la Expo în loturi de 100, cu access token.
--
-- Ce rămâne IDENTIC pentru aplicațiile publicate 1.0.6–1.0.8: semnătura `notify_push`, toți apelanții ei,
-- conținutul notificărilor (titlu/corp/data/tag/variantele iOS) și cele două forme de payload (construite acum
-- în EF, cu teste). Singura diferență vizibilă: întârzierea de câteva secunde (≤ 10 s tranzacțional, digest-ul
-- canalului la 1 min).
--
-- Schema `app` există din baseline (GRANT USAGE anon/authenticated/service_role; default privileges REVOKE):
-- tabelele de aici n-au niciun GRANT și au RLS pornit fără politici — accesul e doar prin funcțiile SECURITY
-- DEFINER de mai jos. `app` nu e expusă prin PostgREST, de aceea RPC-urile pentru EF stau în `public`, cu EXECUTE
-- DOAR pentru service_role (intră în allowlist-urile din security_checklist ca excepții service_role).
--
-- Rollback: supabase/rollback/20261102000100_push_queue.sql (funcțiile vechi din 20261101000100, cron-urile
-- scoase, tabelele șterse — rândurile netrimise din coadă se pierd).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ── 0. Precondiții ─────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('app.profiles') IS NULL OR to_regclass('app.announcements') IS NULL THEN
    RAISE EXCEPTION 'faza 3 cere faza 4 aplicata (app.profiles / app.announcements)';
  END IF;
  IF to_regclass('app.push_queue') IS NOT NULL THEN
    RAISE EXCEPTION 'app.push_queue exista deja: migrarea a fost aplicata?';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_cron si pg_net trebuie instalate';
  END IF;
  -- '5 seconds' cere pg_cron >= 1.5
  IF (SELECT split_part(extversion, '.', 1)::int * 100 + split_part(extversion, '.', 2)::int FROM pg_extension WHERE extname = 'pg_cron') < 105 THEN
    RAISE EXCEPTION 'pg_cron % nu accepta intervale in secunde (cere >= 1.5)', (SELECT extversion FROM pg_extension WHERE extname = 'pg_cron');
  END IF;
END $$;

-- ── 1. Tabelele cozii (în app; fără grant-uri; RLS pornit, fără politici) ──────────────────────────
CREATE TABLE app.push_queue (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
  -- Retenția (decizia lui David, 2 nov): conținutul (title, body, ios_title, ios_body) e NULL după `sent`/`failed`/
  -- `expired` — rândul păstrează doar metadate (data = tip + id-uri, status, attempts, last_error; biletele în
  -- push_tickets) și e șters după 48 h de `cleanup_push_queue()`. De aceea coloanele sunt nullable; notify_push scrie mereu text.
  title       text,
  body        text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  tag         text,
  ios_title   text,
  ios_body    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  send_after  timestamptz NOT NULL DEFAULT now(),
  attempts    integer NOT NULL DEFAULT 0,
  -- `expired` (decizia lui David, 3 nov): un rând `queued` mai vechi de 1 h nu se mai trimite (claim_push_batch îl
  -- marchează); orice valoare > 0 în push_stats().expired_24h e incident (EF picat, token Expo greșit, cotă).
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'expired')),
  claimed_at  timestamptz,
  sent_at     timestamptz,
  last_error  text
);
COMMENT ON TABLE app.push_queue IS 'Faza 3: coada de push; scrisă de notify_push/digest, consumată de EF push-dispatch prin claim_push_batch/finish_push_batch.';
CREATE INDEX push_queue_due_idx      ON app.push_queue (send_after, id) WHERE status = 'queued';
CREATE INDEX push_queue_sending_idx  ON app.push_queue (claimed_at) WHERE status = 'sending';
CREATE INDEX push_queue_done_idx     ON app.push_queue (created_at) WHERE status IN ('sent', 'failed', 'expired');
ALTER TABLE app.push_queue ENABLE ROW LEVEL SECURITY;
-- Convenția din check-migrations (ca app.rate_events): nimic pentru anon/authenticated, service_role explicit
-- (schema `app` nu e expusă prin API, deci grant-ul e doar pentru unelte de administrare).
REVOKE ALL ON TABLE app.push_queue FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE app.push_queue TO service_role;
REVOKE ALL ON SEQUENCE app.push_queue_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE app.push_tickets (
  ticket_id           text PRIMARY KEY,
  queue_id            bigint NOT NULL REFERENCES app.push_queue(id) ON DELETE CASCADE,
  token               text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  receipt_checked_at  timestamptz,
  receipt_status      text,
  receipt_error       text
);
COMMENT ON TABLE app.push_tickets IS 'Faza 3: biletele Expo (ticket → token), pentru getReceipts la 15 min (DeviceNotRegistered → tokenul se șterge).';
CREATE INDEX push_tickets_pending_idx ON app.push_tickets (created_at) WHERE receipt_checked_at IS NULL;
ALTER TABLE app.push_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.push_tickets FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE app.push_tickets TO service_role;

CREATE TABLE app.channel_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id  uuid NOT NULL,
  message_id  uuid NOT NULL,
  sender_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE app.channel_events IS 'Faza 3: mesajele din canal de digerat (consumate de app.build_channel_digests la 1 min).';
CREATE INDEX channel_events_created_idx ON app.channel_events (created_at);
ALTER TABLE app.channel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.channel_events FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE app.channel_events TO service_role;
REVOKE ALL ON SEQUENCE app.channel_events_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ── 2. notify_push: aceleași verificări, apoi doar INSERT în coadă ─────────────────────────────────
-- Semnătura și search_path-ul rămân (apelanții folosesc nume necalificate). Payload-ul (cele două forme
-- iOS/Android) se construiește în EF din exact aceste coloane.
CREATE OR REPLACE FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb DEFAULT '{}'::jsonb, p_tag text DEFAULT NULL::text, p_ios_title text DEFAULT NULL::text, p_ios_body text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_enabled boolean;
BEGIN
  -- Comutatorul global din Setări.
  SELECT push_enabled INTO v_enabled FROM app.profiles WHERE id = p_user_id;
  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;
  -- Conturile banate nu primesc push (indiferent de preferință) — 18.4b.
  IF is_banned(p_user_id) THEN
    RETURN;
  END IF;
  -- Fără dispozitive înregistrate nu e nimic de trimis (azi bucla pe tokeni era goală).
  IF NOT EXISTS (SELECT 1 FROM push_tokens WHERE user_id = p_user_id) THEN
    RETURN;
  END IF;
  INSERT INTO app.push_queue (user_id, title, body, data, tag, ios_title, ios_body)
  -- COALESCE: un NULL de la un apelant viitor nu poate transforma INSERT-ul de business într-o excepție (review 2 nov).
  VALUES (p_user_id, COALESCE(p_title, ''), COALESCE(p_body, ''), COALESCE(p_data, '{}'::jsonb), p_tag, p_ios_title, p_ios_body);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb, p_tag text, p_ios_title text, p_ios_body text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb, p_tag text, p_ios_title text, p_ios_body text) TO service_role;

-- ── 3. Linia unui mesaj de canal (același format ca azi, în trigger și în digest) ──────────────────
CREATE FUNCTION app.channel_message_line(p_content text, p_file_name text, p_listing_id uuid, p_recommended_mechanic_id uuid, p_announcement_id uuid, p_max_content integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_content IS NOT NULL AND p_content <> '' THEN CASE WHEN p_max_content IS NULL THEN p_content ELSE left(p_content, p_max_content) END
    WHEN p_file_name IS NOT NULL AND lower(p_file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$' THEN '🎥 ' || left(p_file_name, 98)
    WHEN p_file_name IS NOT NULL THEN '📎 ' || left(p_file_name, 98)
    WHEN p_listing_id IS NOT NULL THEN '🏷️'
    WHEN p_recommended_mechanic_id IS NOT NULL THEN '👤'
    WHEN p_announcement_id IS NOT NULL THEN '📍'
    ELSE '📷'
  END;
$function$;
REVOKE EXECUTE ON FUNCTION app.channel_message_line(text, text, uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;

-- ── 4. on_channel_message_notify: 4a identic (reply + mențiuni, imediat, prin coadă); 4b = un eveniment ──
CREATE OR REPLACE FUNCTION public.on_channel_message_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_addr     record;
  v_sender   text;
  v_lang     text;
  v_title    text;
  v_short    text;
BEGIN
  SELECT full_name INTO v_sender FROM app.profiles WHERE id = NEW.sender_id;
  v_short := app.channel_message_line(NEW.content, NEW.file_name, NEW.listing_id, NEW.recommended_mechanic_id, NEW.announcement_id, NULL);

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
      JOIN app.profiles pr ON pr.id = x.user_id
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
      -- Peste limită: NU-l pierdem; rămâne în digest-ul obișnuit.
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
  END LOOP;

  -- ── 4b. Digest-ul pentru restul membrilor: un singur rând, consumat de app.build_channel_digests() la 1 min ──
  INSERT INTO app.channel_events (channel_id, message_id, sender_id, created_at)
  VALUES (NEW.channel_id, NEW.id, NEW.sender_id, NEW.created_at);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Regula zero: notificarea nu are voie să blocheze mesajul.
  RAISE WARNING 'on_channel_message_notify: % (mesaj %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$function$;

-- ── 5. Digest-ul canalului, set-based (cron la 1 min) ──────────────────────────────────────────────
-- Semantica de azi, păstrată: cooldown 2 min cu aceeași condiție pe cursor, since = GREATEST(cursor,
-- last_pushed_at), count-ul mesajelor necitite plafonat la 100, ultimele 5 linii, since-join pe created_at al
-- profilului, excluderea expeditorului și a perechilor blocate, upsert în channel_push_state pentru cei
-- notificați. Diferențe voite: (1) un membru care a CITIT canalul între mesaj și rulare nu mai primește push;
-- (2) membrii aflați în cooldown la rulare nu primesc nimic pentru evenimentele consumate (ca azi, când mesajul
-- din cooldown nu producea push); următorul mesaj îi prinde cu count-ul corect, calculat de la cursor.
CREATE FUNCTION app.build_channel_digests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cooldown constant interval := interval '2 minutes';
  v_sent integer := 0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS tmp_digest (
    user_id uuid, channel_id uuid, lang text, cnt integer, body text, newest text
  ) ON COMMIT DROP;
  TRUNCATE tmp_digest;

  WITH ev AS (
    DELETE FROM app.channel_events RETURNING channel_id, message_id, sender_id, created_at
  ),
  ch AS (
    SELECT channel_id, max(created_at) AS last_event_at FROM ev GROUP BY channel_id
  ),
  members AS (
    SELECT p.user_id, p.channel_id, COALESCE(pr.lang, 'ro') AS lang, pr.created_at AS joined_at,
           st.last_pushed_at, cr.last_read_at AS cursor_at
      FROM ch
      JOIN public.channel_push_prefs p ON p.channel_id = ch.channel_id AND p.enabled
      JOIN app.profiles pr ON pr.id = p.user_id AND pr.push_enabled AND pr.deleted_at IS NULL
      LEFT JOIN public.channel_push_state st ON st.user_id = p.user_id AND st.channel_id = p.channel_id
      LEFT JOIN public.channel_reads cr ON cr.channel_id = p.channel_id AND cr.user_id = p.user_id
     WHERE EXISTS (SELECT 1 FROM ev e
                    WHERE e.channel_id = p.channel_id
                      AND e.sender_id <> p.user_id
                      AND e.created_at >= pr.created_at
                      AND (cr.last_read_at IS NULL OR e.created_at > cr.last_read_at)
                      AND NOT public.is_block_between(e.sender_id, p.user_id))
       AND NOT (st.last_pushed_at IS NOT NULL
                AND st.last_pushed_at > now() - v_cooldown
                AND (cr.last_read_at IS NULL OR cr.last_read_at < st.last_pushed_at))
  )
  -- Fără „plasa de siguranță” de azi (linia lui NEW): dacă după `since` nu mai există nicio linie vizibilă
  -- membrului (mesajul a fost șters între timp, sau autorul e blocat), membrul nu primește nimic și cursorul lui
  -- de push nu se mută (review 2 nov: fallback-ul pe „cel mai nou mesaj din canal” ar fi scurs conținut blocat/moderat).
  INSERT INTO tmp_digest (user_id, channel_id, lang, cnt, body, newest)
  SELECT m.user_id, m.channel_id, m.lang,
         (SELECT count(*) FROM (
            SELECT 1 FROM public.channel_messages cm
             WHERE cm.channel_id = m.channel_id AND cm.sender_id <> m.user_id AND cm.deleted_at IS NULL
               AND (m.cursor_at IS NULL OR cm.created_at > m.cursor_at)
               AND cm.created_at >= m.joined_at
               AND NOT public.is_block_between(cm.sender_id, m.user_id)
             LIMIT 100) c)::integer,
         lines.body, lines.newest
    FROM members m
    JOIN LATERAL (
      -- liniile digest-ului (conținut tăiat la 100, ca azi) și, separat, linia completă a celui mai nou mesaj
      -- (corpul iOS de azi era linia lui NEW, netăiată)
      SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at ASC) AS body,
             (array_agg(sub.line_full ORDER BY sub.created_at DESC))[1] AS newest
        FROM (
          SELECT cm.created_at,
                 left(COALESCE(pr.full_name, '?'), 24) || ': ' ||
                 app.channel_message_line(cm.content, cm.file_name, cm.listing_id, cm.recommended_mechanic_id, cm.announcement_id, 100) AS line,
                 left(COALESCE(pr.full_name, '?'), 24) || ': ' ||
                 app.channel_message_line(cm.content, cm.file_name, cm.listing_id, cm.recommended_mechanic_id, cm.announcement_id, NULL) AS line_full
            FROM public.channel_messages cm
            JOIN app.profiles pr ON pr.id = cm.sender_id
           WHERE cm.channel_id = m.channel_id AND cm.sender_id <> m.user_id AND cm.deleted_at IS NULL
             AND (GREATEST(m.cursor_at, m.last_pushed_at) IS NULL OR cm.created_at > GREATEST(m.cursor_at, m.last_pushed_at))
             AND cm.created_at >= m.joined_at
             AND NOT public.is_block_between(cm.sender_id, m.user_id)
           ORDER BY cm.created_at DESC
           LIMIT 5
        ) sub
    ) lines ON lines.body IS NOT NULL;

  -- Aceleași verificări ca notify_push (push_enabled e deja filtrat): banați și fără tokeni nu primesc rând.
  INSERT INTO app.push_queue (user_id, title, body, data, tag, ios_title, ios_body)
  SELECT d.user_id,
         public.push_text(d.lang, 'channel_name') || CASE WHEN d.cnt > 1 THEN ' (' || d.cnt || ')' ELSE '' END,
         d.body,
         jsonb_build_object('type', 'channel', 'id', d.channel_id),
         'channel-' || d.channel_id,
         public.push_text(d.lang, 'channel_name') || CASE WHEN d.cnt > 1 THEN ' (' || d.cnt || ')' ELSE '' END,
         d.newest
    FROM tmp_digest d
   WHERE d.body IS NOT NULL
     AND NOT public.is_banned(d.user_id)
     AND EXISTS (SELECT 1 FROM public.push_tokens t WHERE t.user_id = d.user_id);
  GET DIAGNOSTICS v_sent = ROW_COUNT;

  -- Ca azi: cursorul de push se mută pentru toți cei pentru care s-a decis un digest.
  INSERT INTO public.channel_push_state (user_id, channel_id, last_pushed_at)
  SELECT d.user_id, d.channel_id, now() FROM tmp_digest d
  ON CONFLICT (user_id, channel_id) DO UPDATE SET last_pushed_at = now();

  RETURN v_sent;
END;
$function$;
REVOKE EXECUTE ON FUNCTION app.build_channel_digests() FROM PUBLIC, anon, authenticated;

-- ── 6. notify_mechanics_new_announcement: set-based, cu cutie de delimitare înaintea distanței ────────
-- Aceleași filtre ca azi (role, nu șoferul, push_enabled, blocări, raza NULL = toți) + cele din notify_push
-- (banat, fără tokeni). Cutia (lat/lng ± rază) e evaluată înaintea lui distance_km; mecanicii sunt sute, deci
-- scanarea pe idx_profiles_mechanic_push + filtrul aritmetic țin sub o milisecundă fără bucla de azi.
CREATE OR REPLACE FUNCTION public.notify_mechanics_new_announcement(p_announcement app.announcements)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  INSERT INTO app.push_queue (user_id, title, body, data)
  SELECT m.id,
         push_text(COALESCE(m.lang, 'ro'), 'announcement_title'),
         p_announcement.location,
         jsonb_build_object('type', 'feed', 'id', p_announcement.id)
    FROM app.profiles m
   WHERE m.role = 'mechanic'
     AND m.id <> p_announcement.driver_id
     AND m.push_enabled
     AND NOT is_block_between(p_announcement.driver_id, m.id)   -- Faza 18
     AND NOT is_banned(m.id)
     AND EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id = m.id)
     AND (
       m.notify_radius_km IS NULL
       OR (
         p_announcement.latitude IS NOT NULL AND p_announcement.longitude IS NOT NULL
         AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
         AND m.latitude  BETWEEN p_announcement.latitude  - m.notify_radius_km / 111.0
                             AND p_announcement.latitude  + m.notify_radius_km / 111.0
         AND m.longitude BETWEEN p_announcement.longitude - m.notify_radius_km / (111.0 * greatest(cos(radians(p_announcement.latitude)), 0.01))
                             AND p_announcement.longitude + m.notify_radius_km / (111.0 * greatest(cos(radians(p_announcement.latitude)), 0.01))
         AND distance_km(m.latitude, m.longitude, p_announcement.latitude, p_announcement.longitude) <= m.notify_radius_km
       )
     );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.notify_mechanics_new_announcement(p_announcement app.announcements) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_mechanics_new_announcement(p_announcement app.announcements) TO service_role;

-- ── 6b. Ștergerea contului curăță și coada (review 2 nov) ──────────────────────────────────────────
-- >>> purge_user_data (generat de gen-purge.mjs)
-- public._purge_user_data: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public._purge_user_data(p_uid uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted timestamptz;
  v_paths   text[] := '{}';
  v_avatar  text;
  v_ann     text[];
  v_chat    text[];
  v_chan    text[];
  v_market  text[];
  v_files   text[];
BEGIN
  -- ── Idempotență: dacă profilul nu există sau e deja piatră-funerară, nu facem nimic ──
  SELECT deleted_at INTO v_deleted FROM app.profiles WHERE id = p_uid;
  IF NOT FOUND OR v_deleted IS NOT NULL THEN
    RETURN '{}';
  END IF;

  -- ── PASUL 0: colectăm căile Storage ÎNAINTE de orice DELETE/UPDATE ──
  -- a) avatarul propriu
  SELECT avatar_path INTO v_avatar FROM app.profiles WHERE id = p_uid;
  IF v_avatar IS NOT NULL THEN
    v_paths := v_paths || v_avatar;
  END IF;

  -- b) pozele anunțurilor lui de depanare
  SELECT COALESCE(array_agg(ap.storage_path), '{}')
  INTO v_ann
  FROM announcement_photos ap
  JOIN app.announcements a ON a.id = ap.announcement_id
  WHERE a.driver_id = p_uid;
  v_paths := v_paths || v_ann;

  -- c) pozele lui din chat privat — DOAR cele care NU sunt dovadă într-un raport `pending`
  SELECT COALESCE(array_agg(m.image_path), '{}')
  INTO v_chat
  FROM messages m
  WHERE m.sender_id = p_uid
    AND m.image_path IS NOT NULL
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_chat;

  -- d) pozele lui din canale — același tratament + guard de dovadă
  SELECT COALESCE(array_agg(cm.image_path), '{}')
  INTO v_chan
  FROM channel_messages cm
  WHERE cm.sender_id = p_uid
    AND cm.image_path IS NOT NULL
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_chan;

  -- e) FAZA 19: pozele anunțurilor lui de MARKET (rândurile cascadează cu anunțul,
  --    obiectele Storage nu — identic cu pozele de depanare)
  SELECT COALESCE(array_agg(mp.storage_path), '{}')
  INTO v_market
  FROM market_listing_photos mp
  JOIN market_listings l ON l.id = mp.listing_id
  WHERE l.seller_id = p_uid;
  v_paths := v_paths || v_market;

  -- f) FAZA 19.5: fișierele lui din chat privat + canale (guard de dovadă identic)
  SELECT COALESCE(array_agg(m.file_path), '{}')
  INTO v_files
  FROM messages m
  WHERE m.sender_id = p_uid
    AND m.file_path IS NOT NULL
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_files;

  SELECT COALESCE(array_agg(cm.file_path), '{}')
  INTO v_files
  FROM channel_messages cm
  WHERE cm.sender_id = p_uid
    AND cm.file_path IS NOT NULL
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_files;

  -- ── PASUL 1: tombstone pentru mesajele-poză ȘI mesajele-fișier ale lui ──
  UPDATE messages m
  SET content = '', image_path = NULL,
      file_path = NULL, file_name = NULL, file_size = NULL,
      deleted_at = now()
  WHERE m.sender_id = p_uid
    AND (m.image_path IS NOT NULL OR m.file_path IS NOT NULL)
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );

  UPDATE channel_messages cm
  SET content = '', image_path = NULL,
      file_path = NULL, file_name = NULL, file_size = NULL,
      deleted_at = now()
  WHERE cm.sender_id = p_uid
    AND (cm.image_path IS NOT NULL OR cm.file_path IS NOT NULL)
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );

  -- ── PASUL 2: ȘTERGERI explicite ──
  DELETE FROM app.announcements       WHERE driver_id   = p_uid;
  -- FAZA 19: anunțurile de market (cascade market_listing_photos; conversations.listing_id
  -- → SET NULL — conversațiile SUPRAVIEȚUIESC, ca la anunțurile de depanare; rapoartele pe
  -- anunțuri rămân ANONIMIZATE prin piatra-funerară + snapshot).
  DELETE FROM market_listings     WHERE seller_id   = p_uid;
  DELETE FROM trucks              WHERE driver_id   = p_uid;
  DELETE FROM applications        WHERE mechanic_id = p_uid;
  DELETE FROM ratings             WHERE driver_id   = p_uid;
  DELETE FROM ratings             WHERE mechanic_id = p_uid;
  DELETE FROM favorite_mechanics  WHERE driver_id   = p_uid OR mechanic_id = p_uid;
  DELETE FROM search_history      WHERE driver_id   = p_uid OR mechanic_id = p_uid;
  DELETE FROM message_reads       WHERE user_id     = p_uid;
  DELETE FROM conversation_deletions WHERE user_id  = p_uid;
  DELETE FROM channel_reads       WHERE user_id     = p_uid;
  DELETE FROM push_tokens         WHERE user_id     = p_uid;
  -- Faza 3.1 (review 2 nov): profilul rămâne piatră funerară, deci cascada de pe app.push_queue nu se declanșează;
  -- conținutul push-urilor (titluri/corpuri de mesaje) și biletele (tokeni) se șterg explicit.
  DELETE FROM app.push_queue      WHERE user_id     = p_uid;

  -- ── PASUL 3: scrub PII pe profil → piatră-funerară ──
  -- 25 oct 2026 (A1): + address / vat_number / company_name / contact_email — rămâneau
  -- pe piatra funerară și erau citibile de orice cont logat (profiles_select_all).
  UPDATE app.profiles SET
    full_name      = '',
    avatar_path    = NULL,
    phone          = NULL,
    specialization = NULL,
    activity_zone  = NULL,
    latitude       = NULL,
    longitude      = NULL,
    address        = NULL,
    vat_number     = NULL,
    company_name   = NULL,
    contact_email  = NULL,
    push_enabled   = false,
    deleted_at     = now()
  WHERE id = p_uid;

  RETURN v_paths;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public._purge_user_data(p_uid uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._purge_user_data(p_uid uuid) TO service_role;
-- <<< purge_user_data

-- ── 7. RPC-urile pentru Edge Functions (public, SECURITY DEFINER, EXECUTE doar service_role) ────────
-- claim: rândurile `sending` uitate (EF mort după claim) revin în `queued` după 2 min; apoi cele scadente se
-- marchează `sending` (FOR UPDATE SKIP LOCKED: două EF-uri în paralel nu iau același rând) și se întorc câte
-- un rând PER TOKEN; rândurile ai căror utilizatori nu mai au tokeni devin `failed` (no_tokens). `claimed_at` se întoarce și
-- se retrimite la finish: un EF lent care termină după reclaim nu mai poate marca rândul revendicat de altul (review 2 nov).
-- Default 100 = o iterație EF ≈ 1–2 POST-uri Expo, sub bugetul de 20 s și departe de reclaim-ul de 2 min.
CREATE FUNCTION public.claim_push_batch(p_limit integer DEFAULT 100)
 RETURNS TABLE (queue_id bigint, token text, platform text, title text, body text, data jsonb, tag text, ios_title text, ios_body text, attempts integer, claimed_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- același prag ca în finish_push_batch (a 6-a eroare → failed)
  v_max_attempts constant integer := 6;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    p_limit := 100;
  END IF;

  -- Un rând care „omoară” EF-ul nu se reia la nesfârșit: recuperarea costă o încercare (review 2 nov).
  UPDATE app.push_queue q
     SET attempts   = q.attempts + 1,
         status     = CASE WHEN q.attempts + 1 >= v_max_attempts THEN 'failed' ELSE 'queued' END,
         claimed_at = NULL,
         last_error = 'reclaimed_after_timeout',
         -- retenție: la failed conținutul se golește (rămân metadatele)
         title      = CASE WHEN q.attempts + 1 >= v_max_attempts THEN NULL ELSE q.title END,
         body       = CASE WHEN q.attempts + 1 >= v_max_attempts THEN NULL ELSE q.body END,
         ios_title  = CASE WHEN q.attempts + 1 >= v_max_attempts THEN NULL ELSE q.ios_title END,
         ios_body   = CASE WHEN q.attempts + 1 >= v_max_attempts THEN NULL ELSE q.ios_body END
   WHERE q.status = 'sending' AND q.claimed_at < now() - interval '2 minutes';

  -- Expirarea (decizia lui David, 3 nov): un push despre ceva de acum o oră încă are sens, de acum o zi nu. Rândurile
  -- `queued` mai vechi de 1 h (inclusiv cele reîncercate/eliberate între timp ȘI cele tocmai recuperate după timeout —
  -- de aceea pasul e DUPĂ recuperare, review (c)) nu se mai trimit: `expired`, conținut golit, metadate 48 h. Așa, după
  -- un EF picat ore întregi, coada veche NU pleacă deodată la repornire. Rândurile `sending` cu claim viu nu se ating.
  UPDATE app.push_queue q
     SET status = 'expired', claimed_at = NULL, last_error = 'expired',
         title = NULL, body = NULL, ios_title = NULL, ios_body = NULL
   WHERE q.status = 'queued' AND q.created_at < now() - interval '1 hour';

  RETURN QUERY
  WITH c AS (
    SELECT q.id
      FROM app.push_queue q
     WHERE q.status = 'queued' AND q.send_after <= now()
     ORDER BY q.send_after, q.id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE app.push_queue q
       SET status = 'sending', claimed_at = now()
      FROM c
     WHERE q.id = c.id
    RETURNING q.id, q.user_id, q.title, q.body, q.data, q.tag, q.ios_title, q.ios_body, q.attempts, q.claimed_at
  )
  SELECT u.id, t.token, t.platform, u.title, u.body, u.data, u.tag, u.ios_title, u.ios_body, u.attempts, u.claimed_at
    FROM u
    JOIN public.push_tokens t ON t.user_id = u.user_id;

  UPDATE app.push_queue q
     SET status = 'failed', claimed_at = NULL, last_error = 'no_tokens',
         title = NULL, body = NULL, ios_title = NULL, ios_body = NULL
   WHERE q.status = 'sending'
     AND NOT EXISTS (SELECT 1 FROM public.push_tokens t WHERE t.user_id = q.user_id);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.claim_push_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_batch(integer) TO service_role;

-- finish: p_results = [{queue_id, claimed_at, outcome: 'sent'|'retry'|'failed'|'release', error, tickets: [{ticket_id, token}], dead_tokens: [token]}]
-- `claimed_at` (string-ul primit la claim) trebuie să coincidă cu rândul; lipsă = fără verificare (compatibil cu testele).
-- `release` = EF-ul n-a ajuns să trimită (buget epuizat, autentificare Expo picată): rândul revine imediat în coadă FĂRĂ
-- a consuma o încercare.
CREATE FUNCTION public.finish_push_batch(p_results jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  r record;
  v_max_attempts constant integer := 6;
BEGIN
  IF p_results IS NULL OR jsonb_typeof(p_results) <> 'array' THEN
    RAISE EXCEPTION 'finish_push_batch: p_results trebuie sa fie un array';
  END IF;
  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_results)
      AS x(queue_id bigint, claimed_at timestamptz, outcome text, error text, tickets jsonb, dead_tokens jsonb)
  LOOP
    -- DeviceNotRegistered: Expo cere să nu mai trimitem la tokenul ăla. Doar tokenii utilizatorului rândului
    -- (apărare în plus: EF-ul nu poate șterge tokenii altcuiva).
    IF r.dead_tokens IS NOT NULL AND jsonb_typeof(r.dead_tokens) = 'array' THEN
      DELETE FROM public.push_tokens t
       WHERE t.token IN (SELECT jsonb_array_elements_text(r.dead_tokens))
         AND t.user_id = (SELECT q.user_id FROM app.push_queue q WHERE q.id = r.queue_id);
    END IF;

    IF r.outcome = 'sent' THEN
      -- retenție (decizia lui David, 2 nov): la sent/failed conținutul se golește; rămân metadatele (data, status,
      -- attempts, last_error) 48 h, apoi cleanup_push_queue() șterge rândul.
      UPDATE app.push_queue q
         SET status = 'sent', sent_at = now(), claimed_at = NULL, last_error = NULL,
             title = NULL, body = NULL, ios_title = NULL, ios_body = NULL
       WHERE q.id = r.queue_id AND q.status = 'sending' AND (r.claimed_at IS NULL OR q.claimed_at = r.claimed_at);
      IF r.tickets IS NOT NULL AND jsonb_typeof(r.tickets) = 'array' THEN
        INSERT INTO app.push_tickets (ticket_id, queue_id, token)
        SELECT t->>'ticket_id', r.queue_id, t->>'token'
          FROM jsonb_array_elements(r.tickets) t
         WHERE coalesce(t->>'ticket_id', '') <> '' AND coalesce(t->>'token', '') <> ''
        ON CONFLICT (ticket_id) DO NOTHING;
      END IF;
    ELSIF r.outcome = 'retry' THEN
      -- 429 / 5xx / rețea: backoff exponențial 30 s, 1 min, 2 min, 4 min, 8 min (5 reîncercări); a 6-a eroare → failed.
      UPDATE app.push_queue q
         SET attempts   = q.attempts + 1,
             status     = CASE WHEN q.attempts + 1 >= v_max_attempts THEN 'failed' ELSE 'queued' END,
             send_after = now() + (power(2, q.attempts) * interval '30 seconds'),
             claimed_at = NULL,
             last_error = left(r.error, 500),
             title      = CASE WHEN q.attempts + 1 >= v_max_attempts THEN NULL ELSE q.title END,
             body       = CASE WHEN q.attempts + 1 >= v_max_attempts THEN NULL ELSE q.body END,
             ios_title  = CASE WHEN q.attempts + 1 >= v_max_attempts THEN NULL ELSE q.ios_title END,
             ios_body   = CASE WHEN q.attempts + 1 >= v_max_attempts THEN NULL ELSE q.ios_body END
       WHERE q.id = r.queue_id AND q.status = 'sending' AND (r.claimed_at IS NULL OR q.claimed_at = r.claimed_at);
    ELSIF r.outcome = 'release' THEN
      UPDATE app.push_queue q
         -- expo_auth_*: tokenul Expo e gresit; randurile asteapta un minut (altfel fiecare tick de 5 s le-ar revendica degeaba)
         SET status = 'queued',
             send_after = CASE WHEN r.error LIKE 'expo_auth_%' THEN now() + interval '1 minute' ELSE now() END,
             claimed_at = NULL, last_error = left(r.error, 500)
       WHERE q.id = r.queue_id AND q.status = 'sending' AND (r.claimed_at IS NULL OR q.claimed_at = r.claimed_at);
    ELSE
      UPDATE app.push_queue q
         SET status = 'failed', claimed_at = NULL, last_error = left(coalesce(r.error, r.outcome), 500),
             title = NULL, body = NULL, ios_title = NULL, ios_body = NULL
       WHERE q.id = r.queue_id AND q.status = 'sending' AND (r.claimed_at IS NULL OR q.claimed_at = r.claimed_at);
    END IF;
  END LOOP;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.finish_push_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_push_batch(jsonb) TO service_role;

-- chitanțe: biletele trimise cu ≥ 15 min în urmă (Expo le ține 24 h); cele mai vechi de 24 h se închid ca `expired`.
CREATE FUNCTION public.pending_push_receipts(p_limit integer DEFAULT 1000)
 RETURNS TABLE (ticket_id text, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    p_limit := 1000;
  END IF;
  UPDATE app.push_tickets t
     SET receipt_checked_at = now(), receipt_status = 'expired'
   WHERE t.receipt_checked_at IS NULL AND t.created_at <= now() - interval '24 hours';
  RETURN QUERY
  SELECT t.ticket_id, t.token
    FROM app.push_tickets t
   WHERE t.receipt_checked_at IS NULL AND t.created_at <= now() - interval '15 minutes'
   ORDER BY t.created_at
   LIMIT p_limit;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.pending_push_receipts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pending_push_receipts(integer) TO service_role;

-- p_results = [{ticket_id, status: 'ok'|'error', error, dead: bool}]
CREATE FUNCTION public.finish_push_receipts(p_results jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  r record;
BEGIN
  IF p_results IS NULL OR jsonb_typeof(p_results) <> 'array' THEN
    RAISE EXCEPTION 'finish_push_receipts: p_results trebuie sa fie un array';
  END IF;
  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_results) AS x(ticket_id text, status text, error text, dead boolean)
  LOOP
    UPDATE app.push_tickets t
       SET receipt_checked_at = now(),
           receipt_status = CASE WHEN r.status = 'ok' THEN 'ok' ELSE 'error' END,
           receipt_error  = left(r.error, 500)
     WHERE t.ticket_id = r.ticket_id;
    IF r.dead IS TRUE THEN
      -- Chitanța vine cu 15 min–24 h întârziere: un token reînregistrat între timp (alt cont, reinstalare) nu se șterge.
      DELETE FROM public.push_tokens pt
       USING app.push_tickets t
       WHERE t.ticket_id = r.ticket_id AND pt.token = t.token AND pt.updated_at < t.created_at;
    END IF;
  END LOOP;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.finish_push_receipts(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_push_receipts(jsonb) TO service_role;

-- ── 8. Observabilitate (doar postgres, prin db query: SELECT * FROM app.push_stats()) ─────────────
-- `http_401_6h` / `http_errors_6h`: răspunsurile kick-urilor proprii (pg_net ține `net._http_response` ~6 h, deci e o
-- fereastră, nu un istoric; tabelul nu reține URL-ul, iar singurii apelanți pg_net ai bazei sunt kick-urile,
-- cleanup-announcements-hourly și storage_api_delete — contoarele prind și răspunsurile acelora, deci sunt o
-- alarmă, nu un diagnostic). Orice 401 > 0 = incident de investigat (cel mai probabil `push_kick_secret` ≠
-- `PUSH_KICK_SECRET`; posibil și cheia legacy a lui cleanup-announcements după o rotire) — decizia lui David, 3 nov.
-- 401-urile străinilor nu trec prin bază: se numără din logurile EF (Logs Explorer, function_edge_logs cu
-- status_code = 401 și function_id al celor două funcții).
CREATE FUNCTION app.push_stats()
 RETURNS TABLE (queued bigint, sending bigint, sent_1h bigint, sent_24h bigint, failed_24h bigint, oldest_queued_at timestamptz, receipt_errors_24h bigint, channel_events_pending bigint, http_401_6h bigint, http_errors_6h bigint, expired_24h bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT (SELECT count(*) FROM app.push_queue WHERE status = 'queued'),
         (SELECT count(*) FROM app.push_queue WHERE status = 'sending'),
         (SELECT count(*) FROM app.push_queue WHERE status = 'sent'   AND sent_at    > now() - interval '1 hour'),
         (SELECT count(*) FROM app.push_queue WHERE status = 'sent'   AND sent_at    > now() - interval '24 hours'),
         (SELECT count(*) FROM app.push_queue WHERE status = 'failed' AND created_at > now() - interval '24 hours'),
         (SELECT min(created_at) FROM app.push_queue WHERE status = 'queued'),
         (SELECT count(*) FROM app.push_tickets WHERE receipt_status = 'error' AND receipt_checked_at > now() - interval '24 hours'),
         (SELECT count(*) FROM app.channel_events),
         (SELECT count(*) FROM net._http_response r WHERE r.status_code = 401 AND r.created > now() - interval '6 hours'),
         (SELECT count(*) FROM net._http_response r WHERE (r.status_code IS DISTINCT FROM 200 OR r.error_msg IS NOT NULL OR r.timed_out) AND r.created > now() - interval '6 hours'),
         -- rândurile expirate sunt cu ≥ 1 h mai vechi decât crearea lor, deci fereastra pe created_at (25 h) ≈ „expirat în
         -- ultimele 24 h” pentru rândurile create recent; după o pană mai lungă de ~24 h, cele mai vechi nu intră în contor
         -- (alarma iese oricum > 0 cât timp mai vin rânduri). Alternativa „toate cele păstrate (48 h)” = decizie pentru David.
         (SELECT count(*) FROM app.push_queue WHERE status = 'expired' AND created_at > now() - interval '25 hours');
$function$;
REVOKE EXECUTE ON FUNCTION app.push_stats() FROM PUBLIC, anon, authenticated, service_role;

-- Curățarea zilnică a cozii (cron `cleanup-push-queue-daily`): șterge rândurile terminate și scrie în NOTICE contoarele
-- de incident din `push_stats()` (401-uri și erori HTTP ale kick-urilor). NOTICE-ul ajunge în logul Postgres (Logs
-- Explorer); dacă pg_cron îl pune și în `cron.job_run_details.return_message` se vede la primul rulaj — calea sigură
-- de citit rămâne `SELECT * FROM app.push_stats()`. Statisticile sunt într-un bloc EXCEPTION: observabilitatea nu are
-- voie să blocheze ștergerea (de ex. dacă `net._http_response` nu e lizibilă pentru rolul cron-ului).
CREATE FUNCTION app.cleanup_push_queue()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted int;
  v_stats record;
BEGIN
  -- 48 h, nu 7 zile (decizia lui David, 2 nov): conținutul e deja NULL din finish; biletele au nevoie de 24 h pentru
  -- chitanțe (push_tickets se șterg în cascadă). Pentru `sent` termenul curge de la `sent_at` (review: după o pană
  -- lungă un rând trimis târziu ar fi fost șters cu biletele lui înainte de chitanță); pentru `failed`, de la `created_at`.
  DELETE FROM app.push_queue
   WHERE (status = 'sent'   AND coalesce(sent_at, created_at) < now() - interval '48 hours')
      OR (status IN ('failed', 'expired') AND created_at < now() - interval '48 hours');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  BEGIN
    SELECT * INTO v_stats FROM app.push_stats();
    -- expired_24h > 0 = incident (decizia lui David, 3 nov): EF picat, token Expo greșit, cotă.
    RAISE NOTICE 'cleanup_push_queue: sterse=% queued=% oldest_queued_at=% expired_24h=% http_401_6h=% http_errors_6h=%',
      v_deleted, v_stats.queued, v_stats.oldest_queued_at, v_stats.expired_24h, v_stats.http_401_6h, v_stats.http_errors_6h;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'cleanup_push_queue: sterse=% (push_stats indisponibil: %)', v_deleted, SQLERRM;
  END;
END;
$function$;
REVOKE EXECUTE ON FUNCTION app.cleanup_push_queue() FROM PUBLIC, anon, authenticated, service_role;

-- ── 9. Cron: apelurile către EF, cu secretul din Vault, DOAR când e ceva de făcut ─────────────────
-- Decizia lui David (3 nov 2026): EF-urile au `verify_jwt = false` (config.toml) și singura lor poartă e
-- header-ul `x-push-secret`, cu secretul din Vault `push_kick_secret` (≥ 32 de octeți aleatori; același
-- text e secretul EF `PUSH_KICK_SECRET`). Fără `Authorization`: nicio cheie service_role/anon nu mai trece
-- prin `net.http_request_queue` / `net._http_response`. Fără secret în Vault (CI, local) funcțiile nu
-- apelează nimic. URL-ul proiectului e cel din baseline (cleanup-announcements).
-- Prima setare (David, ÎNAINTE de aplicarea migrării, în ordinea asta): (1) secretul = `openssl rand -hex 32` (hex sau
-- base64url, FĂRĂ newline la coadă — SHA-256 nu iartă un `\n` diferit între Vault și env); (2) `npx supabase secrets set
-- PUSH_KICK_SECRET=<secret>`; (3) `npx supabase functions deploy push-dispatch` + `push-receipts` (preiau `verify_jwt =
-- false` din config.toml; până la migrare nimic nu le apelează); (4) `SELECT vault.create_secret('<secret>',
-- 'push_kick_secret');`. Rotația: `secrets set` + `vault.update_secret(...)`. Lipsa oricărui pas = kick-urile primesc
-- 401/404, nimic nu se pierde (rândurile rămân `queued`), dar push-urile nu pleacă.
CREATE FUNCTION app.kick_push_dispatch()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.push_queue q WHERE q.status = 'queued' AND q.send_after <= now()) THEN
    RETURN;
  END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'push_kick_secret' LIMIT 1;
  IF v_secret IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := 'https://shgagwnxgliixrzeibmt.supabase.co/functions/v1/push-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION app.kick_push_dispatch() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app.kick_push_receipts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.push_tickets t WHERE t.receipt_checked_at IS NULL AND t.created_at <= now() - interval '15 minutes') THEN
    RETURN;
  END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'push_kick_secret' LIMIT 1;
  IF v_secret IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := 'https://shgagwnxgliixrzeibmt.supabase.co/functions/v1/push-receipts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 90000 -- EF: buget 45 s + fetch 20 s + rpc
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION app.kick_push_receipts() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('push-dispatch', 'channel-digests', 'push-receipts', 'cleanup-push-queue-daily', 'cleanup-cron-run-details-daily');
-- 5 s: cazul cel mai rău ≈ 5 s + EF ≈ 6 s < 10 s (§8 pct 1); un tick gol = un EXISTS pe index parțial, fără HTTP.
SELECT cron.schedule('push-dispatch',   '5 seconds',  $cron$ SELECT app.kick_push_dispatch(); $cron$);
SELECT cron.schedule('channel-digests', '* * * * *',  $cron$ SELECT app.build_channel_digests(); $cron$);
SELECT cron.schedule('push-receipts',   '*/15 * * * *', $cron$ SELECT app.kick_push_receipts(); $cron$);
SELECT cron.schedule('cleanup-push-queue-daily', '23 4 * * *', $cron$ SELECT app.cleanup_push_queue(); $cron$);
-- la 5 s pg_cron scrie ~17.000 rânduri/zi în job_run_details
SELECT cron.schedule('cleanup-cron-run-details-daily', '37 4 * * *',
  $cron$ DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days'; $cron$);

-- ── 10. Verificări ─────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  -- Niciun apel direct către Expo în afara funcțiilor „kick” (cron).
  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'app') AND p.prosrc ILIKE '%net.http_post%'
     AND NOT (n.nspname = 'app' AND p.proname IN ('kick_push_dispatch', 'kick_push_receipts'));
  IF v IS NOT NULL THEN RAISE EXCEPTION 'net.http_post ramas in: %', v; END IF;

  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('push-dispatch', 'channel-digests', 'push-receipts', 'cleanup-push-queue-daily', 'cleanup-cron-run-details-daily')) <> 5 THEN
    RAISE EXCEPTION 'cron: nu sunt 5 joburi';
  END IF;

  IF has_function_privilege('anon', 'public.claim_push_batch(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_push_batch(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.finish_push_batch(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pending_push_receipts(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.finish_push_receipts(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC-urile cozii sunt executabile de anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.claim_push_batch(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role fara EXECUTE pe claim_push_batch';
  END IF;

  IF has_table_privilege('anon', 'app.push_queue', 'SELECT') OR has_table_privilege('authenticated', 'app.push_queue', 'SELECT')
     OR has_table_privilege('anon', 'app.channel_events', 'SELECT') OR has_table_privilege('authenticated', 'app.channel_events', 'SELECT') THEN
    RAISE EXCEPTION 'tabelele cozii au grant-uri pentru anon/authenticated';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
