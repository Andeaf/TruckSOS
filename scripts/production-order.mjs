#!/usr/bin/env node
// Repetiția ordinii de producție (jobul `prod-order` din .github/workflows/ci.yml).
//
// Pe producție migrările nu se aplică în ordinea numelui, ci în ordinea din supabase/gate/production-order.txt
// (o fază aprobată mai târziu poate avea versiunea mai mică decât una deja aplicată; pachetele unei faze se pot
// aplica separat). Jobul `db-tests` le aplică doar în ordinea numelui. Scriptul acesta pornește de la o bază
// proaspătă cu baseline-ul și fixturile porții, apoi:
//   1. control: amprenta catalogului (supabase/gate/fingerprint.sql) = `baseline.txt` din artefactul `fingerprints`
//      al jobului `db-tests` — fără asta, compararea a două baze diferite nu dovedește nimic;
//   2. aplică migrările din [applied] (starea producției de azi);
//   3. aplică migrările din [pending] EXACT în ordinea din fișier, fiecare într-o singură tranzacție
//      (`psql -1 -v ON_ERROR_STOP=1`, ca pe producție): blocul DO de verificare de la finalul fiecărei migrări
//      rulează în aceeași tranzacție, deci o verificare picată = migrarea nu se aplică și repetiția se oprește acolo;
//      după fiecare migrare ia amprenta și scrie diferența față de pasul anterior;
//   4. compară amprenta finală, brut (cu tot cu poziția coloanelor: ambele sunt prime aplicări pe baze proaspete),
//      cu `applied.txt` din `db-tests` (ordinea numelui). Diferența așteptată: zero;
//   5. rulează rollback-urile în ordinea INVERSĂ a celei de producție; după fiecare, amprenta trebuie să fie exact cea
//      de dinaintea migrării respective; la capăt, cea a producției de azi.
// Toate diferențele se adună și se raportează împreună (cod de ieșire 1); scriptul nu repară nimic.
//
//   node scripts/production-order.mjs check                      (fără bază: lista acoperă exact supabase/migrations/)
//   node scripts/production-order.mjs run --db <url> --name-order <dir> --out <dir> [--dry-run]
//
// Doar module încorporate + `psql` din PATH: jobul nu rulează `npm ci`.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const ROLLBACK_DIR = join(ROOT, 'supabase', 'rollback');
const ORDER_FILE = join(ROOT, 'supabase', 'gate', 'production-order.txt');
const FINGERPRINT_SQL = join(ROOT, 'supabase', 'gate', 'fingerprint.sql');
const BASELINE_SUFFIX = '_baseline_production_schema.sql';
/** Câte linii dintr-o diferență apar în jurnal (fișierul din --out o are întreagă). */
const LOG_DIFF_LINES = 200;

const version = (file) => file.slice(0, 14);

/** Citește production-order.txt → { applied, pending, problems }. */
function parseOrder() {
  const problems = [];
  const order = { applied: [], pending: [] };
  let section = null;
  const lines = readFileSync(ORDER_FILE, 'utf8').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') return;
    const header = /^\[([a-z]+)\]$/.exec(line);
    if (header) {
      if (!(header[1] in order)) problems.push(`production-order.txt:${i + 1} — secțiune necunoscută [${header[1]}]`);
      section = header[1] in order ? header[1] : null;
      return;
    }
    if (section === null) {
      problems.push(`production-order.txt:${i + 1} — „${line}” e în afara secțiunilor [applied] / [pending]`);
      return;
    }
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(line)) {
      problems.push(`production-order.txt:${i + 1} — „${line}” nu e un nume de migrare (YYYYMMDDHHMMSS_descriere.sql)`);
      return;
    }
    order[section].push(line);
  });
  return { ...order, problems };
}

/** Verificările fără bază de date. Întoarce lista problemelor (goală = în regulă). */
function checkOrder({ applied, pending, problems }) {
  const out = [...problems];
  const listed = [...applied, ...pending];
  const onDisk = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && !f.startsWith('_')).sort();

  const seen = new Set();
  for (const f of listed) {
    if (seen.has(f)) out.push(`${f} apare de două ori în production-order.txt`);
    seen.add(f);
    if (!onDisk.includes(f)) out.push(`${f} e în production-order.txt, dar nu există în supabase/migrations/`);
  }
  for (const f of onDisk) {
    if (!seen.has(f)) out.push(`${f} există în supabase/migrations/, dar nu are loc în production-order.txt (hotărăște-i ordinea)`);
  }
  if (applied.length === 0 || !applied[0].endsWith(BASELINE_SUFFIX)) {
    out.push('prima linie din [applied] trebuie să fie baseline-ul (…_baseline_production_schema.sql)');
  }
  for (const f of pending) {
    if (f.endsWith(BASELINE_SUFFIX)) out.push(`${f}: baseline-ul nu poate fi în [pending]`);
    if (!existsSync(join(ROLLBACK_DIR, f))) out.push(`${f}: lipsește rollback-ul supabase/rollback/${f}`);
  }
  return out;
}

/** Tipărește ordinea și, informativ, unde diferă de ordinea numelui. */
function printOrder({ applied, pending }) {
  console.log('Pe producție (starea de la care pornește repetiția):');
  applied.forEach((f, i) => console.log(`  ${String(i).padStart(2, '0')}  ${f}`));
  console.log('De aplicat, în ordinea de producție:');
  pending.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2, '0')}  ${f}`));
  const afterBaseline = [...applied.slice(1), ...pending];
  const byName = [...afterBaseline].sort();
  const moved = afterBaseline.filter((f, i) => byName[i] !== f);
  if (moved.length === 0) {
    console.log('Ordinea de producție coincide cu ordinea numelui.');
  } else {
    console.log(`Ordinea de producție diferă de ordinea numelui în ${moved.length} poziții (din ${afterBaseline.length}):`);
    afterBaseline.forEach((f, i) => {
      if (byName[i] !== f) console.log(`  poziția ${String(i + 1).padStart(2, '0')}: producție ${version(f)}  |  nume ${version(byName[i])}`);
    });
  }
}

// ── rularea pe bază ──────────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--name-order') args.nameOrder = argv[++i];
    else throw new Error(`argument necunoscut: ${argv[i]}`);
  }
  if (!args.out) throw new Error('lipsește --out <dir>');
  if (!args.dryRun && !args.db) throw new Error('lipsește --db <url>');
  return args;
}

function psql(db, extra, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] psql <db> -X -q -v ON_ERROR_STOP=1 ${extra.join(' ')}`);
    return { ok: true, stdout: '', stderr: '', ms: 0 };
  }
  const start = Date.now();
  const r = spawnSync('psql', [db, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...extra], {
    encoding: 'utf8',
    env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms: Date.now() - start };
}

const toLines = (text) => text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '');

function fingerprint(db, dryRun) {
  const r = psql(db, ['-A', '-t', '-f', FINGERPRINT_SQL], dryRun);
  if (!r.ok) throw new Error(`amprenta nu a putut fi luată:\n${r.stderr}`);
  return toLines(r.stdout);
}

/** Diferența dintre două amprente (linii sortate, unice): ce dispare din `a` și ce apare în `b`. */
function diffLines(a, b) {
  const inA = new Set(a);
  const inB = new Set(b);
  const removed = a.filter((l) => !inB.has(l));
  const added = b.filter((l) => !inA.has(l));
  const same = removed.length === 0 && added.length === 0 && a.length === b.length && a.every((l, i) => l === b[i]);
  const text = [...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)]
    .sort((x, y) => (x.slice(1) < y.slice(1) ? -1 : x.slice(1) > y.slice(1) ? 1 : x[0] === '-' ? -1 : 1))
    .join('\n');
  return { same, removed: removed.length, added: added.length, text };
}

function logDiff(text) {
  const lines = text.split('\n');
  for (const l of lines.slice(0, LOG_DIFF_LINES)) console.log(`    ${l}`);
  if (lines.length > LOG_DIFF_LINES) console.log(`    … încă ${lines.length - LOG_DIFF_LINES} linii (fișierul din artefact e întreg)`);
}

function run(order, args) {
  const { applied, pending } = order;
  const { db, out, nameOrder, dryRun } = args;
  mkdirSync(out, { recursive: true });
  const save = (name, lines) => writeFileSync(join(out, name), lines.length ? `${lines.join('\n')}\n` : '');
  const saveText = (name, text) => writeFileSync(join(out, name), text ? `${text}\n` : '');

  /** Rezultatele, în ordinea rulării: { step, ok, detail }. */
  const results = [];
  const record = (step, ok, detail) => {
    results.push({ step, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${step} — ${detail}`);
  };
  const reference = (name) => {
    if (!nameOrder) return null;
    const p = join(nameOrder, name);
    return existsSync(p) ? toLines(readFileSync(p, 'utf8')) : null;
  };

  // 1. Controlul: aceeași stare de pornire ca `db-tests` (baseline + fixturi).
  console.log('── 1. Control: baza proaspătă = baseline-ul din db-tests ──');
  const fpBaseline = fingerprint(db, dryRun);
  save('00-baseline.txt', fpBaseline);
  const refBaseline = reference('baseline.txt');
  if (dryRun) {
    record('control baseline', true, 'dry-run');
  } else if (refBaseline === null) {
    record('control baseline', false, 'lipsește baseline.txt din artefactul `fingerprints` al jobului db-tests');
  } else {
    const d = diffLines(refBaseline, fpBaseline);
    saveText('00-baseline-vs-db-tests.diff', d.text);
    record('control baseline', d.same, d.same ? `${fpBaseline.length} linii, identic cu db-tests` : `diferă de db-tests: -${d.removed} / +${d.added}`);
    if (!d.same) logDiff(d.text);
  }

  // 2. Starea producției de azi.
  console.log('── 2. Migrările deja pe producție ──');
  let reachedProduction = true;
  for (const f of applied.slice(1)) {
    const r = psql(db, ['-1', '-f', join(MIGRATIONS_DIR, f)], dryRun);
    if (!r.ok) {
      record(`aplicare ${f}`, false, `eroare (migrare deja pe producție):\n${r.stderr}`);
      reachedProduction = false;
      break;
    }
    console.log(`  aplicat ${f} (${r.ms} ms)`);
  }
  const fpProduction = fingerprint(db, dryRun);
  save('01-production-today.txt', fpProduction);
  if (reachedProduction) record('starea producției de azi', true, `${applied.length} migrări (cu baseline-ul), ${fpProduction.length} linii`);

  // 3. Migrările de aplicat, în ordinea de producție; `before[i]` = amprenta de dinaintea migrării i.
  console.log('── 3. Aplicare în ordinea de producție (psql -1: verificările finale ale fiecărei migrări rulează în tranzacție) ──');
  const before = [];
  const done = [];
  let current = fpProduction;
  if (reachedProduction) {
    for (const [i, f] of pending.entries()) {
      const nn = String(i + 2).padStart(2, '0');
      before.push(current);
      const r = psql(db, ['-1', '-f', join(MIGRATIONS_DIR, f)], dryRun);
      if (r.stderr.trim()) console.log(r.stderr.trimEnd().split('\n').map((l) => `    ${l}`).join('\n'));
      if (!r.ok) {
        record(`aplicare ${f}`, false, `NU se aplică în ordinea de producție (pasul ${i + 1} din ${pending.length}); eroarea e mai sus`);
        break;
      }
      const fp = fingerprint(db, dryRun);
      const d = diffLines(current, fp);
      save(`${nn}-after-${version(f)}.txt`, fp);
      saveText(`${nn}-delta-${version(f)}.diff`, d.text);
      record(`aplicare ${f}`, true, `${r.ms} ms; catalog -${d.removed} / +${d.added}`);
      current = fp;
      done.push(f);
    }
  }
  const allApplied = done.length === pending.length;

  // 4. Amprenta finală față de aplicarea în ordinea numelui.
  console.log('── 4. Amprenta finală: ordinea de producție vs ordinea numelui (db-tests) ──');
  save('applied-production-order.txt', current);
  const refApplied = reference('applied.txt');
  if (dryRun) {
    record('ordinea de producție = ordinea numelui', true, 'dry-run');
  } else if (!allApplied) {
    record('ordinea de producție = ordinea numelui', false, 'necomparat: aplicarea s-a oprit înainte de ultima migrare');
  } else if (refApplied === null) {
    record('ordinea de producție = ordinea numelui', false, 'lipsește applied.txt din artefactul `fingerprints` al jobului db-tests');
  } else {
    const d = diffLines(refApplied, current);
    saveText('order-vs-name.diff', d.text);
    record(
      'ordinea de producție = ordinea numelui',
      d.same,
      d.same ? `${current.length} linii, identice (diferența: zero)` : `DIFERĂ: -${d.removed} (doar în ordinea numelui) / +${d.added} (doar în ordinea de producție)`,
    );
    if (!d.same) logDiff(d.text);
  }

  // 5. Rollback-urile, în ordinea inversă a celei de producție.
  console.log('── 5. Rollback în ordinea inversă a celei de producție ──');
  // Un rollback refuzat (de ex. de garda lui: „rulează întâi rollback-ul X”) e o verificare PICATĂ, dar repetiția nu se
  // oprește: îl amână, merge mai departe și îl reîncearcă după fiecare rollback reușit — ca raportul să spună și dacă
  // restul trec și în ce ordine. Compararea pe pas („amprenta = cea de dinaintea migrării”) are sens doar când
  // rollback-urile făcute până atunci sunt exact un capăt al ordinii de aplicare; altfel pasul e doar notat.
  const rolled = new Set();
  const deferred = [];
  const effective = [];
  let seq = 0;
  const tryRollback = (i, retry) => {
    const f = done[i];
    const r = psql(db, ['-1', '-f', join(ROLLBACK_DIR, f)], dryRun);
    if (r.stderr.trim()) console.log(r.stderr.trimEnd().split('\n').map((l) => `    ${l}`).join('\n'));
    if (!r.ok) {
      if (!retry) {
        const chained = deferred.length > 0 ? ` — posibil în lanț: ${deferred.map((j) => version(done[j])).join(', ')} e deja amânat` : '';
        record(`rollback ${f}`, false, `rollback-ul NU rulează în ordinea inversă a celei de producție (eroarea e mai sus); amânat, se reîncearcă după următoarele${chained}`);
        deferred.push(i);
      }
      return false;
    }
    rolled.add(i);
    effective.push(f);
    seq += 1;
    const fp = fingerprint(db, dryRun);
    current = fp;
    save(`rb-${String(seq).padStart(2, '0')}-after-rollback-${version(f)}.txt`, fp);
    const lowest = Math.min(...rolled);
    const isSuffix = rolled.size === done.length - lowest;
    const label = retry ? `rollback ${f} (reîncercat, în afara ordinii inverse)` : `rollback ${f}`;
    if (!isSuffix) {
      record(label, true, `${r.ms} ms; rulat cât alte rollback-uri sunt amânate: amprenta pe pas nu se poate compara`);
      return true;
    }
    const d = diffLines(before[lowest], fp);
    if (!d.same) saveText(`rb-${String(seq).padStart(2, '0')}-${version(f)}.diff`, d.text);
    record(label, d.same, d.same ? `${r.ms} ms; amprenta = cea de dinaintea migrării ${version(done[lowest])}` : `amprenta diferă de cea de dinaintea migrării ${version(done[lowest])}: -${d.removed} / +${d.added}`);
    if (!d.same) logDiff(d.text);
    return true;
  };
  for (let i = done.length - 1; i >= 0; i--) {
    if (!tryRollback(i, false)) continue;
    // după un rollback reușit: cele amânate, în ordinea în care au fost refuzate, până nu mai trece niciunul
    for (let progress = true; progress && deferred.length > 0; ) {
      progress = false;
      for (const j of [...deferred]) {
        if (tryRollback(j, true)) {
          deferred.splice(deferred.indexOf(j), 1);
          progress = true;
        }
      }
    }
  }
  for (const j of deferred) record(`rollback ${done[j]} (reîncercat)`, false, 'refuzat și după toate celelalte rollback-uri');
  const rolledBackAll = rolled.size === done.length;
  if (done.length > 0) {
    console.log('Ordinea în care au rulat de fapt rollback-urile:');
    effective.forEach((f, k) => console.log(`  ${String(k + 1).padStart(2, '0')}  ${f}`));
    saveText('rollback-order-effective.txt', effective.join('\n'));
  }
  save('rolled-back.txt', current);
  if (done.length > 0 && rolledBackAll) {
    const d = diffLines(fpProduction, current);
    if (!d.same) saveText('rolled-back-vs-production-today.diff', d.text);
    record('după toate rollback-urile = producția de azi', d.same, d.same ? `${current.length} linii, identice` : `diferă: -${d.removed} / +${d.added}`);
    if (!d.same) logDiff(d.text);
  }

  // Rezumatul.
  const failed = results.filter((r) => !r.ok);
  const summary = [
    '### Repetiția ordinii de producție',
    '',
    `${failed.length === 0 ? 'Toate verificările au trecut.' : `**${failed.length} verificare(i) picată(e).**`} Migrări de aplicat: ${pending.length}; aplicate: ${done.length}.`,
    '',
    '| | Pas | Rezultat |',
    '|---|---|---|',
    ...results.map((r) => `| ${r.ok ? 'PASS' : 'FAIL'} | ${r.step} | ${r.detail.split('\n')[0].replace(/\|/g, '\\|')} |`),
  ].join('\n');
  saveText('summary.md', summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  console.log(`\nREPETIȚIA ORDINII DE PRODUCȚIE: ${results.length - failed.length} PASS / ${failed.length} FAIL`);
  for (const r of failed) console.log(`  FAIL  ${r.step} — ${r.detail.split('\n')[0]}`);
  return failed.length === 0;
}

// ── intrarea ─────────────────────────────────────────────────────────────────────────────────────────────────

const [mode, ...rest] = process.argv.slice(2);
if (mode !== 'check' && mode !== 'run') {
  console.error('folosire: production-order.mjs check | run --db <url> --name-order <dir> --out <dir> [--dry-run]');
  process.exit(2);
}

const order = parseOrder();
const problems = checkOrder(order);
if (problems.length > 0) {
  console.error(`production-order: ${problems.length} problemă(e):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
printOrder(order);
if (mode === 'check') {
  console.log(`production-order: OK (${order.applied.length} pe producție, ${order.pending.length} de aplicat)`);
  process.exit(0);
}

let ok = false;
try {
  ok = run(order, parseArgs(rest));
} catch (e) {
  console.error(`production-order: ${e.message}`);
  process.exit(1);
}
process.exit(ok ? 0 : 1);
