-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 19.6 — Conversații universale + share de anunțuri + căutare utilizatori
-- Rulează în Supabase Studio → SQL Editor, DUPĂ faza195. Idempotentă.
--
-- Decizii (25 iul): șoferii pot vorbi între ei și mecanicii între ei (butonul
-- „Începe o conversație nouă"); share pe AMBELE tipuri de anunțuri (depanare +
-- market); telefonul se dezvăluie ca până acum partenerului de conversație
-- (RPC-urile devin SIMETRICE pe sloturi — perechile same-role pot avea inițiatorul
-- în oricare slot), cu garda de market (listing_id IS NULL) păstrată.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Context de anunț de DEPANARE pe mesaje (share → card în bulă) ────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS announcement_id uuid REFERENCES announcements(id) ON DELETE SET NULL;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS announcement_id uuid REFERENCES announcements(id) ON DELETE SET NULL;

-- ── 2. start_direct_conversation v3 — ORICE utilizator ↔ ORICE utilizator ───
-- Semnătura și IDENTIFICATORII de eroare rămân cei vechi (compatibilitate client):
-- p_mechanic_id = ținta (orice rol); 'target_not_mechanic' = țintă inexistentă/
-- ștearsă/care m-a blocat (nedetectabil, modelul 18.0). Slotul: apelant→driver_id,
-- țintă→mechanic_id (convenția documentată în 19.2); căutarea perechii acoperă
-- AMBELE orientări (la same-role oricare a putut iniția primul).
CREATE OR REPLACE FUNCTION start_direct_conversation(p_mechanic_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_conv   uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_mechanic_id = v_caller THEN
    RAISE EXCEPTION 'cannot_contact_self';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_mechanic_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'target_not_mechanic';
  END IF;

  IF is_blocked_by(v_caller, p_mechanic_id) THEN
    RAISE EXCEPTION 'blocked_by_you';
  END IF;
  IF is_blocked_by(p_mechanic_id, v_caller) THEN
    RAISE EXCEPTION 'target_not_mechanic';   -- identic cu inexistent — nedetectabil
  END IF;

  SELECT id INTO v_conv
  FROM conversations
  WHERE is_direct
    AND ((driver_id = v_caller AND mechanic_id = p_mechanic_id)
      OR (driver_id = p_mechanic_id AND mechanic_id = v_caller))
  LIMIT 1;

  IF NOT FOUND THEN
    -- Trigger-ul ban_guard_ins de pe conversations se aplică și aici.
    INSERT INTO conversations (announcement_id, driver_id, mechanic_id, is_direct)
    VALUES (NULL, v_caller, p_mechanic_id, true)
    RETURNING id INTO v_conv;
  END IF;

  DELETE FROM conversation_deletions
  WHERE conversation_id = v_conv AND user_id = v_caller;

  RETURN v_conv;
END;
$$;

-- ── 3. Telefoane: EXISTS simetric pe participanți (guard de market păstrat) ─
-- Corpurile = versiunile 19.2; DOAR verificarea de conversație devine simetrică:
-- perechile same-role/dedup-ate în oricare orientare deblochează telefonul la fel.
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
    WHERE ((c.mechanic_id = p_mechanic_id AND c.driver_id = auth.uid())
        OR (c.driver_id = p_mechanic_id AND c.mechanic_id = auth.uid()))
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
      WHERE ((c.driver_id = p_driver_id AND c.mechanic_id = auth.uid())
          OR (c.mechanic_id = p_driver_id AND c.driver_id = auth.uid()))
        AND c.listing_id IS NULL                     -- Faza 19: idem
    );
  RETURN v_phone;
END;
$$;

-- ── 4. search_users — directorul pickerului „conversație nouă"/share ────────
-- Ca search_mechanics, dar AMBELE roluri de utilizator + rolul în rezultat.
-- Adminii NU apar în director (moderatorii nu sunt contactabili prin căutare);
-- fără sine, fără conturi șterse, fără perechi blocate (nedetectabil).
DROP FUNCTION IF EXISTS search_users(text);
CREATE FUNCTION search_users(p_query text)
RETURNS TABLE (
  id uuid,
  full_name text,
  role text,
  specialization text,
  activity_zone text,
  rating_avg numeric,
  rating_count integer,
  avatar_path text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT p.id, p.full_name, p.role::text, p.specialization, p.activity_zone,
         p.rating_avg, p.rating_count, p.avatar_path
  FROM profiles p
  WHERE p.role IN ('driver', 'mechanic')
    AND p.deleted_at IS NULL
    AND p.id <> auth.uid()
    AND NOT is_block_between(p.id, auth.uid())
    AND extensions.unaccent(replace(lower(p.full_name), 'ß', 'ss'))
        LIKE '%' || extensions.unaccent(replace(lower(p_query), 'ß', 'ss')) || '%'
  ORDER BY p.full_name
  LIMIT 30;
$$;

-- ── Verificări (Studio, simulare authenticated — feedback_studio_rls_test) ──
-- a) Șofer A → start_direct_conversation(șofer B) → uuid; B → start(A) → ACELAȘI uuid.
-- b) După (a): get_driver_phone dinspre AMBII → telefonul celuilalt (dacă nu e
--    pereche doar-market). Conversație DOAR market → NULL (regresie garda 19.2).
-- c) search_users('ion') → șoferi ȘI mecanici, fără sine/admini/ștersși/blocați.
-- d) Mesaj cu announcement_id → embed-ul apare; ștergi anunțul → SET NULL, cardul
--    dispare, mesajul rămâne.
-- e) Regresie: driver→mechanic din profilul de mecanic funcționează neschimbat.
