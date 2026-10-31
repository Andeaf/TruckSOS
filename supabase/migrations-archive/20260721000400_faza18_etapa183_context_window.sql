-- Faza 18 — Etapa 18.3: lărgirea ferestrei admin_report_context — 3+3 → 25+25,
-- parametrizată cu hard-cap 50 server-side. Rulează în Supabase Studio → SQL Editor.
--
-- Contract NESCHIMBAT altfel: is_admin, condiționat de existența raportului,
-- aceeași conversație/canal, audit per acces (acum cu fereastra efectivă în detalii).
--
-- DROP + CREATE (nu OR REPLACE): parametrii noi ar crea un OVERLOAD ambiguu
-- (două funcții cu același nume), nu o înlocuire — modelul DROP/CREATE din fazele
-- anterioare. Clientul existent apelează fără parametrii noi → merge pe DEFAULT-uri.
DROP FUNCTION IF EXISTS admin_report_context(text, uuid);

CREATE FUNCTION admin_report_context(
  p_table      text,
  p_message_id uuid,
  p_before     integer DEFAULT 25,
  p_after      integer DEFAULT 25
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- Cap 50: limita reală de confidențialitate rămâne principiul „doar conversația
  -- raportată + audit"; capul previne doar transformarea RPC-ului într-un
  -- exfiltrator de conversații întregi dintr-un singur apel.
  v_before_n integer := LEAST(GREATEST(coalesce(p_before, 25), 0), 50);
  v_after_n  integer := LEAST(GREATEST(coalesce(p_after, 25), 0), 50);
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
      ORDER BY created_at DESC LIMIT v_before_n + 1     -- mesajul + N înainte
    ) b;
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at) INTO v_after FROM (
      SELECT id, sender_id, content, image_path, deleted_at, deleted_by_admin, created_at
      FROM messages WHERE conversation_id = v_scope AND created_at > v_created
      ORDER BY created_at ASC LIMIT v_after_n
    ) a;

  ELSIF p_table = 'channel_messages' THEN
    SELECT channel_id, created_at INTO v_scope, v_created FROM channel_messages WHERE id = p_message_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

    SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at) INTO v_before FROM (
      SELECT id, sender_id, content, image_path, deleted_at, deleted_by_admin, created_at
      FROM channel_messages WHERE channel_id = v_scope AND created_at <= v_created
      ORDER BY created_at DESC LIMIT v_before_n + 1
    ) b;
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at) INTO v_after FROM (
      SELECT id, sender_id, content, image_path, deleted_at, deleted_by_admin, created_at
      FROM channel_messages WHERE channel_id = v_scope AND created_at > v_created
      ORDER BY created_at ASC LIMIT v_after_n
    ) a;
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;

  -- Audit OBLIGATORIU, acum cu fereastra EFECTIVĂ (post-cap) — trasabilitate
  -- completă a cât conținut a văzut adminul la acest acces.
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'view_report_context', 'message', p_message_id,
          jsonb_build_object('table', p_table, 'before', v_before_n, 'after', v_after_n));

  RETURN coalesce(v_before, '[]'::jsonb) || coalesce(v_after, '[]'::jsonb);
END; $$;

-- ─── Verificări (manual) ────────────────────────────────────────────────────
-- a) Cont normal → 'not_admin' (neschimbat).
-- b) Mesaj fără raport → 'no_report_for_message' (neschimbat).
-- c) Apel fără parametri noi → fereastră 25+25 (defaults).
-- d) admin_report_context('messages','<id>', 500, 500) → maximum 50+50 (cap).
-- e) Auditul conține 'before'/'after' în details.
