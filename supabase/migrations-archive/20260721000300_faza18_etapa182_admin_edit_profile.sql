-- Faza 18 — Etapa 18.2: admin_update_profile — adminul editează datele de profil
-- ale unui utilizator (caz de suport: utilizator care nu se descurcă singur).
-- Rulează în Supabase Studio → SQL Editor. Necesită etapa 18.1 (address/vat_number).
--
-- Contract (PLAN_FAZA18 §5, whitelist 8 aprobat):
--   • Whitelist STRICTĂ — orice cheie din afara ei RESPINGE tot apelul (zgomotos,
--     nu ignorat tăcut): un apel cu câmp nepermis e ori bug, ori tentativă.
--   • Interzise prin ABSENȚĂ din UPDATE-ul static: role, banned_*, avatar_path,
--     rating-uri, email/parolă (nici nu sunt în profiles). UPDATE-ul enumeră fizic
--     doar cele 8 coloane → RPC-ul NU POATE modifica rolul indiferent de input.
--   • Interacțiunea cu trigger-ul anti-escaladare (§5.3): profiles_guard_privileged
--     se declanșează doar pentru current_user IN ('authenticated','anon') — RPC-ul
--     rulează ca postgres și l-ar ocoli. Protecția reală AICI e whitelist-ul +
--     statement-ul static; trigger-ul rămâne suveran pe calea client-direct.
--   • Audit OBLIGATORIU cu valorile VECHI (restrânse la cheile trimise) și NOI.

CREATE OR REPLACE FUNCTION admin_update_profile(p_uid uuid, p_fields jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;

-- ─── Verificări (manual; testele negative în _TEST_faza18_admin_negativ.sql) ──
-- a) Cont normal → 'not_admin'.
-- b) Admin cu {"role":"admin"} → 'field_not_allowed: role'.
-- c) Admin cu {"banned_at":"..."} → 'field_not_allowed: banned_at'.
-- d) Admin cu {"phone":"+40711111111"} → merge; admin_audit_log are old+new.
-- e) Separat: UPDATE direct client pe role → trigger-ul dă 'role_change_forbidden'
--    (dubla cale din PLAN §5.3 — trigger-ul rămâne suveran pe calea directă).
