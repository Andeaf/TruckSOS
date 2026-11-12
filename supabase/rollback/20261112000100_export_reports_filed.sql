-- Rollback pentru 20261112000100_export_reports_filed (Partea 0, 12 nov 2026): export_my_data revine la textul din
-- 20261110000100_terms_consent.sql (faza 8.2), copiat byte cu byte de același script care a generat migrarea — cheia
-- `reports_filed` dispare din export; nimic de date.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea: acest rollback ÎNAINTEA celor ale fazei 8.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.export_my_data()
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
  -- 2 cereri / 24 h (decizia lui David, 9 nov: un răspuns pierdut pe rețea slabă nu trebuie să blocheze o cerere GDPR o zi)
  IF NOT app.rate_limit_ok('export', interval '24 hours', 2) THEN
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
    -- faza 8.2: starea consimțământului (tabel separat de profil) și istoricul acceptărilor
    'terms', (SELECT to_jsonb(t) - 'user_id' FROM app.profile_terms t WHERE t.user_id = v_uid),
    'consent_log', (SELECT COALESCE(jsonb_agg(jsonb_build_object('version', l.version, 'accepted_at', l.accepted_at,
                             'age_confirmed', l.age_confirmed, 'source', l.source) ORDER BY l.accepted_at), '[]'::jsonb)
                      FROM app.consent_log l WHERE l.user_id = v_uid),
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
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.export_my_data()'::regprocedure) LIKE '%reports_filed%' THEN
    RAISE EXCEPTION 'rollback: cheia reports_filed a ramas in export_my_data';
  END IF;
END $$;
