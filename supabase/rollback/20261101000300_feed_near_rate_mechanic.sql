-- ROLLBACK pentru 20261101000300_feed_near_rate_mechanic.sql — `BEGIN;` + fișier + `COMMIT;`.
-- Scoate cele patru RPC-uri noi și ia înapoi EXECUTE pe distance_km de la anon. Clienții 1.1 (neapăruți încă)
-- sunt singurii care le-ar apela.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP FUNCTION public.open_announcements_near_count(double precision, double precision, double precision, timestamp with time zone);
DROP FUNCTION public.open_announcements_near(double precision, double precision, double precision, integer, timestamp with time zone);
DROP FUNCTION public.guest_announcements_near(double precision, double precision, double precision, integer, timestamp with time zone);
DROP FUNCTION public.rate_mechanic(uuid, smallint, text);
REVOKE EXECUTE ON FUNCTION public.distance_km(double precision, double precision, double precision, double precision) FROM anon;

NOTIFY pgrst, 'reload schema';

SELECT 'rollback feed_near_rate_mechanic: functii ramase = ' || (SELECT count(*) FROM pg_proc WHERE proname IN ('open_announcements_near', 'open_announcements_near_count', 'guest_announcements_near', 'rate_mechanic')) AS verificare;
