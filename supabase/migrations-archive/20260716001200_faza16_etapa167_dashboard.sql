-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 16 — Etapa 16.7: admin_dashboard_stats. Necesită 16.0.
-- Rulează în Supabase Studio → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────
-- Count exact (scala actuală de testare). Dacă tabelele cresc mult → estimări pg_class.reltuples.

CREATE OR REPLACE FUNCTION admin_dashboard_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_build_object(
    'users_total',      (SELECT count(*) FROM profiles WHERE deleted_at IS NULL),
    'users_drivers',    (SELECT count(*) FROM profiles WHERE role = 'driver'   AND deleted_at IS NULL),
    'users_mechanics',  (SELECT count(*) FROM profiles WHERE role = 'mechanic' AND deleted_at IS NULL),
    'users_banned',     (SELECT count(*) FROM profiles WHERE banned_at IS NOT NULL),
    'users_new_7d',     (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '7 days'),
    'users_new_30d',    (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '30 days'),
    'ann_open',         (SELECT count(*) FROM announcements WHERE status = 'open'),
    'ann_accepted',     (SELECT count(*) FROM announcements WHERE status = 'accepted'),
    'ann_resolved',     (SELECT count(*) FROM announcements WHERE status = 'resolved'),
    'ann_cancelled',    (SELECT count(*) FROM announcements WHERE status = 'cancelled'),
    'reports_pending',  (SELECT count(*) FROM reports WHERE status = 'pending'),
    'conversations',    (SELECT count(*) FROM conversations),
    'messages',         (SELECT count(*) FROM messages) + (SELECT count(*) FROM channel_messages)
  ) INTO v;
  RETURN v;
END; $$;

-- Verificare:
--  Cu JWT normal → not_admin.  Cu admin → obiect JSON cu toate numerele.
