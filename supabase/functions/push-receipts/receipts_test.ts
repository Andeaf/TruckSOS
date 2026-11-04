// 2 nov 2026 — teste pentru logica pură din receipts.ts (fără rețea; fetch nu e apelat).
// Rulare: deno test .claude/wip/faza3/functions/push-receipts (după mutare: supabase/functions/push-receipts).

import { assertEquals } from 'jsr:@std/assert';
import {
  addReceiptSummaries,
  mapReceipts,
  MAX_RECEIPT_PAGES,
  parseReceiptsResponse,
  type PendingTicket,
  RECEIPTS_PAGE_SIZE,
  shouldFetchNextPage,
  summarizeReceipts,
} from './receipts.ts';

const pending: PendingTicket[] = [
  { ticket_id: 't-ok', token: 'ExponentPushToken[A]' },
  { ticket_id: 't-dead', token: 'ExponentPushToken[B]' },
  { ticket_id: 't-rate', token: 'ExponentPushToken[C]' },
  { ticket_id: 't-absent', token: 'ExponentPushToken[D]' },
  { ticket_id: 't-plain', token: 'ExponentPushToken[E]' },
];

const expoBody = {
  data: {
    't-ok': { status: 'ok' },
    't-dead': {
      status: 'error',
      message: '"ExponentPushToken[B]" is not a registered push notification recipient',
      details: { error: 'DeviceNotRegistered' },
    },
    't-rate': { status: 'error', message: 'Too many messages', details: { error: 'MessageRateExceeded' } },
    't-plain': { status: 'error', message: 'fără cod' },
    't-strain': { status: 'ok' }, // bilet necerut: ignorat
  },
};

Deno.test('mapReceipts: ok, error cu dead, error fără dead, bilet absent exclus', () => {
  const parsed = parseReceiptsResponse(200, expoBody);
  assertEquals(parsed.ok, true);
  if (!parsed.ok) return;
  const results = mapReceipts(pending, parsed.receipts);
  assertEquals(results, [
    { ticket_id: 't-ok', status: 'ok', error: null, dead: false },
    {
      ticket_id: 't-dead',
      status: 'error',
      error: 'DeviceNotRegistered: "ExponentPushToken[B]" is not a registered push notification recipient',
      dead: true,
    },
    { ticket_id: 't-rate', status: 'error', error: 'MessageRateExceeded: Too many messages', dead: false },
    { ticket_id: 't-plain', status: 'error', error: 'fără cod', dead: false },
  ]);
  assertEquals(summarizeReceipts(pending.length, results), {
    requested: 5,
    checked: 4,
    ok: 1,
    errors: 3,
    dead_tokens: 1,
  });
});

Deno.test('mapReceipts: chitanță cu formă necunoscută → exclusă (rămâne neverificată)', () => {
  const results = mapReceipts(pending, { 't-ok': 'ciudat', 't-dead': { status: 'pending' } });
  assertEquals(results, []);
});

Deno.test('mapReceipts: un id moștenit din prototip nu e luat drept chitanță', () => {
  const results = mapReceipts([{ ticket_id: 'toString', token: 'x' }], {});
  assertEquals(results, []);
});

Deno.test('parseReceiptsResponse: erori de cerere → nimic de scris', () => {
  assertEquals(parseReceiptsResponse(429, null), { ok: false, error: 'http_429' });
  assertEquals(parseReceiptsResponse(503, { errors: [{ code: 'SERVICE_UNAVAILABLE' }] }), {
    ok: false,
    error: 'http_503: SERVICE_UNAVAILABLE',
  });
  assertEquals(parseReceiptsResponse(200, { errors: [{ message: 'bad' }] }), {
    ok: false,
    error: 'expo_request_error: bad',
  });
  assertEquals(parseReceiptsResponse(200, null), { ok: false, error: 'expo_bad_response' });
  assertEquals(parseReceiptsResponse(200, { data: [] }), { ok: false, error: 'expo_bad_response' });
});

Deno.test('parseReceiptsResponse: data gol → ok, zero rezultate', () => {
  const parsed = parseReceiptsResponse(200, { data: {} });
  assertEquals(parsed, { ok: true, receipts: {} });
  if (parsed.ok) assertEquals(mapReceipts(pending, parsed.receipts), []);
});

// ── (10) paginarea unei rulări ───────────────────────────────────────────────

Deno.test('(10) shouldFetchNextPage: pagină plină, toată verificată, cu buget → încă o pagină', () => {
  assertEquals(RECEIPTS_PAGE_SIZE, 1000);
  assertEquals(MAX_RECEIPT_PAGES, 5);
  const full = { requested: 1000, checked: 1000, hasBudget: true };
  assertEquals(shouldFetchNextPage({ pagesDone: 1, ...full }), true);
  assertEquals(shouldFetchNextPage({ pagesDone: 4, ...full }), true);
  // plafonul de 5 pagini
  assertEquals(shouldFetchNextPage({ pagesDone: 5, ...full }), false);
  // pagină sub 1000 → nu mai e nimic de verificat
  assertEquals(shouldFetchNextPage({ pagesDone: 1, requested: 999, checked: 999, hasBudget: true }), false);
  // buget epuizat
  assertEquals(shouldFetchNextPage({ pagesDone: 1, requested: 1000, checked: 1000, hasBudget: false }), false);
  // câteva bilete fără chitanță încă → se continuă (se repetă doar ele, plafonul limitează)
  assertEquals(shouldFetchNextPage({ pagesDone: 1, requested: 1000, checked: 998, hasBudget: true }), true);
  // nicio chitanță pe o pagină plină → pagina următoare ar fi identică → stop
  assertEquals(shouldFetchNextPage({ pagesDone: 1, requested: 1000, checked: 0, hasBudget: true }), false);
  // pageSize/maxPages explicite
  assertEquals(shouldFetchNextPage({ pagesDone: 1, requested: 2, checked: 2, hasBudget: true, pageSize: 2, maxPages: 2 }), true);
  assertEquals(shouldFetchNextPage({ pagesDone: 2, requested: 2, checked: 2, hasBudget: true, pageSize: 2, maxPages: 2 }), false);
});

Deno.test('(10) addReceiptSummaries: contoarele paginilor se adună', () => {
  const a = summarizeReceipts(1000, [{ ticket_id: 'x', status: 'ok', error: null, dead: false }]);
  const b = summarizeReceipts(3, [{ ticket_id: 'y', status: 'error', error: 'DeviceNotRegistered: z', dead: true }]);
  assertEquals(addReceiptSummaries(a, b), { requested: 1003, checked: 2, ok: 1, errors: 1, dead_tokens: 1 });
});
