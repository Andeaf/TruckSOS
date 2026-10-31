-- ─────────────────────────────────────────────────────────────────────────────
-- 25 oct 2026 — FUNDAȚIA DE GRANT-URI (PLAN_1.1, Faza A1)
--
-- Cum se rulează: Supabase Studio → SQL Editor, întreg fișierul dintr-o dată
-- (pg-meta îl execută ca o singură tranzacție implicită: orice eroare, inclusiv
-- verificarea de la pasul 9, anulează TOT). Repetiție fără efect:
--     BEGIN;  <conținutul fișierului>  ROLLBACK;
-- Rollback real, după COMMIT: supabase/rollback/20261025_grants_baseline.sql
--
-- DOAR SERVER. Compatibilă cu toate versiunile publicate (1.0.0–1.0.8):
--   * pentru `authenticated` efectul e identic cu azi — RLS refuza deja tot ce nu
--     are politică; aici doar dispare „al doilea lacăt lipsă”;
--   * `anon` nu e folosit de niciun ecran (verificat în cod pe 24 oct: login,
--     register, forgot-password, banned nu ating PostgREST; p/[id] citește doar
--     cu sesiune; diagnosticul de rețea sondează /auth/v1/health).
--
-- DE CE: din 30 oct 2026 Supabase nu mai acordă automat privilegii Data API pe
-- tabelele noi din `public`. Azi anon/authenticated/service_role au ALL (inclusiv
-- TRUNCATE) pe 25/26 tabele și RLS e singurul lacăt. De acum grant-urile sunt
-- explicite, exacte și verificate în ambele direcții.
--
-- PAȘI
--   1. default privileges pe tabele/secvențe NOI: nimic implicit pentru cele 3 roluri
--   2. anon: zero pe toate tabelele (oaspeții primesc acces în 20261026_guest_access)
--   3. authenticated: exact comenzile pentru care există politici (derivat din pg_policies)
--   4. service_role: ALL
--   5. cele 8 politici `TO public` care apelează helperii DEFINER → `TO authenticated`
--   6. REVOKE EXECUTE pe is_admin / is_banned / is_block_between / is_conversation_blocked
--      FROM PUBLIC, anon (authenticated și service_role rămân)
--   7. DROP POLICY "mechanic can apply" — INSERT-ul direct ocolea RPC-ul; clientul
--      scrie în applications DOAR prin RPC-uri SECURITY DEFINER (verificat: toate 6
--      sunt DEFINER; RPC-ul e în client din 23 iun 2026, înaintea lansării)
--   8. _purge_user_data: scrub și address / vat_number / company_name / contact_email
--   9. verificare în ambele direcții; eșec = EXCEPTION = nimic nu se aplică
--
-- CONVENȚIE DE ACUM ÎNCOLO (verificată de scripts/check-migrations.mjs în CI):
--   * CREATE TABLE → în ACELAȘI fișier: ENABLE ROW LEVEL SECURITY, politicile,
--     REVOKE ALL … FROM anon (sau GRANT explicit către anon, dacă e intenționat),
--     GRANT <exact comenzile cu politici> TO authenticated, GRANT ALL TO service_role.
--   * CREATE VIEW → GRANT SELECT explicit. Un view pentru anon e `security_invoker = true`
--     și conține DOAR coloane pe care anon le poate citi direct (grant pe coloane);
--     orice transformare = coloană generată pe tabelul de bază, niciodată expresie în view.
--   * CREATE FUNCTION (ne-trigger) → REVOKE EXECUTE … FROM PUBLIC, anon, authenticated,
--     apoi GRANT EXECUTE … TO authenticated doar pentru RPC-urile apelate din client
--     (+ intrare în allowlist-ul din _TEST_security_checklist.sql).
--   * Secvențe (dacă apar): GRANT USAGE, SELECT explicit.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. Lacătele: ALTER/DROP POLICY iau AccessExclusiveLock pe tabel până la COMMIT.
--       Dacă o cerere lungă ține un tabel ocupat, migrarea eșuează curat după 5 s în
--       loc să pună în coadă toate cererile spre announcements / market_listings.
--       (Rulează în interiorul BEGIN … COMMIT, altfel SET LOCAL n-are efect.)
SET LOCAL lock_timeout = '5s';

-- ── 1. Privilegii implicite pe obiecte NOI (doar obiecte viitoare; schema de azi neatinsă) ──
-- Tabelele sunt toate ale rolului `postgres` (verificat: pg_class.relowner), deci
-- intrarea `FOR ROLE postgres` e cea care contează. ALL (nu doar S/I/U/D): altfel
-- un tabel nou ar primi în continuare TRUNCATE/REFERENCES/TRIGGER implicit.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;

-- ── 2. anon: nimic pe tabele (și pe view-uri, dacă ar exista) ─────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- ── 3. authenticated: exact comenzile cu politici ────────────────────────────
-- Întâi totul jos, apoi grant-urile derivate din pg_policies (auditul din 24 oct;
-- pasul 9 re-derivă lista din pg_policies și eșuează la orice diferență).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;

GRANT SELECT                         ON public.admin_audit_log        TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.announcement_photos    TO authenticated;
GRANT SELECT                         ON public.announcement_views     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements          TO authenticated;
GRANT SELECT, UPDATE                 ON public.app_versions           TO authenticated;
GRANT SELECT                         ON public.applications           TO authenticated; -- INSERT dispare la pasul 7
GRANT SELECT, INSERT, DELETE         ON public.blocked_users          TO authenticated;
GRANT SELECT, INSERT                 ON public.channel_messages       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_push_prefs     TO authenticated;
-- channel_push_state: fără politici → fără grant (doar triggerele DEFINER îl scriu)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_reads          TO authenticated;
GRANT SELECT                         ON public.channels               TO authenticated;
GRANT SELECT, INSERT                 ON public.client_diagnostics     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_deletions TO authenticated;
GRANT SELECT                         ON public.conversations          TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.favorite_mechanics     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_listing_photos  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_listings        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reads          TO authenticated;
GRANT SELECT, INSERT                 ON public.messages               TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.profiles               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ratings                TO authenticated;
GRANT SELECT, INSERT                 ON public.reports                TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_history         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trucks                 TO authenticated;

-- ── 4. service_role: tot (Edge Functions, cron) ───────────────────────────────
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- ── 5. Politicile `TO public` care apelează helperii DEFINER → `TO authenticated` ──
-- Pentru conturile logate nimic nu se schimbă (nu le satisfăcea nimeni altcineva);
-- fără pasul ăsta, după 20261026_guest_access rolul `anon` ar evalua is_admin() /
-- is_block_between() din aceste politici și ar primi `permission denied` după pasul 6.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.tablename, p.policyname
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.roles = ARRAY['public']::name[]
       AND (p.tablename, p.policyname) IN (
         ('admin_audit_log',     'audit_select_admin'),
         ('announcement_photos', 'announcement_photos_select_admin'),
         ('announcement_views',  'announcement_views_select_admin'),
         ('announcements',       'announcements_insert_admin'),
         ('announcements',       'announcements_select_admin'),
         ('app_versions',        'app_versions_update_admin'),
         ('channel_messages',    'channel_messages_select_since_join'),
         ('market_listings',     'market_select_not_blocked'))
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ── 6. Helperii RLS: EXECUTE doar pentru authenticated + service_role ────────
-- ACL-ul de azi: {=X (PUBLIC), anon, authenticated, service_role}. Lecția din 26 sept:
-- REVOKE … FROM anon singur nu ajunge cât timp PUBLIC păstrează EXECUTE.
GRANT  EXECUTE ON FUNCTION public.is_admin(uuid)                TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.is_banned(uuid)               TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.is_block_between(uuid, uuid)  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.is_conversation_blocked(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_banned(uuid)               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_block_between(uuid, uuid)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_conversation_blocked(uuid) FROM PUBLIC, anon;

-- ── 7. applications: fără INSERT direct ───────────────────────────────────────
-- Gardă: dacă vreun RPC care scrie în applications NU ar fi SECURITY DEFINER, ar
-- insera ca utilizatorul și fără politică s-ar bloca candidaturile → oprim totul.
DO $$
DECLARE
  v_invoker text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_invoker
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('apply_to_announcement', 'resubmit_application', 'withdraw_application',
                       'dismiss_application', 'accept_application', 'reject_application')
     AND NOT p.prosecdef;
  IF v_invoker IS NOT NULL THEN
    RAISE EXCEPTION 'A1 pasul 7: RPC-uri SECURITY INVOKER pe applications (%) — politica de INSERT trebuie păstrată', v_invoker;
  END IF;
END $$;
DROP POLICY IF EXISTS "mechanic can apply" ON public.applications;

-- ── 8. _purge_user_data: scrub complet al PII la ștergerea contului ──────────
-- Identică cu definiția live (pg_get_functiondef, 24 oct) + cele 4 coloane noi în
-- PASUL 3. CREATE OR REPLACE păstrează ACL-ul (postgres, service_role) și owner-ul.
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
  SELECT deleted_at INTO v_deleted FROM profiles WHERE id = p_uid;
  IF NOT FOUND OR v_deleted IS NOT NULL THEN
    RETURN '{}';
  END IF;

  -- ── PASUL 0: colectăm căile Storage ÎNAINTE de orice DELETE/UPDATE ──
  -- a) avatarul propriu
  SELECT avatar_path INTO v_avatar FROM profiles WHERE id = p_uid;
  IF v_avatar IS NOT NULL THEN
    v_paths := v_paths || v_avatar;
  END IF;

  -- b) pozele anunțurilor lui de depanare
  SELECT COALESCE(array_agg(ap.storage_path), '{}')
  INTO v_ann
  FROM announcement_photos ap
  JOIN announcements a ON a.id = ap.announcement_id
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
  DELETE FROM announcements       WHERE driver_id   = p_uid;
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
  UPDATE profiles SET
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
$function$;
-- Convenția: funcție internă, nimic pentru client (ACL-ul era deja așa; idempotent).
REVOKE EXECUTE ON FUNCTION public._purge_user_data(uuid) FROM PUBLIC, anon, authenticated;

-- ── 9. Verificare în ambele direcții (eșec = EXCEPTION = tranzacția se anulează) ──
DO $$
DECLARE
  r          record;
  v_expected text[];
  v_actual   text[];
  v_bad      text := '';
  v_fn       text;
BEGIN
  -- (a) anon: niciun privilegiu pe tabele / view-uri / coloane din public
  FOR r IN
    SELECT c.oid, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v')
  LOOP
    IF has_table_privilege('anon', r.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_any_column_privilege('anon', r.oid, 'SELECT')
       OR has_any_column_privilege('anon', r.oid, 'INSERT')
       OR has_any_column_privilege('anon', r.oid, 'UPDATE')
       OR has_any_column_privilege('anon', r.oid, 'REFERENCES') THEN
      v_bad := v_bad || format(' [anon are privilegii pe %s]', r.relname);
    END IF;
  END LOOP;

  -- (b) authenticated: grant-uri = comenzi cu politici (ambele direcții), fără TRUNCATE/REFERENCES/TRIGGER
  FOR r IN
    SELECT c.oid, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    SELECT coalesce(array_agg(DISTINCT s.cmd ORDER BY s.cmd), '{}') INTO v_expected
      FROM (
        SELECT unnest(CASE WHEN p.cmd = 'ALL' THEN ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']
                           ELSE ARRAY[p.cmd::text] END) AS cmd
          FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = r.relname
           AND (p.roles @> ARRAY['authenticated']::name[] OR p.roles @> ARRAY['public']::name[])
      ) s;
    SELECT coalesce(array_agg(priv ORDER BY priv), '{}') INTO v_actual
      FROM unnest(ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']) AS priv
     WHERE has_table_privilege('authenticated', r.oid, priv);
    IF v_expected <> v_actual THEN
      v_bad := v_bad || format(' [%s: politici=%s grant=%s]', r.relname,
                               array_to_string(v_expected, '/'), array_to_string(v_actual, '/'));
    END IF;
    IF has_table_privilege('authenticated', r.oid, 'TRUNCATE, REFERENCES, TRIGGER') THEN
      v_bad := v_bad || format(' [%s: authenticated are TRUNCATE/REFERENCES/TRIGGER]', r.relname);
    END IF;
  END LOOP;

  -- (c) helperii: anon NU, authenticated DA
  FOREACH v_fn IN ARRAY ARRAY['public.is_admin(uuid)', 'public.is_banned(uuid)',
                              'public.is_block_between(uuid,uuid)', 'public.is_conversation_blocked(uuid)']
  LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      v_bad := v_bad || format(' [anon poate executa %s]', v_fn);
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      v_bad := v_bad || format(' [authenticated NU poate executa %s]', v_fn);
    END IF;
  END LOOP;

  -- (d) nicio politică TO public care să apeleze helperii; politica de INSERT direct a dispărut
  IF EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.roles @> ARRAY['public']::name[]
       AND (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))
           ~ '(is_admin|is_banned|is_block_between|is_conversation_blocked)\('
  ) THEN
    v_bad := v_bad || ' [politici TO public care apelează helperii]';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'applications'
                AND policyname = 'mechanic can apply') THEN
    v_bad := v_bad || ' [politica "mechanic can apply" încă există]';
  END IF;
  IF (SELECT count(*) FILTER (WHERE cmd = 'SELECT') <> 2 OR count(*) <> 2
        FROM pg_policies WHERE schemaname = 'public' AND tablename = 'applications') THEN
    v_bad := v_bad || ' [applications: așteptam exact 2 politici, ambele SELECT]';
  END IF;

  -- (e) privilegiile implicite pe tabele/secvențe noi nu mai includ cele 3 roluri —
  --     nici pe schema public, nici printr-o intrare GLOBALĂ (defaclnamespace = 0)
  IF EXISTS (
    SELECT 1 FROM pg_default_acl d
     WHERE pg_get_userbyid(d.defaclrole) = 'postgres'
       AND d.defaclobjtype IN ('r', 'S')
       AND (d.defaclnamespace = 0
            OR d.defaclnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
       AND (d.defaclacl::text LIKE '%anon=%' OR d.defaclacl::text LIKE '%authenticated=%'
            OR d.defaclacl::text LIKE '%service_role=%')
  ) THEN
    v_bad := v_bad || ' [default privileges încă deschise pentru anon/authenticated/service_role]';
  END IF;

  -- (f) purge-ul golește și coloanele noi
  IF pg_get_functiondef('public._purge_user_data(uuid)'::regprocedure) NOT LIKE '%vat_number     = NULL%' THEN
    v_bad := v_bad || ' [_purge_user_data fără scrub-ul nou]';
  END IF;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'A1 verificare EȘUATĂ:%', v_bad;
  END IF;
  RAISE NOTICE 'A1 verificare: PASS';
END $$;

-- Rezumat (ultimul rezultat afișat de Studio). Toate rândurile trebuie să fie PASS.
SELECT 1 AS nr, 'anon: tabele/view-uri cu vreun privilegiu' AS verificare,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS stare, count(*)::text AS detaliu
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v')
   AND (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        OR has_any_column_privilege('anon', c.oid, 'SELECT'))
UNION ALL
SELECT 2, 'authenticated: tabele cu TRUNCATE/REFERENCES/TRIGGER',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, count(*)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
   AND has_table_privilege('authenticated', c.oid, 'TRUNCATE, REFERENCES, TRIGGER')
UNION ALL
SELECT 3, 'authenticated: tabele fără niciun grant (așteptat: channel_push_state)',
       CASE WHEN string_agg(c.relname, ', ') = 'channel_push_state' THEN 'PASS' ELSE 'FAIL' END,
       coalesce(string_agg(c.relname, ', '), 'niciunul')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
   AND NOT has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
UNION ALL
SELECT 4, 'helperi executabili de anon',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, count(*)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('is_admin', 'is_banned', 'is_block_between', 'is_conversation_blocked')
   AND has_function_privilege('anon', p.oid, 'EXECUTE')
UNION ALL
SELECT 5, 'politici TO public pe applications (așteptat: 2 de SELECT)',
       CASE WHEN count(*) = 2 AND bool_and(cmd = 'SELECT') THEN 'PASS' ELSE 'FAIL' END,
       string_agg(policyname || ' (' || cmd || ')', ', ')
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'applications'
UNION ALL
SELECT 6, 'default privileges (postgres: public + global) pe tabele/secvențe',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       coalesce(string_agg(d.defaclobjtype::text || ': ' || d.defaclacl::text, ' | '), 'nicio intrare pentru cele 3 roluri')
  FROM pg_default_acl d
 WHERE pg_get_userbyid(d.defaclrole) = 'postgres' AND d.defaclobjtype IN ('r', 'S')
   AND (d.defaclnamespace = 0 OR d.defaclnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
   AND (d.defaclacl::text LIKE '%anon=%' OR d.defaclacl::text LIKE '%authenticated=%' OR d.defaclacl::text LIKE '%service_role=%')
ORDER BY nr;
