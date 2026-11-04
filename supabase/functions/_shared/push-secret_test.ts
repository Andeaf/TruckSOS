// 4 nov 2026 — teste pentru poarta `x-push-secret` (fără rețea).
// Rulare: deno test supabase/functions/_shared

import { assertEquals } from 'jsr:@std/assert';
import { checkPushSecret, PUSH_SECRET_MIN_BYTES } from './push-secret.ts';

const SECRET = 'a'.repeat(PUSH_SECRET_MIN_BYTES) + 'secret-de-test-0123456789';

Deno.test('(1) header egal cu secretul → true', async () => {
  assertEquals(await checkPushSecret(SECRET, SECRET), true);
});

Deno.test('(2) header diferit (același prefix, ultimul caracter schimbat) → false', async () => {
  assertEquals(await checkPushSecret(SECRET.slice(0, -1) + 'X', SECRET), false);
});

Deno.test('(3) header lipsă / gol → false', async () => {
  assertEquals(await checkPushSecret(null, SECRET), false);
  assertEquals(await checkPushSecret(undefined, SECRET), false);
  assertEquals(await checkPushSecret('', SECRET), false);
});

Deno.test('(4) secret neconfigurat sau gol → false chiar cu header identic (fail closed)', async () => {
  assertEquals(await checkPushSecret('', undefined), false);
  assertEquals(await checkPushSecret('', ''), false);
});

Deno.test('(5) secret configurat sub 32 de octeți → false chiar când header-ul e identic', async () => {
  const short = 's'.repeat(PUSH_SECRET_MIN_BYTES - 1);
  assertEquals(await checkPushSecret(short, short), false);
  const exact = 's'.repeat(PUSH_SECRET_MIN_BYTES);
  assertEquals(await checkPushSecret(exact, exact), true);
});

Deno.test('(6) lungimi diferite → false (nu aruncă)', async () => {
  assertEquals(await checkPushSecret(SECRET + 'x', SECRET), false);
  assertEquals(await checkPushSecret(SECRET.slice(1), SECRET), false);
});
