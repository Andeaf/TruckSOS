#!/usr/bin/env node
// Pachetele de aplicare pe producție (supabase/gate/apply/).
//
// Pe producție o migrare nu se aplică singură, ci printr-un pachet de fișiere SQL rulate pe rând:
//   00-precheck.sql                 starea de pornire (doar SELECT; opțional)
//   01-fingerprint-before.sql       amprenta catalogului înainte
//   02-rehearsal.sql                repetiția: BEGIN; migrările pachetului; diferența de amprentă; ROLLBACK
//   02b-probe-as-client.sql         proba ca rolul clientului: BEGIN; migrările; apeluri ca `authenticated`; ROLLBACK (opțional)
//   03-fingerprint-after-rollback.sql   amprenta după repetiție (trebuie identică cu 01)
//   04-apply.sql                    aplicarea: BEGIN; migrările; COMMIT
//   05-post-apply-check.sql         verificările de după aplicare (doar SELECT)
//   06-rollback-emergency.sql       rollback-ul de urgență: BEGIN; rollback-urile în ordine inversă; COMMIT
// Fișierele se GENEREAZĂ aici din supabase/migrations/, supabase/rollback/, supabase/gate/fingerprint.sql și din părțile
// scrise de mână ale fiecărui pachet (supabase/gate/apply/<pachet>/: 00-precheck.sql, 02b-probe.sql, 05-checks.sql,
// expect.json). Generarea e deterministă și scrie mereu cu LF: un fișier SQL scos din git pe Windows cu CRLF ar
// schimba corpul funcțiilor (deci hash-ul lor din amprentă). De aceea în repo stau sursele și sumele
// (supabase/gate/apply/SHA256SUMS), nu fișierele generate: `check` (în CI) refuză sume care nu mai corespund surselor,
// iar jobul `prod-order` rulează exact fișierele cu acele sume, în ordinea de producție (scripts/production-order.mjs).
//
//   node scripts/apply-packages.mjs build <pachet> --out <dir>   scrie fișierele unui pachet direct în <dir>
//   node scripts/apply-packages.mjs build --all --out <dir>      scrie toate pachetele în <dir>/<pachet>/
//   node scripts/apply-packages.mjs sums                         rescrie supabase/gate/apply/SHA256SUMS (după o schimbare de surse)
//   node scripts/apply-packages.mjs verify <pachet> <fișier> <ieșire.json>
//        compară ieșirea de pe producție a unui fișier 00 / 02b / 05 (JSON-ul scris de `supabase db query`) cu
//        așteptările din expect.json, coloana de producție.
// Verificarea fără bază (`node scripts/production-order.mjs check`) folosește funcțiile exportate de aici.
//
// Doar module încorporate: jobul `prod-order` nu rulează `npm ci`.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY_DIR = join(ROOT, 'supabase', 'gate', 'apply');
const SUMS_FILE = join(APPLY_DIR, 'SHA256SUMS');

/** Fișierele unui pachet ale căror rânduri (k, v) se compară cu expect.json. */
export const ROW_FILES = ['00-precheck', '02b-probe-as-client', '05-post-apply-check'];

const readLf = (path) => readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const short = (text) => sha256(text).slice(0, 16);

/** Citește supabase/gate/apply/packages.json → lista pachetelor, în ordinea aplicării. Aruncă la formă greșită. */
export function loadPackages() {
  const raw = JSON.parse(readLf(join(APPLY_DIR, 'packages.json')));
  if (!Array.isArray(raw.packages) || raw.packages.length === 0) throw new Error('packages.json: lipsește lista `packages`');
  const seen = new Set();
  return raw.packages.map((p) => {
    if (typeof p.id !== 'string' || !/^[a-z0-9-]+$/.test(p.id)) throw new Error(`packages.json: id invalid: ${JSON.stringify(p.id)}`);
    if (seen.has(p.id)) throw new Error(`packages.json: pachetul ${p.id} apare de două ori`);
    seen.add(p.id);
    if (typeof p.title !== 'string' || p.title.trim() === '') throw new Error(`packages.json: ${p.id} nu are titlu`);
    if (!Array.isArray(p.migrations) || p.migrations.length === 0) throw new Error(`packages.json: ${p.id} nu are migrări`);
    for (const m of p.migrations) {
      if (typeof m !== 'string' || !/^\d{14}_[a-z0-9_]+$/.test(m)) throw new Error(`packages.json: ${p.id}: „${m}” nu e un nume de migrare (fără .sql)`);
    }
    return { id: p.id, title: p.title, migrations: p.migrations, dir: join(APPLY_DIR, p.id) };
  });
}

/** Un fișier SQL care intră într-o tranzacție a pachetului nu are comenzi psql și nu își închide singur tranzacția. */
function assertTransactional(name, sql) {
  if (/^\\/m.test(sql)) throw new Error(`${name}: comandă psql în fișier`);
  if (/CONCURRENTLY/i.test(sql)) throw new Error(`${name}: CONCURRENTLY nu merge într-o tranzacție`);
  if (/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;/im.test(sql)) throw new Error(`${name}: BEGIN / COMMIT / ROLLBACK la nivel înalt`);
}

const banner = (text) => `\n-- ═══════════════════════ ${text} ═══════════════════════\n`;
const SET_LOCAL = "SET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';\n";
const DIFF_SELECT = `SELECT d.side, d.line FROM (
  SELECT '-' AS side, a.line FROM (SELECT line FROM fp_before EXCEPT SELECT line FROM fp_after) a
  UNION ALL SELECT '+' AS side, b.line FROM (SELECT line FROM fp_after EXCEPT SELECT line FROM fp_before) b
  UNION ALL SELECT '=' AS side, 'total | randuri inainte/dupa | ' || (SELECT count(*) FROM fp_before)::text || '/' || (SELECT count(*) FROM fp_after)::text
) d ORDER BY d.line COLLATE "C", d.side;\n`;

/**
 * Generează fișierele unui pachet. Întoarce { files: Map<nume, conținut>, sources: [{ path, sha }] }.
 * Conținutul e determinist (fără dată) și are doar LF.
 */
export function buildPackage(pkg) {
  const source = (rel) => {
    const path = join(ROOT, ...rel.split('/'));
    if (!existsSync(path)) throw new Error(`${pkg.id}: lipsește ${rel}`);
    return { path: rel, sql: readLf(path) };
  };
  const optional = (rel) => (existsSync(join(ROOT, ...rel.split('/'))) ? source(rel) : null);

  const fingerprintSource = source('supabase/gate/fingerprint.sql');
  const fingerprint = fingerprintSource.sql.trim().replace(/;\s*$/, '');
  const migrations = pkg.migrations.map((m) => source(`supabase/migrations/${m}.sql`));
  const rollbacks = [...pkg.migrations].reverse().map((m) => source(`supabase/rollback/${m}.sql`));
  const base = `supabase/gate/apply/${pkg.id}`;
  const precheck = optional(`${base}/00-precheck.sql`);
  const probe = optional(`${base}/02b-probe.sql`);
  const checks = source(`${base}/05-checks.sql`);
  for (const f of [...migrations, ...rollbacks, checks, ...(precheck ? [precheck] : []), ...(probe ? [probe] : [])]) assertTransactional(f.path, f.sql);

  const header = (what, extra = []) =>
    `-- ${pkg.title} — ${what}.\n` +
    `-- Generat de scripts/apply-packages.mjs (pachetul „${pkg.id}”) din:\n` +
    [...migrations, ...rollbacks, fingerprintSource, ...extra].map((f) => `--   ${f.path}  sha256:${short(f.sql)}`).join('\n') +
    '\n-- Pe producție: npx supabase db query --linked -f <acest fișier> > <ieșire .out>\n\n';
  const fpTable = (name) => `CREATE TEMP TABLE ${name} ON COMMIT DROP AS\n${fingerprint};\n`;
  const applied = migrations.map((m) => banner(`migrarea ${m.path.split('/').pop().replace(/\.sql$/, '')}`) + m.sql + '\n').join('');
  const versions = [...pkg.migrations].reverse().map((m) => m.slice(0, 14)).join(' ');

  const files = new Map();
  if (precheck) files.set('00-precheck.sql', header('starea de pornire (doar SELECT)', [precheck]) + precheck.sql.trim() + '\n');
  files.set('01-fingerprint-before.sql', header('amprenta catalogului ÎNAINTE de repetiție (doar SELECT)') + fingerprint + ';\n');
  files.set(
    '02-rehearsal.sql',
    header('REPETIȚIE (BEGIN … ROLLBACK): nimic nu rămâne în bază; rezultatul = diferența de catalog pe care AR face-o aplicarea') +
      'BEGIN;\n' + SET_LOCAL + banner('amprenta înainte (în tranzacție)') + fpTable('fp_before') + applied +
      banner('amprenta după, diferența, ROLLBACK') + fpTable('fp_after') + DIFF_SELECT + 'ROLLBACK;\n',
  );
  if (probe) {
    files.set(
      '02b-probe-as-client.sql',
      header('PROBĂ CA ROLUL CLIENTULUI (BEGIN … ROLLBACK): migrările, apoi apeluri ca `authenticated`; nimic nu rămâne în bază', [probe]) +
        'BEGIN;\n' + SET_LOCAL + applied + banner('proba') + probe.sql.trim() + '\nROLLBACK;\n',
    );
  }
  files.set('03-fingerprint-after-rollback.sql', header('amprenta catalogului DUPĂ repetiție (doar SELECT; trebuie identică cu 01)') + fingerprint + ';\n');
  files.set(
    '04-apply.sql',
    header('APLICARE (BEGIN … COMMIT), doar cu aprobarea explicită dată în acel moment') +
      'BEGIN;\n' + SET_LOCAL + applied + banner('COMMIT') + `SELECT '${pkg.id}: aplicat la ' || now()::text AS rezultat;\nCOMMIT;\n`,
  );
  files.set('05-post-apply-check.sql', header('verificări DUPĂ aplicare (doar SELECT)', [checks]) + checks.sql.trim() + '\n');
  files.set(
    '06-rollback-emergency.sql',
    header(`ROLLBACK DE URGENȚĂ (BEGIN … COMMIT), ordinea inversă; apoi: npx supabase migration repair --linked --status reverted ${versions}`) +
      'BEGIN;\n' + SET_LOCAL + rollbacks.map((r) => banner(`rollback ${r.path.split('/').pop().replace(/\.sql$/, '')}`) + r.sql + '\n').join('') +
      banner('COMMIT') + 'COMMIT;\n',
  );
  for (const [name, content] of files) {
    if (content.includes('\r')) throw new Error(`${pkg.id}/${name}: conține CR`);
  }
  return {
    files,
    sources: [...migrations, ...rollbacks, fingerprintSource, checks, ...(precheck ? [precheck] : []), ...(probe ? [probe] : [])].map((f) => ({ path: f.path, sha: short(f.sql) })),
  };
}

/** Textul SHA256SUMS pentru pachetele date (o linie per fișier generat, în ordinea pachetelor). */
export function sumsText(packages) {
  const lines = [];
  for (const pkg of packages) {
    const { files } = buildPackage(pkg);
    for (const name of [...files.keys()].sort()) lines.push(`${sha256(files.get(name))}  ${pkg.id}/${name}`);
  }
  return `${lines.join('\n')}\n`;
}

// ── așteptările (expect.json) ────────────────────────────────────────────────────────────────────────────────

/**
 * expect.json al unui pachet: { "<fișier>": [ rând, … ] } pentru fișierele din ROW_FILES pe care pachetul le are.
 * Un rând e exact unul dintre:
 *   { "k": "<eticheta>", "v": "<valoarea>" }                     aceeași valoare pe producție și în CI;
 *   { "k": "<eticheta>", "info": "<de ce>" }                     informativ: depinde de date, se citește, nu se compară;
 *   { "k": "<eticheta>", "why": "<de ce>", "prod": "<pe producție>", "ci": "<în CI>" }
 *       NERULABIL ÎN CI: valoarea de pe producție depinde de ceva ce există doar acolo (un secret din Vault, istoricul
 *       migrărilor scris de `migration repair`, rulările cron, versiunea platformei). În CI se verifică doar valoarea
 *       locală („ci”; fără ea, orice valoare), iar rândul intră în lista „nerulabil în CI”. „prod” lipsă = pe producție
 *       valoarea se citește, nu se compară.
 */
export function loadExpect(pkg) {
  const path = join(pkg.dir, 'expect.json');
  if (!existsSync(path)) throw new Error(`${pkg.id}: lipsește expect.json`);
  const raw = JSON.parse(readLf(path));
  const problems = [];
  for (const [file, rows] of Object.entries(raw)) {
    if (!ROW_FILES.includes(file)) problems.push(`${pkg.id}/expect.json: cheie necunoscută „${file}”`);
    if (!Array.isArray(rows) || rows.length === 0) {
      problems.push(`${pkg.id}/expect.json: „${file}” nu are rânduri`);
      continue;
    }
    rows.forEach((r, i) => {
      const kinds = ['v' in r, 'info' in r, 'why' in r].filter(Boolean).length;
      if (typeof r.k !== 'string' || r.k === '') problems.push(`${pkg.id}/expect.json: ${file}[${i}] nu are eticheta „k”`);
      if (kinds !== 1) problems.push(`${pkg.id}/expect.json: ${file}[${i}] trebuie să aibă exact una dintre „v”, „info”, „why”`);
      if (('prod' in r || 'ci' in r) && !('why' in r)) problems.push(`${pkg.id}/expect.json: ${file}[${i}] are „prod” / „ci” fără „why”`);
      if ('why' in r && r.why === '') problems.push(`${pkg.id}/expect.json: ${file}[${i}] are „why” gol`);
      for (const key of ['v', 'info', 'prod', 'ci', 'why']) {
        if (key in r && typeof r[key] !== 'string') problems.push(`${pkg.id}/expect.json: ${file}[${i}].${key} trebuie să fie text`);
      }
    });
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return raw;
}

/**
 * Compară rândurile (k, v) întoarse de un fișier cu așteptările lui. mode: 'ci' sau 'prod'.
 * Întoarce { ok, rows: [{ status, k, actual, expected, why }] }; status: OK | FAIL | INFO | NERULABIL.
 * O probă sărită sau căzută în eroare („SARIT…”, „EROARE…”) e FAIL oriunde: nu a verificat nimic.
 */
export function compareRows(expected, actual, mode) {
  const rows = [];
  const count = Math.max(expected.length, actual.length);
  for (let i = 0; i < count; i++) {
    const e = expected[i];
    const a = actual[i];
    if (!e) {
      rows.push({ status: 'FAIL', k: a.k, actual: a.v, expected: '(rând neașteptat: nu e în expect.json)' });
      continue;
    }
    if (!a) {
      rows.push({ status: 'FAIL', k: e.k, actual: '(rândul lipsește din ieșire)', expected: e.v ?? e.prod ?? e.ci ?? '' });
      continue;
    }
    if (a.k !== e.k) {
      rows.push({ status: 'FAIL', k: a.k, actual: a.v, expected: `(altă etichetă pe poziția ${i + 1}: „${e.k}”)` });
      continue;
    }
    const skipped = /^(SARIT|EROARE)/.test(a.v ?? '') || /^EROARE/.test(a.k);
    if ('v' in e) {
      rows.push({ status: a.v === e.v ? 'OK' : 'FAIL', k: a.k, actual: a.v, expected: e.v });
    } else if ('info' in e) {
      rows.push({ status: skipped ? 'FAIL' : 'INFO', k: a.k, actual: a.v, expected: '', why: e.info });
    } else if (mode === 'ci') {
      const fits = !('ci' in e) || a.v === e.ci;
      rows.push({ status: fits ? 'NERULABIL' : 'FAIL', k: a.k, actual: a.v, expected: 'ci' in e ? e.ci : '', prod: e.prod, why: e.why });
    } else if ('prod' in e) {
      rows.push({ status: a.v === e.prod ? 'OK' : 'FAIL', k: a.k, actual: a.v, expected: e.prod });
    } else {
      rows.push({ status: skipped ? 'FAIL' : 'INFO', k: a.k, actual: a.v, expected: '', why: e.why });
    }
  }
  return { ok: rows.every((r) => r.status !== 'FAIL'), rows };
}

// ── ieșirea psql --csv ───────────────────────────────────────────────────────────────────────────────────────

/** Parsează CSV (RFC 4180, cum scrie `psql --csv`): întoarce înregistrările, fiecare un tablou de câmpuri. */
export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/**
 * Dintr-o ieșire `psql --csv` cu mai multe seturi de rezultate (fiecare începe cu rândul lui de antet), întoarce
 * rândurile ULTIMULUI set cu antetul dat, ca obiecte; null dacă antetul nu apare.
 */
export function lastResultSet(text, columns) {
  const records = parseCsv(text);
  let start = -1;
  records.forEach((r, i) => {
    if (r.length === columns.length && r.every((f, j) => f === columns[j])) start = i;
  });
  if (start < 0) return null;
  const rows = [];
  for (const r of records.slice(start + 1)) {
    if (r.length !== columns.length) break;
    rows.push(Object.fromEntries(columns.map((c, j) => [c, r[j]])));
  }
  return rows;
}

// ── verificările fără bază ───────────────────────────────────────────────────────────────────────────────────

/**
 * Verificările fără bază de date: pachetele acoperă exact migrările de aplicat, în aceeași ordine; fiecare se poate
 * genera; expect.json e bine format; sumele din SHA256SUMS corespund surselor. Întoarce lista problemelor.
 */
export function checkPackages(pending) {
  const out = [];
  let packages;
  try {
    packages = loadPackages();
  } catch (e) {
    return [e.message];
  }
  const flat = packages.flatMap((p) => p.migrations.map((m) => `${m}.sql`));
  if (flat.length !== pending.length || flat.some((f, i) => f !== pending[i])) {
    out.push('pachetele din supabase/gate/apply/packages.json nu acoperă exact [pending] din production-order.txt, în aceeași ordine:');
    const n = Math.max(flat.length, pending.length);
    for (let i = 0; i < n; i++) {
      if (flat[i] !== pending[i]) out.push(`  poziția ${i + 1}: pachete ${flat[i] ?? '(nimic)'}  |  ordine ${pending[i] ?? '(nimic)'}`);
    }
  }
  for (const pkg of packages) {
    try {
      const { files } = buildPackage(pkg);
      const expect = loadExpect(pkg);
      for (const file of ROW_FILES) {
        const generated = files.has(`${file}.sql`);
        if (generated && !(file in expect)) out.push(`${pkg.id}: ${file}.sql există, dar expect.json nu are așteptările lui`);
        if (!generated && file in expect) out.push(`${pkg.id}: expect.json are „${file}”, dar pachetul nu are acel fișier`);
      }
    } catch (e) {
      out.push(e.message);
    }
  }
  if (out.length === 0) {
    const committed = existsSync(SUMS_FILE) ? readLf(SUMS_FILE) : '';
    if (committed !== sumsText(packages)) {
      out.push('supabase/gate/apply/SHA256SUMS nu corespunde surselor (o migrare, un rollback sau o parte de pachet s-a schimbat): rulează `node scripts/apply-packages.mjs sums` și comite fișierul');
    }
  }
  return out;
}

// ── linia de comandă ─────────────────────────────────────────────────────────────────────────────────────────

function writePackage(pkg, dir) {
  mkdirSync(dir, { recursive: true });
  const { files, sources } = buildPackage(pkg);
  const committed = existsSync(SUMS_FILE) ? readLf(SUMS_FILE) : '';
  const info = [`pachetul ${pkg.id} — ${pkg.title}`, 'surse:', ...sources.map((s) => `  ${s.path}  sha256:${s.sha}`), 'fișiere generate (sha256 întreg; aceleași sume ca în supabase/gate/apply/SHA256SUMS):'];
  let stale = false;
  for (const [name, content] of files) {
    writeFileSync(join(dir, name), content);
    const line = `${sha256(content)}  ${pkg.id}/${name}`;
    if (!committed.includes(`${line}\n`)) stale = true;
    info.push(`  ${line}`);
  }
  info.push(stale ? 'ATENȚIE: sumele NU sunt cele din SHA256SUMS (sursele s-au schimbat după ultima rulare `sums`)' : 'sumele corespund cu SHA256SUMS');
  writeFileSync(join(dir, 'build-info.txt'), `${info.join('\n')}\n`);
  console.log(info.join('\n'));
  return !stale;
}

function parseOutput(path) {
  const parsed = JSON.parse(readLf(path));
  if (!Array.isArray(parsed.rows)) throw new Error(`${path}: nu are cheia „rows” (ieșirea \`supabase db query\`)`);
  return parsed.rows.map((r) => ({ k: String(r.k), v: r.v === null || r.v === undefined ? '' : String(r.v) }));
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'sums') {
    writeFileSync(SUMS_FILE, sumsText(loadPackages()));
    console.log('scris: supabase/gate/apply/SHA256SUMS');
    return 0;
  }
  if (command === 'build') {
    const outIndex = rest.indexOf('--out');
    const out = outIndex >= 0 ? rest[outIndex + 1] : null;
    const names = rest.filter((a, i) => a !== '--out' && a !== '--all' && i !== outIndex + 1);
    if (!out || (rest.includes('--all') ? names.length > 0 : names.length !== 1)) {
      console.error('folosire: apply-packages.mjs build <pachet> --out <dir> | build --all --out <dir>');
      return 2;
    }
    const packages = loadPackages();
    let ok = true;
    if (rest.includes('--all')) {
      for (const pkg of packages) ok = writePackage(pkg, join(out, pkg.id)) && ok;
    } else {
      const pkg = packages.find((p) => p.id === names[0]);
      if (!pkg) throw new Error(`pachet necunoscut: ${names[0]} (există: ${packages.map((p) => p.id).join(', ')})`);
      ok = writePackage(pkg, out);
    }
    return ok ? 0 : 1;
  }
  if (command === 'verify') {
    const [id, file, path] = rest;
    const pkg = loadPackages().find((p) => p.id === id);
    const key = (file ?? '').replace(/\.sql$/, '');
    if (!pkg || !ROW_FILES.includes(key) || !path) {
      console.error(`folosire: apply-packages.mjs verify <pachet> <${ROW_FILES.join(' | ')}> <ieșire.json>`);
      return 2;
    }
    const expected = loadExpect(pkg)[key];
    if (!expected) throw new Error(`${pkg.id}: expect.json nu are „${key}”`);
    const result = compareRows(expected, parseOutput(path), 'prod');
    for (const r of result.rows) {
      const tail = r.status === 'FAIL' ? `  (așteptat: ${r.expected})` : r.status === 'INFO' ? `  (informativ: ${r.why})` : '';
      console.log(`${r.status.padEnd(4)}  ${r.k} = ${r.actual}${tail}`);
    }
    console.log(result.ok ? `${pkg.id}/${key}: toate rândurile comparate corespund` : `${pkg.id}/${key}: DIFERENȚE — de explicat înainte de pasul următor`);
    return result.ok ? 0 : 1;
  }
  console.error('folosire: apply-packages.mjs build … | sums | verify …');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`apply-packages: ${e.message}`);
    process.exit(1);
  }
}
