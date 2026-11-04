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
// Logica de interpretare e în receipts.ts, testată în receipts_test.ts; aici e doar I/O.
//
// Securitate: identic cu `cleanup-announcements` / `push-dispatch` — doar un Bearer
// JWT cu role=service_role (cron-ul, cu cheia din Vault); verify_jwt PORNIT.

// Ciorna stă în .claude/wip (nu e ignorată de ESLint ca supabase/functions/*), iar
// resolver-ul de Node nu înțelege importurile Deno `npm:`/`jsr:`.
import { createClient } from 'npm:@supabase/supabase-js@2';
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

const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const FETCH_TIMEOUT_MS = 20_000;
/** După bugetul ăsta nu mai începem o pagină nouă (în cel mai rău caz rularea durează
 *  buget + timeout-ul unui getReceipts + rpc ≈ 70 s, sub limita de timp a funcției). */
const TIME_BUDGET_MS = 45_000;

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

/** Un POST la getReceipts; orice excepție (rețea, timeout) devine eroare a cererii. */
async function fetchReceipts(ids: string[], expoToken: string): Promise<ReceiptsResponse> {
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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Doar cron-ul (cu cheia service_role din Vault) are voie — nu userii logați.
  const auth = req.headers.get('Authorization') ?? '';
  if (bearerRole(auth) !== 'service_role') return json(403, { error: 'forbidden' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (!expoToken) return json(500, { error: 'missing_expo_access_token' });

  const admin = createClient(url, serviceKey);
  const start = Date.now();

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

    const response = await fetchReceipts(pending.map((p) => p.ticket_id), expoToken);
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
      hasBudget: Date.now() - start < TIME_BUDGET_MS,
    });
    if (!more) break;
  }

  return json(200, { pages, ...total, ms: Date.now() - start });
});
