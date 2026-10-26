-- 12 oct 2026 — închide EXECUTE pentru rolul `anon` pe toate funcțiile din `public`.
--
-- Aplicația nu are niciun flux fără sesiune care să apeleze RPC-uri (înregistrarea și
-- OTP-ul trec prin GoTrue, nu prin funcții SQL), deci `anon` nu are nevoie de niciuna.
-- Rămân executabile de anon DOAR helper-ele folosite în politicile RLS (evaluate ca rolul
-- apelant) — aceeași listă ca în checklistul de securitate — și funcțiile-trigger (nu se
-- apelează direct; se declanșează indiferent de drepturile rolului).
--
-- Capcană (lecția din 26 sept): funcțiile vechi au EXECUTE și prin grant-ul implicit către
-- PUBLIC, deci `REVOKE … FROM anon` singur nu ajunge. Revocăm de la PUBLIC + anon, iar
-- `authenticated` / `service_role` primesc înainte un GRANT explicit dacă aveau dreptul
-- (prin PUBLIC) — drepturile lor efective rămân neschimbate. Idempotentă.

DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS sr_x
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prokind = 'f'
       AND pg_get_function_result(p.oid) <> 'trigger'
       AND p.proname NOT IN ('is_admin', 'is_banned', 'is_block_between', 'is_conversation_blocked')
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    IF r.auth_x THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig); END IF;
    IF r.sr_x   THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',  r.sig); END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'REVOKE EXECUTE FROM PUBLIC, anon: % funcții', n;
END $$;
