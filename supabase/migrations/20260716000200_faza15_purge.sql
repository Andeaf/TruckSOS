-- Faza 15 — Etapa 15.2: purjă de cont (funcții + drop FK profil→auth + declanșator)
-- Rulează în Supabase Studio → SQL Editor, DUPĂ 20260716_faza15_schema.sql.
--
-- ⚠️ Această migrare pregătește ștergerea IREVERSIBILĂ a datelor. Nu șterge nimic la rulare —
-- doar creează funcțiile, rupe cascada profil→auth și pune declanșatorul. Ștergerea efectivă se
-- face abia când Edge Function-ul (15.3) apelează purge_user_data() sau când un user e șters din
-- auth (dashboard) și declanșatorul rulează.
--
-- PRECONDIȚIE: `message_reads` și `conversation_deletions` trebuie să existe (create din dashboard,
-- Faza 5). Aplicația le folosește activ, deci există — dar verifică dacă ai dubii:
--   SELECT to_regclass('public.message_reads'), to_regclass('public.conversation_deletions');
-- Ambele trebuie să întoarcă numele, nu NULL.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. _purge_user_data(uuid) — MOTORUL. Intern, revoke public. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
-- Face TOATĂ munca de bază de date, atomic (o singură tranzacție de funcție), și întoarce array-ul
-- de căi Storage pe care apelantul (Edge Function cu service_role) le va șterge din bucketul `photos`.
-- Profilul e PĂSTRAT ca piatră-funerară (deleted_at), deci cascada din profiles NU se declanșează —
-- ștergem explicit tot ce trebuie ȘTERS. Vezi PLAN_FAZA15.md F15.2 pentru inventar + ordine.
CREATE OR REPLACE FUNCTION _purge_user_data(p_uid uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted timestamptz;
  v_paths   text[] := '{}';
  v_avatar  text;
  v_ann     text[];
  v_chat    text[];
  v_chan    text[];
BEGIN
  -- ── Idempotență: dacă profilul nu există sau e deja piatră-funerară, nu facem nimic ──
  SELECT deleted_at INTO v_deleted FROM profiles WHERE id = p_uid;
  IF NOT FOUND OR v_deleted IS NOT NULL THEN
    RETURN '{}';
  END IF;

  -- ── PASUL 0: colectăm căile Storage ÎNAINTE de orice DELETE/UPDATE (Capcana #2) ──
  -- a) avatarul propriu
  SELECT avatar_path INTO v_avatar FROM profiles WHERE id = p_uid;
  IF v_avatar IS NOT NULL THEN
    v_paths := v_paths || v_avatar;
  END IF;

  -- b) pozele anunțurilor lui (announcement_photos cascadează cu anunțul, dar obiectele Storage nu)
  SELECT COALESCE(array_agg(ap.storage_path), '{}')
  INTO v_ann
  FROM announcement_photos ap
  JOIN announcements a ON a.id = ap.announcement_id
  WHERE a.driver_id = p_uid;
  v_paths := v_paths || v_ann;

  -- c) pozele lui din chat privat — DOAR cele care NU sunt dovadă într-un raport `pending`
  --    (același guard ca în delete_message). Colectăm căile ACUM (înainte să golim image_path).
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

  -- ── PASUL 1: tombstone pentru mesajele-poză ale lui (reutilizăm tombstone-ul Faza 14) ──
  -- Textul rămâne pentru mesajele-text (anonimizate prin piatra-funerară); DOAR pozele devin
  -- „Acest mesaj a fost șters". Excepția pentru dovezi `pending` = același predicat ca la colectare.
  UPDATE messages m
  SET content = '', image_path = NULL, deleted_at = now()
  WHERE m.sender_id = p_uid
    AND m.image_path IS NOT NULL
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );

  UPDATE channel_messages cm
  SET content = '', image_path = NULL, deleted_at = now()
  WHERE cm.sender_id = p_uid
    AND cm.image_path IS NOT NULL
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );

  -- ── PASUL 2: ȘTERGERI explicite (profilul e păstrat, deci cascada din profiles nu se declanșează) ──
  -- Anunțurile (conțin locație/plăcuță/camion). CASCADEAZĂ la: applications + announcement_photos
  -- (rânduri) pentru acele anunțuri, ȘI conversations.announcement_id → SET NULL (15.1) — deci
  -- conversațiile SUPRAVIEȚUIESC, mesajele lor rămân. Fără coliziune de index (is_direct = false).
  DELETE FROM announcements       WHERE driver_id   = p_uid;
  DELETE FROM trucks              WHERE driver_id   = p_uid;
  DELETE FROM applications        WHERE mechanic_id = p_uid;          -- ofertele lui ca mecanic
  DELETE FROM ratings             WHERE driver_id   = p_uid;          -- rating-uri DATE (trigger recompute)
  DELETE FROM ratings             WHERE mechanic_id = p_uid;          -- rating-uri PRIMITE
  DELETE FROM favorite_mechanics  WHERE driver_id   = p_uid OR mechanic_id = p_uid;
  DELETE FROM search_history      WHERE driver_id   = p_uid OR mechanic_id = p_uid;
  DELETE FROM message_reads       WHERE user_id     = p_uid;
  DELETE FROM conversation_deletions WHERE user_id  = p_uid;
  DELETE FROM channel_reads       WHERE user_id     = p_uid;
  DELETE FROM push_tokens         WHERE user_id     = p_uid;
  -- reports (făcute de el ȘI împotriva lui): PĂSTRATE ANONIMIZAT — nu ștergem nimic (pointează la piatra-funerară).

  -- ── PASUL 3: scrub PII pe profil → piatră-funerară ──
  -- full_name e NOT NULL în schemă → îl golim la '' (nu NULL). Afișarea „Utilizator șters" vine din
  -- deleted_at (UI-ul, 15.4), nu din valoarea stocată — deci '' nu se vede niciodată.
  UPDATE profiles SET
    full_name      = '',
    avatar_path    = NULL,
    phone          = NULL,
    specialization = NULL,
    activity_zone  = NULL,
    latitude       = NULL,
    longitude      = NULL,
    push_enabled   = false,
    deleted_at     = now()
  WHERE id = p_uid;

  RETURN v_paths;
END;
$$;

-- Motorul NU e apelabil direct prin API (nimeni nu poate purja alt cont printr-un uid arbitrar).
REVOKE ALL ON FUNCTION _purge_user_data(uuid) FROM public;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. purge_user_data() — RPC PUBLIC, fără parametri. Singura poartă din aplicație.
-- ═══════════════════════════════════════════════════════════════════════════
-- Ia uid-ul DIN JWT (auth.uid()), niciodată dintr-un parametru → imposibil să țintești alt cont.
-- SECURITY DEFINER ca să poată apela _purge_user_data (revoke de la public). Apelat de Edge Function
-- (15.3) cu JWT-ul utilizatorului; întoarce căile Storage pe care Edge Function-ul le șterge apoi.
CREATE OR REPLACE FUNCTION purge_user_data()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  RETURN _purge_user_data(v_uid);
END;
$$;

REVOKE ALL ON FUNCTION purge_user_data() FROM public;
GRANT EXECUTE ON FUNCTION purge_user_data() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Declanșator AFTER DELETE ON auth.users — închide Riscul 1 (ștergere din dashboard)
-- ═══════════════════════════════════════════════════════════════════════════
-- Cu FK-ul profil→auth rupt (secțiunea 4), o ștergere de user din dashboard NU mai atinge profilul.
-- Declanșatorul garantează că și acea cale purjă complet (nu doar scrub) → niciun profil orfan cu PII.
-- Reziduu acceptat: obiectele Storage rămân orfane pe calea dashboard (un trigger nu poate șterge din
-- Storage). Calea aplicație rulează întâi purge_user_data() → aici e noop (early-out pe deleted_at).
CREATE OR REPLACE FUNCTION handle_auth_user_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _purge_user_data(OLD.id);   -- căile Storage întoarse se ignoră (trigger nu atinge Storage)
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_auth_user_deleted();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Rupem cascada profil→auth (Opțiunea A) — ULTIMA, atomic cu declanșatorul deja creat
-- ═══════════════════════════════════════════════════════════════════════════
-- Fără asta, ștergerea auth.users ar șterge profilul (piatra-funerară). Cu FK-ul rupt, profilul
-- supraviețuiește ștergerii contului auth. Integritatea la signup rămâne asigurată de RLS
-- (profiles insert USING auth.uid() = id). Drop DINAMIC (nu presupunem numele constrângerii).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel       ON rel.oid = con.conrelid
    JOIN pg_namespace nsp   ON nsp.oid = rel.relnamespace
    JOIN pg_class frel      ON frel.oid = con.confrelid
    JOIN pg_namespace fnsp  ON fnsp.oid = frel.relnamespace
    WHERE con.contype = 'f'
      AND nsp.nspname = 'public'  AND rel.relname  = 'profiles'
      AND fnsp.nspname = 'auth'   AND frel.relname = 'users'
  LOOP
    EXECUTE format('ALTER TABLE profiles DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificări (rulează manual, pe CONTURI DE TEST throwaway — ștergerea e ireversibilă!)
-- ═══════════════════════════════════════════════════════════════════════════
-- a) FK-ul profil→auth a dispărut:
--      SELECT conname FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
--      WHERE r.relname='profiles' AND c.contype='f' AND c.confrelid='auth.users'::regclass;
--    → 0 rânduri.
-- b) Declanșatorul există:
--      SELECT tgname FROM pg_trigger WHERE tgname='on_auth_user_deleted';
-- c) Purjă din aplicație (simulare): autentificat ca user de test, în SQL Editor „Run as authenticated"
--    (sau din Edge Function la 15.3):  SELECT purge_user_data();
--    → întoarce array de căi; profilul devine deleted_at NOT NULL, full_name=''; anunțuri/camioane/
--      rating-uri/favorite/push_tokens ale lui = ȘTERSE; conversațiile + mesajele-text = PĂSTRATE;
--      mesajele-poză ale lui = tombstone (deleted_at); rapoartele = PĂSTRATE.
-- d) Idempotență: al doilea SELECT purge_user_data() pe același cont → '{}' (early-out), fără erori.
-- e) Guard dovadă: un mesaj-poză al lui raportat cu status='pending' → image_path RĂMÂNE (nu e în
--    array-ul întors, mesajul NU devine tombstone).
-- f) Cale dashboard: șterge un user de test din Authentication → Users → declanșatorul purjă DB-ul
--    (profil scrub + anunțuri/camioane șterse); obiectele Storage rămân orfane (acceptat).
-- g) Perspectiva celuilalt participant: conversația lui rămâne, mesajele-text apar (vor deveni
--    „Utilizator șters" după UI-ul din 15.4), poate deschide chatul fără erori.
