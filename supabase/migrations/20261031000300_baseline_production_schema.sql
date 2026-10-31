-- Baseline-ul schemei de producție TruckSOS (pasul 0.3-bis din PLAN_1.1_FIX, 29 oct 2026).
-- Generat din catalogul bazei de date cu scripts/baseline-generate.mjs (din supabase/baseline/catalog.sql),
-- după aplicarea migrării 20261031000200. Înlocuiește cele 92 de migrări istorice (iulie–octombrie 2026),
-- mutate în supabase/migrations-archive/: schema inițială (faza 1, iulie) fusese creată din Studio și
-- nu exista ca migrare, deci istoricul nu putea fi aplicat de la zero (CI run 40853794809).
--
-- NU se aplică pe producție: acolo e marcat `applied` prin `migration repair` (schema există deja).
-- Rulează doar pe un Postgres Supabase gol (`supabase start` în CI); supabase/baseline/parity.sql
-- verifică acolo că rezultatul e identic cu producția (parity.expected.txt).
--
-- Conținut: 30 tabele, 6 view-uri, 2 secvențe, 94 funcții, 149 constrângeri,
-- 38 indexuri, 38 triggere, 92 politici (public + storage), 1 bucket, 5 tabele în publicația Realtime, 5 joburi cron.

-- Ca pg_dump: corpurile funcțiilor nu se validează la creare (pot referi obiecte create mai jos).
SET check_function_bodies = off;

-- ─── Extensii ──────────────────────────────────────────────────────────────────────────────────

-- pg_graphql nu e instalat în producție (checklist 14); `supabase start` îl pornește implicit, iar CI-ul îl
-- scoate într-un pas separat, ca supabase_admin (nu e o migrare: e o setare de platformă).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ─── Scheme ────────────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app TO anon;
GRANT USAGE ON SCHEMA app TO authenticated;
GRANT USAGE ON SCHEMA app TO service_role;
REVOKE CREATE ON SCHEMA public FROM anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ─── Drepturi implicite pentru obiectele create de postgres ────────────────────────────────────

-- Fiecare combinație (schemă, tip) e adusă întâi la valoarea implicită a Postgres, apoi la cea din producție.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ─── Secvențe ──────────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE app.rate_events_id_seq AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1 NO CYCLE;

-- ─── Tabele ────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.rate_events (
  id bigint DEFAULT nextval('app.rate_events_id_seq'::regclass) NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.admin_audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  admin_id uuid NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  details jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.announcement_photos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  announcement_id uuid NOT NULL,
  storage_path text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.announcement_translations (
  announcement_id uuid NOT NULL,
  lang text NOT NULL,
  source_lang text NOT NULL,
  text text NOT NULL,
  provider text DEFAULT 'google-translate-v2'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.announcement_views (
  announcement_id uuid NOT NULL,
  viewer_id uuid NOT NULL,
  viewed_at timestamp with time zone DEFAULT now() NOT NULL
);
COMMENT ON TABLE public.announcement_views IS 'Cine a deschis detaliul unui anunț (unic per utilizator; fără autor și admini). Citire doar admin (24 sept 2026).';

CREATE TABLE public.announcements (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  driver_id uuid NOT NULL,
  description text NOT NULL,
  location text NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  mechanic_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  truck_make text,
  truck_model text,
  truck_year smallint,
  plate_number text,
  latitude double precision,
  longitude double precision,
  hidden_from_history boolean DEFAULT false NOT NULL,
  chassis_number text,
  lat_approx numeric GENERATED ALWAYS AS (round((latitude)::numeric, 2)) STORED,
  lng_approx numeric GENERATED ALWAYS AS (round((longitude)::numeric, 2)) STORED,
  source_lang text,
  source_lang_detected boolean DEFAULT false NOT NULL
);

CREATE TABLE public.app_versions (
  platform text NOT NULL,
  latest_version text NOT NULL,
  store_url text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
COMMENT ON TABLE public.app_versions IS 'Versiunea live per platformă; aplicația recomandă update-ul dacă e mai veche (17 sept 2026).';

CREATE TABLE public.applications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  announcement_id uuid NOT NULL,
  mechanic_id uuid NOT NULL,
  price_type text NOT NULL,
  price_amount numeric(10,2) NOT NULL,
  currency text DEFAULT 'RON'::text NOT NULL,
  message text,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.blocked_users (
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.channel_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  channel_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  image_path text,
  deleted_at timestamp with time zone,
  edited_at timestamp with time zone,
  reply_to_id uuid,
  deleted_by_admin boolean DEFAULT false NOT NULL,
  listing_id uuid,
  recommended_mechanic_id uuid,
  file_path text,
  file_name text,
  file_size integer,
  announcement_id uuid,
  file_duration integer,
  mentions jsonb,
  has_image boolean GENERATED ALWAYS AS ((image_path IS NOT NULL)) STORED
);
COMMENT ON COLUMN public.channel_messages.mentions IS 'Menționări „@Nume" (10 sept 2026): array JSON de {id, name}; textul rămâne simplu în content.';

CREATE TABLE public.channel_push_prefs (
  user_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.channel_push_state (
  user_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  last_pushed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.channel_reads (
  channel_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_read_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.channels (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.client_diagnostics (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
  kind text NOT NULL,
  diagnosis text NOT NULL,
  error_message text,
  probes jsonb DEFAULT '{}'::jsonb NOT NULL,
  network jsonb,
  clock_drift_ms integer,
  platform text,
  os_version text,
  device_model text,
  app_version text,
  locale text
);

CREATE TABLE public.conversation_deletions (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  deleted_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  announcement_id uuid,
  driver_id uuid NOT NULL,
  mechanic_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  is_direct boolean DEFAULT false NOT NULL,
  listing_id uuid
);

CREATE TABLE public.direct_push_state (
  user_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  window_start timestamp with time zone DEFAULT now() NOT NULL,
  count_in_window integer DEFAULT 1 NOT NULL,
  last_pushed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.favorite_mechanics (
  driver_id uuid NOT NULL,
  mechanic_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.market_listing_photos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  listing_id uuid NOT NULL,
  storage_path text NOT NULL,
  position smallint DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.market_listings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  seller_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  price numeric(12,2) NOT NULL,
  currency text DEFAULT 'EUR'::text NOT NULL,
  category text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.message_reads (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_read_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  image_path text,
  deleted_at timestamp with time zone,
  edited_at timestamp with time zone,
  reply_to_id uuid,
  deleted_by_admin boolean DEFAULT false NOT NULL,
  listing_id uuid,
  recommended_mechanic_id uuid,
  file_path text,
  file_name text,
  file_size integer,
  announcement_id uuid,
  file_duration integer,
  mentions jsonb
);
COMMENT ON COLUMN public.messages.mentions IS 'Menționări „@Nume" (10 sept 2026): array JSON de {id, name}; textul rămâne simplu în content.';

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  specialization text,
  activity_zone text,
  phone text,
  rating_avg numeric(2,1) DEFAULT 0 NOT NULL,
  rating_count integer DEFAULT 0 NOT NULL,
  avatar_path text,
  push_enabled boolean DEFAULT true NOT NULL,
  notify_radius_km integer,
  latitude double precision,
  longitude double precision,
  lang text DEFAULT 'ro'::text NOT NULL,
  deleted_at timestamp with time zone,
  company_name text,
  contact_email text,
  banned_at timestamp with time zone,
  banned_until timestamp with time zone,
  ban_reason text,
  address text,
  vat_number text,
  market_push_enabled boolean DEFAULT true NOT NULL,
  mention_push_enabled boolean DEFAULT true NOT NULL
);
COMMENT ON COLUMN public.profiles.market_push_enabled IS 'Setări → Notificări: anunțuri noi pe Market. Independent de push_enabled (comutatorul global îl domină).';

CREATE TABLE public.push_tokens (
  token text NOT NULL,
  user_id uuid NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  platform text,
  device_token text,
  app_build text
);

CREATE TABLE public.ratings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  mechanic_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  stars smallint NOT NULL,
  comment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  reporter_id uuid NOT NULL,
  reported_user_id uuid NOT NULL,
  message_id uuid,
  message_table text,
  reason text NOT NULL,
  details text,
  content_snapshot text,
  image_path_snapshot text,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  listing_id uuid
);

CREATE TABLE public.search_history (
  driver_id uuid NOT NULL,
  mechanic_id uuid NOT NULL,
  searched_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.translation_requests (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  requested_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.trucks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  driver_id uuid NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  year smallint NOT NULL,
  nickname text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  plate_number text,
  chassis_number text
);

ALTER SEQUENCE app.rate_events_id_seq OWNED BY app.rate_events.id;

-- ─── Constrângeri (cheie primară, unicitate, CHECK) ────────────────────────────────────────────

ALTER TABLE ONLY app.rate_events ADD CONSTRAINT rate_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.admin_audit_log ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.announcement_photos ADD CONSTRAINT announcement_photos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.announcement_translations ADD CONSTRAINT announcement_translations_pkey PRIMARY KEY (announcement_id, lang);
ALTER TABLE ONLY public.announcement_translations ADD CONSTRAINT announcement_translations_lang_check CHECK (lang = ANY (ARRAY['ro'::text, 'en'::text, 'de'::text]));
ALTER TABLE ONLY public.announcement_views ADD CONSTRAINT announcement_views_pkey PRIMARY KEY (announcement_id, viewer_id);
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_chassis_number_len CHECK (char_length(chassis_number) <= 30);
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_coords_both CHECK ((latitude IS NULL) = (longitude IS NULL));
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_coords_range CHECK ((latitude IS NULL OR latitude >= '-90'::integer::double precision AND latitude <= 90::double precision) AND (longitude IS NULL OR longitude >= '-180'::integer::double precision AND longitude <= 180::double precision));
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_description_len CHECK (char_length(description) <= 4000);
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_location_len CHECK (char_length(location) <= 300);
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_plate_number_len CHECK (char_length(plate_number) <= 20);
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_status_check CHECK (status = ANY (ARRAY['open'::text, 'accepted'::text, 'resolved'::text, 'cancelled'::text]));
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_truck_make_len CHECK (char_length(truck_make) <= 80);
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_truck_model_len CHECK (char_length(truck_model) <= 80);
ALTER TABLE ONLY public.app_versions ADD CONSTRAINT app_versions_pkey PRIMARY KEY (platform);
ALTER TABLE ONLY public.app_versions ADD CONSTRAINT app_versions_latest_version_check CHECK (latest_version ~ '^\d+(\.\d+){1,3}$'::text);
ALTER TABLE ONLY public.app_versions ADD CONSTRAINT app_versions_platform_check CHECK (platform = ANY (ARRAY['android'::text, 'ios'::text]));
ALTER TABLE ONLY public.app_versions ADD CONSTRAINT app_versions_store_url_https CHECK (store_url IS NULL OR store_url ~ '^https://'::text);
ALTER TABLE ONLY public.applications ADD CONSTRAINT applications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.applications ADD CONSTRAINT applications_announcement_id_mechanic_id_key UNIQUE (announcement_id, mechanic_id);
ALTER TABLE ONLY public.applications ADD CONSTRAINT applications_message_len CHECK (char_length(message) <= 2000);
ALTER TABLE ONLY public.applications ADD CONSTRAINT applications_price_amount_check CHECK (price_amount > 0::numeric);
ALTER TABLE ONLY public.applications ADD CONSTRAINT applications_price_type_check CHECK (price_type = ANY (ARRAY['fixed'::text, 'hourly'::text]));
ALTER TABLE ONLY public.applications ADD CONSTRAINT applications_status_check CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text]));
ALTER TABLE ONLY public.blocked_users ADD CONSTRAINT blocked_users_pkey PRIMARY KEY (blocker_id, blocked_id);
ALTER TABLE ONLY public.blocked_users ADD CONSTRAINT blocked_users_check CHECK (blocker_id <> blocked_id);
ALTER TABLE ONLY public.channel_messages ADD CONSTRAINT channel_messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.channel_messages ADD CONSTRAINT channel_messages_content_len CHECK (char_length(content) <= 4000);
ALTER TABLE ONLY public.channel_messages ADD CONSTRAINT channel_messages_mentions_is_array CHECK (mentions IS NULL OR jsonb_typeof(mentions) = 'array'::text);
ALTER TABLE ONLY public.channel_messages ADD CONSTRAINT channel_messages_text_or_image CHECK (deleted_at IS NOT NULL OR content <> ''::text OR image_path IS NOT NULL OR file_path IS NOT NULL OR listing_id IS NOT NULL OR recommended_mechanic_id IS NOT NULL OR announcement_id IS NOT NULL);
ALTER TABLE ONLY public.channel_push_prefs ADD CONSTRAINT channel_push_prefs_pkey PRIMARY KEY (user_id, channel_id);
ALTER TABLE ONLY public.channel_push_state ADD CONSTRAINT channel_push_state_pkey PRIMARY KEY (user_id, channel_id);
ALTER TABLE ONLY public.channel_reads ADD CONSTRAINT channel_reads_pkey PRIMARY KEY (channel_id, user_id);
ALTER TABLE ONLY public.channels ADD CONSTRAINT channels_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.channels ADD CONSTRAINT channels_type_check CHECK (type = ANY (ARRAY['global'::text, 'regional'::text]));
ALTER TABLE ONLY public.client_diagnostics ADD CONSTRAINT client_diagnostics_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.client_diagnostics ADD CONSTRAINT client_diagnostics_app_version_check CHECK (length(app_version) <= 20);
ALTER TABLE ONLY public.client_diagnostics ADD CONSTRAINT client_diagnostics_device_model_check CHECK (length(device_model) <= 80);
ALTER TABLE ONLY public.client_diagnostics ADD CONSTRAINT client_diagnostics_diagnosis_check CHECK (length(diagnosis) <= 20);
ALTER TABLE ONLY public.client_diagnostics ADD CONSTRAINT client_diagnostics_error_message_check CHECK (length(error_message) <= 500);
ALTER TABLE ONLY public.client_diagnostics ADD CONSTRAINT client_diagnostics_kind_check CHECK (length(kind) <= 40);
ALTER TABLE ONLY public.client_diagnostics ADD CONSTRAINT client_diagnostics_locale_check CHECK (length(locale) <= 10);
ALTER TABLE ONLY public.client_diagnostics ADD CONSTRAINT client_diagnostics_os_version_check CHECK (length(os_version) <= 40);
ALTER TABLE ONLY public.client_diagnostics ADD CONSTRAINT client_diagnostics_platform_check CHECK (length(platform) <= 16);
ALTER TABLE ONLY public.conversation_deletions ADD CONSTRAINT conversation_deletions_pkey PRIMARY KEY (conversation_id, user_id);
ALTER TABLE ONLY public.conversations ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.conversations ADD CONSTRAINT conversations_announcement_id_key UNIQUE (announcement_id);
ALTER TABLE ONLY public.direct_push_state ADD CONSTRAINT direct_push_state_pkey PRIMARY KEY (user_id, sender_id);
ALTER TABLE ONLY public.favorite_mechanics ADD CONSTRAINT favorite_mechanics_pkey PRIMARY KEY (driver_id, mechanic_id);
ALTER TABLE ONLY public.market_listing_photos ADD CONSTRAINT market_listing_photos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.market_listings ADD CONSTRAINT market_listings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.market_listings ADD CONSTRAINT market_listings_category_check CHECK (category = ANY (ARRAY['tires'::text, 'parts'::text, 'trucks'::text, 'trailers'::text, 'accessories'::text, 'other'::text]));
ALTER TABLE ONLY public.market_listings ADD CONSTRAINT market_listings_currency_check CHECK (currency = ANY (ARRAY['RON'::text, 'EUR'::text]));
ALTER TABLE ONLY public.market_listings ADD CONSTRAINT market_listings_description_check CHECK (char_length(description) <= 4000);
ALTER TABLE ONLY public.market_listings ADD CONSTRAINT market_listings_description_len CHECK (char_length(description) <= 4000);
ALTER TABLE ONLY public.market_listings ADD CONSTRAINT market_listings_price_check CHECK (price > 0::numeric);
ALTER TABLE ONLY public.market_listings ADD CONSTRAINT market_listings_status_check CHECK (status = ANY (ARRAY['active'::text, 'sold'::text]));
ALTER TABLE ONLY public.market_listings ADD CONSTRAINT market_listings_title_check CHECK (char_length(title) >= 3 AND char_length(title) <= 80);
ALTER TABLE ONLY public.market_listings ADD CONSTRAINT market_listings_title_len CHECK (char_length(title) <= 120);
ALTER TABLE ONLY public.message_reads ADD CONSTRAINT message_reads_pkey PRIMARY KEY (conversation_id, user_id);
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_content_len CHECK (char_length(content) <= 4000);
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_mentions_is_array CHECK (mentions IS NULL OR jsonb_typeof(mentions) = 'array'::text);
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_text_or_image CHECK (deleted_at IS NOT NULL OR content <> ''::text OR image_path IS NOT NULL OR file_path IS NOT NULL OR listing_id IS NOT NULL OR recommended_mechanic_id IS NOT NULL OR announcement_id IS NOT NULL);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_activity_zone_len CHECK (char_length(activity_zone) <= 300);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_address_len CHECK (char_length(address) <= 300);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_company_name_len CHECK (char_length(company_name) <= 120);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_contact_email_len CHECK (char_length(contact_email) <= 254);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_full_name_len CHECK (char_length(full_name) <= 120);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_phone_len CHECK (char_length(phone) <= 32);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_role_check CHECK (role = ANY (ARRAY['driver'::text, 'mechanic'::text, 'admin'::text]));
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_specialization_len CHECK (char_length(specialization) <= 1000);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_vat_number_len CHECK (char_length(vat_number) <= 32);
ALTER TABLE ONLY public.push_tokens ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (token);
ALTER TABLE ONLY public.push_tokens ADD CONSTRAINT push_tokens_platform_check CHECK (platform IS NULL OR (platform = ANY (ARRAY['ios'::text, 'android'::text])));
ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_mechanic_id_driver_id_key UNIQUE (mechanic_id, driver_id);
ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_comment_len CHECK (char_length(comment) <= 1000);
ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_stars_check CHECK (stars >= 1 AND stars <= 5);
ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_details_len CHECK (char_length(details) <= 2000);
ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_message_table_check CHECK (message_table = ANY (ARRAY['messages'::text, 'channel_messages'::text]));
ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_reason_check CHECK (reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'inappropriate'::text, 'scam'::text, 'other'::text]));
ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_status_check CHECK (status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'dismissed'::text]));
ALTER TABLE ONLY public.search_history ADD CONSTRAINT search_history_pkey PRIMARY KEY (driver_id, mechanic_id);
ALTER TABLE ONLY public.translation_requests ADD CONSTRAINT translation_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.trucks ADD CONSTRAINT trucks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.trucks ADD CONSTRAINT trucks_chassis_number_len CHECK (char_length(chassis_number) <= 30);
ALTER TABLE ONLY public.trucks ADD CONSTRAINT trucks_make_len CHECK (char_length(make) <= 80);
ALTER TABLE ONLY public.trucks ADD CONSTRAINT trucks_model_len CHECK (char_length(model) <= 80);
ALTER TABLE ONLY public.trucks ADD CONSTRAINT trucks_nickname_len CHECK (char_length(nickname) <= 80);
ALTER TABLE ONLY public.trucks ADD CONSTRAINT trucks_plate_number_len CHECK (char_length(plate_number) <= 20);

-- ─── View-uri ──────────────────────────────────────────────────────────────────────────────────

CREATE VIEW public.guest_announcements WITH (security_invoker=true) AS
 SELECT id,
    driver_id,
    description,
    location,
    status,
    created_at,
    truck_make,
    truck_model,
    truck_year,
    lat_approx,
    lng_approx
   FROM public.announcements;

CREATE VIEW public.guest_channel_messages WITH (security_invoker=true) AS
 SELECT id,
    channel_id,
    sender_id,
    content,
    created_at,
    reply_to_id,
    mentions,
    has_image,
    announcement_id,
    listing_id,
    recommended_mechanic_id
   FROM ( SELECT m.id,
            m.channel_id,
            m.sender_id,
            m.content,
            m.created_at,
            m.reply_to_id,
            m.mentions,
            m.has_image,
            m.announcement_id,
            m.listing_id,
            m.recommended_mechanic_id,
            row_number() OVER (PARTITION BY m.channel_id ORDER BY m.created_at DESC) AS rn
           FROM public.channel_messages m) s
  WHERE rn <= 50;

CREATE VIEW public.guest_channels WITH (security_invoker=true) AS
 SELECT id,
    name,
    type,
    created_at
   FROM public.channels;

CREATE VIEW public.guest_market_listing_photos WITH (security_invoker=true) AS
 SELECT id,
    listing_id,
    storage_path,
    "position"
   FROM public.market_listing_photos;

CREATE VIEW public.guest_market_listings WITH (security_invoker=true) AS
 SELECT id,
    seller_id,
    title,
    description,
    price,
    currency,
    category,
    status,
    created_at
   FROM public.market_listings;

CREATE VIEW public.guest_profiles WITH (security_invoker=true) AS
 SELECT id,
    full_name,
    role,
    avatar_path,
    specialization,
    activity_zone,
    company_name,
    rating_avg,
    rating_count,
    created_at
   FROM public.profiles;


-- ─── Funcții (public + app; trigger-ele și RPC-urile) ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.like_escape(p_query text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  SELECT replace(replace(replace(left(p_query, 100), '\', '\\'), '%', '\%'), '_', '\_');
$function$;

CREATE OR REPLACE FUNCTION app.limit_announcements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  -- UPDATE: contează doar redeschiderea (repost_announcement). INSERT: întotdeauna — garda
  -- announcements_guard_client forțează oricum status = 'open' pentru orice INSERT de client.
  IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM 'open' OR OLD.status = 'open') THEN RETURN NEW; END IF;
  -- Cel mult 5 deschise simultan (29 oct 2026; era 3 în 20261031000100).
  IF (SELECT count(*) FROM public.announcements WHERE driver_id = auth.uid() AND status = 'open' AND id <> NEW.id) >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements_open';
  END IF;
  IF NOT app.rate_limit_ok('announcement_day', interval '24 hours', 10)
     OR NOT app.rate_limit_ok('announcement_week', interval '7 days', 30) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION app.limit_channel_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NOT app.rate_limit_ok('channel_minute', interval '1 minute', 15)
     OR NOT app.rate_limit_ok('channel_hour', interval '1 hour', 300) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'channel_messages';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION app.limit_market_listings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NOT app.rate_limit_ok('listing_day', interval '24 hours', 10) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'market_listings';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION app.limit_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NOT app.rate_limit_ok('message_minute', interval '1 minute', 120)
     OR NOT app.rate_limit_ok('message_conv_' || NEW.conversation_id::text, interval '1 minute', 30) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'messages';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION app.limit_reports()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NOT app.rate_limit_ok('report_day', interval '24 hours', 20) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'reports';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION app.rate_limit_ok(p_kind text, p_window interval, p_max integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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

CREATE OR REPLACE FUNCTION app.search_norm(p_text text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT extensions.unaccent('extensions.unaccent'::regdictionary, replace(lower(coalesce(p_text, '')), 'ß', 'ss'));
$function$;

CREATE OR REPLACE FUNCTION app.storage_quota_ok()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND (SELECT count(*) FROM storage.objects
           WHERE owner_id = auth.uid()::text AND created_at > now() - interval '24 hours') < 60
     AND (SELECT count(*) FROM storage.objects WHERE owner_id = auth.uid()::text) < 1500;
$function$;

CREATE OR REPLACE FUNCTION app.uuid_or_null(p_text text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN p_text::uuid ELSE NULL END;
$function$;

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
  -- ── Idempotență: dacă profilul nu există sau e deja piatră-funerară, nu facem nimic ──
  SELECT deleted_at INTO v_deleted FROM profiles WHERE id = p_uid;
  IF NOT FOUND OR v_deleted IS NOT NULL THEN
    RETURN '{}';
  END IF;

  -- ── PASUL 0: colectăm căile Storage ÎNAINTE de orice DELETE/UPDATE ──
  -- a) avatarul propriu
  SELECT avatar_path INTO v_avatar FROM profiles WHERE id = p_uid;
  IF v_avatar IS NOT NULL THEN
    v_paths := v_paths || v_avatar;
  END IF;

  -- b) pozele anunțurilor lui de depanare
  SELECT COALESCE(array_agg(ap.storage_path), '{}')
  INTO v_ann
  FROM announcement_photos ap
  JOIN announcements a ON a.id = ap.announcement_id
  WHERE a.driver_id = p_uid;
  v_paths := v_paths || v_ann;

  -- c) pozele lui din chat privat — DOAR cele care NU sunt dovadă într-un raport `pending`
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

  -- d) pozele lui din canale — același tratament + guard de dovadă
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

  -- e) FAZA 19: pozele anunțurilor lui de MARKET (rândurile cascadează cu anunțul,
  --    obiectele Storage nu — identic cu pozele de depanare)
  SELECT COALESCE(array_agg(mp.storage_path), '{}')
  INTO v_market
  FROM market_listing_photos mp
  JOIN market_listings l ON l.id = mp.listing_id
  WHERE l.seller_id = p_uid;
  v_paths := v_paths || v_market;

  -- f) FAZA 19.5: fișierele lui din chat privat + canale (guard de dovadă identic)
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

  -- ── PASUL 1: tombstone pentru mesajele-poză ȘI mesajele-fișier ale lui ──
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

  -- ── PASUL 2: ȘTERGERI explicite ──
  DELETE FROM announcements       WHERE driver_id   = p_uid;
  -- FAZA 19: anunțurile de market (cascade market_listing_photos; conversations.listing_id
  -- → SET NULL — conversațiile SUPRAVIEȚUIESC, ca la anunțurile de depanare; rapoartele pe
  -- anunțuri rămân ANONIMIZATE prin piatra-funerară + snapshot).
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

  -- ── PASUL 3: scrub PII pe profil → piatră-funerară ──
  -- 25 oct 2026 (A1): + address / vat_number / company_name / contact_email — rămâneau
  -- pe piatra funerară și erau citibile de orice cont logat (profiles_select_all).
  UPDATE profiles SET
    full_name      = '',
    avatar_path    = NULL,
    phone          = NULL,
    specialization = NULL,
    activity_zone  = NULL,
    latitude       = NULL,
    longitude      = NULL,
    address        = NULL,
    vat_number     = NULL,
    company_name   = NULL,
    contact_email  = NULL,
    push_enabled   = false,
    deleted_at     = now()
  WHERE id = p_uid;

  RETURN v_paths;
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_announcement(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid;
  v_mechanic_id uuid := auth.uid();
BEGIN
  SELECT driver_id INTO v_driver_id
  FROM announcements
  WHERE id = p_announcement_id AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  IF is_block_between(v_driver_id, v_mechanic_id) THEN
    RAISE EXCEPTION 'Announcement not available';   -- identic — nedetectabil
  END IF;

  UPDATE announcements
  SET status = 'accepted', mechanic_id = v_mechanic_id, updated_at = now()
  WHERE id = p_announcement_id;

  INSERT INTO conversations (announcement_id, driver_id, mechanic_id)
  VALUES (p_announcement_id, v_driver_id, v_mechanic_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_application(p_application_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_announcement_id UUID;
  v_mechanic_id     UUID;
  v_driver_id       UUID;
  v_conv_id         UUID;
BEGIN
  SELECT a.announcement_id, a.mechanic_id, ann.driver_id
  INTO v_announcement_id, v_mechanic_id, v_driver_id
  FROM applications a
  JOIN announcements ann ON ann.id = a.announcement_id
  WHERE a.id = p_application_id
    AND ann.driver_id = auth.uid()
    AND a.status = 'pending'
    AND ann.status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_found_or_unauthorized';
  END IF;

  -- Respinge toate celelalte candidaturi pentru același anunț
  UPDATE applications
  SET status = 'rejected'
  WHERE announcement_id = v_announcement_id
    AND id != p_application_id;

  -- Acceptă candidatura aleasă
  UPDATE applications
  SET status = 'accepted'
  WHERE id = p_application_id;

  -- Actualizează anunțul
  UPDATE announcements
  SET status = 'accepted', mechanic_id = v_mechanic_id, updated_at = now()
  WHERE id = v_announcement_id;

  -- Creează conversația
  INSERT INTO conversations(announcement_id, driver_id, mechanic_id)
  VALUES (v_announcement_id, v_driver_id, v_mechanic_id)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_target_role text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT role INTO v_target_role FROM profiles WHERE id = p_uid;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF v_target_role = 'admin' THEN RAISE EXCEPTION 'cannot_ban_admin'; END IF;

  UPDATE profiles
     SET banned_at    = now(),
         banned_until = p_until,
         ban_reason   = p_reason
   WHERE id = p_uid;

  DELETE FROM push_tokens WHERE user_id = p_uid;   -- igienÄƒ: dispozitivele curente nu mai primesc

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ban_user', 'user', p_uid,
          jsonb_build_object('reason', p_reason, 'until', p_until));
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_delete_announcement(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_driver uuid; r record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT driver_id INTO v_driver FROM announcements WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  FOR r IN SELECT storage_path FROM announcement_photos WHERE announcement_id = p_id LOOP
    PERFORM storage_api_delete('photos', r.storage_path);
  END LOOP;

  UPDATE applications SET status = 'rejected' WHERE announcement_id = p_id AND status = 'pending';

  DELETE FROM announcements WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_announcement', 'announcement', p_id, jsonb_build_object('driver_id', v_driver));
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_delete_listing(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_seller uuid; r record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT seller_id INTO v_seller FROM market_listings WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  FOR r IN SELECT storage_path FROM market_listing_photos WHERE listing_id = p_id LOOP
    PERFORM storage_api_delete('photos', r.storage_path);
  END LOOP;

  DELETE FROM market_listings WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_listing', 'listing', p_id, jsonb_build_object('seller_id', v_seller));
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_delete_message(p_table text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_old_path text; v_old_file text; v_sender uuid;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  IF p_table = 'messages' THEN
    SELECT image_path, file_path, sender_id INTO v_old_path, v_old_file, v_sender
      FROM messages WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
    UPDATE messages
       SET content = '', image_path = NULL,
           file_path = NULL, file_name = NULL, file_size = NULL,
           deleted_at = now(), deleted_by_admin = true
     WHERE id = p_id;
  ELSIF p_table = 'channel_messages' THEN
    SELECT image_path, file_path, sender_id INTO v_old_path, v_old_file, v_sender
      FROM channel_messages WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
    UPDATE channel_messages
       SET content = '', image_path = NULL,
           file_path = NULL, file_name = NULL, file_size = NULL,
           deleted_at = now(), deleted_by_admin = true
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;

  PERFORM storage_api_delete('photos', v_old_path);
  PERFORM storage_api_delete('photos', v_old_file);

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_message', 'message', p_id,
          jsonb_build_object('table', p_table, 'sender_id', v_sender,
                             'had_image', v_old_path IS NOT NULL,
                             'had_file', v_old_file IS NOT NULL));
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_delete_review(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_mechanic uuid;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT mechanic_id INTO v_mechanic FROM ratings WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  DELETE FROM ratings WHERE id = p_id;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_review', 'review', p_id, jsonb_build_object('mechanic_id', v_mechanic));
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_list_channel_messages(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT cm.id, cm.content, cm.image_path, cm.deleted_at, cm.deleted_by_admin, cm.created_at,
           cm.sender_id, s.full_name AS sender_name
    FROM channel_messages cm
    LEFT JOIN profiles s ON s.id = cm.sender_id
    ORDER BY cm.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_list_recent_announcements(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_list_recent_listings(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT l.id, l.title, l.description, l.price, l.currency, l.category, l.status,
           l.created_at, l.seller_id, s.full_name AS seller_name,
           (SELECT count(*) FROM market_listing_photos mp WHERE mp.listing_id = l.id) AS photo_count
    FROM market_listings l
    LEFT JOIN profiles s ON s.id = l.seller_id
    ORDER BY l.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_list_recent_reviews(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT r.id, r.stars, r.comment, r.created_at,
           r.mechanic_id, m.full_name AS mechanic_name,
           r.driver_id,   d.full_name AS driver_name
    FROM ratings r
    LEFT JOIN profiles m ON m.id = r.mechanic_id
    LEFT JOIN profiles d ON d.id = r.driver_id
    WHERE r.comment IS NOT NULL AND r.comment <> ''
    ORDER BY r.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_list_reports(p_status text DEFAULT 'pending'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT r.id, r.reason, r.details, r.content_snapshot, r.image_path_snapshot,
           r.message_id, r.message_table, r.status, r.created_at,
           r.listing_id, l.title AS listing_title,
           r.reporter_id, rep.full_name AS reporter_name,
           r.reported_user_id, tgt.full_name AS reported_name, tgt.banned_at AS reported_banned_at
    FROM reports r
    LEFT JOIN profiles rep ON rep.id = r.reporter_id
    LEFT JOIN profiles tgt ON tgt.id = r.reported_user_id
    LEFT JOIN market_listings l ON l.id = r.listing_id
    WHERE (p_status = 'all' OR r.status = p_status)
    ORDER BY r.created_at DESC
    LIMIT 200
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_pending_reports_count()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT count(*) INTO v_count FROM reports WHERE status = 'pending';
  RETURN v_count;
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_purge_accounts(p_from timestamp with time zone, p_to timestamp with time zone, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_accounts jsonb;
  v_count integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF NOT p_dry_run THEN
    -- Faza 11 (is_admin cu aal2) activează ștergerea; până atunci funcția nu șterge nimic.
    RAISE EXCEPTION 'purge_disabled_until_phase_11';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '31 days'
     OR p_to > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'bad_interval';
  END IF;
  SELECT count(*), coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'email', c.email,
           'role', c.role,
           'provider', c.provider,
           'created_at', c.created_at,
           'last_sign_in_at', c.last_sign_in_at,
           'email_confirmed', c.email_confirmed,
           'criterion', CASE
             WHEN c.role IS NULL THEN 'fara_profil'
             WHEN NOT c.email_confirmed THEN 'email_neconfirmat'
             WHEN c.last_sign_in_at IS NULL OR c.last_sign_in_at < c.created_at + interval '1 minute' THEN 'nelogat_dupa_inscriere'
             ELSE 'profil_gol_fara_activitate' END
         ) ORDER BY c.created_at), '[]'::jsonb)
    INTO v_count, v_accounts
    FROM (
      SELECT u.id, u.email, u.created_at, u.last_sign_in_at,
             (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
             (SELECT p.role FROM public.profiles p WHERE p.id = u.id) AS role,
             (SELECT string_agg(i.provider, ',') FROM auth.identities i WHERE i.user_id = u.id) AS provider
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
         AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.owner_id = u.id::text)
    ) c;
  RETURN jsonb_build_object('dry_run', true, 'count', v_count, 'accounts', v_accounts);
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_report_context(p_table text, p_message_id uuid, p_before integer DEFAULT 25, p_after integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Cap 50: limita reală de confidențialitate rămâne principiul „doar conversația
  -- raportată + audit"; capul previne doar transformarea RPC-ului într-un
  -- exfiltrator de conversații întregi dintr-un singur apel.
  v_before_n integer := LEAST(GREATEST(coalesce(p_before, 25), 0), 50);
  v_after_n  integer := LEAST(GREATEST(coalesce(p_after, 25), 0), 50);
  v_created timestamptz;
  v_scope   uuid;         -- conversation_id sau channel_id
  v_before  jsonb;
  v_after   jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM reports WHERE message_id = p_message_id AND message_table = p_table
  ) THEN
    RAISE EXCEPTION 'no_report_for_message';
  END IF;

  IF p_table = 'messages' THEN
    SELECT conversation_id, created_at INTO v_scope, v_created FROM messages WHERE id = p_message_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

    SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at) INTO v_before FROM (
      SELECT id, sender_id, content, image_path, deleted_at, deleted_by_admin, created_at
      FROM messages WHERE conversation_id = v_scope AND created_at <= v_created
      ORDER BY created_at DESC LIMIT v_before_n + 1     -- mesajul + N înainte
    ) b;
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at) INTO v_after FROM (
      SELECT id, sender_id, content, image_path, deleted_at, deleted_by_admin, created_at
      FROM messages WHERE conversation_id = v_scope AND created_at > v_created
      ORDER BY created_at ASC LIMIT v_after_n
    ) a;

  ELSIF p_table = 'channel_messages' THEN
    SELECT channel_id, created_at INTO v_scope, v_created FROM channel_messages WHERE id = p_message_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

    SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at) INTO v_before FROM (
      SELECT id, sender_id, content, image_path, deleted_at, deleted_by_admin, created_at
      FROM channel_messages WHERE channel_id = v_scope AND created_at <= v_created
      ORDER BY created_at DESC LIMIT v_before_n + 1
    ) b;
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at) INTO v_after FROM (
      SELECT id, sender_id, content, image_path, deleted_at, deleted_by_admin, created_at
      FROM channel_messages WHERE channel_id = v_scope AND created_at > v_created
      ORDER BY created_at ASC LIMIT v_after_n
    ) a;
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;

  -- Audit OBLIGATORIU, acum cu fereastra EFECTIVĂ (post-cap) — trasabilitate
  -- completă a cât conținut a văzut adminul la acest acces.
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'view_report_context', 'message', p_message_id,
          jsonb_build_object('table', p_table, 'before', v_before_n, 'after', v_after_n));

  RETURN coalesce(v_before, '[]'::jsonb) || coalesce(v_after, '[]'::jsonb);
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_report_conversation(p_report_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_search_announcements(p_query text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_search_users(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_q text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  v_q := coalesce(trim(p_query), '');
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.full_name) INTO v FROM (
    SELECT p.id, p.full_name, p.role, p.avatar_path, p.deleted_at,
           p.banned_at, p.banned_until, u.email
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.role <> 'admin'
      AND (v_q = ''
           OR p.full_name ILIKE '%' || v_q || '%'
           OR u.email    ILIKE '%' || v_q || '%')
    LIMIT 50
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_unban_user(p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE profiles SET banned_at = NULL, banned_until = NULL, ban_reason = NULL WHERE id = p_uid;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'unban_user', 'user', p_uid, '{}'::jsonb);
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed text[] := ARRAY[
    'full_name','phone','address','vat_number',
    'specialization','activity_zone','company_name','contact_email'
  ];
  v_bad text;
  v_old jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' OR p_fields = '{}'::jsonb THEN
    RAISE EXCEPTION 'no_fields';
  END IF;

  SELECT k INTO v_bad
  FROM jsonb_object_keys(p_fields) AS k
  WHERE k <> ALL (v_allowed)
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'field_not_allowed: %', v_bad;
  END IF;

  -- Sanity minimal: numele nu poate deveni gol (restul coloanelor sunt nullable).
  IF p_fields ? 'full_name' AND nullif(trim(p_fields->>'full_name'), '') IS NULL THEN
    RAISE EXCEPTION 'full_name_empty';
  END IF;

  -- Valorile VECHI, cu lock pe rând (FOR UPDATE): auditul reflectă exact starea
  -- pe care a suprascris-o ACEST apel, chiar sub apeluri concurente.
  SELECT jsonb_build_object(
    'full_name', full_name, 'phone', phone, 'address', address,
    'vat_number', vat_number, 'specialization', specialization,
    'activity_zone', activity_zone, 'company_name', company_name,
    'contact_email', contact_email
  ) INTO v_old
  FROM profiles WHERE id = p_uid FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;

  -- UPDATE STATIC (fără SQL dinamic — zero risc de injecție prin numele cheilor):
  -- doar cheile PREZENTE în p_fields se modifică; valoare goală/null → coloana devine NULL.
  UPDATE profiles SET
    full_name      = CASE WHEN p_fields ? 'full_name'      THEN trim(p_fields->>'full_name')                ELSE full_name      END,
    phone          = CASE WHEN p_fields ? 'phone'          THEN nullif(trim(p_fields->>'phone'), '')          ELSE phone          END,
    address        = CASE WHEN p_fields ? 'address'        THEN nullif(trim(p_fields->>'address'), '')        ELSE address        END,
    vat_number     = CASE WHEN p_fields ? 'vat_number'     THEN nullif(trim(p_fields->>'vat_number'), '')     ELSE vat_number     END,
    specialization = CASE WHEN p_fields ? 'specialization' THEN nullif(trim(p_fields->>'specialization'), '') ELSE specialization END,
    activity_zone  = CASE WHEN p_fields ? 'activity_zone'  THEN nullif(trim(p_fields->>'activity_zone'), '')  ELSE activity_zone  END,
    company_name   = CASE WHEN p_fields ? 'company_name'   THEN nullif(trim(p_fields->>'company_name'), '')   ELSE company_name   END,
    contact_email  = CASE WHEN p_fields ? 'contact_email'  THEN nullif(trim(p_fields->>'contact_email'), '')  ELSE contact_email  END
  WHERE id = p_uid;

  -- Trasabilitate completă: vechi (doar cheile atinse) + nou.
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'update_profile', 'user', p_uid,
    jsonb_build_object(
      'old', (SELECT jsonb_object_agg(k, v_old -> k) FROM jsonb_object_keys(p_fields) AS k),
      'new', p_fields
    )
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_update_report_status(p_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF p_status NOT IN ('pending', 'reviewed', 'dismissed') THEN RAISE EXCEPTION 'bad_status'; END IF;
  UPDATE reports SET status = p_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(),
          CASE WHEN p_status = 'dismissed' THEN 'dismiss_report' ELSE 'review_report' END,
          'report', p_id, jsonb_build_object('status', p_status));
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_user_detail(p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT to_jsonb(d) INTO v FROM (
    SELECT
      p.id, p.full_name, p.role, p.avatar_path, p.specialization, p.activity_zone,
      p.company_name, p.contact_email, p.address, p.vat_number, p.phone,
      p.rating_avg, p.rating_count,
      p.deleted_at, p.banned_at, p.banned_until, p.ban_reason,
      u.email, u.created_at AS registered_at,
      (SELECT count(*) FROM announcements a WHERE a.driver_id = p.id)              AS announcements_count,
      (SELECT count(*) FROM applications ap WHERE ap.mechanic_id = p.id)           AS applications_count,
      (SELECT count(*) FROM reports r WHERE r.reported_user_id = p.id)             AS reports_received,
      (SELECT count(*) FROM reports r WHERE r.reporter_id = p.id)                  AS reports_made
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_uid
  ) d;
  IF v IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  RETURN v;
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text DEFAULT 'RON'::text, p_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid;
BEGIN
  SELECT driver_id INTO v_driver_id
  FROM announcements
  WHERE id = p_announcement_id AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'announcement_not_open';
  END IF;

  IF is_block_between(v_driver_id, auth.uid()) THEN
    RAISE EXCEPTION 'announcement_not_open';   -- identic cu cazul de mai sus — nedetectabil
  END IF;

  INSERT INTO applications(announcement_id, mechanic_id, price_type, price_amount, currency, message)
  VALUES (p_announcement_id, auth.uid(), p_price_type, p_price_amount, p_currency, p_message);
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_user(p_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_target = v_me THEN
    RAISE EXCEPTION 'cannot_block_self';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_target) THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  INSERT INTO blocked_users(blocker_id, blocked_id)
  VALUES (v_me, p_target)
  ON CONFLICT DO NOTHING;          -- idempotent (dublu-tap, retry de rețea)

  -- Auto-reject candidaturi pending între cei doi, SIMETRIC (§1.7.1):
  --   • eu șofer → candidaturile mecanicului blocat la anunțurile mele;
  --   • eu mecanic → propriile candidaturi la anunțurile blocatului.
  -- O respingere e un eveniment banal — nedetectabil ca semnal de blocare.
  UPDATE applications a
  SET status = 'rejected'
  FROM announcements ann
  WHERE a.announcement_id = ann.id
    AND a.status = 'pending'
    AND (
      (ann.driver_id = v_me AND a.mechanic_id = p_target)
      OR (a.mechanic_id = v_me AND ann.driver_id = p_target)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_push_token(p_token text, p_platform text DEFAULT NULL::text, p_device_token text DEFAULT NULL::text, p_previous_token text DEFAULT NULL::text, p_app_build text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'token required';
  END IF;

  -- (a) Aceeași instalare a primit un token Expo NOU: cel vechi nu mai
  --     reprezintă niciun dispozitiv. Clientul ni-l trimite — posesia lui e
  --     dovada dreptului de a-l scoate, indiferent pe ce cont a rămas.
  IF p_previous_token IS NOT NULL AND p_previous_token <> p_token THEN
    DELETE FROM push_tokens WHERE token = p_previous_token;
  END IF;

  -- (b) Același dispozitiv fizic (același token nativ APNs/FCM) înregistrat sub
  --     ALT token Expo (reinstalare, identitate Expo nouă): rămâne un singur
  --     rând, altfel telefonul primește fiecare notificare de două ori.
  IF p_device_token IS NOT NULL AND p_platform IS NOT NULL THEN
    DELETE FROM push_tokens
     WHERE device_token = p_device_token
       AND platform     = p_platform
       AND token        <> p_token;
  END IF;

  INSERT INTO push_tokens (token, user_id, updated_at, platform, device_token, app_build)
  VALUES (p_token, auth.uid(), now(), p_platform, p_device_token, p_app_build)
  ON CONFLICT (token) DO UPDATE
    SET user_id      = auth.uid(),
        updated_at   = now(),
        -- Clienții vechi trimit NULL: nu ștergem ce știm deja despre rând.
        platform     = COALESCE(EXCLUDED.platform,     push_tokens.platform),
        device_token = COALESCE(EXCLUDED.device_token, push_tokens.device_token),
        app_build    = COALESCE(EXCLUDED.app_build,    push_tokens.app_build);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_message(p_table text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_path text;
  v_old_file text;
  v_reported boolean;
BEGIN
  IF p_table = 'messages' THEN
    SELECT image_path, file_path INTO v_old_path, v_old_file FROM messages
      WHERE id = p_id AND sender_id = auth.uid() AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE messages
       SET content = '', image_path = NULL,
           file_path = NULL, file_name = NULL, file_size = NULL,
           deleted_at = now()
     WHERE id = p_id;
  ELSIF p_table = 'channel_messages' THEN
    SELECT image_path, file_path INTO v_old_path, v_old_file FROM channel_messages
      WHERE id = p_id AND sender_id = auth.uid() AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE channel_messages
       SET content = '', image_path = NULL,
           file_path = NULL, file_name = NULL, file_size = NULL,
           deleted_at = now()
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;

  IF v_old_path IS NOT NULL OR v_old_file IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM reports r
      WHERE r.message_id = p_id AND r.message_table = p_table AND r.status = 'pending'
    ) INTO v_reported;
    IF NOT v_reported THEN
      PERFORM storage_api_delete('photos', v_old_path);
      PERFORM storage_api_delete('photos', v_old_file);
    END IF;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.direct_push_allowed(p_user uuid, p_sender uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_min_gap  constant interval := interval '30 seconds';
  v_max_hour constant integer  := 10;
  v_st       public.direct_push_state%ROWTYPE;
BEGIN
  SELECT * INTO v_st FROM direct_push_state
   WHERE user_id = p_user AND sender_id = p_sender
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO direct_push_state (user_id, sender_id) VALUES (p_user, p_sender);
    RETURN true;
  END IF;
  IF v_st.last_pushed_at > now() - v_min_gap THEN
    RETURN false;
  END IF;
  IF v_st.window_start < now() - interval '1 hour' THEN
    UPDATE direct_push_state
       SET window_start = now(), count_in_window = 1, last_pushed_at = now()
     WHERE user_id = p_user AND sender_id = p_sender;
    RETURN true;
  END IF;
  IF v_st.count_in_window >= v_max_hour THEN
    RETURN false;
  END IF;
  UPDATE direct_push_state
     SET count_in_window = count_in_window + 1, last_pushed_at = now()
   WHERE user_id = p_user AND sender_id = p_sender;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dismiss_application(p_application_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM applications a
  USING announcements ann
  WHERE a.id = p_application_id
    AND a.mechanic_id = auth.uid()
    AND a.announcement_id = ann.id
    AND (a.status = 'rejected' OR ann.status = 'cancelled');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_dismissable';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.distance_km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lon2 - lon1) / 2), 2)
  ));
$function$;

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

CREATE OR REPLACE FUNCTION public.enforce_announcement_photo_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT count(*) FROM public.announcement_photos WHERE announcement_id = NEW.announcement_id) >= 10 THEN
    RAISE EXCEPTION 'photo_limit_reached';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.enforce_market_listing_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
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
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT count(*) FROM public.market_listing_photos WHERE listing_id = NEW.listing_id) >= 10 THEN
    RAISE EXCEPTION 'photo_limit_reached';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_driver_phone(p_driver_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
BEGIN
  IF is_block_between(auth.uid(), p_driver_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_driver_id AND role IN ('driver', 'admin')
  ) THEN
    RETURN NULL;
  END IF;
  SELECT p.phone INTO v_phone
  FROM profiles p
  WHERE p.id = p_driver_id
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE ((c.driver_id = p_driver_id AND c.mechanic_id = auth.uid())
          OR (c.mechanic_id = p_driver_id AND c.driver_id = auth.uid()))
        AND c.listing_id IS NULL                     -- Faza 19: idem
    );
  RETURN v_phone;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_mechanic_phone(p_mechanic_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
BEGIN
  IF is_block_between(auth.uid(), p_mechanic_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_mechanic_id AND role IN ('mechanic', 'admin')
  ) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE ((c.mechanic_id = p_mechanic_id AND c.driver_id = auth.uid())
        OR (c.driver_id = p_mechanic_id AND c.mechanic_id = auth.uid()))
      AND c.listing_id IS NULL                       -- Faza 19: marketul NU deblochează telefonul
  ) THEN
    RETURN NULL;
  END IF;
  SELECT phone INTO v_phone FROM profiles WHERE id = p_mechanic_id;
  RETURN v_phone;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_own_profile()
 RETURNS SETOF public.profiles
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.* FROM public.profiles p WHERE p.id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.guard_announcement_client_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status              := 'open';
    NEW.mechanic_id         := NULL;
    NEW.created_at          := now();
    NEW.hidden_from_history := false;
    RETURN NEW;
  END IF;

  IF NEW.id          IS DISTINCT FROM OLD.id
  OR NEW.driver_id   IS DISTINCT FROM OLD.driver_id
  OR NEW.mechanic_id IS DISTINCT FROM OLD.mechanic_id
  OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'announcement_update_forbidden';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.guard_not_banned()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
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

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role IS NULL OR NEW.role NOT IN ('driver', 'mechanic') THEN
      RAISE EXCEPTION 'role_forbidden';
    END IF;
    NEW.banned_at    := NULL;
    NEW.banned_until := NULL;
    NEW.ban_reason   := NULL;
    NEW.rating_avg   := 0;
    NEW.rating_count := 0;
    NEW.created_at   := now();
    NEW.deleted_at   := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'id_change_forbidden';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role_change_forbidden';
  END IF;
  IF NEW.banned_at    IS DISTINCT FROM OLD.banned_at
  OR NEW.banned_until IS DISTINCT FROM OLD.banned_until
  OR NEW.ban_reason   IS DISTINCT FROM OLD.ban_reason THEN
    RAISE EXCEPTION 'ban_change_forbidden';
  END IF;
  IF NEW.rating_avg   IS DISTINCT FROM OLD.rating_avg
  OR NEW.rating_count IS DISTINCT FROM OLD.rating_count THEN
    RAISE EXCEPTION 'rating_change_forbidden';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'created_at_change_forbidden';
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'deleted_at_change_forbidden';
  END IF;
  RETURN NEW;
END; $function$;

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

CREATE OR REPLACE FUNCTION public.handle_auth_user_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM _purge_user_data(OLD.id);   -- căile Storage întoarse se ignoră (trigger nu atinge Storage)
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin(p_uid uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_uid AND role = 'admin');
$function$;

CREATE OR REPLACE FUNCTION public.is_banned(p_uid uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_uid
      AND banned_at IS NOT NULL
      AND (banned_until IS NULL OR banned_until > now())
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_block_between(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM blocked_users
    WHERE (blocker_id = p_a AND blocked_id = p_b)
       OR (blocker_id = p_b AND blocked_id = p_a)
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_blocked_by(p_blocker uuid, p_blocked uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM blocked_users
    WHERE blocker_id = p_blocker AND blocked_id = p_blocked
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_conversation_blocked(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = p_conversation_id
      AND is_block_between(c.driver_id, c.mechanic_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.notify_mechanics_new_announcement(p_announcement public.announcements)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_mechanic record;
BEGIN
  FOR v_mechanic IN
    SELECT profiles.id, COALESCE(lang, 'ro') AS lang
    FROM profiles
    WHERE role = 'mechanic'
      AND profiles.id <> p_announcement.driver_id
      AND push_enabled
      AND NOT is_block_between(p_announcement.driver_id, profiles.id)   -- Faza 18
      AND (
        notify_radius_km IS NULL
        OR (
          p_announcement.latitude IS NOT NULL AND p_announcement.longitude IS NOT NULL
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND distance_km(latitude, longitude, p_announcement.latitude, p_announcement.longitude)
              <= notify_radius_km
        )
      )
  LOOP
    PERFORM notify_push(
      v_mechanic.id,
      push_text(v_mechanic.lang, 'announcement_title'),
      p_announcement.location,
      jsonb_build_object('type', 'feed', 'id', p_announcement.id)
    );
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb DEFAULT '{}'::jsonb, p_tag text DEFAULT NULL::text, p_ios_title text DEFAULT NULL::text, p_ios_body text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_enabled boolean;
  v_token   record;
  v_payload jsonb;
BEGIN
  -- Comutatorul global din Setări.
  SELECT push_enabled INTO v_enabled FROM profiles WHERE id = p_user_id;
  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  -- Conturile banate nu primesc push (indiferent de preferință) — 18.4b.
  IF is_banned(p_user_id) THEN
    RETURN;
  END IF;

  FOR v_token IN SELECT token, platform FROM push_tokens WHERE user_id = p_user_id LOOP
    IF v_token.platform = 'ios' AND p_tag IS NOT NULL THEN
      -- iPhone, notificare de fir (conversație/canal): o celulă PER MESAJ,
      -- stivuite pe fir prin thread-id, ca WhatsApp. Fără collapseId: pe iOS
      -- înlocuirea re-afișa bannerul cu același conținut la fiecare mesaj.
      -- Fără channelId (câmp doar-Android). Ștergerea din bară la citire rămâne
      -- pe client (dismissThreadNotifications filtrează după data.type/id).
      v_payload := jsonb_build_object(
        'to',       v_token.token,
        'title',    COALESCE(p_ios_title, p_title),
        'body',     COALESCE(p_ios_body,  p_body),
        'data',     p_data,
        'sound',    'default',
        'priority', 'high',
        'threadId', p_tag
      );
    ELSE
      -- Android + tokenuri fără platformă cunoscută (aplicații nemigrate):
      -- comportamentul de până acum.
      v_payload := jsonb_build_object(
        'to',        v_token.token,
        'title',     p_title,
        'body',      p_body,
        'data',      p_data,
        'sound',     'default',
        'channelId', 'default',
        -- FCM „high": livrare imediată și în Doze; fără el Samsung amâna minute.
        'priority',  'high'
      );
      -- `tag` (Android) înlocuiește celula din bară; `collapseId` coalescează în
      -- tranzit și, pe iOS-urile nemigrate, înlocuiește celula.
      IF p_tag IS NOT NULL THEN
        v_payload := v_payload || jsonb_build_object('tag', p_tag, 'collapseId', p_tag);
      END IF;
    END IF;

    PERFORM net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := v_payload
    );
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_announcement_delete_tombstone_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
UPDATE messages SET deleted_at = now() WHERE announcement_id = OLD.id AND deleted_at IS NULL AND content = '' AND image_path IS NULL AND file_path IS NULL AND listing_id IS NULL AND recommended_mechanic_id IS NULL;
UPDATE channel_messages SET deleted_at = now() WHERE announcement_id = OLD.id AND deleted_at IS NULL AND content = '' AND image_path IS NULL AND file_path IS NULL AND listing_id IS NULL AND recommended_mechanic_id IS NULL;
RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_announcement_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;
  PERFORM notify_mechanics_new_announcement(NEW);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_application_accepted_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_driver_name text;
  v_lang        text;
BEGIN
  SELECT p.full_name INTO v_driver_name
  FROM announcements a
  JOIN profiles p ON p.id = a.driver_id
  WHERE a.id = NEW.announcement_id;

  v_lang := user_lang(NEW.mechanic_id);

  PERFORM notify_push(
    NEW.mechanic_id,
    push_text(v_lang, 'accepted_title'),
    format(push_text(v_lang, 'accepted_body'), COALESCE(v_driver_name, '')),
    jsonb_build_object('type', 'application', 'id', NEW.id)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_application_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_driver   uuid;
  v_mechanic text;
  v_lang     text;
BEGIN
  SELECT driver_id INTO v_driver FROM announcements WHERE id = NEW.announcement_id;
  IF v_driver IS NULL OR v_driver = NEW.mechanic_id THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_mechanic FROM profiles WHERE id = NEW.mechanic_id;
  v_lang := user_lang(v_driver);

  PERFORM notify_push(
    v_driver,
    push_text(v_lang, 'application_title'),
    format(push_text(v_lang, 'application_body'), COALESCE(v_mechanic, '')),
    jsonb_build_object('type', 'announcement', 'id', NEW.announcement_id)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_channel_message_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cooldown constant interval := interval '2 minutes';
  v_rec      record;
  v_addr     record;
  v_sender   text;
  v_lang     text;
  v_cursor   timestamptz;
  v_since    timestamptz;
  v_count    integer;
  v_body     text;
  v_title    text;
  v_line_new text;
  v_short    text;
  v_done     uuid[] := '{}';
BEGIN
  SELECT full_name INTO v_sender FROM profiles WHERE id = NEW.sender_id;

  -- Linia mesajului curent (corpul de pe iOS + plasa de siguranță a digest-ului).
  v_short := COALESCE(
    NULLIF(NEW.content, ''),
    CASE
      WHEN NEW.file_name IS NOT NULL
           AND lower(NEW.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                       THEN '🎥 ' || left(NEW.file_name, 98)
      WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 98)
      WHEN NEW.listing_id IS NOT NULL THEN '🏷️'
      WHEN NEW.recommended_mechanic_id IS NOT NULL THEN '👤'
      WHEN NEW.announcement_id IS NOT NULL THEN '📍'
      ELSE '📷'
    END
  );
  v_line_new := left(COALESCE(v_sender, '?'), 24) || ': ' || v_short;

  -- ── 4a. Adresați: autorul mesajului citat ∪ mențiunile (max 5), imediat, fără pauză ──
  FOR v_addr IN
    SELECT DISTINCT ON (x.user_id) x.user_id, x.kind
      FROM (
        SELECT m.sender_id AS user_id, 'reply'::text AS kind, 0::bigint AS ord
          FROM channel_messages m
         WHERE NEW.reply_to_id IS NOT NULL AND m.id = NEW.reply_to_id
        UNION ALL
        SELECT (t.e->>'id')::uuid, 'mention', t.ord
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(NEW.mentions) = 'array' THEN NEW.mentions ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS t(e, ord)
         WHERE (t.e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) x
      JOIN profiles pr ON pr.id = x.user_id
     WHERE x.user_id <> NEW.sender_id
       AND pr.push_enabled
       AND pr.mention_push_enabled
       AND pr.deleted_at IS NULL
       AND pr.created_at <= NEW.created_at                -- since-join, ca RLS-ul și ca digest-ul
       AND NOT is_block_between(NEW.sender_id, x.user_id)
     ORDER BY x.user_id, x.ord                            -- reply (ord 0) are prioritate la dubluri
     LIMIT 5
  LOOP
    IF NOT direct_push_allowed(v_addr.user_id, NEW.sender_id) THEN
      -- Peste limită: NU-l pierdem; rămâne în digest-ul obișnuit de mai jos.
      CONTINUE;
    END IF;
    v_lang  := user_lang(v_addr.user_id);
    v_title := format(push_text(v_lang, v_addr.kind || '_title'), left(COALESCE(v_sender, '?'), 24));

    PERFORM notify_push(
      v_addr.user_id,
      v_title,
      left(v_short, 140),
      jsonb_build_object('type', 'channel', 'id', NEW.channel_id,
                         'message_id', NEW.id, 'kind', v_addr.kind),
      'mention-' || NEW.channel_id,
      v_title,
      left(v_short, 140)
    );
    -- Digest-ul nu trebuie să-i repete mesajul: cursorul lui de push devine „acum”.
    INSERT INTO channel_push_state (user_id, channel_id, last_pushed_at)
    VALUES (v_addr.user_id, NEW.channel_id, now())
    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_pushed_at = now();
    v_done := v_done || v_addr.user_id;
  END LOOP;

  -- ── 4b. Digest-ul de până acum, pentru restul membrilor ──
  FOR v_rec IN
    SELECT p.user_id, pr.created_at AS joined_at, st.last_pushed_at
    FROM channel_push_prefs p
    JOIN profiles pr ON pr.id = p.user_id
    LEFT JOIN channel_push_state st
           ON st.user_id = p.user_id AND st.channel_id = p.channel_id
    WHERE p.channel_id = NEW.channel_id
      AND p.enabled
      AND p.user_id <> NEW.sender_id
      AND NOT (p.user_id = ANY (v_done))
      AND pr.push_enabled
      AND pr.deleted_at IS NULL
      AND NOT is_block_between(NEW.sender_id, p.user_id)
  LOOP
    SELECT last_read_at INTO v_cursor
      FROM channel_reads
     WHERE channel_id = NEW.channel_id AND user_id = v_rec.user_id;

    IF v_rec.last_pushed_at IS NOT NULL
       AND v_rec.last_pushed_at > now() - v_cooldown
       AND (v_cursor IS NULL OR v_cursor < v_rec.last_pushed_at) THEN
      CONTINUE;
    END IF;

    v_lang := user_lang(v_rec.user_id);

    SELECT count(*) INTO v_count FROM (
      SELECT 1
      FROM channel_messages m
      WHERE m.channel_id = NEW.channel_id
        AND m.sender_id <> v_rec.user_id
        AND m.deleted_at IS NULL
        AND (v_cursor IS NULL OR m.created_at > v_cursor)
        AND m.created_at >= v_rec.joined_at
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      LIMIT 100
    ) c;

    v_since := GREATEST(v_cursor, v_rec.last_pushed_at);

    SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at ASC) INTO v_body
    FROM (
      SELECT m.created_at,
             left(COALESCE(pr.full_name, '?'), 24) || ': ' ||
             CASE
               WHEN m.content IS NOT NULL AND m.content <> '' THEN left(m.content, 100)
               WHEN m.file_name IS NOT NULL
                    AND lower(m.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                                THEN '🎥 ' || left(m.file_name, 98)
               WHEN m.file_name IS NOT NULL THEN '📎 ' || left(m.file_name, 98)
               WHEN m.listing_id IS NOT NULL THEN '🏷️'
               WHEN m.recommended_mechanic_id IS NOT NULL THEN '👤'
               WHEN m.announcement_id IS NOT NULL THEN '📍'
               ELSE '📷'
             END AS line
      FROM channel_messages m
      JOIN profiles pr ON pr.id = m.sender_id
      WHERE m.channel_id = NEW.channel_id
        AND m.sender_id <> v_rec.user_id
        AND m.deleted_at IS NULL
        AND (v_since IS NULL OR m.created_at > v_since)
        AND m.created_at >= v_rec.joined_at
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      ORDER BY m.created_at DESC
      LIMIT 5
    ) sub;

    IF v_body IS NULL THEN
      v_count := GREATEST(v_count, 1);
      v_body  := v_line_new;
    END IF;

    v_title := push_text(v_lang, 'channel_name');
    IF v_count > 1 THEN
      v_title := v_title || ' (' || v_count || ')';
    END IF;

    PERFORM notify_push(
      v_rec.user_id,
      v_title,
      v_body,
      jsonb_build_object('type', 'channel', 'id', NEW.channel_id),
      'channel-' || NEW.channel_id,
      v_title,
      v_line_new
    );

    INSERT INTO channel_push_state (user_id, channel_id, last_pushed_at)
    VALUES (v_rec.user_id, NEW.channel_id, now())
    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_pushed_at = now();
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Regula zero: notificarea nu are voie să blocheze mesajul.
  RAISE WARNING 'on_channel_message_notify: % (mesaj %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_listing_delete_tombstone_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
UPDATE messages SET deleted_at = now() WHERE listing_id = OLD.id AND deleted_at IS NULL AND content = '' AND image_path IS NULL AND file_path IS NULL AND announcement_id IS NULL AND recommended_mechanic_id IS NULL;
UPDATE channel_messages SET deleted_at = now() WHERE listing_id = OLD.id AND deleted_at IS NULL AND content = '' AND image_path IS NULL AND file_path IS NULL AND announcement_id IS NULL AND recommended_mechanic_id IS NULL;
RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_market_listing_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user record;
  v_body text;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  v_body := NEW.title || ' · ' || trim_scale(NEW.price)::text || ' ' || NEW.currency;

  FOR v_user IN
    SELECT profiles.id, COALESCE(lang, 'ro') AS lang
    FROM profiles
    WHERE profiles.id <> NEW.seller_id          -- nu te anunți pe tine
      AND deleted_at IS NULL                    -- Faza 15: pietre funerare
      AND push_enabled                          -- comutatorul global din Setări
      AND market_push_enabled                   -- comutatorul de Market (8 sept)
      AND NOT is_block_between(NEW.seller_id, profiles.id)  -- Faza 18
  LOOP
    PERFORM notify_push(
      v_user.id,
      push_text(v_user.lang, 'market_title'),
      v_body,
      jsonb_build_object('type', 'listing', 'id', NEW.id)
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_message_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_recipient uuid;
  v_sender    text;
  v_lang      text;
  v_cursor    timestamptz;
  v_count     integer;
  v_body      text;
  v_title     text;
  v_ios_title text;
  v_line_new  text;
  v_kind      text;
  v_data      jsonb;
BEGIN
  SELECT CASE WHEN c.driver_id = NEW.sender_id THEN c.mechanic_id ELSE c.driver_id END
    INTO v_recipient
  FROM conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_recipient IS NULL OR v_recipient = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_sender FROM profiles WHERE id = NEW.sender_id;
  v_lang := user_lang(v_recipient);

  v_line_new := CASE
    WHEN NEW.content IS NOT NULL AND NEW.content <> '' THEN left(NEW.content, 120)
    WHEN NEW.file_name IS NOT NULL
         AND lower(NEW.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                     THEN '🎥 ' || left(NEW.file_name, 118)
    WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 118)
    WHEN NEW.listing_id IS NOT NULL THEN '🏷️'
    WHEN NEW.recommended_mechanic_id IS NOT NULL THEN '👤'
    WHEN NEW.announcement_id IS NOT NULL THEN '📍'
    ELSE push_text(v_lang, 'photo')
  END;

  SELECT last_read_at INTO v_cursor
    FROM message_reads
   WHERE conversation_id = NEW.conversation_id AND user_id = v_recipient;

  SELECT count(*) INTO v_count
    FROM messages m
   WHERE m.conversation_id = NEW.conversation_id
     AND m.sender_id = NEW.sender_id
     AND m.deleted_at IS NULL
     AND (v_cursor IS NULL OR m.created_at > v_cursor);

  SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at ASC) INTO v_body
  FROM (
    SELECT m.created_at,
           CASE
             WHEN m.content IS NOT NULL AND m.content <> '' THEN left(m.content, 120)
             WHEN m.file_name IS NOT NULL
                  AND lower(m.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                              THEN '🎥 ' || left(m.file_name, 118)
             WHEN m.file_name IS NOT NULL THEN '📎 ' || left(m.file_name, 118)
             WHEN m.listing_id IS NOT NULL THEN '🏷️'
             WHEN m.recommended_mechanic_id IS NOT NULL THEN '👤'
             WHEN m.announcement_id IS NOT NULL THEN '📍'
             ELSE push_text(v_lang, 'photo')
           END AS line
    FROM messages m
    WHERE m.conversation_id = NEW.conversation_id
      AND m.sender_id = NEW.sender_id
      AND m.deleted_at IS NULL
      AND (v_cursor IS NULL OR m.created_at > v_cursor)
    ORDER BY m.created_at DESC
    LIMIT 5
  ) sub;

  IF v_body IS NULL THEN
    v_count := 1;
    v_body  := v_line_new;
  END IF;

  -- 27 oct 2026: mesajul e reply la destinatar sau îl menționează → titlu explicit.
  v_kind := NULL;
  IF NEW.reply_to_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM messages q WHERE q.id = NEW.reply_to_id AND q.sender_id = v_recipient) THEN
    v_kind := 'reply';
  ELSIF jsonb_typeof(NEW.mentions) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mentions) e WHERE e->>'id' = v_recipient::text) THEN
    v_kind := 'mention';
  END IF;

  v_data := jsonb_build_object('type', 'conversation', 'id', NEW.conversation_id);
  IF v_kind IS NOT NULL THEN
    v_title     := format(push_text(v_lang, v_kind || '_title'), left(COALESCE(v_sender, ''), 24));
    v_ios_title := v_title;
    v_data      := v_data || jsonb_build_object('message_id', NEW.id, 'kind', v_kind);
  ELSE
    v_title := COALESCE(v_sender, '');
    IF v_count > 1 THEN
      v_title := v_title || ' (' || v_count || ')';
    END IF;
    v_ios_title := COALESCE(v_sender, '');
  END IF;

  PERFORM notify_push(
    v_recipient,
    v_title,
    v_body,
    v_data,
    'conversation-' || NEW.conversation_id,
    v_ios_title,
    v_line_new
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'on_message_notify: % (mesaj %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_profile_delete_tombstone_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
UPDATE messages SET deleted_at = now() WHERE recommended_mechanic_id = OLD.id AND deleted_at IS NULL AND content = '' AND image_path IS NULL AND file_path IS NULL AND listing_id IS NULL AND announcement_id IS NULL;
UPDATE channel_messages SET deleted_at = now() WHERE recommended_mechanic_id = OLD.id AND deleted_at IS NULL AND content = '' AND image_path IS NULL AND file_path IS NULL AND listing_id IS NULL AND announcement_id IS NULL;
RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_user_data()
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  RETURN _purge_user_data(v_uid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.push_text(p_lang text, p_key text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_key
    WHEN 'application_title' THEN
      CASE p_lang WHEN 'en' THEN 'New offer'
                  WHEN 'de' THEN 'Neues Angebot'
                  ELSE 'Ofertă nouă' END
    WHEN 'application_body' THEN
      CASE p_lang WHEN 'en' THEN '%s offered to help you'
                  WHEN 'de' THEN '%s bietet dir Hilfe an'
                  ELSE '%s s-a oferit să te ajute' END
    WHEN 'accepted_title' THEN
      CASE p_lang WHEN 'en' THEN 'Offer accepted'
                  WHEN 'de' THEN 'Angebot angenommen'
                  ELSE 'Ofertă acceptată' END
    WHEN 'accepted_body' THEN
      CASE p_lang WHEN 'en' THEN '%s accepted your offer'
                  WHEN 'de' THEN '%s hat dein Angebot angenommen'
                  ELSE '%s ți-a acceptat oferta' END
    WHEN 'announcement_title' THEN
      CASE p_lang WHEN 'en' THEN 'New announcement'
                  WHEN 'de' THEN 'Neue Anzeige'
                  ELSE 'Anunț nou' END
    WHEN 'photo' THEN
      CASE p_lang WHEN 'en' THEN 'Photo'
                  WHEN 'de' THEN 'Foto'
                  ELSE 'Poză' END
    WHEN 'channel_name' THEN
      CASE p_lang WHEN 'en' THEN 'TruckSOS Community'
                  WHEN 'de' THEN 'TruckSOS Gemeinschaft'
                  ELSE 'Comunitate TruckSOS' END
    WHEN 'market_title' THEN
      CASE p_lang WHEN 'en' THEN 'New listing on Market'
                  WHEN 'de' THEN 'Neue Anzeige im Markt'
                  ELSE 'Anunț nou pe Market' END
    -- 27 oct 2026 (1.1): mențiuni și răspunsuri; %s = numele expeditorului.
    WHEN 'mention_title' THEN
      CASE p_lang WHEN 'en' THEN '%s mentioned you'
                  WHEN 'de' THEN '%s hat dich erwähnt'
                  ELSE '%s te-a menționat' END
    WHEN 'reply_title' THEN
      CASE p_lang WHEN 'en' THEN '%s replied to you'
                  WHEN 'de' THEN '%s hat dir geantwortet'
                  ELSE '%s ți-a răspuns' END
    ELSE ''
  END;
$function$;

CREATE OR REPLACE FUNCTION public.ratings_after_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM recompute_mechanic_rating(coalesce(NEW.mechanic_id, OLD.mechanic_id));
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ratings_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_mechanic_rating(p_mechanic uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE profiles p SET
    rating_avg   = coalesce((SELECT round(avg(stars)::numeric, 1) FROM ratings WHERE mechanic_id = p_mechanic), 0),
    rating_count = (SELECT count(*) FROM ratings WHERE mechanic_id = p_mechanic)
  WHERE p.id = p_mechanic;
$function$;

CREATE OR REPLACE FUNCTION public.record_announcement_view(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR is_admin() THEN RETURN; END IF;
  INSERT INTO announcement_views (announcement_id, viewer_id)
  SELECT a.id, auth.uid()
    FROM announcements a
   WHERE a.id = p_announcement_id
     AND a.driver_id IS DISTINCT FROM auth.uid()
  ON CONFLICT DO NOTHING;
END; $function$;

CREATE OR REPLACE FUNCTION public.reject_application(p_application_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE applications
  SET status = 'rejected'
  WHERE id = p_application_id
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM announcements ann
      JOIN applications a ON a.announcement_id = ann.id
      WHERE a.id = p_application_id
        AND ann.driver_id = auth.uid()
        AND ann.status = 'open'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reports_snapshot_from_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_content text;
  v_image   text;
  v_sender  uuid;
BEGIN
  IF NEW.message_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.message_table = 'messages' THEN
    SELECT content, image_path, sender_id INTO v_content, v_image, v_sender
      FROM messages WHERE id = NEW.message_id AND deleted_at IS NULL;
  ELSIF NEW.message_table = 'channel_messages' THEN
    SELECT content, image_path, sender_id INTO v_content, v_image, v_sender
      FROM channel_messages WHERE id = NEW.message_id AND deleted_at IS NULL;
  END IF;

  IF FOUND THEN
    NEW.content_snapshot    := v_content;
    NEW.image_path_snapshot := v_image;
    NEW.reported_user_id    := v_sender;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.repost_announcement(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row announcements;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE announcements
     SET status = 'open',
         created_at = now()
   WHERE id = p_announcement_id
     AND driver_id = auth.uid()
     AND status = 'cancelled'
     AND created_at < now() - interval '30 hours'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  PERFORM notify_mechanics_new_announcement(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_open_announcement(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE announcements
     SET status = 'resolved'
   WHERE id = p_announcement_id
     AND driver_id = auth.uid()
     AND status IN ('open', 'cancelled');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  UPDATE applications
     SET status = 'rejected'
   WHERE announcement_id = p_announcement_id
     AND status = 'pending';
END;
$function$;

CREATE OR REPLACE FUNCTION public.resubmit_application(p_application_id uuid, p_price_type text, p_price_amount numeric, p_currency text DEFAULT 'RON'::text, p_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE applications a
  SET status       = 'pending',
      price_type   = p_price_type,
      price_amount = p_price_amount,
      currency     = p_currency,
      message      = p_message
  FROM announcements ann
  WHERE a.id              = p_application_id
    AND a.mechanic_id     = auth.uid()
    AND a.status          = 'rejected'
    AND a.announcement_id = ann.id
    AND ann.status        = 'open'
    AND NOT is_block_between(a.mechanic_id, ann.driver_id);   -- Faza 18: perechea blocată nu recandidează
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_resubmittable';
  END IF;
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.seed_channel_push_prefs_for_channel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO channel_push_prefs (user_id, channel_id, enabled)
  SELECT p.id, NEW.id, true FROM profiles p WHERE p.deleted_at IS NULL
  ON CONFLICT (user_id, channel_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seed_channel_push_prefs_for_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO channel_push_prefs (user_id, channel_id, enabled)
  SELECT NEW.id, c.id, true FROM channels c
  ON CONFLICT (user_id, channel_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_announcement_source_lang()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.source_lang IS NULL THEN
    NEW.source_lang := user_lang(NEW.driver_id);
  END IF;
  NEW.source_lang_detected := false;          -- detecția reală vine doar din Edge Function
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'set_announcement_source_lang: %', SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_announcements_hidden(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE announcements a
     SET hidden_from_history = true
   WHERE a.driver_id = auth.uid()
     AND a.hidden_from_history = false
     AND (p_ids IS NULL OR a.id = ANY(p_ids));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.start_direct_conversation(p_mechanic_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_conv   uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_mechanic_id = v_caller THEN
    RAISE EXCEPTION 'cannot_contact_self';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_mechanic_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'target_not_mechanic';
  END IF;

  IF is_blocked_by(v_caller, p_mechanic_id) THEN
    RAISE EXCEPTION 'blocked_by_you';
  END IF;
  IF is_blocked_by(p_mechanic_id, v_caller) THEN
    RAISE EXCEPTION 'target_not_mechanic';   -- identic cu inexistent — nedetectabil
  END IF;

  SELECT id INTO v_conv
  FROM conversations
  WHERE is_direct
    AND ((driver_id = v_caller AND mechanic_id = p_mechanic_id)
      OR (driver_id = p_mechanic_id AND mechanic_id = v_caller))
  LIMIT 1;

  IF NOT FOUND THEN
    -- Trigger-ul ban_guard_ins de pe conversations se aplică și aici.
    INSERT INTO conversations (announcement_id, driver_id, mechanic_id, is_direct)
    VALUES (NULL, v_caller, p_mechanic_id, true)
    RETURNING id INTO v_conv;
  END IF;

  DELETE FROM conversation_deletions
  WHERE conversation_id = v_conv AND user_id = v_caller;

  RETURN v_conv;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_market_conversation(p_listing_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_buyer  uuid := auth.uid();
  v_seller uuid;
  v_status text;
  v_conv   uuid;
BEGIN
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT seller_id, status INTO v_seller, v_status
  FROM market_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'listing_not_active';
  END IF;
  IF v_seller = v_buyer THEN
    RAISE EXCEPTION 'cannot_contact_self';
  END IF;

  IF is_blocked_by(v_buyer, v_seller) THEN
    RAISE EXCEPTION 'blocked_by_you';
  END IF;
  IF is_blocked_by(v_seller, v_buyer) THEN
    RAISE EXCEPTION 'listing_not_found';       -- nedetectabil
  END IF;

  -- ORICE conversație existentă între cei doi, indiferent de direcție sau tip
  -- (depanare / directă / market) — cea mai recentă, deterministic.
  SELECT id INTO v_conv
  FROM conversations
  WHERE (driver_id = v_buyer AND mechanic_id = v_seller)
     OR (driver_id = v_seller AND mechanic_id = v_buyer)
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Conversație nouă „născută din market": listing_id = marcajul care ține
    -- garda de telefon închisă (etapa192). Trigger-ul de ban se aplică.
    INSERT INTO conversations (announcement_id, driver_id, mechanic_id, is_direct, listing_id)
    VALUES (NULL, v_buyer, v_seller, false, p_listing_id)
    RETURNING id INTO v_conv;
  END IF;

  -- Conversația ștearsă soft de cumpărător reapare la re-contactare.
  DELETE FROM conversation_deletions
  WHERE conversation_id = v_conv AND user_id = v_buyer;

  RETURN v_conv;
END;
$function$;

CREATE OR REPLACE FUNCTION public.storage_api_delete(p_bucket text, p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key  text;
  v_path text;
BEGIN
  IF p_name IS NULL OR p_name = '' THEN RETURN; END IF;

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key'
   LIMIT 1;
  IF v_key IS NULL THEN
    RAISE WARNING 'storage_api_delete: secretul service_role_key lipseste din Vault; % ramane orfan', p_name;
    RETURN;
  END IF;

  -- Căile sunt generate de aplicație (folder/uuid/uuid.ext) — sigure în URL; escape
  -- minimal doar pentru caracterele care ar rupe calea, dacă ar apărea vreodată.
  v_path := replace(replace(replace(replace(replace(p_name,
              '%', '%25'), ' ', '%20'), '#', '%23'), '?', '%3F'), '+', '%2B');

  PERFORM net.http_delete(
    url := 'https://shgagwnxgliixrzeibmt.supabase.co/storage/v1/object/' || p_bucket || '/' || v_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 10000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'storage_api_delete: % (%/%)', SQLERRM, p_bucket, p_name;
END; $function$;

CREATE OR REPLACE FUNCTION public.user_lang(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ SELECT COALESCE(lang, 'ro') FROM public.profiles WHERE id = p_user_id; $function$;

CREATE OR REPLACE FUNCTION public.withdraw_application(p_application_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM applications
  WHERE id = p_application_id
    AND mechanic_id = auth.uid()
    AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_found_or_not_pending';
  END IF;
END;
$function$;


-- ─── Chei străine ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE ONLY public.admin_audit_log ADD CONSTRAINT admin_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.profiles(id);
ALTER TABLE ONLY public.announcement_photos ADD CONSTRAINT announcement_photos_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.announcement_translations ADD CONSTRAINT announcement_translations_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.announcement_views ADD CONSTRAINT announcement_views_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.announcement_views ADD CONSTRAINT announcement_views_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_mechanic_id_fkey FOREIGN KEY (mechanic_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.applications ADD CONSTRAINT applications_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.applications ADD CONSTRAINT applications_mechanic_id_fkey FOREIGN KEY (mechanic_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.blocked_users ADD CONSTRAINT blocked_users_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.blocked_users ADD CONSTRAINT blocked_users_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.channel_messages ADD CONSTRAINT channel_messages_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.channel_messages ADD CONSTRAINT channel_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.channel_messages ADD CONSTRAINT channel_messages_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.market_listings(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.channel_messages ADD CONSTRAINT channel_messages_recommended_mechanic_id_fkey FOREIGN KEY (recommended_mechanic_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.channel_messages ADD CONSTRAINT channel_messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.channel_messages(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.channel_messages ADD CONSTRAINT channel_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.channel_push_prefs ADD CONSTRAINT channel_push_prefs_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.channel_push_prefs ADD CONSTRAINT channel_push_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.channel_push_state ADD CONSTRAINT channel_push_state_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.channel_push_state ADD CONSTRAINT channel_push_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.channel_reads ADD CONSTRAINT channel_reads_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.channel_reads ADD CONSTRAINT channel_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.client_diagnostics ADD CONSTRAINT client_diagnostics_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.conversation_deletions ADD CONSTRAINT conversation_deletions_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.conversation_deletions ADD CONSTRAINT conversation_deletions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.conversations ADD CONSTRAINT conversations_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.conversations ADD CONSTRAINT conversations_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.conversations ADD CONSTRAINT conversations_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.market_listings(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.conversations ADD CONSTRAINT conversations_mechanic_id_fkey FOREIGN KEY (mechanic_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.direct_push_state ADD CONSTRAINT direct_push_state_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.direct_push_state ADD CONSTRAINT direct_push_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.favorite_mechanics ADD CONSTRAINT favorite_mechanics_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.favorite_mechanics ADD CONSTRAINT favorite_mechanics_mechanic_id_fkey FOREIGN KEY (mechanic_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.market_listing_photos ADD CONSTRAINT market_listing_photos_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.market_listings(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.market_listings ADD CONSTRAINT market_listings_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.message_reads ADD CONSTRAINT message_reads_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.message_reads ADD CONSTRAINT message_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.market_listings(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_recommended_mechanic_id_fkey FOREIGN KEY (recommended_mechanic_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.messages(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.push_tokens ADD CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_mechanic_id_fkey FOREIGN KEY (mechanic_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.market_listings(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.search_history ADD CONSTRAINT search_history_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.search_history ADD CONSTRAINT search_history_mechanic_id_fkey FOREIGN KEY (mechanic_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.translation_requests ADD CONSTRAINT translation_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.trucks ADD CONSTRAINT trucks_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- ─── Indexuri (fără cele ale constrângerilor) ──────────────────────────────────────────────────

CREATE INDEX rate_events_user_kind_time ON app.rate_events USING btree (user_id, kind, created_at DESC);
CREATE INDEX announcement_views_viewer_idx ON public.announcement_views USING btree (viewer_id);
CREATE INDEX client_diagnostics_occurred_idx ON public.client_diagnostics USING btree (occurred_at DESC);
CREATE INDEX client_diagnostics_user_idx ON public.client_diagnostics USING btree (user_id, occurred_at DESC);
CREATE INDEX idx_admin_audit_created ON public.admin_audit_log USING btree (created_at DESC);
CREATE INDEX idx_announcement_photos_ann ON public.announcement_photos USING btree (announcement_id);
CREATE INDEX idx_announcements_driver ON public.announcements USING btree (driver_id);
CREATE INDEX idx_announcements_mechanic ON public.announcements USING btree (mechanic_id) WHERE (mechanic_id IS NOT NULL);
CREATE INDEX idx_announcements_open_geo ON public.announcements USING btree (latitude, longitude) WHERE (status = 'open'::text);
CREATE INDEX idx_announcements_status_created ON public.announcements USING btree (status, created_at DESC);
CREATE INDEX idx_applications_announcement ON public.applications USING btree (announcement_id);
CREATE INDEX idx_applications_mechanic ON public.applications USING btree (mechanic_id);
CREATE INDEX idx_blocked_users_blocked_blocker ON public.blocked_users USING btree (blocked_id, blocker_id);
CREATE INDEX idx_channel_messages_channel_created ON public.channel_messages USING btree (channel_id, created_at DESC);
CREATE INDEX idx_channel_push_prefs_channel_enabled ON public.channel_push_prefs USING btree (channel_id) WHERE enabled;
CREATE UNIQUE INDEX idx_channels_single_global ON public.channels USING btree (type) WHERE (type = 'global'::text);
CREATE UNIQUE INDEX idx_conversations_direct_pair ON public.conversations USING btree (driver_id, mechanic_id) WHERE is_direct;
CREATE INDEX idx_conversations_driver ON public.conversations USING btree (driver_id);
CREATE UNIQUE INDEX idx_conversations_market_pair ON public.conversations USING btree (listing_id, driver_id) WHERE (listing_id IS NOT NULL);
CREATE INDEX idx_conversations_mechanic ON public.conversations USING btree (mechanic_id);
CREATE INDEX idx_market_listing_photos_listing ON public.market_listing_photos USING btree (listing_id, "position");
CREATE INDEX idx_market_listings_category_active ON public.market_listings USING btree (category) WHERE (status = 'active'::text);
CREATE INDEX idx_market_listings_seller ON public.market_listings USING btree (seller_id, created_at DESC);
CREATE INDEX idx_market_listings_status_created ON public.market_listings USING btree (status, created_at DESC);
CREATE INDEX idx_messages_conversation_created ON public.messages USING btree (conversation_id, created_at DESC);
CREATE INDEX idx_profiles_mechanic_geo ON public.profiles USING btree (latitude, longitude) WHERE (role = 'mechanic'::text);
CREATE INDEX idx_profiles_mechanic_push ON public.profiles USING btree (role, push_enabled) WHERE (role = 'mechanic'::text);
CREATE INDEX idx_ratings_driver ON public.ratings USING btree (driver_id);
CREATE INDEX idx_ratings_mechanic ON public.ratings USING btree (mechanic_id);
CREATE INDEX idx_reports_reporter ON public.reports USING btree (reporter_id);
CREATE INDEX idx_reports_status_created ON public.reports USING btree (status, created_at DESC);
CREATE INDEX idx_search_history_recent ON public.search_history USING btree (driver_id, searched_at DESC);
CREATE INDEX idx_translation_requests_user_time ON public.translation_requests USING btree (user_id, requested_at DESC);
CREATE INDEX idx_trucks_driver ON public.trucks USING btree (driver_id);
CREATE INDEX push_tokens_device_token_idx ON public.push_tokens USING btree (device_token) WHERE (device_token IS NOT NULL);
CREATE INDEX push_tokens_user_id_idx ON public.push_tokens USING btree (user_id);
CREATE UNIQUE INDEX uq_reports_reporter_listing ON public.reports USING btree (reporter_id, listing_id) WHERE (listing_id IS NOT NULL);
CREATE UNIQUE INDEX uq_reports_reporter_message ON public.reports USING btree (reporter_id, message_id) WHERE (message_id IS NOT NULL);

-- ─── Triggere (public, app, auth.users) ────────────────────────────────────────────────────────

CREATE TRIGGER on_auth_user_deleted AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_deleted();
CREATE TRIGGER trg_announcement_photo_limit BEFORE INSERT ON public.announcement_photos FOR EACH ROW EXECUTE FUNCTION public.enforce_announcement_photo_limit();
CREATE TRIGGER aaa_rate_limit BEFORE INSERT OR UPDATE OF status ON public.announcements FOR EACH ROW EXECUTE FUNCTION app.limit_announcements();
CREATE TRIGGER announcements_guard_client BEFORE INSERT OR UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.guard_announcement_client_writes();
CREATE TRIGGER announcements_notify AFTER INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.on_announcement_notify();
CREATE TRIGGER announcements_set_source_lang BEFORE INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.set_announcement_source_lang();
CREATE TRIGGER announcements_updated_at BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER ban_guard_ins BEFORE INSERT OR UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.guard_not_banned();
CREATE TRIGGER trg_announcement_delete_tombstone BEFORE DELETE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.on_announcement_delete_tombstone_messages();
CREATE TRIGGER applications_accepted_notify AFTER UPDATE OF status ON public.applications FOR EACH ROW WHEN (new.status = 'accepted'::text AND old.status IS DISTINCT FROM 'accepted'::text) EXECUTE FUNCTION public.on_application_accepted_notify();
CREATE TRIGGER applications_notify AFTER INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION public.on_application_notify();
CREATE TRIGGER ban_guard_ins BEFORE INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION public.guard_not_banned();
CREATE TRIGGER trg_applications_updated_at BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER aaa_rate_limit BEFORE INSERT ON public.channel_messages FOR EACH ROW EXECUTE FUNCTION app.limit_channel_messages();
CREATE TRIGGER ban_guard_ins BEFORE INSERT ON public.channel_messages FOR EACH ROW EXECUTE FUNCTION public.guard_not_banned();
CREATE TRIGGER channel_messages_notify AFTER INSERT ON public.channel_messages FOR EACH ROW EXECUTE FUNCTION public.on_channel_message_notify();
CREATE TRIGGER channels_seed_channel_push_prefs AFTER INSERT ON public.channels FOR EACH ROW EXECUTE FUNCTION public.seed_channel_push_prefs_for_channel();
CREATE TRIGGER ban_guard_ins BEFORE INSERT ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.guard_not_banned();
CREATE TRIGGER ban_guard_ins BEFORE INSERT ON public.market_listing_photos FOR EACH ROW EXECUTE FUNCTION public.guard_not_banned();
CREATE TRIGGER trg_market_photo_limit BEFORE INSERT ON public.market_listing_photos FOR EACH ROW EXECUTE FUNCTION public.enforce_market_photo_limit();
CREATE TRIGGER aaa_rate_limit BEFORE INSERT ON public.market_listings FOR EACH ROW EXECUTE FUNCTION app.limit_market_listings();
CREATE TRIGGER ban_guard_ins BEFORE INSERT OR UPDATE ON public.market_listings FOR EACH ROW EXECUTE FUNCTION public.guard_not_banned();
CREATE TRIGGER market_listings_notify AFTER INSERT ON public.market_listings FOR EACH ROW EXECUTE FUNCTION public.on_market_listing_notify();
CREATE TRIGGER market_listings_updated_at BEFORE UPDATE ON public.market_listings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_listing_delete_tombstone BEFORE DELETE ON public.market_listings FOR EACH ROW EXECUTE FUNCTION public.on_listing_delete_tombstone_messages();
CREATE TRIGGER trg_market_listing_limit BEFORE INSERT OR UPDATE ON public.market_listings FOR EACH ROW EXECUTE FUNCTION public.enforce_market_listing_limit();
CREATE TRIGGER aaa_rate_limit BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION app.limit_messages();
CREATE TRIGGER ban_guard_ins BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.guard_not_banned();
CREATE TRIGGER messages_notify AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.on_message_notify();
CREATE TRIGGER profiles_guard_privileged BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();
CREATE TRIGGER profiles_seed_channel_push_prefs AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.seed_channel_push_prefs_for_profile();
CREATE TRIGGER trg_profile_delete_tombstone BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.on_profile_delete_tombstone_messages();
CREATE TRIGGER ban_guard_ins BEFORE INSERT OR UPDATE ON public.ratings FOR EACH ROW EXECUTE FUNCTION public.guard_not_banned();
CREATE TRIGGER ratings_recompute AFTER INSERT OR DELETE OR UPDATE ON public.ratings FOR EACH ROW EXECUTE FUNCTION public.ratings_after_change();
CREATE TRIGGER ratings_set_updated_at BEFORE UPDATE ON public.ratings FOR EACH ROW EXECUTE FUNCTION public.ratings_touch_updated_at();
CREATE TRIGGER aaa_rate_limit BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION app.limit_reports();
CREATE TRIGGER ban_guard_ins BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.guard_not_banned();
CREATE TRIGGER reports_snapshot BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.reports_snapshot_from_source();

-- ─── Row Level Security ────────────────────────────────────────────────────────────────────────

ALTER TABLE app.rate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_push_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_push_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_push_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorite_mechanics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_listing_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trucks ENABLE ROW LEVEL SECURITY;

-- ─── Politici (public, app, storage.objects) ───────────────────────────────────────────────────

CREATE POLICY audit_select_admin ON public.admin_audit_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY announcement_photos_delete ON public.announcement_photos AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.announcements a
  WHERE ((a.id = announcement_photos.announcement_id) AND (a.driver_id = auth.uid())))));
CREATE POLICY announcement_photos_insert ON public.announcement_photos AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.announcements a
  WHERE ((a.id = announcement_photos.announcement_id) AND (a.driver_id = auth.uid())))));
CREATE POLICY announcement_photos_select ON public.announcement_photos AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.announcements a
  WHERE ((a.id = announcement_photos.announcement_id) AND ((a.driver_id = auth.uid()) OR (a.mechanic_id = auth.uid()) OR ((a.status = 'open'::text) AND (EXISTS ( SELECT 1
           FROM public.profiles p
          WHERE ((p.id = auth.uid()) AND (p.role = 'mechanic'::text))))))))));
CREATE POLICY announcement_photos_select_admin ON public.announcement_photos AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY announcement_translations_select_visible ON public.announcement_translations AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.announcements a
  WHERE (a.id = announcement_translations.announcement_id))));
CREATE POLICY announcement_views_select_admin ON public.announcement_views AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY announcements_insert_admin ON public.announcements AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((driver_id = auth.uid()) AND public.is_admin()));
CREATE POLICY announcements_insert_driver ON public.announcements AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((driver_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'driver'::text))))));
CREATE POLICY announcements_insert_mechanic ON public.announcements AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((driver_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'mechanic'::text))))));
CREATE POLICY announcements_select_admin ON public.announcements AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY announcements_select_anon ON public.announcements AS PERMISSIVE FOR SELECT TO anon
  USING ((status = 'open'::text));
CREATE POLICY announcements_select_driver ON public.announcements AS PERMISSIVE FOR SELECT TO authenticated
  USING ((driver_id = auth.uid()));
CREATE POLICY announcements_select_mechanic_accepted ON public.announcements AS PERMISSIVE FOR SELECT TO authenticated
  USING ((mechanic_id = auth.uid()));
CREATE POLICY announcements_select_mechanic_open ON public.announcements AS PERMISSIVE FOR SELECT TO authenticated
  USING (((status = 'open'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'mechanic'::text))))));
CREATE POLICY announcements_select_not_blocked ON public.announcements AS RESTRICTIVE FOR SELECT TO authenticated
  USING (((driver_id = auth.uid()) OR (mechanic_id = auth.uid()) OR public.is_admin() OR (NOT public.is_block_between(driver_id, auth.uid()))));
CREATE POLICY announcements_update_cancel ON public.announcements AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((driver_id = auth.uid()) AND (status = 'open'::text)))
  WITH CHECK (((driver_id = auth.uid()) AND (status = 'cancelled'::text)));
CREATE POLICY announcements_update_resolve ON public.announcements AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((driver_id = auth.uid()) AND (status = 'accepted'::text)))
  WITH CHECK (((driver_id = auth.uid()) AND (status = 'resolved'::text)));
CREATE POLICY "driver can delete own non-accepted announcements" ON public.announcements AS PERMISSIVE FOR DELETE TO authenticated
  USING (((driver_id = auth.uid()) AND (status <> 'accepted'::text)));
CREATE POLICY app_versions_select_anon ON public.app_versions AS PERMISSIVE FOR SELECT TO anon
  USING (true);
CREATE POLICY app_versions_select_authenticated ON public.app_versions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() IS NOT NULL));
CREATE POLICY app_versions_update_admin ON public.app_versions AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
CREATE POLICY "driver sees applications to own announcements" ON public.applications AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.announcements
  WHERE ((announcements.id = applications.announcement_id) AND (announcements.driver_id = auth.uid())))));
CREATE POLICY "mechanic sees own applications" ON public.applications AS PERMISSIVE FOR SELECT TO authenticated
  USING ((mechanic_id = auth.uid()));
CREATE POLICY blocked_delete_own ON public.blocked_users AS PERMISSIVE FOR DELETE TO authenticated
  USING ((blocker_id = auth.uid()));
CREATE POLICY blocked_insert_own ON public.blocked_users AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((blocker_id = auth.uid()) AND (blocked_id <> auth.uid())));
CREATE POLICY blocked_select_own ON public.blocked_users AS PERMISSIVE FOR SELECT TO authenticated
  USING ((blocker_id = auth.uid()));
CREATE POLICY channel_messages_insert_own ON public.channel_messages AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((sender_id = auth.uid()));
CREATE POLICY channel_messages_select_anon ON public.channel_messages AS PERMISSIVE FOR SELECT TO anon
  USING (((deleted_at IS NULL) AND (created_at > (now() - '7 days'::interval))));
CREATE POLICY channel_messages_select_since_join ON public.channel_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() IS NOT NULL) AND ((created_at >= ( SELECT p.created_at
   FROM public.profiles p
  WHERE (p.id = ( SELECT auth.uid() AS uid)))) OR public.is_admin())));
CREATE POLICY channel_push_prefs_own ON public.channel_push_prefs AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY channel_reads_own ON public.channel_reads AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY channels_select_all ON public.channels AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() IS NOT NULL));
CREATE POLICY channels_select_anon ON public.channels AS PERMISSIVE FOR SELECT TO anon
  USING (true);
CREATE POLICY client_diagnostics_insert_own ON public.client_diagnostics AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY client_diagnostics_select_admin ON public.client_diagnostics AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "user manages own deletions" ON public.conversation_deletions AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY conversations_select_participant ON public.conversations AS PERMISSIVE FOR SELECT TO authenticated
  USING (((driver_id = auth.uid()) OR (mechanic_id = auth.uid())));
CREATE POLICY favorites_delete_own ON public.favorite_mechanics AS PERMISSIVE FOR DELETE TO authenticated
  USING ((driver_id = auth.uid()));
CREATE POLICY favorites_insert_own ON public.favorite_mechanics AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((driver_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = favorite_mechanics.mechanic_id) AND (p.role = 'mechanic'::text))))));
CREATE POLICY favorites_select_own ON public.favorite_mechanics AS PERMISSIVE FOR SELECT TO authenticated
  USING ((driver_id = auth.uid()));
CREATE POLICY market_photos_delete_seller ON public.market_listing_photos AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.market_listings l
  WHERE ((l.id = market_listing_photos.listing_id) AND (l.seller_id = auth.uid())))));
CREATE POLICY market_photos_insert_seller ON public.market_listing_photos AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.market_listings l
  WHERE ((l.id = market_listing_photos.listing_id) AND (l.seller_id = auth.uid())))));
CREATE POLICY market_photos_select ON public.market_listing_photos AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.market_listings l
  WHERE (l.id = market_listing_photos.listing_id))));
CREATE POLICY market_photos_select_anon ON public.market_listing_photos AS PERMISSIVE FOR SELECT TO anon
  USING ((EXISTS ( SELECT 1
   FROM public.market_listings l
  WHERE ((l.id = market_listing_photos.listing_id) AND (l.status = 'active'::text)))));
CREATE POLICY market_photos_update_seller ON public.market_listing_photos AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.market_listings l
  WHERE ((l.id = market_listing_photos.listing_id) AND (l.seller_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.market_listings l
  WHERE ((l.id = market_listing_photos.listing_id) AND (l.seller_id = auth.uid())))));
CREATE POLICY market_delete_own ON public.market_listings AS PERMISSIVE FOR DELETE TO authenticated
  USING ((seller_id = auth.uid()));
CREATE POLICY market_insert_own ON public.market_listings AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((seller_id = auth.uid()));
CREATE POLICY market_select_anon ON public.market_listings AS PERMISSIVE FOR SELECT TO anon
  USING ((status = 'active'::text));
CREATE POLICY market_select_authenticated ON public.market_listings AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() IS NOT NULL));
CREATE POLICY market_select_not_blocked ON public.market_listings AS RESTRICTIVE FOR SELECT TO authenticated
  USING (((seller_id = auth.uid()) OR public.is_admin() OR (NOT public.is_block_between(seller_id, auth.uid()))));
CREATE POLICY market_update_own ON public.market_listings AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((seller_id = auth.uid()))
  WITH CHECK ((seller_id = auth.uid()));
CREATE POLICY message_reads_select_participants ON public.message_reads AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = message_reads.conversation_id) AND ((c.driver_id = auth.uid()) OR (c.mechanic_id = auth.uid())))))));
CREATE POLICY "user manages own reads" ON public.message_reads AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY messages_insert_not_blocked ON public.messages AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT public.is_conversation_blocked(conversation_id)));
CREATE POLICY messages_insert_participant ON public.messages AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.conversations
  WHERE ((conversations.id = messages.conversation_id) AND ((conversations.driver_id = auth.uid()) OR (conversations.mechanic_id = auth.uid())))))));
CREATE POLICY messages_select_participant ON public.messages AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.conversations
  WHERE ((conversations.id = messages.conversation_id) AND ((conversations.driver_id = auth.uid()) OR (conversations.mechanic_id = auth.uid()))))));
CREATE POLICY profiles_insert_own ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = id));
CREATE POLICY profiles_select_all ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() IS NOT NULL));
CREATE POLICY profiles_select_anon ON public.profiles AS PERMISSIVE FOR SELECT TO anon
  USING (((deleted_at IS NULL) AND (NOT ((banned_at IS NOT NULL) AND ((banned_until IS NULL) OR (banned_until > now()))))));
CREATE POLICY profiles_update_own ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth.uid() = id));
CREATE POLICY push_tokens_delete_own ON public.push_tokens AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = auth.uid()));
CREATE POLICY push_tokens_insert_own ON public.push_tokens AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY push_tokens_select_own ON public.push_tokens AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
CREATE POLICY push_tokens_update_own ON public.push_tokens AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY ratings_delete_own ON public.ratings AS PERMISSIVE FOR DELETE TO authenticated
  USING ((driver_id = auth.uid()));
CREATE POLICY ratings_insert_own ON public.ratings AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((driver_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.announcements a
  WHERE ((a.driver_id = auth.uid()) AND (a.mechanic_id = ratings.mechanic_id) AND (a.status = 'resolved'::text))))));
CREATE POLICY ratings_select_all ON public.ratings AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() IS NOT NULL));
CREATE POLICY ratings_update_own ON public.ratings AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((driver_id = auth.uid()))
  WITH CHECK (((driver_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.announcements a
  WHERE ((a.driver_id = auth.uid()) AND (a.mechanic_id = ratings.mechanic_id) AND (a.status = 'resolved'::text))))));
CREATE POLICY reports_insert_own ON public.reports AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((reporter_id = auth.uid()));
CREATE POLICY reports_select_own ON public.reports AS PERMISSIVE FOR SELECT TO authenticated
  USING ((reporter_id = auth.uid()));
CREATE POLICY history_delete_own ON public.search_history AS PERMISSIVE FOR DELETE TO authenticated
  USING ((driver_id = auth.uid()));
CREATE POLICY history_insert_own ON public.search_history AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((driver_id = auth.uid()));
CREATE POLICY history_select_own ON public.search_history AS PERMISSIVE FOR SELECT TO authenticated
  USING ((driver_id = auth.uid()));
CREATE POLICY history_update_own ON public.search_history AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((driver_id = auth.uid()))
  WITH CHECK ((driver_id = auth.uid()));
CREATE POLICY "driver owns trucks" ON public.trucks AS PERMISSIVE FOR ALL TO authenticated
  USING ((driver_id = auth.uid()))
  WITH CHECK ((driver_id = auth.uid()));
CREATE POLICY photos_delete_announcement ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'announcements'::text) AND (EXISTS ( SELECT 1
   FROM public.announcements a
  WHERE ((a.id = app.uuid_or_null((storage.foldername(objects.name))[2])) AND (a.driver_id = auth.uid()))))));
CREATE POLICY photos_delete_avatar ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'avatars'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)));
CREATE POLICY photos_delete_market ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'market'::text) AND (EXISTS ( SELECT 1
   FROM public.market_listings l
  WHERE ((l.id = app.uuid_or_null((storage.foldername(objects.name))[2])) AND (l.seller_id = auth.uid()))))));
CREATE POLICY photos_insert_announcement ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'announcements'::text) AND app.storage_quota_ok() AND (EXISTS ( SELECT 1
   FROM public.announcements a
  WHERE ((a.id = app.uuid_or_null((storage.foldername(objects.name))[2])) AND (a.driver_id = auth.uid()))))));
CREATE POLICY photos_insert_avatar ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'avatars'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text) AND app.storage_quota_ok()));
CREATE POLICY photos_insert_channel ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'channel'::text) AND app.storage_quota_ok() AND (EXISTS ( SELECT 1
   FROM public.channels c
  WHERE (c.id = app.uuid_or_null((storage.foldername(objects.name))[2]))))));
CREATE POLICY photos_insert_chat ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'chat'::text) AND app.storage_quota_ok() AND (EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = app.uuid_or_null((storage.foldername(objects.name))[2])) AND ((c.driver_id = auth.uid()) OR (c.mechanic_id = auth.uid())))))));
CREATE POLICY photos_insert_market ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'market'::text) AND app.storage_quota_ok() AND (EXISTS ( SELECT 1
   FROM public.market_listings l
  WHERE ((l.id = app.uuid_or_null((storage.foldername(objects.name))[2])) AND (l.seller_id = auth.uid()))))));
CREATE POLICY photos_select_admin ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'photos'::text) AND public.is_admin()));
CREATE POLICY photos_select_announcement ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'announcements'::text) AND (EXISTS ( SELECT 1
   FROM public.announcements a
  WHERE ((a.id = app.uuid_or_null((storage.foldername(objects.name))[2])) AND ((a.driver_id = auth.uid()) OR (a.mechanic_id = auth.uid()) OR ((a.status = 'open'::text) AND (EXISTS ( SELECT 1
           FROM public.profiles p
          WHERE ((p.id = auth.uid()) AND (p.role = 'mechanic'::text)))))))))));
CREATE POLICY photos_select_avatar ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'avatars'::text)));
CREATE POLICY photos_select_avatar_anon ON storage.objects AS PERMISSIVE FOR SELECT TO anon
  USING (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'avatars'::text)));
CREATE POLICY photos_select_channel ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'channel'::text) AND (EXISTS ( SELECT 1
   FROM public.channels c
  WHERE (c.id = app.uuid_or_null((storage.foldername(objects.name))[2]))))));
CREATE POLICY photos_select_chat ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'chat'::text) AND (EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = app.uuid_or_null((storage.foldername(objects.name))[2])) AND ((c.driver_id = auth.uid()) OR (c.mechanic_id = auth.uid())))))));
CREATE POLICY photos_select_market ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'market'::text) AND (EXISTS ( SELECT 1
   FROM public.market_listings l
  WHERE (l.id = app.uuid_or_null((storage.foldername(objects.name))[2]))))));
CREATE POLICY photos_select_market_anon ON storage.objects AS PERMISSIVE FOR SELECT TO anon
  USING (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'market'::text) AND (EXISTS ( SELECT 1
   FROM public.market_listings l
  WHERE ((l.id = app.uuid_or_null((storage.foldername(objects.name))[2])) AND (l.status = 'active'::text))))));

-- ─── Drepturi (exact ca în producție: întâi REVOKE ALL, apoi GRANT-urile din catalog) ──────────

REVOKE ALL ON TABLE app.rate_events FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE app.rate_events TO service_role;
REVOKE ALL ON TABLE public.admin_audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.admin_audit_log TO service_role;
GRANT SELECT ON TABLE public.admin_audit_log TO authenticated;
REVOKE ALL ON TABLE public.announcement_photos FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.announcement_photos TO service_role;
GRANT INSERT, SELECT, DELETE ON TABLE public.announcement_photos TO authenticated;
REVOKE ALL ON TABLE public.announcement_translations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.announcement_translations TO authenticated;
GRANT ALL ON TABLE public.announcement_translations TO service_role;
REVOKE ALL ON TABLE public.announcement_views FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.announcement_views TO service_role;
GRANT SELECT ON TABLE public.announcement_views TO authenticated;
REVOKE ALL ON TABLE public.announcements FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.announcements TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE public.announcements TO authenticated;
GRANT SELECT (id, driver_id, description, location, status, created_at, truck_make, truck_model, truck_year, lat_approx, lng_approx) ON TABLE public.announcements TO anon;
REVOKE ALL ON TABLE public.app_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.app_versions TO service_role;
GRANT SELECT, UPDATE ON TABLE public.app_versions TO authenticated;
GRANT SELECT ON TABLE public.app_versions TO anon;
REVOKE ALL ON TABLE public.applications FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.applications TO service_role;
GRANT SELECT ON TABLE public.applications TO authenticated;
REVOKE ALL ON TABLE public.blocked_users FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.blocked_users TO service_role;
GRANT INSERT, SELECT, DELETE ON TABLE public.blocked_users TO authenticated;
REVOKE ALL ON TABLE public.channel_messages FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.channel_messages TO service_role;
GRANT INSERT, SELECT ON TABLE public.channel_messages TO authenticated;
GRANT SELECT (id, channel_id, sender_id, content, created_at, reply_to_id, listing_id, recommended_mechanic_id, announcement_id, mentions, has_image) ON TABLE public.channel_messages TO anon;
REVOKE ALL ON TABLE public.channel_push_prefs FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.channel_push_prefs TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE public.channel_push_prefs TO authenticated;
REVOKE ALL ON TABLE public.channel_push_state FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.channel_push_state TO service_role;
REVOKE ALL ON TABLE public.channel_reads FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.channel_reads TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE public.channel_reads TO authenticated;
REVOKE ALL ON TABLE public.channels FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.channels TO service_role;
GRANT SELECT ON TABLE public.channels TO authenticated;
GRANT SELECT (id, name, type, created_at) ON TABLE public.channels TO anon;
REVOKE ALL ON TABLE public.client_diagnostics FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.client_diagnostics TO service_role;
GRANT INSERT, SELECT ON TABLE public.client_diagnostics TO authenticated;
REVOKE ALL ON TABLE public.conversation_deletions FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.conversation_deletions TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE public.conversation_deletions TO authenticated;
REVOKE ALL ON TABLE public.conversations FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.conversations TO service_role;
GRANT SELECT ON TABLE public.conversations TO authenticated;
REVOKE ALL ON TABLE public.direct_push_state FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.direct_push_state TO service_role;
REVOKE ALL ON TABLE public.favorite_mechanics FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.favorite_mechanics TO service_role;
GRANT INSERT, SELECT, DELETE ON TABLE public.favorite_mechanics TO authenticated;
REVOKE ALL ON TABLE public.market_listing_photos FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.market_listing_photos TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE public.market_listing_photos TO authenticated;
GRANT SELECT (id, listing_id, storage_path, position) ON TABLE public.market_listing_photos TO anon;
REVOKE ALL ON TABLE public.market_listings FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.market_listings TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE public.market_listings TO authenticated;
GRANT SELECT (id, seller_id, title, description, price, currency, category, status, created_at) ON TABLE public.market_listings TO anon;
REVOKE ALL ON TABLE public.message_reads FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.message_reads TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE public.message_reads TO authenticated;
REVOKE ALL ON TABLE public.messages FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.messages TO service_role;
GRANT INSERT, SELECT ON TABLE public.messages TO authenticated;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT (id, full_name, role, created_at, specialization, activity_zone, rating_avg, rating_count, avatar_path, company_name) ON TABLE public.profiles TO anon;
REVOKE ALL ON TABLE public.push_tokens FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.push_tokens TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE public.push_tokens TO authenticated;
REVOKE ALL ON TABLE public.ratings FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.ratings TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE public.ratings TO authenticated;
REVOKE ALL ON TABLE public.reports FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.reports TO service_role;
GRANT INSERT, SELECT ON TABLE public.reports TO authenticated;
REVOKE ALL ON TABLE public.search_history FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.search_history TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE public.search_history TO authenticated;
REVOKE ALL ON TABLE public.translation_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.translation_requests TO service_role;
REVOKE ALL ON TABLE public.trucks FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.trucks TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE public.trucks TO authenticated;
REVOKE ALL ON TABLE public.guest_announcements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.guest_announcements TO anon;
GRANT SELECT ON TABLE public.guest_announcements TO authenticated;
REVOKE ALL ON TABLE public.guest_channel_messages FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.guest_channel_messages TO anon;
GRANT SELECT ON TABLE public.guest_channel_messages TO authenticated;
REVOKE ALL ON TABLE public.guest_channels FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.guest_channels TO anon;
GRANT SELECT ON TABLE public.guest_channels TO authenticated;
REVOKE ALL ON TABLE public.guest_market_listing_photos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.guest_market_listing_photos TO anon;
GRANT SELECT ON TABLE public.guest_market_listing_photos TO authenticated;
REVOKE ALL ON TABLE public.guest_market_listings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.guest_market_listings TO anon;
GRANT SELECT ON TABLE public.guest_market_listings TO authenticated;
REVOKE ALL ON TABLE public.guest_profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.guest_profiles TO anon;
GRANT SELECT ON TABLE public.guest_profiles TO authenticated;
REVOKE ALL ON SEQUENCE app.rate_events_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.translation_requests_id_seq FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION app.like_escape(p_query text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.like_escape(p_query text) TO anon;
GRANT EXECUTE ON FUNCTION app.like_escape(p_query text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.like_escape(p_query text) TO service_role;
REVOKE ALL ON FUNCTION app.limit_announcements() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.limit_channel_messages() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.limit_market_listings() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.limit_messages() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.limit_reports() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.rate_limit_ok(p_kind text, p_window interval, p_max integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app.search_norm(p_text text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.search_norm(p_text text) TO anon;
GRANT EXECUTE ON FUNCTION app.search_norm(p_text text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.search_norm(p_text text) TO service_role;
REVOKE ALL ON FUNCTION app.storage_quota_ok() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.storage_quota_ok() TO authenticated;
REVOKE ALL ON FUNCTION app.uuid_or_null(p_text text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.uuid_or_null(p_text text) TO anon;
GRANT EXECUTE ON FUNCTION app.uuid_or_null(p_text text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.uuid_or_null(p_text text) TO service_role;
REVOKE ALL ON FUNCTION public._purge_user_data(p_uid uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._purge_user_data(p_uid uuid) TO service_role;
REVOKE ALL ON FUNCTION public.accept_announcement(p_announcement_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_announcement(p_announcement_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.accept_application(p_application_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_application(p_application_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_application(p_application_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.admin_dashboard_stats() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO service_role;
REVOKE ALL ON FUNCTION public.admin_delete_announcement(p_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_announcement(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_announcement(p_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_delete_listing(p_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_listing(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_listing(p_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_delete_message(p_table text, p_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_message(p_table text, p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_message(p_table text, p_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_delete_review(p_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_review(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_review(p_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_list_channel_messages(p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_channel_messages(p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_channel_messages(p_limit integer) TO service_role;
REVOKE ALL ON FUNCTION public.admin_list_recent_announcements(p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_announcements(p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_announcements(p_limit integer) TO service_role;
REVOKE ALL ON FUNCTION public.admin_list_recent_listings(p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_listings(p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_listings(p_limit integer) TO service_role;
REVOKE ALL ON FUNCTION public.admin_list_recent_reviews(p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_reviews(p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_reviews(p_limit integer) TO service_role;
REVOKE ALL ON FUNCTION public.admin_list_reports(p_status text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(p_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(p_status text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_pending_reports_count() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_pending_reports_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pending_reports_count() TO service_role;
REVOKE ALL ON FUNCTION public.admin_purge_accounts(p_from timestamp with time zone, p_to timestamp with time zone, p_dry_run boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_purge_accounts(p_from timestamp with time zone, p_to timestamp with time zone, p_dry_run boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_purge_accounts(p_from timestamp with time zone, p_to timestamp with time zone, p_dry_run boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_report_context(p_table text, p_message_id uuid, p_before integer, p_after integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_report_context(p_table text, p_message_id uuid, p_before integer, p_after integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_context(p_table text, p_message_id uuid, p_before integer, p_after integer) TO service_role;
REVOKE ALL ON FUNCTION public.admin_report_conversation(p_report_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_report_conversation(p_report_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_conversation(p_report_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_search_announcements(p_query text, p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_announcements(p_query text, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_announcements(p_query text, p_limit integer) TO service_role;
REVOKE ALL ON FUNCTION public.admin_search_users(p_query text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_users(p_query text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_users(p_query text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_unban_user(p_uid uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_unban_user(p_uid uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unban_user(p_uid uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.admin_update_report_status(p_id uuid, p_status text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_report_status(p_id uuid, p_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_report_status(p_id uuid, p_status text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_user_detail(p_uid uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_user_detail(p_uid uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_detail(p_uid uuid) TO service_role;
REVOKE ALL ON FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) TO service_role;
REVOKE ALL ON FUNCTION public.block_user(p_target uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.block_user(p_target uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_user(p_target uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_push_token(p_token text, p_platform text, p_device_token text, p_previous_token text, p_app_build text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_push_token(p_token text, p_platform text, p_device_token text, p_previous_token text, p_app_build text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_token(p_token text, p_platform text, p_device_token text, p_previous_token text, p_app_build text) TO service_role;
REVOKE ALL ON FUNCTION public.delete_message(p_table text, p_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_message(p_table text, p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_message(p_table text, p_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.direct_push_allowed(p_user uuid, p_sender uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.direct_push_allowed(p_user uuid, p_sender uuid) TO service_role;
REVOKE ALL ON FUNCTION public.dismiss_application(p_application_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dismiss_application(p_application_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_application(p_application_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.distance_km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.distance_km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.distance_km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision) TO service_role;
REVOKE ALL ON FUNCTION public.edit_message(p_table text, p_id uuid, p_content text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.edit_message(p_table text, p_id uuid, p_content text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_message(p_table text, p_id uuid, p_content text) TO service_role;
REVOKE ALL ON FUNCTION public.enforce_announcement_photo_limit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_announcement_photo_limit() TO service_role;
REVOKE ALL ON FUNCTION public.enforce_market_listing_limit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_market_listing_limit() TO service_role;
REVOKE ALL ON FUNCTION public.enforce_market_photo_limit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_market_photo_limit() TO service_role;
REVOKE ALL ON FUNCTION public.get_driver_phone(p_driver_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_driver_phone(p_driver_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_driver_phone(p_driver_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_mechanic_phone(p_mechanic_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_mechanic_phone(p_mechanic_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mechanic_phone(p_mechanic_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_own_profile() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_own_profile() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_own_profile() TO authenticated;
REVOKE ALL ON FUNCTION public.guard_announcement_client_writes() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_announcement_client_writes() TO service_role;
REVOKE ALL ON FUNCTION public.guard_not_banned() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_not_banned() TO service_role;
REVOKE ALL ON FUNCTION public.guard_profile_privileged_columns() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_profile_privileged_columns() TO service_role;
REVOKE ALL ON FUNCTION public.guest_search_market(p_query text, p_category text, p_sort text, p_limit integer, p_offset integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guest_search_market(p_query text, p_category text, p_sort text, p_limit integer, p_offset integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.guest_search_market(p_query text, p_category text, p_sort text, p_limit integer, p_offset integer) TO anon;
REVOKE ALL ON FUNCTION public.guest_search_mechanics(p_query text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guest_search_mechanics(p_query text) TO service_role;
GRANT EXECUTE ON FUNCTION public.guest_search_mechanics(p_query text) TO anon;
REVOKE ALL ON FUNCTION public.handle_auth_user_deleted() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_auth_user_deleted() TO service_role;
REVOKE ALL ON FUNCTION public.is_admin(p_uid uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin(p_uid uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(p_uid uuid) TO service_role;
REVOKE ALL ON FUNCTION public.is_banned(p_uid uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_banned(p_uid uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_banned(p_uid uuid) TO service_role;
REVOKE ALL ON FUNCTION public.is_block_between(p_a uuid, p_b uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_block_between(p_a uuid, p_b uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_block_between(p_a uuid, p_b uuid) TO service_role;
REVOKE ALL ON FUNCTION public.is_blocked_by(p_blocker uuid, p_blocked uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_blocked_by(p_blocker uuid, p_blocked uuid) TO service_role;
REVOKE ALL ON FUNCTION public.is_conversation_blocked(p_conversation_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_conversation_blocked(p_conversation_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_blocked(p_conversation_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.notify_mechanics_new_announcement(p_announcement public.announcements) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_mechanics_new_announcement(p_announcement public.announcements) TO service_role;
REVOKE ALL ON FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb, p_tag text, p_ios_title text, p_ios_body text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb, p_tag text, p_ios_title text, p_ios_body text) TO service_role;
REVOKE ALL ON FUNCTION public.on_announcement_delete_tombstone_messages() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.on_announcement_delete_tombstone_messages() TO service_role;
REVOKE ALL ON FUNCTION public.on_announcement_notify() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.on_announcement_notify() TO service_role;
REVOKE ALL ON FUNCTION public.on_application_accepted_notify() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.on_application_accepted_notify() TO service_role;
REVOKE ALL ON FUNCTION public.on_application_notify() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.on_application_notify() TO service_role;
REVOKE ALL ON FUNCTION public.on_channel_message_notify() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.on_channel_message_notify() TO service_role;
REVOKE ALL ON FUNCTION public.on_listing_delete_tombstone_messages() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.on_listing_delete_tombstone_messages() TO service_role;
REVOKE ALL ON FUNCTION public.on_market_listing_notify() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.on_market_listing_notify() TO service_role;
REVOKE ALL ON FUNCTION public.on_message_notify() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.on_message_notify() TO service_role;
REVOKE ALL ON FUNCTION public.on_profile_delete_tombstone_messages() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.on_profile_delete_tombstone_messages() TO service_role;
REVOKE ALL ON FUNCTION public.purge_user_data() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_user_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_data() TO service_role;
REVOKE ALL ON FUNCTION public.push_text(p_lang text, p_key text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.push_text(p_lang text, p_key text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.push_text(p_lang text, p_key text) TO service_role;
REVOKE ALL ON FUNCTION public.ratings_after_change() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ratings_after_change() TO service_role;
REVOKE ALL ON FUNCTION public.ratings_touch_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ratings_touch_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.recompute_mechanic_rating(p_mechanic uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_mechanic_rating(p_mechanic uuid) TO service_role;
REVOKE ALL ON FUNCTION public.record_announcement_view(p_announcement_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_announcement_view(p_announcement_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_announcement_view(p_announcement_id uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.reject_application(p_application_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_application(p_application_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_application(p_application_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.reports_snapshot_from_source() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reports_snapshot_from_source() TO service_role;
REVOKE ALL ON FUNCTION public.repost_announcement(p_announcement_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.repost_announcement(p_announcement_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repost_announcement(p_announcement_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.resolve_open_announcement(p_announcement_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_open_announcement(p_announcement_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_open_announcement(p_announcement_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.resubmit_application(p_application_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resubmit_application(p_application_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_application(p_application_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) TO service_role;
REVOKE ALL ON FUNCTION public.search_market_listings(p_query text, p_category text, p_sort text, p_limit integer, p_offset integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_market_listings(p_query text, p_category text, p_sort text, p_limit integer, p_offset integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_market_listings(p_query text, p_category text, p_sort text, p_limit integer, p_offset integer) TO service_role;
REVOKE ALL ON FUNCTION public.search_mechanics(p_query text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_mechanics(p_query text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_mechanics(p_query text) TO service_role;
REVOKE ALL ON FUNCTION public.search_users(p_query text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_users(p_query text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_users(p_query text) TO service_role;
REVOKE ALL ON FUNCTION public.seed_channel_push_prefs_for_channel() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_channel_push_prefs_for_channel() TO service_role;
REVOKE ALL ON FUNCTION public.seed_channel_push_prefs_for_profile() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_channel_push_prefs_for_profile() TO service_role;
REVOKE ALL ON FUNCTION public.set_announcement_source_lang() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_announcement_source_lang() TO service_role;
REVOKE ALL ON FUNCTION public.set_announcements_hidden(p_ids uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_announcements_hidden(p_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_announcements_hidden(p_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.start_direct_conversation(p_mechanic_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_direct_conversation(p_mechanic_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_direct_conversation(p_mechanic_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.start_market_conversation(p_listing_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_market_conversation(p_listing_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_market_conversation(p_listing_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.storage_api_delete(p_bucket text, p_name text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_api_delete(p_bucket text, p_name text) TO service_role;
REVOKE ALL ON FUNCTION public.user_lang(p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_lang(p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_lang(p_user_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.withdraw_application(p_application_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_application(p_application_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_application(p_application_id uuid) TO service_role;

-- Funcții din extensii cu drepturi date explicit (unaccent, pentru căutarea fără diacritice)
GRANT EXECUTE ON FUNCTION extensions.unaccent(regdictionary, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION extensions.unaccent(text) TO PUBLIC, anon;

-- ─── Realtime: REPLICA IDENTITY și publicația supabase_realtime ────────────────────────────────

ALTER TABLE public.channel_messages REPLICA IDENTITY FULL;
ALTER TABLE public.channel_reads REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.message_reads REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF (SELECT puballtables FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'publicația supabase_realtime e FOR ALL TABLES; producția are doar tabelele listate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'channel_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'channel_reads') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_reads;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_reads') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- ─── Storage: bucket-ul photos ─────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('photos', 'photos', false, 57671680, ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/bmp', 'image/tiff', 'image/avif', 'video/*', 'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/3gpp2', 'video/3gp', 'video/m4v', 'video/x-m4v', 'video/mpeg', 'video/x-matroska', 'video/x-msvideo', 'audio/*', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/opus', 'audio/flac', 'audio/wav', 'audio/x-wav', 'audio/x-m4a', 'audio/webm', 'audio/amr', 'audio/3gpp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation', 'application/rtf', 'text/rtf', 'text/plain', 'text/csv', 'text/vcard', 'text/x-vcard', 'message/rfc822', 'application/vnd.ms-outlook', 'application/json', 'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed', 'application/vnd.rar', 'application/x-7z-compressed', 'application/gzip', 'application/x-tar', 'application/octet-stream']::text[])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── pg_cron: joburile de curățare ─────────────────────────────────────────────────────────────

SELECT cron.schedule('cleanup-announcements-hourly', '17 * * * *', $cron$
  select net.http_post(
    url     := 'https://shgagwnxgliixrzeibmt.supabase.co/functions/v1/cleanup-announcements',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'service_role_key' limit 1
      )
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$);
SELECT cron.schedule('cleanup-client-diagnostics-daily', '41 3 * * *', $cron$ DELETE FROM public.client_diagnostics WHERE occurred_at < now() - interval '90 days'; $cron$);
SELECT cron.schedule('cleanup-direct-push-state-daily', '53 3 * * *', $cron$ DELETE FROM public.direct_push_state WHERE last_pushed_at < now() - interval '7 days'; $cron$);
SELECT cron.schedule('cleanup-rate-events-daily', '47 3 * * *', $cron$ DELETE FROM app.rate_events WHERE created_at < now() - interval '8 days'; $cron$);
SELECT cron.schedule('cleanup-translation-requests-daily', '57 3 * * *', $cron$ DELETE FROM public.translation_requests WHERE requested_at < now() - interval '7 days'; $cron$);

RESET check_function_bodies;
