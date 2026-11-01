-- Faza 4.2b (PLAN_1.1_FIX #27 + #39, aprobat 25 oct, confirmat 31 oct §8-bis.4): întărire, după mutarea
-- tabelelor în `app` (20261101000100).
--
-- #27 Profilurile vizibile oaspeților (anon) nu mai sunt „toate cele neșterse și nebanate”, ci doar cele cu rost
--     public: mecanicii (prestatori), plus șoferii/adminii cu un anunț deschis, un anunț activ în Market sau un
--     mesaj în canal în ultimele 7 zile. Predicatul stă într-o singură funcție, app.profile_visible_to_anon(uid),
--     folosită de politica profiles_select_anon (pe app.profiles) și de politica Storage pentru avatare
--     (photos_select_avatar_anon). Pentru 1.0.x și web: pagina /p/<id> a unui șofer fără activitate recentă
--     dă „profil indisponibil” (text neutru existent: shareLanding.notFound / publicProfile.notFound), nu eroare.
-- #39 apply_to_announcement: doar mecanic sau admin (not_mechanic) și nu la propriul anunț (own_announcement).
--     Partea a doua din #39 (start_direct_conversation doar către mecanici sau relații existente) NU e aici:
--     review-ul din 1 nov a arătat că 1.0.6–1.0.8 pornesc conversații directe către orice utilizator din 8 locuri
--     („Contactează autorul” din feed, conversație nouă cu orice utilizator, share, profil public) — regula ar fi
--     stricat fluxul principal; rămâne decizie pentru David (PLAN §9, 1 nov).
-- Clienții 1.0.6–1.0.8: aceleași cereri; un șofer nu are buton de candidatură, deci nimic vizibil nu se schimbă.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ── 1. #27: predicatul public pentru anon ──────────────────────────────────────────────────────
CREATE FUNCTION app.profile_visible_to_anon(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM app.profiles p
     WHERE p.id = p_id
       AND p.deleted_at IS NULL
       AND NOT (p.banned_at IS NOT NULL AND (p.banned_until IS NULL OR p.banned_until > now()))
       AND (
         p.role = 'mechanic'
         OR EXISTS (SELECT 1 FROM app.announcements a WHERE a.driver_id = p.id AND a.status = 'open')
         OR EXISTS (SELECT 1 FROM public.market_listings l WHERE l.seller_id = p.id AND l.status = 'active')
         OR EXISTS (SELECT 1 FROM public.channel_messages cm
                     WHERE cm.sender_id = p.id AND cm.deleted_at IS NULL AND cm.created_at > now() - interval '7 days')
       )
  );
$function$;
REVOKE EXECUTE ON FUNCTION app.profile_visible_to_anon(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.profile_visible_to_anon(uuid) TO anon, service_role;

DROP POLICY profiles_select_anon ON app.profiles;
CREATE POLICY profiles_select_anon ON app.profiles AS PERMISSIVE FOR SELECT TO anon
  USING ((role = 'mechanic' AND deleted_at IS NULL AND NOT (banned_at IS NOT NULL AND (banned_until IS NULL OR banned_until > now())))
         OR app.profile_visible_to_anon(id));

DROP POLICY photos_select_avatar_anon ON storage.objects;
CREATE POLICY photos_select_avatar_anon ON storage.objects AS PERMISSIVE FOR SELECT TO anon
  USING (bucket_id = 'photos' AND (storage.foldername(name))[1] = 'avatars'
         AND app.profile_visible_to_anon(app.uuid_or_null((storage.foldername(name))[2])));

-- ── 2. #39: verificările de rol ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text DEFAULT 'RON'::text, p_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid;
  v_role text;
BEGIN
  -- #39 (faza 4.2b): candidează doar un mecanic sau un admin, și nu la propriul anunț.
  SELECT role INTO v_role FROM app.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('mechanic', 'admin') THEN
    RAISE EXCEPTION 'not_mechanic';
  END IF;

  SELECT driver_id INTO v_driver_id
  FROM app.announcements
  WHERE id = p_announcement_id AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'announcement_not_open';
  END IF;

  IF v_driver_id = auth.uid() THEN
    RAISE EXCEPTION 'own_announcement';
  END IF;

  IF is_block_between(v_driver_id, auth.uid()) THEN
    RAISE EXCEPTION 'announcement_not_open';   -- identic cu cazul de mai sus — nedetectabil
  END IF;

  INSERT INTO applications(announcement_id, mechanic_id, price_type, price_amount, currency, message)
  VALUES (p_announcement_id, auth.uid(), p_price_type, p_price_amount, p_currency, p_message);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) TO service_role;

-- ── 3. Verificări ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT qual FROM pg_policies WHERE schemaname = 'app' AND tablename = 'profiles' AND policyname = 'profiles_select_anon') NOT LIKE '%profile_visible_to_anon%' THEN
    RAISE EXCEPTION 'anon_profiles_predicate: politica profiles_select_anon nu folosește predicatul';
  END IF;
  IF (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'photos_select_avatar_anon') NOT LIKE '%profile_visible_to_anon%' THEN
    RAISE EXCEPTION 'anon_profiles_predicate: politica photos_select_avatar_anon nu folosește predicatul';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
