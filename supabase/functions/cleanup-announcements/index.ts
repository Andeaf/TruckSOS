// 23 aug 2026 — Edge Function `cleanup-announcements`
// Rulează ORAR (pg_cron + pg_net, vezi migrarea 20260823_cleanup_cron.sql) și aplică
// politica de retenție decisă pe 23 aug:
//   1. Anunțurile `open` mai vechi de 30h → `cancelled` (expiră: dispar din feed,
//      dar RÂNDUL rămâne — istoricul șoferului și RLS-ul de rating au nevoie de el).
//   2. Pozele TUTUROR anunțurilor mai vechi de 30h se șterg din Storage — cu EXCEPȚIA
//      celor `accepted` (reparație în curs: mecanicul are nevoie de poze; se șterg
//      la prima rulare de după resolved/cancelled).
//
// De ce Edge Function și nu SQL pur: ștergerea obiectelor Storage TREBUIE făcută prin
// API (service_role). Un DELETE direct pe storage.objects lasă fișierul pe S3 —
// inaccesibil, dar ocupând în continuare spațiul facturat (exact ce vrem să eliberăm).
//
// Ordinea per lot: întâi remove() din Storage, ABIA APOI ștergem rândurile din
// announcement_photos. La orice eșec rândurile rămân → următoarea rulare reia lotul.
// Idempotent și sigur la re-rulare; fără stare proprie.
//
// Securitate: NU e apelabilă de clienți — cere ca Bearer-ul să fie un JWT cu
// role=service_role (cron-ul trimite cheia legacy service_role din Vault).
// verify_jwt e PORNIT (default) → gateway-ul validează SEMNĂTURA înainte să ajungă
// aici, deci e suficient să citim claim-ul `role` din payload: anon are 'anon',
// userii 'authenticated', doar cheia service_role are 'service_role'. NU comparăm
// exact cu env-ul SUPABASE_SERVICE_ROLE_KEY: pe proiectele cu sistemul NOU de chei
// API env-ul poate fi cheia sb_secret_…, diferită de JWT-ul legacy din Vault
// (lecția din 23 aug: comparația exactă dădea 403 cu cheia CORECTĂ).

import { createClient } from 'npm:@supabase/supabase-js@2';

const HOURS = 30; // 4 sept 2026: 72h → 30h (decizia userului; 72h era prea mult)
/** Plafon per rulare — orice backlog se drenează în rulările următoare (orare). */
const MAX_PHOTOS_PER_RUN = 500;
const CHUNK = 100;

/** Conturile DEMO pentru App Review / Play Review — EXCEPTATE de la expirare și
 *  de la ștergerea pozelor: reply-ul trimis lui Apple îi indică recenzorului exact
 *  anunțurile astea (lecția din 23 aug: prima rulare le-a anulat și a golit feedul
 *  în plin review; restaurate prin SEED_review_accounts.sql). */
const EXEMPT_DRIVERS = [
  '9406f673-d96d-41cc-b398-a0d051f26d8b', // demo driver account
  '36ce6369-0d85-45de-9dff-59951e3787e2', // demo mechanic account
];
const EXEMPT_LIST = `(${EXEMPT_DRIVERS.join(',')})`;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Claim-ul `role` din payload-ul unui Bearer JWT (semnătura e deja verificată de
 *  gateway-ul de funcții — verify_jwt ON). null dacă nu arată a JWT. */
function bearerRole(auth: string): string | null {
  const token = auth.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Doar cron-ul (cu cheia service_role din Vault) are voie — nu userii logați.
  const auth = req.headers.get('Authorization') ?? '';
  if (bearerRole(auth) !== 'service_role') return json(403, { error: 'forbidden' });

  const admin = createClient(url, serviceKey);
  const cutoff = new Date(Date.now() - HOURS * 3600 * 1000).toISOString();

  // ── 1. Expiră anunțurile `open` >30h (trigger-ul ban_guard e no-op la uid NULL). ──
  const { data: expired, error: expireErr } = await admin
    .from('announcements')
    .update({ status: 'cancelled' })
    .eq('status', 'open')
    .lt('created_at', cutoff)
    .not('driver_id', 'in', EXEMPT_LIST)
    .select('id');
  if (expireErr) return json(500, { error: 'expire_failed', detail: expireErr.message });

  // ── 2. Pozele anunțurilor >30h, minus cele `accepted` (join pe FK, filtru embed). ──
  const { data: photos, error: photosErr } = await admin
    .from('announcement_photos')
    .select('id, storage_path, announcements!inner(id)')
    .lt('announcements.created_at', cutoff)
    .neq('announcements.status', 'accepted')
    .not('announcements.driver_id', 'in', EXEMPT_LIST)
    .limit(MAX_PHOTOS_PER_RUN);
  if (photosErr) return json(500, { error: 'select_photos_failed', detail: photosErr.message });

  let removed = 0;
  const failures: string[] = [];
  const rows = photos ?? [];
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

  return json(200, {
    ok: failures.length === 0,
    expired: expired?.length ?? 0,
    photosRemoved: removed,
    photosPending: rows.length - removed,
    failures,
  });
});
