-- ROLLBACK pentru 20261031000100_hygiene_limits.sql — `BEGIN;` + fișier + `COMMIT;`.
-- Readuce exact starea de dinainte (definițiile vechi sunt cele din producție, 26 oct 2026).
SET LOCAL lock_timeout = '5s';

-- 9. Indexuri
DROP INDEX IF EXISTS public.idx_messages_conversation_created;
DROP INDEX IF EXISTS public.idx_announcements_status_created;
DROP INDEX IF EXISTS public.idx_announcements_driver;
DROP INDEX IF EXISTS public.idx_announcements_mechanic;
DROP INDEX IF EXISTS public.idx_announcements_open_geo;
DROP INDEX IF EXISTS public.idx_conversations_driver;
DROP INDEX IF EXISTS public.idx_conversations_mechanic;
DROP INDEX IF EXISTS public.idx_blocked_users_blocked_blocker;
DROP INDEX IF EXISTS public.idx_profiles_mechanic_push;
DROP INDEX IF EXISTS public.idx_profiles_mechanic_geo;
DROP INDEX IF EXISTS public.idx_channel_push_prefs_channel_enabled;
DROP INDEX IF EXISTS public.idx_ratings_driver;
DROP INDEX IF EXISTS public.idx_reports_reporter;

-- 7/8. limite de ritm, cron, admin_purge_accounts
SELECT cron.unschedule('cleanup-rate-events-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-rate-events-daily');
DROP TRIGGER IF EXISTS aaa_rate_limit ON public.announcements;
DROP TRIGGER IF EXISTS aaa_rate_limit ON public.channel_messages;
DROP TRIGGER IF EXISTS aaa_rate_limit ON public.messages;
DROP TRIGGER IF EXISTS aaa_rate_limit ON public.market_listings;
DROP TRIGGER IF EXISTS aaa_rate_limit ON public.reports;
DROP FUNCTION IF EXISTS public.admin_purge_accounts(timestamptz, timestamptz, boolean);

-- 6. Storage: politicile originale (cu cast pe id) și bucket fără allowlist MIME
UPDATE storage.buckets SET allowed_mime_types = NULL WHERE id = 'photos';

DROP POLICY IF EXISTS photos_insert_announcement ON storage.objects;
CREATE POLICY photos_insert_announcement ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'announcements'::text) AND (EXISTS ( SELECT 1 FROM announcements a WHERE (((a.id)::text = (storage.foldername(objects.name))[2]) AND (a.driver_id = auth.uid())))));
DROP POLICY IF EXISTS photos_insert_avatar ON storage.objects;
CREATE POLICY photos_insert_avatar ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'avatars'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text));
DROP POLICY IF EXISTS photos_insert_channel ON storage.objects;
CREATE POLICY photos_insert_channel ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'channel'::text) AND (EXISTS ( SELECT 1 FROM channels c WHERE ((c.id)::text = (storage.foldername(objects.name))[2]))));
DROP POLICY IF EXISTS photos_insert_chat ON storage.objects;
CREATE POLICY photos_insert_chat ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'chat'::text) AND (EXISTS ( SELECT 1 FROM conversations c WHERE (((c.id)::text = (storage.foldername(objects.name))[2]) AND ((c.driver_id = auth.uid()) OR (c.mechanic_id = auth.uid()))))));
DROP POLICY IF EXISTS photos_insert_market ON storage.objects;
CREATE POLICY photos_insert_market ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'market'::text) AND (EXISTS ( SELECT 1 FROM market_listings l WHERE (((l.id)::text = (storage.foldername(objects.name))[2]) AND (l.seller_id = auth.uid())))));
DROP POLICY IF EXISTS photos_delete_announcement ON storage.objects;
CREATE POLICY photos_delete_announcement ON storage.objects FOR DELETE TO authenticated
  USING ((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'announcements'::text) AND (EXISTS ( SELECT 1 FROM announcements a WHERE (((a.id)::text = (storage.foldername(objects.name))[2]) AND (a.driver_id = auth.uid())))));
DROP POLICY IF EXISTS photos_delete_market ON storage.objects;
CREATE POLICY photos_delete_market ON storage.objects FOR DELETE TO authenticated
  USING ((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'market'::text) AND (EXISTS ( SELECT 1 FROM market_listings l WHERE (((l.id)::text = (storage.foldername(objects.name))[2]) AND (l.seller_id = auth.uid())))));
DROP POLICY IF EXISTS photos_select_announcement ON storage.objects;
CREATE POLICY photos_select_announcement ON storage.objects FOR SELECT TO authenticated
  USING ((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'announcements'::text) AND (EXISTS ( SELECT 1 FROM announcements a WHERE (((a.id)::text = (storage.foldername(objects.name))[2]) AND ((a.driver_id = auth.uid()) OR (a.mechanic_id = auth.uid()) OR ((a.status = 'open'::text) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = 'mechanic'::text))))))))));
DROP POLICY IF EXISTS photos_select_channel ON storage.objects;
CREATE POLICY photos_select_channel ON storage.objects FOR SELECT TO authenticated
  USING ((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'channel'::text) AND (EXISTS ( SELECT 1 FROM channels c WHERE ((c.id)::text = (storage.foldername(objects.name))[2]))));
DROP POLICY IF EXISTS photos_select_chat ON storage.objects;
CREATE POLICY photos_select_chat ON storage.objects FOR SELECT TO authenticated
  USING ((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'chat'::text) AND (EXISTS ( SELECT 1 FROM conversations c WHERE (((c.id)::text = (storage.foldername(objects.name))[2]) AND ((c.driver_id = auth.uid()) OR (c.mechanic_id = auth.uid()))))));
DROP POLICY IF EXISTS photos_select_market ON storage.objects;
CREATE POLICY photos_select_market ON storage.objects FOR SELECT TO authenticated
  USING ((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'market'::text) AND (EXISTS ( SELECT 1 FROM market_listings l WHERE ((l.id)::text = (storage.foldername(objects.name))[2]))));
DROP POLICY IF EXISTS photos_select_market_anon ON storage.objects;
CREATE POLICY photos_select_market_anon ON storage.objects FOR SELECT TO anon
  USING ((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'market'::text) AND (EXISTS ( SELECT 1 FROM market_listings l WHERE (((l.id)::text = (storage.foldername(objects.name))[2]) AND (l.status = 'active'::text)))));

-- 5. Cele 38 de politici înapoi la TO public (aceleași expresii)
DO $$
DECLARE r record; sql text;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname, permissive, cmd, qual, with_check
             FROM pg_policies
            WHERE schemaname = 'public' AND roles = ARRAY['authenticated']::name[]
              AND policyname = ANY (ARRAY[
                'announcements_insert_driver','announcements_insert_mechanic','announcements_select_driver',
                'announcements_select_mechanic_accepted','announcements_select_mechanic_open','announcements_update_cancel',
                'announcements_update_resolve','driver can delete own non-accepted announcements','app_versions_select_authenticated',
                'driver sees applications to own announcements','mechanic sees own applications','blocked_delete_own',
                'blocked_insert_own','blocked_select_own','channel_messages_insert_own','channel_push_prefs_own',
                'channel_reads_own','channels_select_all','user manages own deletions','conversations_select_participant',
                'market_photos_delete_seller','market_photos_insert_seller','market_photos_select','market_photos_update_seller',
                'market_delete_own','market_insert_own','market_select_authenticated','market_update_own',
                'message_reads_select_participants','user manages own reads','messages_insert_participant',
                'messages_select_participant','profiles_insert_own','profiles_select_all','profiles_update_own',
                'reports_insert_own','reports_select_own','driver owns trucks'])
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    sql := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO public', r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd);
    IF r.qual IS NOT NULL THEN sql := sql || ' USING (' || r.qual || ')'; END IF;
    IF r.with_check IS NOT NULL THEN sql := sql || ' WITH CHECK (' || r.with_check || ')'; END IF;
    EXECUTE sql;
  END LOOP;
END $$;

-- 4. EXECUTE implicit (PUBLIC) înapoi pe funcțiile-trigger din public (starea de dinainte)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', r.sig);
  END LOOP;
END $$;

-- 3. Cele 9 funcții: definițiile originale (fără search_path)
ALTER FUNCTION public.distance_km(double precision, double precision, double precision, double precision) RESET search_path;
ALTER FUNCTION public.push_text(text, text) RESET search_path;
ALTER FUNCTION public.set_updated_at() RESET search_path;
ALTER FUNCTION public.ratings_touch_updated_at() RESET search_path;
CREATE OR REPLACE FUNCTION public.user_lang(p_user_id uuid) RETURNS text LANGUAGE sql STABLE
AS $function$ SELECT COALESCE(lang, 'ro') FROM profiles WHERE id = p_user_id; $function$;
ALTER FUNCTION public.user_lang(uuid) RESET search_path;
CREATE OR REPLACE FUNCTION public.guard_not_banned() RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  IF is_banned(auth.uid()) THEN
    RAISE EXCEPTION 'account_banned';
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.guard_not_banned() RESET search_path;
CREATE OR REPLACE FUNCTION public.enforce_announcement_photo_limit() RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  IF (SELECT count(*) FROM announcement_photos WHERE announcement_id = NEW.announcement_id) >= 10 THEN
    RAISE EXCEPTION 'photo_limit_reached';
  END IF;
  RETURN NEW;
END; $function$;
ALTER FUNCTION public.enforce_announcement_photo_limit() RESET search_path;
CREATE OR REPLACE FUNCTION public.enforce_market_listing_limit() RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.status <> 'active')
     AND (SELECT count(*) FROM market_listings
          WHERE seller_id = NEW.seller_id AND status = 'active') >= 20 THEN
    RAISE EXCEPTION 'listing_limit_reached';
  END IF;
  RETURN NEW;
END; $function$;
ALTER FUNCTION public.enforce_market_listing_limit() RESET search_path;
CREATE OR REPLACE FUNCTION public.enforce_market_photo_limit() RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  IF (SELECT count(*) FROM market_listing_photos WHERE listing_id = NEW.listing_id) >= 10 THEN
    RAISE EXCEPTION 'photo_limit_reached';
  END IF;
  RETURN NEW;
END; $function$;
ALTER FUNCTION public.enforce_market_photo_limit() RESET search_path;

-- 2. Căutările: definițiile de dinainte (cu 'ß' corect; producția avea mojibake în
--    search_market_listings — nu merită reprodus). Drepturile nu s-au schimbat.
CREATE OR REPLACE FUNCTION public.search_mechanics(p_query text)
 RETURNS TABLE(id uuid, full_name text, specialization text, activity_zone text, rating_avg numeric, rating_count integer, avatar_path text)
 LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p.id, p.full_name, p.specialization, p.activity_zone,
         p.rating_avg, p.rating_count, p.avatar_path
  FROM profiles p
  WHERE p.role = 'mechanic'
    AND p.deleted_at IS NULL
    AND NOT is_block_between(p.id, auth.uid())
    AND extensions.unaccent(replace(lower(p.full_name), 'ß', 'ss'))
        LIKE '%' || extensions.unaccent(replace(lower(p_query), 'ß', 'ss')) || '%'
  ORDER BY p.full_name
  LIMIT 30;
$function$;
CREATE OR REPLACE FUNCTION public.search_users(p_query text)
 RETURNS TABLE(id uuid, full_name text, role text, specialization text, activity_zone text, rating_avg numeric, rating_count integer, avatar_path text)
 LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p.id, p.full_name, p.role::text, p.specialization, p.activity_zone,
         p.rating_avg, p.rating_count, p.avatar_path
  FROM profiles p
  WHERE p.role IN ('driver', 'mechanic')
    AND p.deleted_at IS NULL
    AND p.id <> auth.uid()
    AND NOT is_block_between(p.id, auth.uid())
    AND extensions.unaccent(replace(lower(p.full_name), 'ß', 'ss'))
        LIKE '%' || extensions.unaccent(replace(lower(p_query), 'ß', 'ss')) || '%'
  ORDER BY p.full_name
  LIMIT 30;
$function$;
CREATE OR REPLACE FUNCTION public.search_market_listings(p_query text, p_category text DEFAULT NULL::text, p_sort text DEFAULT 'recent'::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS SETOF public.market_listings
 LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT l.*
  FROM market_listings l
  WHERE l.status = 'active'
    AND NOT is_block_between(l.seller_id, auth.uid())
    AND (p_category IS NULL OR l.category = p_category)
    AND extensions.unaccent(replace(lower(l.title || ' ' || l.description), 'ß', 'ss'))
        LIKE '%' || extensions.unaccent(replace(lower(p_query), 'ß', 'ss')) || '%'
  ORDER BY
    CASE WHEN p_sort = 'price_asc'  THEN l.price END ASC,
    CASE WHEN p_sort = 'price_desc' THEN l.price END DESC,
    l.created_at DESC
  LIMIT least(greatest(p_limit, 1), 60) OFFSET greatest(p_offset, 0);
$function$;
CREATE OR REPLACE FUNCTION public.guest_search_mechanics(p_query text)
 RETURNS SETOF public.guest_profiles
 LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT g.*
    FROM guest_profiles g
   WHERE g.role = 'mechanic'
     AND extensions.unaccent(replace(lower(g.full_name), 'ß', 'ss'))
         LIKE '%' || extensions.unaccent(replace(lower(coalesce(p_query, '')), 'ß', 'ss')) || '%'
   ORDER BY g.full_name
   LIMIT 30;
$function$;
CREATE OR REPLACE FUNCTION public.guest_search_market(p_query text, p_category text DEFAULT NULL::text, p_sort text DEFAULT 'recent'::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS SETOF public.guest_market_listings
 LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT l.*
    FROM guest_market_listings l
   WHERE l.status = 'active'
     AND (p_category IS NULL OR l.category = p_category)
     AND extensions.unaccent(replace(lower(l.title || ' ' || l.description), 'ß', 'ss'))
         LIKE '%' || extensions.unaccent(replace(lower(coalesce(p_query, '')), 'ß', 'ss')) || '%'
   ORDER BY
     CASE WHEN p_sort = 'price_asc'  THEN l.price END ASC,
     CASE WHEN p_sort = 'price_desc' THEN l.price END DESC,
     l.created_at DESC
   LIMIT least(greatest(coalesce(p_limit, 30), 1), 60) OFFSET greatest(coalesce(p_offset, 0), 0);
$function$;
CREATE OR REPLACE FUNCTION public.edit_message(p_table text, p_id uuid, p_content text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF length(btrim(p_content)) = 0 THEN RAISE EXCEPTION 'empty'; END IF;
  IF p_table = 'messages' THEN
    UPDATE messages SET content = p_content, edited_at = now()
      WHERE id = p_id AND sender_id = auth.uid()
        AND deleted_at IS NULL AND image_path IS NULL AND file_path IS NULL
        AND created_at > now() - interval '3 minutes';
  ELSIF p_table = 'channel_messages' THEN
    UPDATE channel_messages SET content = p_content, edited_at = now()
      WHERE id = p_id AND sender_id = auth.uid()
        AND deleted_at IS NULL AND image_path IS NULL AND file_path IS NULL
        AND created_at > now() - interval '3 minutes';
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
END; $function$;
REVOKE EXECUTE ON FUNCTION extensions.unaccent(regdictionary, text) FROM anon, authenticated;

-- 1. Constrângerile de lungime
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
            WHERE connamespace = 'public'::regnamespace AND conname LIKE '%\_len' AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;
ALTER TABLE public.app_versions DROP CONSTRAINT IF EXISTS app_versions_store_url_https;

-- 0. Schema privată (după ce nimic din public nu o mai referă)
DROP SCHEMA IF EXISTS app CASCADE;

SELECT (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND roles = ARRAY['public']::name[]) AS politici_public,
       (SELECT count(*) FROM pg_constraint WHERE conname LIKE '%\_len') AS constrangeri_len,
       to_regnamespace('app') IS NULL AS schema_app_stearsa,
       (SELECT allowed_mime_types IS NULL FROM storage.buckets WHERE id = 'photos') AS mime_resetat,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx\_%' AND indexname <> 'idx_channel_messages_channel_created'
          AND indexname NOT LIKE 'idx_conversations_%pair') AS indexuri_ramase;
