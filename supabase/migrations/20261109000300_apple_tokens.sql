-- Faza 6.1 (PLAN_1.1_FIX #3, D11; plan: .claude/wip/faza6/PLAN-faza6.md): refresh token-ul Apple păstrat criptat la
-- conectarea cu Apple, ca la ștergerea contului EF-ul `delete-account` să poată revoca autorizarea la Apple
-- (App Store Review 5.1.1(v): „Sign in with Apple” cere revocarea token-urilor la ștergerea contului).
--
-- Fluxul: client (iOS) → `signInWithIdToken` reușit → `functions/apple-link` cu `authorization_code` (valabil 5 min, o
-- singură dată) → EF-ul schimbă codul la Apple pe `refresh_token` → `store_apple_token` (service_role). La ștergere:
-- `read_apple_token` → `POST appleid.apple.com/auth/revoke` → `record_account_deletion` → fluxul vechi de purjă → la
-- `auth.admin.deleteUser` rândul cade prin cascadă (FK pe auth.users; dacă revocarea sau ștergerea pică, token-ul rămâne
-- pentru reîncercare — de aceea nu există un „take” care șterge înainte de răspunsul Apple).
--
-- Criptare: pgcrypto (`extensions.pgp_sym_encrypt`) cu cheia din Vault `apple_token_key` (David o creează ÎNAINTE de
-- migrare: `SELECT vault.create_secret('<hex 32 octeți>', 'apple_token_key');`). Fără cheie: `store` ridică excepție
-- (nimic stocat), `read` întoarce NULL — fail closed, conectarea NU depinde de ele.
-- Nimic vizibil pentru 1.0.x (nu apelează apple-link; ștergerea contului are același endpoint și același contract).
--
-- Rollback: supabase/rollback/20261109000300_apple_tokens.sql (DROP tabel + cele 3 RPC-uri; token-urile stocate se pierd —
-- revocarea nu mai e posibilă pentru acele conturi decât manual, din Apple ID al utilizatorului).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('app.profiles') IS NULL THEN RAISE EXCEPTION 'cere faza 4 (app.profiles)'; END IF;
  IF to_regclass('app.apple_tokens') IS NOT NULL THEN RAISE EXCEPTION 'app.apple_tokens exista deja: migrarea a fost aplicata?'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN RAISE EXCEPTION 'cere pgcrypto'; END IF;
END $$;

-- ── 1. Tabelul: doar prin RPC-uri (RLS pornit, fără politici, fără GRANT) ─────────────────────────
-- FK pe auth.users, nu pe app.profiles: apple-link rulează imediat după conectare, ÎNAINTE ca utilizatorul nou să-și
-- creeze profilul (role-select). Cascada la auth.admin.deleteUser = ultimul pas al ștergerii contului.
CREATE TABLE app.apple_tokens (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token_enc bytea NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE app.apple_tokens IS 'Faza 6.1: refresh token Apple (pgp_sym_encrypt cu Vault apple_token_key) pentru revocarea la ștergerea contului. Acces doar prin store_apple_token / read_apple_token (service_role).';
ALTER TABLE app.apple_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.apple_tokens FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE app.apple_tokens TO service_role;  -- convenția repo-ului (check-migrations); `app` nu e expusă prin API

-- ── 2. RPC-uri pentru Edge Functions (public, SECURITY DEFINER, EXECUTE doar service_role) ─────────
CREATE FUNCTION app.apple_token_key()
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'apple_token_key' LIMIT 1;
$function$;
REVOKE EXECUTE ON FUNCTION app.apple_token_key() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.store_apple_token(p_user_id uuid, p_refresh_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_key text := app.apple_token_key();
BEGIN
  IF p_user_id IS NULL OR NULLIF(btrim(p_refresh_token), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_argument';
  END IF;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'apple_token_key_missing';  -- fail closed: nimic stocat necriptat
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;
  INSERT INTO app.apple_tokens (user_id, refresh_token_enc)
  VALUES (p_user_id, extensions.pgp_sym_encrypt(p_refresh_token, v_key))
  ON CONFLICT (user_id) DO UPDATE
    SET refresh_token_enc = EXCLUDED.refresh_token_enc, updated_at = now();
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.store_apple_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_apple_token(uuid, text) TO service_role;

-- Întoarce token-ul în clar pentru revocare; NULL dacă nu există (cont fără Apple) sau cheia lipsește. Nu șterge:
-- rândul cade prin cascadă când auth.users dispare, iar la eșec rămâne pentru reîncercare.
CREATE FUNCTION public.read_apple_token(p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_key text := app.apple_token_key();
  v_enc bytea;
BEGIN
  IF p_user_id IS NULL OR v_key IS NULL THEN RETURN NULL; END IF;
  SELECT refresh_token_enc INTO v_enc FROM app.apple_tokens WHERE user_id = p_user_id;
  IF v_enc IS NULL THEN RETURN NULL; END IF;
  RETURN extensions.pgp_sym_decrypt(v_enc, v_key);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.read_apple_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_apple_token(uuid) TO service_role;

-- Evidența ștergerii contului (decizia D2: rând în admin_audit_log cu admin_id = contul șters; FK-ul admin_id → profiles
-- e satisfăcut de piatra funerară, care rămâne). p_apple_revoked: 'true' | 'false:<motiv>' | 'no_token' | 'not_configured'.
-- Fără profil (cont care n-a ajuns la alegerea rolului): nimic de scris.
CREATE FUNCTION public.record_account_deletion(p_user_id uuid, p_apple_revoked text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM app.profiles p WHERE p.id = p_user_id) THEN RETURN; END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (p_user_id, 'self_delete_account', 'user', p_user_id,
          jsonb_build_object('apple_revoked', left(COALESCE(p_apple_revoked, 'unknown'), 200)));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.record_account_deletion(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_account_deletion(uuid, text) TO service_role;

-- ── 3. Verificări ───────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_table_privilege('anon', 'app.apple_tokens', 'SELECT') OR has_table_privilege('authenticated', 'app.apple_tokens', 'SELECT') THEN
    RAISE EXCEPTION 'apple_tokens: anon/authenticated nu trebuie sa aiba drepturi';
  END IF;
  IF has_function_privilege('authenticated', 'public.store_apple_token(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.read_apple_token(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_account_deletion(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC-urile Apple trebuie sa fie doar pentru service_role';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
