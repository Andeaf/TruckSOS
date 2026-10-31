-- ─────────────────────────────────────────────────────────────────────────────
-- 27 oct 2026 — FAZA 2, corecție la 20261031000100_hygiene_limits: limita de anunțuri se putea ocoli
-- la INSERT trimițând explicit status = 'cancelled'. Triggerul aaa_rate_limit rulează înaintea gărzii
-- announcements_guard_client (ordine alfabetică), ieșea devreme pe orice status diferit de 'open', iar
-- garda forța apoi status = 'open' → anunț deschis fără nicio limită. Găsită la proba post-aplicare.
--
-- Acum: la INSERT limitele se aplică ÎNTOTDEAUNA (garda transformă oricum orice INSERT de client în
-- 'open'); la UPDATE doar la trecerea în 'open' (repost_announcement).
-- 29 oct 2026 (decizia lui David, înainte de aplicare): plafonul de anunțuri deschise simultan urcă de la
-- 3 la 5 (D5 din PLAN_1.1_FIX, amendat); 10 create în 24 h și 30 în 7 zile rămân neschimbate.
-- Compatibil cu 1.0.6–1.0.8: aplicația trimite status: 'open' la creare, deci nu observă nicio diferență.
-- Rollback: supabase/rollback/20261031000200_announcement_limit_insert_fix.sql (readuce 3 + ocolirea).
-- ─────────────────────────────────────────────────────────────────────────────

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION app.limit_announcements()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  -- UPDATE: contează doar redeschiderea (repost_announcement). INSERT: întotdeauna — garda
  -- announcements_guard_client forțează oricum status = 'open' pentru orice INSERT de client.
  IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM 'open' OR OLD.status = 'open') THEN RETURN NEW; END IF;
  -- Cel mult 5 deschise simultan (29 oct 2026; era 3 în 20261031000100).
  IF (SELECT count(*) FROM public.announcements WHERE driver_id = auth.uid() AND status = 'open' AND id <> NEW.id) >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements_open';
  END IF;
  IF NOT app.rate_limit_ok('announcement_day', interval '24 hours', 10)
     OR NOT app.rate_limit_ok('announcement_week', interval '7 days', 30) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements';
  END IF;
  RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION app.limit_announcements() FROM PUBLIC, anon, authenticated;

-- ── Verificare (eșec = EXCEPTION = nimic nu se aplică) ────────────────────────────────────────────
DO $$
BEGIN
  IF pg_get_functiondef('app.limit_announcements()'::regprocedure) LIKE '%IF NEW.status <> ''open'' THEN RETURN NEW%' THEN
    RAISE EXCEPTION 'limit_announcements: ramura de ocolire e încă prezentă';
  END IF;
  IF pg_get_functiondef('app.limit_announcements()'::regprocedure) NOT LIKE '%AND id <> NEW.id) >= 5 THEN%'
     OR pg_get_functiondef('app.limit_announcements()'::regprocedure) LIKE '%AND id <> NEW.id) >= 3 THEN%' THEN
    RAISE EXCEPTION 'limit_announcements: plafonul de anunțuri deschise nu e 5';
  END IF;
  IF pg_get_functiondef('app.limit_announcements()'::regprocedure) NOT LIKE '%''announcement_day'', interval ''24 hours'', 10)%'
     OR pg_get_functiondef('app.limit_announcements()'::regprocedure) NOT LIKE '%''announcement_week'', interval ''7 days'', 30)%' THEN
    RAISE EXCEPTION 'limit_announcements: limitele 10 / 24 h și 30 / 7 zile s-au schimbat';
  END IF;
  IF has_function_privilege('anon', 'app.limit_announcements()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'app.limit_announcements()', 'EXECUTE') THEN
    RAISE EXCEPTION 'limit_announcements: executabil prin API';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'aaa_rate_limit' AND tgrelid = 'public.announcements'::regclass) <> 1 THEN
    RAISE EXCEPTION 'triggerul aaa_rate_limit lipsește de pe announcements';
  END IF;
  RAISE NOTICE 'announcement_limit_insert_fix verificare: PASS';
END $$;

SELECT 'limit_announcements: INSERT limitat indiferent de status; UPDATE doar la redeschidere; 5 deschise, 10 / 24 h, 30 / 7 zile' AS verificare, 'PASS' AS stare;
