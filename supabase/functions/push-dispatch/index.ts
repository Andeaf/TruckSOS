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
// payload.ts, testată în payload_test.ts; aici e doar I/O.
//
// Securitate: NU e apelabilă de clienți — cere ca Bearer-ul să fie un JWT cu
// role=service_role (cron-ul trimite cheia legacy service_role din Vault), exact ca
// `cleanup-announcements`. verify_jwt e PORNIT (default) → gateway-ul validează
// SEMNĂTURA înainte să ajungă aici, deci e suficient să citim claim-ul `role`.

// Ciorna stă în .claude/wip (nu e ignorată de ESLint ca supabase/functions/*), iar
// resolver-ul de Node nu înțelege importurile Deno `npm:`/`jsr:`.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  aggregateResults,
  type ClaimRow,
  dispatchRows,
  type ExpoMessage,
  type HttpReply,
  type QueueResult,
  summarize,
} from './payload.ts';

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
/** Rânduri din coadă cerute la un claim (≈ 1–2 POST-uri Expo, departe de reclaim-ul de 2 min). */
const CLAIM_LIMIT = 100;
/** Bugetul de timp al unei rulări: după el nu mai facem nici claim-uri, nici POST-uri;
 *  rândurile deja revendicate și netrimise se eliberează (`release`), apoi finish. */
const TIME_BUDGET_MS = 20_000;
const MAX_ITERATIONS = 10;
/** Un POST blocat la Expo nu are voie să mănânce toată rularea: după 10 s lotul e `retry`. */
const FETCH_TIMEOUT_MS = 10_000;
/** Pauza înainte de singura reîncercare a lui `finish_push_batch`. */
const FINISH_RETRY_DELAY_MS = 1_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Claim-ul `role` din payload-ul unui Bearer JWT (semnătura e deja verificată de
 *  gateway-ul de funcții — verify_jwt ON). null dacă nu arată a JWT. */
function bearerRole(auth: string): string | null {
  const token = auth.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** Un POST la Expo; excepțiile (rețea, timeout) urcă la `dispatchRows`, care le face `retry`.
 *  Un corp ne-JSON ajunge ca `body: null` (răspuns ilizibil → `retry`). */
async function postToExpo(messages: ExpoMessage[], expoToken: string): Promise<HttpReply> {
  const res = await fetch(EXPO_SEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${expoToken}`,
    },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** `finish_push_batch` cu o singură reîncercare după ~1 s; întoarce mesajul erorii sau null. */
async function finishWithRetry(admin: SupabaseClient, results: QueueResult[]): Promise<string | null> {
  const first = await admin.rpc('finish_push_batch', { p_results: results });
  if (!first.error) return null;
  await new Promise((resolve) => setTimeout(resolve, FINISH_RETRY_DELAY_MS));
  const second = await admin.rpc('finish_push_batch', { p_results: results });
  return second.error ? second.error.message : null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Doar cron-ul (cu cheia service_role din Vault) are voie — nu userii logați.
  const auth = req.headers.get('Authorization') ?? '';
  if (bearerRole(auth) !== 'service_role') return json(403, { error: 'forbidden' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // Fără tokenul Expo nu atingem coada (rândurile rămân `queued`, nimic nu se pierde).
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (!expoToken) return json(500, { error: 'missing_expo_access_token' });

  const admin = createClient(url, serviceKey);
  const start = Date.now();
  const hasBudget = (): boolean => Date.now() - start < TIME_BUDGET_MS;

  // claimed = rânduri DISTINCTE din coadă (claimed = sent + retried + failed + released);
  // batches = POST-uri trimise la Expo (inclusiv cele individuale după un 400).
  const stats = { claimed: 0, sent: 0, retried: 0, failed: 0, released: 0, dead_tokens: 0, batches: 0 };

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (!hasBudget()) break;

    const { data, error: claimErr } = await admin.rpc('claim_push_batch', { p_limit: CLAIM_LIMIT });
    if (claimErr) {
      return json(500, { error: 'claim_failed', detail: claimErr.message, ...stats, ms: Date.now() - start });
    }
    const rows = (data ?? []) as ClaimRow[];
    if (rows.length === 0) break;

    // Rezultatele vin în ordinea rândurilor (indexul global), ca un queue_id împărțit
    // între două loturi să fie agregat corect.
    const run = await dispatchRows(rows, (messages) => postToExpo(messages, expoToken), hasBudget);
    stats.batches += run.posts;

    const results = aggregateResults(rows, run.outcomes);
    const finishErr = await finishWithRetry(admin, results);
    if (finishErr !== null) {
      // Rândurile rămân `sending` și revin singure în `queued` după 2 min (pe server).
      return json(500, {
        error: 'finish_failed',
        detail: finishErr,
        ...(run.authStatus !== null ? { expo_auth_status: run.authStatus } : {}),
        ...stats,
        ms: Date.now() - start,
      });
    }

    const s = summarize(results);
    stats.claimed += results.length;
    stats.sent += s.sent;
    stats.retried += s.retried;
    stats.failed += s.failed;
    stats.released += s.released;
    stats.dead_tokens += s.dead_tokens;

    // EXPO_ACCESS_TOKEN respins: nimic nu mai pleacă până la corectarea lui; 500 ca să se vadă în logul cron.
    if (run.authStatus !== null) {
      return json(500, { error: 'expo_auth', status: run.authStatus, ...stats, ms: Date.now() - start });
    }
    // Bugetul s-a terminat în mijlocul lotului (au rămas rânduri eliberate): oprim aici.
    if (!hasBudget()) break;
  }

  return json(200, { ...stats, ms: Date.now() - start });
});
