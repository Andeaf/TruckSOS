-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 16 — Etapa 16.2: Enforcement ban APLICATIV + RPC-uri ban/unban
-- Rulează în Supabase Studio → SQL Editor. Necesită etapa 16.0 rulată deja.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- DECIZIE DE IMPLEMENTARE (deviere conștientă de la „politici RESTRICTIVE" din plan):
--   Politicile RESTRICTIVE sunt OCOLITE de RPC-urile SECURITY DEFINER (rulează ca owner
--   = postgres, care sare peste RLS). Multe scrieri trec prin astfel de RPC-uri
--   (apply_to_announcement, accept_application, start_direct_conversation). Un TRIGGER
--   BEFORE INSERT se declanșează ȘI pentru scrierile mediate de RPC, iar auth.uid() în
--   interiorul lui rămâne apelantul real. Deci enforcement-ul de ban = trigger, nu RLS.
--   La fel de aditiv (triggere noi, obiectele existente neatinse), dar fără breșă.

-- ── Gardă: blochează scrierile actorului banat ──────────────────────────────
CREATE OR REPLACE FUNCTION guard_not_banned()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- auth.uid() = apelantul real, chiar și în interiorul unui RPC SECURITY DEFINER.
  -- is_banned(NULL) => false (scrierile de sistem/migrări nu sunt afectate).
  IF is_banned(auth.uid()) THEN
    RAISE EXCEPTION 'account_banned';
  END IF;
  RETURN NEW;
END;
$$;

-- Tabelele care produc conținut / interacțiuni vizibile altora.
DROP TRIGGER IF EXISTS ban_guard_ins ON announcements;
CREATE TRIGGER ban_guard_ins BEFORE INSERT OR UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION guard_not_banned();

DROP TRIGGER IF EXISTS ban_guard_ins ON applications;
CREATE TRIGGER ban_guard_ins BEFORE INSERT ON applications
  FOR EACH ROW EXECUTE FUNCTION guard_not_banned();

DROP TRIGGER IF EXISTS ban_guard_ins ON messages;
CREATE TRIGGER ban_guard_ins BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION guard_not_banned();

DROP TRIGGER IF EXISTS ban_guard_ins ON channel_messages;
CREATE TRIGGER ban_guard_ins BEFORE INSERT ON channel_messages
  FOR EACH ROW EXECUTE FUNCTION guard_not_banned();

DROP TRIGGER IF EXISTS ban_guard_ins ON ratings;
CREATE TRIGGER ban_guard_ins BEFORE INSERT OR UPDATE ON ratings
  FOR EACH ROW EXECUTE FUNCTION guard_not_banned();

DROP TRIGGER IF EXISTS ban_guard_ins ON reports;
CREATE TRIGGER ban_guard_ins BEFORE INSERT ON reports
  FOR EACH ROW EXECUTE FUNCTION guard_not_banned();

DROP TRIGGER IF EXISTS ban_guard_ins ON conversations;
CREATE TRIGGER ban_guard_ins BEFORE INSERT ON conversations
  FOR EACH ROW EXECUTE FUNCTION guard_not_banned();

-- ── admin_ban_user ──────────────────────────────────────────────────────────
-- Ban aplicativ + oprire push. Gardă is_admin + refuz de a bana un admin.
CREATE OR REPLACE FUNCTION admin_ban_user(p_uid uuid, p_reason text, p_until timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_target_role text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT role INTO v_target_role FROM profiles WHERE id = p_uid;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF v_target_role = 'admin' THEN RAISE EXCEPTION 'cannot_ban_admin'; END IF;

  -- Rulează ca postgres (definer) => trigger-ul profiles_guard_privileged (16.0) permite
  -- schimbarea coloanelor de ban.
  UPDATE profiles
     SET banned_at    = now(),
         banned_until = p_until,
         ban_reason   = p_reason,
         push_enabled = false           -- Faza 12: notify_push verifică push_enabled
   WHERE id = p_uid;

  DELETE FROM push_tokens WHERE user_id = p_uid;   -- niciun dispozitiv nu mai primește push

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ban_user', 'user', p_uid,
          jsonb_build_object('reason', p_reason, 'until', p_until));
END; $$;

-- ── admin_unban_user ────────────────────────────────────────────────────────
-- Simetric. NU re-activează push_enabled (era preferință de user; și-o repune singur din Setări).
CREATE OR REPLACE FUNCTION admin_unban_user(p_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE profiles SET banned_at = NULL, banned_until = NULL, ban_reason = NULL WHERE id = p_uid;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'unban_user', 'user', p_uid, '{}'::jsonb);
END; $$;

-- Verificare:
--  [Test negativ b] Cu JWT normal (simulat, vezi 16.0): SELECT admin_ban_user('<uuid>','x'); → not_admin.
--  [Test negativ c] Banează un cont normal din admin, apoi cu JWT-ul lui (simulat authenticated):
--     INSERT INTO messages(...) / INSERT INTO announcements(...) → EROARE account_banned.
--  admin_ban_user pe un cont admin → cannot_ban_admin.
--  După ban: SELECT push_enabled FROM profiles WHERE id='<uuid>'; → false; push_tokens golit.
