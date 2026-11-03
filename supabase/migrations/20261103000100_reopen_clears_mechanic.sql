-- Faza 4.6 (PLAN_1.1_FIX, 3 nov 2026): un anunț `open` nu poartă niciodată un mecanic acceptat.
--
-- Context: view-ul public.announcements (4.2a) arată plăcuța, VIN-ul și coordonatele exacte și mecanicului
-- din `mechanic_id`. Nimic din bază nu punea `mechanic_id` înapoi pe NULL: `repost_announcement` schimbă doar
-- status/created_at, iar politica announcements_select_mechanic_accepted ține rândul vizibil. Prin aplicație
-- drumul accepted → open nu există (RLS: doar open → cancelled și accepted → resolved; repost doar din
-- cancelled; expirarea anulează doar open), deci starea „open cu mechanic_id” apare doar prin SQL manual —
-- dar atunci vechiul mecanic ar vedea plăcuța/VIN-ul/poziția exactă pe un anunț la care nu mai e acceptat.
--
-- Invariantul: status = 'open' ⇒ mechanic_id IS NULL, impus de un trigger BEFORE INSERT OR UPDATE pe
-- app.announcements (orice drum: RPC, view, SQL direct). Rândurile existente care-l încalcă se curăță aici.
-- Candidaturile și conversațiile nu sunt atinse (au propriile coloane); politica de notare cere
-- status = 'resolved', din care repost nu pleacă. Clienții 1.0.6–1.0.8: nicio formă de răspuns nu se schimbă.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION app.announcements_open_clears_mechanic()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status = 'open' AND NEW.mechanic_id IS NOT NULL THEN
    NEW.mechanic_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
COMMENT ON FUNCTION app.announcements_open_clears_mechanic() IS 'Faza 4.6: status = open ⇒ mechanic_id NULL (vechiul mecanic acceptat nu mai vede plăcuța/VIN-ul/poziția exactă după redeschidere).';
REVOKE ALL ON FUNCTION app.announcements_open_clears_mechanic() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.announcements_open_clears_mechanic() TO service_role;

-- După announcements_guard_client (ordine alfabetică): garda compară NEW cu OLD pe mechanic_id înainte ca
-- trigger-ul acesta să-l modifice, deci o scriere de client rămâne verificată exact ca azi.
CREATE TRIGGER announcements_open_clears_mechanic
  BEFORE INSERT OR UPDATE ON app.announcements
  FOR EACH ROW EXECUTE FUNCTION app.announcements_open_clears_mechanic();

-- Rândurile deja existente care încalcă invariantul (așteptat: 0 pe producție).
DO $$
DECLARE
  v_fixed int;
BEGIN
  UPDATE app.announcements SET mechanic_id = NULL WHERE status = 'open' AND mechanic_id IS NOT NULL;
  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE 'reopen_clears_mechanic: % anunț(uri) deschise curățate de mechanic_id', v_fixed;
END $$;
