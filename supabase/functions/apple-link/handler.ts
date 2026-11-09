// 9 nov 2026 — faza 6.1: handler-ul Edge Function `apple-link`, cu dependențele injectate (env, clienții Supabase,
// fetch, ceasul), testat în handler_test.ts. index.ts doar îl leagă la Deno.serve.
//
// Scop (App Store Review 5.1.1(v)): după `signInWithIdToken` cu Apple, clientul iOS trimite `authorization_code`
// (valabil 5 min, o singură dată). EF-ul îl schimbă la Apple pe `refresh_token` și îl stochează criptat prin
// `store_apple_token` (service_role), ca la ștergerea contului `delete-account` să poată revoca autorizarea.
//
// Ordinea cererii: OPTIONS (CORS) → 405 → 401 fără Authorization → 401 JWT invalid → 400 cont fără identitate Apple →
// 400 fără cod → abia acum env-urile Apple (un apelant neautentificat nu află nimic despre configurație) →
// schimbul la Apple → store. Lipsa oricărui env Apple sau o cheie ilizibilă → 500 `apple_not_configured`, nimic stocat.
// uid-ul vine DIN JWT, niciodată din body. În log: doar coduri de eroare, niciodată codul, token-ul sau cheia.
//
// verify_jwt rămâne PORNIT la gateway (nu e în config.toml): cererea vine cu JWT-ul utilizatorului.
import {
  APPLE_TOKEN_URL,
  appleConfigFromEnv,
  makeAppleClientSecret,
  postAppleForm,
} from '../_shared/apple-client-secret.ts';

/** Un POST blocat la Apple nu ține cererea clientului mai mult de atât. */
export const APPLE_FETCH_TIMEOUT_MS = 10_000;
/** Codurile Apple sunt scurte (~ 60–100 caractere); orice e mult mai lung nu e un cod. */
export const MAX_CODE_LENGTH = 4096;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

export interface UserLike {
  id: string;
  identities?: { provider: string }[] | null;
}

/** Clientul CA utilizatorul (anon key + Authorization din cerere): doar `auth.getUser()`. */
export interface UserClientLike {
  auth: {
    getUser(): PromiseLike<{ data: { user: UserLike | null }; error: { message: string } | null }>;
  };
}

/** Clientul service_role: doar `rpc`. */
export interface AdminLike {
  rpc(fn: string, args?: Record<string, unknown>): RpcResult;
}

export interface AppleLinkDeps {
  /** `Deno.env.get` în producție (doar env-urile Apple sunt citite de aici). */
  env: (name: string) => string | undefined;
  createUserClient: (authHeader: string) => UserClientLike;
  createAdmin: () => AdminLike;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Câmpul `error` din răspunsul Apple (ex. `invalid_grant`), scurtat; nimic altceva din corp. */
function appleErrorCode(body: Record<string, unknown> | null): string {
  const e = body?.error;
  return typeof e === 'string' && e.length > 0 ? e.slice(0, 64) : 'unknown';
}

export function makeAppleLinkHandler(deps: AppleLinkDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'missing_authorization' });

    let user: UserLike | null = null;
    try {
      const { data, error } = await deps.createUserClient(authHeader).auth.getUser();
      user = error ? null : (data?.user ?? null);
    } catch {
      user = null;
    }
    if (!user) return json(401, { error: 'invalid_token' });

    const isApple = Array.isArray(user.identities) && user.identities.some((i) => i?.provider === 'apple');
    if (!isApple) return json(400, { error: 'not_apple_account' });

    let code: unknown = undefined;
    try {
      const body = await req.json();
      code = body && typeof body === 'object' ? (body as Record<string, unknown>).authorization_code : undefined;
    } catch {
      code = undefined;
    }
    if (typeof code !== 'string' || code.trim().length === 0 || code.length > MAX_CODE_LENGTH) {
      return json(400, { error: 'missing_authorization_code' });
    }

    // Abia după autentificare: configurația Apple. Lipsă → fail closed, nimic stocat.
    const config = appleConfigFromEnv(deps.env);
    if (!config) {
      console.error('apple-link: apple_not_configured (env lipsă)');
      return json(500, { error: 'apple_not_configured' });
    }

    let clientSecret: string;
    try {
      clientSecret = await makeAppleClientSecret({
        privateKeyPem: config.privateKeyPem,
        teamId: config.teamId,
        keyId: config.keyId,
        clientId: config.clientId,
        nowSeconds: Math.floor(deps.now() / 1000),
      });
    } catch (e) {
      // Doar numele erorii proprii (apple_key_unreadable / apple_key_not_pkcs8) sau al excepției WebCrypto; nu cheia.
      const reason = e instanceof Error && e.message.startsWith('apple_') ? e.message : (e as Error)?.name ?? 'error';
      console.error(`apple-link: apple_not_configured (cheie ilizibilă: ${reason})`);
      return json(500, { error: 'apple_not_configured' });
    }

    let reply: { status: number; body: Record<string, unknown> | null };
    try {
      reply = await postAppleForm(
        deps.fetch,
        APPLE_TOKEN_URL,
        {
          grant_type: 'authorization_code',
          code: code.trim(),
          client_id: config.clientId,
          client_secret: clientSecret,
        },
        APPLE_FETCH_TIMEOUT_MS,
      );
    } catch (e) {
      const reason = (e as Error)?.name === 'AbortError' ? 'timeout' : 'network';
      console.error(`apple-link: apple_token_exchange_failed (${reason})`);
      return json(502, { error: 'apple_token_exchange_failed', apple_error: reason });
    }

    const refreshToken = reply.body?.refresh_token;
    if (reply.status !== 200 || typeof refreshToken !== 'string' || refreshToken.length === 0) {
      const appleError = reply.status === 200 ? 'no_refresh_token' : appleErrorCode(reply.body);
      console.error(`apple-link: apple_token_exchange_failed (status ${reply.status}, ${appleError})`);
      return json(502, { error: 'apple_token_exchange_failed', apple_error: appleError });
    }

    let storeError: string | null = null;
    try {
      const { error } = await deps.createAdmin().rpc('store_apple_token', {
        p_user_id: user.id,
        p_refresh_token: refreshToken,
      });
      storeError = error ? error.message : null;
    } catch (e) {
      storeError = (e as Error)?.message ?? 'store_exception';
    }
    if (storeError !== null) {
      // Mesajul vine din Postgres (ex. apple_token_key_missing); nu conține token-ul.
      console.error(`apple-link: store_failed (${storeError})`);
      // Fără `detail` către client (review 9 nov): mesajul descrie starea configurației serverului (ex.
      // apple_token_key_missing); rămâne doar în log.
      return json(500, { error: 'store_failed' });
    }

    return json(200, { ok: true });
  };
}
