-- Rollback pentru 20261110000100_terms_consent (faza 8): app.profile_terms, app.consent_log și RPC-urile dispar; apply_retention revine la textul fazei 6. ATENȚIE: dovezile de acceptare SE PIERD (export înainte: SELECT * FROM app.consent_log).
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

NOTIFY pgrst, 'reload schema';
