// 4 nov 2026 — handler-ul Edge Function `push-receipts`, cu dependențele injectate (env, clientul
// admin, transportul către Expo), ca poarta `x-push-secret` și fluxul să fie testabile fără rețea
// (handler_test.ts). index.ts doar îl leagă la Deno.serve cu dependențele reale.
//
// Ordinea cererii (decizia lui David, 3 nov): 401 ÎNAINTE de orice — fără rpc, fără env Expo,
// fără client admin; în log o singură linie `push-receipts: 401`, fără header-e.
import {
  addReceiptSummaries,
  mapReceipts,
  parseReceiptsResponse,
  type PendingTicket,
  RECEIPTS_PAGE_SIZE,
  type ReceiptsResponse,
  type ReceiptSummary,
  shouldFetchNextPage,
  summarizeReceipts,
} from './receipts.ts';
import { checkPushSecret, PUSH_SECRET_HEADER } from '../_shared/push-secret.ts';

export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
export const FETCH_TIMEOUT_MS = 20_000;
/** După bugetul ăsta nu mai începem o pagină nouă (în cel mai rău caz rularea durează
 *  buget + timeout-ul unui getReceipts + rpc ≈ 70 s, sub limita de timp a funcției). */
export const TIME_BUDGET_MS = 45_000;

/** Subsetul din clientul supabase-js pe care îl folosim (service_role). */
export interface AdminLike {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface ReceiptsDeps {
  /** `Deno.env.get` în producție. */
  env: (name: string) => string | undefined;
  /** Clientul service_role; se creează DOAR după ce poarta a trecut. */
  createAdmin: (url: string, serviceKey: string) => AdminLike;
  /** Un POST la getReceipts; orice excepție (rețea, timeout) devine eroare a cererii. */
  fetchReceipts: (ids: string[], expoToken: string) => Promise<ReceiptsResponse>;
  now: () => number;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Transportul real: un POST la getReceipts. */
export async function fetchReceipts(ids: string[], expoToken: string): Promise<ReceiptsResponse> {
  try {
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${expoToken}`,
      },
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null; // corp ne-JSON → parseReceiptsResponse îl tratează ca răspuns ilizibil
    }
    return parseReceiptsResponse(res.status, body);
  } catch (e) {
    return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function makeReceiptsHandler(deps: ReceiptsDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    // Poarta: secretul din header vs PUSH_KICK_SECRET, în timp constant. Înainte de orice altceva.
    if (!(await checkPushSecret(req.headers.get(PUSH_SECRET_HEADER), deps.env('PUSH_KICK_SECRET')))) {
      console.log('push-receipts: 401');
      return json(401, { error: 'unauthorized' });
    }
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const url = deps.env('SUPABASE_URL');
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return json(500, { error: 'missing_supabase_env' });
    const expoToken = deps.env('EXPO_ACCESS_TOKEN');
    if (!expoToken) return json(500, { error: 'missing_expo_access_token' });

    const admin = deps.createAdmin(url, serviceKey);
    const start = deps.now();

    // Contoarele paginilor DEJA scrise (rămân valabile și când o pagină ulterioară eșuează).
    let total: ReceiptSummary = { requested: 0, checked: 0, ok: 0, errors: 0, dead_tokens: 0 };
    let pages = 0;

    for (;;) {
      const { data, error: pendingErr } = await admin.rpc('pending_push_receipts', { p_limit: RECEIPTS_PAGE_SIZE });
      if (pendingErr) {
        return json(500, { error: 'pending_failed', detail: pendingErr.message, pages, ...total });
      }
      const pending = (data ?? []) as PendingTicket[];
      if (pending.length === 0) break;

      const response = await deps.fetchReceipts(pending.map((p) => p.ticket_id), expoToken);
      if (!response.ok) {
        return json(500, {
          error: 'receipts_failed',
          detail: response.error,
          page_requested: pending.length,
          pages,
          ...total,
        });
      }

      const results = mapReceipts(pending, response.receipts);
      if (results.length > 0) {
        const { error: finishErr } = await admin.rpc('finish_push_receipts', { p_results: results });
        if (finishErr) {
          return json(500, {
            error: 'finish_failed',
            detail: finishErr.message,
            page_requested: pending.length,
            pages,
            ...total,
          });
        }
      }

      const page = summarizeReceipts(pending.length, results);
      total = addReceiptSummaries(total, page);
      pages += 1;

      const more = shouldFetchNextPage({
        pagesDone: pages,
        requested: page.requested,
        checked: page.checked,
        hasBudget: deps.now() - start < TIME_BUDGET_MS,
      });
      if (!more) break;
    }

    return json(200, { pages, ...total, ms: deps.now() - start });
  };
}
