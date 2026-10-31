-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 14 sept 2026 — Push: „primesc de mai multe ori aceeași notificare"
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (re-rulabilă).
--
-- DIAGNOSTIC (14 sept, producție):
--   • Canalul „Comunitate TruckSOS": 172 mesaje/24h (158 în 6h) × 188 membri cu
--     push pornit și token → fiecare membru primea ~160 push-uri în 6 ore, cam
--     unul la 2 minute, TOATE cu același corp (ultimele ≤5 necitite) și titlul
--     „Comunitate TruckSOS (N)". 123 de membri opriseră deja notificările
--     canalului — semnal clar că volumul e resimțit ca spam.
--   • Pe iPhone `collapseId` (apns-collapse-id) înlocuiește celula din centrul de
--     notificări, dar FIECARE înlocuire re-afișează bannerul + sunetul cu (aproape)
--     același conținut → „aceeași notificare de mai multe ori". Pe Android `tag`
--     face același lucru, dar actualizarea celulei din tavă e mai discretă.
--   • Tokenuri multiple pe cont (ipoteza clasică): DOAR 6 conturi reale cu 2–3
--     tokenuri (+ contul demo al recenzorilor, cu 14 — dispozitivele lor de
--     review). Nu e cauza principală, dar se previne de-acum (dedupe pe
--     dispozitiv fizic).
--
-- CE SE SCHIMBĂ (server; clientul 1.0.6 trimite platforma + tokenul nativ):
--   1. push_tokens: coloane `platform` ('ios'/'android'), `device_token`
--      (APNs/FCM), `app_build`; `claim_push_token(p_token, p_platform,
--      p_device_token, p_previous_token, p_app_build)` — un dispozitiv fizic =
--      un singur rând (se șterg rândurile cu același device_token și tokenul
--      anterior al aceleiași instalări). Clienții vechi apelează în continuare
--      cu un singur argument (DEFAULT-uri) — fără întrerupere.
--   2. notify_push: pe tokenurile cu platform='ios' și fir (p_tag) → O
--      notificare PER MESAJ, stivuite pe fir cu `threadId` (ca WhatsApp), FĂRĂ
--      collapseId, corp = doar mesajul nou (p_ios_body / p_ios_title). Android
--      și tokenurile fără platformă cunoscută (aplicații nemigrate): neschimbat
--      (tag + collapseId + ultimele ≤5 linii).
--   3. Canal: PAUZĂ per membru (30 min aici; REDUSĂ la 2 min + digest în
--      20260914_channel_push_digest.sql, 15 sept) — după un push pe canal, următorul
--      pleacă doar dacă membrul a deschis canalul între timp (last_read_at mai
--      nou decât ultimul push) sau a trecut pauza. Stare în
--      `channel_push_state`. Conversațiile private rămân push la fiecare mesaj.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. push_tokens: platformă + token nativ + revendicare cu dedupe ──────────
ALTER TABLE push_tokens
  ADD COLUMN IF NOT EXISTS platform     text,
  ADD COLUMN IF NOT EXISTS device_token text,
  ADD COLUMN IF NOT EXISTS app_build    text;

ALTER TABLE push_tokens DROP CONSTRAINT IF EXISTS push_tokens_platform_check;
ALTER TABLE push_tokens ADD CONSTRAINT push_tokens_platform_check
  CHECK (platform IS NULL OR platform IN ('ios', 'android'));

CREATE INDEX IF NOT EXISTS push_tokens_device_token_idx
  ON push_tokens (device_token) WHERE device_token IS NOT NULL;

-- Semnătura veche (1 argument) se șterge: o singură funcție cu DEFAULT-uri
-- deservește și clienții vechi ({p_token}), și pe cei noi (toate câmpurile).
-- Două supraîncărcări ar da „Could not choose the best candidate" în PostgREST.
DROP FUNCTION IF EXISTS claim_push_token(text);

CREATE OR REPLACE FUNCTION claim_push_token(
  p_token          text,
  p_platform       text DEFAULT NULL,
  p_device_token   text DEFAULT NULL,
  p_previous_token text DEFAULT NULL,
  p_app_build      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'token required';
  END IF;

  -- (a) Aceeași instalare a primit un token Expo NOU: cel vechi nu mai
  --     reprezintă niciun dispozitiv. Clientul ni-l trimite — posesia lui e
  --     dovada dreptului de a-l scoate, indiferent pe ce cont a rămas.
  IF p_previous_token IS NOT NULL AND p_previous_token <> p_token THEN
    DELETE FROM push_tokens WHERE token = p_previous_token;
  END IF;

  -- (b) Același dispozitiv fizic (același token nativ APNs/FCM) înregistrat sub
  --     ALT token Expo (reinstalare, identitate Expo nouă): rămâne un singur
  --     rând, altfel telefonul primește fiecare notificare de două ori.
  IF p_device_token IS NOT NULL AND p_platform IS NOT NULL THEN
    DELETE FROM push_tokens
     WHERE device_token = p_device_token
       AND platform     = p_platform
       AND token        <> p_token;
  END IF;

  INSERT INTO push_tokens (token, user_id, updated_at, platform, device_token, app_build)
  VALUES (p_token, auth.uid(), now(), p_platform, p_device_token, p_app_build)
  ON CONFLICT (token) DO UPDATE
    SET user_id      = auth.uid(),
        updated_at   = now(),
        -- Clienții vechi trimit NULL: nu ștergem ce știm deja despre rând.
        platform     = COALESCE(EXCLUDED.platform,     push_tokens.platform),
        device_token = COALESCE(EXCLUDED.device_token, push_tokens.device_token),
        app_build    = COALESCE(EXCLUDED.app_build,    push_tokens.app_build);
END;
$$;

REVOKE ALL ON FUNCTION claim_push_token(text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION claim_push_token(text, text, text, text, text) TO authenticated;

-- ── 2. Starea push-urilor de canal (pauza dintre push-uri) ───────────────────
CREATE TABLE IF NOT EXISTS channel_push_state (
  user_id        uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel_id     uuid        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_pushed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

-- RLS fără nicio politică: tabela e atinsă DOAR de trigger (SECURITY DEFINER).
ALTER TABLE channel_push_state ENABLE ROW LEVEL SECURITY;

-- ── 3. notify_push: variantă iOS per mesaj (thread-id), fără collapseId ──────
-- Semnătura cu 5 argumente TREBUIE ștearsă întâi (ca la 7 aug): altfel apelurile
-- cu 4–5 argumente ar deveni ambigue între cele două supraîncărcări.
DROP FUNCTION IF EXISTS notify_push(uuid, text, text, jsonb, text);

CREATE OR REPLACE FUNCTION notify_push(
  p_user_id   uuid,
  p_title     text,
  p_body      text,
  p_data      jsonb DEFAULT '{}'::jsonb,
  p_tag       text  DEFAULT NULL,
  p_ios_title text  DEFAULT NULL,
  p_ios_body  text  DEFAULT NULL
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
$$;

-- ── 4. Chat privat: ca la 23 aug + varianta iOS (doar mesajul nou) ───────────
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

  -- Linia mesajului curent — corpul de pe iOS și plasa de siguranță de mai jos.
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
    COALESCE(v_sender, ''),   -- iOS: fără „(N)" — stiva de pe fir arată numărul
    v_line_new                -- iOS: doar mesajul nou
  );
  RETURN NEW;
END;
$$;

-- ── 5. Canal: ca la 2 sept + pauză de 30 min per membru + varianta iOS ───────
CREATE OR REPLACE FUNCTION on_channel_message_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $body$
DECLARE
  -- Pauza între două push-uri de canal către același membru care NU a deschis
  -- canalul între timp. Singurul loc de reglat.
  v_cooldown constant interval := interval '30 minutes';
  v_rec      record;
  v_sender   text;
  v_lang     text;
  v_cursor   timestamptz;
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
    -- `joined_at` și ultimul push vin din aceeași interogare: zero cost în plus.
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

    -- PAUZA: a primit deja un push de canal în ultimele 30 min și n-a deschis
    -- canalul de atunci → nu-l mai batem la cap; vede „(N)" la următorul push.
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
        AND m.created_at >= v_rec.joined_at            -- ca RLS-ul (2 sept)
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
        AND m.created_at >= v_rec.joined_at            -- ca RLS-ul (2 sept)
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      ORDER BY m.created_at DESC
      LIMIT 5
    ) sub;

    -- Mesajul curent e mereu vizibil destinatarului (e scris ACUM, deci după
    -- înscrierea lui), așa că ramura asta rămâne corectă ca plasă de siguranță.
    IF v_body IS NULL THEN
      v_count := 1;
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
      v_title,                  -- iOS: numele canalului + „(N)" (push-urile sunt rare acum)
      v_line_new                -- iOS: doar mesajul nou
    );

    INSERT INTO channel_push_state (user_id, channel_id, last_pushed_at)
    VALUES (v_rec.user_id, NEW.channel_id, now())
    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_pushed_at = now();
  END LOOP;
  RETURN NEW;
END;
$body$;

-- ── 6. Verificare ────────────────────────────────────────────────────────────
-- Așteptat: coloane=3, claim_args=5, notify_args=7, notify_ios=true,
--           msg_ios=true, canal_pauza=true, stare_tabela=true, triggere=2.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'push_tokens'
      AND column_name IN ('platform', 'device_token', 'app_build'))         AS coloane,
  (SELECT pronargs FROM pg_proc WHERE proname = 'claim_push_token')          AS claim_args,
  (SELECT pronargs FROM pg_proc WHERE proname = 'notify_push')               AS notify_args,
  (SELECT position('threadId' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'notify_push')                                           AS notify_ios,
  (SELECT position('v_line_new' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'on_message_notify')                                     AS msg_ios,
  (SELECT position('v_cooldown' IN prosrc) > 0 FROM pg_proc
    WHERE proname = 'on_channel_message_notify')                             AS canal_pauza,
  (SELECT to_regclass('public.channel_push_state') IS NOT NULL)              AS stare_tabela,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('messages_notify', 'channel_messages_notify'))          AS triggere;
