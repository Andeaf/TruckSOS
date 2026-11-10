-- Rollback pentru 20261110000100_terms_consent (faza 8): app.profile_terms, app.consent_log și RPC-urile dispar; apply_retention și export_my_data revin la textele fazei 6. ATENȚIE: dovezile de acceptare SE PIERD (export înainte: SELECT * FROM app.consent_log). DROP TABLE app.profile_terms scoate FK-ul către app.profiles și ia un lock scurt pe el: se rulează în afara orelor de vârf (lock_timeout 5 s).
-- Generat de .claude/wip/faza8/gen-sql.mjs; funcțiile restaurate sunt copiate byte cu byte din migrările originale.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea rollback-urilor fazei 8: 200 → 100.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.reports'::regclass AND attname = 'source' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'rollback 100: 20261110000200_public_reports e aplicata - ruleaza intai rollback-ul ei';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.accept_terms(text, text);
DROP FUNCTION IF EXISTS public.my_terms_status();
DROP TABLE IF EXISTS app.consent_log;
DROP TABLE IF EXISTS app.profile_terms;

-- app.apply_retention: textul din 20261109000500 (faza 6)
CREATE OR REPLACE FUNCTION app.apply_retention(p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  c_closed_days   constant interval := interval '90 days';
  c_draft_age     constant interval := interval '24 hours';
  c_views_days    constant interval := interval '90 days';
  c_reports_age   constant interval := interval '12 months';
  c_audit_age     constant interval := interval '12 months';
  c_conv_age      constant interval := interval '24 months';
  v_out   jsonb := jsonb_build_object('dry_run', p_dry_run, 'ran_at', now());
  v_n     integer;
  v_paths text[];
  v_ids   uuid[];
BEGIN
  -- 1. plăcuță / VIN / GPS pe anunțurile închise
  BEGIN
    IF p_dry_run THEN
      SELECT count(*) INTO v_n FROM app.announcements a
       WHERE a.status IN ('resolved', 'cancelled') AND a.updated_at < now() - c_closed_days
         AND (a.plate_number IS NOT NULL OR a.chassis_number IS NOT NULL OR a.latitude IS NOT NULL OR a.longitude IS NOT NULL);
    ELSE
      UPDATE app.announcements a
         SET plate_number = NULL, chassis_number = NULL, latitude = NULL, longitude = NULL
       WHERE a.status IN ('resolved', 'cancelled') AND a.updated_at < now() - c_closed_days
         AND (a.plate_number IS NOT NULL OR a.chassis_number IS NOT NULL OR a.latitude IS NOT NULL OR a.longitude IS NOT NULL);
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    v_out := v_out || jsonb_build_object('closed_announcements_anonymized', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('closed_announcements_error', SQLERRM);
  END;

  -- 2. ciorne abandonate (7.2)
  BEGIN
    SELECT COALESCE(array_agg(a.id), '{}') INTO v_ids FROM app.announcements a
     WHERE a.status = 'draft' AND a.created_at < now() - c_draft_age;
    IF NOT p_dry_run AND cardinality(v_ids) > 0 THEN
      SELECT COALESCE(array_agg(ap.storage_path), '{}') INTO v_paths FROM public.announcement_photos ap WHERE ap.announcement_id = ANY (v_ids);
      PERFORM app.storage_gc_enqueue(v_paths, 'expired_draft');
      DELETE FROM app.announcements a WHERE a.id = ANY (v_ids);
    END IF;
    v_out := v_out || jsonb_build_object('drafts_deleted', cardinality(v_ids));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('drafts_error', SQLERRM);
  END;

  -- 3. vizualizări
  BEGIN
    IF p_dry_run THEN
      SELECT count(*) INTO v_n FROM public.announcement_views v WHERE v.viewed_at < now() - c_views_days;
    ELSE
      DELETE FROM public.announcement_views v WHERE v.viewed_at < now() - c_views_days;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    v_out := v_out || jsonb_build_object('views_deleted', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('views_error', SQLERRM);
  END;

  -- 4. rapoarte închise
  BEGIN
    SELECT COALESCE(array_agg(r.id), '{}') INTO v_ids FROM public.reports r
     WHERE r.status IN ('reviewed', 'dismissed') AND r.created_at < now() - c_reports_age;
    IF NOT p_dry_run AND cardinality(v_ids) > 0 THEN
      -- image_path_snapshot NU e o copie: trigger-ul reports_snapshot_from_source copiază exact image_path-ul mesajului
      -- (review 9 nov). Se șterge din Storage DOAR dacă niciun mesaj viu (privat sau din canal) nu mai referă calea.
      SELECT COALESCE(array_agg(r.image_path_snapshot), '{}') INTO v_paths FROM public.reports r
       WHERE r.id = ANY (v_ids) AND r.image_path_snapshot IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.image_path = r.image_path_snapshot OR m.file_path = r.image_path_snapshot)
         AND NOT EXISTS (SELECT 1 FROM public.channel_messages cm WHERE cm.image_path = r.image_path_snapshot OR cm.file_path = r.image_path_snapshot);
      PERFORM app.storage_gc_enqueue(v_paths, 'expired_report_snapshot');
      DELETE FROM public.reports r WHERE r.id = ANY (v_ids);
    END IF;
    v_out := v_out || jsonb_build_object('reports_deleted', cardinality(v_ids));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('reports_error', SQLERRM);
  END;

  -- 5. jurnalul admin
  BEGIN
    IF p_dry_run THEN
      SELECT count(*) INTO v_n FROM public.admin_audit_log l WHERE l.created_at < now() - c_audit_age;
    ELSE
      DELETE FROM public.admin_audit_log l WHERE l.created_at < now() - c_audit_age;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    v_out := v_out || jsonb_build_object('audit_deleted', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('audit_error', SQLERRM);
  END;

  -- 6. conversații inactive de 24 luni (mesajele și citirile cad prin cascadă)
  BEGIN
    SELECT COALESCE(array_agg(c.id), '{}') INTO v_ids
      FROM public.conversations c
     WHERE c.created_at < now() - c_conv_age
       AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id AND m.created_at >= now() - c_conv_age);
    IF NOT p_dry_run AND cardinality(v_ids) > 0 THEN
      SELECT COALESCE(array_agg(p), '{}') INTO v_paths
        FROM (SELECT m.image_path AS p FROM public.messages m WHERE m.conversation_id = ANY (v_ids) AND m.image_path IS NOT NULL
              UNION ALL
              SELECT m.file_path FROM public.messages m WHERE m.conversation_id = ANY (v_ids) AND m.file_path IS NOT NULL) x;
      PERFORM app.storage_gc_enqueue(v_paths, 'expired_conversation');
      DELETE FROM public.conversations c WHERE c.id = ANY (v_ids);
    END IF;
    v_out := v_out || jsonb_build_object('conversations_deleted', cardinality(v_ids));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('conversations_error', SQLERRM);
  END;

  RAISE NOTICE 'apply_retention: %', v_out::text;
  RETURN v_out;
END;
$function$;
REVOKE EXECUTE ON FUNCTION app.apply_retention(boolean) FROM PUBLIC, anon, authenticated, service_role;

-- public.export_my_data: textul din 20261109000600 (faza 6.4)
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

NOTIFY pgrst, 'reload schema';
