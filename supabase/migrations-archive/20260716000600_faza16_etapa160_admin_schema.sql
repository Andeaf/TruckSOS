-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 16 — Etapa 16.0: Fundații admin (schemă + helpers + audit + anti-escaladare)
-- Rulează în Supabase Studio → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Ce face:
--   1. Adaugă 'admin' ca a treia valoare permisă pe profiles.role.
--   2. Coloane de ban pe profiles (banned_at / banned_until / ban_reason).
--   3. Coloană deleted_by_admin pe messages + channel_messages (marcaj „șters de moderator").
--   4. Tabelul admin_audit_log (+ RLS: SELECT doar admini, fără scriere din client).
--   5. Helperi is_admin() / is_banned(), refolosiți în politici și RPC-uri.
--   6. TRIGGER ANTI-ESCALADARE (CRITIC): blochează schimbarea din client a coloanelor
--      privilegiate (role, banned_*) — permise DOAR din service_role / migrări / RPC-uri
--      SECURITY DEFINER. Fără el, `profiles_update_own` (USING auth.uid()=id, fără
--      WITH CHECK, fără restricție de coloană) ar permite `UPDATE profiles SET role='admin'`.
--
-- Aditiv: politicile existente rămân neatinse; utilizatorii driver/mechanic nu simt nimic.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. role = 'admin' în CHECK (drop dinamic al constrângerii auto-numite + re-add)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_constraint text;
BEGIN
  SELECT conname INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.profiles'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%'
    AND pg_get_constraintdef(oid) ILIKE '%driver%';
  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE profiles DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('driver', 'mechanic', 'admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Coloane de ban pe profiles (ban APLICATIV — sursă de adevăr)
--    banned_at    NOT NULL => cont banat
--    banned_until NULL      => ban permanent; altfel expiră automat la now() > until
--    ban_reason             => motiv afișat pe ecranul de ban (localizat în UI)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS banned_at    timestamptz,
  ADD COLUMN IF NOT EXISTS banned_until timestamptz,
  ADD COLUMN IF NOT EXISTS ban_reason   text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. deleted_by_admin pe mesaje (tombstone „Șters de moderator", distinct de cel own)
--    Compatibil cu CHECK-ul messages_text_or_image: ștergerea admin setează
--    deleted_at => ramura `deleted_at IS NOT NULL` a constrângerii e satisfăcută.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE messages         ADD COLUMN IF NOT EXISTS deleted_by_admin boolean NOT NULL DEFAULT false;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS deleted_by_admin boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Helperi. STABLE + SECURITY DEFINER (citesc profiles indiferent de RLS-ul apelantului).
--    Definiți ÎNAINTE de audit RLS, care îi referă.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_admin(p_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_uid AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION is_banned(p_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_uid
      AND banned_at IS NOT NULL
      AND (banned_until IS NULL OR banned_until > now())
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. admin_audit_log — TOATE acțiunile de admin. Inviolabil din client.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid NOT NULL REFERENCES profiles(id),
  action      text NOT NULL,   -- 'ban_user','unban_user','delete_message','delete_announcement',
                               -- 'delete_review','review_report','dismiss_report','view_report_context'
  target_type text,            -- 'user','message','announcement','review','report'
  target_id   uuid,
  details     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT doar pentru admini. NICIO politică INSERT/UPDATE/DELETE => clientul nu poate
-- scrie/altera/șterge log-ul. Scrierea se face EXCLUSIV din RPC-urile SECURITY DEFINER.
DROP POLICY IF EXISTS "audit_select_admin" ON admin_audit_log;
CREATE POLICY "audit_select_admin" ON admin_audit_log
  FOR SELECT USING (is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. TRIGGER ANTI-ESCALADARE (CRITIC — testul de securitate #1 al fazei)
--
-- `current_user` în interiorul trigger-ului:
--   • cerere client normală (PostgREST) → 'authenticated' (sau 'anon')
--   • RPC SECURITY DEFINER (owner = postgres) → 'postgres'
--   • Studio SQL editor / migrări → 'postgres' / 'supabase_admin'
--   • conexiune service_role → 'service_role'
-- Deci blocăm coloanele privilegiate DOAR când modificarea vine prin rolul client.
-- Astfel: adminul provizionat manual în Studio merge; admin_ban_user (SECURITY DEFINER)
-- setează banned_* fără să fie blocat; dar niciun client autentificat nu poate seta
-- role='admin' sau să-și șteargă banul prin apel direct la API.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION guard_profile_privileged_columns()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'role_change_forbidden';
    END IF;
    IF NEW.banned_at    IS DISTINCT FROM OLD.banned_at
    OR NEW.banned_until IS DISTINCT FROM OLD.banned_until
    OR NEW.ban_reason   IS DISTINCT FROM OLD.ban_reason THEN
      RAISE EXCEPTION 'ban_change_forbidden';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_privileged ON profiles;
CREATE TRIGGER profiles_guard_privileged
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_privileged_columns();

-- ─────────────────────────────────────────────────────────────────────────────
-- Provizionare admin (o fac EU manual — nu există cale din aplicație):
--   UPDATE profiles SET role = 'admin' WHERE id = '<uuid din auth.users>';
--   SELECT id, full_name, role FROM profiles WHERE role = 'admin';
-- (Rulat în Studio ca postgres => trigger-ul permite; din client ar da role_change_forbidden.)
-- ─────────────────────────────────────────────────────────────────────────────

-- Verificare:
--  [Test negativ #1 — CEL MAI IMPORTANT] Cu JWT de cont NORMAL (nu admin), din client:
--     UPDATE profiles SET role='admin' WHERE id = auth.uid();   → EROARE role_change_forbidden
--     UPDATE profiles SET banned_at=NULL WHERE id = auth.uid();  → EROARE ban_change_forbidden
--  [Regresie] Update normal de profil din client (nume/telefon/avatar/push_enabled) → OK.
--  SELECT is_admin('<uuid-admin>');  → true;  SELECT is_admin('<uuid-driver>'); → false.
--  SELECT is_banned('<uuid>');       → false (nimeni banat încă).
--  INSERT în admin_audit_log din client → respins (fără politică INSERT).
