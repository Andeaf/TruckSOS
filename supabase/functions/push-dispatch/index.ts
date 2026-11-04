// 2 nov 2026 — Edge Function `push-dispatch` (faza 3: push prin coadă)
// Push-urile nu mai pleacă din triggere (net.http_post per token, sincron cu
// INSERT-ul), ci din coada `app.push_queue`. Cron-ul `push-dispatch` (pg_cron la
// 5 s, SQL pur) apelează funcția asta DOAR când coada are rânduri scadente.
//
// O rulare: buclă cu buget de ~20 s și cel mult 10 iterații:
//   1. `claim_push_batch(100)` — rândurile scadente, marcate `sending` pe server
//      (FOR UPDATE SKIP LOCKED), câte un rând per token, cu `claimed_at`; 0 rânduri → gata.
//   2. Un mesaj Expo per rând (forma exactă din `notify_push`, vezi payload.ts),
//      trimise în loturi de cel mult 100 la https://exp.host/--/api/v2/push/send,
//      cu `EXPO_ACCESS_TOKEN` (pregătit pentru Enhanced push security). Tokenii cu
//      formă greșită nu pleacă; bugetul se verifică înainte de FIECARE POST; un 400 pe
//      lot se reia mesaj cu mesaj (vezi `dispatchRows` în payload.ts).
//   3. Un singur `finish_push_batch` (o reîncercare după 1 s) cu rezultatul per rând din
//      coadă și `claimed_at`-ul lui: `sent` (+ biletele, pentru `push-receipts`), `retry`
//      (429/5xx/rețea/MessageRateExceeded → serverul pune backoff, plafon 6 încercări),
//      `release` (netrimis: buget epuizat sau 401/403 de la Expo → înapoi în coadă fără
//      încercare) sau `failed`; tokenii morți (DeviceNotRegistered, formă greșită) se
//      șterg pe server.
// 401/403 de la Expo (token de acces greșit) oprește rularea: răspuns 500 `expo_auth`,
// ca să apară în logul cron-ului.
// Dacă funcția moare între claim și finish, rândurile rămân `sending` și revin
// singure în `queued` după 2 min (în `claim_push_batch`) → rar, un push dublu,
// pe care tag/collapseId/threadId îl ascund pe fir.
// Mai multe rulări simultane sunt sigure (SKIP LOCKED: fiecare își ia alte rânduri;
// `claimed_at` împiedică un EF întârziat să scrie peste un claim mai nou).
//
// Toată logica (formă, pre-filtru, loturi, buget, interpretare, agregare) e în
// payload.ts, testată în payload_test.ts; fluxul cererii e în handler.ts (testat în
// handler_test.ts cu dependențe injectate); aici sunt doar dependențele reale.
//
// Securitate (decizia lui David, 3 nov 2026): NU e apelabilă de clienți — `verify_jwt = false`
// în config.toml, iar singura poartă e header-ul `x-push-secret` (secretul din Vault
// `push_kick_secret`, trimis de cron; EF-ul îl compară în timp constant cu `PUSH_KICK_SECRET`
// din env). Fără el: 401 înainte de orice lucru. Scrierile în coadă se fac cu
// SUPABASE_SERVICE_ROLE_KEY din env-ul propriu, ca până acum.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeDispatchHandler, postToExpo } from './handler.ts';

Deno.serve(
  makeDispatchHandler({
    env: (name) => Deno.env.get(name),
    createAdmin: (url, serviceKey) => createClient(url, serviceKey),
    postToExpo,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  }),
);
