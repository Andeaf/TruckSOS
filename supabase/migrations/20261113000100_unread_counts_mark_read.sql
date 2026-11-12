-- Faza 5, varianta B (plan: .claude/wip/faza5/PLAN-faza5.md; decizia lui David, 12 nov 2026: B acum, A — broadcast pe canale
-- private — rămâne de decis după graficul CPU Realtime de după faza 3 pe producție). AUDIT #7 (bulina = până la 200 de
-- interogări `count exact` per reîmprospătare, în două instanțe) și #33 parțial (cursorul de citire putea merge înapoi).
-- Patru RPC-uri, toate public, SECURITY DEFINER, search_path '', EXECUTE doar pentru authenticated (+ service_role):
--
--   unread_counts() → TABLE(conversation_id uuid, unread integer)
--     O singură interogare în locul celor ≤ 200 ale clientului. Aceleași reguli ca `useUnreadCounts` din 1.0.x:
--       · conversațiile MELE (driver_id = eu SAU mechanic_id = eu); fără plafonul de 200 de conversații al clientului;
--       · fără cele șterse de mine (conversation_deletions) — nu se văd în listă, deci n-ar putea fi citite niciodată;
--       · mesajele CELUILALT (sender_id <> eu), netombstonate (deleted_at IS NULL), mai noi decât cursorul meu
--         (message_reads.last_read_at); fără rând de citire = toate sunt necitite;
--       · plafon 100 per conversație (bulina afișează oricum „9+”): numărătoarea se oprește la 100 de rânduri din index.
--     Întoarce DOAR conversațiile cu cel puțin un necitit (clientul tratează lipsa ca 0).
--
--   channel_unread_count(p_channel uuid) → integer
--     Aceleași reguli ca `useChannelUnreadCount` + politica RLS `channel_messages_select_since_join`, pe care SECURITY
--     DEFINER o ocolește și deci trebuie repetată aici: mesajele de după crearea contului meu (sau toate, pentru admin),
--     ale altora, netombstonate, mai noi decât channel_reads.last_read_at; plafon 100. Mesajele utilizatorilor blocați
--     NU sunt excluse (ca azi în client); excluderea se poate adăuga aici mai târziu fără schimbări în client.
--
--   mark_conversation_read(p_conversation uuid, p_at timestamptz DEFAULT now()) → timestamptz
--   mark_channel_read(p_channel uuid, p_at timestamptz DEFAULT now()) → timestamptz
--     Cursorul de citire, scris pe server: last_read_at = GREATEST(cel existent, LEAST(p_at, plafon)), unde
--     plafon = cel mai mare dintre now() și (cel mai nou mesaj existent în fir + 1 ms).
--       · nu mai poate merge ÎNAPOI (două dispozitive, răspunsuri sosite în altă ordine);
--       · nu mai poate fi ÎN VIITOR față de ceasul serverului (ceasul telefonului înainte ar ascunde necititele până
--         la data aceea); singura excepție e un mesaj existent cu dată din viitor, care trebuie să poată fi citit;
--       · un cursor EXISTENT rămas peste plafon (scris de un 1.0.x cu ceasul înainte) e adus înapoi la primul apel;
--       · când cursorul nu se schimbă NU se scrie nimic (fără UPDATE gol → fără eveniment Realtime de pomană);
--       · doar pentru conversațiile la care sunt participant / canalele care există; întoarce cursorul rezultat.
--     Clientul 1.1 apelează mark_channel_read FĂRĂ p_at (= plafonul: ceasul serverului, nu al telefonului).
--     GOL VECHI, NEATINS AICI (de decis de David): clientul poate alege created_at la INSERT în messages /
--     channel_messages (grant la nivel de tabel, niciun trigger nu-l fixează). Remediul ar fi un trigger BEFORE INSERT
--     care pune now() pentru inserările făcute direct de client — atinge drumul de inserare al 1.0.x, deci nu e în
--     această migrare.
--
-- Ce NU face (rămâne pentru varianta A, care se poate adăuga peste aceasta fără rescriere): niciun obiect în schema
-- `realtime`, niciun trigger de broadcast, nicio politică pe realtime.messages. Numele și semnăturile RPC-urilor sunt
-- cele din planul fazei 5, deci A le refolosește ca atare.
-- Publicația `supabase_realtime` NU e atinsă (cele 5 tabele rămân: clienții 1.0.x ascultă Postgres Changes).
-- Tabelele, politicile RLS și grant-urile pe message_reads / channel_reads NU sunt atinse.
-- Clienții 1.0.6–1.0.8: nimic — nu apelează funcțiile noi; `upsert`-ul lor direct pe message_reads / channel_reads merge
-- în continuare (politicile „user manages own reads” / channel_reads_own rămân). Evenimentele Realtime pe care le primesc
-- sunt aceleași (rândurile scrise de RPC sunt în aceleași tabele publicate).
-- Indexuri folosite (există din baseline): idx_messages_conversation_created (conversation_id, created_at DESC),
-- idx_channel_messages_channel_created (channel_id, created_at DESC), idx_conversations_driver / _mechanic, cheile primare
-- message_reads(conversation_id, user_id), channel_reads(channel_id, user_id), conversation_deletions.
-- Rollback: supabase/rollback/20261113000100_unread_counts_mark_read.sql (DROP FUNCTION ×4; nimic de date).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('app.profiles') IS NULL THEN RAISE EXCEPTION 'cere faza 4 (app.profiles)'; END IF;
  IF to_regprocedure('public.is_admin(uuid)') IS NULL THEN RAISE EXCEPTION 'cere public.is_admin'; END IF;
  IF to_regclass('public.idx_messages_conversation_created') IS NULL THEN RAISE EXCEPTION 'lipseste idx_messages_conversation_created'; END IF;
  IF to_regclass('public.idx_channel_messages_channel_created') IS NULL THEN RAISE EXCEPTION 'lipseste idx_channel_messages_channel_created'; END IF;
  IF to_regprocedure('public.unread_counts()') IS NOT NULL
     OR to_regprocedure('public.channel_unread_count(uuid)') IS NOT NULL
     OR to_regprocedure('public.mark_conversation_read(uuid, timestamptz)') IS NOT NULL
     OR to_regprocedure('public.mark_channel_read(uuid, timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'functiile fazei 5 exista deja: migrarea a fost aplicata?';
  END IF;
END $$;

-- ── 1. unread_counts ────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.unread_counts()
 RETURNS TABLE(conversation_id uuid, unread integer)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT c.id, u.n
    FROM public.conversations c
    LEFT JOIN public.message_reads r
           ON r.conversation_id = c.id AND r.user_id = (SELECT auth.uid())
   CROSS JOIN LATERAL (
          SELECT count(*)::integer AS n
            FROM (SELECT 1
                    FROM public.messages m
                   WHERE m.conversation_id = c.id
                     AND m.sender_id <> (SELECT auth.uid())
                     AND m.deleted_at IS NULL
                     -- COALESCE, nu „IS NULL OR”: așa cursorul e limită pe idx_messages_conversation_created și
                     -- numărătoarea unei conversații citite nu mai parcurge tot istoricul ei (review 12 nov)
                     AND m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamptz)
                   LIMIT 100) x
        ) u
   WHERE (c.driver_id = (SELECT auth.uid()) OR c.mechanic_id = (SELECT auth.uid()))
     AND NOT EXISTS (SELECT 1 FROM public.conversation_deletions d
                      WHERE d.conversation_id = c.id AND d.user_id = (SELECT auth.uid()))
     AND u.n > 0;
$function$;
REVOKE ALL ON FUNCTION public.unread_counts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unread_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.unread_counts() TO service_role;
COMMENT ON FUNCTION public.unread_counts() IS 'Faza 5 (B): necititele mele pe conversație, într-o singură interogare (doar conversațiile cu > 0; plafon 100).';

-- ── 2. channel_unread_count ─────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.channel_unread_count(p_channel uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT count(*)::integer
    FROM (SELECT 1
            FROM public.channel_messages m
           WHERE m.channel_id = p_channel
             AND m.sender_id <> (SELECT auth.uid())
             AND m.deleted_at IS NULL
             AND m.created_at > COALESCE((SELECT r.last_read_at FROM public.channel_reads r
                                           WHERE r.channel_id = p_channel AND r.user_id = (SELECT auth.uid())),
                                         '-infinity'::timestamptz)
             -- politica channel_messages_select_since_join, repetată (SECURITY DEFINER ocolește RLS): mesajele de după
             -- crearea contului meu; adminul le vede pe toate. O singură limită de jos, calculată o dată, ca să fie
             -- condiție de index; fără profil și fără rol de admin = NULL → niciun rând, ca prin RLS.
             AND m.created_at >= (SELECT CASE WHEN public.is_admin((SELECT auth.uid())) THEN '-infinity'::timestamptz
                                              ELSE (SELECT p.created_at FROM app.profiles p WHERE p.id = (SELECT auth.uid())) END)
           LIMIT 100) x;
$function$;
REVOKE ALL ON FUNCTION public.channel_unread_count(p_channel uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.channel_unread_count(p_channel uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.channel_unread_count(p_channel uuid) TO service_role;
COMMENT ON FUNCTION public.channel_unread_count(p_channel uuid) IS 'Faza 5 (B): necititele mele dintr-un canal (de după crearea contului; plafon 100).';

-- ── 3. mark_conversation_read ───────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.mark_conversation_read(p_conversation uuid, p_at timestamptz DEFAULT now())
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_newest timestamptz;   -- cel mai nou mesaj neșters din fir + 1 ms (NULL = fir fără mesaje)
  v_cap timestamptz;
  v_at  timestamptz;
  v_out timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversations c
                  WHERE c.id = p_conversation AND (c.driver_id = v_uid OR c.mechanic_id = v_uid)) THEN
    RAISE EXCEPTION 'not_participant' USING ERRCODE = '42501';
  END IF;
  -- Plafonul cursorului: ceasul serverului SAU cel mai nou mesaj existent + 1 ms, care e mai mare. A doua parte
  -- contează doar pentru un mesaj cu dată din viitor (clientul poate trimite created_at la INSERT — gol vechi):
  -- fără ea mesajul acela n-ar putea fi citit niciodată și bulina ar rămâne aprinsă (review 12 nov).
  -- Doar mesajele neșterse: odată șters (tombstone) un mesaj cu dată din viitor, plafonul revine la now().
  v_newest := (SELECT max(m.created_at) FROM public.messages m
                WHERE m.conversation_id = p_conversation AND m.deleted_at IS NULL) + interval '1 millisecond';
  v_cap := GREATEST(now(), COALESCE(v_newest, now()));
  v_at := LEAST(COALESCE(p_at, v_cap), v_cap);
  INSERT INTO public.message_reads AS r (conversation_id, user_id, last_read_at)
  VALUES (p_conversation, v_uid, v_at)
  ON CONFLICT (conversation_id, user_id) DO UPDATE
        SET last_read_at = EXCLUDED.last_read_at
      WHERE r.last_read_at < EXCLUDED.last_read_at            -- doar înainte; altfel nu se scrie nimic
         -- un cursor rămas în VIITOR (scris de un 1.0.x cu ceasul înainte, sau rămas după ștergerea unui mesaj cu dată
         -- din viitor) e adus înapoi. Comparat cu ceasul de ACUM, nu cu now()-ul tranzacției: altfel, la două apeluri
         -- aproape simultane, cel pornit mai devreme ar da înapoi cursorul scris de cel pornit mai târziu.
         OR r.last_read_at > GREATEST(clock_timestamp(), COALESCE(v_newest, '-infinity'::timestamptz))
  RETURNING r.last_read_at INTO v_out;
  IF v_out IS NULL THEN
    SELECT r.last_read_at INTO v_out FROM public.message_reads r
     WHERE r.conversation_id = p_conversation AND r.user_id = v_uid;
  END IF;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.mark_conversation_read(p_conversation uuid, p_at timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(p_conversation uuid, p_at timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(p_conversation uuid, p_at timestamptz) TO service_role;
COMMENT ON FUNCTION public.mark_conversation_read(p_conversation uuid, p_at timestamptz) IS 'Faza 5 (B): cursorul meu de citire pe o conversație; nu merge înapoi și nu trece de now().';

-- ── 4. mark_channel_read ────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.mark_channel_read(p_channel uuid, p_at timestamptz DEFAULT now())
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_newest timestamptz;   -- cel mai nou mesaj neșters din fir + 1 ms (NULL = fir fără mesaje)
  v_cap timestamptz;
  v_at  timestamptz;
  v_out timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channels ch WHERE ch.id = p_channel) THEN
    RAISE EXCEPTION 'channel_not_found' USING ERRCODE = '42501';
  END IF;
  -- Același plafon ca la conversații: now() sau cel mai nou mesaj existent + 1 ms. Fără p_at (clientul 1.1)
  -- cursorul e chiar plafonul: tot ce există în canal e citit, inclusiv un mesaj cu dată din viitor.
  -- Doar mesajele neșterse (vezi mark_conversation_read).
  v_newest := (SELECT max(m.created_at) FROM public.channel_messages m
                WHERE m.channel_id = p_channel AND m.deleted_at IS NULL) + interval '1 millisecond';
  v_cap := GREATEST(now(), COALESCE(v_newest, now()));
  v_at := LEAST(COALESCE(p_at, v_cap), v_cap);
  INSERT INTO public.channel_reads AS r (channel_id, user_id, last_read_at)
  VALUES (p_channel, v_uid, v_at)
  ON CONFLICT (channel_id, user_id) DO UPDATE
        SET last_read_at = EXCLUDED.last_read_at
      WHERE r.last_read_at < EXCLUDED.last_read_at            -- doar înainte; altfel nu se scrie nimic
         -- un cursor rămas în VIITOR (scris de un 1.0.x cu ceasul înainte, sau rămas după ștergerea unui mesaj cu dată
         -- din viitor) e adus înapoi. Comparat cu ceasul de ACUM, nu cu now()-ul tranzacției: altfel, la două apeluri
         -- aproape simultane, cel pornit mai devreme ar da înapoi cursorul scris de cel pornit mai târziu.
         OR r.last_read_at > GREATEST(clock_timestamp(), COALESCE(v_newest, '-infinity'::timestamptz))
  RETURNING r.last_read_at INTO v_out;
  IF v_out IS NULL THEN
    SELECT r.last_read_at INTO v_out FROM public.channel_reads r
     WHERE r.channel_id = p_channel AND r.user_id = v_uid;
  END IF;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.mark_channel_read(p_channel uuid, p_at timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_channel_read(p_channel uuid, p_at timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_channel_read(p_channel uuid, p_at timestamptz) TO service_role;
COMMENT ON FUNCTION public.mark_channel_read(p_channel uuid, p_at timestamptz) IS 'Faza 5 (B): cursorul meu de citire pe un canal; nu merge înapoi și nu trece de now().';

-- ── 5. Verificări + PostgREST ───────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.unread_counts()', 'public.channel_unread_count(uuid)',
                           'public.mark_conversation_read(uuid, timestamptz)', 'public.mark_channel_read(uuid, timestamptz)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION '% executabil de anon', f; END IF;
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION '% fara EXECUTE pentru authenticated', f; END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = f::regprocedure) THEN RAISE EXCEPTION '% nu e SECURITY DEFINER', f; END IF;
  END LOOP;
  -- publicația pentru 1.0.x rămâne neatinsă
  IF (SELECT count(*) FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
         AND tablename IN ('messages', 'message_reads', 'conversations', 'channel_messages', 'channel_reads')) <> 5 THEN
    RAISE EXCEPTION 'publicatia supabase_realtime nu mai are cele 5 tabele ale chatului (1.0.x depinde de ele)';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
