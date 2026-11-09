-- Rollback pentru 20261109000600_export_my_data (faza 6): RPC-ul de export șters.
-- Generat de .claude/wip/faza6/gen-rollbacks.mjs; funcțiile restaurate sunt copiate byte cu byte din migrările originale.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea rollback-urilor fazei 6: 600 → 500 → 400 → 300 → 200 → 100.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP FUNCTION IF EXISTS public.export_my_data();
NOTIFY pgrst, 'reload schema';
