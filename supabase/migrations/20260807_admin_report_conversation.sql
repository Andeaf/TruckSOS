-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 7 aug 2026 (2) — „Vezi conversația" la rapoartele pe UTILIZATOR
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (CREATE OR REPLACE).
--
-- Context: la rapoartele pe MESAJ adminul are deja admin_report_context (fereastră
-- 25+25 în jurul mesajului raportat). La rapoartele pe UTILIZATOR (message_id NULL)
-- nu vedea nimic. RPC-ul de față îi dă acces MĂRGINIT: doar conversațiile dintre
-- RAPORTOR și RAPORTAT (nu toate conversațiile raportatului!), ultimele 50 de
-- mesaje per conversație, condiționat de existența raportului, cu audit per acces —
-- același principiu de confidențialitate din Faza 16/18 (privacy policy §5,
-- actualizată în același lot).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_report_conversation(p_report_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_reporter uuid;
  v_reported uuid;
  v_result   jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  -- Accesul există DOAR pe baza unui raport concret (orice status — adminul
  -- poate re-verifica și rapoartele deja tratate).
  SELECT reporter_id, reported_user_id INTO v_reporter, v_reported
  FROM reports WHERE id = p_report_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_report'; END IF;

  -- Toate conversațiile DINTRE cei doi (depanare / directe / market), cele mai
  -- recente prima; fiecare cu ULTIMELE 50 de mesaje, ordonate cronologic.
  -- Mesajele șterse rămân vizibile ca tombstone (deleted_at) — pot fi exact dovada.
  SELECT jsonb_agg(sub.conv ORDER BY sub.last_at DESC NULLS LAST) INTO v_result
  FROM (
    SELECT
      (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_at,
      jsonb_build_object(
        'conversation_id', c.id,
        'kind', CASE
          WHEN c.listing_id IS NOT NULL THEN 'market'
          WHEN c.announcement_id IS NOT NULL THEN 'announcement'
          ELSE 'direct'
        END,
        'created_at', c.created_at,
        'messages', COALESCE((
          SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at)
          FROM (
            SELECT id, sender_id, content, image_path, file_name,
                   deleted_at, deleted_by_admin, created_at
            FROM messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 50
          ) x
        ), '[]'::jsonb)
      ) AS conv
    FROM conversations c
    WHERE (c.driver_id = v_reporter AND c.mechanic_id = v_reported)
       OR (c.driver_id = v_reported AND c.mechanic_id = v_reporter)
  ) sub;

  -- Audit OBLIGATORIU per acces — trasabilitate completă (ca la view_report_context).
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'view_report_conversation', 'report', p_report_id,
          jsonb_build_object(
            'reporter', v_reporter,
            'reported', v_reported,
            'conversations', COALESCE(jsonb_array_length(v_result), 0)));

  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;

REVOKE ALL ON FUNCTION admin_report_conversation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION admin_report_conversation(uuid) TO authenticated;

-- ─── Verificări (manual, în Studio) ─────────────────────────────────────────
-- a) Cont normal (SET LOCAL role + request.jwt.claims — vezi tehnica din memoria
--    „Test RLS/triggere în Studio"): admin_report_conversation('<report-id>') → 'not_admin'.
-- b) Admin + id inexistent → 'no_report'.
-- c) Admin + raport valid → jsonb cu conversațiile perechii (≤50 mesaje fiecare)
--    și un rând nou 'view_report_conversation' în admin_audit_log.
SELECT count(*) AS functie_creata FROM pg_proc WHERE proname = 'admin_report_conversation';
-- Așteptat: 1.
