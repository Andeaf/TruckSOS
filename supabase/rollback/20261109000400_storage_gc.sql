-- Rollback pentru 20261109000400_storage_gc (faza 6): cron-ul, RPC-urile și coada de ștergere Storage șterse (rândurile din coadă se pierd; obiectele rămân în Storage).
-- Generat de .claude/wip/faza6/gen-rollbacks.mjs; funcțiile restaurate sunt copiate byte cu byte din migrările originale.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea rollback-urilor fazei 6: 600 → 500 → 400 → 300 → 200 → 100.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('app.apply_retention(boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 400: 20261109000500_retention e aplicata (foloseste coada) - ruleaza intai rollback-ul ei';
  END IF;
END $$;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'storage-gc-daily';
DROP FUNCTION IF EXISTS app.kick_storage_gc();
DROP FUNCTION IF EXISTS public.storage_gc_finish(bigint[]);
DROP FUNCTION IF EXISTS public.storage_gc_claim(integer, boolean);
DROP FUNCTION IF EXISTS app.storage_gc_scan_orphans();
DROP FUNCTION IF EXISTS app.storage_gc_enqueue(text[], text, text);
DROP TABLE IF EXISTS app.storage_gc_queue;
NOTIFY pgrst, 'reload schema';
