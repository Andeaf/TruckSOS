-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 16 — Etapa 16.3: RPC-uri de moderare a rapoartelor
-- Rulează în Supabase Studio → SQL Editor. Necesită 16.0.
-- ─────────────────────────────────────────────────────────────────────────────
-- Accesul adminului la `reports` e prin RPC (NU politică SELECT largă) => suprafață minimă.

-- ── admin_list_reports ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_list_reports(p_status text DEFAULT 'pending')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT r.id, r.reason, r.details, r.content_snapshot, r.image_path_snapshot,
           r.message_id, r.message_table, r.status, r.created_at,
           r.reporter_id, rep.full_name AS reporter_name,
           r.reported_user_id, tgt.full_name AS reported_name, tgt.banned_at AS reported_banned_at
    FROM reports r
    LEFT JOIN profiles rep ON rep.id = r.reporter_id
    LEFT JOIN profiles tgt ON tgt.id = r.reported_user_id
    WHERE (p_status = 'all' OR r.status = p_status)
    ORDER BY r.created_at DESC
    LIMIT 200
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $$;

-- ── admin_pending_reports_count (badge focus-refresh, fără Realtime) ─────────
CREATE OR REPLACE FUNCTION admin_pending_reports_count()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT count(*) INTO v_count FROM reports WHERE status = 'pending';
  RETURN v_count;
END; $$;

-- ── admin_update_report_status ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_update_report_status(p_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF p_status NOT IN ('pending', 'reviewed', 'dismissed') THEN RAISE EXCEPTION 'bad_status'; END IF;
  UPDATE reports SET status = p_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(),
          CASE WHEN p_status = 'dismissed' THEN 'dismiss_report' ELSE 'review_report' END,
          'report', p_id, jsonb_build_object('status', p_status));
END; $$;

-- ── admin_delete_message ────────────────────────────────────────────────────
-- Variantă admin a lui delete_message: tombstone + deleted_by_admin + șterge obiectul
-- Storage NECONDIȚIONAT (override peste garda „poză pending" din Faza 14) + audit.
CREATE OR REPLACE FUNCTION admin_delete_message(p_table text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old_path text; v_sender uuid;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  IF p_table = 'messages' THEN
    SELECT image_path, sender_id INTO v_old_path, v_sender
      FROM messages WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
    UPDATE messages SET content = '', image_path = NULL, deleted_at = now(), deleted_by_admin = true
      WHERE id = p_id;
  ELSIF p_table = 'channel_messages' THEN
    SELECT image_path, sender_id INTO v_old_path, v_sender
      FROM channel_messages WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
    UPDATE channel_messages SET content = '', image_path = NULL, deleted_at = now(), deleted_by_admin = true
      WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;

  IF v_old_path IS NOT NULL THEN
    DELETE FROM storage.objects WHERE bucket_id = 'photos' AND name = v_old_path;
  END IF;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_message', 'message', p_id,
          jsonb_build_object('table', p_table, 'sender_id', v_sender, 'had_image', v_old_path IS NOT NULL));
END; $$;

-- Verificare:
--  Cu JWT normal: fiecare funcție de mai sus → not_admin.
--  admin_delete_message pe un mesaj cu poză → obiectul din Storage dispare, deleted_by_admin=true.
--  admin_update_report_status(<id>,'reviewed') → status schimbat + linie în admin_audit_log.
