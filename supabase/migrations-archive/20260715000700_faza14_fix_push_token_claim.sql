-- Faza 14 — FIX notificări cross-cont pe același telefon
-- Rulează în Supabase Studio → SQL Editor
--
-- BUG: pe un telefon logat succesiv pe două conturi (ex. șofer apoi mecanic),
-- notificările destinate contului VECHI ajungeau pe dispozitiv chiar și după
-- schimbarea contului.
--
-- CAUZĂ: `registerPushToken` folosea `upsert` = INSERT ... ON CONFLICT DO UPDATE.
-- Când rândul (PK = token) aparținea DEJA altui user, politica RLS de UPDATE
--   push_tokens_update_own: USING (user_id = auth.uid())
-- excludea rândul existent → actualizarea era respinsă → tokenul rămânea legat
-- de contul vechi. `notify_push` trimitea apoi la acel token → dispozitiv greșit.
--
-- SOLUȚIE: o funcție SECURITY DEFINER care REVENDICĂ tokenul pentru userul curent,
-- ocolind legitim RLS. Posesia string-ului token (obținut de pe ACEST dispozitiv)
-- e dovada dreptului de a-l revendica. Idempotentă și „self-healing”: la fiecare
-- login tokenul se re-leagă forțat de contul curent, oricare ar fi starea veche.

CREATE OR REPLACE FUNCTION claim_push_token(p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO push_tokens (token, user_id, updated_at)
  VALUES (p_token, auth.uid(), now())
  ON CONFLICT (token) DO UPDATE
    SET user_id = auth.uid(), updated_at = now();
END;
$$;

-- Doar utilizatorii autentificați o pot apela; `auth.uid()` din interior stabilește
-- proprietarul, deci nimeni nu poate revendica un token în numele altcuiva.
REVOKE ALL ON FUNCTION claim_push_token(text) FROM public;
GRANT EXECUTE ON FUNCTION claim_push_token(text) TO authenticated;
