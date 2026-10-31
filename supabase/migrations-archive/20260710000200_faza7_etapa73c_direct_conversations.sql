-- Etapa 7.3c: Conversații directe fără anunț — announcement_id nullable + RPC
-- Rulează în Supabase Studio → SQL Editor
-- Non-distructiv: niciun rând existent nu se modifică; rânduri cu NULL apar
-- doar prin RPC-ul nou, pe care clientul îl apelează abia din Etapa 7.3d.

-- ─── 1. announcement_id devine nullable ─────────────────────────────────────
-- Constraint-ul UNIQUE existent rămâne valid (NULL-urile multiple sunt permise).
ALTER TABLE conversations ALTER COLUMN announcement_id DROP NOT NULL;

-- ─── 2. Maxim O conversație directă per pereche șofer↔mecanic ──────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_direct_pair
  ON conversations(driver_id, mechanic_id) WHERE announcement_id IS NULL;

-- ─── 3. RPC start_direct_conversation ───────────────────────────────────────
-- SECURITY DEFINER, consecvent cu pattern-ul existent (accept_announcement,
-- accept_application): conversations nu are INSERT policy, creare doar prin RPC.
-- Doar un șofer poate iniția, doar către un mecanic. Reuse dacă există deja.
CREATE OR REPLACE FUNCTION start_direct_conversation(p_mechanic_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_driver_id uuid := auth.uid();
  v_conv_id   uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_driver_id AND role = 'driver') THEN
    RAISE EXCEPTION 'caller_not_driver';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_mechanic_id AND role = 'mechanic') THEN
    RAISE EXCEPTION 'target_not_mechanic';
  END IF;

  SELECT id INTO v_conv_id
  FROM conversations
  WHERE driver_id = v_driver_id
    AND mechanic_id = p_mechanic_id
    AND announcement_id IS NULL;

  IF NOT FOUND THEN
    INSERT INTO conversations (announcement_id, driver_id, mechanic_id)
    VALUES (NULL, v_driver_id, p_mechanic_id)
    RETURNING id INTO v_conv_id;
  END IF;

  -- dacă șoferul o ștersese din listă, reapare la re-contact
  DELETE FROM conversation_deletions
  WHERE conversation_id = v_conv_id AND user_id = v_driver_id;

  RETURN v_conv_id;
END;
$$;

-- ─── 4. Verificări (rulează manual, nu fac parte din migrare) ───────────────
-- a) Ca user șofer autentificat (SQL Editor → Run as... sau din aplicație):
--      SELECT start_direct_conversation('<uuid-mecanic>');
--    → întoarce un uuid; al doilea apel întoarce ACELAȘI uuid.
-- b) Rândul creat are announcement_id NULL:
--      SELECT id, announcement_id, driver_id, mechanic_id FROM conversations
--      WHERE announcement_id IS NULL;
-- c) Aplicația existentă rămâne funcțională: conversațiile pe anunțuri au în
--    continuare announcement_id NOT NULL, nimic nu s-a modificat pe ele.
