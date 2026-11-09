// 9 nov 2026 — Edge Function `apple-link` (faza 6.1): schimbă `authorization_code`-ul Sign in with Apple pe
// `refresh_token` și îl stochează criptat (`store_apple_token`), pentru revocarea la ștergerea contului.
// Fluxul și ordinea verificărilor sunt în handler.ts (testat în handler_test.ts); aici sunt doar dependențele reale.
//
// Env-uri AUTO-injectate de Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Secrete puse de David (`supabase secrets set`): APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (PEM PKCS#8 al
// cheii .p8; `\n` literal e acceptat), APPLE_CLIENT_ID (bundle id-ul). Fără ele: 500 `apple_not_configured`.
// verify_jwt rămâne PORNIT (nimic în config.toml): apelantul e utilizatorul conectat.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeAppleLinkHandler } from './handler.ts';

Deno.serve(
  makeAppleLinkHandler({
    env: (name) => Deno.env.get(name),
    createUserClient: (authHeader) =>
      createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      }),
    createAdmin: () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
  }),
);
