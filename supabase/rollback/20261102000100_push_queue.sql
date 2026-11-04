-- Rollback pentru 20261102000100_push_queue (faza 3.1): funcțiile de push revin la textul din
-- 20261101000100_private_tables (apel direct net.http_post din trigger, digest în buclă), cron-urile fazei 3 sunt
-- scoase, RPC-urile și tabelele cozii șterse. ATENȚIE: rândurile încă netrimise din app.push_queue se pierd.
-- Generat de .claude/wip/faza3/gen-rollback.mjs; blocurile de funcții sunt copiate byte cu byte.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;), ca 20261101000300 — altfel SET LOCAL nu are efect.
-- ÎNAINTE: (1) dacă faza 3.3 (20261102000200) e aplicată, rulează întâi rollback-ul ei (garda de mai jos oprește altfel);
-- (2) oprește „Enhanced push security” în Expo: funcțiile repuse trimit la exp.host FĂRĂ access token, iar cu opțiunea
-- pornită toate push-urile ar pica în tăcere.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ── 0. Gardă: 3.3 depinde de app.push_queue și redefinește _purge_user_data ──────────────────────
DO $$
BEGIN
  IF to_regclass('app.moderation_notices') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 3.1: faza 3.3 e aplicata (app.moderation_notices exista) - ruleaza intai rollback_20261102000200_reports_moderation';
  END IF;
END $$;

-- ── 1. Cron ───────────────────────────────────────────────────────────────────────────────────────
SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('push-dispatch', 'channel-digests', 'push-receipts', 'cleanup-push-queue-daily', 'cleanup-cron-run-details-daily');

-- ── 2. Funcțiile de push, textul din 20261101000100 ───────────────────────────────────────────────
-- public.notify_push: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb DEFAULT '{}'::jsonb, p_tag text DEFAULT NULL::text, p_ios_title text DEFAULT NULL::text, p_ios_body text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_enabled boolean;
  v_token   record;
  v_payload jsonb;
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

  FOR v_token IN SELECT token, platform FROM push_tokens WHERE user_id = p_user_id LOOP
    IF v_token.platform = 'ios' AND p_tag IS NOT NULL THEN
      -- iPhone, notificare de fir (conversație/canal): o celulă PER MESAJ,
      -- stivuite pe fir prin thread-id, ca WhatsApp. Fără collapseId: pe iOS
      -- înlocuirea re-afișa bannerul cu același conținut la fiecare mesaj.
      -- Fără channelId (câmp doar-Android). Ștergerea din bară la citire rămâne
      -- pe client (dismissThreadNotifications filtrează după data.type/id).
      v_payload := jsonb_build_object(
        'to',       v_token.token,
        'title',    COALESCE(p_ios_title, p_title),
        'body',     COALESCE(p_ios_body,  p_body),
        'data',     p_data,
        'sound',    'default',
        'priority', 'high',
        'threadId', p_tag
      );
    ELSE
      -- Android + tokenuri fără platformă cunoscută (aplicații nemigrate):
      -- comportamentul de până acum.
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
      -- `tag` (Android) înlocuiește celula din bară; `collapseId` coalescează în
      -- tranzit și, pe iOS-urile nemigrate, înlocuiește celula.
      IF p_tag IS NOT NULL THEN
        v_payload := v_payload || jsonb_build_object('tag', p_tag, 'collapseId', p_tag);
      END IF;
    END IF;

    PERFORM net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := v_payload
    );
  END LOOP;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb, p_tag text, p_ios_title text, p_ios_body text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb, p_tag text, p_ios_title text, p_ios_body text) TO service_role;

-- public.on_channel_message_notify: trigger
CREATE OR REPLACE FUNCTION public.on_channel_message_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  SELECT full_name INTO v_sender FROM app.profiles WHERE id = NEW.sender_id;

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
    JOIN app.profiles pr ON pr.id = p.user_id
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
      JOIN app.profiles pr ON pr.id = m.sender_id
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
$function$
;

-- public.notify_mechanics_new_announcement: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.notify_mechanics_new_announcement(p_announcement app.announcements)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_mechanic record;
BEGIN
  FOR v_mechanic IN
    SELECT app.profiles.id, COALESCE(lang, 'ro') AS lang
    FROM app.profiles
    WHERE role = 'mechanic'
      AND app.profiles.id <> p_announcement.driver_id
      AND push_enabled
      AND NOT is_block_between(p_announcement.driver_id, app.profiles.id)   -- Faza 18
      AND (
        notify_radius_km IS NULL
        OR (
          p_announcement.latitude IS NOT NULL AND p_announcement.longitude IS NOT NULL
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND distance_km(latitude, longitude, p_announcement.latitude, p_announcement.longitude)
              <= notify_radius_km
        )
      )
  LOOP
    PERFORM notify_push(
      v_mechanic.id,
      push_text(v_mechanic.lang, 'announcement_title'),
      p_announcement.location,
      jsonb_build_object('type', 'feed', 'id', p_announcement.id)
    );
  END LOOP;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.notify_mechanics_new_announcement(p_announcement app.announcements) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_mechanics_new_announcement(p_announcement app.announcements) TO service_role;

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

-- ── 3. RPC-urile EF, funcțiile app, tabelele ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.claim_push_batch(integer);
DROP FUNCTION IF EXISTS public.finish_push_batch(jsonb);
DROP FUNCTION IF EXISTS public.pending_push_receipts(integer);
DROP FUNCTION IF EXISTS public.finish_push_receipts(jsonb);
DROP FUNCTION IF EXISTS app.kick_push_dispatch();
DROP FUNCTION IF EXISTS app.kick_push_receipts();
DROP FUNCTION IF EXISTS app.build_channel_digests();
DROP FUNCTION IF EXISTS app.channel_message_line(text, text, uuid, uuid, uuid, integer);
DROP FUNCTION IF EXISTS app.push_stats();
DROP TABLE IF EXISTS app.push_tickets;
DROP TABLE IF EXISTS app.push_queue;
DROP TABLE IF EXISTS app.channel_events;

-- ── 4. Verificare ─────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('app.push_queue') IS NOT NULL THEN RAISE EXCEPTION 'rollback: push_queue inca exista'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.notify_push(uuid,text,text,jsonb,text,text,text)'::regprocedure) NOT ILIKE '%net.http_post%' THEN
    RAISE EXCEPTION 'rollback: notify_push nu a revenit la apelul direct';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('push-dispatch', 'channel-digests', 'push-receipts', 'cleanup-push-queue-daily', 'cleanup-cron-run-details-daily')) THEN
    RAISE EXCEPTION 'rollback: cron-urile fazei 3 inca exista';
  END IF;
  IF to_regclass('app.push_tickets') IS NOT NULL OR to_regclass('app.channel_events') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback: push_tickets/channel_events inca exista';
  END IF;
  IF to_regprocedure('public.claim_push_batch(integer)') IS NOT NULL OR to_regprocedure('public.finish_push_batch(jsonb)') IS NOT NULL
     OR to_regprocedure('public.pending_push_receipts(integer)') IS NOT NULL OR to_regprocedure('public.finish_push_receipts(jsonb)') IS NOT NULL
     OR to_regprocedure('app.build_channel_digests()') IS NOT NULL OR to_regprocedure('app.kick_push_dispatch()') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback: RPC-urile/functiile cozii inca exista';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.on_channel_message_notify()'::regprocedure) ILIKE '%channel_events%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.notify_mechanics_new_announcement(app.announcements)'::regprocedure) ILIKE '%push_queue%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public._purge_user_data(uuid)'::regprocedure) ILIKE '%push_queue%' THEN
    RAISE EXCEPTION 'rollback: o functie mai refera coada/evenimentele';
  END IF;
  RAISE NOTICE 'rollback push_queue: ok';
END $$;
NOTIFY pgrst, 'reload schema';
