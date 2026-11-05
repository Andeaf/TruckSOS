// 4 nov 2026 — teste pentru fluxul cererii din handler.ts (dependențe injectate; fără rețea).
// Rulare: deno test supabase/functions/push-dispatch

import { assertEquals } from 'jsr:@std/assert';
import { type AdminLike, type DispatchDeps, makeDispatchHandler } from './handler.ts';
import type { ClaimRow, ExpoMessage, HttpReply } from './payload.ts';

const SECRET = 'S'.repeat(48);
const URL = 'https://x.supabase.co';

/** Clientul admin de test: numără apelurile rpc și întoarce ce i se dă. */
function fakeAdmin(claims: ClaimRow[][] = []): AdminLike & { calls: string[]; finishes: unknown[] } {
  let i = 0;
  const calls: string[] = [];
  const finishes: unknown[] = [];
  return {
    calls,
    finishes,
    rpc(fn, args) {
      calls.push(fn);
      if (fn === 'claim_push_batch') return Promise.resolve({ data: claims[i++] ?? [], error: null });
      if (fn === 'finish_push_batch') {
        finishes.push(args?.p_results);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `rpc necunoscut: ${fn}` } });
    },
  };
}

function deps(over: Partial<DispatchDeps> & { admin?: AdminLike; expo?: HttpReply } = {}) {
  const admin = over.admin ?? fakeAdmin();
  let created = 0;
  const env: Record<string, string> = {
    PUSH_KICK_SECRET: SECRET,
    SUPABASE_URL: URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    EXPO_ACCESS_TOKEN: 'expo-token',
  };
  const posts: ExpoMessage[][] = [];
  const d: DispatchDeps = {
    env: (name) => env[name],
    createAdmin: () => {
      created += 1;
      return admin;
    },
    postToExpo: (messages) => {
      posts.push(messages);
      return Promise.resolve(over.expo ?? { status: 200, body: { data: messages.map(() => ({ status: 'ok', id: 't' })) } });
    },
    sleep: () => Promise.resolve(),
    now: () => 0,
    ...over,
  };
  return { d, env, posts, createdCount: () => created, admin };
}

function req(headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request('https://edge/push-dispatch', { method, headers });
}

Deno.test('(1) fără x-push-secret → 401, fără client admin, fără rpc, fără citirea env-ului Expo', async () => {
  const read: string[] = [];
  const t = deps();
  const base = t.d.env;
  t.d.env = (name) => {
    read.push(name);
    return base(name);
  };
  const res = await makeDispatchHandler(t.d)(req());
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: 'unauthorized' });
  assertEquals(t.createdCount(), 0);
  assertEquals((t.admin as ReturnType<typeof fakeAdmin>).calls, []);
  assertEquals(read, ['PUSH_KICK_SECRET']);
});

Deno.test('(2) header greșit → 401, fără client admin', async () => {
  const t = deps();
  const res = await makeDispatchHandler(t.d)(req({ 'x-push-secret': SECRET.slice(0, -1) + 'x' }));
  assertEquals(res.status, 401);
  assertEquals(t.createdCount(), 0);
});

Deno.test('(3) PUSH_KICK_SECRET neconfigurat → 401 chiar cu header (fail closed)', async () => {
  const t = deps();
  delete t.env.PUSH_KICK_SECRET;
  const res = await makeDispatchHandler(t.d)(req({ 'x-push-secret': SECRET }));
  assertEquals(res.status, 401);
  assertEquals(t.createdCount(), 0);
});

Deno.test('(3b) GET fără header → 401, nu 405 (poarta e înaintea metodei)', async () => {
  const t = deps();
  const res = await makeDispatchHandler(t.d)(req({}, 'GET'));
  assertEquals(res.status, 401);
  assertEquals(t.createdCount(), 0);
});

Deno.test('(4) header corect, metodă GET → 405 (poarta trece, metoda nu)', async () => {
  const t = deps();
  const res = await makeDispatchHandler(t.d)(req({ 'x-push-secret': SECRET }, 'GET'));
  assertEquals(res.status, 405);
  assertEquals(t.createdCount(), 0);
});

Deno.test('(5) header corect, fără EXPO_ACCESS_TOKEN → 500 missing_expo_access_token, fără claim', async () => {
  const t = deps();
  delete t.env.EXPO_ACCESS_TOKEN;
  const res = await makeDispatchHandler(t.d)(req({ 'x-push-secret': SECRET }));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, 'missing_expo_access_token');
  assertEquals((t.admin as ReturnType<typeof fakeAdmin>).calls, []);
});

Deno.test('(6) header corect, coadă goală → 200 cu zerouri, un singur claim, fără POST', async () => {
  const t = deps();
  const res = await makeDispatchHandler(t.d)(req({ 'x-push-secret': SECRET }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.claimed, 0);
  assertEquals(body.batches, 0);
  assertEquals((t.admin as ReturnType<typeof fakeAdmin>).calls, ['claim_push_batch']);
  assertEquals(t.posts.length, 0);
});

Deno.test('(7) header corect, un rând → un POST la Expo, un finish cu sent + bilet, 200', async () => {
  const row: ClaimRow = {
    queue_id: 1,
    token: 'ExponentPushToken[abc]',
    platform: 'android',
    title: 'T',
    body: 'B',
    data: { type: 'chat', id: 'c1' },
    tag: null,
    ios_title: null,
    ios_body: null,
    attempts: 0,
    claimed_at: '2026-11-04T00:00:00.000000+00:00',
  };
  const admin = fakeAdmin([[row]]);
  const t = deps({ admin });
  const res = await makeDispatchHandler(t.d)(req({ 'x-push-secret': SECRET }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.claimed, 1);
  assertEquals(body.sent, 1);
  assertEquals(body.batches, 1);
  assertEquals(admin.calls, ['claim_push_batch', 'finish_push_batch', 'claim_push_batch']);
  const finished = admin.finishes[0] as Array<{ queue_id: number; outcome: string; claimed_at: string }>;
  assertEquals(finished.length, 1);
  assertEquals(finished[0].queue_id, 1);
  assertEquals(finished[0].outcome, 'sent');
  assertEquals(finished[0].claimed_at, row.claimed_at);
});
