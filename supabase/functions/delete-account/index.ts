// Faza 15 — Edge Function `delete-account`
// Orchestrează ștergerea IREVERSIBILĂ a contului. Rulează pe Deno (Supabase Edge Functions).
// 9 nov 2026 (faza 6.1): fluxul e în handler.ts (cu dependențe injectate, testat în handler_test.ts), inclusiv
// revocarea Sign in with Apple înaintea purjei; aici sunt doar dependențele reale. Contractul HTTP e neschimbat.
//
// Env-uri AUTO-injectate de Supabase (nu trebuie setate manual):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Secrete opționale (faza 6.1, puse de David): APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_CLIENT_ID —
// fără ele revocarea Apple e sărită ('not_configured'), ștergerea merge ca înainte.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeDeleteAccountHandler } from './handler.ts';

Deno.serve(
  makeDeleteAccountHandler({
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
