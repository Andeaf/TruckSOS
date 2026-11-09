// 9 nov 2026 — teste pentru fluxul cererii din handler.ts (dependențe injectate; fără rețea, cheie generată în test).
// Rulare: deno test supabase/functions/apple-link

import { assert, assertEquals } from 'jsr:@std/assert';
import { type AdminLike, type AppleLinkDeps, makeAppleLinkHandler, type UserLike } from './handler.ts';

const UID = '11111111-2222-3333-4444-555555555555';
const APPLE_USER: UserLike = { id: UID, identities: [{ provider: 'email' }, { provider: 'apple' }] };

async function testPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  // Pe o singură linie, cu `\n` literal: forma în care ajunge de obicei prin `secrets set`.
  return `-----BEGIN PRIVATE KEY-----\\n${btoa(bin)}\\n-----END PRIVATE KEY-----`;
}

interface Fetched {
  url: string;
  form: URLSearchParams;
}

async function setup(
  over: {
    user?: UserLike | null;
    getUserThrows?: boolean;
    apple?: { status: number; body: unknown };
    fetchThrows?: boolean;
    storeError?: string | null;
    env?: Record<string, string | undefined>;
  } = {},
) {
  const env: Record<string, string | undefined> = {
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_KEY_ID: 'KEY1234567',
    APPLE_PRIVATE_KEY: await testPem(),
    APPLE_CLIENT_ID: 'com.andeaf.trucksos',
    ...(over.env ?? {}),
  };
  const envRead: string[] = [];
  const rpcCalls: { fn: string; args?: Record<string, unknown> }[] = [];
  const fetched: Fetched[] = [];
  const authHeaders: string[] = [];
  const admin: AdminLike = {
    rpc(fn, args) {
      rpcCalls.push({ fn, args });
      const err = over.storeError ?? null;
      return Promise.resolve({ data: null, error: err === null ? null : { message: err } });
    },
  };
  const d: AppleLinkDeps = {
    env: (name) => {
      envRead.push(name);
      return env[name];
    },
    createUserClient: (authHeader) => {
      authHeaders.push(authHeader);
      return {
        auth: {
          getUser: () => {
            if (over.getUserThrows) return Promise.reject(new Error('net'));
            const user = over.user === undefined ? APPLE_USER : over.user;
            return Promise.resolve(
              user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } },
            );
          },
        },
      };
    },
    createAdmin: () => admin,
    fetch: (url, init) => {
      fetched.push({ url, form: new URLSearchParams(String(init.body)) });
      if (over.fetchThrows) return Promise.reject(new TypeError('network'));
      const reply = over.apple ?? { status: 200, body: { access_token: 'a', refresh_token: 'r-token', id_token: 'i' } };
      return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
    },
    now: () => 1_800_000_000_000,
  };
  return { d, envRead, rpcCalls, fetched, authHeaders };
}

function post(body: unknown, headers: Record<string, string> = { Authorization: 'Bearer user-jwt' }): Request {
  return new Request('https://edge/apple-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const appleEnvNames = (read: string[]) => read.filter((n) => n.startsWith('APPLE_'));

Deno.test('OPTIONS → CORS; GET → 405', async () => {
  const t = await setup();
  const h = makeAppleLinkHandler(t.d);
  const opt = await h(new Request('https://edge/apple-link', { method: 'OPTIONS' }));
  assertEquals(opt.status, 200);
  assertEquals(opt.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  const get = await h(new Request('https://edge/apple-link', { method: 'GET' }));
  assertEquals(get.status, 405);
  assertEquals(t.envRead, []);
});

Deno.test('fără Authorization → 401 missing_authorization, fără getUser, fără env Apple', async () => {
  const t = await setup();
  const res = await makeAppleLinkHandler(t.d)(post({ authorization_code: 'c' }, {}));
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: 'missing_authorization' });
  assertEquals(t.authHeaders, []);
  assertEquals(t.envRead, []);
});

Deno.test('JWT invalid (getUser eșuat sau aruncă) → 401 invalid_token, fără env Apple, fără fetch', async () => {
  for (const over of [{ user: null }, { getUserThrows: true }]) {
    const t = await setup(over);
    const res = await makeAppleLinkHandler(t.d)(post({ authorization_code: 'c' }));
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: 'invalid_token' });
    assertEquals(t.authHeaders, ['Bearer user-jwt']);
    assertEquals(appleEnvNames(t.envRead), []);
    assertEquals(t.fetched.length, 0);
    assertEquals(t.rpcCalls.length, 0);
  }
});

Deno.test('cont fără identitate apple → 400 not_apple_account, fără env Apple', async () => {
  for (const user of [{ id: UID, identities: [{ provider: 'google' }] }, { id: UID }, { id: UID, identities: null }]) {
    const t = await setup({ user });
    const res = await makeAppleLinkHandler(t.d)(post({ authorization_code: 'c' }));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: 'not_apple_account' });
    assertEquals(appleEnvNames(t.envRead), []);
    assertEquals(t.fetched.length, 0);
  }
});

Deno.test('fără cod (corp lipsă, ne-JSON, câmp gol sau ne-string) → 400 missing_authorization_code', async () => {
  for (const body of [undefined, 'nu-e-json', {}, { authorization_code: '' }, { authorization_code: 42 }, []]) {
    const t = await setup();
    const res = await makeAppleLinkHandler(t.d)(post(body));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: 'missing_authorization_code' });
    assertEquals(appleEnvNames(t.envRead), []);
    assertEquals(t.fetched.length, 0);
  }
});

Deno.test('oricare env Apple lipsă → 500 apple_not_configured, fără fetch, fără store', async () => {
  for (const name of ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_CLIENT_ID']) {
    const t = await setup({ env: { [name]: undefined } });
    const res = await makeAppleLinkHandler(t.d)(post({ authorization_code: 'c' }));
    assertEquals(res.status, 500);
    assertEquals(await res.json(), { error: 'apple_not_configured' });
    assertEquals(t.fetched.length, 0);
    assertEquals(t.rpcCalls.length, 0);
  }
});

Deno.test('cheie Apple ilizibilă → 500 apple_not_configured, fără fetch, fără store', async () => {
  const t = await setup({ env: { APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----' } });
  const res = await makeAppleLinkHandler(t.d)(post({ authorization_code: 'c' }));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'apple_not_configured' });
  assertEquals(t.fetched.length, 0);
  assertEquals(t.rpcCalls.length, 0);
});

Deno.test('schimb reușit → form corect la /auth/token, store cu uid-ul din JWT (nu din body), 200', async () => {
  const t = await setup();
  const res = await makeAppleLinkHandler(t.d)(
    post({ authorization_code: 'the-code', user_id: '99999999-9999-9999-9999-999999999999' }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(t.fetched.length, 1);
  const { url, form } = t.fetched[0];
  assertEquals(url, 'https://appleid.apple.com/auth/token');
  assertEquals(form.get('grant_type'), 'authorization_code');
  assertEquals(form.get('code'), 'the-code');
  assertEquals(form.get('client_id'), 'com.andeaf.trucksos');
  const secret = form.get('client_secret') ?? '';
  assertEquals(secret.split('.').length, 3);
  const payload = JSON.parse(atob(secret.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  assertEquals(payload.iss, 'TEAM123456');
  assertEquals(payload.sub, 'com.andeaf.trucksos');
  assertEquals(payload.iat, 1_800_000_000);
  assert(payload.exp > payload.iat && payload.exp - payload.iat <= 15_777_000);
  assertEquals(t.rpcCalls, [{ fn: 'store_apple_token', args: { p_user_id: UID, p_refresh_token: 'r-token' } }]);
});

Deno.test('Apple 400 invalid_grant → 502 cu apple_error, fără store', async () => {
  const t = await setup({ apple: { status: 400, body: { error: 'invalid_grant', error_description: 'x' } } });
  const res = await makeAppleLinkHandler(t.d)(post({ authorization_code: 'old-code' }));
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: 'apple_token_exchange_failed', apple_error: 'invalid_grant' });
  assertEquals(t.rpcCalls.length, 0);
});

Deno.test('Apple 200 fără refresh_token / corp ne-JSON / rețea picată → 502, fără store', async () => {
  const cases: [Parameters<typeof setup>[0], string][] = [
    [{ apple: { status: 200, body: { access_token: 'a' } } }, 'no_refresh_token'],
    [{ apple: { status: 503, body: 'down' } }, 'unknown'],
    [{ fetchThrows: true }, 'network'],
  ];
  for (const [over, appleError] of cases) {
    const t = await setup(over);
    const res = await makeAppleLinkHandler(t.d)(post({ authorization_code: 'c' }));
    assertEquals(res.status, 502);
    assertEquals(await res.json(), { error: 'apple_token_exchange_failed', apple_error: appleError });
    assertEquals(t.rpcCalls.length, 0);
  }
});

Deno.test('store_apple_token eșuat → 500 store_failed FĂRĂ detaliu către client (mesajul doar în log)', async () => {
  const t = await setup({ storeError: 'apple_token_key_missing' });
  const res = await makeAppleLinkHandler(t.d)(post({ authorization_code: 'c' }));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'store_failed' });
  assertEquals(t.rpcCalls.length, 1);
});
