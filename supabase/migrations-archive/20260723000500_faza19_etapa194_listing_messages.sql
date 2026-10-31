-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 19 — Etapa 19.4: context de anunț PE MESAJ + conversații per-pereche
-- Rulează în Supabase Studio → SQL Editor, DUPĂ etapa192. Idempotentă.
--
-- Decizia userului (23 iul, seara): NU vrem conversații separate pe produse vs.
-- servicii — o pereche de utilizatori are O conversație, iar interesul pentru un
-- produs apare ca mesaj cu cardul anunțului atașat (deasupra textului), permanent
-- în istoric. Deci:
--   1. messages primește listing_id (contextul călătorește cu mesajul);
--   2. start_market_conversation REFOLOSEȘTE orice conversație existentă între
--      cei doi (indiferent de tip/direcție), în loc să creeze una per anunț.
-- conversations.listing_id RĂMÂNE ca marcaj „născută din market" DOAR la
-- conversațiile create de acest RPC — pe el stă garda de telefon din etapa192
-- (marketul nu deblochează telefonul). Conversațiile reutilizate își păstrează
-- natura (o conversație de depanare care deblochase telefonul rămâne așa).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Contextul de anunț pe mesaj ─────────────────────────────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES market_listings(id) ON DELETE SET NULL;

-- ─── 2. start_market_conversation v2: reuse per-pereche ─────────────────────
CREATE OR REPLACE FUNCTION start_market_conversation(p_listing_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_buyer  uuid := auth.uid();
  v_seller uuid;
  v_status text;
  v_conv   uuid;
BEGIN
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT seller_id, status INTO v_seller, v_status
  FROM market_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'listing_not_active';
  END IF;
  IF v_seller = v_buyer THEN
    RAISE EXCEPTION 'cannot_contact_self';
  END IF;

  IF is_blocked_by(v_buyer, v_seller) THEN
    RAISE EXCEPTION 'blocked_by_you';
  END IF;
  IF is_blocked_by(v_seller, v_buyer) THEN
    RAISE EXCEPTION 'listing_not_found';       -- nedetectabil
  END IF;

  -- ORICE conversație existentă între cei doi, indiferent de direcție sau tip
  -- (depanare / directă / market) — cea mai recentă, deterministic.
  SELECT id INTO v_conv
  FROM conversations
  WHERE (driver_id = v_buyer AND mechanic_id = v_seller)
     OR (driver_id = v_seller AND mechanic_id = v_buyer)
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Conversație nouă „născută din market": listing_id = marcajul care ține
    -- garda de telefon închisă (etapa192). Trigger-ul de ban se aplică.
    INSERT INTO conversations (announcement_id, driver_id, mechanic_id, is_direct, listing_id)
    VALUES (NULL, v_buyer, v_seller, false, p_listing_id)
    RETURNING id INTO v_conv;
  END IF;

  -- Conversația ștearsă soft de cumpărător reapare la re-contactare.
  DELETE FROM conversation_deletions
  WHERE conversation_id = v_conv AND user_id = v_buyer;

  RETURN v_conv;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificări (Studio, simulare authenticated):
--  a) Pereche cu conversație de depanare existentă → start_market_conversation
--     întoarce ACEA conversație (nu creează alta).
--  b) Pereche fără conversație → rând nou cu listing_id set; get_*_phone → NULL
--     pe ea (garda etapa192); după ce perechea capătă o conversație de depanare,
--     telefonul se deblochează prin aceea (comportament corect).
--  c) INSERT messages cu listing_id + content 'Sunt interesat' → OK; ștergerea
--     anunțului → messages.listing_id devine NULL (SET NULL), mesajul rămâne.
-- ─────────────────────────────────────────────────────────────────────────────
