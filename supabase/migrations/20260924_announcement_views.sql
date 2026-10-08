-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 24 sept 2026 — Vizualizări pe anunțuri, vizibile DOAR adminilor
-- Rulează în Supabase Studio → SQL Editor (sau `npx supabase db query --linked -f`).
-- Idempotentă (IF NOT EXISTS / DROP+CREATE policy / CREATE OR REPLACE). Fără efect
-- asupra clienților vechi: tabela e nouă, iar cele două RPC-uri de admin doar mai
-- pun un câmp (view_count) în JSON-ul întors.
--
-- CE NUMĂRĂ: câți utilizatori DIFERIȚI au deschis detaliul anunțului — un rând per
-- (anunț, utilizator), redeschiderile nu mai adaugă nimic. NU se numără autorul
-- anunțului și nici adminii (moderarea ar umfla cifrele).
-- Înregistrarea o face aplicația (din 1.0.7; pe web după redeploy) la deschiderea
-- detaliului, prin record_announcement_view(). Numărătoarea pornește de la zero:
-- pentru deschiderile de dinainte nu există date.
--
-- CINE VEDE: doar adminii — pentru restul tabela n-are nicio politică (nici citire,
-- nici scriere directă). Cifra ajunge în Admin → Conținut → Anunțuri prin
-- admin_list_recent_announcements / admin_search_announcements.
--
-- ORDINEA LA RELEASE: migrarea ÎNAINTE de redeploy-ul web / build-urile 1.0.7.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tabela ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcement_views (
  announcement_id uuid        NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  viewer_id       uuid        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  viewed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, viewer_id)
);

-- PK-ul acoperă numărătoarea per anunț; indexul pe viewer_id ține rapidă cascada
-- de la ștergerea contului.
CREATE INDEX IF NOT EXISTS announcement_views_viewer_idx ON announcement_views (viewer_id);

COMMENT ON TABLE announcement_views IS
  'Cine a deschis detaliul unui anunț (unic per utilizator; fără autor și admini). Citire doar admin (24 sept 2026).';

-- ── 2. RLS: citire doar admin; scriere doar prin RPC-ul de mai jos ──────────
ALTER TABLE announcement_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcement_views_select_admin" ON announcement_views;
CREATE POLICY "announcement_views_select_admin" ON announcement_views
  FOR SELECT USING (is_admin());

-- ── 3. Înregistrarea unei vizualizări (apelată din app la deschiderea detaliului)
-- Tăcută în toate cazurile „nu se numără" (autor, admin, anunț inexistent, deja
-- numărat) — clientul o apelează fire-and-forget.
CREATE OR REPLACE FUNCTION record_announcement_view(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR is_admin() THEN RETURN; END IF;
  INSERT INTO announcement_views (announcement_id, viewer_id)
  SELECT a.id, auth.uid()
    FROM announcements a
   WHERE a.id = p_announcement_id
     AND a.driver_id IS DISTINCT FROM auth.uid()
  ON CONFLICT DO NOTHING;
END; $$;

REVOKE ALL ON FUNCTION record_announcement_view(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION record_announcement_view(uuid) TO authenticated;

-- ── 4. RPC-urile de admin: + view_count (restul identic cu definiția live) ──
CREATE OR REPLACE FUNCTION admin_list_recent_announcements(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT a.id, a.description, a.location, a.status, a.created_at,
           a.driver_id, d.full_name AS driver_name,
           (SELECT count(*) FROM announcement_photos ap WHERE ap.announcement_id = a.id) AS photo_count,
           (SELECT count(*) FROM announcement_views av WHERE av.announcement_id = a.id) AS view_count
    FROM announcements a
    LEFT JOIN profiles d ON d.id = a.driver_id
    ORDER BY a.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION admin_search_announcements(p_query text, p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v jsonb; v_q text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  v_q := trim(coalesce(p_query, ''));
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT a.id, a.description, a.location, a.status, a.created_at,
           a.driver_id, d.full_name AS driver_name,
           (SELECT count(*) FROM announcement_photos ap WHERE ap.announcement_id = a.id) AS photo_count,
           (SELECT count(*) FROM announcement_views av WHERE av.announcement_id = a.id) AS view_count
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

-- ── 5. Verificare ────────────────────────────────────────────────────────────
-- anon_exec = false; policies = 1 (doar SELECT admin).
SELECT
  (SELECT count(*) FROM announcement_views)                                        AS view_rows,
  has_function_privilege('anon', 'record_announcement_view(uuid)', 'execute')      AS anon_exec,
  has_function_privilege('authenticated', 'record_announcement_view(uuid)', 'execute') AS auth_exec,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'announcement_views')        AS policies;
