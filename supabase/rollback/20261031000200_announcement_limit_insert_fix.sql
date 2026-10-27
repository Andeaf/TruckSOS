-- ROLLBACK pentru 20261031000200_announcement_limit_insert_fix.sql — `BEGIN;` + fișier + `COMMIT;`.
-- Readuce exact funcția din 20261031000100_hygiene_limits (cu ocolirea la INSERT; doar pentru urgență).
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION app.limit_announcements()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.status <> 'open' OR OLD.status = 'open') THEN RETURN NEW; END IF;
  IF NEW.status <> 'open' THEN RETURN NEW; END IF;
  IF (SELECT count(*) FROM public.announcements WHERE driver_id = auth.uid() AND status = 'open' AND id <> NEW.id) >= 3 THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements_open';
  END IF;
  IF NOT app.rate_limit_ok('announcement_day', interval '24 hours', 10)
     OR NOT app.rate_limit_ok('announcement_week', interval '7 days', 30) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements';
  END IF;
  RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION app.limit_announcements() FROM PUBLIC, anon, authenticated;

SELECT 'limit_announcements readusă la versiunea din 20261031000100' AS verificare;
