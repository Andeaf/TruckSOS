-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 16 — Etapa 16.6: Moderare conținut (anunțuri, recenzii, chat global). Necesită 16.0.
-- Rulează în Supabase Studio → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── admin_list_recent_announcements ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_list_recent_announcements(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT a.id, a.description, a.location, a.status, a.created_at,
           a.driver_id, d.full_name AS driver_name,
           (SELECT count(*) FROM announcement_photos ap WHERE ap.announcement_id = a.id) AS photo_count
    FROM announcements a
    LEFT JOIN profiles d ON d.id = a.driver_id
    ORDER BY a.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $$;

-- ── admin_delete_announcement ───────────────────────────────────────────────
-- Respectă lanțul Fazei 15: șterge obiectele Storage ale pozelor, respinge candidaturile
-- pending, apoi șterge anunțul (cascade applications + announcement_photos; conversations
-- SET NULL). + audit.
CREATE OR REPLACE FUNCTION admin_delete_announcement(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_driver uuid; r record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT driver_id INTO v_driver FROM announcements WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  FOR r IN SELECT storage_path FROM announcement_photos WHERE announcement_id = p_id LOOP
    DELETE FROM storage.objects WHERE bucket_id = 'photos' AND name = r.storage_path;
  END LOOP;

  UPDATE applications SET status = 'rejected' WHERE announcement_id = p_id AND status = 'pending';

  DELETE FROM announcements WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_announcement', 'announcement', p_id, jsonb_build_object('driver_id', v_driver));
END; $$;

-- ── admin_list_recent_reviews ───────────────────────────────────────────────
-- Recenziile sunt ANONIME în UI-ul public; adminul vede și cine a lăsat-o (driver_id), pentru moderare.
CREATE OR REPLACE FUNCTION admin_list_recent_reviews(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT r.id, r.stars, r.comment, r.created_at,
           r.mechanic_id, m.full_name AS mechanic_name,
           r.driver_id,   d.full_name AS driver_name
    FROM ratings r
    LEFT JOIN profiles m ON m.id = r.mechanic_id
    LEFT JOIN profiles d ON d.id = r.driver_id
    WHERE r.comment IS NOT NULL AND r.comment <> ''
    ORDER BY r.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $$;

-- ── admin_delete_review ─────────────────────────────────────────────────────
-- DELETE pe ratings => trigger ratings_recompute recalculează media denormalizată.
CREATE OR REPLACE FUNCTION admin_delete_review(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mechanic uuid;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT mechanic_id INTO v_mechanic FROM ratings WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  DELETE FROM ratings WHERE id = p_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_review', 'review', p_id, jsonb_build_object('mechanic_id', v_mechanic));
END; $$;

-- ── admin_list_channel_messages (moderare chat global — public) ──────────────
CREATE OR REPLACE FUNCTION admin_list_channel_messages(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT cm.id, cm.content, cm.image_path, cm.deleted_at, cm.deleted_by_admin, cm.created_at,
           cm.sender_id, s.full_name AS sender_name
    FROM channel_messages cm
    LEFT JOIN profiles s ON s.id = cm.sender_id
    ORDER BY cm.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $$;

-- Ștergerea unui mesaj din chat global refolosește admin_delete_message('channel_messages', id) din 16.3.

-- Verificare:
--  Toate cu JWT normal → not_admin.
--  admin_delete_announcement → pozele din Storage dispar, candidaturile pending devin 'rejected',
--    conversațiile rămân (announcement_id NULL), + audit.
--  admin_delete_review → media mecanicului se recalculează (rating_avg/rating_count).
