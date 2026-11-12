-- Rollback pentru 20261111000300_health (faza 9): RPC-ul admin_health dispare (cardul „Sănătate” din panoul admin se ascunde singur).
-- Generat de .claude/wip/faza9/gen-rollbacks.mjs; funcțiile și comenzile cron restaurate sunt copiate byte cu byte din migrările originale.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea rollback-urilor fazei 9: 300 → 200 → 100.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP FUNCTION IF EXISTS public.admin_health();
NOTIFY pgrst, 'reload schema';
