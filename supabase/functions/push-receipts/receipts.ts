// 2 nov 2026 — logica PURĂ a lui `push-receipts` (faza 3, push prin coadă).
// Fără I/O: index.ts face doar fetch/rpc; interpretarea răspunsului Expo
// /push/getReceipts e aici și e acoperită de receipts_test.ts.
//
// De ce chitanțe: un bilet `ok` la /push/send înseamnă doar că Expo a primit mesajul;
// abia chitanța spune dacă Apple/Google l-au acceptat. `DeviceNotRegistered` în
// chitanță = aplicația a fost dezinstalată → tokenul se șterge pe server (prin maparea
// bilet → token din `app.push_tickets`, ca să nu ștergem ceilalți tokeni ai omului).

/** Un rând întors de `pending_push_receipts`. */
export interface PendingTicket {
  ticket_id: string;
  token: string;
}

/** Un element din `p_results` pentru `finish_push_receipts`. */
export interface ReceiptResult {
  ticket_id: string;
  status: 'ok' | 'error';
  error: string | null;
  /** true DOAR pentru `details.error === 'DeviceNotRegistered'`. */
  dead: boolean;
}

/** Plafonul textului de eroare (mesajele Expo pot fi lungi). */
const MAX_ERROR_LEN = 500;

function clip(text: string): string {
  return text.length > MAX_ERROR_LEN ? text.slice(0, MAX_ERROR_LEN) : text;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function detailsErrorCode(entry: Record<string, unknown>): string | null {
  const details = entry.details;
  if (!isRecord(details)) return null;
  return typeof details.error === 'string' ? details.error : null;
}

/** Același format ca la bilete (payload.ts): „Cod: mesaj” sau doar mesajul. */
function expoErrorText(entry: Record<string, unknown>): string {
  const code = detailsErrorCode(entry);
  const message = typeof entry.message === 'string' ? entry.message : 'unknown_error';
  return clip(code ? `${code}: ${message}` : message);
}

/** Rezultatul unui POST la /push/getReceipts: harta biletelor sau eroarea cererii. */
export type ReceiptsResponse =
  | { ok: true; receipts: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Interpretează răspunsul HTTP de la /push/getReceipts (`body` = JSON-ul deja parsat,
 * null dacă nu era JSON). Orice cod ne-2xx, `errors` la nivel de cerere sau `data`
 * care nu e obiect → eroare a cererii: nu se scrie nimic, biletele rămân neverificate
 * și se reiau la rularea următoare (15 min).
 */
export function parseReceiptsResponse(httpStatus: number, body: unknown): ReceiptsResponse {
  if (httpStatus < 200 || httpStatus >= 300) {
    return { ok: false, error: `http_${httpStatus}${requestErrorSuffix(body)}` };
  }
  if (!isRecord(body)) return { ok: false, error: 'expo_bad_response' };
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    return { ok: false, error: `expo_request_error${requestErrorSuffix(body)}` };
  }
  if (!isRecord(body.data)) return { ok: false, error: 'expo_bad_response' };
  return { ok: true, receipts: body.data };
}

function requestErrorSuffix(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.errors) || body.errors.length === 0) return '';
  const first: unknown = body.errors[0];
  if (!isRecord(first)) return '';
  if (typeof first.code === 'string') return `: ${first.code}`;
  if (typeof first.message === 'string') return `: ${first.message}`;
  return '';
}

/**
 * Rezultatele pentru `finish_push_receipts`, în ordinea biletelor cerute.
 * Un bilet absent din răspuns (Expo n-are încă chitanța) sau cu formă necunoscută
 * NU intră în rezultate → rămâne neverificat și se reia la rularea următoare
 * (serverul îl scoate din `pending_push_receipts` după 24 h).
 * `MessageRateExceeded` și celelalte erori: `status:'error'`, `dead:false`.
 */
export function mapReceipts(
  pending: readonly PendingTicket[],
  receipts: Record<string, unknown>,
): ReceiptResult[] {
  const out: ReceiptResult[] = [];
  for (const p of pending) {
    if (!Object.prototype.hasOwnProperty.call(receipts, p.ticket_id)) continue;
    const r = receipts[p.ticket_id];
    if (!isRecord(r)) continue;
    if (r.status === 'ok') {
      out.push({ ticket_id: p.ticket_id, status: 'ok', error: null, dead: false });
    } else if (r.status === 'error') {
      out.push({
        ticket_id: p.ticket_id,
        status: 'error',
        error: expoErrorText(r),
        dead: detailsErrorCode(r) === 'DeviceNotRegistered',
      });
    }
  }
  return out;
}

/** Contoarele unei pagini (sau ale întregii rulări, adunate cu `addReceiptSummaries`). */
export interface ReceiptSummary {
  requested: number;
  checked: number;
  ok: number;
  errors: number;
  dead_tokens: number;
}

/** Contoarele din răspunsul EF-ului. */
export function summarizeReceipts(requested: number, results: readonly ReceiptResult[]): ReceiptSummary {
  let ok = 0;
  let errors = 0;
  let dead = 0;
  for (const r of results) {
    if (r.status === 'ok') ok += 1;
    else errors += 1;
    if (r.dead) dead += 1;
  }
  return { requested, checked: results.length, ok, errors, dead_tokens: dead };
}

/** Suma a două seturi de contoare (paginile unei rulări). */
export function addReceiptSummaries(a: ReceiptSummary, b: ReceiptSummary): ReceiptSummary {
  return {
    requested: a.requested + b.requested,
    checked: a.checked + b.checked,
    ok: a.ok + b.ok,
    errors: a.errors + b.errors,
    dead_tokens: a.dead_tokens + b.dead_tokens,
  };
}

// ── Paginarea unei rulări ─────────────────────────────────────────────────────

/** Bilete cerute pe pagină = limita Expo pentru un apel getReceipts. */
export const RECEIPTS_PAGE_SIZE = 1000;
/** Pagini (pending → getReceipts → finish) într-o rulare. */
export const MAX_RECEIPT_PAGES = 5;

/**
 * Mai cerem o pagină după cea tocmai scrisă? Doar dacă:
 *  - pagina a fost plină (`requested === pageSize`; altfel nu mai e nimic de verificat),
 *  - pagina a verificat MĂCAR UN bilet (`checked > 0`): biletele fără chitanță rămân
 *    neverificate și, fiind cele mai vechi, deschid din nou pagina următoare; câteva
 *    repetate sunt inofensive (plafonul de pagini le limitează), dar o pagină fără nicio
 *    chitanță ar fi urmată de una identică,
 *  - n-am ajuns la `maxPages`, și mai e buget de timp.
 */
export function shouldFetchNextPage(p: {
  pagesDone: number;
  requested: number;
  checked: number;
  hasBudget: boolean;
  pageSize?: number;
  maxPages?: number;
}): boolean {
  const pageSize = p.pageSize ?? RECEIPTS_PAGE_SIZE;
  const maxPages = p.maxPages ?? MAX_RECEIPT_PAGES;
  if (p.pagesDone >= maxPages) return false;
  if (p.requested < pageSize) return false;
  if (p.checked === 0) return false;
  return p.hasBudget;
}
