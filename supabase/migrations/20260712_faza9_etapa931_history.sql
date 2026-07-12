-- Etapa 9.3.1: Istoric probleme — `hidden_from_history` + RPC de ascundere
-- Rulează în Supabase Studio → SQL Editor
--
-- PLAN_FAZA9.md §6: ștergerea din istoric e SOFT, obligatoriu. Un anunț `resolved`
-- trebuie să persiste în DB, fiindcă RLS-ul de rating (Etapa 9.4) cere existența unui
-- anunț `resolved` comun ca șoferul să-și poată da / actualiza evaluarea. Ștergerea
-- efectivă ar rupe editarea rating-ului. Deci doar îl ascundem din ecranul de istoric.
--
-- R6: ascunderea se face printr-un RPC `SECURITY DEFINER`, NU printr-o politică UPDATE
-- largă pe `announcements`. Politicile existente permit doar tranziții de status; o
-- politică UPDATE generală („driver_id = auth.uid()") ar deschide din greșeală și
-- modificarea altor coloane. RPC-ul atinge O SINGURĂ coloană, pe anunțurile proprii.
--
-- Non-distructiv: coloană nouă cu default false + funcție nouă.

-- ─── 1. Coloana ─────────────────────────────────────────────────────────────
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS hidden_from_history boolean NOT NULL DEFAULT false;

-- ─── 2. RPC de ascundere ────────────────────────────────────────────────────
-- p_ids = NULL → ascunde TOATE anunțurile șoferului („Șterge tot").
-- Altfel → doar cele selectate. În ambele cazuri, `driver_id = auth.uid()` e impus
-- în interiorul funcției: un user nu poate ascunde anunțurile altcuiva, chiar dacă
-- trimite id-uri străine.
CREATE OR REPLACE FUNCTION set_announcements_hidden(p_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE announcements a
     SET hidden_from_history = true
   WHERE a.driver_id = auth.uid()
     AND a.hidden_from_history = false
     AND (p_ids IS NULL OR a.id = ANY(p_ids));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION set_announcements_hidden(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION set_announcements_hidden(uuid[]) TO authenticated;

-- ─── 3. Verificări (manual) ─────────────────────────────────────────────────
--   a) Ca șofer A: select set_announcements_hidden(array['<id-anunt-A>']::uuid[]) → 1.
--   b) Ca șofer A: anunțul rămâne în tabel (status neschimbat), doar hidden = true.
--   c) Ca șofer B: set_announcements_hidden(array['<id-anunt-A>']::uuid[]) → 0 rânduri
--      (nu e al lui; funcția nu ridică eroare, pur și simplu nu atinge nimic).
--   d) select set_announcements_hidden() → ascunde tot ce e al meu.
