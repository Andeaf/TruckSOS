// 4 nov 2026 — teste pentru fluxul cererii din handler.ts (dependențe injectate; fără rețea).
// Rulare: deno test supabase/functions/push-receipts

import { assertEquals } from 'jsr:@std/assert';
import { type AdminLike, makeReceiptsHandler, type ReceiptsDeps } from './handler.ts';
import type { PendingTicket, ReceiptsResponse } from './receipts.ts';

const SECRET = 'R'.repeat(40);

/** Clientul admin de test: numără apelurile rpc și întoarce paginile date. */
function fakeAdmin(pages: PendingTicket[][] = []): AdminLike & { calls: string[]; finishes: unknown[] } {
  let i = 0;
  const calls: string[] = [];
  const finishes: unknown[] = [];
  return {
    calls,
    finishes,
    rpc(fn, args) {
      calls.push(fn);
      if (fn === 'pending_push_receipts') return Promise.resolve({ data: pages[i++] ?? [], error: null });
      if (fn === 'finish_push_receipts') {
        finishes.push(args?.p_results);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `rpc necunoscut: ${fn}` } });
    },
  };
}

function deps(over: Partial<ReceiptsDeps> & { admin?: AdminLike; expo?: ReceiptsResponse } = {}) {
  const admin = over.admin ?? fakeAdmin();
  let created = 0;
  const env: Record<string, string> = {
    PUSH_KICK_SECRET: SECRET,
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    EXPO_ACCESS_TOKEN: 'expo-token',
  };
  const fetched: string[][] = [];
  const d: ReceiptsDeps = {
    env: (name) => env[name],
    createAdmin: () => {
      created += 1;
      return admin;
    },
    fetchReceipts: (ids) => {
      fetched.push(ids);
      return Promise.resolve(over.expo ?? { ok: true, receipts: Object.fromEntries(ids.map((id) => [id, { status: 'ok' }])) });
    },
    now: () => 0,
    ...over,
  };
  return { d, env, fetched, createdCount: () => created, admin };
}

function req(headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request('https://edge/push-receipts', { method, headers });
}

Deno.test('(1) fără x-push-secret → 401, fără client admin, fără rpc, fără citirea env-ului Expo', async () => {
  const read: string[] = [];
  const t = deps();
  const base = t.d.env;
  t.d.env = (name) => {
    read.push(name);
    return base(name);
  };
  const res = await makeReceiptsHandler(t.d)(req());
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: 'unauthorized' });
  assertEquals(t.createdCount(), 0);
  assertEquals((t.admin as ReturnType<typeof fakeAdmin>).calls, []);
  assertEquals(read, ['PUSH_KICK_SECRET']);
});

Deno.test('(1b) GET fără header → 401, nu 405 (poarta e înaintea metodei)', async () => {
  const t = deps();
  const res = await makeReceiptsHandler(t.d)(req({}, 'GET'));
  assertEquals(res.status, 401);
});

Deno.test('(2) header greșit → 401', async () => {
  const t = deps();
  const res = await makeReceiptsHandler(t.d)(req({ 'x-push-secret': 'x'.repeat(40) }));
  assertEquals(res.status, 401);
  assertEquals(t.createdCount(), 0);
});

Deno.test('(3) PUSH_KICK_SECRET neconfigurat → 401 chiar cu header (fail closed)', async () => {
  const t = deps();
  delete t.env.PUSH_KICK_SECRET;
  const res = await makeReceiptsHandler(t.d)(req({ 'x-push-secret': SECRET }));
  assertEquals(res.status, 401);
});

Deno.test('(4) header corect, nimic de verificat → 200 cu 0 pagini, fără fetch', async () => {
  const t = deps();
  const res = await makeReceiptsHandler(t.d)(req({ 'x-push-secret': SECRET }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.pages, 0);
  assertEquals(t.fetched.length, 0);
  assertEquals((t.admin as ReturnType<typeof fakeAdmin>).calls, ['pending_push_receipts']);
});

Deno.test('(5) header corect, o pagină cu 2 bilete ok → un fetch, un finish cu 2 rezultate ok, 200', async () => {
  const admin = fakeAdmin([[{ ticket_id: 't1', token: 'ExponentPushToken[a]' }, { ticket_id: 't2', token: 'ExponentPushToken[b]' }]]);
  const t = deps({ admin });
  const res = await makeReceiptsHandler(t.d)(req({ 'x-push-secret': SECRET }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.pages, 1);
  assertEquals(body.requested, 2);
  assertEquals(body.ok, 2);
  assertEquals(t.fetched, [['t1', 't2']]);
  const finished = admin.finishes[0] as Array<{ ticket_id: string; status: string; dead: boolean }>;
  assertEquals(finished.map((r) => [r.ticket_id, r.status, r.dead]), [['t1', 'ok', false], ['t2', 'ok', false]]);
});

Deno.test('(6) header corect, Expo răspunde cu eroare → 500 receipts_failed, fără finish', async () => {
  const admin = fakeAdmin([[{ ticket_id: 't1', token: 'ExponentPushToken[a]' }]]);
  const t = deps({ admin, expo: { ok: false, error: 'http 500' } });
  const res = await makeReceiptsHandler(t.d)(req({ 'x-push-secret': SECRET }));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, 'receipts_failed');
  assertEquals(admin.finishes.length, 0);
});
