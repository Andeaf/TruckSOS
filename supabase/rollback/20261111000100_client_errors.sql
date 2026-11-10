-- Rollback pentru 20261111000100_client_errors (faza 9): cron-ul de retenție, RPC-urile și tabelul app.client_errors dispar (erorile raportate se pierd; nu sunt date de cont).
-- Generat de .claude/wip/faza9/gen-rollbacks.mjs; funcțiile și comenzile cron restaurate sunt copiate byte cu byte din migrările originale.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea rollback-urilor fazei 9: 300 → 200 → 100.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cleanup-client-errors-daily';
DROP FUNCTION IF EXISTS public.admin_client_errors(integer, integer);
DROP FUNCTION IF EXISTS public.report_client_error(text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS app.scrub_client_text(text, integer);
DROP TABLE IF EXISTS app.client_errors;
NOTIFY pgrst, 'reload schema';
