CREATE TEMP TABLE probe_result (ord int, k text, v text) ON COMMIT DROP;
DO $probe$
DECLARE
  v_admin uuid;
  v_conv uuid;
  v_at timestamptz;
  v_far constant timestamptz := '2099-01-01T00:00:00Z';
BEGIN
  -- un cont de admin care e participant într-o conversație (contul tău); fără el proba se sare, nu se inventează date
  SELECT p.id, c.id INTO v_admin, v_conv
    FROM public.conversations c
    JOIN app.profiles p ON p.id IN (c.driver_id, c.mechanic_id)
   WHERE p.role = 'admin' AND p.banned_at IS NULL AND p.deleted_at IS NULL
   ORDER BY c.created_at DESC LIMIT 1;
  IF v_admin IS NULL THEN
    INSERT INTO probe_result VALUES (1, 'proba ca authenticated', 'SARIT: niciun admin nu e participant intr-o conversatie');
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.messages (conversation_id, sender_id, content, created_at)
  VALUES (v_conv, v_admin, 'proba created_at (ROLLBACK)', v_far) RETURNING created_at INTO v_at;
  EXECUTE 'RESET ROLE';
  INSERT INTO probe_result VALUES (1, 'messages ca authenticated, trimis 2099 (asteptat OK: now())',
    CASE WHEN v_at = now() THEN 'OK: now()' ELSE 'GRESIT: ' || v_at::text END);

  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (v_conv, v_admin, 'proba fara created_at (ROLLBACK)') RETURNING created_at INTO v_at;
  EXECUTE 'RESET ROLE';
  INSERT INTO probe_result VALUES (2, 'messages ca authenticated, fara created_at - forma 1.0.x (asteptat OK: now())',
    CASE WHEN v_at = now() THEN 'OK: now()' ELSE 'GRESIT: ' || COALESCE(v_at::text, 'NULL') END);

  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.messages (conversation_id, sender_id, content, created_at)
  VALUES (v_conv, v_admin, 'proba postgres (ROLLBACK)', '2020-02-02T02:02:02Z') RETURNING created_at INTO v_at;
  INSERT INTO probe_result VALUES (3, 'messages ca postgres, trimis 2020 (asteptat OK: pastrat)',
    CASE WHEN v_at = '2020-02-02T02:02:02Z'::timestamptz THEN 'OK: pastrat' ELSE 'GRESIT: ' || v_at::text END);
EXCEPTION WHEN OTHERS THEN
  -- orice eroare (RLS, rate limit, ban) se raportează ca rezultat; tranzacția se termină oricum cu ROLLBACK
  BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN OTHERS THEN NULL; END;
  INSERT INTO probe_result VALUES (99, 'EROARE in proba', SQLSTATE || ' ' || SQLERRM);
END
$probe$;
SELECT k, v FROM probe_result ORDER BY ord;
