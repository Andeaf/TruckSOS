// 11 nov 2026 — faza 9.3: teste pentru fluxul cererii din handler.ts (dependențe injectate; fără rețea).
// Rulare: deno test supabase/functions/cleanup-announcements

import { assertEquals } from 'jsr:@std/assert';
import { type AdminLike, type CleanupAnnouncementsDeps, makeCleanupAnnouncementsHandler } from './handler.ts';

const SECRET = 'C'.repeat(48);
const NOW = Date.parse('2026-11-11T12:00:00.000Z');
/** NOW − 30 h. */
const CUTOFF = '2026-11-10T06:00:00.000Z';
/** Lista exceptată, scrisă de mână: o schimbare accidentală a uuid-urilor demo pică testul. */
const EXEMPT = '(9406f673-d96d-41cc-b398-a0d051f26d8b,36ce6369-0d85-45de-9dff-59951e3787e2)';

type DbResult = { data: unknown; error: { message: string } | null };
type PhotoRow = { id: string; storage_path: string; announcements: { id: string } };

function photos(n: number, from = 1): PhotoRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${from + i}`,
    storage_path: `announcements/a${from + i}/p.jpg`,
    announcements: { id: `a${from + i}` },
  }));
}

interface FakeOpts {
  expired?: number;
  photoRows?: PhotoRow[];
  expireErr?: string;
  selectErr?: string;
  failRemoveCall?: number;
  failDeleteCall?: number;
}

function fakeAdmin(opts: FakeOpts = {}) {
  /** Fiecare apel din lanțurile PostgREST, cu tabelul lui. */
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  /** Ordinea operațiilor pe loturi: `remove:<n>` / `delete:<n>`. */
  const events: string[] = [];
  const removes: { bucket: string; paths: string[] }[] = [];
  const deletes: string[][] = [];
  let removeCall = 0;
  let deleteCall = 0;
  const done = (r: DbResult): PromiseLike<DbResult> => Promise.resolve(r);
  const err = (message: string | undefined) => (message ? { message } : null);

  const admin: AdminLike = {
    from(table) {
      const rec = (method: string, ...args: unknown[]) => calls.push({ table, method, args });
      return {
        update(values) {
          rec('update', values);
          return {
            eq(c1, v1) {
              rec('eq', c1, v1);
              return {
                lt(c2, v2) {
                  rec('lt', c2, v2);
                  return {
                    not(c3, op, v3) {
                      rec('not', c3, op, v3);
                      return {
                        select(cols) {
                          rec('select', cols);
                          if (opts.expireErr) return done({ data: null, error: err(opts.expireErr) });
                          const ids = Array.from({ length: opts.expired ?? 0 }, (_, i) => ({ id: `x${i}` }));
                          return done({ data: ids, error: null });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        select(cols) {
          rec('select', cols);
          return {
            lt(c1, v1) {
              rec('lt', c1, v1);
              return {
                filter(c2, op2, v2) {
                  rec('filter', c2, op2, v2);
                  return {
                    not(c3, op3, v3) {
                      rec('not', c3, op3, v3);
                      return {
                        limit(n) {
                          rec('limit', n);
                          if (opts.selectErr) return done({ data: null, error: err(opts.selectErr) });
                          return done({ data: opts.photoRows ?? [], error: null });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        delete() {
          rec('delete');
          return {
            in(column, values) {
              rec('in', column, values);
              deleteCall += 1;
              deletes.push(values);
              events.push(`delete:${values.length}`);
              if (opts.failDeleteCall === deleteCall) return done({ data: null, error: { message: 'db down' } });
              return done({ data: null, error: null });
            },
          };
        },
      };
    },
    storage: {
      from(bucket) {
        return {
          remove(paths) {
            removeCall += 1;
            removes.push({ bucket, paths });
            events.push(`remove:${paths.length}`);
            if (opts.failRemoveCall === removeCall) {
              return Promise.resolve({ data: null, error: { message: 'storage down' } });
            }
            return Promise.resolve({ data: paths.map((name) => ({ name })), error: null });
          },
        };
      },
    },
  };
  return { admin, calls, events, removes, deletes };
}

function setup(admin: AdminLike, env: Record<string, string | undefined> = {}) {
  const allEnv: Record<string, string | undefined> = {
    PUSH_KICK_SECRET: SECRET,
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    ...env,
  };
  const read: string[] = [];
  let created = 0;
  const d: CleanupAnnouncementsDeps = {
    env: (name) => {
      read.push(name);
      return allEnv[name];
    },
    createAdmin: () => {
      created += 1;
      return admin;
    },
    now: () => NOW,
  };
  return { d, read, createdCount: () => created };
}

function req(headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request('https://edge/cleanup-announcements', {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'POST' ? '{}' : undefined,
  });
}

const OK = { 'x-push-secret': SECRET };

Deno.test('(1) fără x-push-secret → 401, fără client admin, fără interogări; singurul env citit e PUSH_KICK_SECRET', async () => {
  const f = fakeAdmin({ expired: 2, photoRows: photos(3) });
  const t = setup(f.admin);
  const res = await makeCleanupAnnouncementsHandler(t.d)(req());
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: 'unauthorized' });
  assertEquals(t.createdCount(), 0);
  assertEquals(f.calls, []);
  assertEquals(t.read, ['PUSH_KICK_SECRET']);
});

Deno.test('(2) header greșit sau Bearer service_role (cron-ul vechi) → 401, fără client admin', async () => {
  const f = fakeAdmin();
  const t = setup(f.admin);
  const h = makeCleanupAnnouncementsHandler(t.d);
  const wrong = await h(req({ 'x-push-secret': SECRET.slice(0, -1) + 'x' }));
  assertEquals(wrong.status, 401);
  assertEquals(await wrong.json(), { error: 'unauthorized' });
  assertEquals((await h(req({ Authorization: 'Bearer a.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c' }))).status, 401);
  assertEquals(t.createdCount(), 0);
  assertEquals(f.calls, []);
});

Deno.test('(3) PUSH_KICK_SECRET lipsă sau < 32 de octeți → 401 chiar cu header egal (fail closed)', async () => {
  const short = 's'.repeat(31);
  for (const [secret, header] of [[undefined, SECRET], ['', SECRET], [short, short]] as const) {
    const f = fakeAdmin({ expired: 1 });
    const t = setup(f.admin, { PUSH_KICK_SECRET: secret });
    const res = await makeCleanupAnnouncementsHandler(t.d)(req({ 'x-push-secret': header }));
    assertEquals(res.status, 401);
    assertEquals(t.createdCount(), 0);
    assertEquals(f.calls, []);
  }
});

Deno.test('(4) GET fără header → 401 (poarta înaintea metodei); GET cu header corect → 405, fără client admin', async () => {
  const f = fakeAdmin();
  const t = setup(f.admin);
  const h = makeCleanupAnnouncementsHandler(t.d);
  assertEquals((await h(req({}, 'GET'))).status, 401);
  const res = await h(req(OK, 'GET'));
  assertEquals(res.status, 405);
  assertEquals(await res.json(), { error: 'method_not_allowed' });
  assertEquals(t.createdCount(), 0);
  assertEquals(f.calls, []);
});

Deno.test('(5) fără SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY → 500 not_configured, fără client admin', async () => {
  for (const env of [{ SUPABASE_URL: undefined }, { SUPABASE_SERVICE_ROLE_KEY: undefined }, { SUPABASE_URL: '' }]) {
    const f = fakeAdmin();
    const t = setup(f.admin, env);
    const res = await makeCleanupAnnouncementsHandler(t.d)(req(OK));
    assertEquals(res.status, 500);
    assertEquals(await res.json(), { error: 'not_configured' });
    assertEquals(t.createdCount(), 0);
    assertEquals(f.calls, []);
  }
});

Deno.test('(6) nominal: 2 expirate, 150 de poze → loturi 100 + 50, remove înaintea delete în fiecare lot', async () => {
  const f = fakeAdmin({ expired: 2, photoRows: photos(150) });
  const t = setup(f.admin);
  const res = await makeCleanupAnnouncementsHandler(t.d)(req(OK));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, expired: 2, photosRemoved: 150, photosPending: 0, failures: [] });
  assertEquals(t.createdCount(), 1);
  assertEquals(f.events, ['remove:100', 'delete:100', 'remove:50', 'delete:50']);
  assertEquals(f.removes.map((r) => r.bucket), ['photos', 'photos']);
  assertEquals(f.removes[0].paths[0], 'announcements/a1/p.jpg');
  assertEquals(f.removes[1].paths[49], 'announcements/a150/p.jpg');
  assertEquals(f.deletes[0], Array.from({ length: 100 }, (_, i) => `p${i + 1}`));
  assertEquals(f.deletes[1], Array.from({ length: 50 }, (_, i) => `p${i + 101}`));
  const ins = f.calls.filter((c) => c.method === 'in');
  assertEquals(ins.map((c) => [c.table, c.args[0]]), [['announcement_photos', 'id'], ['announcement_photos', 'id']]);
});

Deno.test('(7) remove eșuat pe lotul 1 → rândurile lui NU se șterg, lotul 2 continuă; ok false, photosPending corect', async () => {
  const f = fakeAdmin({ expired: 0, photoRows: photos(150), failRemoveCall: 1 });
  const res = await makeCleanupAnnouncementsHandler(setup(f.admin).d)(req(OK));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    ok: false,
    expired: 0,
    photosRemoved: 50,
    photosPending: 100,
    failures: ['storage down'],
  });
  assertEquals(f.events, ['remove:100', 'remove:50', 'delete:50']);
  assertEquals(f.deletes, [Array.from({ length: 50 }, (_, i) => `p${i + 101}`)]);
});

Deno.test('(8) delete eșuat după remove → lotul rămâne în așteptare (se reia la rularea următoare)', async () => {
  const f = fakeAdmin({ expired: 1, photoRows: photos(150), failDeleteCall: 2 });
  const body = await (await makeCleanupAnnouncementsHandler(setup(f.admin).d)(req(OK))).json();
  assertEquals(body, { ok: false, expired: 1, photosRemoved: 100, photosPending: 50, failures: ['db down'] });
});

Deno.test('(9) expire_failed → 500 cu detaliul, fără selecția pozelor și fără remove', async () => {
  const f = fakeAdmin({ photoRows: photos(5), expireErr: 'nope' });
  const res = await makeCleanupAnnouncementsHandler(setup(f.admin).d)(req(OK));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'expire_failed', detail: 'nope' });
  assertEquals(f.calls.filter((c) => c.table === 'announcement_photos'), []);
  assertEquals(f.removes, []);
});

Deno.test('(10) select_photos_failed → 500 cu detaliul, fără remove', async () => {
  const f = fakeAdmin({ expired: 3, photoRows: photos(5), selectErr: 'bad' });
  const res = await makeCleanupAnnouncementsHandler(setup(f.admin).d)(req(OK));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'select_photos_failed', detail: 'bad' });
  assertEquals(f.removes, []);
});

Deno.test('(11) interogările: cutoff = now − 30 h, exceptarea demo, plafonul 500, `accepted` exclus', async () => {
  const f = fakeAdmin({ expired: 0, photoRows: [] });
  await makeCleanupAnnouncementsHandler(setup(f.admin).d)(req(OK));
  assertEquals(
    f.calls.filter((c) => c.table === 'announcements').map((c) => [c.method, ...c.args]),
    [
      ['update', { status: 'cancelled' }],
      ['eq', 'status', 'open'],
      ['lt', 'created_at', CUTOFF],
      ['not', 'driver_id', 'in', EXEMPT],
      ['select', 'id'],
    ],
  );
  assertEquals(
    f.calls.filter((c) => c.table === 'announcement_photos').map((c) => [c.method, ...c.args]),
    [
      ['select', 'id, storage_path, announcements!inner(id)'],
      ['lt', 'announcements.created_at', CUTOFF],
      ['filter', 'announcements.status', 'neq', 'accepted'],
      ['not', 'announcements.driver_id', 'in', EXEMPT],
      ['limit', 500],
    ],
  );
  // fără poze: niciun remove / delete
  assertEquals(f.events, []);
});
