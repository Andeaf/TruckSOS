// 4 nov 2026 — handler-ul Edge Function `push-dispatch`, cu dependențele injectate (env, clientul
// admin, transportul către Expo), ca poarta `x-push-secret` și fluxul să fie testabile fără rețea
// (handler_test.ts). index.ts doar îl leagă la Deno.serve cu dependențele reale.
//
// Ordinea cererii (decizia lui David, 3 nov): 401 ÎNAINTE de orice — fără claim, fără citire din
// coadă, fără env Expo, fără client admin; în log o singură linie `push-dispatch: 401`, fără header-e.
import {
  aggregateResults,
  type ClaimRow,
  dispatchRows,
  type ExpoMessage,
  type HttpReply,
  type QueueResult,
  summarize,
} from './payload.ts';
import { checkPushSecret, PUSH_SECRET_HEADER } from '../_shared/push-secret.ts';

export const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
/** Rânduri din coadă cerute la un claim (≈ 1–2 POST-uri Expo, departe de reclaim-ul de 2 min). */
export const CLAIM_LIMIT = 100;
/** Bugetul de timp al unei rulări: după el nu mai facem nici claim-uri, nici POST-uri;
 *  rândurile deja revendicate și netrimise se eliberează (`release`), apoi finish. */
export const TIME_BUDGET_MS = 20_000;
export const MAX_ITERATIONS = 10;
/** Un POST blocat la Expo nu are voie să mănânce toată rularea: după 10 s lotul e `retry`. */
export const FETCH_TIMEOUT_MS = 10_000;
/** Pauza înainte de singura reîncercare a lui `finish_push_batch`. */
export const FINISH_RETRY_DELAY_MS = 1_000;

/** Subsetul din clientul supabase-js pe care îl folosim (service_role). */
export interface AdminLike {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface DispatchDeps {
  /** `Deno.env.get` în producție. */
  env: (name: string) => string | undefined;
  /** Clientul service_role; se creează DOAR după ce poarta a trecut. */
  createAdmin: (url: string, serviceKey: string) => AdminLike;
  /** Un POST la Expo; excepțiile (rețea, timeout) urcă la `dispatchRows`, care le face `retry`. */
  postToExpo: (messages: ExpoMessage[], expoToken: string) => Promise<HttpReply>;
  /** Pauza dintre cele două încercări de finish (în teste: fără așteptare). */
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Transportul real: un POST la Expo. Un corp ne-JSON ajunge ca `body: null` (răspuns ilizibil → `retry`). */
export async function postToExpo(messages: ExpoMessage[], expoToken: string): Promise<HttpReply> {
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
async function finishWithRetry(admin: AdminLike, results: QueueResult[], deps: DispatchDeps): Promise<string | null> {
  const first = await admin.rpc('finish_push_batch', { p_results: results });
  if (!first.error) return null;
  await deps.sleep(FINISH_RETRY_DELAY_MS);
  const second = await admin.rpc('finish_push_batch', { p_results: results });
  return second.error ? second.error.message : null;
}

export function makeDispatchHandler(deps: DispatchDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    // Poarta: secretul din header vs PUSH_KICK_SECRET, în timp constant. Înainte de orice altceva.
    if (!(await checkPushSecret(req.headers.get(PUSH_SECRET_HEADER), deps.env('PUSH_KICK_SECRET')))) {
      console.log('push-dispatch: 401');
      return json(401, { error: 'unauthorized' });
    }
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const url = deps.env('SUPABASE_URL');
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return json(500, { error: 'missing_supabase_env' });
    // Fără tokenul Expo nu atingem coada (rândurile rămân `queued`, nimic nu se pierde).
    const expoToken = deps.env('EXPO_ACCESS_TOKEN');
    if (!expoToken) return json(500, { error: 'missing_expo_access_token' });

    const admin = deps.createAdmin(url, serviceKey);
    const start = deps.now();
    const hasBudget = (): boolean => deps.now() - start < TIME_BUDGET_MS;

    // claimed = rânduri DISTINCTE din coadă (claimed = sent + retried + failed + released);
    // batches = POST-uri trimise la Expo (inclusiv cele individuale după un 400).
    const stats = { claimed: 0, sent: 0, retried: 0, failed: 0, released: 0, dead_tokens: 0, batches: 0 };

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (!hasBudget()) break;

      const { data, error: claimErr } = await admin.rpc('claim_push_batch', { p_limit: CLAIM_LIMIT });
      if (claimErr) {
        return json(500, { error: 'claim_failed', detail: claimErr.message, ...stats, ms: deps.now() - start });
      }
      const rows = (data ?? []) as ClaimRow[];
      if (rows.length === 0) break;

      // Rezultatele vin în ordinea rândurilor (indexul global), ca un queue_id împărțit
      // între două loturi să fie agregat corect.
      const run = await dispatchRows(rows, (messages) => deps.postToExpo(messages, expoToken), hasBudget);
      stats.batches += run.posts;

      const results = aggregateResults(rows, run.outcomes);
      const finishErr = await finishWithRetry(admin, results, deps);
      if (finishErr !== null) {
        // Rândurile rămân `sending` și revin singure în `queued` după 2 min (pe server).
        return json(500, {
          error: 'finish_failed',
          detail: finishErr,
          ...(run.authStatus !== null ? { expo_auth_status: run.authStatus } : {}),
          ...stats,
          ms: deps.now() - start,
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
        return json(500, { error: 'expo_auth', status: run.authStatus, ...stats, ms: deps.now() - start });
      }
      // Bugetul s-a terminat în mijlocul lotului (au rămas rânduri eliberate): oprim aici.
      if (!hasBudget()) break;
    }

    return json(200, { ...stats, ms: deps.now() - start });
  };
}
