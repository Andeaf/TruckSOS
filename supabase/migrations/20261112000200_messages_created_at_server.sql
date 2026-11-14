-- Decizia lui David din 12 nov 2026 (punctul 7 din lotul din 12 nov; golul găsit de review-ul fazei 5):
-- `created_at` al unui mesaj îl pune serverul, nu clientul.
--
-- Golul: `authenticated` are INSERT la nivel de tabel pe public.messages și public.channel_messages și nimic nu
-- fixa `created_at`, deci un client modificat putea trimite orice dată (sau NULL în `messages`, unde coloana e
-- nulabilă). Un mesaj cu data din viitor rămâne ultimul din fir, mută cursorul de citire al celor care deschid
-- firul (1.0.x) sau ține bulina aprinsă (1.1, faza 5), iar în canalul global lovește pe toată lumea până îl
-- șterge un admin. O dată din trecut ascunde mesajul în istoric (și de fereastra de digest a canalului).
--
-- Remediul: un trigger BEFORE INSERT pe fiecare dintre cele două tabele care pune `created_at = now()` când
-- inserarea e făcută DIRECT de un rol al clientului (`current_user` = authenticated sau anon — adică prin
-- PostgREST, cu JWT-ul utilizatorului). Același tipar ca public.guard_profile_privileged_columns.
--   • Funcția e SECURITY INVOKER (implicit) INTENȚIONAT: într-o funcție SECURITY DEFINER `current_user` ar fi
--     mereu proprietarul și trigger-ul n-ar face nimic.
--   • NU se aplică: inserărilor făcute de service_role (Edge Functions), de postgres (migrări, cron, seed-uri,
--     teste) și celor făcute din interiorul unei funcții SECURITY DEFINER (acolo `current_user` e proprietarul
--     funcției). Drumuri legitime de acest fel care inserează în cele două tabele, la 12 nov 2026: NICIUNUL —
--     nicio funcție SQL din migrări și nicio Edge Function nu inserează în messages / channel_messages; singurele
--     inserări cu `created_at` explicit sunt datele de test (supabase/gate/fixtures.sql, supabase/tests,
--     supabase/bench), rulate ca postgres. Excepția rămâne ca un viitor drum de server să-și poată alege data.
--   • `now()` = începutul tranzacției, exact valoarea pe care o dă azi DEFAULT-ul coloanei.
--
-- Clienții 1.0.6–1.0.8 și 1.1: niciunul nu trimite `created_at` la INSERT (use-chat.ts, use-channel-chat.ts,
-- verificat la fb3ab3f și în main), deci pentru ei rândul inserat și răspunsul sunt identice cu cele de azi
-- (DEFAULT now() ≡ now() din trigger). Poarta 4.1 rejoacă INSERT-urile 1.0.8 în ambele tabele înainte și după.
-- Nimic din API nu se schimbă (nicio coloană, niciun grant, nicio politică): nu e nevoie de NOTIFY pgrst.
--
-- Ordinea triggerelor BEFORE INSERT (alfabetică): aaa_created_at_server → aaa_rate_limit → ban_guard_ins;
-- e primul, ca tot ce rulează după el (și triggerele AFTER de notificare) să vadă data serverului.
-- Lock: CREATE TRIGGER ia SHARE ROW EXCLUSIVE pe fiecare tabel (scrierile așteaptă, citirile nu) până la COMMIT;
-- cu lock_timeout 5s tranzacția pică, nu așteaptă. Nu atinge niciun rând existent.
-- Independentă de fazele 3–9 (atinge doar tabele din baseline). Rollback:
-- supabase/rollback/20261112000200_messages_created_at_server.sql.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION app.stamp_created_at_client()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Doar inserările făcute direct de client (PostgREST: authenticator → SET ROLE authenticated / anon).
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
COMMENT ON FUNCTION app.stamp_created_at_client() IS '12 nov 2026: created_at al mesajelor inserate direct de client (authenticated / anon) e now(), orice ar trimite clientul. SECURITY INVOKER intenționat (current_user = rolul care inserează); service_role, postgres și funcțiile SECURITY DEFINER își păstrează valoarea.';
REVOKE ALL ON FUNCTION app.stamp_created_at_client() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.stamp_created_at_client() TO service_role;

CREATE TRIGGER aaa_created_at_server
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION app.stamp_created_at_client();

CREATE TRIGGER aaa_created_at_server
  BEFORE INSERT ON public.channel_messages
  FOR EACH ROW EXECUTE FUNCTION app.stamp_created_at_client();

-- Verificări (pică migrarea, deci nimic nu rămâne aplicat pe jumătate).
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgname = 'aaa_created_at_server' AND NOT t.tgisinternal AND t.tgenabled = 'O'
         AND t.tgrelid IN ('public.messages'::regclass, 'public.channel_messages'::regclass)
         AND t.tgfoid = 'app.stamp_created_at_client()'::regprocedure
         AND t.tgtype = 7) <> 2 THEN  -- 7 = ROW (1) + BEFORE (2) + INSERT (4)
    RAISE EXCEPTION 'messages_created_at_server: triggerele BEFORE INSERT FOR EACH ROW nu sunt pe ambele tabele';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'app.stamp_created_at_client()'::regprocedure) THEN
    RAISE EXCEPTION 'messages_created_at_server: funcția trebuie să fie SECURITY INVOKER (altfel current_user e mereu proprietarul)';
  END IF;
  IF has_function_privilege('anon', 'app.stamp_created_at_client()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'app.stamp_created_at_client()', 'EXECUTE') THEN
    RAISE EXCEPTION 'messages_created_at_server: funcția trigger-ului nu are voie să fie executabilă prin API';
  END IF;
  -- E primul trigger BEFORE INSERT de pe fiecare tabel (ordinea e alfabetică).
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid IN ('public.messages'::regclass, 'public.channel_messages'::regclass)
                AND NOT t.tgisinternal AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4
                AND t.tgname::text < 'aaa_created_at_server' COLLATE "C") THEN
    RAISE EXCEPTION 'messages_created_at_server: există un trigger BEFORE INSERT care rulează înaintea lui aaa_created_at_server';
  END IF;
END $$;
