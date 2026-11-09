// 9 nov 2026 — Edge Function `storage-gc` (faza 6.2): șterge din Storage obiectele din coada `app.storage_gc_queue`
// și, duminica (`{"scan": true}` din `app.kick_storage_gc`), lasă serverul să caute pozele orfane.
// Fluxul (poarta, dry-run implicit, loturi, buget) e în handler.ts, testat în handler_test.ts; aici doar dependențele.
//
// Securitate (decizia D4): `verify_jwt = false` în config.toml, singura poartă e `x-push-secret` comparat în timp
// constant cu `PUSH_KICK_SECRET` (același secret ca push-dispatch / push-receipts). Fără el: 401 înainte de orice.
// Ștergerile se fac cu SUPABASE_SERVICE_ROLE_KEY din env-ul propriu (fără cheia service_role în Vault / pg_net).
// DRY-RUN până când David setează secretul `STORAGE_GC_APPLY=true` (după ce citește raportul primei rulări).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeStorageGcHandler } from './handler.ts';

Deno.serve(
  makeStorageGcHandler({
    env: (name) => Deno.env.get(name),
    createAdmin: (url, serviceKey) => createClient(url, serviceKey),
    now: () => Date.now(),
  }),
);
