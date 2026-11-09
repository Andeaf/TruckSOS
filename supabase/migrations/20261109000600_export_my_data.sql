-- Faza 6.4 (PLAN_1.1_FIX #45, art. 20 GDPR; plan: .claude/wip/faza6/PLAN-faza6.md): RPC `export_my_data()` — tot ce e AL
-- utilizatorului, ca jsonb, o dată pe zi (app.rate_limit_ok 'export', 24 h, 1 → altfel `rate_limited` cu DETAIL `export`).
-- Clientul 1.1 îl salvează ca `trucksos-export-<data>.json` și îl oferă prin foaia de partajare (expo-sharing) / download pe web.
--
-- Ce intră: profilul propriu (toate coloanele, inclusiv cele private — sunt ale lui), camioanele, anunțurile de depanare
-- (+ căile pozelor, nu URL-uri semnate), candidaturile (ale mecanicului; cu id-ul anunțului, fără datele șoferului),
-- anunțurile Market (+ căi poze), mesajele TRIMISE de el în chat privat și în canale (conținut, dată, conversație/canal,
-- căile atașamentelor — niciodată mesajele celorlalți), evaluările DATE, favoriții, blocările făcute de el, istoricul
-- căutărilor, preferințele de push pe canale, notificările de moderare primite, dispozitivele cu push (platformă + dată,
-- FĂRĂ token). Mesajele sunt plafonate la 10 000 (cele mai noi) cu `truncated: true`.
-- Ce NU intră: datele altor persoane (mesajele lor, telefonul mecanicului acceptat etc.), evaluările primite cu autorul
-- lor (sunt ale celorlalți; media/numărul sunt în profil), jurnalul admin.
-- SECURITY DEFINER cu auth.uid() → RLS-ul nu intervine, de aceea FIECARE SELECT filtrează explicit pe uid.
-- 1.0.x: nimic (RPC nou, neapelat).
--
-- Rollback: supabase/rollback/20261109000600_export_my_data.sql (DROP FUNCTION).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('app.rate_limit_ok(text, interval, integer)') IS NULL THEN RAISE EXCEPTION 'cere app.rate_limit_ok (faza 2)'; END IF;
  IF to_regclass('app.moderation_notices') IS NULL THEN RAISE EXCEPTION 'cere faza 3.3 (app.moderation_notices)'; END IF;
  IF to_regprocedure('public.export_my_data()') IS NOT NULL THEN RAISE EXCEPTION 'export_my_data exista deja'; END IF;
END $$;

CREATE FUNCTION public.export_my_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  c_msg_cap constant integer := 10000;
  v_msgs jsonb;
  v_msgs_total bigint;
  v_cmsgs jsonb;
  v_cmsgs_total bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT app.rate_limit_ok('export', interval '24 hours', 1) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'export';
  END IF;

  SELECT count(*) INTO v_msgs_total FROM public.messages m WHERE m.sender_id = v_uid;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_msgs
    FROM (SELECT m.id, m.conversation_id, m.content, m.created_at, m.edited_at, m.deleted_at, m.reply_to_id,
                 m.image_path, m.file_path, m.file_name, m.file_size, m.listing_id, m.announcement_id
            FROM public.messages m WHERE m.sender_id = v_uid ORDER BY m.created_at DESC LIMIT c_msg_cap) x;

  SELECT count(*) INTO v_cmsgs_total FROM public.channel_messages cm WHERE cm.sender_id = v_uid;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_cmsgs
    FROM (SELECT cm.id, cm.channel_id, cm.content, cm.created_at, cm.edited_at, cm.deleted_at, cm.reply_to_id,
                 cm.image_path, cm.file_path, cm.file_name, cm.listing_id, cm.announcement_id
            FROM public.channel_messages cm WHERE cm.sender_id = v_uid ORDER BY cm.created_at DESC LIMIT c_msg_cap) x;

  RETURN jsonb_build_object(
    'exported_at', now(),
    'user_id', v_uid,
    'profile', (SELECT to_jsonb(p) FROM app.profiles p WHERE p.id = v_uid),
    'trucks', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.trucks t WHERE t.driver_id = v_uid),
    'announcements', (
      SELECT COALESCE(jsonb_agg(
               to_jsonb(a) - 'lat_approx' - 'lng_approx'
               || jsonb_build_object('photos', (SELECT COALESCE(jsonb_agg(ap.storage_path ORDER BY ap.created_at), '[]'::jsonb)
                                                   FROM public.announcement_photos ap WHERE ap.announcement_id = a.id))
               ORDER BY a.created_at), '[]'::jsonb)
        FROM app.announcements a WHERE a.driver_id = v_uid),
    'applications', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ap.id, 'announcement_id', ap.announcement_id, 'price_type', ap.price_type,
               'price_amount', ap.price_amount, 'currency', ap.currency, 'message', ap.message, 'status', ap.status,
               'created_at', ap.created_at, 'updated_at', ap.updated_at) ORDER BY ap.created_at), '[]'::jsonb)
        FROM public.applications ap WHERE ap.mechanic_id = v_uid),
    'market_listings', (
      SELECT COALESCE(jsonb_agg(
               to_jsonb(l) || jsonb_build_object('photos', (SELECT COALESCE(jsonb_agg(mp.storage_path ORDER BY mp.position), '[]'::jsonb)
                                                              FROM public.market_listing_photos mp WHERE mp.listing_id = l.id))
               ORDER BY l.created_at), '[]'::jsonb)
        FROM public.market_listings l WHERE l.seller_id = v_uid),
    'messages_sent', jsonb_build_object('total', v_msgs_total, 'truncated', v_msgs_total > c_msg_cap, 'items', v_msgs),
    'channel_messages_sent', jsonb_build_object('total', v_cmsgs_total, 'truncated', v_cmsgs_total > c_msg_cap, 'items', v_cmsgs),
    'ratings_given', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('mechanic_id', r.mechanic_id, 'stars', r.stars, 'comment', r.comment,
               'created_at', r.created_at, 'updated_at', r.updated_at) ORDER BY r.created_at), '[]'::jsonb)
        FROM public.ratings r WHERE r.driver_id = v_uid),
    'favorite_mechanics', (SELECT COALESCE(jsonb_agg(jsonb_build_object('mechanic_id', f.mechanic_id, 'created_at', f.created_at) ORDER BY f.created_at), '[]'::jsonb)
                             FROM public.favorite_mechanics f WHERE f.driver_id = v_uid),
    'blocked_users', (SELECT COALESCE(jsonb_agg(jsonb_build_object('blocked_id', b.blocked_id, 'created_at', b.created_at) ORDER BY b.created_at), '[]'::jsonb)
                        FROM public.blocked_users b WHERE b.blocker_id = v_uid),
    'search_history', (SELECT COALESCE(jsonb_agg(jsonb_build_object('mechanic_id', s.mechanic_id, 'searched_at', s.searched_at) ORDER BY s.searched_at), '[]'::jsonb)
                         FROM public.search_history s WHERE s.driver_id = v_uid),
    'channel_push_prefs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('channel_id', c.channel_id, 'enabled', c.enabled, 'updated_at', c.updated_at)), '[]'::jsonb)
                             FROM public.channel_push_prefs c WHERE c.user_id = v_uid),
    'moderation_notices', (SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY n.created_at), '[]'::jsonb) FROM app.moderation_notices n WHERE n.user_id = v_uid),
    'push_devices', (SELECT COALESCE(jsonb_agg(jsonb_build_object('platform', pt.platform, 'app_build', pt.app_build, 'updated_at', pt.updated_at)), '[]'::jsonb)
                       FROM public.push_tokens pt WHERE pt.user_id = v_uid)
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.export_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_my_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data() TO service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.export_my_data()', 'EXECUTE') THEN RAISE EXCEPTION 'export_my_data nu trebuie sa fie executabil de anon'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.export_my_data()', 'EXECUTE') THEN RAISE EXCEPTION 'export_my_data trebuie sa fie executabil de authenticated'; END IF;
END $$;

NOTIFY pgrst, 'reload schema';
