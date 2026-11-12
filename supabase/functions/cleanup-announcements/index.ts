// 23 aug 2026 — Edge Function `cleanup-announcements`
// Rulează ORAR (pg_cron + pg_net: jobul `cleanup-announcements-hourly`; din faza 9.3, migrarea
// 20261111000200_kicks_push_secret.sql, prin app.kick_cleanup_announcements()) și aplică
// politica de retenție decisă pe 23 aug:
//   1. Anunțurile `open` mai vechi de 30h → `cancelled` (expiră: dispar din feed,
//      dar RÂNDUL rămâne — istoricul șoferului și RLS-ul de rating au nevoie de el).
//   2. Pozele TUTUROR anunțurilor mai vechi de 30h se șterg din Storage — cu EXCEPȚIA
//      celor `accepted` (reparație în curs: mecanicul are nevoie de poze; se șterg
//      la prima rulare de după resolved/cancelled).
//
// De ce Edge Function și nu SQL pur: ștergerea obiectelor Storage TREBUIE făcută prin
// API (service_role). Un DELETE direct pe storage.objects lasă fișierul pe S3 —
// inaccesibil, dar ocupând în continuare spațiul facturat (exact ce vrem să eliberăm).
//
// Ordinea per lot: întâi remove() din Storage, ABIA APOI ștergem rândurile din
// announcement_photos. La orice eșec rândurile rămân → următoarea rulare reia lotul.
// Idempotent și sigur la re-rulare; fără stare proprie.
// Fluxul (poarta, logica de retenție) e în handler.ts, testat în handler_test.ts; aici doar dependențele.
//
// Securitate (faza 9.3, același tipar ca faza 3 / decizia D4): `verify_jwt = false` în config.toml, singura poartă
// e header-ul `x-push-secret` comparat în timp constant cu `PUSH_KICK_SECRET` (același secret ca push-dispatch /
// push-receipts / storage-gc; cron-ul îl citește din Vault `push_kick_secret`). Fără el: 401 înainte de orice.
// Ștergerile se fac cu SUPABASE_SERVICE_ROLE_KEY din env-ul propriu (fără cheia service_role în Vault / pg_net).
// Fereastra de cutover la aplicare: EF nou + cron vechi (Bearer, fără x-push-secret) → 401 de la poarta de aici, până
// la migrarea 20261111000200; EF vechi (verify_jwt pornit) + cron nou (fără Authorization) → 401 de la gateway.
// Ordinea: deploy EF, apoi migrarea în câteva minute — cel mult o rulare orară ratată (anunțurile expiră la următoarea).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeCleanupAnnouncementsHandler } from './handler.ts';

Deno.serve(
  makeCleanupAnnouncementsHandler({
    env: (name) => Deno.env.get(name),
    createAdmin: (url, serviceKey) => {
      // Fără cast: `from` e împachetat într-o funcție cu semnătură simplă — potrivirea structurală a metodei `from`
      // generice a clientului cu AdminLike dă TS2589 (instanțiere prea adâncă); rezultatul ei (query builder-ul) se
      // potrivește direct.
      const client = createClient(url, serviceKey);
      return { from: (table: string) => client.from(table), storage: client.storage };
    },
    now: () => Date.now(),
  }),
);
