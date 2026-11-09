// 9 nov 2026 — teste pentru fluxul cererii din handler.ts (dependențe injectate; fără rețea).
// Rulare: deno test supabase/functions/storage-gc

import { assertEquals } from 'jsr:@std/assert';
import { type AdminLike, type GcRow, makeStorageGcHandler, type StorageGcDeps } from './handler.ts';

const SECRET = 'G'.repeat(48);

function rows(n: number, bucket = 'photos', from = 1, reason = 'orphan_announcement_photo'): GcRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: from + i,
    bucket,
    name: `announcements/a${from + i}/p.jpg`,
    reason,
    created_at: '2026-11-09T00:00:00Z',
  }));
}

function fakeAdmin(claim: GcRow[], opts: { failRemoveCall?: number; failFinish?: boolean } = {}) {
  const rpcCalls: { fn: string; args?: Record<string, unknown> }[] = [];
  const removes: { bucket: string; names: string[] }[] = [];
  let removeCall = 0;
  const admin: AdminLike = {
    rpc(fn, args) {
      rpcCalls.push({ fn, args });
      if (fn === 'storage_gc_claim') return Promise.resolve({ data: claim, error: null });
      if (fn === 'storage_gc_finish') {
        if (opts.failFinish) return Promise.resolve({ data: null, error: { message: 'boom' } });
        return Promise.resolve({ data: (args?.p_ids as number[]).length, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `rpc necunoscut: ${fn}` } });
    },
    storage: {
      from(bucket) {
        return {
          remove(names) {
            removeCall += 1;
            removes.push({ bucket, names });
            if (opts.failRemoveCall === removeCall) {
              return Promise.resolve({ data: null, error: { message: 'storage down' } });
            }
            return Promise.resolve({ data: names.map((name) => ({ name })), error: null });
          },
        };
      },
    },
  };
  return { admin, rpcCalls, removes };
}

function setup(admin: AdminLike, env: Record<string, string | undefined> = {}, clock?: () => number) {
  const allEnv: Record<string, string | undefined> = {
    PUSH_KICK_SECRET: SECRET,
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    ...env,
  };
  const read: string[] = [];
  let created = 0;
  const d: StorageGcDeps = {
    env: (name) => {
      read.push(name);
      return allEnv[name];
    },
    createAdmin: () => {
      created += 1;
      return admin;
    },
    now: clock ?? (() => 0),
  };
  return { d, read, createdCount: () => created };
}

function req(headers: Record<string, string> = {}, body?: unknown, method = 'POST'): Request {
  return new Request('https://edge/storage-gc', {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const OK = { 'x-push-secret': SECRET };
const APPLY = { STORAGE_GC_APPLY: 'true' };

Deno.test('(1) fără x-push-secret → 401, fără client admin, fără rpc; singurul env citit e PUSH_KICK_SECRET', async () => {
  const f = fakeAdmin(rows(3));
  const t = setup(f.admin);
  const res = await makeStorageGcHandler(t.d)(req({}, { scan: true }));
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: 'unauthorized' });
  assertEquals(t.createdCount(), 0);
  assertEquals(f.rpcCalls, []);
  assertEquals(t.read, ['PUSH_KICK_SECRET']);
});

Deno.test('(2) header greșit sau GET fără header → 401 (poarta înaintea metodei)', async () => {
  const f = fakeAdmin(rows(3));
  const t = setup(f.admin);
  const h = makeStorageGcHandler(t.d);
  assertEquals((await h(req({ 'x-push-secret': SECRET.slice(0, -1) + 'x' }))).status, 401);
  assertEquals((await h(req({}, undefined, 'GET'))).status, 401);
  assertEquals(t.createdCount(), 0);
  assertEquals(f.rpcCalls, []);
});

Deno.test('(3) PUSH_KICK_SECRET neconfigurat → 401 chiar cu header (fail closed)', async () => {
  const f = fakeAdmin(rows(1));
  const t = setup(f.admin, { PUSH_KICK_SECRET: undefined });
  assertEquals((await makeStorageGcHandler(t.d)(req(OK))).status, 401);
  assertEquals(f.rpcCalls, []);
});

Deno.test('(4) header corect, GET → 405; fără env Supabase → 500, fără rpc', async () => {
  const f = fakeAdmin(rows(1));
  assertEquals((await makeStorageGcHandler(setup(f.admin).d)(req(OK, undefined, 'GET'))).status, 405);
  const t = setup(f.admin, { SUPABASE_SERVICE_ROLE_KEY: undefined });
  const res = await makeStorageGcHandler(t.d)(req(OK));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, 'missing_supabase_env');
  assertEquals(f.rpcCalls, []);
});

Deno.test('(5) dry-run implicit: fără remove/finish; count, by_reason, sample de 50', async () => {
  const claim = [...rows(60), ...rows(5, 'photos', 100, 'retention_draft')];
  const f = fakeAdmin(claim);
  for (const env of [{}, { STORAGE_GC_APPLY: 'false' }, { STORAGE_GC_APPLY: 'TRUE' }]) {
    f.rpcCalls.length = 0;
    const res = await makeStorageGcHandler(setup(f.admin, env).d)(req(OK));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.dry_run, true);
    assertEquals(body.count, 65);
    assertEquals(body.by_reason, { orphan_announcement_photo: 60, retention_draft: 5 });
    assertEquals(body.sample.length, 50);
    assertEquals(body.sample[0], 'announcements/a1/p.jpg');
    assertEquals(f.rpcCalls.map((c) => c.fn), ['storage_gc_claim']);
  }
  assertEquals(f.removes, []);
});

Deno.test('(6) scan din body ajunge în p_scan; corp lipsă / ne-JSON / scan ne-boolean → false', async () => {
  const cases: [unknown, boolean][] = [
    [{ scan: true }, true],
    [{ scan: false }, false],
    [{ scan: 'true' }, false],
    [undefined, false],
    ['nu-e-json', false],
  ];
  for (const [body, expected] of cases) {
    const f = fakeAdmin([]);
    const res = await makeStorageGcHandler(setup(f.admin).d)(req(OK, body));
    assertEquals(res.status, 200);
    assertEquals(f.rpcCalls[0], { fn: 'storage_gc_claim', args: { p_limit: 500, p_scan: expected } });
  }
});

Deno.test('(7) APPLY: 250 rânduri → 3 loturi (100/100/50), finish cu id-urile fiecărui lot', async () => {
  const f = fakeAdmin(rows(250));
  const res = await makeStorageGcHandler(setup(f.admin, APPLY).d)(req(OK));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(f.removes.map((r) => r.names.length), [100, 100, 50]);
  assertEquals(f.removes[0].names[0], 'announcements/a1/p.jpg');
  const finishes = f.rpcCalls.filter((c) => c.fn === 'storage_gc_finish').map((c) => c.args?.p_ids as number[]);
  assertEquals(finishes.length, 3);
  assertEquals(finishes[0], Array.from({ length: 100 }, (_, i) => i + 1));
  assertEquals(finishes[2], Array.from({ length: 50 }, (_, i) => i + 201));
  assertEquals(
    { dry_run: body.dry_run, claimed: body.claimed, removed: body.removed, finished: body.finished, failed: body.failed_batches },
    { dry_run: false, claimed: 250, removed: 250, finished: 250, failed: 0 },
  );
});

Deno.test('(8) APPLY: lotul 2 eșuează → finish NEapelat pentru el, failed_batches 1, restul continuă', async () => {
  const f = fakeAdmin(rows(250), { failRemoveCall: 2 });
  const body = await (await makeStorageGcHandler(setup(f.admin, APPLY).d)(req(OK))).json();
  const finishes = f.rpcCalls.filter((c) => c.fn === 'storage_gc_finish').map((c) => (c.args?.p_ids as number[])[0]);
  assertEquals(finishes, [1, 201]);
  assertEquals(body.failed_batches, 1);
  assertEquals(body.removed, 150);
  assertEquals(body.finished, 150);
});

Deno.test('(9) APPLY: grupare pe bucket (loturi separate, fiecare cu bucket-ul lui)', async () => {
  const f = fakeAdmin([...rows(2, 'photos', 1), ...rows(3, 'other', 10), ...rows(1, 'photos', 20)]);
  await makeStorageGcHandler(setup(f.admin, APPLY).d)(req(OK));
  assertEquals(f.removes.map((r) => [r.bucket, r.names.length]), [['photos', 3], ['other', 3]]);
});

Deno.test('(10) APPLY: finish eșuat → failed_batches, obiectele numărate ca șterse, rândurile rămân', async () => {
  const f = fakeAdmin(rows(10), { failFinish: true });
  const body = await (await makeStorageGcHandler(setup(f.admin, APPLY).d)(req(OK))).json();
  assertEquals(body.removed, 10);
  assertEquals(body.finished, 0);
  assertEquals(body.failed_batches, 1);
});

Deno.test('(11) APPLY: bugetul de 45 s se verifică înaintea fiecărui lot; restul rămâne (skipped)', async () => {
  const f = fakeAdmin(rows(250));
  let t = 0;
  // start = 0; fiecare apel la now() după start avansează 30 s → lotul 1 trece (30 s), lotul 2 vede 60 s → stop.
  const clock = () => {
    const v = t;
    t += 30_000;
    return v;
  };
  const body = await (await makeStorageGcHandler(setup(f.admin, APPLY, clock).d)(req(OK))).json();
  assertEquals(f.removes.length, 1);
  assertEquals(body.skipped, 150);
  assertEquals(body.finished, 100);
});

Deno.test('(12) claim eșuat → 500 claim_failed, fără remove', async () => {
  const f = fakeAdmin([]);
  f.admin.rpc = () => Promise.resolve({ data: null, error: { message: 'nope' } });
  const res = await makeStorageGcHandler(setup(f.admin, APPLY).d)(req(OK));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'claim_failed', detail: 'nope' });
  assertEquals(f.removes, []);
});
