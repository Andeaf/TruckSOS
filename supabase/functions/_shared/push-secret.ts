// 4 nov 2026 — faza 3, decizia lui David (3 nov): `x-push-secret` e SINGURA poartă a Edge Functions
// `push-dispatch` / `push-receipts` (verify_jwt = false în config.toml). Cron-ul (app.kick_push_*) trimite
// header-ul cu secretul din Vault (`push_kick_secret`); EF-ul îl compară cu secretul lui din env
// (`PUSH_KICK_SECRET`, pus cu `supabase secrets set`).
//
// Comparația e în timp constant: SHA-256 pe ambele valori (lungimi egale, deci nici lungimea
// secretului nu se scurge prin timp) + `timingSafeEqual` din @std/crypto. Secretul configurat trebuie
// să aibă cel puțin 32 de octeți; altfel poarta rămâne închisă (fail closed), ca un secret slab sau
// lipsă să nu poată deschide worker-ul.
import { timingSafeEqual } from 'jsr:@std/crypto@^1/timing-safe-equal';

/** Lungimea minimă (în octeți UTF-8) a secretului configurat în EF. */
export const PUSH_SECRET_MIN_BYTES = 32;

async function sha256(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * `true` doar când header-ul primit e exact secretul configurat. `false` pentru header lipsă/gol,
 * secret neconfigurat sau prea scurt (< 32 octeți), sau valori diferite. Nu aruncă niciodată.
 */
export async function checkPushSecret(header: string | null | undefined, secret: string | undefined): Promise<boolean> {
  if (!secret || new TextEncoder().encode(secret).byteLength < PUSH_SECRET_MIN_BYTES) return false;
  if (!header) return false;
  const [a, b] = await Promise.all([sha256(header), sha256(secret)]);
  return timingSafeEqual(a, b);
}

/** Header-ul cerut de EF-urile de push (minuscule: `Headers` normalizează oricum). */
export const PUSH_SECRET_HEADER = 'x-push-secret';
