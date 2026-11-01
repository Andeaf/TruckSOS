-- Faza 4.3 (PLAN_1.1_FIX #9 + D12-bis §8-bis.2): feed-ul pe rază al mecanicului se calculează pe server, iar
-- notarea unui mecanic trece printr-un RPC (nu upsert direct pe `ratings`), ca la decommission (11.9 (e))
-- mascarea `ratings.driver_id` să fie doar o migrare, fără build nou.
--
--   open_announcements_near(p_lat, p_lng, p_radius_km, p_limit, p_before)  → anunțurile deschise ale altora,
--       cu distanța față de poziția dată, filtrate pe rază (cele fără coordonate rămân, ca în client), ordonate
--       după distanță când e rază (fără paginare: p_before e ignorat), altfel după created_at DESC cu cursor p_before; SECURITY INVOKER (RLS-ul de pe
--       app.announcements decide ce vede fiecare), coordonatele mascate exact ca în view (șoferul, mecanicul
--       acceptat și adminul văd exact; ceilalți ~1 km), fără plate_number/chassis_number; plus numele și
--       avatarul șoferului. Cel mult 100 de rânduri.
--   open_announcements_near_count(p_lat, p_lng, p_radius_km, p_since) → câte anunțuri noi (bulina Feed).
--   guest_announcements_near(…) → același lucru pentru oaspeți, peste guest_announcements (doar ~1 km).
--   rate_mechanic(p_mechanic_id, p_stars, p_comment) → upsert-ul din use-ratings.ts, pe server; SECURITY INVOKER,
--       deci politicile ratings_insert_own / ratings_update_own se aplică neschimbate.
-- Clienții 1.0.6–1.0.8 nu apelează nimic de aici; nimic nu se schimbă pentru ei.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.open_announcements_near(
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_radius_km double precision DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_before timestamp with time zone DEFAULT NULL)
 RETURNS TABLE(id uuid, driver_id uuid, description text, location text, status text, mechanic_id uuid,
               created_at timestamp with time zone, updated_at timestamp with time zone,
               truck_make text, truck_model text, truck_year smallint,
               latitude double precision, longitude double precision, hidden_from_history boolean,
               lat_approx numeric, lng_approx numeric, source_lang text, source_lang_detected boolean,
               distance_km double precision, driver_full_name text, driver_avatar_path text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH me AS (
    SELECT auth.uid() AS uid,
           (current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) AS privileged,
           CASE WHEN p_radius_km IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN p_radius_km END AS radius
  ),
  cand AS (
    SELECT a.id, a.driver_id, a.description, a.location, a.status, a.mechanic_id, a.created_at, a.updated_at,
           a.truck_make, a.truck_model, a.truck_year, a.hidden_from_history, a.lat_approx, a.lng_approx,
           a.source_lang, a.source_lang_detected,
           CASE WHEN a.driver_id = me.uid OR a.mechanic_id = me.uid OR me.privileged THEN a.latitude  ELSE a.lat_approx::double precision END AS lat,
           CASE WHEN a.driver_id = me.uid OR a.mechanic_id = me.uid OR me.privileged THEN a.longitude ELSE a.lng_approx::double precision END AS lng,
           me.radius
      FROM app.announcements a, me
     WHERE a.status = 'open'
       AND a.driver_id IS DISTINCT FROM me.uid
       -- cursorul created_at are sens doar fără rază (cu rază ordonarea e după distanță și nu există paginare)
       AND (p_before IS NULL OR me.radius IS NOT NULL OR a.created_at < p_before)
       -- cutia de delimitare pe indexul idx_announcements_open_geo (coordonatele exacte), cu o margine de 0,01°
       -- peste eroarea de rotunjire (≤ 0,005°): includerea în rezultat depinde DOAR de poziția mascată (cercul de
       -- mai jos), altfel un mecanic neacceptat ar putea triangula poziția exactă din raze succesive (review 1 nov).
       AND (me.radius IS NULL OR a.latitude IS NULL
            OR (a.latitude  BETWEEN p_lat - (me.radius / 111.0 + 0.01) AND p_lat + (me.radius / 111.0 + 0.01)
                AND a.longitude BETWEEN p_lng - (me.radius / (111.0 * greatest(cos(radians(p_lat)), 0.01)) + 0.01)
                                    AND p_lng + (me.radius / (111.0 * greatest(cos(radians(p_lat)), 0.01)) + 0.01)))
  ),
  dist AS (
    SELECT r.*,
           CASE WHEN r.lat IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN NULL
                ELSE public.distance_km(p_lat, p_lng, r.lat, r.lng) END AS d
      FROM cand r
  )
  SELECT d.id, d.driver_id, d.description, d.location, d.status, d.mechanic_id, d.created_at, d.updated_at,
         d.truck_make, d.truck_model, d.truck_year, d.lat, d.lng, d.hidden_from_history, d.lat_approx, d.lng_approx,
         d.source_lang, d.source_lang_detected, d.d, p.full_name, p.avatar_path
    FROM dist d
    JOIN app.profiles p ON p.id = d.driver_id
   WHERE d.radius IS NULL OR d.d IS NULL OR d.d <= d.radius
   ORDER BY CASE WHEN d.radius IS NOT NULL THEN d.d END ASC NULLS LAST, d.created_at DESC
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 100);
$function$;
REVOKE EXECUTE ON FUNCTION public.open_announcements_near(double precision, double precision, double precision, integer, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_announcements_near(double precision, double precision, double precision, integer, timestamp with time zone) TO authenticated, service_role;

CREATE FUNCTION public.open_announcements_near_count(
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_radius_km double precision DEFAULT NULL,
  p_since timestamp with time zone DEFAULT NULL)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- Aceeași regulă ca open_announcements_near (RLS, excluderea propriilor anunțuri, cele fără coordonate rămân,
  -- cercul pe coordonatele mascate), dar fără LIMIT: bulina nu trebuie să rateze un anunț nou doar pentru că e departe.
  WITH me AS (
    SELECT auth.uid() AS uid,
           (current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) AS privileged,
           CASE WHEN p_radius_km IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN p_radius_km END AS radius
  ),
  cand AS (
    SELECT CASE WHEN a.driver_id = me.uid OR a.mechanic_id = me.uid OR me.privileged THEN a.latitude  ELSE a.lat_approx::double precision END AS lat,
           CASE WHEN a.driver_id = me.uid OR a.mechanic_id = me.uid OR me.privileged THEN a.longitude ELSE a.lng_approx::double precision END AS lng,
           me.radius
      FROM app.announcements a, me
     WHERE a.status = 'open'
       AND a.driver_id IS DISTINCT FROM me.uid
       AND (p_since IS NULL OR a.created_at > p_since)
       AND (me.radius IS NULL OR a.latitude IS NULL
            OR (a.latitude  BETWEEN p_lat - (me.radius / 111.0 + 0.01) AND p_lat + (me.radius / 111.0 + 0.01)
                AND a.longitude BETWEEN p_lng - (me.radius / (111.0 * greatest(cos(radians(p_lat)), 0.01)) + 0.01)
                                    AND p_lng + (me.radius / (111.0 * greatest(cos(radians(p_lat)), 0.01)) + 0.01)))
  )
  SELECT count(*)::integer
    FROM cand c
   WHERE c.radius IS NULL OR c.lat IS NULL OR public.distance_km(p_lat, p_lng, c.lat, c.lng) <= c.radius;
$function$;
REVOKE EXECUTE ON FUNCTION public.open_announcements_near_count(double precision, double precision, double precision, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_announcements_near_count(double precision, double precision, double precision, timestamp with time zone) TO authenticated, service_role;

-- Oaspeții: peste guest_announcements (RLS-ul anon de pe app.announcements: doar deschise; coloanele publice, ~1 km).
GRANT EXECUTE ON FUNCTION public.distance_km(double precision, double precision, double precision, double precision) TO anon;
CREATE FUNCTION public.guest_announcements_near(
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_radius_km double precision DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_before timestamp with time zone DEFAULT NULL)
 RETURNS TABLE(id uuid, driver_id uuid, description text, location text, status text,
               created_at timestamp with time zone, truck_make text, truck_model text, truck_year smallint,
               lat_approx numeric, lng_approx numeric, distance_km double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH g AS (
    SELECT ga.*,
           CASE WHEN p_radius_km IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN p_radius_km END AS radius,
           CASE WHEN ga.lat_approx IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN NULL
                ELSE public.distance_km(p_lat, p_lng, ga.lat_approx::double precision, ga.lng_approx::double precision) END AS d
      FROM public.guest_announcements ga
     WHERE ga.status = 'open'
       AND (p_before IS NULL OR (p_radius_km IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL) OR ga.created_at < p_before)
  )
  SELECT g.id, g.driver_id, g.description, g.location, g.status, g.created_at, g.truck_make, g.truck_model, g.truck_year,
         g.lat_approx, g.lng_approx, g.d
    FROM g
   WHERE g.radius IS NULL OR g.d IS NULL OR g.d <= g.radius
   ORDER BY CASE WHEN g.radius IS NOT NULL THEN g.d END ASC NULLS LAST, g.created_at DESC
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 100);
$function$;
REVOKE EXECUTE ON FUNCTION public.guest_announcements_near(double precision, double precision, double precision, integer, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_announcements_near(double precision, double precision, double precision, integer, timestamp with time zone) TO anon, service_role;

-- Notarea unui mecanic: exact upsert-ul din use-ratings.ts (ON CONFLICT (mechanic_id, driver_id)), ca invocator.
CREATE FUNCTION public.rate_mechanic(p_mechanic_id uuid, p_stars smallint, p_comment text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  INSERT INTO public.ratings (mechanic_id, driver_id, stars, comment)
  VALUES (p_mechanic_id, auth.uid(), p_stars, p_comment)
  ON CONFLICT (mechanic_id, driver_id) DO UPDATE
    SET stars = EXCLUDED.stars, comment = EXCLUDED.comment;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rate_mechanic(uuid, smallint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_mechanic(uuid, smallint, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
