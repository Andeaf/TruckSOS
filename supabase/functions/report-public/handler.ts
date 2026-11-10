// 9 nov 2026 — faza 8.3 (DSA art. 16): handler-ul Edge Function `report-public`, cu dependențele injectate (env, fetch-ul către
// Turnstile, clientul admin), testat în handler_test.ts. index.ts doar îl leagă la Deno.serve.
//
// Primește sesizările trimise FĂRĂ cont de pe trucksos.net/report (și din aplicație, de la oaspeți) și le scrie în `public.reports`
// prin RPC-ul `insert_public_report` (service_role; reporter_id NULL, source 'public'). Ordinea cererii:
//   OPTIONS (CORS) → 405 fără POST → 413 body peste 16 KB → 400 body invalid (tip, id uuid, motiv, e-mail, declarația de
//   bună-credință obligatorie) →
//   500 `not_configured` fără TURNSTILE_SECRET / REPORT_IP_SALT → 403 `captcha_failed` (siteverify Cloudflare) →
//   RPC: `rate_limited` → 429, `target_not_found` → 404, `bad_input` → 400, altceva → 500 → 200 `{ ok, id }`.
// IP-ul nu ajunge în bază: trimitem SHA-256(sare + '|' + ip) (hex), iar RPC-ul ține limita 10/oră/hash cu retenție 24 h.
// În log: niciun e-mail, niciun IP, niciun text al sesizării — doar codul răspunsului și motivul tehnic.

/** Fără mesajele PRIVATE: un ne-participant n-are cum să le știe id-ul, iar snapshot-ul ar copia conținut privat (review 9 nov). */
export const TARGET_TYPES = ['announcement', 'listing', 'channel_message', 'user'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];
export const REASONS = ['spam', 'harassment', 'inappropriate', 'scam', 'other', 'illegal', 'rights', 'personal_data', 'sexual_violent'] as const;
export const DETAILS_MAX = 2000;
export const EMAIL_MAX = 254;
export const SALT_MIN_BYTES = 16;
/** Originea paginii publice; alte origini primesc răspunsul fără header-ele CORS (browserul îl blochează). */
export const ALLOWED_ORIGIN = 'https://trucksos.net';
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

type RpcResult = PromiseLike<{ data: unknown; error: { message: string; details?: string | null } | null }>;

export interface AdminLike {
  rpc(fn: string, args?: Record<string, unknown>): RpcResult;
}

export interface ReportPublicDeps {
  env: (name: string) => string | undefined;
  /** `fetch` în producție; în teste un fals care răspunde la siteverify. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Clientul service_role; se creează DOAR după ce body-ul și captcha au trecut. */
  createAdmin: (url: string, serviceKey: string) => AdminLike;
}

export interface ReportBody {
  token: string;
  type: TargetType;
  id: string;
  reason: (typeof REASONS)[number];
  details: string | null;
  email: string;
  lang: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin === ALLOWED_ORIGIN) {
    h['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'content-type';
    h['Vary'] = 'Origin';
  }
  return h;
}

export function json(status: number, body: unknown, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

/** Body-ul validat sau `null` (cu motivul) — fără să arunce. */
export function parseBody(raw: unknown): { body: ReportBody } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'body' };
  const o = raw as Record<string, unknown>;
  const token = typeof o.token === 'string' ? o.token.trim() : '';
  if (!token || token.length > 4096) return { error: 'token' };
  const type = typeof o.type === 'string' ? o.type : '';
  if (!(TARGET_TYPES as readonly string[]).includes(type)) return { error: 'type' };
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  if (!UUID_RE.test(id)) return { error: 'id' };
  const reason = typeof o.reason === 'string' ? o.reason : '';
  if (!(REASONS as readonly string[]).includes(reason)) return { error: 'reason' };
  const email = typeof o.email === 'string' ? o.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > EMAIL_MAX) return { error: 'email' };
  if (o.declaration !== true) return { error: 'declaration' }; // DSA art. 16(2)(d): declarația de bună-credință e obligatorie
  let details: string | null = null;
  if (typeof o.details === 'string') {
    const d = o.details.trim();
    details = d ? d.slice(0, DETAILS_MAX) : null;
  }
  const lang = typeof o.lang === 'string' && ['ro', 'en', 'de'].includes(o.lang) ? o.lang : 'ro';
  return { body: { token, type: type as TargetType, id: id.toLowerCase(), reason: reason as ReportBody['reason'], details, email, lang } };
}

/** Dimensiunea maximă a body-ului (explicația are cel mult 2 000 de caractere; restul câmpurilor sunt scurte). */
export const BODY_MAX_BYTES = 16 * 1024;

/**
 * IP-ul clientului și sursa lui (sursa apare în log, IP-ul nu). `cf-connecting-ip` e pus de Cloudflare și nu poate fi
 * trimis de client (Cloudflare îl suprascrie). Din `x-forwarded-for` luăm ULTIMUL element: primele le poate scrie chiar
 * clientul (proxy-urile doar adaugă la coadă), deci primul element ar fi lăsat limita pe IP să fie ocolită cu un header
 * inventat (review 10 nov). Dacă ultimul element e un proxy intern, toți împart o limită — strict, dar neocolibil.
 * `unknown` dacă nu există niciun header (toți cei fără IP împart o singură limită).
 */
export function clientIpInfo(headers: Headers): { ip: string; source: 'cf' | 'xff' | 'none' } {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return { ip: cf, source: 'cf' };
  const parts = (headers.get('x-forwarded-for') ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 0) return { ip: parts[parts.length - 1], source: 'xff' };
  return { ip: 'unknown', source: 'none' };
}

export function clientIp(headers: Headers): string {
  return clientIpInfo(headers).ip;
}

export async function hashIp(salt: string, ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}|${ip}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Codul HTTP pentru eroarea RPC-ului: `rate_limited` / `target_not_found` vin în răspuns (`{error}`), `bad_input` ca excepție. */
export function statusForRpcError(message: string): { status: number; error: string } {
  if (message.includes('rate_limited')) return { status: 429, error: 'rate_limited' };
  if (message.includes('target_not_found')) return { status: 404, error: 'target_not_found' };
  if (message.includes('bad_input')) return { status: 400, error: 'bad_input' };
  return { status: 500, error: 'insert_failed' };
}

/** Răspunsul RPC-ului: `{ id }` la succes, `{ error }` altfel (eroarea de țintă nu e excepție, ca evidența pe IP să rămână). */
function rpcOutcome(data: unknown): { id: string } | { error: string } {
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (typeof o.id === 'string') return { id: o.id };
    if (typeof o.error === 'string') return { error: o.error };
  }
  return { error: 'insert_failed' };
}

export function makeReportPublicHandler(deps: ReportPublicDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, origin);

    // Body mic, cu limită: întâi după content-length (fără să citim nimic), apoi după ce am citit efectiv.
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) return json(413, { error: 'too_large' }, origin);
    let raw: unknown;
    try {
      const text = await req.text();
      if (new TextEncoder().encode(text).byteLength > BODY_MAX_BYTES) return json(413, { error: 'too_large' }, origin);
      raw = JSON.parse(text);
    } catch {
      return json(400, { error: 'bad_request', field: 'body' }, origin);
    }
    const parsed = parseBody(raw);
    if ('error' in parsed) return json(400, { error: 'bad_request', field: parsed.error }, origin);
    const body = parsed.body;

    const turnstileSecret = deps.env('TURNSTILE_SECRET');
    const salt = deps.env('REPORT_IP_SALT');
    const url = deps.env('SUPABASE_URL');
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    if (!turnstileSecret || !salt || new TextEncoder().encode(salt).byteLength < SALT_MIN_BYTES || !url || !serviceKey) {
      console.error('report-public: not_configured');
      return json(500, { error: 'not_configured' }, origin);
    }

    // Turnstile: verificarea tokenului la Cloudflare, cu IP-ul clientului (remoteip e opțional, dar întărește verificarea).
    const { ip, source: ipSource } = clientIpInfo(req.headers);
    let captchaOk = false;
    try {
      const form = new URLSearchParams({ secret: turnstileSecret, response: body.token });
      if (ip !== 'unknown') form.set('remoteip', ip);
      const res = await deps.fetch(SITEVERIFY_URL, { method: 'POST', body: form });
      const data = (await res.json()) as { success?: boolean };
      captchaOk = res.ok && data?.success === true;
    } catch {
      captchaOk = false;
    }
    if (!captchaOk) {
      console.log('report-public: 403 captcha_failed');
      return json(403, { error: 'captcha_failed' }, origin);
    }

    const admin = deps.createAdmin(url, serviceKey);
    const { data, error } = await admin.rpc('insert_public_report', {
      p_ip_hash: await hashIp(salt, ip),
      p_target_type: body.type,
      p_target_id: body.id,
      p_reason: body.reason,
      p_details: body.details,
      p_email: body.email,
      p_lang: body.lang,
    });
    if (error) {
      const mapped = statusForRpcError(error.message);
      console.log(`report-public: ${mapped.status} ${mapped.error}`);
      return json(mapped.status, { error: mapped.error }, origin);
    }
    const outcome = rpcOutcome(data);
    if ('error' in outcome) {
      const mapped = statusForRpcError(outcome.error);
      console.log(`report-public: ${mapped.status} ${mapped.error}`);
      return json(mapped.status, { error: mapped.error }, origin);
    }
    // `ip_src` = de unde a venit IP-ul (cf / xff / none), fără IP: după primul test pe producție se vede dacă limita pe IP
    // chiar distinge clienții (`none` sau un `xff` comun = toți împart aceeași limită).
    console.log(`report-public: 200 ip_src=${ipSource}`);
    return json(200, { ok: true, id: outcome.id }, origin);
  };
}
