// 9 nov 2026 — teste pentru `client_secret`-ul Apple (fără rețea; cheia e generată în test).
// Rulare: deno test supabase/functions/_shared

import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert';
import {
  APPLE_CLIENT_SECRET_MAX_TTL,
  appleConfigFromEnv,
  base64UrlDecode,
  base64UrlEncode,
  makeAppleClientSecret,
  pemToPkcs8Der,
} from './apple-client-secret.ts';

/** O pereche ECDSA P-256 nouă; cheia privată exportată ca PEM PKCS#8 cu linii de 64 (ca fișierul .p8). */
async function testAppleKey(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  const lines = b64.match(/.{1,64}/g) ?? [];
  const pem = `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: pair.publicKey };
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
}

Deno.test('client_secret: header, payload și semnătura ES256 verificabilă cu cheia publică', async () => {
  const { pem, publicKey } = await testAppleKey();
  const jwt = await makeAppleClientSecret({
    privateKeyPem: pem,
    teamId: 'TEAM123456',
    keyId: 'KEY1234567',
    clientId: 'com.andeaf.trucksos',
    nowSeconds: 1_800_000_000,
  });
  const parts = jwt.split('.');
  assertEquals(parts.length, 3);
  assert(!jwt.includes('='), 'base64url fără padding');
  assertEquals(decodePart(parts[0]), { alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
  assertEquals(decodePart(parts[1]), {
    iss: 'TEAM123456',
    iat: 1_800_000_000,
    exp: 1_800_000_300,
    aud: 'https://appleid.apple.com',
    sub: 'com.andeaf.trucksos',
  });
  const sig = base64UrlDecode(parts[2]);
  assertEquals(sig.length, 64, 'semnătura brută r||s');
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    sig,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  assert(ok);
});

Deno.test('client_secret: PEM pe o singură linie cu „\\n” literal (cum vine din secrets set) e acceptat', async () => {
  const { pem, publicKey } = await testAppleKey();
  const flat = pem.trim().replace(/\n/g, '\\n');
  assert(!flat.includes('\n'));
  const jwt = await makeAppleClientSecret({
    privateKeyPem: `"${flat}"`,
    teamId: 'T',
    keyId: 'K',
    clientId: 'C',
    nowSeconds: 1000,
    ttlSeconds: 60,
  });
  const [h, p, s] = jwt.split('.');
  assertEquals(decodePart(p).exp, 1060);
  assert(
    await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, base64UrlDecode(s), new TextEncoder().encode(`${h}.${p}`)),
  );
});

Deno.test('client_secret: TTL peste 6 luni sau ≤ 0 → aruncă (Apple l-ar refuza)', async () => {
  const { pem } = await testAppleKey();
  const base = { privateKeyPem: pem, teamId: 'T', keyId: 'K', clientId: 'C', nowSeconds: 1000 };
  await assertRejects(() => makeAppleClientSecret({ ...base, ttlSeconds: APPLE_CLIENT_SECRET_MAX_TTL + 1 }));
  await assertRejects(() => makeAppleClientSecret({ ...base, ttlSeconds: 0 }));
  const max = await makeAppleClientSecret({ ...base, ttlSeconds: APPLE_CLIENT_SECRET_MAX_TTL });
  assertEquals(decodePart(max.split('.')[1]).exp, 1000 + APPLE_CLIENT_SECRET_MAX_TTL);
});

Deno.test('client_secret: cheie ilizibilă sau SEC1 → aruncă (fără să includă cheia în mesaj)', async () => {
  const base = { teamId: 'T', keyId: 'K', clientId: 'C', nowSeconds: 1000 };
  await assertRejects(() => makeAppleClientSecret({ ...base, privateKeyPem: 'nu-e-o-cheie!!' }), Error, 'apple_key_unreadable');
  assertThrows(() => pemToPkcs8Der('-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----'), Error, 'apple_key_not_pkcs8');
  // base64 valid, dar nu e PKCS#8 → importKey aruncă.
  await assertRejects(() =>
    makeAppleClientSecret({ ...base, privateKeyPem: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' })
  );
});

Deno.test('base64url: dus-întors pe toate lungimile mod 3', () => {
  for (const n of [0, 1, 2, 3, 31, 32, 33]) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 97 + 251) & 0xff);
    const enc = base64UrlEncode(bytes);
    assert(!/[+/=]/.test(enc));
    assertEquals(base64UrlDecode(enc), bytes);
  }
});

Deno.test('appleConfigFromEnv: oricare din cele 4 lipsă sau gol → null', () => {
  const full: Record<string, string> = {
    APPLE_TEAM_ID: 'T',
    APPLE_KEY_ID: 'K',
    APPLE_PRIVATE_KEY: 'PEM',
    APPLE_CLIENT_ID: 'C',
  };
  assertEquals(appleConfigFromEnv((n) => full[n]), { teamId: 'T', keyId: 'K', privateKeyPem: 'PEM', clientId: 'C' });
  for (const k of Object.keys(full)) {
    assertEquals(appleConfigFromEnv((n) => (n === k ? undefined : full[n])), null);
    assertEquals(appleConfigFromEnv((n) => (n === k ? '  ' : full[n])), null);
  }
});
