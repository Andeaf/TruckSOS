#!/usr/bin/env node
// Poarta 4.1 (PLAN_1.1_FIX, faza 4): rejoacă pe stack-ul Supabase local din CI exact formele cererilor
// pe care le fac aplicațiile publicate 1.0.6–1.0.8 (supabase/gate/shapes-1.0.x.csv, extrase din jurnalul
// API al producției pe 7 zile, normalizate: fără id-uri reale, fără token-uri), ca fiecare persoană
// de probă (șofer, mecanic acceptat, mecanic neacceptat, admin, oaspete), plus fluxurile de scriere
// din 1.0.8 cu corpurile exacte din cod. Se rulează o dată ÎNAINTE de migrările de după baseline
// și o dată DUPĂ; `compare` cere pentru fiecare cerere același cod HTTP, același număr de rânduri și
// aceleași chei în JSON (inclusiv în embed-uri). Valorile pot diferi (mascarea → NULL e intenționată):
// diferențele de „nul/ne-nul” se raportează informativ, ca să se vadă că doar coloanele vizate s-au schimbat.
//
//   node scripts/replay-1_0_8.mjs run --out <dir>           (API_URL, ANON_KEY din `supabase status -o env`)
//   node scripts/replay-1_0_8.mjs compare <before> <after>  (cod de ieșire: 0 PASS, 1 FAIL, 2 STOP = hint-ul
//                                                            `profiles!driver_id` nu rezolvă prin view)
// Doar module încorporate (fetch, fs): jobul db-tests nu rulează `npm ci`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SHAPES_FILE = join(process.cwd(), 'supabase', 'gate', 'shapes-1.0.x.csv');
const PASSWORD = 'Gate-1234';

// Id-urile fixe din supabase/gate/fixtures.sql.
const ID = {
  A: 'a0000000-0000-4000-8000-00000000000a',
  B: 'b0000000-0000-4000-8000-00000000000b',
  M1: 'c0000000-0000-4000-8000-0000000000c1',
  M2: 'c0000000-0000-4000-8000-0000000000c2',
  X: 'd0000000-0000-4000-8000-00000000000d',
  W1: 'e0000000-0000-4000-8000-0000000000e1',
  W2: 'e0000000-0000-4000-8000-0000000000e2',
  ANN_OPEN_A: '11111111-0000-4000-8000-000000000001',
  ANN_ACC_A: '11111111-0000-4000-8000-000000000002',
  ANN_OPEN_B: '11111111-0000-4000-8000-000000000005',
  APP_M2_OPEN_A: '22222222-0000-4000-8000-000000000001',
  APP_M1_ACC: '22222222-0000-4000-8000-000000000002',
  CONV_A_M1: '33333333-0000-4000-8000-000000000001',
  CONV_A_M2: '33333333-0000-4000-8000-000000000002',
  CH: '44444444-0000-4000-8000-000000000001',
  LST1: '55555555-0000-4000-8000-000000000001',
  MSG1: '88888888-0000-4000-8000-000000000001',
  CM1: '99999999-0000-4000-8000-000000000001',
  TRUCK1: 'aaaaaaaa-0000-4000-8000-000000000001',
  RPT1: 'cccccccc-0000-4000-8000-000000000001',
};

const PERSONAS = [
  { key: 'driver_a', email: 'gate-driver-a@example.com', id: ID.A, role: 'driver' },
  { key: 'mech_accepted', email: 'gate-mech-acc@example.com', id: ID.M1, role: 'mechanic' },
  { key: 'mech_open', email: 'gate-mech-open@example.com', id: ID.M2, role: 'mechanic' },
  { key: 'admin', email: 'gate-admin@example.com', id: ID.X, role: 'admin' },
  { key: 'anon', email: null, id: null, role: 'anon' },
];

const args = process.argv.slice(2);
const mode = args[0];
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};

// ── CSV ────────────────────────────────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

// ── Înlocuirea placeholder-elor, după coloana filtrată și după persoană ─────────────────────────
function idFor(column, persona, path) {
  const me = persona.id ?? ID.A;
  const isMech = persona.role === 'mechanic';
  switch (column) {
    case 'sender_id': case 'user_id': case 'viewer_id': case 'blocker_id': case 'reporter_id': case 'driver_id':
      return me;
    case 'mechanic_id': return isMech ? me : ID.M1;
    case 'seller_id': return me;
    case 'conversation_id': return persona.id === ID.M2 ? ID.CONV_A_M2 : ID.CONV_A_M1;
    case 'channel_id': return ID.CH;
    case 'announcement_id': return persona.id === ID.M1 ? ID.ANN_ACC_A : ID.ANN_OPEN_A;
    case 'listing_id': return ID.LST1;
    case 'blocked_id': case 'reported_user_id': return ID.M2;
    case 'recommended_mechanic_id': return ID.M1;
    case 'reply_to_id': return path.endsWith('/channel_messages') ? ID.CM1 : ID.MSG1;
    case 'id': {
      const table = path.split('/').pop();
      switch (table) {
        case 'profiles': return persona.id === ID.M1 || persona.key === 'anon' ? ID.A : ID.M1;
        case 'announcements': return persona.id === ID.M1 ? ID.ANN_ACC_A : ID.ANN_OPEN_A;
        case 'conversations': return idFor('conversation_id', persona, path);
        case 'channels': return ID.CH;
        case 'market_listings': return ID.LST1;
        case 'messages': return ID.MSG1;
        case 'channel_messages': return ID.CM1;
        case 'applications': return persona.id === ID.M1 ? ID.APP_M1_ACC : ID.APP_M2_OPEN_A;
        case 'trucks': return ID.TRUCK1;
        case 'reports': return ID.RPT1;
        default: return me;
      }
    }
    default: return me;
  }
}

function substitute(search, persona, path) {
  let s = search;
  // col=eq.<uuid> / col=neq.<uuid> / col=in.(…<uuid>…)
  s = s.replace(/([a-z_]+)=(eq|neq|in|is)\.(<uuid>)/g, (_m, col, op) => `${col}=${op}.${idFor(col, persona, path)}`);
  // forma din or=(driver_id.eq.<uuid>,mechanic_id.eq.<uuid>), codificată URL (%28 … %2C … %29)
  s = s.replace(/([a-z_]+)\.(eq|neq)\.(<uuid>)/g, (_m, col, op) => `${col}.${op}.${idFor(col, persona, path)}`);
  s = s.replace(/<uuid>/g, persona.id ?? ID.A);
  // created_at=gt.<ts> / gte: paginarea „de la cursor”; un cursor din trecut aduce toate rândurile.
  s = s.replace(/<ts>/g, '2020-01-01T00:00:00.000Z');
  s = s.replace(/limit=<n>/g, 'limit=20').replace(/offset=<n>/g, 'offset=0').replace(/<n>/g, '20');
  return s;
}

// ── HTTP ───────────────────────────────────────────────────────────────────────────────────────
const API_URL = (process.env.API_URL ?? opt('--url', 'http://127.0.0.1:54321')).replace(/\/$/, '');
const ANON_KEY = process.env.ANON_KEY ?? opt('--anon-key', '');

async function login(email) {
  const res = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body.access_token;
}

/** Cheile JSON (căi, inclusiv prin embed-uri), plus câte valori ne-nule are fiecare cale. */
function describe(json) {
  const keys = new Map();
  const walk = (v, prefix) => {
    if (Array.isArray(v)) { for (const x of v) walk(x, prefix); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const p = prefix ? `${prefix}.${k}` : k;
        const e = keys.get(p) ?? { total: 0, nonnull: 0 };
        e.total++;
        if (x !== null && x !== undefined) e.nonnull++;
        keys.set(p, e);
        if (x && typeof x === 'object') walk(x, p);
      }
    }
  };
  walk(json, '');
  const rows = Array.isArray(json) ? json.length : json && typeof json === 'object' ? 1 : 0;
  return { rows, keys: Object.fromEntries([...keys.entries()].sort(([a], [b]) => a.localeCompare(b))) };
}

async function call({ method, path, search, token, body, headers: extra, raw }) {
  const headers = { apikey: ANON_KEY, Accept: 'application/json', ...(extra ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  if (method === 'HEAD') headers.Prefer = [headers.Prefer, 'count=exact'].filter(Boolean).join(', ');
  const res = await fetch(`${API_URL}${path}${search ?? ''}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const out = { status: res.status, contentRange: res.headers.get('content-range') ?? null };
  if (method !== 'HEAD') {
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { _text: text.slice(0, 200) }; }
    if (res.ok) Object.assign(out, describe(json));
    else out.error = json && typeof json === 'object' ? { code: json.code ?? json.error ?? null, message: String(json.message ?? json.msg ?? json.error_description ?? text).slice(0, 300) } : { message: text.slice(0, 300) };
    out.json = json;
  }
  return out;
}

// ── Faza run ───────────────────────────────────────────────────────────────────────────────────
async function run() {
  if (!ANON_KEY) throw new Error('ANON_KEY lipsește (supabase status -o env)');
  const outDir = opt('--out', null);
  if (!outDir) throw new Error('--out <dir> lipsește');
  mkdirSync(outDir, { recursive: true });
  const phase = opt('--phase', 'run');
  const shapes = parseCsv(readFileSync(SHAPES_FILE, 'utf8'));
  const tokens = {};
  for (const p of PERSONAS) if (p.email) tokens[p.key] = await login(p.email);

  const results = {};
  let n = 0;
  for (const shape of shapes) {
    if (shape.path.startsWith('/auth/')) continue;                 // GoTrue, nu baza; login-ul e deja probat
    if (!shape.path.startsWith('/rest/v1/')) continue;             // Storage: în secvența scriptată de mai jos
    if (shape.method !== 'GET' && shape.method !== 'HEAD') continue; // scrierile: corpuri exacte, mai jos
    const personas = shape.jwt_role === 'anon' ? PERSONAS.filter((p) => p.key === 'anon') : PERSONAS.filter((p) => p.key !== 'anon');
    for (const persona of personas) {
      const variants = shape.path.endsWith('/profiles') && /(^|[?&])id=eq\.<uuid>/.test(shape.search_shape)
        ? [['other', persona], ['self', { ...persona, id: persona.id ?? ID.M1, forceSelf: true }]]
        : [['', persona]];
      for (const [variant, pers] of variants) {
        let search = substitute(shape.search_shape, pers, shape.path);
        if (variant === 'self') search = search.replace(/(^|[?&])id=eq\.[0-9a-f-]{36}/, `$1id=eq.${persona.id ?? ID.M1}`);
        const key = `${persona.key} ${shape.method} ${shape.path}${search}${variant ? ` [${variant}]` : ''}`;
        const r = await call({ method: shape.method, path: shape.path, search, token: tokens[persona.key] });
        delete r.json;
        results[key] = { ...r, n: Number(shape.n) };
        n++;
      }
    }
  }

  // ── Fluxurile de scriere 1.0.8, cu corpurile din cod (fb3ab3f), pe entități proaspete per fază ──
  const fresh = phase === 'after' ? { user: ID.W2, email: 'gate-new-after@example.com' } : { user: ID.W1, email: 'gate-new-before@example.com' };
  const W = await login(fresh.email);
  const A = tokens.driver_a, M1 = tokens.mech_accepted, M2 = tokens.mech_open, X = tokens.admin;
  const rep = { Prefer: 'return=representation' };
  const step = async (name, req) => {
    const r = await call(req);
    const json = r.json; delete r.json;
    results[`W: ${name}`] = r;
    return json;
  };

  // use-auth.tsx createProfile: INSERT fără select → Prefer: return=minimal
  await step('POST profiles (cont nou, sofer) as new', { method: 'POST', path: '/rest/v1/profiles', token: W, headers: { Prefer: 'return=minimal' },
    body: { id: fresh.user, full_name: 'Gate New Driver', role: 'driver', phone: '+40700000055', address: null, vat_number: null } });
  await step('GET profiles self after insert as new', { method: 'GET', path: '/rest/v1/profiles', search: `?select=*&id=eq.${fresh.user}`, token: W });
  await step('POST profiles role=admin (trebuie respins) as new', { method: 'POST', path: '/rest/v1/profiles', token: W, headers: rep,
    body: { id: fresh.user, full_name: 'Gate Evil', role: 'admin', phone: '+40700000056', address: null, vat_number: null } });
  // use-auth.tsx updateProfile (settings-screen, profile-edit-screen, avatar-picker)
  await step('PATCH profiles own notify_radius_km as driver_a', { method: 'PATCH', path: '/rest/v1/profiles', search: `?id=eq.${ID.A}`, token: A, headers: rep, body: { notify_radius_km: 50 } });
  await step('PATCH profiles own push flags as driver_a', { method: 'PATCH', path: '/rest/v1/profiles', search: `?id=eq.${ID.A}`, token: A, headers: rep, body: { push_enabled: true, market_push_enabled: true } });
  await step('PATCH profiles own edit as driver_a', { method: 'PATCH', path: '/rest/v1/profiles', search: `?id=eq.${ID.A}`, token: A, headers: rep,
    body: { full_name: 'Gate Driver A', phone: '+40700000001', company_name: null, contact_email: null, address: null, vat_number: null } });
  await step('PATCH profiles own avatar as driver_a', { method: 'PATCH', path: '/rest/v1/profiles', search: `?id=eq.${ID.A}`, token: A, headers: rep, body: { avatar_path: `avatars/${ID.A}/avatar.jpg` } });
  await step('PATCH profiles own role=admin (trebuie respins) as driver_a', { method: 'PATCH', path: '/rest/v1/profiles', search: `?id=eq.${ID.A}`, token: A, headers: rep, body: { role: 'admin' } });
  await step('PATCH profiles of M1 (strain: 0 randuri) as driver_a', { method: 'PATCH', path: '/rest/v1/profiles', search: `?id=eq.${ID.M1}`, token: A, headers: rep, body: { full_name: 'Hacked' } });
  await step('PATCH profiles own as mech_open', { method: 'PATCH', path: '/rest/v1/profiles', search: `?id=eq.${ID.M2}`, token: M2, headers: rep,
    body: { full_name: 'Gate Mechanic Open', phone: '+40700000012', company_name: 'Gate Werkstatt GmbH', contact_email: 'werkstatt@example.com', address: 'Cluj-Napoca, Str. 2', vat_number: 'RO87654321', specialization: 'Electrica', activity_zone: 'Cluj' } });

  // use-announcements.ts createAnnouncement: .insert({...}).select('id')
  const annBody = (desc) => ({ driver_id: ID.A, description: desc, location: 'Gate: A1 km 50', status: 'open', truck_make: 'Volvo', truck_model: 'FH16',
    truck_year: 2019, plate_number: 'B-999-GATE', chassis_number: 'YV2RT40A8KB999999', latitude: 44.4300, longitude: 26.1100 });
  const n1 = await step('POST announcements select=id (N1) as driver_a', { method: 'POST', path: '/rest/v1/announcements', search: '?select=id', token: A, headers: rep, body: annBody(`Gate ${phase}: anunt nou N1`) });
  const n2 = await step('POST announcements select=id (N2) as driver_a', { method: 'POST', path: '/rest/v1/announcements', search: '?select=id', token: A, headers: rep, body: annBody(`Gate ${phase}: anunt nou N2`) });
  const N1 = n1?.[0]?.id, N2 = n2?.[0]?.id;
  await step('POST announcements for other driver (trebuie respins) as driver_a', { method: 'POST', path: '/rest/v1/announcements', search: '?select=id', token: A, headers: rep, body: { ...annBody('Gate: fals'), driver_id: ID.B } });
  if (N1) {
    await step('GET announcements N1 full as driver_a', { method: 'GET', path: '/rest/v1/announcements', search: `?select=*,driver:profiles!driver_id(full_name,avatar_path)&id=eq.${N1}`, token: A });
    await step('GET announcements N1 full as mech_open', { method: 'GET', path: '/rest/v1/announcements', search: `?select=*,driver:profiles!driver_id(full_name,avatar_path)&id=eq.${N1}`, token: M2 });
    await step('GET announcements N1 full as anon', { method: 'GET', path: '/rest/v1/announcements', search: `?select=id,driver_id,description,location,status,created_at,truck_make,truck_model,truck_year,lat_approx,lng_approx&id=eq.${N1}` });
    // use-announcement-photos.ts: rândul pozei + Storage (politicile Storage citesc announcements)
    await step('POST announcement_photos as driver_a', { method: 'POST', path: '/rest/v1/announcement_photos', token: A, headers: rep, body: { announcement_id: N1, storage_path: `announcements/${N1}/gate.jpg` } });
    const bytes = Uint8Array.from('ffd8ffe000104a46494600010100000100010000ffd9'.match(/../g).map((h) => parseInt(h, 16)));
    await step('STORAGE upload announcements/<N1>/gate.jpg as driver_a', { method: 'POST', path: `/storage/v1/object/photos/announcements/${N1}/gate.jpg`, token: A, raw: true, body: bytes, headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' } });
    await step('STORAGE sign as driver_a', { method: 'POST', path: `/storage/v1/object/sign/photos/announcements/${N1}/gate.jpg`, token: A, body: { expiresIn: 3600 } });
    await step('STORAGE sign as mech_open (anunt deschis: permis)', { method: 'POST', path: `/storage/v1/object/sign/photos/announcements/${N1}/gate.jpg`, token: M2, body: { expiresIn: 3600 } });
    await step('STORAGE sign as mech_accepted (nu e al lui, dar e mecanic: permis pe deschis)', { method: 'POST', path: `/storage/v1/object/sign/photos/announcements/${N1}/gate.jpg`, token: M1, body: { expiresIn: 3600 } });
    await step('STORAGE sign as anon (trebuie respins)', { method: 'POST', path: `/storage/v1/object/sign/photos/announcements/${N1}/gate.jpg`, body: { expiresIn: 3600 } });
    await step('RPC record_announcement_view N1 as mech_open', { method: 'POST', path: '/rest/v1/rpc/record_announcement_view', token: M2, body: { p_announcement_id: N1 } });
    // Ștergerea pozei (fluxul 1.0.8 de scoatere a unei poze; Storage-ul local nu permite DELETE direct în storage.objects)
    await step('STORAGE delete announcements/<N1>/gate.jpg as driver_a', { method: 'DELETE', path: '/storage/v1/object/photos', token: A, body: { prefixes: [`announcements/${N1}/gate.jpg`] } });
    // use-announcements.ts cancelAnnouncement / deleteAnnouncement
    await step('PATCH announcements N1 status=cancelled as driver_a', { method: 'PATCH', path: '/rest/v1/announcements', search: `?id=eq.${N1}`, token: A, headers: rep, body: { status: 'cancelled' } });
    await step('PATCH announcements N1 status=open (redeschidere directa: trebuie 0 randuri) as driver_a', { method: 'PATCH', path: '/rest/v1/announcements', search: `?id=eq.${N1}`, token: A, headers: rep, body: { status: 'open' } });
    await step('DELETE announcements N1 as driver_a', { method: 'DELETE', path: '/rest/v1/announcements', search: `?id=eq.${N1}`, token: A, headers: rep });
  }
  if (N2) {
    await step('RPC apply_to_announcement N2 as mech_open', { method: 'POST', path: '/rest/v1/rpc/apply_to_announcement', token: M2, body: { p_announcement_id: N2, p_price_type: 'fixed', p_price_amount: 250, p_currency: 'RON', p_message: 'Gate: oferta N2' } });
    await step('RPC apply_to_announcement N2 as driver_a (sofer: azi permis, #39 il inchide in 4.2b)', { method: 'POST', path: '/rest/v1/rpc/apply_to_announcement', token: A, body: { p_announcement_id: N2, p_price_type: 'fixed', p_price_amount: 1, p_currency: 'RON', p_message: null } });
    const apps = await step('GET applications N2 as driver_a', { method: 'GET', path: '/rest/v1/applications', search: `?select=*,mechanic:profiles!mechanic_id(full_name,avatar_path,rating_avg,rating_count)&announcement_id=eq.${N2}&mechanic_id=eq.${ID.M2}`, token: A });
    const appId = apps?.[0]?.id;
    await step('PATCH announcements N2 status=cancelled by other driver (0 randuri) as driver_b-like mech', { method: 'PATCH', path: '/rest/v1/announcements', search: `?id=eq.${N2}`, token: M2, headers: rep, body: { status: 'cancelled' } });
    if (appId) await step('RPC accept_application N2 as driver_a', { method: 'POST', path: '/rest/v1/rpc/accept_application', token: A, body: { p_application_id: appId } });
    await step('GET announcements N2 after accept as mech_open (acceptat: exact)', { method: 'GET', path: '/rest/v1/announcements', search: `?select=*&id=eq.${N2}`, token: M2 });
    await step('GET announcements N2 after accept as mech_accepted (neacceptat pe N2: aproximativ)', { method: 'GET', path: '/rest/v1/announcements', search: `?select=*&id=eq.${N2}`, token: M1 });
    await step('PATCH announcements N2 status=resolved as driver_a', { method: 'PATCH', path: '/rest/v1/announcements', search: `?id=eq.${N2}`, token: A, headers: rep, body: { status: 'resolved' } });
    await step('RPC set_announcements_hidden [N2] as driver_a', { method: 'POST', path: '/rest/v1/rpc/set_announcements_hidden', token: A, body: { p_ids: [N2] } });
  }
  // use-ratings.ts upsertRating: ON CONFLICT (mechanic_id, driver_id) — rândul există, deci calea UPDATE (D12-bis)
  await step('POST ratings upsert A->M1 as driver_a', { method: 'POST', path: '/rest/v1/ratings', search: '?on_conflict=mechanic_id%2Cdriver_id', token: A, headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: { mechanic_id: ID.M1, driver_id: ID.A, stars: 4, comment: `Gate ${phase}: nota` } });
  await step('GET ratings mine for M1 as driver_a', { method: 'GET', path: '/rest/v1/ratings', search: `?select=*&mechanic_id=eq.${ID.M1}&driver_id=eq.${ID.A}`, token: A });
  // B e șofer, fără anunț rezolvat cu A: politica ratings_insert_own respinge (M2 nu mai e „fără legătură”: N2 e rezolvat cu el).
  await step('POST ratings for unrelated user B (trebuie respins) as driver_a', { method: 'POST', path: '/rest/v1/ratings', search: '?on_conflict=mechanic_id%2Cdriver_id', token: A, headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: { mechanic_id: ID.B, driver_id: ID.A, stars: 1, comment: null } });
  // RPC-urile din 1.0.8 cu argumentele din cod
  await step('RPC get_mechanic_phone M1 as driver_a', { method: 'POST', path: '/rest/v1/rpc/get_mechanic_phone', token: A, body: { p_mechanic_id: ID.M1 } });
  await step('RPC get_mechanic_phone M2 as driver_a (conversatie directa)', { method: 'POST', path: '/rest/v1/rpc/get_mechanic_phone', token: A, body: { p_mechanic_id: ID.M2 } });
  await step('RPC get_driver_phone A as mech_accepted', { method: 'POST', path: '/rest/v1/rpc/get_driver_phone', token: M1, body: { p_driver_id: ID.A } });
  await step('RPC get_driver_phone B as mech_accepted (fara conversatie: null)', { method: 'POST', path: '/rest/v1/rpc/get_driver_phone', token: M1, body: { p_driver_id: ID.B } });
  await step('RPC start_direct_conversation M2 as driver_a', { method: 'POST', path: '/rest/v1/rpc/start_direct_conversation', token: A, body: { p_mechanic_id: ID.M2 } });
  await step('RPC search_mechanics as driver_a', { method: 'POST', path: '/rest/v1/rpc/search_mechanics', token: A, body: { p_query: 'gate' } });
  await step('RPC search_users as mech_open', { method: 'POST', path: '/rest/v1/rpc/search_users', token: M2, body: { p_query: 'gate' } });
  await step('RPC search_market_listings as driver_a', { method: 'POST', path: '/rest/v1/rpc/search_market_listings', token: A, body: { p_query: 'gate', p_category: null, p_sort: 'newest', p_limit: 20 } });
  await step('RPC admin_dashboard_stats as admin', { method: 'POST', path: '/rest/v1/rpc/admin_dashboard_stats', token: X, body: {} });
  await step('RPC admin_pending_reports_count as admin', { method: 'POST', path: '/rest/v1/rpc/admin_pending_reports_count', token: X, body: {} });
  await step('RPC admin_search_users as admin', { method: 'POST', path: '/rest/v1/rpc/admin_search_users', token: X, body: { p_query: 'gate' } });
  await step('RPC admin_user_detail A as admin', { method: 'POST', path: '/rest/v1/rpc/admin_user_detail', token: X, body: { p_uid: ID.A } });
  await step('RPC admin_list_recent_announcements as admin', { method: 'POST', path: '/rest/v1/rpc/admin_list_recent_announcements', token: X, body: { p_limit: 10 } });
  await step('RPC admin_dashboard_stats as driver_a (trebuie respins)', { method: 'POST', path: '/rest/v1/rpc/admin_dashboard_stats', token: A, body: {} });
  await step('RPC get_own_profile as driver_a', { method: 'POST', path: '/rest/v1/rpc/get_own_profile', token: A, body: {} });
  // Edge Functions cu cheia service_role (auth.uid() NULL): cleanup-announcements expiră anunțurile deschise,
  // translate-announcement marchează limba. Prin view, un UPDATE care ar scrie înapoi coloanele mascate ar
  // șterge plăcuța/VIN-ul și ar rotunji coordonatele — valorile sunt verificate de supabase/gate/post-check.sql.
  const SR = process.env.SERVICE_ROLE_KEY ?? opt('--service-key', '');
  if (SR) {
    const srHeaders = { apikey: SR, Prefer: 'return=representation' };
    await step('SERVICE_ROLE PATCH announcements A6 status=cancelled (cleanup-announcements)', { method: 'PATCH', path: '/rest/v1/announcements',
      search: `?select=id&id=eq.11111111-0000-4000-8000-000000000006&status=eq.open`, token: SR, headers: srHeaders, body: { status: 'cancelled' } });
    await step('SERVICE_ROLE PATCH announcements A1 source_lang (translate-announcement)', { method: 'PATCH', path: '/rest/v1/announcements',
      search: `?id=eq.${ID.ANN_OPEN_A}`, token: SR, headers: srHeaders, body: { source_lang: 'ro', source_lang_detected: true } });
    await step('SERVICE_ROLE GET announcements A1 full', { method: 'GET', path: '/rest/v1/announcements', search: `?select=*&id=eq.${ID.ANN_OPEN_A}`, token: SR, headers: { apikey: SR } });
    await step('SERVICE_ROLE GET profiles A full', { method: 'GET', path: '/rest/v1/profiles', search: `?select=*&id=eq.${ID.A}`, token: SR, headers: { apikey: SR } });
  } else {
    console.warn('SERVICE_ROLE_KEY lipsește: pașii service_role sunt săriți');
  }
  // Ultimul: tokenul de push (după el, orice INSERT ar încerca un push către exp.host)
  await step('RPC claim_push_token as driver_a', { method: 'POST', path: '/rest/v1/rpc/claim_push_token', token: A,
    body: { p_token: `ExponentPushToken[gate-${phase}]`, p_platform: 'android', p_device_token: null, p_previous_token: null, p_app_build: '1.0.8' } });

  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ phase, api: API_URL, shapes: n, results }, null, 1));
  console.log(`replay ${phase}: ${n} cereri din forme + ${Object.keys(results).length - n} pași scriptați → ${outDir}/results.json`);
}

// ── Faza compare ───────────────────────────────────────────────────────────────────────────────
function compare() {
  const before = JSON.parse(readFileSync(join(args[1], 'results.json'), 'utf8')).results;
  const after = JSON.parse(readFileSync(join(args[2], 'results.json'), 'utf8')).results;
  const fails = [];
  const masked = [];
  const unmasked = [];
  let stop = false;
  let pass = 0;
  for (const [key, b] of Object.entries(before)) {
    const a = after[key];
    if (!a) { fails.push(`${key}\n    lipsește în „after”`); continue; }
    const diffs = [];
    if (a.status !== b.status) diffs.push(`status ${b.status} → ${a.status}`);
    if ((a.contentRange ?? null) !== (b.contentRange ?? null) && b.status < 300) diffs.push(`content-range ${b.contentRange} → ${a.contentRange}`);
    if ((a.rows ?? null) !== (b.rows ?? null)) diffs.push(`rows ${b.rows} → ${a.rows}`);
    const kb = Object.keys(b.keys ?? {}), ka = Object.keys(a.keys ?? {});
    const missing = kb.filter((k) => !ka.includes(k)), extra = ka.filter((k) => !kb.includes(k));
    if (missing.length) diffs.push(`chei dispărute: ${missing.join(', ')}`);
    if (extra.length) diffs.push(`chei noi: ${extra.join(', ')}`);
    if (a.error && b.error && (a.error.code ?? '') !== (b.error.code ?? '')) diffs.push(`cod eroare ${b.error.code} → ${a.error.code}`);
    const msg = `${a.error?.message ?? ''} ${a.error?.code ?? ''}`;
    if (/PGRST20[01]|relationship|profiles!|Could not find/i.test(msg) && !(b.error && /PGRST20[01]|relationship/i.test(`${b.error.message} ${b.error.code}`))) {
      stop = true;
      diffs.push(`STOP: embed-ul nu rezolvă prin view → ${msg.slice(0, 200)}`);
    }
    if (diffs.length) fails.push(`${key}\n    ${diffs.join('\n    ')}`);
    else pass++;
    for (const k of kb) {
      const vb = b.keys[k], va = a.keys?.[k];
      if (!va) continue;
      if (vb.nonnull > 0 && va.nonnull === 0) masked.push(`${key} :: ${k}`);
      if (vb.nonnull === 0 && va.nonnull > 0) unmasked.push(`${key} :: ${k}`);
    }
  }
  console.log(`\n=== POARTA 4.1: ${pass} PASS, ${fails.length} FAIL${stop ? ', STOP (hint prin view)' : ''} ===`);
  if (fails.length) { console.log('\n--- FAIL ---'); for (const f of fails) console.log('  ' + f); }
  console.log(`\n--- informativ: chei devenite NULL după migrare (${masked.length}) ---`);
  for (const m of masked) console.log('  ' + m);
  if (unmasked.length) { console.log(`\n--- informativ: chei devenite ne-NULL (${unmasked.length}) ---`); for (const m of unmasked) console.log('  ' + m); }
  process.exit(stop ? 2 : fails.length ? 1 : 0);
}

if (mode === 'run') run().catch((e) => { console.error(e); process.exit(1); });
else if (mode === 'compare' && args[1] && args[2]) compare();
else { console.error('usage: replay-1_0_8.mjs run --out <dir> [--phase before|after] | compare <before> <after>'); process.exit(1); }
