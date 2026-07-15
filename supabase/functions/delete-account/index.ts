// Faza 15 — Edge Function `delete-account`
// Orchestrează ștergerea IREVERSIBILĂ a contului. Rulează pe Deno (Supabase Edge Functions).
//
// Flux:
//   1. verifică JWT-ul apelantului → uid DIN JWT (niciodată din body — altfel oricine ar șterge alt cont)
//   2. rpc('purge_user_data') ca utilizatorul (auth.uid()) → purjă DB atomică + întoarce căile Storage
//   3. storage.remove(paths) cu service_role (obiectele nu se șterg prin cascadă SQL)
//   4. auth.admin.deleteUser(uid) cu service_role — ULTIMA. Profilul rămâne piatră-funerară (FK rupt).
//
// Ordinea (SQL atomic → Storage → auth) face ca cea mai proastă stare parțială să fie „fișiere
// orfane" sau „auth încă există", niciodată „auth șters + date-fantomă". Reîncercarea e sigură
// (purge_user_data e idempotent: early-out pe deleted_at).
//
// Env-uri AUTO-injectate de Supabase (nu trebuie setate manual):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'missing_authorization' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Client CA utilizatorul: RLS + auth.uid() reflectă JWT-ul din antet.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json(401, { error: 'invalid_token' });
  const uid = user.id;

  // ── 1. Purjă DB (atomică, ca auth.uid()). Întoarce căile Storage de șters. ──
  const { data: paths, error: purgeErr } = await userClient.rpc('purge_user_data');
  if (purgeErr) return json(500, { error: 'purge_failed', detail: purgeErr.message });

  const admin = createClient(url, serviceKey);

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
});
