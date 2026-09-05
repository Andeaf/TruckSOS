-- ============================================================================
-- Migrare 4 sept 2026 — „Rezolvat" direct dintr-un anunț ÎNCĂ deschis
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (re-rulabilă).
-- ============================================================================
-- Context: caseta „Și-a găsit anunțul rezolvarea?" (design 12c) apare în
-- „Anunțurile mele" pe cardurile neatinse de 12h+ — și pe cele `open`, nu doar
-- pe cele `accepted`. Șoferul care și-a rezolvat problema în afara aplicației
-- (ex. l-a sunat direct pe mecanic — butonul de contact din 1.0.2) trebuie să
-- poată închide anunțul ca REZOLVAT, nu doar „anulat".
--
-- De ce RPC și nu lărgirea politicii announcements_update_resolve:
--   • candidaturile `pending` rămase trebuie respinse ÎN ACEEAȘI tranzacție
--     (altfel mecanicul rămâne cu „În așteptare" pe un anunț rezolvat, intrare
--     pe care nu o poate închide din lista lui);
--   • reject_application() cere anunț `open`, iar clientul n-are UPDATE pe
--     applications (doar RPC-uri) — deci „respinge, apoi rezolvă" nu se poate
--     face sigur din client (dacă pasul al doilea pică, respingerile rămân).
-- Drumul `accepted → resolved` rămâne cel vechi (UPDATE direct sub RLS), neatins.
-- Triggerele existente rulează normal: ban_guard (auth.uid() e al apelantului și
-- sub SECURITY DEFINER), set_updated_at (bump la updated_at).

CREATE OR REPLACE FUNCTION resolve_open_announcement(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE announcements
     SET status = 'resolved'
   WHERE id = p_announcement_id
     AND driver_id = auth.uid()
     AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  -- Mecanicii care candidaseră văd „Respins" și pot închide intrarea din lista
  -- lor (același efect ca la ștergerea unui anunț deschis).
  UPDATE applications
     SET status = 'rejected'
   WHERE announcement_id = p_announcement_id
     AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION resolve_open_announcement(uuid) FROM public;
GRANT EXECUTE ON FUNCTION resolve_open_announcement(uuid) TO authenticated;

-- ── Verificare (manual, cu un anunț `open` al tău) ──────────────────────────
--   SELECT resolve_open_announcement('<id>');
--   SELECT status, updated_at FROM announcements WHERE id = '<id>';   -- resolved, acum
--   SELECT status FROM applications WHERE announcement_id = '<id>';   -- niciun pending
-- Rollback: DROP FUNCTION IF EXISTS resolve_open_announcement(uuid);
