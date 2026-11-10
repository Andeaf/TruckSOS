// 10 nov 2026 — faza 9.3: handler-ul Edge Function `cleanup-announcements`, cu dependențele injectate (env, clientul
// admin, ceasul), testat în handler_test.ts. index.ts doar îl leagă la Deno.serve.
//
// Ordinea cererii (ca storage-gc / push-dispatch, decizia D4): 401 ÎNAINTE de orice — fără metodă, env Supabase sau
// client admin; în log o singură linie `cleanup-announcements: 401`. Apoi 405, env Supabase (500 not_configured), apoi
// logica de retenție, neschimbată față de versiunea din 23 aug / 4 sept (vezi antetul din index.ts):
//   1. anunțurile `open` mai vechi de 30 h → `cancelled` (conturile demo exceptate);
//   2. pozele anunțurilor mai vechi de 30 h, minus cele `accepted`, în loturi de 100: întâi `storage.remove`, ABIA APOI
//      `delete` pe announcement_photos; la orice eșec rândurile lotului rămân și se reiau la rularea următoare.
// În log: doar contoare, niciun nume de fișier.
import { checkPushSecret, PUSH_SECRET_HEADER } from '../_shared/push-secret.ts';

export const HOURS = 30; // 4 sept 2026: 72h → 30h (decizia userului; 72h era prea mult)
/** Plafon per rulare — orice backlog se drenează în rulările următoare (orare). */
export const MAX_PHOTOS_PER_RUN = 500;
export const CHUNK = 100;

/** Conturile DEMO pentru App Review / Play Review — EXCEPTATE de la expirare și
 *  de la ștergerea pozelor: reply-ul trimis lui Apple îi indică recenzorului exact
 *  anunțurile astea (lecția din 23 aug: prima rulare le-a anulat și a golit feedul
 *  în plin review; restaurate prin SEED_review_accounts.sql). */
export const EXEMPT_DRIVERS = [
  '9406f673-d96d-41cc-b398-a0d051f26d8b', // demo driver account
  '36ce6369-0d85-45de-9dff-59951e3787e2', // demo mechanic account
];
export const EXEMPT_LIST = `(${EXEMPT_DRIVERS.join(',')})`;

type DbResult = { data: unknown; error: { message: string } | null };

/** Subsetul din clientul supabase-js pe care îl folosim (service_role): exact cele trei lanțuri PostgREST de mai jos. */
export interface AdminLike {
  from(table: string): {
    // pasul 1: update → eq → lt → not → select
    update(values: { status: string }): {
      eq(column: string, value: string): {
        lt(column: string, value: string): {
          not(column: string, operator: string, value: string): { select(columns: string): PromiseLike<DbResult> };
        };
      };
    };
    // pasul 2: select → lt → filter(neq) → not → limit
    select(columns: string): {
      lt(column: string, value: string): {
        filter(column: string, operator: string, value: string): {
          not(column: string, operator: string, value: string): { limit(count: number): PromiseLike<DbResult> };
        };
      };
    };
    // ștergerea rândurilor unui lot: delete → in
    delete(): { in(column: string, values: string[]): PromiseLike<DbResult> };
  };
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

export interface CleanupAnnouncementsDeps {
  /** `Deno.env.get` în producție. */
  env: (name: string) => string | undefined;
  /** Clientul service_role; se creează DOAR după ce poarta a trecut. */
  createAdmin: (url: string, serviceKey: string) => AdminLike;
  now: () => number;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Rândurile din răspunsul PostgREST ca obiecte (orice altceva e ignorat). */
function toRecords(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
}

export function makeCleanupAnnouncementsHandler(deps: CleanupAnnouncementsDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    // Poarta: secretul din header vs PUSH_KICK_SECRET, în timp constant. Înainte de orice altceva.
    if (!(await checkPushSecret(req.headers.get(PUSH_SECRET_HEADER), deps.env('PUSH_KICK_SECRET')))) {
      console.log('cleanup-announcements: 401');
      return json(401, { error: 'unauthorized' });
    }
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const url = deps.env('SUPABASE_URL');
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return json(500, { error: 'not_configured' });

    const admin = deps.createAdmin(url, serviceKey);
    const cutoff = new Date(deps.now() - HOURS * 3600 * 1000).toISOString();

    // ── 1. Expiră anunțurile `open` >30h (trigger-ul ban_guard e no-op la uid NULL). ──
    const { data: expired, error: expireErr } = await admin
      .from('announcements')
      .update({ status: 'cancelled' })
      .eq('status', 'open')
      .lt('created_at', cutoff)
      .not('driver_id', 'in', EXEMPT_LIST)
      .select('id');
    if (expireErr) {
      console.error('cleanup-announcements: expire_failed');
      return json(500, { error: 'expire_failed', detail: expireErr.message });
    }

    // ── 2. Pozele anunțurilor >30h, minus cele `accepted` (join pe FK, filtru embed). ──
    // `.filter(c, 'neq', v)` pune în URL exact ce punea `.neq(c, v)` (`announcements.status=neq.accepted`); `.neq`
    // generic din postgrest-js nu se potrivește structural cu AdminLike (TS2589), `.filter` are o semnătură simplă.
    const { data: photos, error: photosErr } = await admin
      .from('announcement_photos')
      .select('id, storage_path, announcements!inner(id)')
      .lt('announcements.created_at', cutoff)
      .filter('announcements.status', 'neq', 'accepted')
      .not('announcements.driver_id', 'in', EXEMPT_LIST)
      .limit(MAX_PHOTOS_PER_RUN);
    if (photosErr) {
      console.error('cleanup-announcements: select_photos_failed');
      return json(500, { error: 'select_photos_failed', detail: photosErr.message });
    }

    let removed = 0;
    const failures: string[] = [];
    const rows = toRecords(photos);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const paths = chunk.map((r) => r.storage_path as string).filter(Boolean);
      // Storage întâi: dacă remove() pică, rândurile RĂMÂN și lotul se reia data viitoare.
      const { error: rmErr } = await admin.storage.from('photos').remove(paths);
      if (rmErr) {
        failures.push(rmErr.message);
        continue;
      }
      const { error: delErr } = await admin
        .from('announcement_photos')
        .delete()
        .in('id', chunk.map((r) => r.id as string));
      if (delErr) {
        // Obiectele au dispărut deja; rândurile orfane se re-încearcă la rularea
        // următoare (remove() pe path inexistent nu dă eroare) — tot convergent.
        failures.push(delErr.message);
        continue;
      }
      removed += paths.length;
    }

    const body = {
      ok: failures.length === 0,
      expired: Array.isArray(expired) ? expired.length : 0,
      photosRemoved: removed,
      photosPending: rows.length - removed,
      failures,
    };
    console.log(
      `cleanup-announcements: expired=${body.expired} photosRemoved=${removed} ` +
        `photosPending=${body.photosPending} failed_batches=${failures.length}`,
    );
    return json(200, body);
  };
}
