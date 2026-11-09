-- Rollback pentru 20261109000500_retention (faza 6): cron-ul și funcția de retenție scoase, admin_update_profile la textul din 20261101000100 (datele deja șterse/anonimizate NU revin).
-- Generat de .claude/wip/faza6/gen-rollbacks.mjs; funcțiile restaurate sunt copiate byte cu byte din migrările originale.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea rollback-urilor fazei 6: 600 → 500 → 400 → 300 → 200 → 100.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'apply-retention-daily';
DROP FUNCTION IF EXISTS app.apply_retention(boolean);

-- admin_update_profile: textul din 20261101000100 (auditul cu valorile vechi în clar, ca înainte)
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
REVOKE EXECUTE ON FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb) TO service_role;

DROP FUNCTION IF EXISTS app.audit_mask_profile_fields(jsonb);
DO $$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.admin_update_profile(uuid, jsonb)'::regprocedure) LIKE '%audit_mask_profile_fields%' THEN RAISE EXCEPTION 'admin_update_profile mai refera masca'; END IF;
END $$;
