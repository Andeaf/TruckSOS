-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 16 — Căutare anunțuri pentru admin (tab Conținut). Necesită 16.0 (is_admin()).
-- Rulează în Supabase Studio → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────
-- RPC separat (nu modific admin_list_recent_announcements — un overload pe același
-- nume ar deruta PostgREST). Caută în: descriere, locație, număr de înmatriculare
-- și numele șoferului. ILIKE simplu (fără unaccent — unealtă internă de admin).

CREATE OR REPLACE FUNCTION admin_search_announcements(p_query text, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_q text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  v_q := trim(coalesce(p_query, ''));
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT a.id, a.description, a.location, a.status, a.created_at,
           a.driver_id, d.full_name AS driver_name,
           (SELECT count(*) FROM announcement_photos ap WHERE ap.announcement_id = a.id) AS photo_count
    FROM announcements a
    LEFT JOIN profiles d ON d.id = a.driver_id
    WHERE v_q = ''
       OR a.description  ILIKE '%' || v_q || '%'
       OR a.location     ILIKE '%' || v_q || '%'
       OR a.plate_number ILIKE '%' || v_q || '%'
       OR d.full_name    ILIKE '%' || v_q || '%'
    ORDER BY a.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $$;

-- Verificare:
--  Cu JWT normal (simulat) → not_admin.
--  Ca admin: admin_search_announcements('cluj') → doar anunțurile care conțin „cluj"
--    în descriere/locație/număr/nume șofer, desc după dată.
