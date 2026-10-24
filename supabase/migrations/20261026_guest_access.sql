-- ─────────────────────────────────────────────────────────────────────────────
-- 26 oct 2026 — ACCESUL OASPEȚILOR (rolul `anon`), decis o singură dată (PLAN_1.1, Faza B1)
--
-- Cum se rulează: Studio → SQL Editor, `BEGIN;` + fișier + `COMMIT;` (repetiție cu ROLLBACK),
-- LA ORĂ DE TRAFIC MIC: cele trei coloane generate rescriu `announcements` și `channel_messages`
-- sub lacăt exclusiv (secunde). Rollback real: supabase/rollback/20261026_guest_access.sql
-- Ordinea migrărilor 1.1: 20261025 (A1, rulată) → acest fișier → 20261027 (G1) → 20261028 (H1).
--
-- DOAR SERVER, compatibilă cu 1.0.x: pentru `authenticated` nu se schimbă nimic (politicile noi sunt
-- `TO anon`; view-urile sunt obiecte noi; coloanele generate apar în `select('*')` și sunt ignorate —
-- niciun cod din client nu iterează coloanele unui rând, nimic nu le scrie).
--
-- TREI LACĂTE pentru `anon` (review A-1): (1) politici `TO anon` cu filtrele de rând — politicile pot
-- referi coloane pe care rolul NU le poate citi (deleted_at, banned_at); (2) GRANT pe COLOANE, doar cele
-- publice — `select=*` pe tabelul de bază dă `permission denied`; (3) view-uri `guest_*` cu
-- `security_invoker = true` care sunt PROIECȚII PURE ale coloanelor acordate — orice transformare e
-- coloană generată pe tabel (lat_approx/lng_approx/has_image), niciodată expresie în view, altfel
-- view-ul ar cere grant pe coloana-sursă (latitude exactă, image_path) și ar expune-o prin REST.
--
-- Ce vede un oaspete: mecanici (nume, firmă, specializare, zonă, rating, poză — fără adresă, TVA,
-- e-mail, telefon), anunțuri deschise cu poziție la ~1 km (2 zecimale) fără plăcuță/VIN, pozele lor,
-- Market activ cu poze, canalul (ultimele 7 zile, max 50 de mesaje, fără fișiere/poze: doar `has_image`),
-- versiunile din app_versions (pentru mesajul „Versiune nouă”). Fără Realtime, fără scrieri.
-- ─────────────────────────────────────────────────────────────────────────────

SET LOCAL lock_timeout = '5s';

-- ── 1. Coloane generate (transformările stau pe tabel, nu în view) ──────────
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS lat_approx numeric GENERATED ALWAYS AS (round(latitude::numeric, 2)) STORED,
  ADD COLUMN IF NOT EXISTS lng_approx numeric GENERATED ALWAYS AS (round(longitude::numeric, 2)) STORED;
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS has_image boolean GENERATED ALWAYS AS (image_path IS NOT NULL) STORED;

-- ── 2. Politici `TO anon` (filtrele de rând) ────────────────────────────────
-- Permisive, se adună cu cele existente doar pentru rolul anon; pentru authenticated nu există.
DROP POLICY IF EXISTS profiles_select_anon ON public.profiles;
CREATE POLICY profiles_select_anon ON public.profiles FOR SELECT TO anon
  USING (deleted_at IS NULL
         AND NOT (banned_at IS NOT NULL AND (banned_until IS NULL OR banned_until > now())));

DROP POLICY IF EXISTS announcements_select_anon ON public.announcements;
CREATE POLICY announcements_select_anon ON public.announcements FOR SELECT TO anon
  USING (status = 'open');

DROP POLICY IF EXISTS announcement_photos_select_anon ON public.announcement_photos;
CREATE POLICY announcement_photos_select_anon ON public.announcement_photos FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.announcements a WHERE a.id = announcement_id AND a.status = 'open'));

DROP POLICY IF EXISTS market_select_anon ON public.market_listings;
CREATE POLICY market_select_anon ON public.market_listings FOR SELECT TO anon
  USING (status = 'active');

DROP POLICY IF EXISTS market_photos_select_anon ON public.market_listing_photos;
CREATE POLICY market_photos_select_anon ON public.market_listing_photos FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.market_listings l WHERE l.id = listing_id AND l.status = 'active'));

DROP POLICY IF EXISTS channels_select_anon ON public.channels;
CREATE POLICY channels_select_anon ON public.channels FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS channel_messages_select_anon ON public.channel_messages;
CREATE POLICY channel_messages_select_anon ON public.channel_messages FOR SELECT TO anon
  USING (deleted_at IS NULL AND created_at > now() - interval '7 days');

DROP POLICY IF EXISTS app_versions_select_anon ON public.app_versions;
CREATE POLICY app_versions_select_anon ON public.app_versions FOR SELECT TO anon
  USING (true);

-- ── 3. Grant-uri pe COLOANE pentru anon (tot ce primește anon din Data API) ──
GRANT SELECT (id, full_name, role, avatar_path, specialization, activity_zone, company_name,
              rating_avg, rating_count, created_at)
  ON public.profiles TO anon;
GRANT SELECT (id, driver_id, description, location, status, created_at,
              truck_make, truck_model, truck_year, lat_approx, lng_approx)
  ON public.announcements TO anon;
GRANT SELECT (id, announcement_id, storage_path, created_at)
  ON public.announcement_photos TO anon;
GRANT SELECT (id, seller_id, title, description, price, currency, category, status, created_at)
  ON public.market_listings TO anon;
GRANT SELECT (id, listing_id, storage_path, position)
  ON public.market_listing_photos TO anon;
GRANT SELECT (id, name, type, created_at)
  ON public.channels TO anon;
GRANT SELECT (id, channel_id, sender_id, content, created_at, reply_to_id, mentions, has_image,
              announcement_id, listing_id, recommended_mechanic_id)
  ON public.channel_messages TO anon;
GRANT SELECT ON public.app_versions TO anon;                 -- doar șiruri de versiune (review B-1)

-- ── 4. View-urile guest_* = proiecții pure, security_invoker ────────────────
CREATE OR REPLACE VIEW public.guest_profiles WITH (security_invoker = true) AS
  SELECT id, full_name, role, avatar_path, specialization, activity_zone, company_name,
         rating_avg, rating_count, created_at
    FROM public.profiles;

CREATE OR REPLACE VIEW public.guest_announcements WITH (security_invoker = true) AS
  SELECT id, driver_id, description, location, status, created_at,
         truck_make, truck_model, truck_year, lat_approx, lng_approx
    FROM public.announcements;

CREATE OR REPLACE VIEW public.guest_announcement_photos WITH (security_invoker = true) AS
  SELECT id, announcement_id, storage_path, created_at
    FROM public.announcement_photos;

CREATE OR REPLACE VIEW public.guest_market_listings WITH (security_invoker = true) AS
  SELECT id, seller_id, title, description, price, currency, category, status, created_at
    FROM public.market_listings;

CREATE OR REPLACE VIEW public.guest_market_listing_photos WITH (security_invoker = true) AS
  SELECT id, listing_id, storage_path, position
    FROM public.market_listing_photos;

CREATE OR REPLACE VIEW public.guest_channels WITH (security_invoker = true) AS
  SELECT id, name, type, created_at
    FROM public.channels;

-- Max 50 de mesaje per canal (fereastra de 7 zile e în politică). Subinterogarea selectează DOAR
-- coloanele acordate; row_number e pe coloane citibile. Clientul citește expeditorii separat din
-- guest_profiles (embedding-ul PostgREST prin view cu subinterogare nu e garantat).
CREATE OR REPLACE VIEW public.guest_channel_messages WITH (security_invoker = true) AS
  SELECT s.id, s.channel_id, s.sender_id, s.content, s.created_at, s.reply_to_id, s.mentions,
         s.has_image, s.announcement_id, s.listing_id, s.recommended_mechanic_id
    FROM (
      SELECT m.id, m.channel_id, m.sender_id, m.content, m.created_at, m.reply_to_id, m.mentions,
             m.has_image, m.announcement_id, m.listing_id, m.recommended_mechanic_id,
             row_number() OVER (PARTITION BY m.channel_id ORDER BY m.created_at DESC) AS rn
        FROM public.channel_messages m
    ) s
   WHERE s.rn <= 50;

GRANT SELECT ON public.guest_profiles              TO anon, authenticated;
GRANT SELECT ON public.guest_announcements         TO anon, authenticated;
GRANT SELECT ON public.guest_announcement_photos   TO anon, authenticated;
GRANT SELECT ON public.guest_market_listings       TO anon, authenticated;
GRANT SELECT ON public.guest_market_listing_photos TO anon, authenticated;
GRANT SELECT ON public.guest_channels              TO anon, authenticated;
GRANT SELECT ON public.guest_channel_messages      TO anon, authenticated;

-- ── 5. RPC-urile de căutare pentru oaspeți (INVOKER peste view-uri; fără blocări — nu are cine) ──
GRANT USAGE ON SCHEMA extensions TO anon;
GRANT EXECUTE ON FUNCTION extensions.unaccent(text) TO anon;

CREATE OR REPLACE FUNCTION public.guest_search_mechanics(p_query text)
RETURNS SETOF public.guest_profiles
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT g.*
    FROM guest_profiles g
   WHERE g.role = 'mechanic'
     AND extensions.unaccent(replace(lower(g.full_name), 'ß', 'ss'))
         LIKE '%' || extensions.unaccent(replace(lower(coalesce(p_query, '')), 'ß', 'ss')) || '%'
   ORDER BY g.full_name
   LIMIT 30;
$$;
REVOKE EXECUTE ON FUNCTION public.guest_search_mechanics(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.guest_search_mechanics(text) TO anon;

CREATE OR REPLACE FUNCTION public.guest_search_market(
  p_query    text,
  p_category text    DEFAULT NULL,
  p_sort     text    DEFAULT 'recent',
  p_limit    integer DEFAULT 30,
  p_offset   integer DEFAULT 0
)
RETURNS SETOF public.guest_market_listings
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
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
$$;
REVOKE EXECUTE ON FUNCTION public.guest_search_market(text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.guest_search_market(text, text, text, integer, integer) TO anon;

-- ── 6. Storage: URL-uri semnate pentru oaspeți (doar citire, doar prefixele publice) ──
-- Subinterogările trec prin politicile anon de la pasul 2 (open / active).
DROP POLICY IF EXISTS photos_select_avatar_anon ON storage.objects;
CREATE POLICY photos_select_avatar_anon ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'photos' AND (storage.foldername(objects.name))[1] = 'avatars');

DROP POLICY IF EXISTS photos_select_market_anon ON storage.objects;
CREATE POLICY photos_select_market_anon ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'photos'
         AND (storage.foldername(objects.name))[1] = 'market'
         AND EXISTS (SELECT 1 FROM public.market_listings l
                      WHERE l.id::text = (storage.foldername(objects.name))[2] AND l.status = 'active'));

DROP POLICY IF EXISTS photos_select_announcement_anon ON storage.objects;
CREATE POLICY photos_select_announcement_anon ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'photos'
         AND (storage.foldername(objects.name))[1] = 'announcements'
         AND EXISTS (SELECT 1 FROM public.announcements a
                      WHERE a.id::text = (storage.foldername(objects.name))[2] AND a.status = 'open'));

-- ── 7. Verificare (eșec = EXCEPTION = nimic nu se aplică) ────────────────────
DO $$
DECLARE
  v_bad text := '';
  v_view text;
  v_tbl  text;
BEGIN
  -- coloanele sensibile rămân închise, cele publice deschise
  IF has_column_privilege('anon', 'public.announcements', 'latitude', 'SELECT')
     OR has_column_privilege('anon', 'public.announcements', 'longitude', 'SELECT')
     OR has_column_privilege('anon', 'public.announcements', 'plate_number', 'SELECT')
     OR has_column_privilege('anon', 'public.announcements', 'chassis_number', 'SELECT')
     OR has_column_privilege('anon', 'public.channel_messages', 'image_path', 'SELECT')
     OR has_column_privilege('anon', 'public.channel_messages', 'file_path', 'SELECT')
     OR has_column_privilege('anon', 'public.profiles', 'phone', 'SELECT')
     OR has_column_privilege('anon', 'public.profiles', 'address', 'SELECT')
     OR has_column_privilege('anon', 'public.profiles', 'vat_number', 'SELECT')
     OR has_column_privilege('anon', 'public.profiles', 'contact_email', 'SELECT')
     OR has_column_privilege('anon', 'public.profiles', 'latitude', 'SELECT') THEN
    v_bad := v_bad || ' [anon vede o coloană sensibilă]';
  END IF;
  IF NOT has_column_privilege('anon', 'public.announcements', 'lat_approx', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.channel_messages', 'has_image', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.profiles', 'full_name', 'SELECT') THEN
    v_bad := v_bad || ' [anon nu vede coloanele publice]';
  END IF;
  -- anon nu are privilegii la nivel de TABEL pe tabelele de bază (doar pe coloane) și nimic pe celelalte
  FOR v_tbl IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'app_versions'
  LOOP
    IF has_table_privilege('anon', 'public.' || quote_ident(v_tbl), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      v_bad := v_bad || format(' [anon are privilegiu de tabel pe %s]', v_tbl);
    END IF;
    IF has_any_column_privilege('anon', 'public.' || quote_ident(v_tbl), 'INSERT')
       OR has_any_column_privilege('anon', 'public.' || quote_ident(v_tbl), 'UPDATE') THEN
      v_bad := v_bad || format(' [anon poate scrie în %s]', v_tbl);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                AND c.relname NOT IN ('profiles', 'announcements', 'announcement_photos', 'market_listings',
                                      'market_listing_photos', 'channels', 'channel_messages', 'app_versions')
                AND has_any_column_privilege('anon', c.oid, 'SELECT')) THEN
    v_bad := v_bad || ' [anon citește un tabel din afara listei]';
  END IF;
  -- view-urile: security_invoker + grant
  FOREACH v_view IN ARRAY ARRAY['guest_profiles', 'guest_announcements', 'guest_announcement_photos',
                                'guest_market_listings', 'guest_market_listing_photos', 'guest_channels',
                                'guest_channel_messages']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = v_view AND c.relkind = 'v'
                      AND 'security_invoker=true' = ANY (coalesce(c.reloptions, '{}'))) THEN
      v_bad := v_bad || format(' [%s lipsește sau nu e security_invoker]', v_view);
    END IF;
    IF NOT has_table_privilege('anon', 'public.' || v_view, 'SELECT') THEN
      v_bad := v_bad || format(' [anon fără SELECT pe %s]', v_view);
    END IF;
  END LOOP;
  -- RPC: anon da, authenticated nu
  IF NOT has_function_privilege('anon', 'public.guest_search_mechanics(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.guest_search_mechanics(text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.guest_search_market(text,text,text,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.guest_search_market(text,text,text,integer,integer)', 'EXECUTE') THEN
    v_bad := v_bad || ' [RPC-urile guest: grant greșit]';
  END IF;
  IF NOT has_function_privilege('anon', 'extensions.unaccent(text)', 'EXECUTE') THEN
    v_bad := v_bad || ' [anon fără unaccent]';
  END IF;
  -- politici anon: 8 în public + 3 în storage
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND roles = ARRAY['anon']::name[]) <> 8 THEN
    v_bad := v_bad || format(' [politici anon în public: %s, așteptam 8]',
                             (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND roles = ARRAY['anon']::name[]));
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND roles = ARRAY['anon']::name[]) <> 3 THEN
    v_bad := v_bad || ' [politici anon în storage ≠ 3]';
  END IF;
  -- nicio politică anon nu apelează helperii DEFINER (revocați pentru anon la A1)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE roles = ARRAY['anon']::name[]
              AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '(is_admin|is_banned|is_block_between|is_conversation_blocked)\(') THEN
    v_bad := v_bad || ' [o politică anon apelează un helper revocat]';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'B1 verificare EȘUATĂ:%', v_bad;
  END IF;
  RAISE NOTICE 'B1 verificare: PASS';
END $$;

-- Testul ca rolul real (în aceeași tranzacție, înainte de COMMIT, Studio îl afișează ca ultim rezultat):
--   SET LOCAL ROLE anon;  SELECT lat_approx FROM announcements LIMIT 1;  → merge, doar `open`
--   SELECT latitude FROM announcements LIMIT 1;  → permission denied  (apoi RESET ROLE)
-- Rezumat. Așteptat: toate PASS.
SELECT 1 AS nr, 'anon: coloane sensibile închise (latitude, phone, image_path…)' AS verificare,
       CASE WHEN NOT has_column_privilege('anon', 'public.announcements', 'latitude', 'SELECT')
                 AND NOT has_column_privilege('anon', 'public.profiles', 'phone', 'SELECT')
                 AND NOT has_column_privilege('anon', 'public.channel_messages', 'image_path', 'SELECT')
            THEN 'PASS' ELSE 'FAIL' END AS stare, '' AS detaliu
UNION ALL
SELECT 2, 'anon: coloane publice deschise (lat_approx, has_image, full_name)',
       CASE WHEN has_column_privilege('anon', 'public.announcements', 'lat_approx', 'SELECT')
                 AND has_column_privilege('anon', 'public.channel_messages', 'has_image', 'SELECT')
                 AND has_column_privilege('anon', 'public.profiles', 'full_name', 'SELECT')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 3, 'view-uri guest_* (7) cu security_invoker și SELECT pentru anon',
       CASE WHEN count(*) = 7 THEN 'PASS' ELSE 'FAIL' END, count(*)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'guest\_%'
   AND 'security_invoker=true' = ANY (coalesce(c.reloptions, '{}'))
   AND has_table_privilege('anon', c.oid, 'SELECT')
UNION ALL
SELECT 4, 'politici anon: 8 în public, 3 în storage',
       CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND roles = ARRAY['anon']::name[]) = 8
                 AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND roles = ARRAY['anon']::name[]) = 3
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 5, 'RPC guest_search_mechanics / guest_search_market: doar anon',
       CASE WHEN has_function_privilege('anon', 'public.guest_search_mechanics(text)', 'EXECUTE')
                 AND NOT has_function_privilege('authenticated', 'public.guest_search_mechanics(text)', 'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 6, 'anon: niciun privilegiu de scriere nicăieri',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, count(*)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v')
   AND (has_any_column_privilege('anon', c.oid, 'INSERT') OR has_any_column_privilege('anon', c.oid, 'UPDATE')
        OR has_table_privilege('anon', c.oid, 'DELETE'))
ORDER BY nr;
