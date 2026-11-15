CREATE TEMP TABLE probe_result (ord int, k text, v text) ON COMMIT DROP;
GRANT INSERT ON probe_result TO authenticated;
DO $probe$
DECLARE
  v_admin uuid;
  v_conv uuid;
  v_channel uuid;
  v_new text;
  v_old text;
  v_n integer;
  v_m integer;
  v_at timestamptz;
  v_prev timestamptz;
BEGIN
  -- un cont de admin care e participant într-o conversație (pe producție: contul de admin al proprietarului); fără el proba se sare, nu se inventează date
  SELECT p.id, c.id INTO v_admin, v_conv
    FROM public.conversations c
    JOIN app.profiles p ON p.id IN (c.driver_id, c.mechanic_id)
   WHERE p.role = 'admin' AND p.banned_at IS NULL AND p.deleted_at IS NULL
   ORDER BY c.created_at DESC LIMIT 1;
  IF v_admin IS NULL THEN
    INSERT INTO probe_result VALUES (1, 'proba ca authenticated', 'SARIT: niciun admin nu e participant intr-o conversatie');
    RETURN;
  END IF;
  SELECT ch.id INTO v_channel FROM public.channels ch ORDER BY ch.created_at LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- 1. unread_counts() față de numărătoarea 1.0.x (useUnreadCounts), făcută aici prin RLS, ca rolul clientului:
  --    conversațiile mele, fără cele șterse de mine; mesajele celuilalt, neșterse, mai noi decât cursorul; plafon 100; doar > 0.
  SELECT COALESCE(string_agg(u.conversation_id::text || '=' || u.unread::text, ',' ORDER BY u.conversation_id), '') INTO v_new
    FROM public.unread_counts() u;
  SELECT COALESCE(string_agg(o.id::text || '=' || o.n::text, ',' ORDER BY o.id), '') INTO v_old
    FROM (SELECT c.id,
                 (SELECT count(*)::integer FROM (SELECT 1 FROM public.messages m
                    WHERE m.conversation_id = c.id AND m.sender_id <> v_admin AND m.deleted_at IS NULL
                      AND m.created_at > COALESCE((SELECT r.last_read_at FROM public.message_reads r
                                                    WHERE r.conversation_id = c.id AND r.user_id = v_admin), '-infinity'::timestamptz)
                    LIMIT 100) x) AS n
            FROM public.conversations c
           WHERE (c.driver_id = v_admin OR c.mechanic_id = v_admin)
             AND NOT EXISTS (SELECT 1 FROM public.conversation_deletions d WHERE d.conversation_id = c.id AND d.user_id = v_admin)) o
   WHERE o.n > 0;
  INSERT INTO probe_result VALUES (1, 'unread_counts() = numaratoarea 1.0.x prin RLS (asteptat OK: identic)',
    CASE WHEN v_new = v_old THEN 'OK: identic' ELSE 'DIFERIT' END);

  -- 2. channel_unread_count() față de numărătoarea 1.0.x (useChannelUnreadCount) prin RLS, plafon 100
  IF v_channel IS NULL THEN
    INSERT INTO probe_result VALUES (2, 'channel_unread_count()', 'SARIT: niciun canal');
  ELSE
    SELECT public.channel_unread_count(v_channel) INTO v_n;
    SELECT count(*)::integer INTO v_m FROM (SELECT 1 FROM public.channel_messages m
       WHERE m.channel_id = v_channel AND m.sender_id <> v_admin AND m.deleted_at IS NULL
         AND m.created_at > COALESCE((SELECT r.last_read_at FROM public.channel_reads r
                                       WHERE r.channel_id = v_channel AND r.user_id = v_admin), '-infinity'::timestamptz)
       LIMIT 100) x;
    INSERT INTO probe_result VALUES (2, 'channel_unread_count() = numaratoarea 1.0.x prin RLS (asteptat OK: identic)',
      CASE WHEN v_n = v_m THEN 'OK: identic' ELSE 'DIFERIT' END);
  END IF;

  -- 3. mark_conversation_read fără p_at: cursorul nu e în viitor și nu merge înapoi; apoi conversația nu mai are necitite
  SELECT r.last_read_at INTO v_prev FROM public.message_reads r WHERE r.conversation_id = v_conv AND r.user_id = v_admin;
  SELECT public.mark_conversation_read(v_conv) INTO v_at;
  INSERT INTO probe_result VALUES (3, 'mark_conversation_read: cursor intors, nu in viitor, nu inapoi (asteptat OK)',
    CASE WHEN v_at IS NULL THEN 'GRESIT: NULL'
         WHEN v_at > clock_timestamp() + interval '1 second'
              AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = v_conv AND m.deleted_at IS NULL AND m.created_at > now()) THEN 'GRESIT: in viitor'
         WHEN v_prev IS NOT NULL AND v_prev <= now() AND v_at < v_prev THEN 'GRESIT: a mers inapoi'
         ELSE 'OK' END);
  SELECT count(*)::integer INTO v_n FROM public.unread_counts() u WHERE u.conversation_id = v_conv;
  INSERT INTO probe_result VALUES (4, 'dupa citire, conversatia nu mai apare in unread_counts() (asteptat OK: 0)',
    CASE WHEN v_n = 0 THEN 'OK: 0' ELSE 'GRESIT: ' || v_n::text END);

  -- 4. mark_channel_read fără p_at (forma clientului 1.1): cursorul = ceasul serverului
  IF v_channel IS NOT NULL THEN
    SELECT public.mark_channel_read(v_channel) INTO v_at;
    INSERT INTO probe_result VALUES (5, 'mark_channel_read fara p_at: cursor intors, nu in viitor (asteptat OK)',
      CASE WHEN v_at IS NULL THEN 'GRESIT: NULL' WHEN v_at > clock_timestamp() + interval '1 second' THEN 'GRESIT: in viitor' ELSE 'OK' END);
  END IF;

  -- 5. drumul 1.0.x: upsert-ul direct pe message_reads merge în continuare, ca rolul clientului
  INSERT INTO public.message_reads (conversation_id, user_id, last_read_at) VALUES (v_conv, v_admin, now())
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;
  INSERT INTO probe_result VALUES (6, '1.0.x: upsert direct pe message_reads ca authenticated (asteptat OK)', 'OK');

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
EXCEPTION WHEN OTHERS THEN
  -- orice eroare (RLS, drepturi, sintaxă) se raportează ca rezultat; tranzacția se termină oricum cu ROLLBACK
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN OTHERS THEN NULL; END;
  INSERT INTO probe_result VALUES (99, 'EROARE in proba', SQLSTATE || ' ' || SQLERRM);
END
$probe$;
SELECT k, v FROM probe_result ORDER BY ord;
