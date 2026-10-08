-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 26 sept 2026 — Întărire de securitate (auditul de control al accesului)
-- Rulează cu `npx supabase db query --linked -f <fișier>` sau în Studio → SQL Editor.
-- Idempotentă (REVOKE repetabil, CREATE OR REPLACE, DROP TRIGGER IF EXISTS).
--
-- DOAR SERVER, compatibilă cu TOATE versiunile de aplicație (1.0.0–1.0.6):
-- clientul nu apelează niciuna din funcțiile închise și nu scrie niciuna din
-- coloanele pe care gărzile le protejează (verificat în cod pe 26 sept).
--
-- CE REPARĂ:
--   1. Funcții interne apelabile prin API de oricine (chiar fără login). Cauza:
--      Supabase dă implicit EXECUTE lui anon/authenticated pe orice funcție nouă
--      (ALTER DEFAULT PRIVILEGES), iar `REVOKE … FROM public` din migrările vechi
--      NU atinge acele grant-uri explicite. Regula de acum încolo pentru funcțiile
--      interne: `REVOKE … FROM public, anon, authenticated`.
--   2. Crearea profilului accepta orice `role` (inclusiv admin) — garda existentă
--      era doar BEFORE UPDATE. Acum acoperă și INSERT + coloanele rating/created_at.
--   3. Clientul putea schimba mecanicul/autorul unui anunț (→ recenzii pe cine vrea).
--   4. Dovada din rapoarte (snapshot) venea de la client → acum se ia din mesajul real.
--
-- CE NU ATINGE (intenționat): is_admin/is_banned/is_block_between/
-- is_conversation_blocked rămân executabile — sunt folosite în politici RLS și în
-- funcții SECURITY INVOKER; revocarea lor ar rupe aplicația. Ascunderea coloanelor
-- phone/latitude/longitude din profiles și driver_id din ratings vine cu 1.0.7
-- (clienții vechi fac select('*') și s-ar rupe).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Funcții interne: doar serverul le mai poate apela ────────────────────
-- Toți apelanții sunt funcții SECURITY DEFINER deținute de postgres (triggere de
-- push, purge_user_data → delete-account, ratings_after_change, start_*_conversation),
-- deci nu pierd nimic. service_role rămâne (Edge Functions / cron).
REVOKE EXECUTE ON FUNCTION _purge_user_data(uuid)                                     FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION notify_push(uuid, text, text, jsonb, text, text, text)     FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION recompute_mechanic_rating(uuid)                            FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION is_blocked_by(uuid, uuid)                                  FROM public, anon, authenticated;
-- Rămășiță din iunie (fluxul vechi „acceptă anunțul"); clientul folosește
-- accept_application din Faza 3. Nefolosită de nicio versiune publicată.
REVOKE EXECUTE ON FUNCTION accept_announcement(uuid)                                  FROM public, anon, authenticated;

-- ── 2. profiles: garda acoperă și INSERT, plus coloanele derivate ───────────
-- current_user = rolul REAL al conexiunii: 'authenticated'/'anon' = clientul;
-- înăuntrul funcțiilor SECURITY DEFINER (purge, admin_*, recompute) e 'postgres',
-- deci acelea trec neatinse. La INSERT forțăm valorile (nu ridicăm eroare) ca
-- niciun client, oricât de vechi, să nu pice; la UPDATE ridicăm eroare (clientul
-- nu trimite niciodată aceste coloane).
CREATE OR REPLACE FUNCTION guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role IS NULL OR NEW.role NOT IN ('driver', 'mechanic') THEN
      RAISE EXCEPTION 'role_forbidden';
    END IF;
    NEW.banned_at    := NULL;
    NEW.banned_until := NULL;
    NEW.ban_reason   := NULL;
    NEW.rating_avg   := 0;
    NEW.rating_count := 0;
    NEW.created_at   := now();
    NEW.deleted_at   := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'id_change_forbidden';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role_change_forbidden';
  END IF;
  IF NEW.banned_at    IS DISTINCT FROM OLD.banned_at
  OR NEW.banned_until IS DISTINCT FROM OLD.banned_until
  OR NEW.ban_reason   IS DISTINCT FROM OLD.ban_reason THEN
    RAISE EXCEPTION 'ban_change_forbidden';
  END IF;
  IF NEW.rating_avg   IS DISTINCT FROM OLD.rating_avg
  OR NEW.rating_count IS DISTINCT FROM OLD.rating_count THEN
    RAISE EXCEPTION 'rating_change_forbidden';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'created_at_change_forbidden';
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'deleted_at_change_forbidden';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_guard_privileged ON profiles;
CREATE TRIGGER profiles_guard_privileged
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_privileged_columns();

-- ── 3. announcements: clientul nu poate alege mecanicul, autorul sau data ───
-- INSERT: clientul trimite status 'open' (îl forțăm oricum), fără mecanic.
-- UPDATE: tranzițiile de status le limitează deja RLS (open→cancelled,
-- accepted→resolved); aici blocăm restul coloanelor de identitate. RPC-urile
-- (accept_application, resolve_open_announcement, repost_announcement) și
-- cron-ul/Edge Function (service_role) nu sunt 'authenticated' → trec.
CREATE OR REPLACE FUNCTION guard_announcement_client_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status              := 'open';
    NEW.mechanic_id         := NULL;
    NEW.created_at          := now();
    NEW.hidden_from_history := false;
    RETURN NEW;
  END IF;

  IF NEW.id          IS DISTINCT FROM OLD.id
  OR NEW.driver_id   IS DISTINCT FROM OLD.driver_id
  OR NEW.mechanic_id IS DISTINCT FROM OLD.mechanic_id
  OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'announcement_update_forbidden';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS announcements_guard_client ON announcements;
CREATE TRIGGER announcements_guard_client
  BEFORE INSERT OR UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION guard_announcement_client_writes();

-- ── 4. reports: dovada se ia din mesajul real, nu din ce trimite clientul ───
-- SECURITY DEFINER ca să citească mesajul indiferent de RLS. Suprascrie DOAR când
-- mesajul există și nu e șters (altfel rămâne ce a trimis clientul — un mesaj
-- șters între timp ar da snapshot gol). Corectează și reported_user_id pe
-- expeditorul real — un raport nu poate fi pus în cârca altcuiva.
CREATE OR REPLACE FUNCTION reports_snapshot_from_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_content text;
  v_image   text;
  v_sender  uuid;
BEGIN
  IF NEW.message_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.message_table = 'messages' THEN
    SELECT content, image_path, sender_id INTO v_content, v_image, v_sender
      FROM messages WHERE id = NEW.message_id AND deleted_at IS NULL;
  ELSIF NEW.message_table = 'channel_messages' THEN
    SELECT content, image_path, sender_id INTO v_content, v_image, v_sender
      FROM channel_messages WHERE id = NEW.message_id AND deleted_at IS NULL;
  END IF;

  IF FOUND THEN
    NEW.content_snapshot    := v_content;
    NEW.image_path_snapshot := v_image;
    NEW.reported_user_id    := v_sender;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS reports_snapshot ON reports;
CREATE TRIGGER reports_snapshot
  BEFORE INSERT ON reports
  FOR EACH ROW EXECUTE FUNCTION reports_snapshot_from_source();

-- ── 5. Verificare ────────────────────────────────────────────────────────────
-- Așteptat: anon_exec = false și auth_exec = false pe toate 5; service_exec = true;
-- triggers = 3 (profiles_guard_privileged, announcements_guard_client, reports_snapshot).
SELECT f AS functie,
       has_function_privilege('anon',          f, 'execute') AS anon_exec,
       has_function_privilege('authenticated', f, 'execute') AS auth_exec,
       has_function_privilege('service_role',  f, 'execute') AS service_exec
  FROM unnest(ARRAY[
    '_purge_user_data(uuid)',
    'notify_push(uuid,text,text,jsonb,text,text,text)',
    'recompute_mechanic_rating(uuid)',
    'is_blocked_by(uuid,uuid)',
    'accept_announcement(uuid)'
  ]) f
UNION ALL
SELECT 'triggers=' || count(*)::text, null, null, null
  FROM pg_trigger
 WHERE tgname IN ('profiles_guard_privileged', 'announcements_guard_client', 'reports_snapshot');
