-- Faza 6.3 (PLAN_1.1_FIX #25; plan: .claude/wip/faza6/PLAN-faza6.md, decizia D5 + retenția conversațiilor 24 luni
-- decisă de David 8 nov 2026): `app.apply_retention(p_dry_run)` rulată zilnic de cron. Fiecare regulă e într-un bloc
-- propriu cu EXCEPTION (o eroare nu oprește restul) și contoarele se întorc ca jsonb (+ RAISE NOTICE).
--   1. anunțuri închise (resolved / cancelled) cu updated_at mai vechi de 90 zile → plate_number, chassis_number,
--      latitude, longitude = NULL (lat_approx / lng_approx sunt GENERATED → devin NULL singure; `location` rămâne);
--   2. ciorne (7.2) mai vechi de 24 h → pozele în app.storage_gc_queue, apoi DELETE;
--   3. announcement_views mai vechi de 90 zile → DELETE;
--   4. reports închise (reviewed / dismissed) mai vechi de 12 luni → image_path_snapshot în coadă, DELETE (pending nu expiră);
--   5. admin_audit_log mai vechi de 12 luni → DELETE;
--   6. conversații fără niciun mesaj mai nou de 24 luni (sau fără mesaje și create acum > 24 luni) → atașamentele
--      (image_path, file_path) în coadă, DELETE FROM conversations (cascadă: messages, message_reads, conversation_deletions).
--   7. admin_update_profile: `details.old` / `details.new` păstrează doar cheile atinse, iar pentru phone / address /
--      vat_number / contact_email un hash scurt (left(md5, 8)) în loc de valoare — trasabilitate fără copia datelor personale.
-- Ștergerile de obiecte Storage NU folosesc storage_api_delete (service_role prin pg_net): merg prin coadă → EF storage-gc.
-- Trigger-ele de pe app.announcements la pasul 1: guard-ul iese (current_user = postgres), limit iese (auth.uid() NULL),
-- reopen_clears_mechanic e pe accepted → open; UPDATE-ul nu schimbă status.
-- Prima rulare pe producție: David rulează `SELECT app.apply_retention(true)` (dry-run: doar contoare) și citește cifrele.
-- Politica de confidențialitate (faza 8) declară exact aceste termene.
--
-- Rollback: supabase/rollback/20261109000500_retention.sql (cron scos, funcția ștearsă, admin_update_profile înapoi la
-- textul din 20261101000100; datele deja șterse/anonimizate NU revin).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('app.storage_gc_queue') IS NULL THEN RAISE EXCEPTION 'cere 20261109000400_storage_gc'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app.announcements'::regclass AND conname = 'announcements_status_check'
                   AND pg_get_constraintdef(oid) LIKE '%draft%') THEN
    RAISE EXCEPTION 'cere 20261109000100_announcement_drafts';
  END IF;
  IF to_regprocedure('app.apply_retention(boolean)') IS NOT NULL THEN RAISE EXCEPTION 'app.apply_retention exista deja'; END IF;
END $$;

-- ── 1. Retenția ─────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.apply_retention(p_dry_run boolean DEFAULT false)
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

SELECT cron.schedule('apply-retention-daily', '5 4 * * *', $cron$ SELECT app.apply_retention(false); $cron$);

-- ── 2. admin_update_profile: auditul fără datele personale în clar ────────────────────────────────
-- Textul din 20261101000100, cu o singură schimbare: `details.old` / `details.new` trec prin app.audit_mask_profile_fields()
-- (hash scurt pentru phone / address / vat_number / contact_email; restul cheilor ca înainte). Semnătura și drepturile
-- neschimbate (CREATE OR REPLACE păstrează ACL-ul; le rescriem explicit, identic).
CREATE FUNCTION app.audit_mask_profile_fields(p_fields jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT COALESCE(jsonb_object_agg(
           e.key,
           CASE WHEN e.key IN ('phone', 'address', 'vat_number', 'contact_email')
                THEN CASE WHEN e.value IS NULL OR jsonb_typeof(e.value) = 'null' OR NULLIF(btrim(e.value #>> '{}'), '') IS NULL
                          THEN to_jsonb(''::text)
                          ELSE to_jsonb('#' || left(md5(e.value #>> '{}'), 8)) END
                ELSE e.value END),
         '{}'::jsonb)
    FROM jsonb_each(COALESCE(p_fields, '{}'::jsonb)) e;
$function$;
REVOKE EXECUTE ON FUNCTION app.audit_mask_profile_fields(jsonb) FROM PUBLIC, anon, authenticated, service_role;

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
  FROM app.profiles WHERE id = p_uid FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;

  -- UPDATE STATIC (fără SQL dinamic — zero risc de injecție prin numele cheilor):
  -- doar cheile PREZENTE în p_fields se modifică; valoare goală/null → coloana devine NULL.
  UPDATE app.profiles SET
    full_name      = CASE WHEN p_fields ? 'full_name'      THEN trim(p_fields->>'full_name')                ELSE full_name      END,
    phone          = CASE WHEN p_fields ? 'phone'          THEN nullif(trim(p_fields->>'phone'), '')          ELSE phone          END,
    address        = CASE WHEN p_fields ? 'address'        THEN nullif(trim(p_fields->>'address'), '')        ELSE address        END,
    vat_number     = CASE WHEN p_fields ? 'vat_number'     THEN nullif(trim(p_fields->>'vat_number'), '')     ELSE vat_number     END,
    specialization = CASE WHEN p_fields ? 'specialization' THEN nullif(trim(p_fields->>'specialization'), '') ELSE specialization END,
    activity_zone  = CASE WHEN p_fields ? 'activity_zone'  THEN nullif(trim(p_fields->>'activity_zone'), '')  ELSE activity_zone  END,
    company_name   = CASE WHEN p_fields ? 'company_name'   THEN nullif(trim(p_fields->>'company_name'), '')   ELSE company_name   END,
    contact_email  = CASE WHEN p_fields ? 'contact_email'  THEN nullif(trim(p_fields->>'contact_email'), '')  ELSE contact_email  END
  WHERE id = p_uid;

  -- Trasabilitate: doar cheile atinse; telefonul / adresa / CUI-ul / e-mailul ca hash scurt (faza 6.3, #25),
  -- nu în clar — jurnalul se păstrează 12 luni și nu trebuie să fie a doua copie a datelor personale.
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'update_profile', 'user', p_uid,
    jsonb_build_object(
      'old', app.audit_mask_profile_fields((SELECT jsonb_object_agg(k, v_old -> k) FROM jsonb_object_keys(p_fields) AS k)),
      'new', app.audit_mask_profile_fields(p_fields)
    )
  );
END; $function$;
REVOKE EXECUTE ON FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb) TO service_role;

-- ── 3. Verificări ───────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apply-retention-daily') THEN RAISE EXCEPTION 'cron apply-retention-daily lipseste'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.admin_update_profile(uuid, jsonb)'::regprocedure) NOT LIKE '%audit_mask_profile_fields%' THEN
    RAISE EXCEPTION 'admin_update_profile nu mascheaza auditul';
  END IF;
  IF app.audit_mask_profile_fields('{"phone":"+40700000000","full_name":"X"}'::jsonb) ->> 'phone' NOT LIKE '#%'
     OR app.audit_mask_profile_fields('{"phone":"+40700000000","full_name":"X"}'::jsonb) ->> 'full_name' <> 'X' THEN
    RAISE EXCEPTION 'audit_mask_profile_fields nu functioneaza';
  END IF;
  -- dry-run-ul nu scrie nimic și întoarce contoarele
  IF (app.apply_retention(true) ->> 'dry_run') <> 'true' THEN RAISE EXCEPTION 'apply_retention(true) nu e dry-run'; END IF;
END $$;
