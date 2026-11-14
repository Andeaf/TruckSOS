-- ROLLBACK pentru 20261112000200_messages_created_at_server.sql — `BEGIN;` + fișier + `COMMIT;`.
-- Scoate cele două triggere și funcția: `created_at` revine la „DEFAULT now(), dar clientul îl poate trimite”.
-- Nimic de date: rândurile inserate cât a fost activ trigger-ul au data serverului și rămân așa.
-- Independent de celelalte rollback-uri (nu depinde de fazele 3–9 și nimic nu depinde de el).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP TRIGGER aaa_created_at_server ON public.messages;
DROP TRIGGER aaa_created_at_server ON public.channel_messages;
DROP FUNCTION app.stamp_created_at_client();

SELECT 'rollback messages_created_at_server: triggere ramase = ' || (SELECT count(*) FROM pg_trigger WHERE tgname = 'aaa_created_at_server')
       || ', functii ramase = ' || (SELECT count(*) FROM pg_proc WHERE proname = 'stamp_created_at_client') AS verificare;
