-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 19 — Etapa 19.2: Conversații de market (Opțiunea C aprobată — PLAN_FAZA19.md §1.3)
-- Rulează în Supabase Studio → SQL Editor, DUPĂ etapa191. Idempotentă.
--
-- Semantica relaxată a coloanelor (documentată, nu redenumită):
--   driver_id   = INIȚIATORUL conversației (la market: cumpărătorul, indiferent de rol)
--   mechanic_id = DESTINATARUL             (la market: vânzătorul, indiferent de rol)
-- Convenția e cea DEJA folosită de start_direct_conversation (apelant→driver_id).
-- Conversațiile de market au is_direct=false + listing_id NOT NULL → în afara indexului
-- unic idx_conversations_direct_pair (parțial WHERE is_direct) — zero coliziuni.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Coloana de context ──────────────────────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES market_listings(id) ON DELETE SET NULL;

-- Dedup: cumpărătorul INIȚIAZĂ mereu → o singură conversație per (anunț, cumpărător).
-- Direcția inversă nu există (vânzătorul nu se contactează singur), deci indexul acoperă tot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_market_pair
  ON conversations(listing_id, driver_id) WHERE listing_id IS NOT NULL;

-- ─── 2. start_market_conversation ───────────────────────────────────────────
-- Erori nedetectabile (modelul 18.0): ținta care M-A blocat = 'listing_not_found',
-- identic cu anunțul inexistent (RESTRICTIVE-ul de blocare îl ascunde oricum din SELECT).
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
    RAISE EXCEPTION 'blocked_by_you';          -- secretul blocker-ului; clientul oferă deblocarea
  END IF;
  IF is_blocked_by(v_seller, v_buyer) THEN
    RAISE EXCEPTION 'listing_not_found';       -- nedetectabil
  END IF;

  SELECT id INTO v_conv
  FROM conversations
  WHERE listing_id = p_listing_id AND driver_id = v_buyer;

  IF NOT FOUND THEN
    -- Trigger-ul ban_guard_ins de pe conversations se aplică și aici (auth.uid() = apelantul).
    INSERT INTO conversations (announcement_id, driver_id, mechanic_id, is_direct, listing_id)
    VALUES (NULL, v_buyer, v_seller, false, p_listing_id)
    RETURNING id INTO v_conv;
  END IF;

  -- Conversația ștearsă soft de cumpărător reapare la re-contactare (modelul direct 7.3c).
  DELETE FROM conversation_deletions
  WHERE conversation_id = v_conv AND user_id = v_buyer;

  RETURN v_conv;
END;
$$;

-- ─── 3. GARDA PE TELEFOANE (obligatorie — decizia „chat-only" pe market) ────
-- Fără `listing_id IS NULL`, o conversație de market ar debloca telefonul vânzătorului:
-- get_mechanic_phone cere doar „conversație cu ținta pe slotul mechanic_id" — exact forma
-- rândurilor de market. În plus, verificăm rolul REAL al țintei ('admin' acceptat pentru
-- rolul dual din Faza 16 — adminul care acceptă un anunț rămâne apelabil ca până acum).
CREATE OR REPLACE FUNCTION get_mechanic_phone(p_mechanic_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text;
BEGIN
  IF is_block_between(auth.uid(), p_mechanic_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_mechanic_id AND role IN ('mechanic', 'admin')
  ) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.mechanic_id = p_mechanic_id AND c.driver_id = auth.uid()
      AND c.listing_id IS NULL                       -- Faza 19: marketul NU deblochează telefonul
  ) THEN
    RETURN NULL;
  END IF;
  SELECT phone INTO v_phone FROM profiles WHERE id = p_mechanic_id;
  RETURN v_phone;
END;
$$;

CREATE OR REPLACE FUNCTION get_driver_phone(p_driver_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text;
BEGIN
  IF is_block_between(auth.uid(), p_driver_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_driver_id AND role IN ('driver', 'admin')
  ) THEN
    RETURN NULL;
  END IF;
  SELECT p.phone INTO v_phone
  FROM profiles p
  WHERE p.id = p_driver_id
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.driver_id = p_driver_id AND c.mechanic_id = auth.uid()
        AND c.listing_id IS NULL                     -- Faza 19: idem
    );
  RETURN v_phone;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificări (Studio, simulare authenticated):
--  a) Cumpărător (orice rol) → start_market_conversation(anunț activ al altcuiva) → uuid;
--     al doilea apel → ACELAȘI uuid (dedup); rândul are is_direct=false, listing_id set.
--  b) Pe anunț propriu → cannot_contact_self. Pe anunț 'sold' → listing_not_active.
--  c) Seller-ul l-a blocat pe cumpărător → listing_not_found (nedetectabil).
--  d) TELEFON: pe o conversație DOAR de market (ambele direcții, inclusiv pereche de
--     același rol) → get_mechanic_phone/get_driver_phone → NULL. Pe o conversație de
--     depanare/directă existentă → telefonul vine în continuare (regresie).
--  e) start_direct_conversation neatins: caută pe WHERE is_direct → nu vede rândurile market.
--  f) Ștergerea anunțului → listing_id devine NULL (SET NULL), conversația supraviețuiește.
-- ─────────────────────────────────────────────────────────────────────────────
