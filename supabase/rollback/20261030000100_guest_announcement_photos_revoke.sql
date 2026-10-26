-- ROLLBACK pentru 20261030_guest_announcement_photos_revoke.sql — `BEGIN;` + fișier + `COMMIT;`.
-- Readuce exact ce dădea 20261026_guest_access (B1) oaspeților pentru pozele anunțurilor.
SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS announcement_photos_select_anon ON public.announcement_photos;
CREATE POLICY announcement_photos_select_anon ON public.announcement_photos FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.announcements a WHERE a.id = announcement_id AND a.status = 'open'));

GRANT SELECT (id, announcement_id, storage_path, created_at)
  ON public.announcement_photos TO anon;

CREATE OR REPLACE VIEW public.guest_announcement_photos WITH (security_invoker = true) AS
  SELECT id, announcement_id, storage_path, created_at
    FROM public.announcement_photos;
GRANT SELECT ON public.guest_announcement_photos TO anon, authenticated;

DROP POLICY IF EXISTS photos_select_announcement_anon ON storage.objects;
CREATE POLICY photos_select_announcement_anon ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'photos'
         AND (storage.foldername(objects.name))[1] = 'announcements'
         AND EXISTS (SELECT 1 FROM public.announcements a
                      WHERE a.id::text = (storage.foldername(objects.name))[2] AND a.status = 'open'));

SELECT to_regclass('public.guest_announcement_photos') IS NOT NULL AS view_readus,
       has_column_privilege('anon', 'public.announcement_photos', 'storage_path', 'SELECT') AS anon_coloane,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND roles = ARRAY['anon']::name[]) AS politici_storage_anon;
