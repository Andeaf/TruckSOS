-- Faza 9.1 (PLAN_1.1_FIX #46; plan: .claude/wip/faza9/PLAN-faza9.md, APROBAT de David 9 nov 2026, decizia D9.1 = NU Sentry):
-- erorile clientului într-un tabel propriu, fără terț.
--   1. app.client_errors: tipul erorii, mesajul, stiva, ecranul, versiunea aplicației și a sistemului. Despre utilizator se
--      păstrează DOAR un hash scurt al id-ului (12 hex din sha256) — destul ca să numeri „câți utilizatori afectați”, fără
--      coloană de cont (D9.2).
--   2. report_client_error(...): scris doar de utilizatori logați (EXECUTE doar authenticated — app.rate_limit_ok întoarce
--      true fără auth.uid(), deci anon ar avea inserări nelimitate; oaspeții nu trimit), 10 / oră / utilizator și cel mult
--      2 000 / oră în total, cu CURĂȚARE ȘI
--      LA SERVER (clientul curăță și el înainte de trimitere): e-mailuri → [email], UUID-uri → [id], secvențe de ≥ 8 cifre →
--      [phone], JWT / Bearer / chei / tokenuri push → [token]; apoi trunchiere (mesaj 500, stivă 4 000, ecran 120).
--      Clientul trimite doar la apăsarea butonului „Trimite raportul” (consimțământ per eveniment).
--   3. admin_client_errors(p_hours, p_limit): lista + agregatul pe tip, pentru cardul din panoul admin (is_admin).
--   4. Retenție 30 de zile: cron propriu `cleanup-client-errors-daily` (ca `cleanup-client-diagnostics-daily` din baseline).
--      ABATERE de la plan (notată acolo): planul punea ștergerea ca pas în app.apply_retention; funcția aceea e rescrisă și de
--      faza 8 (pasul consent_log), iar faza 9 se poate aplica înainte sau după faza 8 — un cron separat nu depinde de ordinea
--      lor și nu cere două variante ale aceleiași funcții. Termenul declarat în politică (30 de zile) e același.
-- Clienții 1.0.6–1.0.8: nimic nou (tabel și funcții noi, neapelate).
-- Rollback: supabase/rollback/20261111000100_client_errors.sql (cron scos, funcțiile și tabelul șterse; erorile se pierd).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('app.rate_limit_ok(text, interval, integer)') IS NULL THEN RAISE EXCEPTION 'cere app.rate_limit_ok (faza 2)'; END IF;
  IF to_regprocedure('public.is_admin(uuid)') IS NULL THEN RAISE EXCEPTION 'cere public.is_admin'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RAISE EXCEPTION 'cere pg_cron'; END IF;
  IF to_regclass('app.client_errors') IS NOT NULL THEN RAISE EXCEPTION 'app.client_errors exista deja: migrarea a fost aplicata?'; END IF;
END $$;

-- ── 1. Tabelul ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE app.client_errors (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_hash  text NOT NULL,
  app_build  text,
  platform   text NOT NULL,
  os_version text,
  screen     text,
  error_type text NOT NULL,
  message    text,
  stack      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE app.client_errors IS 'Faza 9.1: erorile clientului trimise la apăsarea butonului „Trimite raportul”. Fără id de cont (doar user_hash = 12 hex din sha256(uid)); text curățat de e-mailuri / id-uri / telefoane / tokenuri; retenție 30 de zile (cron). Scris doar de report_client_error().';
CREATE INDEX client_errors_created_idx ON app.client_errors (created_at);
ALTER TABLE app.client_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.client_errors FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE app.client_errors TO service_role;  -- convenția repo-ului (check-migrations); `app` nu e expusă prin API

-- ── 2. Curățarea textului (aceleași reguli ca src/lib/client-errors.ts → scrubText) ────────────────
-- Ordinea contează: tokenurile întâi (un JWT conține puncte și cifre), apoi e-mailurile, UUID-urile și abia la urmă
-- secvențele lungi de cifre (altfel un UUID ar pierde primul grup ca „telefon”). Fără backslash-uri în tipare (clase POSIX).
-- „Telefon” = cel puțin 8 cifre, cu cel mult 3 separatori (spațiu ( ) . / -) între două cifre: prinde și `0171/1234567`,
-- `(0721) 234-567`. Efect secundar acceptat (review 10 nov): datele ISO, timestamp-urile și offset-urile de ≥ 8 cifre din
-- stivă devin și ele [phone] — se pierde informație de diagnostic, nu apare un risc.
CREATE FUNCTION app.scrub_client_text(p_text text, p_max integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT left(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(COALESCE(p_text, ''),
      'eyJ[A-Za-z0-9_-]{5,}[.][A-Za-z0-9_-]{5,}[.][A-Za-z0-9_-]{5,}', '[token]', 'g'),
      '[Bb]earer[[:space:]]+[A-Za-z0-9._~+/=-]+', '[token]', 'g'),
      'sb_(secret|publishable)_[A-Za-z0-9_-]+', '[token]', 'g'),
      'Expo(nent)?PushToken[[][^]]*[]]', '[token]', 'g'),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}', '[email]', 'g'),
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', '[id]', 'g'),
      '[+]?[0-9]([ ()./-]{0,3}[0-9]){7,}', '[phone]', 'g'),
    GREATEST(COALESCE(p_max, 0), 0));
$function$;
REVOKE EXECUTE ON FUNCTION app.scrub_client_text(text, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ── 3. RPC-ul clientului ────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.report_client_error(p_app_build text, p_platform text, p_os_version text, p_screen text, p_error_type text, p_message text, p_stack text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_platform text := lower(btrim(COALESCE(p_platform, '')));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  -- Plafon global (review 10 nov): limita de mai jos e per cont; multe conturi n-au voie să umple tabelul. Verificat
  -- ÎNAINTE de limita per cont, ca un refuz global să nu consume din cele 10 încercări ale utilizatorului.
  IF (SELECT count(*) FROM app.client_errors e WHERE e.created_at > now() - interval '1 hour') >= 2000 THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'client_error_global';
  END IF;
  IF NOT app.rate_limit_ok('client_error', interval '1 hour', 10) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'client_error';
  END IF;

  INSERT INTO app.client_errors (user_hash, app_build, platform, os_version, screen, error_type, message, stack)
  VALUES (
    left(encode(sha256(convert_to(v_uid::text, 'UTF8')), 'hex'), 12),
    NULLIF(app.scrub_client_text(btrim(COALESCE(p_app_build, '')), 40), ''),
    CASE WHEN v_platform IN ('ios', 'android', 'web') THEN v_platform ELSE 'other' END,
    NULLIF(app.scrub_client_text(btrim(COALESCE(p_os_version, '')), 40), ''),
    NULLIF(app.scrub_client_text(btrim(COALESCE(p_screen, '')), 120), ''),
    COALESCE(NULLIF(app.scrub_client_text(btrim(COALESCE(p_error_type, '')), 80), ''), 'Error'),
    NULLIF(app.scrub_client_text(p_message, 500), ''),
    NULLIF(app.scrub_client_text(p_stack, 4000), '')
  );
  RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.report_client_error(p_app_build text, p_platform text, p_os_version text, p_screen text, p_error_type text, p_message text, p_stack text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_client_error(p_app_build text, p_platform text, p_os_version text, p_screen text, p_error_type text, p_message text, p_stack text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_client_error(p_app_build text, p_platform text, p_os_version text, p_screen text, p_error_type text, p_message text, p_stack text) TO service_role;

-- ── 4. RPC-ul panoului admin ────────────────────────────────────────────────────────────────────────
-- Fereastra: p_hours între 1 și 720 (30 de zile = retenția); lista: cel mult 500 de rânduri.
CREATE FUNCTION public.admin_client_errors(p_hours integer DEFAULT 168, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_since timestamptz := now() - make_interval(hours => GREATEST(1, LEAST(COALESCE(p_hours, 168), 720)));
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  RETURN jsonb_build_object(
    'since', v_since,
    'total', (SELECT count(*) FROM app.client_errors e WHERE e.created_at >= v_since),
    'users', (SELECT count(DISTINCT e.user_hash) FROM app.client_errors e WHERE e.created_at >= v_since),
    'by_type', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('error_type', t.error_type, 'count', t.n, 'users', t.users, 'last_at', t.last_at)
                       ORDER BY t.n DESC, t.error_type)
        FROM (SELECT e.error_type, count(*) AS n, count(DISTINCT e.user_hash) AS users, max(e.created_at) AS last_at
                FROM app.client_errors e
               WHERE e.created_at >= v_since
               GROUP BY e.error_type
               ORDER BY count(*) DESC, e.error_type
               LIMIT 20) t), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', i.id, 'created_at', i.created_at, 'app_build', i.app_build, 'platform', i.platform,
                                          'os_version', i.os_version, 'screen', i.screen, 'error_type', i.error_type,
                                          'message', i.message, 'stack', i.stack, 'user_hash', i.user_hash)
                       ORDER BY i.created_at DESC, i.id DESC)
        FROM (SELECT e.* FROM app.client_errors e
               WHERE e.created_at >= v_since
               ORDER BY e.created_at DESC, e.id DESC
               LIMIT v_limit) i), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_client_errors(p_hours integer, p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_client_errors(p_hours integer, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_client_errors(p_hours integer, p_limit integer) TO service_role;

-- ── 5. Retenția: 30 de zile ─────────────────────────────────────────────────────────────────────────
SELECT cron.schedule('cleanup-client-errors-daily', '44 3 * * *', $cron$ DELETE FROM app.client_errors WHERE created_at < now() - interval '30 days'; $cron$);

-- ── 6. Verificări ───────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_table_privilege('anon', 'app.client_errors', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'app.client_errors', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'client_errors: anon/authenticated nu trebuie sa aiba drepturi';
  END IF;
  IF has_function_privilege('anon', 'public.report_client_error(text, text, text, text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_client_errors(integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC-urile client_errors nu trebuie sa fie executabile de anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.report_client_error(text, text, text, text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'report_client_error trebuie sa fie executabil de authenticated';
  END IF;
  IF app.scrub_client_text('a ion.pop@example.com b 0f8fad5b-d9cb-469f-a165-70867728950e c +40 712 345 678 d', 200)
       <> 'a [email] b [id] c [phone] d' THEN
    RAISE EXCEPTION 'scrub_client_text nu curata corect: %', app.scrub_client_text('a ion.pop@example.com b 0f8fad5b-d9cb-469f-a165-70867728950e c +40 712 345 678 d', 200);
  END IF;
  IF app.scrub_client_text('Bearer abc.def-ghi x eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghij y', 200) <> '[token] x [token] y' THEN
    RAISE EXCEPTION 'scrub_client_text nu curata tokenurile';
  END IF;
  IF app.scrub_client_text('tel 0171/1234567 sau (0721) 234-567; at f (index.bundle:1:1234567)', 200)
       <> 'tel [phone] sau ([phone]; at f (index.bundle:1:1234567)' THEN
    RAISE EXCEPTION 'scrub_client_text nu curata telefoanele cu separatori';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-client-errors-daily') THEN
    RAISE EXCEPTION 'cron cleanup-client-errors-daily lipseste';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
