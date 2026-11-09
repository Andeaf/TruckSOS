-- Rollback pentru 20261109000200_market_push_optin (faza 6): default-ul market_push_enabled înapoi la true pe tabel și pe view (rândurile nu se ating).
-- Generat de .claude/wip/faza6/gen-rollbacks.mjs; funcțiile restaurate sunt copiate byte cu byte din migrările originale.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea rollback-urilor fazei 6: 600 → 500 → 400 → 300 → 200 → 100.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE app.profiles ALTER COLUMN market_push_enabled SET DEFAULT true;
ALTER VIEW public.profiles ALTER COLUMN market_push_enabled SET DEFAULT true;
COMMENT ON COLUMN app.profiles.market_push_enabled IS 'Setări → Notificări: anunțuri noi pe Market. Independent de push_enabled (comutatorul global îl domină).';
NOTIFY pgrst, 'reload schema';
