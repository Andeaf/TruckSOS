// 9 nov 2026 — teste pentru fluxul cererii din handler.ts (dependențe injectate; fără rețea).
// Rulare: deno test supabase/functions/report-public

import { assertEquals, assertMatch } from 'jsr:@std/assert';
import { type AdminLike, BODY_MAX_BYTES, clientIpInfo, hashIp, makeReportPublicHandler, parseBody, type ReportPublicDeps } from './handler.ts';

const ID = '81111111-0000-4000-8000-000000000001';
const SALT = 'S'.repeat(32);

function goodBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    token: 'tok',
    type: 'announcement',
    id: ID,
    reason: 'illegal',
    details: '  ceva  ',
    email: 'Reporter@Example.com',
    declaration: true,
    lang: 'de',
    ...over,
  };
}

function setup(opts: {
  env?: Record<string, string | undefined>;
  siteverify?: { ok: boolean; success: boolean } | 'throw';
  rpc?: { data: unknown; error: { message: string } | null };
} = {}) {
  const env: Record<string, string | undefined> = {
    TURNSTILE_SECRET: 'ts-secret',
    REPORT_IP_SALT: SALT,
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    ...opts.env,
  };
  const fetchCalls: { url: string; body: string }[] = [];
  const rpcCalls: { fn: string; args?: Record<string, unknown> }[] = [];
  let created = 0;
  const admin: AdminLike = {
    rpc(fn, args) {
      rpcCalls.push({ fn, args });
      return Promise.resolve(opts.rpc ?? { data: { id: 'new-report-id' }, error: null });
    },
  };
  const deps: ReportPublicDeps = {
    env: (n) => env[n],
    fetch: (url, init) => {
      fetchCalls.push({ url, body: String(init.body) });
      if (opts.siteverify === 'throw') return Promise.reject(new Error('net'));
      const sv = opts.siteverify ?? { ok: true, success: true };
      return Promise.resolve(new Response(JSON.stringify({ success: sv.success }), { status: sv.ok ? 200 : 500 }));
    },
    createAdmin: () => {
      created += 1;
      return admin;
    },
  };
  return { handler: makeReportPublicHandler(deps), fetchCalls, rpcCalls, created: () => created };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://x.supabase.co/functions/v1/report-public', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://trucksos.net', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

Deno.test('OPTIONS: 204 cu CORS doar pentru trucksos.net', async () => {
  const { handler } = setup();
  const ok = await handler(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://trucksos.net' } }));
  assertEquals(ok.status, 204);
  assertEquals(ok.headers.get('access-control-allow-origin'), 'https://trucksos.net');
  const other = await handler(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  assertEquals(other.status, 204);
  assertEquals(other.headers.get('access-control-allow-origin'), null);
});

Deno.test('GET → 405', async () => {
  const { handler } = setup();
  const res = await handler(new Request('https://x/', { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('body invalid → 400 cu câmpul; nimic nu pleacă spre Turnstile sau RPC', async () => {
  const { handler, fetchCalls, rpcCalls } = setup();
  for (const [over, field] of [
    [{ token: '' }, 'token'],
    [{ type: 'rating' }, 'type'],
    [{ type: 'message' }, 'type'],
    [{ id: 'nu-e-uuid' }, 'id'],
    [{ reason: 'altceva' }, 'reason'],
    [{ email: 'fara-arond' }, 'email'],
    [{ declaration: false }, 'declaration'],
  ] as const) {
    const res = await handler(post(goodBody(over)));
    assertEquals(res.status, 400, field);
    assertEquals((await res.json()).field, field);
  }
  const notJson = await handler(post('{nu e json'));
  assertEquals(notJson.status, 400);
  assertEquals(fetchCalls.length, 0);
  assertEquals(rpcCalls.length, 0);
});

Deno.test('parseBody normalizează: e-mail mic, detalii trunchiate la 2000, limbă necunoscută → ro', () => {
  const r = parseBody(goodBody({ details: 'x'.repeat(2500), lang: 'fr' }));
  if ('error' in r) throw new Error(r.error);
  assertEquals(r.body.email, 'reporter@example.com');
  assertEquals(r.body.details?.length, 2000);
  assertEquals(r.body.lang, 'ro');
  const empty = parseBody(goodBody({ details: '   ' }));
  if ('error' in empty) throw new Error(empty.error);
  assertEquals(empty.body.details, null);
});

Deno.test('fără secrete → 500 not_configured (înainte de Turnstile)', async () => {
  for (const env of [{ TURNSTILE_SECRET: undefined }, { REPORT_IP_SALT: undefined }, { REPORT_IP_SALT: 'scurt' }]) {
    const { handler, fetchCalls } = setup({ env });
    const res = await handler(post(goodBody()));
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, 'not_configured');
    assertEquals(fetchCalls.length, 0);
  }
});

Deno.test('Turnstile eșuat sau indisponibil → 403, fără client admin', async () => {
  for (const siteverify of [{ ok: true, success: false }, { ok: false, success: true }, 'throw'] as const) {
    const { handler, rpcCalls, created } = setup({ siteverify });
    const res = await handler(post(goodBody()));
    assertEquals(res.status, 403);
    assertEquals((await res.json()).error, 'captcha_failed');
    assertEquals(rpcCalls.length, 0);
    assertEquals(created(), 0);
  }
});

Deno.test('fluxul nominal: siteverify cu remoteip, RPC cu hash-ul IP-ului (nu IP-ul), 200 cu id', async () => {
  const { handler, fetchCalls, rpcCalls } = setup();
  const res = await handler(post(goodBody(), { 'cf-connecting-ip': '203.0.113.9' }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, id: 'new-report-id' });
  assertEquals(res.headers.get('access-control-allow-origin'), 'https://trucksos.net');
  assertEquals(fetchCalls.length, 1);
  assertMatch(fetchCalls[0].body, /remoteip=203\.0\.113\.9/);
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].fn, 'insert_public_report');
  const args = rpcCalls[0].args!;
  assertEquals(args.p_ip_hash, await hashIp(SALT, '203.0.113.9'));
  assertMatch(String(args.p_ip_hash), /^[0-9a-f]{64}$/);
  assertEquals(args.p_target_type, 'announcement');
  assertEquals(args.p_target_id, ID);
  assertEquals(args.p_reason, 'illegal');
  assertEquals(args.p_details, 'ceva');
  assertEquals(args.p_email, 'reporter@example.com');
  assertEquals(args.p_lang, 'de');
  assertEquals(JSON.stringify(args).includes('203.0.113.9'), false);
});

Deno.test('fără header de IP → hash-ul lui „unknown”; x-forwarded-for ia ULTIMUL IP (primele le poate scrie clientul)', async () => {
  const { handler, rpcCalls } = setup();
  await handler(post(goodBody()));
  assertEquals(rpcCalls[0].args!.p_ip_hash, await hashIp(SALT, 'unknown'));
  // primul element e inventat de client; ultimul e cel adăugat de proxy
  await handler(post(goodBody(), { 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }));
  assertEquals(rpcCalls[1].args!.p_ip_hash, await hashIp(SALT, '198.51.100.7'));
  await handler(post(goodBody(), { 'x-forwarded-for': '9.9.9.9, 198.51.100.7' }));
  assertEquals(rpcCalls[2].args!.p_ip_hash, rpcCalls[1].args!.p_ip_hash, 'un prim element diferit nu schimbă hash-ul');
  // cf-connecting-ip are prioritate față de x-forwarded-for
  await handler(post(goodBody(), { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }));
  assertEquals(rpcCalls[3].args!.p_ip_hash, await hashIp(SALT, '203.0.113.9'));
});

Deno.test('clientIpInfo: sursa IP-ului (cf / xff / none), pentru log', () => {
  assertEquals(clientIpInfo(new Headers({ 'cf-connecting-ip': ' 203.0.113.9 ' })), { ip: '203.0.113.9', source: 'cf' });
  assertEquals(clientIpInfo(new Headers({ 'x-forwarded-for': '1.2.3.4 , 198.51.100.7 ,' })), { ip: '198.51.100.7', source: 'xff' });
  assertEquals(clientIpInfo(new Headers({ 'x-forwarded-for': ' , ' })), { ip: 'unknown', source: 'none' });
  assertEquals(clientIpInfo(new Headers()), { ip: 'unknown', source: 'none' });
});

Deno.test('body peste 16 KB → 413, fără Turnstile și fără RPC', async () => {
  const { handler, fetchCalls, rpcCalls } = setup();
  const big = await handler(post(goodBody({ details: 'x'.repeat(BODY_MAX_BYTES) })));
  assertEquals(big.status, 413);
  assertEquals((await big.json()).error, 'too_large');
  const declared = await handler(post(goodBody(), { 'content-length': String(BODY_MAX_BYTES + 1) }));
  assertEquals(declared.status, 413);
  assertEquals(fetchCalls.length, 0);
  assertEquals(rpcCalls.length, 0);
});

Deno.test('erorile RPC-ului (excepții) → 400 / 500', async () => {
  for (const [message, status, error] of [
    ['bad_input', 400, 'bad_input'],
    ['connection reset', 500, 'insert_failed'],
  ] as const) {
    const { handler } = setup({ rpc: { data: null, error: { message } } });
    const res = await handler(post(goodBody()));
    assertEquals(res.status, status, message);
    assertEquals((await res.json()).error, error);
  }
});

Deno.test('răspunsul RPC-ului cu {error} → 429 / 404; fără id și fără error → 500', async () => {
  for (const [data, status, error] of [
    [{ error: 'rate_limited' }, 429, 'rate_limited'],
    [{ error: 'target_not_found' }, 404, 'target_not_found'],
    [null, 500, 'insert_failed'],
    ['text', 500, 'insert_failed'],
  ] as const) {
    const { handler } = setup({ rpc: { data, error: null } });
    const res = await handler(post(goodBody()));
    assertEquals(res.status, status, String(error));
    assertEquals((await res.json()).error, error);
  }
});
