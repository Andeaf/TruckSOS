-- ─────────────────────────────────────────────────────────────────────────────
-- 26 oct 2026 — FAZA 2 din PLAN_1.1_FIX: igienă, validare pe server, limite de ritm, Storage, indexuri
-- (AUDIT #4 parțial, #10, #16, #17, #38, #40, #42). Versiunea e 20261031 (după ultima aplicată,
-- 20261030000100), ca istoricul din supabase_migrations să rămână crescător.
--
-- Cum se rulează: repetiție `BEGIN;` + fișier + probe + `ROLLBACK;`, apoi real `BEGIN;` + fișier +
-- `COMMIT;` (npx supabase db query --linked -f <wrapper>), apoi `migration repair --status applied`.
-- Rollback real: supabase/rollback/20261031000100_hygiene_limits.sql.
--
-- Indexurile (2.2 din plan) sunt AICI, nu într-o migrare separată cu CONCURRENTLY: CLI-ul (CI,
-- `db push`) rulează fiecare migrare într-o tranzacție, unde CONCURRENTLY nu merge; tabelele au
-- azi sub 2.500 de rânduri (messages 2.273, 464 kB), deci CREATE INDEX obișnuit ține milisecunde,
-- iar lock_timeout = 5 s face ca orice așteptare de lock să eșueze curat (migrarea se reia).
--
-- COMPATIBIL CU 1.0.6–1.0.8 (verificat punct cu punct):
--   • CHECK-urile de lungime sunt peste tot ≥ ce poate trimite clientul (chat 1000, Market 80/4000,
--     raport/evaluare 500, plăcuță 12, șasiu 20) și ≥ maximul din datele existente (specialization
--     677 → 1000); se adaugă NOT VALID + VALIDATE, deci fără blocaj și fără eșec pe rânduri vechi.
--   • search_* păstrează semnăturile și tipurile returnate; doar escapează %/_/\ și taie la 100.
--   • politicile TO public devin TO authenticated cu EXACT aceleași expresii (verificat în migrare).
--   • Storage: allowed_mime_types acoperă tot ce trimit clienții 1.0.x (jpeg după compresie, video din
--     galerie, documentele din picker, cu application/octet-stream pentru tipuri necunoscute) și
--     exclude ce ar putea fi randat ca pagină (html, svg, xml, js); limita de 55 MB rămâne.
--   • limitele de ritm sunt peste utilizarea normală (D5); depășirea = eroare `rate_limited`
--     (tradusă în 1.1 de translateDbError; în 1.0.x apare textul brut).
-- ─────────────────────────────────────────────────────────────────────────────

SET LOCAL lock_timeout = '5s';

-- ── 0. Schema privată `app` (helperi, evidențe tehnice; NU e expusă prin PostgREST) ──────────────
-- Drepturile implicite: cele globale din 26 sept 2026 (funcțiile noi ale lui postgres nu primesc
-- EXECUTE pentru PUBLIC) se aplică și aici; fiecare obiect nou are oricum REVOKE/GRANT explicit.
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role;

-- ── 1. Lungimi maxime pe server (AUDIT #16) ─────────────────────────────────────────────────────
-- NOT VALID (fără scanare la ADD) + VALIDATE (scanare cu lock slab); dacă un rând vechi depășește
-- limita, VALIDATE eșuează și migrarea nu se aplică (se vede în repetiție).
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('announcements', 'description', 4000), ('announcements', 'location', 300),
      ('announcements', 'plate_number', 20), ('announcements', 'chassis_number', 30),
      ('announcements', 'truck_make', 80), ('announcements', 'truck_model', 80),
      ('messages', 'content', 4000), ('channel_messages', 'content', 4000),
      ('applications', 'message', 2000), ('ratings', 'comment', 1000), ('reports', 'details', 2000),
      ('profiles', 'full_name', 120), ('profiles', 'phone', 32), ('profiles', 'address', 300),
      ('profiles', 'vat_number', 32), ('profiles', 'company_name', 120), ('profiles', 'contact_email', 254),
      ('profiles', 'specialization', 1000), ('profiles', 'activity_zone', 300),
      ('trucks', 'make', 80), ('trucks', 'model', 80), ('trucks', 'nickname', 80),
      ('trucks', 'plate_number', 20), ('trucks', 'chassis_number', 30),
      ('market_listings', 'title', 120), ('market_listings', 'description', 4000)
    ) AS v(tbl, col, max_len)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = ('public.' || spec.tbl)::regclass
                      AND conname = spec.tbl || '_' || spec.col || '_len') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (char_length(%I) <= %s) NOT VALID',
                     spec.tbl, spec.tbl || '_' || spec.col || '_len', spec.col, spec.max_len);
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I',
                     spec.tbl, spec.tbl || '_' || spec.col || '_len');
    END IF;
  END LOOP;
END $$;

-- app_versions.store_url se deschide din client fără verificarea schemei (AUDIT #42): doar https.
ALTER TABLE public.app_versions DROP CONSTRAINT IF EXISTS app_versions_store_url_https;
ALTER TABLE public.app_versions
  ADD CONSTRAINT app_versions_store_url_https CHECK (store_url IS NULL OR store_url ~ '^https://') NOT VALID;
ALTER TABLE public.app_versions VALIDATE CONSTRAINT app_versions_store_url_https;

-- edit_message: aceeași limită ca la INSERT (CHECK-ul de pe content o aplică și UPDATE-ului;
-- aici doar o eroare mai clară decât 23514). Drepturile existente (authenticated) rămân.
CREATE OR REPLACE FUNCTION public.edit_message(p_table text, p_id uuid, p_content text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF length(btrim(p_content)) = 0 THEN RAISE EXCEPTION 'empty'; END IF;
  IF char_length(p_content) > 4000 THEN RAISE EXCEPTION 'too_long'; END IF;
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
REVOKE ALL ON FUNCTION public.edit_message(text, uuid, text) FROM PUBLIC, anon;

-- ── 2. Căutările: escapare %, _, \ și plafon de 100 de caractere (AUDIT #38) ─────────────────────
CREATE OR REPLACE FUNCTION app.like_escape(p_query text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path = ''
AS $function$
  SELECT replace(replace(replace(left(p_query, 100), '\', '\\'), '%', '\%'), '_', '\_');
$function$;
REVOKE ALL ON FUNCTION app.like_escape(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.like_escape(text) TO anon, authenticated, service_role;

-- Normalizarea textului pentru căutare (fără accente, ß → ss, litere mici) — într-un singur loc,
-- cu 'ß' scris corect (în producție search_market_listings ajunsese cu 'ÃŸ' — mojibake).
-- Dicționarul e numit explicit (forma cu două argumente), ca funcția să meargă cu search_path gol.
CREATE OR REPLACE FUNCTION app.search_norm(p_text text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path = ''
AS $function$
  SELECT extensions.unaccent('extensions.unaccent'::regdictionary, replace(lower(coalesce(p_text, '')), 'ß', 'ss'));
$function$;
REVOKE ALL ON FUNCTION app.search_norm(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.search_norm(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION extensions.unaccent(regdictionary, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_mechanics(p_query text)
 RETURNS TABLE(id uuid, full_name text, specialization text, activity_zone text, rating_avg numeric, rating_count integer, avatar_path text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p.id, p.full_name, p.specialization, p.activity_zone,
         p.rating_avg, p.rating_count, p.avatar_path
  FROM profiles p
  WHERE p.role = 'mechanic'
    AND p.deleted_at IS NULL
    AND NOT is_block_between(p.id, auth.uid())
    AND app.search_norm(p.full_name) LIKE '%' || app.like_escape(app.search_norm(p_query)) || '%' ESCAPE '\'
  ORDER BY p.full_name
  LIMIT 30;
$function$;
REVOKE ALL ON FUNCTION public.search_mechanics(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.search_users(p_query text)
 RETURNS TABLE(id uuid, full_name text, role text, specialization text, activity_zone text, rating_avg numeric, rating_count integer, avatar_path text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p.id, p.full_name, p.role::text, p.specialization, p.activity_zone,
         p.rating_avg, p.rating_count, p.avatar_path
  FROM profiles p
  WHERE p.role IN ('driver', 'mechanic')
    AND p.deleted_at IS NULL
    AND p.id <> auth.uid()
    AND NOT is_block_between(p.id, auth.uid())
    AND app.search_norm(p.full_name) LIKE '%' || app.like_escape(app.search_norm(p_query)) || '%' ESCAPE '\'
  ORDER BY p.full_name
  LIMIT 30;
$function$;
REVOKE ALL ON FUNCTION public.search_users(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.search_market_listings(p_query text, p_category text DEFAULT NULL::text, p_sort text DEFAULT 'recent'::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS SETOF public.market_listings
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT l.*
  FROM market_listings l
  WHERE l.status = 'active'
    AND NOT is_block_between(l.seller_id, auth.uid())
    AND (p_category IS NULL OR l.category = p_category)
    AND app.search_norm(l.title || ' ' || l.description)
        LIKE '%' || app.like_escape(app.search_norm(p_query)) || '%' ESCAPE '\'
  ORDER BY
    CASE WHEN p_sort = 'price_asc'  THEN l.price END ASC,
    CASE WHEN p_sort = 'price_desc' THEN l.price END DESC,
    l.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 60) OFFSET greatest(coalesce(p_offset, 0), 0);
$function$;
REVOKE ALL ON FUNCTION public.search_market_listings(text, text, text, integer, integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.guest_search_mechanics(p_query text)
 RETURNS SETOF public.guest_profiles
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT g.*
    FROM guest_profiles g
   WHERE g.role = 'mechanic'
     AND app.search_norm(g.full_name) LIKE '%' || app.like_escape(app.search_norm(p_query)) || '%' ESCAPE '\'
   ORDER BY g.full_name
   LIMIT 30;
$function$;
REVOKE ALL ON FUNCTION public.guest_search_mechanics(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_search_mechanics(text) TO anon;

CREATE OR REPLACE FUNCTION public.guest_search_market(p_query text, p_category text DEFAULT NULL::text, p_sort text DEFAULT 'recent'::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS SETOF public.guest_market_listings
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT l.*
    FROM guest_market_listings l
   WHERE l.status = 'active'
     AND (p_category IS NULL OR l.category = p_category)
     AND app.search_norm(l.title || ' ' || l.description)
         LIKE '%' || app.like_escape(app.search_norm(p_query)) || '%' ESCAPE '\'
   ORDER BY
     CASE WHEN p_sort = 'price_asc'  THEN l.price END ASC,
     CASE WHEN p_sort = 'price_desc' THEN l.price END DESC,
     l.created_at DESC
   LIMIT least(greatest(coalesce(p_limit, 30), 1), 60) OFFSET greatest(coalesce(p_offset, 0), 0);
$function$;
REVOKE ALL ON FUNCTION public.guest_search_market(text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_search_market(text, text, text, integer, integer) TO anon;

-- ── 3. Cele 9 funcții fără search_path (Security Advisor: function_search_path_mutable, #40) ─────
-- Corpurile cu nume calificate + search_path gol. Comportament identic; drepturile rămân.
CREATE OR REPLACE FUNCTION public.user_lang(p_user_id uuid)
 RETURNS text LANGUAGE sql STABLE SET search_path = ''
AS $function$ SELECT COALESCE(lang, 'ro') FROM public.profiles WHERE id = p_user_id; $function$;
REVOKE ALL ON FUNCTION public.user_lang(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.guard_not_banned()
 RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  -- auth.uid() = apelantul real, chiar și în interiorul unui RPC SECURITY DEFINER.
  -- is_banned(NULL) => false (scrierile de sistem/migrări nu sunt afectate).
  IF public.is_banned(auth.uid()) THEN
    RAISE EXCEPTION 'account_banned';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_announcement_photo_limit()
 RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  IF (SELECT count(*) FROM public.announcement_photos WHERE announcement_id = NEW.announcement_id) >= 10 THEN
    RAISE EXCEPTION 'photo_limit_reached';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.enforce_market_listing_limit()
 RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  IF NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.status <> 'active')
     AND (SELECT count(*) FROM public.market_listings
          WHERE seller_id = NEW.seller_id AND status = 'active') >= 20 THEN
    RAISE EXCEPTION 'listing_limit_reached';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.enforce_market_photo_limit()
 RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  IF (SELECT count(*) FROM public.market_listing_photos WHERE listing_id = NEW.listing_id) >= 10 THEN
    RAISE EXCEPTION 'photo_limit_reached';
  END IF;
  RETURN NEW;
END; $function$;

ALTER FUNCTION public.distance_km(double precision, double precision, double precision, double precision) SET search_path = '';
ALTER FUNCTION public.push_text(text, text) SET search_path = '';
ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.ratings_touch_updated_at() SET search_path = '';

-- ── 4. Funcțiile-trigger nu mai sunt executabile prin API (igienă, #40) ─────────────────────────
-- Trigger-ele se execută fără verificarea EXECUTE a apelantului (drepturile contează doar la
-- CREATE TRIGGER); PostgREST nu le expune oricum (întorc `trigger`). Probat în repetiție cu un
-- INSERT ca `authenticated` într-un tabel cu triggere.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

-- ── 5. Politicile `TO public` → `TO authenticated`, cu aceleași expresii (#40) ────────────────────
-- anon are politici proprii (…_anon); grant-urile îl țineau oricum afară, dar un GRANT greșit în
-- viitor nu mai trebuie să poată deschide aceste politici și pentru el. Setul de politici e
-- fotografiat înainte și comparat după: orice diferență în afară de rol = EXCEPTION.
CREATE TEMP TABLE _hygiene_pol_before AS
  SELECT tablename, policyname, permissive, cmd, qual, with_check, roles
    FROM pg_policies WHERE schemaname = 'public';

DO $$
DECLARE r record; sql text;
BEGIN
  FOR r IN SELECT tablename, policyname, permissive, cmd, qual, with_check
             FROM _hygiene_pol_before WHERE roles = ARRAY['public']::name[]
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    sql := format('CREATE POLICY %I ON public.%I AS %s FOR %s TO authenticated',
                  r.policyname, r.tablename, r.permissive, r.cmd);
    IF r.qual IS NOT NULL THEN sql := sql || ' USING (' || r.qual || ')'; END IF;
    IF r.with_check IS NOT NULL THEN sql := sql || ' WITH CHECK (' || r.with_check || ')'; END IF;
    EXECUTE sql;
  END LOOP;
END $$;

DO $$
DECLARE v_diff int; v_before int; v_after int;
BEGIN
  SELECT count(*) INTO v_before FROM _hygiene_pol_before;
  SELECT count(*) INTO v_after FROM pg_policies WHERE schemaname = 'public';
  SELECT count(*) INTO v_diff FROM (
    SELECT tablename, policyname, permissive, cmd, qual, with_check,
           CASE WHEN roles = ARRAY['public']::name[] THEN ARRAY['authenticated']::name[] ELSE roles END AS roles
      FROM _hygiene_pol_before
    EXCEPT
    SELECT tablename, policyname, permissive, cmd, qual, with_check, roles
      FROM pg_policies WHERE schemaname = 'public') d;
  IF v_diff > 0 OR v_before <> v_after THEN
    RAISE EXCEPTION 'politicile nu s-au recreat identic (diferențe: %, înainte: %, după: %)', v_diff, v_before, v_after;
  END IF;
END $$;
DROP TABLE _hygiene_pol_before;

-- ── 6. Storage: tipuri MIME permise, politici pe PK (fără cast pe id), cotă per utilizator (#17, #10) ──
-- Lista acoperă ce trimit clienții 1.0.x: poze (jpeg după compresie), video din galerie (media.ts
-- construiește `video/<extensie>` când pickerul nu dă tipul: mp4, mov→quicktime, 3gp, m4v… → `video/*`),
-- orice document din picker (Office, PDF, text, arhive, audio → `audio/*`) și `application/octet-stream`
-- pentru tipuri necunoscute (browserele nu „ghicesc” HTML dintr-un octet-stream). Tipurile video/audio
-- uzuale sunt și explicite, ca lista să rămână corectă chiar dacă wildcard-ul n-ar fi interpretat.
-- Lipsesc intenționat text/html, image/svg+xml, *xml, javascript — singurele care ar putea fi randate
-- ca pagină. Istoric, în bucket există doar image/jpeg, video/mp4, video/quicktime, application/pdf.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
     'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/bmp',
     'image/tiff', 'image/avif',
     'video/*', 'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/3gpp2', 'video/3gp', 'video/m4v',
     'video/x-m4v', 'video/mpeg', 'video/x-matroska', 'video/x-msvideo',
     'audio/*', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/opus', 'audio/flac',
     'audio/wav', 'audio/x-wav', 'audio/x-m4a', 'audio/webm', 'audio/amr', 'audio/3gpp',
     'application/pdf', 'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
     'application/vnd.oasis.opendocument.presentation', 'application/rtf', 'text/rtf',
     'text/plain', 'text/csv', 'text/vcard', 'text/x-vcard', 'message/rfc822', 'application/vnd.ms-outlook',
     'application/json',
     'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed', 'application/vnd.rar',
     'application/x-7z-compressed', 'application/gzip', 'application/x-tar',
     'application/octet-stream'
   ]
 WHERE id = 'photos';

-- UUID sau NULL, ca politicile de Storage să poată folosi PK-ul (a.id = uuid) în loc de
-- (a.id)::text = …, care împiedica folosirea indexului.
CREATE OR REPLACE FUNCTION app.uuid_or_null(p_text text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path = ''
AS $function$
  SELECT CASE WHEN p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN p_text::uuid ELSE NULL END;
$function$;
REVOKE ALL ON FUNCTION app.uuid_or_null(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.uuid_or_null(text) TO anon, authenticated, service_role;

-- Cotă per utilizator (D5): cel mult 60 de obiecte în 24 h și 1.500 în total. Rulează ca definer
-- (citește storage.objects indiferent de politicile de SELECT ale apelantului).
CREATE OR REPLACE FUNCTION app.storage_quota_ok()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND (SELECT count(*) FROM storage.objects
           WHERE owner_id = auth.uid()::text AND created_at > now() - interval '24 hours') < 60
     AND (SELECT count(*) FROM storage.objects WHERE owner_id = auth.uid()::text) < 1500;
$function$;
REVOKE ALL ON FUNCTION app.storage_quota_ok() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.storage_quota_ok() TO authenticated;

DROP POLICY IF EXISTS photos_insert_announcement ON storage.objects;
CREATE POLICY photos_insert_announcement ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'announcements'
              AND app.storage_quota_ok()
              AND EXISTS (SELECT 1 FROM public.announcements a
                           WHERE a.id = app.uuid_or_null((storage.foldername(objects.name))[2])
                             AND a.driver_id = auth.uid()));

DROP POLICY IF EXISTS photos_insert_avatar ON storage.objects;
CREATE POLICY photos_insert_avatar ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'avatars'
              AND (storage.foldername(objects.name))[2] = auth.uid()::text
              AND app.storage_quota_ok());

DROP POLICY IF EXISTS photos_insert_channel ON storage.objects;
CREATE POLICY photos_insert_channel ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'channel'
              AND app.storage_quota_ok()
              AND EXISTS (SELECT 1 FROM public.channels c
                           WHERE c.id = app.uuid_or_null((storage.foldername(objects.name))[2])));

DROP POLICY IF EXISTS photos_insert_chat ON storage.objects;
CREATE POLICY photos_insert_chat ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'chat'
              AND app.storage_quota_ok()
              AND EXISTS (SELECT 1 FROM public.conversations c
                           WHERE c.id = app.uuid_or_null((storage.foldername(objects.name))[2])
                             AND (c.driver_id = auth.uid() OR c.mechanic_id = auth.uid())));

DROP POLICY IF EXISTS photos_insert_market ON storage.objects;
CREATE POLICY photos_insert_market ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'market'
              AND app.storage_quota_ok()
              AND EXISTS (SELECT 1 FROM public.market_listings l
                           WHERE l.id = app.uuid_or_null((storage.foldername(objects.name))[2])
                             AND l.seller_id = auth.uid()));

DROP POLICY IF EXISTS photos_delete_announcement ON storage.objects;
CREATE POLICY photos_delete_announcement ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'announcements'
         AND EXISTS (SELECT 1 FROM public.announcements a
                      WHERE a.id = app.uuid_or_null((storage.foldername(objects.name))[2])
                        AND a.driver_id = auth.uid()));

DROP POLICY IF EXISTS photos_delete_market ON storage.objects;
CREATE POLICY photos_delete_market ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'market'
         AND EXISTS (SELECT 1 FROM public.market_listings l
                      WHERE l.id = app.uuid_or_null((storage.foldername(objects.name))[2])
                        AND l.seller_id = auth.uid()));

DROP POLICY IF EXISTS photos_select_announcement ON storage.objects;
CREATE POLICY photos_select_announcement ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'announcements'
         AND EXISTS (SELECT 1 FROM public.announcements a
                      WHERE a.id = app.uuid_or_null((storage.foldername(objects.name))[2])
                        AND (a.driver_id = auth.uid() OR a.mechanic_id = auth.uid()
                             OR (a.status = 'open'
                                 AND EXISTS (SELECT 1 FROM public.profiles p
                                              WHERE p.id = auth.uid() AND p.role = 'mechanic')))));

DROP POLICY IF EXISTS photos_select_channel ON storage.objects;
CREATE POLICY photos_select_channel ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'channel'
         AND EXISTS (SELECT 1 FROM public.channels c
                      WHERE c.id = app.uuid_or_null((storage.foldername(objects.name))[2])));

DROP POLICY IF EXISTS photos_select_chat ON storage.objects;
CREATE POLICY photos_select_chat ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'chat'
         AND EXISTS (SELECT 1 FROM public.conversations c
                      WHERE c.id = app.uuid_or_null((storage.foldername(objects.name))[2])
                        AND (c.driver_id = auth.uid() OR c.mechanic_id = auth.uid())));

DROP POLICY IF EXISTS photos_select_market ON storage.objects;
CREATE POLICY photos_select_market ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'market'
         AND EXISTS (SELECT 1 FROM public.market_listings l
                      WHERE l.id = app.uuid_or_null((storage.foldername(objects.name))[2])));

DROP POLICY IF EXISTS photos_select_market_anon ON storage.objects;
CREATE POLICY photos_select_market_anon ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'market'
         AND EXISTS (SELECT 1 FROM public.market_listings l
                      WHERE l.id = app.uuid_or_null((storage.foldername(objects.name))[2])
                        AND l.status = 'active'));

-- ── 7. Limite de ritm (AUDIT #4, decizia D5) ─────────────────────────────────────────────────────
-- Evidența e în schema privată; funcțiile rulează ca definer, deci clientul nu are nevoie de
-- niciun drept pe tabel. Valorile stau în funcții (se pot schimba fără build). Scrierile fără
-- utilizator (cron, service_role, migrări: auth.uid() IS NULL) și rândurile inserate de alte
-- triggere (pg_trigger_depth() > 1 — nu sunt trafic de client) nu sunt limitate.
CREATE TABLE IF NOT EXISTS app.rate_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid        NOT NULL,
  kind       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.rate_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.rate_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON app.rate_events TO service_role;
CREATE INDEX IF NOT EXISTS rate_events_user_kind_time ON app.rate_events (user_id, kind, created_at DESC);

-- Întoarce false (și NU înregistrează) când s-a atins plafonul în fereastră; altfel înregistrează.
CREATE OR REPLACE FUNCTION app.rate_limit_ok(p_kind text, p_window interval, p_max integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN RETURN true; END IF;
  SELECT count(*) INTO v_count FROM app.rate_events
   WHERE user_id = v_uid AND kind = p_kind AND created_at > now() - p_window;
  IF v_count >= p_max THEN RETURN false; END IF;
  INSERT INTO app.rate_events (user_id, kind) VALUES (v_uid, p_kind);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION app.rate_limit_ok(text, interval, integer) FROM PUBLIC, anon, authenticated;

-- Anunțuri: cel mult 3 deschise simultan (status = 'open'), 10 create în 24 h, 30 în 7 zile.
-- Se aplică la INSERT și la redeschidere (UPDATE … status → 'open', adică repost_announcement),
-- altfel plafonul s-ar putea ocoli repostând în buclă un anunț anulat.
CREATE OR REPLACE FUNCTION app.limit_announcements()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.status <> 'open' OR OLD.status = 'open') THEN RETURN NEW; END IF;
  IF NEW.status <> 'open' THEN RETURN NEW; END IF;
  IF (SELECT count(*) FROM public.announcements WHERE driver_id = auth.uid() AND status = 'open' AND id <> NEW.id) >= 3 THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements_open';
  END IF;
  IF NOT app.rate_limit_ok('announcement_day', interval '24 hours', 10)
     OR NOT app.rate_limit_ok('announcement_week', interval '7 days', 30) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements';
  END IF;
  RETURN NEW;
END; $function$;

-- Canal: 15 mesaje pe minut, 300 pe oră.
CREATE OR REPLACE FUNCTION app.limit_channel_messages()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NOT app.rate_limit_ok('channel_minute', interval '1 minute', 15)
     OR NOT app.rate_limit_ok('channel_hour', interval '1 hour', 300) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'channel_messages';
  END IF;
  RETURN NEW;
END; $function$;

-- Chat privat: 30 pe minut per conversație, 120 pe minut în total.
CREATE OR REPLACE FUNCTION app.limit_messages()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NOT app.rate_limit_ok('message_minute', interval '1 minute', 120)
     OR NOT app.rate_limit_ok('message_conv_' || NEW.conversation_id::text, interval '1 minute', 30) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'messages';
  END IF;
  RETURN NEW;
END; $function$;

-- Market: 10 anunțuri create în 24 h (plafonul de 20 active rămâne).
CREATE OR REPLACE FUNCTION app.limit_market_listings()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NOT app.rate_limit_ok('listing_day', interval '24 hours', 10) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'market_listings';
  END IF;
  RETURN NEW;
END; $function$;

-- Rapoarte: 20 în 24 h.
CREATE OR REPLACE FUNCTION app.limit_reports()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NOT app.rate_limit_ok('report_day', interval '24 hours', 20) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'reports';
  END IF;
  RETURN NEW;
END; $function$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app' AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

-- Triggerele rulează ÎNAINTE de gărzile existente (numele „aaa_" le pune primele, alfabetic).
DROP TRIGGER IF EXISTS aaa_rate_limit ON public.announcements;
CREATE TRIGGER aaa_rate_limit BEFORE INSERT OR UPDATE OF status ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION app.limit_announcements();
DROP TRIGGER IF EXISTS aaa_rate_limit ON public.channel_messages;
CREATE TRIGGER aaa_rate_limit BEFORE INSERT ON public.channel_messages
  FOR EACH ROW EXECUTE FUNCTION app.limit_channel_messages();
DROP TRIGGER IF EXISTS aaa_rate_limit ON public.messages;
CREATE TRIGGER aaa_rate_limit BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION app.limit_messages();
DROP TRIGGER IF EXISTS aaa_rate_limit ON public.market_listings;
CREATE TRIGGER aaa_rate_limit BEFORE INSERT ON public.market_listings
  FOR EACH ROW EXECUTE FUNCTION app.limit_market_listings();
DROP TRIGGER IF EXISTS aaa_rate_limit ON public.reports;
CREATE TRIGGER aaa_rate_limit BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION app.limit_reports();

-- Evidența se curăță zilnic (fereastra cea mai lungă e 7 zile).
SELECT cron.schedule(
  'cleanup-rate-events-daily',
  '47 3 * * *',
  $JOB$ DELETE FROM app.rate_events WHERE created_at < now() - interval '8 days'; $JOB$
);

-- ── 8. Curățenie după un val de conturi-bot (AUDIT #4, B.10 b) — doar admin ───────────────────────
-- Conturile create în interval, fără NICIO urmă de folosire reală (anunț, mesaj, candidatură, listing,
-- evaluare, raport, conversație, camion, favorit, token de push, fișier în Storage, profil completat
-- cu telefon/firmă/poză) și care nu sunt admini. Intervalul se termină cu cel puțin 24 h în urmă, ca
-- să nu prindă conturi aflate în onboarding. p_dry_run = true (implicit) doar numără.
CREATE OR REPLACE FUNCTION public.admin_purge_accounts(p_from timestamptz, p_to timestamptz, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '31 days'
     OR p_to > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'bad_interval';
  END IF;
  SELECT coalesce(array_agg(u.id), '{}') INTO v_ids
    FROM auth.users u
   WHERE u.created_at >= p_from AND u.created_at < p_to
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id
                        AND (p.role = 'admin' OR p.phone IS NOT NULL OR p.company_name IS NOT NULL OR p.avatar_path IS NOT NULL))
     AND NOT EXISTS (SELECT 1 FROM public.announcements a WHERE a.driver_id = u.id OR a.mechanic_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.sender_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.channel_messages cm WHERE cm.sender_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.applications ap WHERE ap.mechanic_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.driver_id = u.id OR c.mechanic_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.market_listings l WHERE l.seller_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.ratings r WHERE r.driver_id = u.id OR r.mechanic_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.reports rp WHERE rp.reporter_id = u.id OR rp.reported_user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.trucks t WHERE t.driver_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.favorite_mechanics f WHERE f.driver_id = u.id OR f.mechanic_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.push_tokens pt WHERE pt.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.owner_id = u.id::text);
  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'count', coalesce(array_length(v_ids, 1), 0));
  END IF;
  -- Ștergerea din auth.users declanșează on_auth_user_deleted → handle_auth_user_deleted (curățare).
  DELETE FROM auth.users WHERE id = ANY (v_ids);
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'purge_accounts', 'user', NULL,
          jsonb_build_object('from', p_from, 'to', p_to, 'count', coalesce(array_length(v_ids, 1), 0)));
  RETURN jsonb_build_object('dry_run', false, 'count', coalesce(array_length(v_ids, 1), 0));
END; $function$;
REVOKE ALL ON FUNCTION public.admin_purge_accounts(timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_accounts(timestamptz, timestamptz, boolean) TO authenticated;

-- ── 9. Indexuri (AUDIT #10, plan 2.2) ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_status_created ON public.announcements (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_driver ON public.announcements (driver_id);
CREATE INDEX IF NOT EXISTS idx_announcements_mechanic ON public.announcements (mechanic_id) WHERE mechanic_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_announcements_open_geo ON public.announcements (latitude, longitude) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_conversations_driver ON public.conversations (driver_id);
CREATE INDEX IF NOT EXISTS idx_conversations_mechanic ON public.conversations (mechanic_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked_blocker ON public.blocked_users (blocked_id, blocker_id);
CREATE INDEX IF NOT EXISTS idx_profiles_mechanic_push ON public.profiles (role, push_enabled) WHERE role = 'mechanic';
CREATE INDEX IF NOT EXISTS idx_profiles_mechanic_geo ON public.profiles (latitude, longitude) WHERE role = 'mechanic';
CREATE INDEX IF NOT EXISTS idx_channel_push_prefs_channel_enabled ON public.channel_push_prefs (channel_id) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_ratings_driver ON public.ratings (driver_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON public.reports (reporter_id);

-- ── 10. Verificare (eșec = EXCEPTION = nimic nu se aplică) ────────────────────────────────────────
DO $$
DECLARE v_bad text := ''; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_constraint WHERE conname LIKE '%\_len' AND connamespace = 'public'::regnamespace AND NOT convalidated;
  IF v_n > 0 THEN v_bad := v_bad || ' [constrângeri de lungime nevalidate: ' || v_n || ']'; END IF;
  SELECT count(*) INTO v_n FROM pg_constraint WHERE conname LIKE '%\_len' AND connamespace = 'public'::regnamespace AND contype = 'c';
  IF v_n <> 26 THEN v_bad := v_bad || ' [constrângeri de lungime: ' || v_n || '/26]'; END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND roles = ARRAY['public']::name[];
  IF v_n > 0 THEN v_bad := v_bad || ' [politici TO public rămase: ' || v_n || ']'; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%');
  IF v_n > 0 THEN v_bad := v_bad || ' [funcții fără search_path: ' || v_n || ']'; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'app') AND p.prorettype = 'trigger'::regtype
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_n > 0 THEN v_bad := v_bad || ' [funcții-trigger executabile prin API: ' || v_n || ']'; END IF;
  IF (SELECT allowed_mime_types IS NULL OR file_size_limit <> 57671680 FROM storage.buckets WHERE id = 'photos') THEN
    v_bad := v_bad || ' [bucket photos: MIME sau limită greșită]';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'photos\_%'
    AND (qual LIKE '%::text = (storage.foldername%' OR with_check LIKE '%::text = (storage.foldername%');
  IF v_n > 0 THEN v_bad := v_bad || ' [politici de Storage cu cast pe id: ' || v_n || ']'; END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'storage' AND cmd = 'INSERT' AND with_check LIKE '%storage_quota_ok%';
  IF v_n <> 5 THEN v_bad := v_bad || ' [politici de INSERT cu cotă: ' || v_n || '/5]'; END IF;
  SELECT count(*) INTO v_n FROM pg_trigger WHERE tgname = 'aaa_rate_limit' AND NOT tgisinternal;
  IF v_n <> 5 THEN v_bad := v_bad || ' [triggere de ritm: ' || v_n || '/5]'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-rate-events-daily') THEN v_bad := v_bad || ' [cron lipsă]'; END IF;
  IF has_function_privilege('anon', 'public.admin_purge_accounts(timestamptz, timestamptz, boolean)', 'EXECUTE') THEN
    v_bad := v_bad || ' [admin_purge_accounts executabil de anon]';
  END IF;
  IF has_table_privilege('authenticated', 'app.rate_events', 'SELECT') OR has_table_privilege('anon', 'app.rate_events', 'SELECT') THEN
    v_bad := v_bad || ' [rate_events citibil prin API]';
  END IF;
  SELECT count(*) INTO v_n FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
    'idx_messages_conversation_created', 'idx_announcements_status_created', 'idx_announcements_driver',
    'idx_announcements_mechanic', 'idx_announcements_open_geo', 'idx_conversations_driver', 'idx_conversations_mechanic',
    'idx_blocked_users_blocked_blocker', 'idx_profiles_mechanic_push', 'idx_profiles_mechanic_geo',
    'idx_channel_push_prefs_channel_enabled', 'idx_ratings_driver', 'idx_reports_reporter');
  IF v_n <> 13 THEN v_bad := v_bad || ' [indexuri: ' || v_n || '/13]'; END IF;
  IF v_bad <> '' THEN RAISE EXCEPTION 'hygiene_limits verificare EȘUATĂ:%', v_bad; END IF;
  RAISE NOTICE 'hygiene_limits verificare: PASS';
END $$;

-- Rezumat. Așteptat: toate PASS.
SELECT 1 AS nr, 'lungimi: 26 constrângeri validate' AS verificare,
       CASE WHEN (SELECT count(*) FROM pg_constraint WHERE conname LIKE '%\_len' AND connamespace = 'public'::regnamespace AND convalidated) = 26 THEN 'PASS' ELSE 'FAIL' END AS stare
UNION ALL SELECT 2, 'politici TO public = 0',
       CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND roles = ARRAY['public']::name[]) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 3, 'funcții din public fără search_path = 0',
       CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind = 'f'
                   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 4, 'storage: MIME setat, politici pe PK, cotă în INSERT',
       CASE WHEN (SELECT allowed_mime_types IS NOT NULL FROM storage.buckets WHERE id = 'photos')
                 AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND cmd = 'INSERT' AND with_check LIKE '%storage_quota_ok%') = 5
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 5, 'limite de ritm: 5 triggere + cron',
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname = 'aaa_rate_limit') = 5
                 AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-rate-events-daily') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 6, 'admin_purge_accounts: doar authenticated (is_admin în corp)',
       CASE WHEN has_function_privilege('authenticated', 'public.admin_purge_accounts(timestamptz, timestamptz, boolean)', 'EXECUTE')
                 AND NOT has_function_privilege('anon', 'public.admin_purge_accounts(timestamptz, timestamptz, boolean)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 7, 'indexuri: 13',
       CASE WHEN (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx\_%' AND indexname IN (
                    'idx_messages_conversation_created', 'idx_announcements_status_created', 'idx_announcements_driver',
                    'idx_announcements_mechanic', 'idx_announcements_open_geo', 'idx_conversations_driver', 'idx_conversations_mechanic',
                    'idx_blocked_users_blocked_blocker', 'idx_profiles_mechanic_push', 'idx_profiles_mechanic_geo',
                    'idx_channel_push_prefs_channel_enabled', 'idx_ratings_driver', 'idx_reports_reporter')) = 13 THEN 'PASS' ELSE 'FAIL' END
ORDER BY nr;
