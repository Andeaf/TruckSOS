-- Faza 18 — Etapa 18.1: câmpuri noi de profil — address + vat_number
-- Rulează în Supabase Studio → SQL Editor. Idempotentă.
--
-- Ambele coloane NULLABLE: obligativitatea (telefon la ambele roluri; adresă+TVA la
-- mecanici) se impune 100% APLICATIV, în formulare — zero constrângeri DB, deci
-- conturile existente și sesiunile active nu sunt blocate de nimic (PLAN_FAZA18 §4).
--
-- Vizibilitate (documentată, decizie aprobată §9.2): `profiles_select_all` face
-- coloanele noi citibile de orice utilizator autentificat. Pentru mecanici e
-- intenționat (informații de business, afișate în profilul public); pentru
-- transportatori sunt opționale și nedeclarate în UI, dar tehnic citibile —
-- declarat onest în Privacy Policy (E6).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vat_number text;

-- ── admin_user_detail: + address, vat_number, phone ─────────────────────────
-- Return-ul e jsonb → semnătura nu se schimbă, CREATE OR REPLACE e suficient.
-- `phone` intră ACUM în detaliul admin (schimbare față de decizia Faza 16 „fără
-- telefon"): F18.5 dă adminului dreptul să EDITEZE telefonul (whitelist aprobat),
-- iar formularul de editare trebuie precompletat cu valoarea curentă — editare
-- fără citire ar însemna suprascriere oarbă.
CREATE OR REPLACE FUNCTION admin_user_detail(p_uid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT to_jsonb(d) INTO v FROM (
    SELECT
      p.id, p.full_name, p.role, p.avatar_path, p.specialization, p.activity_zone,
      p.company_name, p.contact_email, p.address, p.vat_number, p.phone,
      p.rating_avg, p.rating_count,
      p.deleted_at, p.banned_at, p.banned_until, p.ban_reason,
      u.email, u.created_at AS registered_at,
      (SELECT count(*) FROM announcements a WHERE a.driver_id = p.id)              AS announcements_count,
      (SELECT count(*) FROM applications ap WHERE ap.mechanic_id = p.id)           AS applications_count,
      (SELECT count(*) FROM reports r WHERE r.reported_user_id = p.id)             AS reports_received,
      (SELECT count(*) FROM reports r WHERE r.reporter_id = p.id)                  AS reports_made
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_uid
  ) d;
  IF v IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  RETURN v;
END; $$;

-- ─── Verificări (manual) ────────────────────────────────────────────────────
-- a) SELECT address, vat_number FROM profiles LIMIT 1;   -- coloanele există, NULL
-- b) Ca admin: admin_user_detail('<uuid>') conține address/vat_number/phone.
-- c) Cont normal: admin_user_detail → 'not_admin' (neschimbat).
