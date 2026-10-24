-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK pentru 20261025_grants_baseline.sql — readuce EXACT starea de dinainte
-- (auditul din 24 oct 2026). De rulat în Studio, întreg fișierul, DOAR dacă după
-- COMMIT-ul migrării aplicația 1.0.8 nu mai merge și cauza e confirmată aici.
-- Nu e o migrare: folderul supabase/rollback/ nu se aplică niciodată automat.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0. același lacăt scurt ca la migrare (rulează în BEGIN … COMMIT)
SET LOCAL lock_timeout = '5s';

-- 1. privilegii implicite pe tabele/secvențe noi: înapoi la ALL pentru cele 3 roluri
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- 2–4. grant-uri pe tabele: ALL pentru toate trei, cu singura excepție de dinainte
--      (client_diagnostics fără anon, migrarea 20261013)
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
REVOKE ALL ON public.client_diagnostics FROM anon;

-- 5. cele 8 politici înapoi la `TO public`
ALTER POLICY audit_select_admin                  ON public.admin_audit_log     TO public;
ALTER POLICY announcement_photos_select_admin    ON public.announcement_photos TO public;
ALTER POLICY announcement_views_select_admin     ON public.announcement_views  TO public;
ALTER POLICY announcements_insert_admin          ON public.announcements       TO public;
ALTER POLICY announcements_select_admin          ON public.announcements       TO public;
ALTER POLICY app_versions_update_admin           ON public.app_versions        TO public;
ALTER POLICY channel_messages_select_since_join  ON public.channel_messages    TO public;
ALTER POLICY market_select_not_blocked           ON public.market_listings     TO public;

-- 6. helperii: EXECUTE înapoi pentru PUBLIC și anon
GRANT EXECUTE ON FUNCTION public.is_admin(uuid)                TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_banned(uuid)               TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_block_between(uuid, uuid)  TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_conversation_blocked(uuid) TO PUBLIC, anon;

-- 7. politica de INSERT direct (textul original din 20260623_faza3_etapa31_applications.sql)
DROP POLICY IF EXISTS "mechanic can apply" ON public.applications;
CREATE POLICY "mechanic can apply"
  ON public.applications FOR INSERT
  WITH CHECK (mechanic_id = auth.uid());

-- 8. _purge_user_data: definiția de dinainte (pg_get_functiondef, 24 oct 2026) —
--    fără scrub-ul pe address / vat_number / company_name / contact_email
CREATE OR REPLACE FUNCTION public._purge_user_data(p_uid uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted timestamptz;
  v_paths   text[] := '{}';
  v_avatar  text;
  v_ann     text[];
  v_chat    text[];
  v_chan    text[];
  v_market  text[];
  v_files   text[];
BEGIN
  SELECT deleted_at INTO v_deleted FROM profiles WHERE id = p_uid;
  IF NOT FOUND OR v_deleted IS NOT NULL THEN
    RETURN '{}';
  END IF;

  SELECT avatar_path INTO v_avatar FROM profiles WHERE id = p_uid;
  IF v_avatar IS NOT NULL THEN
    v_paths := v_paths || v_avatar;
  END IF;

  SELECT COALESCE(array_agg(ap.storage_path), '{}')
  INTO v_ann
  FROM announcement_photos ap
  JOIN announcements a ON a.id = ap.announcement_id
  WHERE a.driver_id = p_uid;
  v_paths := v_paths || v_ann;

  SELECT COALESCE(array_agg(m.image_path), '{}')
  INTO v_chat
  FROM messages m
  WHERE m.sender_id = p_uid
    AND m.image_path IS NOT NULL
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_chat;

  SELECT COALESCE(array_agg(cm.image_path), '{}')
  INTO v_chan
  FROM channel_messages cm
  WHERE cm.sender_id = p_uid
    AND cm.image_path IS NOT NULL
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_chan;

  SELECT COALESCE(array_agg(mp.storage_path), '{}')
  INTO v_market
  FROM market_listing_photos mp
  JOIN market_listings l ON l.id = mp.listing_id
  WHERE l.seller_id = p_uid;
  v_paths := v_paths || v_market;

  SELECT COALESCE(array_agg(m.file_path), '{}')
  INTO v_files
  FROM messages m
  WHERE m.sender_id = p_uid
    AND m.file_path IS NOT NULL
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_files;

  SELECT COALESCE(array_agg(cm.file_path), '{}')
  INTO v_files
  FROM channel_messages cm
  WHERE cm.sender_id = p_uid
    AND cm.file_path IS NOT NULL
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_files;

  UPDATE messages m
  SET content = '', image_path = NULL,
      file_path = NULL, file_name = NULL, file_size = NULL,
      deleted_at = now()
  WHERE m.sender_id = p_uid
    AND (m.image_path IS NOT NULL OR m.file_path IS NOT NULL)
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );

  UPDATE channel_messages cm
  SET content = '', image_path = NULL,
      file_path = NULL, file_name = NULL, file_size = NULL,
      deleted_at = now()
  WHERE cm.sender_id = p_uid
    AND (cm.image_path IS NOT NULL OR cm.file_path IS NOT NULL)
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );

  DELETE FROM announcements       WHERE driver_id   = p_uid;
  DELETE FROM market_listings     WHERE seller_id   = p_uid;
  DELETE FROM trucks              WHERE driver_id   = p_uid;
  DELETE FROM applications        WHERE mechanic_id = p_uid;
  DELETE FROM ratings             WHERE driver_id   = p_uid;
  DELETE FROM ratings             WHERE mechanic_id = p_uid;
  DELETE FROM favorite_mechanics  WHERE driver_id   = p_uid OR mechanic_id = p_uid;
  DELETE FROM search_history      WHERE driver_id   = p_uid OR mechanic_id = p_uid;
  DELETE FROM message_reads       WHERE user_id     = p_uid;
  DELETE FROM conversation_deletions WHERE user_id  = p_uid;
  DELETE FROM channel_reads       WHERE user_id     = p_uid;
  DELETE FROM push_tokens         WHERE user_id     = p_uid;

  UPDATE profiles SET
    full_name      = '',
    avatar_path    = NULL,
    phone          = NULL,
    specialization = NULL,
    activity_zone  = NULL,
    latitude       = NULL,
    longitude      = NULL,
    push_enabled   = false,
    deleted_at     = now()
  WHERE id = p_uid;

  RETURN v_paths;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._purge_user_data(uuid) FROM PUBLIC, anon, authenticated;

-- Verificare rapidă: anon are din nou SELECT pe profiles, politica există, helperii merg
SELECT has_table_privilege('anon', 'public.profiles', 'SELECT')                       AS anon_profiles_select,
       has_function_privilege('anon', 'public.is_admin(uuid)', 'EXECUTE')              AS anon_is_admin,
       EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'applications'
                  AND policyname = 'mechanic can apply')                                AS insert_policy_back;
