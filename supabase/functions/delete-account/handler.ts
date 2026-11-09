// Faza 15 — Edge Function `delete-account`; 9 nov 2026 (faza 6.1): handler cu dependențe injectate (testat în
// handler_test.ts) + revocarea Sign in with Apple. index.ts doar îl leagă la Deno.serve.
// Orchestrează ștergerea IREVERSIBILĂ a contului.
//
// Flux:
//   1. verifică JWT-ul apelantului → uid DIN JWT (niciodată din body — altfel oricine ar șterge alt cont)
//   2. (faza 6.1) Apple: `read_apple_token(uid)` (service_role) → dacă există token și env-urile Apple sunt setate →
//      POST https://appleid.apple.com/auth/revoke; rezultatul ('true' | 'false:<motiv>' | 'no_token' |
//      'not_configured') → `record_account_deletion`. NIMIC din pasul ăsta nu blochează ștergerea (Apple indisponibil,
//      migrarea neaplicată, env lipsă → se continuă cu fluxul vechi). Token-ul nu se loghează niciodată.
//   3. rpc('purge_user_data') ca utilizatorul (auth.uid()) → purjă DB atomică + întoarce căile Storage
//   4. storage.remove(paths) cu service_role (obiectele nu se șterg prin cascadă SQL)
//   5. auth.admin.deleteUser(uid) cu service_role — ULTIMA. Profilul rămâne piatră-funerară (FK rupt); rândul din
//      app.apple_tokens cade prin cascadă (FK pe auth.users).
//
// Ordinea (SQL atomic → Storage → auth) face ca cea mai proastă stare parțială să fie „fișiere
// orfane" sau „auth încă există", niciodată „auth șters + date-fantomă". Reîncercarea e sigură
// (purge_user_data e idempotent: early-out pe deleted_at; revocarea repetată a aceluiași token e inofensivă).
//
// Contractul HTTP e NESCHIMBAT pentru clienții 1.0.x: OPTIONS 'ok' (CORS), 405, 401 missing_authorization,
// 401 invalid_token, 500 purge_failed, 500 auth_delete_failed, 200 { ok: true }.
import {
  APPLE_REVOKE_URL,
  appleConfigFromEnv,
  makeAppleClientSecret,
  postAppleForm,
} from '../_shared/apple-client-secret.ts';

/** Revocarea la Apple nu întârzie ștergerea mai mult de atât. */
export const APPLE_FETCH_TIMEOUT_MS = 10_000;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Clientul CA utilizatorul (RLS + auth.uid() din JWT-ul din antet). */
export interface UserClientLike {
  auth: {
    getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
  };
  rpc(fn: string, args?: Record<string, unknown>): RpcResult;
}

/** Clientul service_role. */
export interface AdminLike {
  rpc(fn: string, args?: Record<string, unknown>): RpcResult;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
  auth: {
    admin: {
      deleteUser(id: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

export interface DeleteAccountDeps {
  /** `Deno.env.get` în producție (doar env-urile Apple sunt citite de aici). */
  env: (name: string) => string | undefined;
  createUserClient: (authHeader: string) => UserClientLike;
  createAdmin: () => AdminLike;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * Revocarea Apple; întoarce MEREU un rezultat scurt (nu aruncă): 'true' | 'false:<status|motiv>' | 'no_token' |
 * 'not_configured'. 'no_token' se decide înaintea env-urilor (conturile fără Apple nu ating configurația).
 */
export async function revokeAppleToken(admin: AdminLike, uid: string, deps: DeleteAccountDeps): Promise<string> {
  let token: unknown;
  try {
    const { data, error } = await admin.rpc('read_apple_token', { p_user_id: uid });
    if (error) {
      console.error(`[delete-account] read_apple_token failed: ${error.message}`);
      return 'false:read_failed';
    }
    token = data;
  } catch {
    console.error('[delete-account] read_apple_token threw');
    return 'false:read_failed';
  }
  if (typeof token !== 'string' || token.length === 0) return 'no_token';

  const config = appleConfigFromEnv(deps.env);
  if (!config) {
    console.error('[delete-account] apple revoke skipped: not_configured');
    return 'not_configured';
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
  } catch {
    console.error('[delete-account] apple revoke skipped: client_secret failed (cheie ilizibilă)');
    return 'false:client_secret';
  }

  try {
    const reply = await postAppleForm(
      deps.fetch,
      APPLE_REVOKE_URL,
      { client_id: config.clientId, client_secret: clientSecret, token, token_type_hint: 'refresh_token' },
      APPLE_FETCH_TIMEOUT_MS,
    );
    if (reply.status === 200) return 'true';
    console.error(`[delete-account] apple revoke failed: status ${reply.status}`);
    return `false:${reply.status}`;
  } catch (e) {
    const reason = (e as Error)?.name === 'AbortError' ? 'timeout' : 'network';
    console.error(`[delete-account] apple revoke failed: ${reason}`);
    return `false:${reason}`;
  }
}

export function makeDeleteAccountHandler(deps: DeleteAccountDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'missing_authorization' });

    // Client CA utilizatorul: RLS + auth.uid() reflectă JWT-ul din antet.
    const userClient = deps.createUserClient(authHeader);

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json(401, { error: 'invalid_token' });
    const uid = user.id;

    const admin = deps.createAdmin();

    // ── 0. Apple (faza 6.1): revocarea, ÎNAINTE de deleteUser (rândul din apple_tokens cade prin cascadă acolo).
    //       Nu blochează niciodată ștergerea; rezultatul se scrie în audit abia după ce purja a reușit (review 9 nov:
    //       altfel un purge_failed sau un dublu tap ar lăsa rânduri `self_delete_account` pentru un cont încă existent). ──
    let appleRevoked = 'false:revoke_threw';
    try {
      appleRevoked = await revokeAppleToken(admin, uid, deps);
    } catch {
      console.error('[delete-account] apple revoke threw');
    }

    // ── 1. Purjă DB (atomică, ca auth.uid()). Întoarce căile Storage de șters. ──
    const { data: paths, error: purgeErr } = await userClient.rpc('purge_user_data');
    if (purgeErr) return json(500, { error: 'purge_failed', detail: purgeErr.message });

    // ── 1b. Evidența ștergerii (D2): piatra funerară din profiles satisface FK-ul admin_id. ──
    try {
      const { error: recErr } = await admin.rpc('record_account_deletion', {
        p_user_id: uid,
        p_apple_revoked: appleRevoked,
      });
      if (recErr) console.error(`[delete-account] record_account_deletion failed: ${recErr.message}`);
    } catch {
      console.error('[delete-account] record_account_deletion threw');
    }

    // ── 2. Storage (service_role). Eroare aici = fișiere orfane, tolerabil → logăm, nu abandonăm. ──
    const objectPaths = ((paths as string[] | null) ?? []).filter((p) => typeof p === 'string' && p.length > 0);
    if (objectPaths.length > 0) {
      const { error: rmErr } = await admin.storage.from('photos').remove(objectPaths);
      if (rmErr) console.error('[delete-account] storage remove failed (orphans left):', rmErr.message);
    }

    // ── 3. Șterge utilizatorul auth — ULTIMA. Profilul-piatră-funerară supraviețuiește (FK rupt). ──
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) return json(500, { error: 'auth_delete_failed', detail: delErr.message });

    return json(200, { ok: true });
  };
}
