-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 16 — Etapa 16.5: RPC-uri utilizatori (căutare + detaliu). Necesită 16.0.
-- Rulează în Supabase Studio → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────
-- Email-ul e în auth.users (nu în profiles) => expus DOAR prin aceste RPC-uri gated.
-- NU expunem telefonul (minimul necesar pentru moderare). Adminii sunt excluși din rezultate.

-- ── admin_search_users ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_search_users(p_query text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_q text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  v_q := coalesce(trim(p_query), '');
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.full_name) INTO v FROM (
    SELECT p.id, p.full_name, p.role, p.avatar_path, p.deleted_at,
           p.banned_at, p.banned_until, u.email
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.role <> 'admin'
      AND (v_q = ''
           OR p.full_name ILIKE '%' || v_q || '%'
           OR u.email    ILIKE '%' || v_q || '%')
    LIMIT 50
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $$;

-- ── admin_user_detail ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_user_detail(p_uid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT to_jsonb(d) INTO v FROM (
    SELECT
      p.id, p.full_name, p.role, p.avatar_path, p.specialization, p.activity_zone,
      p.company_name, p.contact_email, p.rating_avg, p.rating_count,
      p.deleted_at, p.banned_at, p.banned_until, p.ban_reason,
      u.email, u.created_at AS registered_at,
      (SELECT count(*) FROM announcements a WHERE a.driver_id = p.id)              AS announcements_count,
      (SELECT count(*) FROM applications ap WHERE ap.mechanic_id = p.id)           AS applications_count,
      (SELECT count(*) FROM reports r WHERE r.reported_user_id = p.id)             AS reports_received,
      (SELECT count(*) FROM reports r WHERE r.reporter_id = p.id)                  AS reports_made
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_uid
  ) d;
  IF v IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  RETURN v;
END; $$;

-- Verificare:
--  Cu JWT normal → not_admin (ambele).
--  admin_search_users('') → listă (max 50), fără admini, cu email, fără phone.
--  admin_user_detail('<uuid-admin>') → merge (adminul poate vedea detaliul oricui), dar
--    adminul nu apare în admin_search_users.
