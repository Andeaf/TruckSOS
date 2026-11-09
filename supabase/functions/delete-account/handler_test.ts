// 9 nov 2026 — teste pentru delete-account (dependențe injectate; fără rețea, cheie Apple generată în test).
// Rulare: deno test supabase/functions/delete-account

import { assertEquals } from 'jsr:@std/assert';
import { type AdminLike, type DeleteAccountDeps, makeDeleteAccountHandler, type UserClientLike } from './handler.ts';

const UID = '11111111-2222-3333-4444-555555555555';

async function testPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----\n`;
}

interface Opts {
  user?: { id: string } | null;
  purgeError?: string;
  paths?: string[] | null;
  removeError?: string;
  deleteError?: string;
  appleToken?: string | null;
  readError?: string;
  readThrows?: boolean;
  recordError?: string;
  revokeStatus?: number;
  fetchThrows?: boolean;
  appleEnv?: boolean;
}

async function setup(o: Opts = {}) {
  /** Ordinea globală a pașilor: rpc-uri (user/admin), storage, deleteUser, fetch. */
  const steps: string[] = [];
  const rpcArgs: Record<string, Record<string, unknown> | undefined> = {};
  const fetched: { url: string; form: URLSearchParams }[] = [];
  const removed: { bucket: string; paths: string[] }[] = [];
  const env: Record<string, string | undefined> = o.appleEnv === false
    ? {}
    : {
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY1234567',
      APPLE_PRIVATE_KEY: await testPem(),
      APPLE_CLIENT_ID: 'com.andeaf.trucksos',
    };

  const userClient: UserClientLike = {
    auth: {
      getUser: () => {
        const user = o.user === undefined ? { id: UID } : o.user;
        return Promise.resolve(
          user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } },
        );
      },
    },
    rpc(fn) {
      steps.push(`user:${fn}`);
      if (fn === 'purge_user_data') {
        return Promise.resolve(
          o.purgeError
            ? { data: null, error: { message: o.purgeError } }
            : { data: o.paths === undefined ? ['chat/a.jpg', '', 'market/b.jpg'] : o.paths, error: null },
        );
      }
      return Promise.resolve({ data: null, error: { message: `rpc necunoscut: ${fn}` } });
    },
  };

  const admin: AdminLike = {
    rpc(fn, args) {
      steps.push(`admin:${fn}`);
      rpcArgs[fn] = args;
      if (fn === 'read_apple_token') {
        if (o.readThrows) return Promise.reject(new Error('boom'));
        if (o.readError) return Promise.resolve({ data: null, error: { message: o.readError } });
        return Promise.resolve({ data: o.appleToken === undefined ? null : o.appleToken, error: null });
      }
      if (fn === 'record_account_deletion') {
        return Promise.resolve({ data: null, error: o.recordError ? { message: o.recordError } : null });
      }
      return Promise.resolve({ data: null, error: { message: `rpc necunoscut: ${fn}` } });
    },
    storage: {
      from(bucket) {
        return {
          remove(paths) {
            steps.push('storage.remove');
            removed.push({ bucket, paths });
            return Promise.resolve({ data: [], error: o.removeError ? { message: o.removeError } : null });
          },
        };
      },
    },
    auth: {
      admin: {
        deleteUser(id) {
          steps.push(`deleteUser:${id}`);
          return Promise.resolve({ data: null, error: o.deleteError ? { message: o.deleteError } : null });
        },
      },
    },
  };

  const d: DeleteAccountDeps = {
    env: (name) => env[name],
    createUserClient: () => userClient,
    createAdmin: () => admin,
    fetch: (url, init) => {
      steps.push('fetch');
      fetched.push({ url, form: new URLSearchParams(String(init.body)) });
      if (o.fetchThrows) return Promise.reject(new TypeError('network'));
      return Promise.resolve(new Response(o.revokeStatus === 200 || o.revokeStatus === undefined ? '' : '{"error":"invalid_request"}', {
        status: o.revokeStatus ?? 200,
      }));
    },
    now: () => 1_800_000_000_000,
  };
  return { d, steps, rpcArgs, fetched, removed };
}

function post(headers: Record<string, string> = { Authorization: 'Bearer user-jwt' }): Request {
  return new Request('https://edge/delete-account', { method: 'POST', headers });
}

const LEGACY_TAIL = ['user:purge_user_data', 'storage.remove', `deleteUser:${UID}`];

// ── Contractul vechi (clienții 1.0.x) ──

Deno.test('OPTIONS → 200 "ok" cu CORS; GET → 405 method_not_allowed', async () => {
  const t = await setup();
  const h = makeDeleteAccountHandler(t.d);
  const opt = await h(new Request('https://edge/delete-account', { method: 'OPTIONS' }));
  assertEquals(opt.status, 200);
  assertEquals(await opt.text(), 'ok');
  assertEquals(opt.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(opt.headers.get('Access-Control-Allow-Headers'), 'authorization, x-client-info, apikey, content-type');
  const get = await h(new Request('https://edge/delete-account', { method: 'GET' }));
  assertEquals(get.status, 405);
  assertEquals(await get.json(), { error: 'method_not_allowed' });
  assertEquals(get.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assertEquals(t.steps, []);
});

Deno.test('fără Authorization → 401 missing_authorization; JWT invalid → 401 invalid_token; nimic atins', async () => {
  const t1 = await setup();
  const r1 = await makeDeleteAccountHandler(t1.d)(post({}));
  assertEquals(r1.status, 401);
  assertEquals(await r1.json(), { error: 'missing_authorization' });
  assertEquals(t1.steps, []);

  const t2 = await setup({ user: null });
  const r2 = await makeDeleteAccountHandler(t2.d)(post());
  assertEquals(r2.status, 401);
  assertEquals(await r2.json(), { error: 'invalid_token' });
  assertEquals(t2.steps, []);
});

Deno.test('fluxul reușit fără Apple → 200 { ok: true }; ordinea purge → storage → deleteUser; căile goale filtrate', async () => {
  const t = await setup();
  const res = await makeDeleteAccountHandler(t.d)(post());
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(t.steps, ['admin:read_apple_token', 'user:purge_user_data', 'admin:record_account_deletion', 'storage.remove', `deleteUser:${UID}`]);
  assertEquals(t.removed, [{ bucket: 'photos', paths: ['chat/a.jpg', 'market/b.jpg'] }]);
  assertEquals(t.rpcArgs.record_account_deletion, { p_user_id: UID, p_apple_revoked: 'no_token' });
  assertEquals(t.fetched, []);
});

Deno.test('purge eșuat → 500 purge_failed cu detail; fără storage, fără deleteUser', async () => {
  const t = await setup({ purgeError: 'boom' });
  const res = await makeDeleteAccountHandler(t.d)(post());
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'purge_failed', detail: 'boom' });
  assertEquals(t.steps.includes('storage.remove'), false);
  assertEquals(t.steps.some((s) => s.startsWith('deleteUser')), false);
});

Deno.test('storage eșuat → doar logat, deleteUser rulează, 200; fără căi → fără remove', async () => {
  const t = await setup({ removeError: 'down' });
  const res = await makeDeleteAccountHandler(t.d)(post());
  assertEquals(res.status, 200);
  assertEquals(t.steps.at(-1), `deleteUser:${UID}`);

  const t2 = await setup({ paths: null });
  assertEquals((await makeDeleteAccountHandler(t2.d)(post())).status, 200);
  assertEquals(t2.steps.includes('storage.remove'), false);
});

Deno.test('deleteUser eșuat → 500 auth_delete_failed cu detail', async () => {
  const t = await setup({ deleteError: 'nope' });
  const res = await makeDeleteAccountHandler(t.d)(post());
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'auth_delete_failed', detail: 'nope' });
});

// ── Apple (faza 6.1) ──

Deno.test('cu token + env → revoke cu form-ul corect, record("true"), apoi fluxul vechi', async () => {
  const t = await setup({ appleToken: 'apple-refresh' });
  const res = await makeDeleteAccountHandler(t.d)(post());
  assertEquals(res.status, 200);
  assertEquals(t.steps, ['admin:read_apple_token', 'fetch', 'user:purge_user_data', 'admin:record_account_deletion', 'storage.remove', `deleteUser:${UID}`]);
  assertEquals(t.rpcArgs.read_apple_token, { p_user_id: UID });
  assertEquals(t.fetched.length, 1);
  const { url, form } = t.fetched[0];
  assertEquals(url, 'https://appleid.apple.com/auth/revoke');
  assertEquals(form.get('client_id'), 'com.andeaf.trucksos');
  assertEquals(form.get('token'), 'apple-refresh');
  assertEquals(form.get('token_type_hint'), 'refresh_token');
  assertEquals((form.get('client_secret') ?? '').split('.').length, 3);
  assertEquals(t.rpcArgs.record_account_deletion, { p_user_id: UID, p_apple_revoked: 'true' });
});

Deno.test('revoke 400 → record("false:400") și ștergerea continuă (200)', async () => {
  const t = await setup({ appleToken: 'apple-refresh', revokeStatus: 400 });
  const res = await makeDeleteAccountHandler(t.d)(post());
  assertEquals(res.status, 200);
  assertEquals(t.rpcArgs.record_account_deletion?.p_apple_revoked, 'false:400');
  assertEquals(t.steps.filter((s) => s !== 'admin:record_account_deletion').slice(-3), LEGACY_TAIL);
});

Deno.test('revoke cu rețea picată → record("false:network") și ștergerea continuă', async () => {
  const t = await setup({ appleToken: 'apple-refresh', fetchThrows: true });
  assertEquals((await makeDeleteAccountHandler(t.d)(post())).status, 200);
  assertEquals(t.rpcArgs.record_account_deletion?.p_apple_revoked, 'false:network');
  assertEquals(t.steps.filter((s) => s !== 'admin:record_account_deletion').slice(-3), LEGACY_TAIL);
});

Deno.test('purge eșuat → record_account_deletion NEapelat (evidența se scrie doar după purjă; review 9 nov)', async () => {
  const t = await setup({ appleToken: 'apple-refresh', purgeError: 'boom' });
  assertEquals((await makeDeleteAccountHandler(t.d)(post())).status, 500);
  assertEquals(t.steps.includes('admin:record_account_deletion'), false);
});

Deno.test('fără token → record("no_token"), revoke NEapelat (chiar fără env)', async () => {
  for (const appleEnv of [true, false]) {
    const t = await setup({ appleToken: null, appleEnv });
    assertEquals((await makeDeleteAccountHandler(t.d)(post())).status, 200);
    assertEquals(t.rpcArgs.record_account_deletion?.p_apple_revoked, 'no_token');
    assertEquals(t.fetched, []);
  }
});

Deno.test('token, dar fără env Apple → record("not_configured"), revoke NEapelat, ștergerea continuă', async () => {
  const t = await setup({ appleToken: 'apple-refresh', appleEnv: false });
  assertEquals((await makeDeleteAccountHandler(t.d)(post())).status, 200);
  assertEquals(t.rpcArgs.record_account_deletion?.p_apple_revoked, 'not_configured');
  assertEquals(t.fetched, []);
  assertEquals(t.steps.filter((s) => s !== 'admin:record_account_deletion').slice(-3), LEGACY_TAIL);
});

Deno.test('read_apple_token aruncă sau dă eroare (ex. migrarea neaplicată) → record("false:read_failed"), ștergerea continuă', async () => {
  for (const o of [{ readThrows: true }, { readError: 'function public.read_apple_token(uuid) does not exist' }]) {
    const t = await setup(o);
    const res = await makeDeleteAccountHandler(t.d)(post());
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
    assertEquals(t.rpcArgs.record_account_deletion?.p_apple_revoked, 'false:read_failed');
    assertEquals(t.fetched, []);
    assertEquals(t.steps.filter((s) => s !== 'admin:record_account_deletion').slice(-3), LEGACY_TAIL);
  }
});

Deno.test('record_account_deletion eșuat → doar logat, ștergerea continuă', async () => {
  const t = await setup({ appleToken: 'apple-refresh', recordError: 'fk' });
  const res = await makeDeleteAccountHandler(t.d)(post());
  assertEquals(res.status, 200);
  assertEquals(t.steps.filter((s) => s !== 'admin:record_account_deletion').slice(-3), LEGACY_TAIL);
});
