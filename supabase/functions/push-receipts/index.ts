// 2 nov 2026 — Edge Function `push-receipts` (faza 3: push prin coadă)
// Rulează la 15 min (pg_cron, SQL pur), DOAR când există bilete neverificate mai
// vechi de 15 min. O rulare = cel mult 5 pagini, fiecare cu pașii:
//   1. `pending_push_receipts(1000)` — bilete trimise acum 15 min – 24 h, neverificate
//      (fiecare cu tokenul căruia i-a fost trimis mesajul).
//   2. POST https://exp.host/--/api/v2/push/getReceipts cu `{ ids }` (≤ 1000, limita Expo).
//   3. `finish_push_receipts` cu chitanțele primite: `ok`, sau `error` cu textul;
//      `dead: true` DOAR la DeviceNotRegistered → serverul șterge EXACT tokenul
//      biletului (nu toți tokenii utilizatorului). MessageRateExceeded: doar notat.
// Pagina următoare se cere doar dacă cea curentă a fost plină, măcar un bilet al ei a
// primit chitanță și mai e buget de timp (vezi `shouldFetchNextPage` în receipts.ts).
// Biletele fără chitanță încă (absente din răspuns) rămân neverificate și se reiau.
// La un eșec (Expo sau rpc) pagina curentă nu scrie nimic → rularea următoare o reia;
// paginile deja scrise rămân (contoarele lor apar în răspunsul 500).
//
// Logica de interpretare e în receipts.ts (receipts_test.ts); fluxul cererii e în
// handler.ts (handler_test.ts, cu dependențe injectate); aici sunt doar dependențele reale.
//
// Securitate (decizia lui David, 3 nov 2026): identic cu `push-dispatch` — `verify_jwt = false`
// în config.toml, singura poartă e header-ul `x-push-secret` (din Vault `push_kick_secret`, trimis
// de cron; comparat în timp constant cu `PUSH_KICK_SECRET` din env). Fără el: 401 înainte de orice.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { fetchReceipts, makeReceiptsHandler } from './handler.ts';

Deno.serve(
  makeReceiptsHandler({
    env: (name) => Deno.env.get(name),
    createAdmin: (url, serviceKey) => createClient(url, serviceKey),
    fetchReceipts,
    now: () => Date.now(),
  }),
);
