#!/usr/bin/env node
// Generează migrarea-baseline a schemei din catalogul producției (pasul 0.3-bis din PLAN_1.1_FIX,
// 29 oct 2026). Intrare: ieșirea JSON a `npx supabase db query --linked -f supabase/baseline/catalog.sql`.
// Ieșire: un singur fișier SQL care recreează, pe un Postgres Supabase gol (`supabase start` în CI),
// schemele `public` + `app`, politicile Storage, bucket-ul, publicația Realtime și joburile cron —
// exact ca în producție. Fidelitatea se verifică în CI cu supabase/baseline/parity.sql.
//
//   node scripts/baseline-generate.mjs <catalog.json> <out.sql>
//
// De ce nu `supabase db dump`: cere Docker, care nu există pe mașina de dezvoltare. Ordinea DDL-ului
// urmează pg_dump: extensii → scheme → drepturi implicite → secvențe → tabele (coloane, NOT NULL,
// DEFAULT, coloane generate/identity) → PK/UNIQUE/CHECK → funcții (check_function_bodies = off, ca
// pg_dump, deci ordinea dintre ele nu contează) → view-uri → FK-uri → indexuri → triggere → RLS →
// politici → drepturi → REPLICA IDENTITY → publicație → bucket → cron.

import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node scripts/baseline-generate.mjs <catalog.json> <out.sql>');
  process.exit(2);
}

const raw = readFileSync(inPath, 'utf8');
const json = JSON.parse(raw.slice(raw.indexOf('{')));
const rows = json.rows;
const by = (section) => rows.filter((r) => r.section === section).map((r) => r.payload);

const ROLES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];
const PRIV = {
  a: 'INSERT', r: 'SELECT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE', x: 'REFERENCES', t: 'TRIGGER', m: 'MAINTAIN',
  X: 'EXECUTE', U: 'USAGE', C: 'CREATE',
};
const ALL_TABLE = 'arwdDxtm';
const ALL_SEQ = 'rwU';

const q = (ident) => (/^[a-z_][a-z0-9_]*$/.test(ident) ? ident : `"${ident.replace(/"/g, '""')}"`);
const qn = (schema, name) => `${q(schema)}.${q(name)}`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** aclitem text → { grantee, privs } (grantee '' = PUBLIC; `*` = cu opțiune de grant, ignorată). */
function parseAcl(items) {
  return (items ?? []).map((item) => {
    const m = /^(?:"((?:[^"]|"")*)"|([^=]*))=([A-Za-z*]*)\/(.*)$/.exec(item);
    if (!m) throw new Error(`aclitem neînțeles: ${item}`);
    const grantee = m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2];
    return { grantee: grantee === '' ? 'PUBLIC' : grantee, privs: m[3].replace(/\*/g, ''), grantor: m[4] };
  });
}

function privList(privs, all) {
  if (all && [...all].every((p) => privs.includes(p))) return 'ALL';
  return [...privs].map((p) => PRIV[p] ?? (() => { throw new Error(`privilegiu necunoscut: ${p}`); })()).join(', ');
}

const out = [];
const emit = (...lines) => out.push(...lines);
const section = (title) => emit('', `-- ─── ${title} ${'─'.repeat(Math.max(0, 90 - title.length))}`, '');

const tables = by('table');
const views = by('view');
const sequences = by('sequence');
const functions = by('function');
const constraints = by('constraint');
const indexes = by('index');
const triggers = by('trigger');
const policies = by('policy');
const owner = 'postgres';

emit(
  '-- Baseline-ul schemei de producție TruckSOS (pasul 0.3-bis din PLAN_1.1_FIX, 29 oct 2026).',
  '-- Generat din catalogul bazei de date cu scripts/baseline-generate.mjs (din supabase/baseline/catalog.sql),',
  '-- după aplicarea migrării 20261031000200. Înlocuiește cele 92 de migrări istorice (iulie–octombrie 2026),',
  '-- mutate în supabase/migrations-archive/: schema inițială (faza 1, iulie) fusese creată din Studio și',
  '-- nu exista ca migrare, deci istoricul nu putea fi aplicat de la zero (CI run 40853794809).',
  '--',
  '-- NU se aplică pe producție: acolo e marcat `applied` prin `migration repair` (schema există deja).',
  '-- Rulează doar pe un Postgres Supabase gol (`supabase start` în CI); supabase/baseline/parity.sql',
  '-- verifică acolo că rezultatul e identic cu producția (parity.expected.txt).',
  '--',
  `-- Conținut: ${tables.length} tabele, ${views.length} view-uri, ${sequences.length} secvențe, ${functions.length} funcții, ${constraints.length} constrângeri,`,
  `-- ${indexes.length} indexuri, ${triggers.length} triggere, ${policies.length} politici (public + storage), ${by('bucket').length} bucket, ${by('publication_table').length} tabele în publicația Realtime, ${by('cron').length} joburi cron.`,
  '',
  '-- Ca pg_dump: corpurile funcțiilor nu se validează la creare (pot referi obiecte create mai jos).',
  'SET check_function_bodies = off;',
);

// ── Extensii ────────────────────────────────────────────────────────────────────────────────────
section('Extensii');
emit('-- pg_graphql nu e instalat în producție (checklist 14); `supabase start` îl pornește implicit, iar CI-ul îl',
  '-- scoate într-un pas separat, ca supabase_admin (nu e o migrare: e o setare de platformă).');
for (const r of rows.filter((r) => r.section === 'extension')) {
  const name = r.key;
  if (name === 'plpgsql') continue;
  const schema = r.payload.schema;
  emit(`CREATE EXTENSION IF NOT EXISTS ${q(name)}${schema === 'pg_catalog' ? '' : ` WITH SCHEMA ${q(schema)}`};`);
}

// ── Scheme ──────────────────────────────────────────────────────────────────────────────────────
section('Scheme');
for (const r of rows.filter((r) => r.section === 'schema')) {
  if (r.key === 'public') {
    // Schema public e a platformei (owner pg_database_owner); fixăm doar ce verifică paritatea: fără CREATE pentru API.
    emit('REVOKE CREATE ON SCHEMA public FROM anon, authenticated, service_role;', 'GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;');
    continue;
  }
  emit(`CREATE SCHEMA IF NOT EXISTS ${q(r.key)} AUTHORIZATION ${q(r.payload.owner)};`);
  emit(`REVOKE ALL ON SCHEMA ${q(r.key)} FROM ${ROLES.join(', ')};`);
  for (const a of parseAcl(r.payload.acl)) {
    if (a.grantee === r.payload.owner) continue;
    emit(`GRANT ${privList(a.privs)} ON SCHEMA ${q(r.key)} TO ${a.grantee};`);
  }
}

// ── Drepturi implicite (ALTER DEFAULT PRIVILEGES pentru rolul postgres) ─────────────────────────
section('Drepturi implicite pentru obiectele create de postgres');
const OBJ = { r: 'TABLES', S: 'SEQUENCES', f: 'FUNCTIONS', T: 'TYPES' };
const defacl = by('default_acl');
emit('-- Fiecare combinație (schemă, tip) e adusă întâi la valoarea implicită a Postgres, apoi la cea din producție.');
for (const schema of ['', 'public', 'app', 'extensions', 'storage']) {
  for (const t of ['r', 'S', 'f']) {
    const scope = schema === '' ? '' : ` IN SCHEMA ${q(schema)}`;
    const head = `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner}${scope}`;
    emit(`${head} REVOKE ALL ON ${OBJ[t]} FROM anon, authenticated, service_role;`);
    const row = defacl.find((d) => d.schema === schema && d.objtype === t);
    const acl = parseAcl(row?.acl);
    if (t === 'f') {
      // Implicitul Postgres dă EXECUTE lui PUBLIC; producția îl revocă doar unde rândul din catalog nu-l mai are.
      // Fără rând în producție nu se emite nimic pentru PUBLIC: rândurile pe schemă se adună la cel global, iar un
      // GRANT explicit ar crea un rând nou (în app funcțiile noi ar fi executabile de PUBLIC doar în CI).
      if (row && acl.some((a) => a.grantee === 'PUBLIC')) emit(`${head} GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`);
      else if (row) emit(`${head} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`);
    }
    for (const a of acl) {
      if (a.grantee === owner || a.grantee === 'PUBLIC') continue;
      emit(`${head} GRANT ${privList(a.privs, t === 'r' ? ALL_TABLE : t === 'S' ? ALL_SEQ : null)} ON ${OBJ[t]} TO ${a.grantee};`);
    }
  }
}
for (const d of defacl) {
  if (!['', 'public', 'app', 'extensions', 'storage'].includes(d.schema) || !['r', 'S', 'f'].includes(d.objtype)) {
    throw new Error(`rând de drepturi implicite neacoperit: ${JSON.stringify(d)}`);
  }
}

// ── Secvențe (doar cele „serial”; cele identity se creează cu tabelul) ──────────────────────────
section('Secvențe');
const BIGINT_MAX = 9223372036854775807n;
for (const s of sequences) {
  if (s.owned_by?.deptype === 'i') continue;
  const max = BigInt(Math.round(s.max)) >= BIGINT_MAX - 2000n ? 'NO MAXVALUE' : `MAXVALUE ${s.max}`;
  emit(`CREATE SEQUENCE ${qn(s.schema, s.name)} AS ${s.type} START WITH ${s.start} INCREMENT BY ${s.increment} MINVALUE ${s.min} ${max} CACHE ${s.cache} ${s.cycle ? 'CYCLE' : 'NO CYCLE'};`);
}

// ── Tabele ──────────────────────────────────────────────────────────────────────────────────────
section('Tabele');
const sortedTables = [...tables].sort((a, b) => (a.schema + '.' + a.name).localeCompare(b.schema + '.' + b.name));
for (const t of sortedTables) {
  const cols = t.columns.map((c) => {
    let line = `  ${q(c.name)} ${c.type}`;
    if (c.collation) line += ` COLLATE ${c.collation}`;
    if (c.generated === 's') line += ` GENERATED ALWAYS AS (${c.default}) STORED`;
    else if (c.identity === 'a') line += ' GENERATED ALWAYS AS IDENTITY';
    else if (c.identity === 'd') line += ' GENERATED BY DEFAULT AS IDENTITY';
    else if (c.default !== null) line += ` DEFAULT ${c.default}`;
    if (c.notnull) line += ' NOT NULL';
    return line;
  });
  const withOpts = t.options?.length ? ` WITH (${t.options.join(', ')})` : '';
  emit(`CREATE TABLE ${qn(t.schema, t.name)} (`, cols.join(',\n'), `)${withOpts};`);
  if (t.comment) emit(`COMMENT ON TABLE ${qn(t.schema, t.name)} IS ${lit(t.comment)};`);
  for (const c of t.columns) if (c.comment) emit(`COMMENT ON COLUMN ${qn(t.schema, t.name)}.${q(c.name)} IS ${lit(c.comment)};`);
  emit('');
}
for (const s of sequences) {
  if (s.owned_by?.deptype === 'a') {
    const [sch, tbl] = s.owned_by.table.split('.');
    emit(`ALTER SEQUENCE ${qn(s.schema, s.name)} OWNED BY ${qn(sch, tbl)}.${q(s.owned_by.column)};`);
  }
}

// ── Constrângeri PK / UNIQUE / CHECK ────────────────────────────────────────────────────────────
section('Constrângeri (cheie primară, unicitate, CHECK)');
const conOrder = { p: 0, u: 1, c: 2, x: 3, f: 4 };
const sortedCons = [...constraints].sort((a, b) =>
  (a.schema + '.' + a.table).localeCompare(b.schema + '.' + b.table) || conOrder[a.type] - conOrder[b.type] || a.name.localeCompare(b.name));
for (const k of sortedCons) {
  if (k.type === 'f') continue;
  emit(`ALTER TABLE ONLY ${qn(k.schema, k.table)} ADD CONSTRAINT ${q(k.name)} ${k.definition};`);
  if (k.comment) emit(`COMMENT ON CONSTRAINT ${q(k.name)} ON ${qn(k.schema, k.table)} IS ${lit(k.comment)};`);
}

// View-urile se creează ÎNAINTEA funcțiilor: două RPC-uri (guest_search_*) returnează SETOF <view>, iar tipul
// returnat se rezolvă la CREATE FUNCTION chiar cu check_function_bodies = off. Plasa de siguranță: niciun view
// nu are voie să apeleze o funcție din public/app (atunci ordinea ar trebui inversată pentru acel view).
const fnNames = new Set(functions.map((f) => `${f.schema}.${f.name}(`));
for (const v of views) {
  for (const name of fnNames) if (v.definition.includes(name)) throw new Error(`view-ul ${v.name} apelează ${name}) — ordinea view-uri → funcții nu mai e valabilă`);
}
// ── View-uri ────────────────────────────────────────────────────────────────────────────────────
section('View-uri');
for (const v of [...views].sort((a, b) => a.name.localeCompare(b.name))) {
  const opts = v.options?.length ? ` WITH (${v.options.join(', ')})` : '';
  emit(`CREATE VIEW ${qn(v.schema, v.name)}${opts} AS`, v.definition.replace(/;\s*$/, '') + ';');
  if (v.comment) emit(`COMMENT ON VIEW ${qn(v.schema, v.name)} IS ${lit(v.comment)};`);
  for (const c of v.columns) if (c.comment) emit(`COMMENT ON COLUMN ${qn(v.schema, v.name)}.${q(c.name)} IS ${lit(c.comment)};`);
  emit('');
}

// ── Funcții ─────────────────────────────────────────────────────────────────────────────────────
section('Funcții (public + app; trigger-ele și RPC-urile)');
const sortedFns = [...functions].sort((a, b) => (a.schema + '.' + a.name + a.identity_args).localeCompare(b.schema + '.' + b.name + b.identity_args));
for (const f of sortedFns) {
  if (f.owner !== owner) throw new Error(`funcție cu alt owner: ${f.schema}.${f.name} (${f.owner})`);
  emit(f.definition.replace(/\s+$/, '') + ';');
  if (f.comment) emit(`COMMENT ON FUNCTION ${qn(f.schema, f.name)}(${f.identity_args}) IS ${lit(f.comment)};`);
  emit('');
}

// ── Chei străine ────────────────────────────────────────────────────────────────────────────────
section('Chei străine');
for (const k of sortedCons) {
  if (k.type !== 'f') continue;
  emit(`ALTER TABLE ONLY ${qn(k.schema, k.table)} ADD CONSTRAINT ${q(k.name)} ${k.definition};`);
}

// ── Indexuri ────────────────────────────────────────────────────────────────────────────────────
section('Indexuri (fără cele ale constrângerilor)');
for (const i of [...indexes].sort((a, b) => (a.schema + '.' + a.name).localeCompare(b.schema + '.' + b.name))) {
  emit(`${i.definition};`);
  if (i.comment) emit(`COMMENT ON INDEX ${qn(i.schema, i.name)} IS ${lit(i.comment)};`);
}

// ── Triggere ────────────────────────────────────────────────────────────────────────────────────
section('Triggere (public, app, auth.users)');
for (const g of [...triggers].sort((a, b) => (a.schema + '.' + a.table + '.' + a.name).localeCompare(b.schema + '.' + b.table + '.' + b.name))) {
  emit(`${g.definition};`);
  const tbl = qn(g.schema, g.table);
  if (g.enabled === 'D') emit(`ALTER TABLE ${tbl} DISABLE TRIGGER ${q(g.name)};`);
  else if (g.enabled === 'R') emit(`ALTER TABLE ${tbl} ENABLE REPLICA TRIGGER ${q(g.name)};`);
  else if (g.enabled === 'A') emit(`ALTER TABLE ${tbl} ENABLE ALWAYS TRIGGER ${q(g.name)};`);
}

// ── RLS ─────────────────────────────────────────────────────────────────────────────────────────
section('Row Level Security');
for (const t of sortedTables) {
  if (t.rls) emit(`ALTER TABLE ${qn(t.schema, t.name)} ENABLE ROW LEVEL SECURITY;`);
  if (t.force_rls) emit(`ALTER TABLE ${qn(t.schema, t.name)} FORCE ROW LEVEL SECURITY;`);
}

// ── Politici ────────────────────────────────────────────────────────────────────────────────────
section('Politici (public, app, storage.objects)');
for (const p of [...policies].sort((a, b) => (a.schema + '.' + a.table + '.' + a.name).localeCompare(b.schema + '.' + b.table + '.' + b.name))) {
  let s = `CREATE POLICY ${q(p.name)} ON ${qn(p.schema, p.table)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map((r) => (r === 'public' ? 'public' : q(r))).join(', ')}`;
  if (p.qual !== null) s += `\n  USING (${p.qual})`;
  if (p.with_check !== null) s += `\n  WITH CHECK (${p.with_check})`;
  emit(`${s};`);
}

// ── Drepturi pe tabele, view-uri, secvențe, funcții ─────────────────────────────────────────────
section('Drepturi (exact ca în producție: întâi REVOKE ALL, apoi GRANT-urile din catalog)');
const relGrants = (schema, name, acl, kind) => {
  const target = `${kind} ${qn(schema, name)}`;
  emit(`REVOKE ALL ON ${target} FROM ${ROLES.join(', ')};`);
  for (const a of parseAcl(acl)) {
    if (a.grantee === owner) continue;
    emit(`GRANT ${privList(a.privs, kind === 'SEQUENCE' ? ALL_SEQ : ALL_TABLE)} ON ${target} TO ${a.grantee};`);
  }
};
for (const t of sortedTables) {
  relGrants(t.schema, t.name, t.acl, 'TABLE');
  // Drepturi pe coloane (de ex. anon citește doar câteva coloane din profiles)
  const perGrantee = new Map();
  for (const c of t.columns) {
    for (const a of parseAcl(c.acl)) {
      if (a.grantee === owner) continue;
      for (const p of a.privs) {
        const k = `${a.grantee}|${p}`;
        if (!perGrantee.has(k)) perGrantee.set(k, []);
        perGrantee.get(k).push(q(c.name));
      }
    }
  }
  for (const [k, cols] of perGrantee) {
    const [grantee, p] = k.split('|');
    emit(`GRANT ${PRIV[p]} (${cols.join(', ')}) ON TABLE ${qn(t.schema, t.name)} TO ${grantee};`);
  }
}
for (const v of views) relGrants(v.schema, v.name, v.acl, 'TABLE');
for (const s of sequences) relGrants(s.schema, s.name, s.acl, 'SEQUENCE');
emit('');
for (const f of sortedFns) {
  const sig = `FUNCTION ${qn(f.schema, f.name)}(${f.identity_args})`;
  emit(`REVOKE ALL ON ${sig} FROM ${ROLES.join(', ')};`);
  for (const a of parseAcl(f.acl)) {
    if (a.grantee === owner) continue;
    if (a.privs !== 'X') throw new Error(`privilegiu neașteptat pe funcție: ${f.name} ${a.privs}`);
    emit(`GRANT EXECUTE ON ${sig} TO ${a.grantee};`);
  }
}
emit('', '-- Funcții din extensii cu drepturi date explicit (unaccent, pentru căutarea fără diacritice)');
for (const f of by('extension_function_acl')) {
  const sig = `FUNCTION ${qn(f.schema, f.name)}(${f.identity_args})`;
  const grantees = parseAcl(f.acl).filter((a) => ['PUBLIC', 'anon', 'authenticated', 'service_role'].includes(a.grantee)).map((a) => a.grantee);
  if (grantees.length) emit(`GRANT EXECUTE ON ${sig} TO ${grantees.join(', ')};`);
}

// ── REPLICA IDENTITY + publicația Realtime ──────────────────────────────────────────────────────
section('Realtime: REPLICA IDENTITY și publicația supabase_realtime');
for (const t of sortedTables) {
  if (t.replident === 'f') emit(`ALTER TABLE ${qn(t.schema, t.name)} REPLICA IDENTITY FULL;`);
  else if (t.replident === 'n') emit(`ALTER TABLE ${qn(t.schema, t.name)} REPLICA IDENTITY NOTHING;`);
  else if (t.replident === 'i') throw new Error(`REPLICA IDENTITY USING INDEX neacoperit: ${t.name}`);
}
const pubTables = by('publication_table');
emit('DO $$', 'BEGIN',
  "  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN",
  '    CREATE PUBLICATION supabase_realtime;', '  END IF;',
  "  IF (SELECT puballtables FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN",
  "    RAISE EXCEPTION 'publicația supabase_realtime e FOR ALL TABLES; producția are doar tabelele listate';",
  '  END IF;');
for (const p of pubTables) {
  emit(`  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = ${lit(p.schema)} AND tablename = ${lit(p.table)}) THEN`,
    `    ALTER PUBLICATION supabase_realtime ADD TABLE ${qn(p.schema, p.table)};`, '  END IF;');
}
emit('END $$;');

// ── Bucket ──────────────────────────────────────────────────────────────────────────────────────
section('Storage: bucket-ul photos');
for (const b of by('bucket')) {
  const mimes = b.allowed_mime_types ? `ARRAY[${b.allowed_mime_types.map(lit).join(', ')}]::text[]` : 'NULL';
  emit(`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)`,
    `VALUES (${lit(b.id)}, ${lit(b.name)}, ${b.public}, ${b.file_size_limit ?? 'NULL'}, ${mimes})`,
    'ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;');
}

// ── Cron ────────────────────────────────────────────────────────────────────────────────────────
section('pg_cron: joburile de curățare');
for (const j of by('cron')) {
  if (j.command.includes('$cron$')) throw new Error(`comanda cron conține $cron$: ${j.name}`);
  emit(`SELECT cron.schedule(${lit(j.name)}, ${lit(j.schedule)}, $cron$${j.command}$cron$);`);
  if (!j.active) emit(`UPDATE cron.job SET active = false WHERE jobname = ${lit(j.name)};`);
}

emit('', 'RESET check_function_bodies;', '');
writeFileSync(outPath, out.join('\n').replace(/\r\n/g, '\n'), { encoding: 'utf8' });
console.log(`baseline: ${out.length} rânduri → ${outPath}`);
