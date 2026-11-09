// 9 nov 2026 — faza 6.1: `client_secret` pentru endpoint-urile Sign in with Apple (`/auth/token`, `/auth/revoke`).
// Apple cere un JWT ES256 semnat cu cheia .p8 („Sign in with Apple” din Apple Developer → Keys):
//   header  { alg: 'ES256', kid: <Key ID>, typ: 'JWT' }
//   payload { iss: <Team ID>, iat, exp (≤ 6 luni după iat), aud: 'https://appleid.apple.com', sub: <client id> }
// Semnătura vine din WebCrypto (ECDSA P-256 / SHA-256), care întoarce deja forma brută r||s (64 de octeți)
// cerută de JWS — nu e nevoie de conversie din DER.
//
// Folosit de `apple-link` (schimbul codului pe refresh token) și `delete-account` (revocarea la ștergere).
// Niciun secret nu se loghează aici; erorile (cheie ilizibilă) urcă la apelant, care loghează doar codul erorii.

/** Plafonul Apple pentru `exp - iat`: 6 luni (15 777 000 s). Peste el Apple refuză tokenul. */
export const APPLE_CLIENT_SECRET_MAX_TTL = 15_777_000;
export const APPLE_AUDIENCE = 'https://appleid.apple.com';
export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

export interface AppleClientSecretInput {
  /** Cheia .p8 (PKCS#8 PEM). Poate veni cu `\n` literal în loc de newline (cum o pune `secrets set`). */
  privateKeyPem: string;
  teamId: string;
  keyId: string;
  /** Bundle id-ul (tokenul nativ iOS) sau Services ID-ul (web). */
  clientId: string;
  nowSeconds: number;
  ttlSeconds?: number;
}

export interface AppleConfig {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  clientId: string;
}

/** Cele 4 env-uri Apple; `null` dacă lipsește (sau e gol) oricare — apelantul tratează ca „neconfigurat”. */
export function appleConfigFromEnv(env: (name: string) => string | undefined): AppleConfig | null {
  const teamId = env('APPLE_TEAM_ID')?.trim();
  const keyId = env('APPLE_KEY_ID')?.trim();
  const privateKeyPem = env('APPLE_PRIVATE_KEY');
  const clientId = env('APPLE_CLIENT_ID')?.trim();
  if (!teamId || !keyId || !privateKeyPem || !privateKeyPem.trim() || !clientId) return null;
  return { teamId, keyId, privateKeyPem, clientId };
}

/** base64url fără padding (RFC 7515). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Inversul lui `base64UrlEncode` (acceptă și padding). */
export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * PEM PKCS#8 → DER. Normalizează: `\n` / `\r\n` literale (secret pus pe o singură linie), ghilimele de capăt,
 * liniile `-----BEGIN/END PRIVATE KEY-----`, orice spațiu. O cheie SEC1 („BEGIN EC PRIVATE KEY”) nu e acceptată:
 * fișierul .p8 de la Apple e PKCS#8, iar `importKey('pkcs8')` ar pica oricum.
 */
export function pemToPkcs8Der(pem: string): Uint8Array<ArrayBuffer> {
  let text = pem.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  text = text.replace(/\\r/g, '').replace(/\\n/g, '\n');
  if (/BEGIN EC PRIVATE KEY/.test(text)) throw new Error('apple_key_not_pkcs8');
  const body = text
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new Error('apple_key_unreadable');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const encoder = new TextEncoder();

function encodeJsonPart(value: unknown): string {
  return base64UrlEncode(encoder.encode(JSON.stringify(value)));
}

/** JWT-ul `client_secret` (ES256). Aruncă dacă TTL-ul e în afara (0, 6 luni] sau cheia nu se poate importa. */
export async function makeAppleClientSecret(input: AppleClientSecretInput): Promise<string> {
  const ttl = input.ttlSeconds ?? 300;
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > APPLE_CLIENT_SECRET_MAX_TTL) {
    throw new Error('apple_client_secret_ttl_out_of_range');
  }
  const iat = Math.floor(input.nowSeconds);
  const header = { alg: 'ES256', kid: input.keyId, typ: 'JWT' };
  const payload = { iss: input.teamId, iat, exp: iat + Math.floor(ttl), aud: APPLE_AUDIENCE, sub: input.clientId };
  const signingInput = `${encodeJsonPart(header)}.${encodeJsonPart(payload)}`;

  const der = pemToPkcs8Der(input.privateKeyPem);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(signingInput)),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * POST form-urlencoded la Apple, cu timeout (AbortController; timer-ul se curăță mereu).
 * Întoarce statusul și corpul JSON (sau `null` dacă nu e JSON). Excepțiile de rețea/timeout urcă.
 */
export async function postAppleForm(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  url: string,
  form: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(text);
      body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}
