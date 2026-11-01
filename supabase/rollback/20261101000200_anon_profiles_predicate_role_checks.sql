-- ROLLBACK pentru 20261101000200_anon_profiles_predicate_role_checks.sql — `BEGIN;` + fișier + `COMMIT;`.
-- Readuce politicile de anon pe profiluri și avatare la predicatul de dinainte (neșters, nebanat) și apply_to_announcement
-- la textul din 20261101000100 (identic cu producția, doar cu app. calificat). Verificat în CI cu amprenta catalogului.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP POLICY profiles_select_anon ON app.profiles;
CREATE POLICY profiles_select_anon ON app.profiles AS PERMISSIVE FOR SELECT TO anon
  USING (((deleted_at IS NULL) AND (NOT ((banned_at IS NOT NULL) AND ((banned_until IS NULL) OR (banned_until > now()))))));

DROP POLICY photos_select_avatar_anon ON storage.objects;
CREATE POLICY photos_select_avatar_anon ON storage.objects AS PERMISSIVE FOR SELECT TO anon
  USING (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = 'avatars'::text)));

DROP FUNCTION app.profile_visible_to_anon(uuid);

-- Funcțiile: textul din 20261101000100 (CREATE OR REPLACE păstrează ACL-ul).
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
  FROM app.announcements
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
$function$
;

NOTIFY pgrst, 'reload schema';

SELECT 'rollback anon_profiles_predicate_role_checks: predicat vechi = ' || (SELECT count(*) FROM pg_policies WHERE policyname IN ('profiles_select_anon','photos_select_avatar_anon') AND qual NOT LIKE '%profile_visible_to_anon%') || '/2' AS verificare;
