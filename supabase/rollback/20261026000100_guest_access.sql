-- ROLLBACK pentru 20261026_guest_access.sql — `BEGIN;` + fișier + `COMMIT;`.
-- Scoate tot ce a primit anon; coloanele generate se pot scoate oricând (nimic nu le scrie),
-- dar clientul 1.1 le citește prin view-uri — după release, păstrează-le dacă guest mode rămâne.
SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS photos_select_avatar_anon       ON storage.objects;
DROP POLICY IF EXISTS photos_select_market_anon       ON storage.objects;
DROP POLICY IF EXISTS photos_select_announcement_anon ON storage.objects;

DROP FUNCTION IF EXISTS public.guest_search_market(text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.guest_search_mechanics(text);
REVOKE EXECUTE ON FUNCTION extensions.unaccent(text) FROM anon;
REVOKE USAGE ON SCHEMA extensions FROM anon;

DROP VIEW IF EXISTS public.guest_channel_messages;
DROP VIEW IF EXISTS public.guest_channels;
DROP VIEW IF EXISTS public.guest_market_listing_photos;
DROP VIEW IF EXISTS public.guest_market_listings;
DROP VIEW IF EXISTS public.guest_announcement_photos;
DROP VIEW IF EXISTS public.guest_announcements;
DROP VIEW IF EXISTS public.guest_profiles;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;   -- scoate și grant-urile pe coloane

DROP POLICY IF EXISTS profiles_select_anon            ON public.profiles;
DROP POLICY IF EXISTS announcements_select_anon       ON public.announcements;
DROP POLICY IF EXISTS announcement_photos_select_anon ON public.announcement_photos;
DROP POLICY IF EXISTS market_select_anon              ON public.market_listings;
DROP POLICY IF EXISTS market_photos_select_anon       ON public.market_listing_photos;
DROP POLICY IF EXISTS channels_select_anon            ON public.channels;
DROP POLICY IF EXISTS channel_messages_select_anon    ON public.channel_messages;
DROP POLICY IF EXISTS app_versions_select_anon        ON public.app_versions;

ALTER TABLE public.channel_messages DROP COLUMN IF EXISTS has_image;
ALTER TABLE public.announcements DROP COLUMN IF EXISTS lng_approx, DROP COLUMN IF EXISTS lat_approx;

SELECT (SELECT count(*) FROM pg_policies WHERE roles = ARRAY['anon']::name[]) AS politici_anon_ramase,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'v') AS view_uri_ramase;
