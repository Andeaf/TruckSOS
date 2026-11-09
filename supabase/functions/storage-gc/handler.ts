// 9 nov 2026 — faza 6.2: handler-ul Edge Function `storage-gc`, cu dependențele injectate (env, clientul admin,
// ceasul), testat în handler_test.ts. index.ts doar îl leagă la Deno.serve.
//
// Consumă coada `app.storage_gc_queue` (scrisă de retenție și de scanarea orfanilor) și șterge obiectele din Storage.
// `storage_gc_claim(p_limit, p_scan)` întoarce rândurile (fără stare de „claim”); `p_scan = true` (duminica, din
// `app.kick_storage_gc`) caută întâi pozele orfane ale anunțurilor / Market și le pune în coadă.
//
// Ordinea cererii (ca push-dispatch, decizia D4): 401 ÎNAINTE de orice — fără metodă, body, env sau client admin; în
// log o singură linie `storage-gc: 401`. Apoi 405, env Supabase, body opțional `{ scan?: boolean }`, claim.
//
// DRY-RUN implicit: fără `STORAGE_GC_APPLY=true` NU se șterge nimic — răspunsul spune ce AR șterge (număr, pe motive,
// primele 50 de nume), iar logul doar numărul. Cu APPLY: grupare pe bucket, `remove` în loturi de 100; un lot reușit
// → `storage_gc_finish(id-urile lotului)`; un lot eșuat rămâne în coadă (se reia la rularea următoare; `remove` pe o
// cale deja ștearsă nu e eroare). Buget 45 s, verificat înaintea fiecărui lot. În log: niciun nume de fișier.
import { checkPushSecret, PUSH_SECRET_HEADER } from '../_shared/push-secret.ts';

/** Rânduri cerute la un claim (serverul plafonează la 2000). */
export const CLAIM_LIMIT = 500;
/** Obiecte per `storage.remove` (limita practică a API-ului Storage pe o cerere). */
export const REMOVE_BATCH = 100;
/** Bugetul unei rulări; după el loturile rămase rămân în coadă. Kick-ul din cron are timeout 90 s. */
export const TIME_BUDGET_MS = 45_000;
/** Câte nume intră în răspunsul dry-run. */
export const SAMPLE_SIZE = 50;

type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Subsetul din clientul supabase-js pe care îl folosim (service_role). */
export interface AdminLike {
  rpc(fn: string, args?: Record<string, unknown>): RpcResult;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

export interface StorageGcDeps {
  /** `Deno.env.get` în producție. */
  env: (name: string) => string | undefined;
  /** Clientul service_role; se creează DOAR după ce poarta a trecut. */
  createAdmin: (url: string, serviceKey: string) => AdminLike;
  now: () => number;
}

export interface GcRow {
  id: number;
  bucket: string;
  name: string;
  reason: string;
  created_at?: string;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Rândurile valide din răspunsul claim-ului (id numeric, bucket și nume nevide). */
function toRows(data: unknown): GcRow[] {
  if (!Array.isArray(data)) return [];
  const rows: GcRow[] = [];
  for (const r of data) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === 'number' ? o.id : typeof o.id === 'string' ? Number(o.id) : NaN;
    if (!Number.isFinite(id) || typeof o.bucket !== 'string' || !o.bucket || typeof o.name !== 'string' || !o.name) {
      continue;
    }
    rows.push({ id, bucket: o.bucket, name: o.name, reason: typeof o.reason === 'string' ? o.reason : 'unknown' });
  }
  return rows;
}

/** Loturi de cel mult `size` rânduri, pe bucket, în ordinea primei apariții a bucket-ului. */
export function batchByBucket(rows: GcRow[], size = REMOVE_BATCH): { bucket: string; rows: GcRow[] }[] {
  const groups = new Map<string, GcRow[]>();
  for (const r of rows) {
    const g = groups.get(r.bucket);
    if (g) g.push(r);
    else groups.set(r.bucket, [r]);
  }
  const batches: { bucket: string; rows: GcRow[] }[] = [];
  for (const [bucket, list] of groups) {
    for (let i = 0; i < list.length; i += size) batches.push({ bucket, rows: list.slice(i, i + size) });
  }
  return batches;
}

export function makeStorageGcHandler(deps: StorageGcDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    // Poarta: secretul din header vs PUSH_KICK_SECRET, în timp constant. Înainte de orice altceva.
    if (!(await checkPushSecret(req.headers.get(PUSH_SECRET_HEADER), deps.env('PUSH_KICK_SECRET')))) {
      console.log('storage-gc: 401');
      return json(401, { error: 'unauthorized' });
    }
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const url = deps.env('SUPABASE_URL');
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return json(500, { error: 'missing_supabase_env' });

    // Body opțional: lipsă sau ne-JSON = fără scanare.
    let scan = false;
    try {
      const body = await req.json();
      scan = !!body && typeof body === 'object' && (body as Record<string, unknown>).scan === true;
    } catch {
      scan = false;
    }

    const apply = deps.env('STORAGE_GC_APPLY') === 'true';
    const admin = deps.createAdmin(url, serviceKey);
    const start = deps.now();

    const { data, error: claimErr } = await admin.rpc('storage_gc_claim', { p_limit: CLAIM_LIMIT, p_scan: scan });
    if (claimErr) {
      console.error(`storage-gc: claim_failed (${claimErr.message})`);
      return json(500, { error: 'claim_failed', detail: claimErr.message });
    }
    const rows = toRows(data);

    if (!apply) {
      const byReason: Record<string, number> = {};
      for (const r of rows) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
      console.log(`storage-gc: dry-run count=${rows.length} scan=${scan}`);
      return json(200, {
        dry_run: true,
        scan,
        count: rows.length,
        // claim-ul e plafonat la CLAIM_LIMIT: `capped` spune că mai e coadă dincolo de `count` (review 9 nov)
        capped: rows.length >= CLAIM_LIMIT,
        by_reason: byReason,
        sample: rows.slice(0, SAMPLE_SIZE).map((r) => r.name),
      });
    }

    const stats = { claimed: rows.length, removed: 0, finished: 0, failed_batches: 0, skipped: 0 };
    const batches = batchByBucket(rows);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      if (deps.now() - start >= TIME_BUDGET_MS) {
        // Bugetul s-a terminat: loturile rămase stau în coadă pentru rularea următoare.
        stats.skipped = batches.slice(i).reduce((n, b) => n + b.rows.length, 0);
        break;
      }
      const names = batch.rows.map((r) => r.name);
      let removeErr: string | null = null;
      let removedCount = 0;
      try {
        const res = await admin.storage.from(batch.bucket).remove(names);
        removeErr = res.error ? res.error.message : null;
        removedCount = Array.isArray(res.data) ? res.data.length : names.length;
      } catch (e) {
        removeErr = (e as Error)?.message ?? 'remove_exception';
      }
      if (removeErr !== null) {
        stats.failed_batches += 1;
        console.error(`storage-gc: remove failed bucket=${batch.bucket} n=${names.length} (${removeErr.slice(0, 200)})`);
        continue;
      }
      stats.removed += removedCount;

      const ids = batch.rows.map((r) => r.id);
      let finishErr: string | null = null;
      try {
        const res = await admin.rpc('storage_gc_finish', { p_ids: ids });
        finishErr = res.error ? res.error.message : null;
        if (!finishErr) stats.finished += typeof res.data === 'number' ? res.data : ids.length;
      } catch (e) {
        finishErr = (e as Error)?.message ?? 'finish_exception';
      }
      if (finishErr !== null) {
        // Obiectele sunt șterse, rândurile rămân: rularea următoare le reia (remove pe o cale lipsă nu e eroare).
        stats.failed_batches += 1;
        console.error(`storage-gc: finish failed n=${ids.length} (${finishErr.slice(0, 200)})`);
      }
    }

    console.log(
      `storage-gc: apply claimed=${stats.claimed} removed=${stats.removed} finished=${stats.finished} ` +
        `failed_batches=${stats.failed_batches} skipped=${stats.skipped} scan=${scan}`,
    );
    return json(200, { dry_run: false, scan, ...stats, ms: deps.now() - start });
  };
}
