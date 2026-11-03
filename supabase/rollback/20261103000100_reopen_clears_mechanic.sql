-- ROLLBACK pentru 20261103000100_reopen_clears_mechanic.sql — `BEGIN;` + fișier + `COMMIT;`.
-- Scoate trigger-ul și funcția. Curățarea de date (mechanic_id → NULL pe anunțurile deschise) nu se poate
-- reface și nici nu e nevoie: fără trigger, comportamentul revine exact la cel dinainte.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP TRIGGER announcements_open_clears_mechanic ON app.announcements;
DROP FUNCTION app.announcements_open_clears_mechanic();

SELECT 'rollback reopen_clears_mechanic: triggere ramase = ' || (SELECT count(*) FROM pg_trigger WHERE tgname = 'announcements_open_clears_mechanic')
       || ', functii ramase = ' || (SELECT count(*) FROM pg_proc WHERE proname = 'announcements_open_clears_mechanic') AS verificare;
