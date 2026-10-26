-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 16 — Etapa 16.4: admin_report_context (fereastră de mesaje în jurul unuia raportat)
-- Rulează în Supabase Studio → SQL Editor. Necesită 16.0.
-- ─────────────────────────────────────────────────────────────────────────────
-- Confidențialitate: singura cale prin care adminul citește mesaje PRIVATE. Cere existența
-- unui raport pe mesaj (utilizatorul a adus el conținutul în atenția moderării) + audit OBLIGATORIU.
-- Fereastră: 3 înainte + mesajul + 3 după (aceeași conversație/canal).

CREATE OR REPLACE FUNCTION admin_report_context(p_table text, p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_created timestamptz;
  v_scope   uuid;         -- conversation_id sau channel_id
  v_before  jsonb;
  v_after   jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM reports WHERE message_id = p_message_id AND message_table = p_table
  ) THEN
    RAISE EXCEPTION 'no_report_for_message';
  END IF;

  IF p_table = 'messages' THEN
    SELECT conversation_id, created_at INTO v_scope, v_created FROM messages WHERE id = p_message_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

    SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at) INTO v_before FROM (
      SELECT id, sender_id, content, image_path, deleted_at, deleted_by_admin, created_at
      FROM messages WHERE conversation_id = v_scope AND created_at <= v_created
      ORDER BY created_at DESC LIMIT 4        -- mesajul + 3 înainte
    ) b;
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at) INTO v_after FROM (
      SELECT id, sender_id, content, image_path, deleted_at, deleted_by_admin, created_at
      FROM messages WHERE conversation_id = v_scope AND created_at > v_created
      ORDER BY created_at ASC LIMIT 3
    ) a;

  ELSIF p_table = 'channel_messages' THEN
    SELECT channel_id, created_at INTO v_scope, v_created FROM channel_messages WHERE id = p_message_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

    SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at) INTO v_before FROM (
      SELECT id, sender_id, content, image_path, deleted_at, deleted_by_admin, created_at
      FROM channel_messages WHERE channel_id = v_scope AND created_at <= v_created
      ORDER BY created_at DESC LIMIT 4
    ) b;
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at) INTO v_after FROM (
      SELECT id, sender_id, content, image_path, deleted_at, deleted_by_admin, created_at
      FROM channel_messages WHERE channel_id = v_scope AND created_at > v_created
      ORDER BY created_at ASC LIMIT 3
    ) a;
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;

  -- Audit OBLIGATORIU: accesul la conținut privat se înregistrează întotdeauna.
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'view_report_context', 'message', p_message_id, jsonb_build_object('table', p_table));

  RETURN coalesce(v_before, '[]'::jsonb) || coalesce(v_after, '[]'::jsonb);
END; $$;

-- Verificare:
--  Cu JWT normal → not_admin.
--  admin_report_context('messages','<id-fără-raport>') → no_report_for_message.
--  admin_report_context pe un mesaj raportat → listă mesaje + O LINIE 'view_report_context' în audit.
