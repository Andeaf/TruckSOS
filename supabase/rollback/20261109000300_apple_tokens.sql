-- Rollback pentru 20261109000300_apple_tokens (faza 6): tabelul și RPC-urile Apple șterse. ATENȚIE: token-urile stocate se pierd (revocarea la ștergerea contului nu mai e posibilă pentru acele conturi).
-- Generat de .claude/wip/faza6/gen-rollbacks.mjs; funcțiile restaurate sunt copiate byte cu byte din migrările originale.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea rollback-urilor fazei 6: 600 → 500 → 400 → 300 → 200 → 100.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP FUNCTION IF EXISTS public.record_account_deletion(uuid, text);
DROP FUNCTION IF EXISTS public.read_apple_token(uuid);
DROP FUNCTION IF EXISTS public.store_apple_token(uuid, text);
DROP FUNCTION IF EXISTS app.apple_token_key();
DROP TABLE IF EXISTS app.apple_tokens;
NOTIFY pgrst, 'reload schema';
