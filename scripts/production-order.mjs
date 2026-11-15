#!/usr/bin/env node
// Repetiția ordinii de producție (jobul `prod-order` din .github/workflows/ci.yml).
//
// Pe producție migrările nu se aplică în ordinea numelui, ci în ordinea din supabase/gate/production-order.txt
// (o fază aprobată mai târziu poate avea versiunea mai mică decât una deja aplicată; pachetele unei faze se pot
// aplica separat) și nu una câte una, ci prin PACHETE de aplicare (supabase/gate/apply/, scripts/apply-packages.mjs):
// fișierele 00–06 rulate pe rând. Jobul `db-tests` aplică migrările doar în ordinea numelui. Scriptul acesta pornește
// de la o bază proaspătă cu baseline-ul și fixturile porții, apoi:
//   1. control: amprenta catalogului (supabase/gate/fingerprint.sql) = `baseline.txt` din artefactul `fingerprints`
//      al jobului `db-tests` — fără asta, compararea a două baze diferite nu dovedește nimic;
//   2. aplică migrările din [applied] (starea producției de azi);
//   3. TRECEREA 1 — pachetele, în ordinea de producție, exact fișierele care se rulează pe producție:
//        00 (starea de pornire) → 01 (amprenta înainte) → 02 (repetiția BEGIN … ROLLBACK) → 03 (amprenta după repetiție,
//        identică cu 01) → 02b (proba ca rolul clientului, unde există; după ea amprenta e tot cea din 01) → 04
//        (aplicarea) → 05 (verificările de după aplicare).
//      Rândurile din 00 / 02b / 05 se compară cu așteptările din expect.json al pachetului; diferența raportată de 02
//      trebuie să fie exact diferența reală de amprentă pe care o face 04;
//   4. compară amprenta finală, brut (cu tot cu poziția coloanelor: ambele sunt prime aplicări pe baze proaspete),
//      cu `applied.txt` din `db-tests` (ordinea numelui). Diferența așteptată: zero;
//   5. rulează fișierele 06 (rollback-ul de urgență) în ordinea INVERSĂ a pachetelor: când rulează 06 al unui pachet,
//      baza e exact cea de după aplicarea lui (pachetele de după el sunt deja date înapoi, cu amprenta verificată), iar
//      după el amprenta trebuie să fie cea din 01 al pachetului; la capăt, cea a producției de azi;
//   6. TRECEREA 2 — migrare cu migrare, pe baza adusă înapoi la starea producției: fiecare migrare din [pending] cu
//      `psql -1` (blocul ei DO de verificare rulează în aceeași tranzacție), apoi fiecare rollback în ordinea inversă,
//      cu amprenta comparată după fiecare cu cea de dinaintea migrării lui.
// Toate diferențele se adună și se raportează împreună (cod de ieșire 1); scriptul nu repară nimic.
//
// Ce NU poate dovedi CI-ul: pe producție fișierele rulează prin `supabase db query --linked` (API-ul de management),
// aici prin `psql`; iar rândurile marcate „nerulabil în CI” în expect.json depind de ce există doar pe producție
// (secrete din Vault, istoricul scris de `migration repair`, rulările cron) — sunt listate la sfârșit, nu ocolite.
//
//   node scripts/production-order.mjs check                      (fără bază: ordinea, pachetele, sumele)
//   node scripts/production-order.mjs run --db <url> --name-order <dir> --out <dir>
//
// Doar module încorporate + `psql` din PATH: jobul nu rulează `npm ci`.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPackage, checkPackages, compareRows, lastResultSet, loadExpect, loadPackages, sumsText } from './apply-packages.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const ROLLBACK_DIR = join(ROOT, 'supabase', 'rollback');
const ORDER_FILE = join(ROOT, 'supabase', 'gate', 'production-order.txt');
const FINGERPRINT_SQL = join(ROOT, 'supabase', 'gate', 'fingerprint.sql');
const BASELINE_SUFFIX = '_baseline_production_schema.sql';
/** Câte linii dintr-o diferență apar în jurnal (fișierul din --out o are întreagă). */
const LOG_DIFF_LINES = 200;
/** Sub atâtea linii amprenta nu e a unei baze cu baseline-ul aplicat (baseline-ul singur: 1 131 de linii, 14 nov 2026). */
const MIN_FINGERPRINT_LINES = 500;

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
  // Pachetele de aplicare acoperă exact [pending], în aceeași ordine, și sumele lor corespund surselor.
  if (out.length === 0) out.push(...checkPackages(pending));
  return out;
}

/** Tipărește ordinea și, informativ, unde diferă de ordinea numelui. */
function printOrder({ applied, pending }) {
  console.log('Pe producție (starea de la care pornește repetiția):');
  applied.forEach((f, i) => console.log(`  ${String(i).padStart(2, '0')}  ${f}`));
  console.log('De aplicat, în ordinea de producție (pe pachete):');
  let n = 0;
  for (const pkg of loadPackages()) {
    console.log(`  pachetul ${pkg.id} — ${pkg.title}`);
    for (const m of pkg.migrations) console.log(`    ${String((n += 1)).padStart(2, '0')}  ${m}.sql`);
  }
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
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--name-order') args.nameOrder = argv[++i];
    else throw new Error(`argument necunoscut: ${argv[i]}`);
  }
  if (!args.out) throw new Error('lipsește --out <dir>');
  if (!args.db) throw new Error('lipsește --db <url>');
  return args;
}

function psql(db, extra) {
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
const indent = (text) => text.trimEnd().split('\n').map((l) => `    ${l}`).join('\n');

function fingerprint(db) {
  const r = psql(db, ['-A', '-t', '-f', FINGERPRINT_SQL]);
  if (!r.ok) throw new Error(`amprenta nu a putut fi luată:\n${r.stderr}`);
  const lines = toLines(r.stdout);
  // O amprentă aproape goală ar face ca două baze stricate să pară „identice”: baseline-ul singur are peste 1 000 de linii.
  if (lines.length < MIN_FINGERPRINT_LINES) {
    throw new Error(`amprenta are doar ${lines.length} linii (minimul așteptat: ${MIN_FINGERPRINT_LINES}); baza nu e cea așteptată`);
  }
  return lines;
}

/** Amprenta ca INTRĂRI (o intrare poate avea mai multe linii, de ex. o politică): pentru compararea cu diferența din 02. */
function fingerprintEntries(db) {
  const r = psql(db, ['--csv', '-f', FINGERPRINT_SQL]);
  const rows = r.ok ? lastResultSet(r.stdout, ['line']) : null;
  if (rows === null) throw new Error(`amprenta (intrări) nu a putut fi luată:\n${r.stderr}`);
  return rows.map((row) => row.line);
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

/**
 * Rulează rollback-urile unor pași în ordinea inversă a aplicării lor. Un rollback refuzat (de ex. de garda lui:
 * „rulează întâi rollback-ul X”) e o verificare PICATĂ, dar repetiția nu se oprește: îl amână, merge mai departe și îl
 * reîncearcă după fiecare rollback reușit — ca raportul să spună și dacă restul trec și în ce ordine. Compararea pe
 * pas („amprenta = cea de dinaintea pasului”) are sens doar când rollback-urile făcute până atunci sunt exact un capăt
 * al ordinii de aplicare; altfel pasul e doar notat.
 *   steps: [{ name, file, before }] în ordinea aplicării (`before` = amprenta de dinaintea pasului).
 * Întoarce { all, current, effective }.
 */
function rollBackInReverse({ db, steps, record, save, saveText, prefix, what }) {
  const rolled = new Set();
  const deferred = [];
  const effective = [];
  let current = null;
  let seq = 0;
  const tryRollback = (i, retry) => {
    const step = steps[i];
    const r = psql(db, step.args);
    if (r.stderr.trim()) console.log(indent(r.stderr));
    if (!r.ok) {
      if (!retry) {
        const chained = deferred.length > 0 ? ` — posibil în lanț: ${deferred.map((j) => steps[j].name).join(', ')} e deja amânat` : '';
        record(`${what} ${step.name}`, false, `NU rulează în ordinea inversă a celei de producție (eroarea e mai sus); amânat, se reîncearcă după următoarele${chained}`);
        deferred.push(i);
      }
      return false;
    }
    rolled.add(i);
    effective.push(step.name);
    seq += 1;
    const fp = fingerprint(db);
    current = fp;
    if (save) save(`${prefix}-${String(seq).padStart(2, '0')}-after-${step.name}.txt`, fp);
    const lowest = Math.min(...rolled);
    const isSuffix = rolled.size === steps.length - lowest;
    const label = retry ? `${what} ${step.name} (reîncercat, în afara ordinii inverse)` : `${what} ${step.name}`;
    if (!isSuffix) {
      record(label, true, `${r.ms} ms; rulat cât alte rollback-uri sunt amânate: amprenta pe pas nu se poate compara`);
      return true;
    }
    const d = diffLines(steps[lowest].before, fp);
    if (!d.same) saveText(`${prefix}-${String(seq).padStart(2, '0')}-${step.name}.diff`, d.text);
    record(label, d.same, d.same ? `${r.ms} ms; amprenta = cea de dinaintea lui ${steps[lowest].name}` : `amprenta diferă de cea de dinaintea lui ${steps[lowest].name}: -${d.removed} / +${d.added}`);
    if (!d.same) logDiff(d.text);
    return true;
  };
  for (let i = steps.length - 1; i >= 0; i--) {
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
  // (refuzul e deja numărat ca FAIL o dată; aici doar se spune că nu a trecut nici la reîncercare)
  for (const j of deferred) console.log(`      ${what} ${steps[j].name}: refuzat și după toate celelalte`);
  if (steps.length > 0) {
    console.log('Ordinea în care au rulat de fapt:');
    effective.forEach((name, k) => console.log(`  ${String(k + 1).padStart(2, '0')}  ${name}`));
    saveText(`${prefix}-order-effective.txt`, effective.join('\n'));
  }
  return { all: rolled.size === steps.length, current, effective };
}

function run(order, args) {
  const { applied, pending } = order;
  const { db, out, nameOrder } = args;
  mkdirSync(out, { recursive: true });
  const save = (name, lines) => writeFileSync(join(out, name), lines.length ? `${lines.join('\n')}\n` : '');
  const saveText = (name, text) => writeFileSync(join(out, name), text ? `${text}\n` : '');

  /** Rezultatele, în ordinea rulării: { step, ok, detail }. */
  const results = [];
  const record = (step, ok, detail) => {
    results.push({ step, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${step} — ${detail}`);
  };
  /** Rândurile din 00 / 02b / 05 care depind de ce există doar pe producție: { pkg, file, k, actual, prod, why }. */
  const notRunnable = [];
  const reference = (name) => {
    if (!nameOrder) return null;
    const p = join(nameOrder, name);
    return existsSync(p) ? toLines(readFileSync(p, 'utf8')) : null;
  };

  // 1. Controlul: aceeași stare de pornire ca `db-tests` (baseline + fixturi).
  console.log('── 1. Control: baza proaspătă = baseline-ul din db-tests ──');
  const fpBaseline = fingerprint(db);
  save('00-baseline.txt', fpBaseline);
  const refBaseline = reference('baseline.txt');
  if (refBaseline === null) {
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
    const r = psql(db, ['-1', '-f', join(MIGRATIONS_DIR, f)]);
    if (!r.ok) {
      record(`aplicare ${f}`, false, `eroare (migrare deja pe producție):\n${r.stderr}`);
      reachedProduction = false;
      break;
    }
    console.log(`  aplicat ${f} (${r.ms} ms)`);
  }
  const fpProduction = fingerprint(db);
  save('01-production-today.txt', fpProduction);
  if (reachedProduction) record('starea producției de azi', true, `${applied.length} migrări (cu baseline-ul), ${fpProduction.length} linii`);

  // 3. TRECEREA 1: pachetele de aplicare, în ordinea de producție.
  console.log('── 3. Trecerea 1: pachetele de aplicare (00 → 01 → 02 → 03 → 02b → 04 → 05), în ordinea de producție ──');
  const packages = loadPackages();
  saveText('SHA256SUMS', sumsText(packages).trimEnd());
  /** Pachetele aplicate, în ordine: { name, args (ale lui 06), before }. */
  const appliedPackages = [];
  let current = fpProduction;
  let allApplied = reachedProduction;
  if (reachedProduction) {
    for (const [i, pkg] of packages.entries()) {
      const nn = String(i + 1).padStart(2, '0');
      const dir = join(out, 'packages', `${nn}-${pkg.id}`);
      mkdirSync(join(dir, 'out'), { recursive: true });
      const { files } = buildPackage(pkg);
      for (const [name, content] of files) writeFileSync(join(dir, name), content);
      const expect = loadExpect(pkg);
      console.log(`── pachetul ${nn} ${pkg.id} — ${pkg.title} (${pkg.migrations.length} migrare/migrări) ──`);

      /** Rulează un fișier al pachetului cu `psql --csv` (fără -1: fișierele au propriul BEGIN … COMMIT / ROLLBACK). */
      const runFile = (name) => {
        const r = psql(db, ['--csv', '-f', join(dir, name)]);
        writeFileSync(join(dir, 'out', name.replace(/\.sql$/, '.csv')), r.stdout);
        if (r.stderr.trim()) console.log(indent(r.stderr));
        return r;
      };
      /** Rulează un fișier cu rânduri (k, v) și le compară cu expect.json. */
      const runRows = (key) => {
        if (!files.has(`${key}.sql`)) return;
        const step = `${pkg.id} ${key}`;
        const r = runFile(`${key}.sql`);
        if (!r.ok) {
          record(step, false, 'fișierul a ieșit cu eroare (mai sus)');
          return;
        }
        const rows = lastResultSet(r.stdout, ['k', 'v']);
        if (rows === null) {
          record(step, false, 'ieșirea nu are niciun set de rezultate (k, v)');
          return;
        }
        const cmp = compareRows(expect[key], rows, 'ci');
        for (const row of cmp.rows) {
          const tail =
            row.status === 'FAIL' ? `  ← AȘTEPTAT: ${row.expected}`
            : row.status === 'NERULABIL' ? `  ← nerulabil în CI: pe producție ${row.prod === undefined ? 'se citește' : `„${row.prod}”`} (${row.why})`
            : row.status === 'INFO' ? `  ← informativ (${row.why})`
            : '';
          console.log(`    [${row.status}] ${row.k} = ${row.actual}${tail}`);
          if (row.status === 'NERULABIL') notRunnable.push({ pkg: pkg.id, file: key, k: row.k, actual: row.actual, prod: row.prod, why: row.why });
        }
        const count = (s) => cmp.rows.filter((row) => row.status === s).length;
        record(step, cmp.ok, `${rows.length} rânduri: ${count('OK')} exacte, ${count('INFO')} informative, ${count('NERULABIL')} nerulabile în CI, ${count('FAIL')} DIFERITE`);
      };
      /** Rulează 01 / 03 și întoarce intrările amprentei (null la eroare). */
      const runFingerprint = (name) => {
        const r = runFile(name);
        const rows = r.ok ? lastResultSet(r.stdout, ['line']) : null;
        return rows === null ? null : rows.map((row) => row.line);
      };
      const linesOf = (entries) => toLines(entries.join('\n'));

      runRows('00-precheck');

      const entries01 = runFingerprint('01-fingerprint-before.sql');
      const fp01 = entries01 === null ? null : linesOf(entries01);
      if (fp01 === null) {
        record(`${pkg.id} 01`, false, 'fișierul a ieșit cu eroare sau fără amprentă');
      } else {
        const d = diffLines(current, fp01);
        record(`${pkg.id} 01`, d.same, d.same ? `${fp01.length} linii = amprenta de după pasul anterior` : `diferă de amprenta de după pasul anterior: -${d.removed} / +${d.added}`);
        if (!d.same) logDiff(d.text);
      }

      // 02: repetiția. Rândurile „-” / „+” sunt INTRĂRI de amprentă (o intrare poate avea mai multe linii).
      let rehearsed = null;
      const r02 = runFile('02-rehearsal.sql');
      const rows02 = r02.ok ? lastResultSet(r02.stdout, ['side', 'line']) : null;
      if (rows02 === null) {
        record(`${pkg.id} 02`, false, r02.ok ? 'ieșirea nu are diferența de amprentă (side, line)' : 'repetiția a ieșit cu eroare (mai sus)');
      } else {
        const side = (s) => rows02.filter((row) => row.side === s).map((row) => row.line).sort();
        rehearsed = { removed: side('-'), added: side('+') };
        saveText(join('packages', `${nn}-${pkg.id}`, 'out', '02-delta.txt'), [...rehearsed.removed.map((l) => `-${l}`), ...rehearsed.added.map((l) => `+${l}`)].join('\n'));
        record(`${pkg.id} 02`, true, `${r02.ms} ms; repetiția anunță -${rehearsed.removed.length} / +${rehearsed.added.length} intrări de amprentă`);
      }

      const entries03 = runFingerprint('03-fingerprint-after-rollback.sql');
      const fp03 = entries03 === null ? null : linesOf(entries03);
      if (fp03 === null || fp01 === null) {
        record(`${pkg.id} 03`, false, 'necomparat: 01 sau 03 nu a întors amprenta');
      } else {
        const d = diffLines(fp01, fp03);
        record(`${pkg.id} 03`, d.same, d.same ? 'identic cu 01: repetiția nu a lăsat nimic' : `DIFERĂ de 01: -${d.removed} / +${d.added}`);
        if (!d.same) logDiff(d.text);
      }

      if (files.has('02b-probe-as-client.sql')) {
        runRows('02b-probe-as-client');
        const d = diffLines(current, fingerprint(db));
        record(`${pkg.id} 02b nu lasă nimic`, d.same, d.same ? 'amprenta de după probă = cea de dinainte' : `amprenta diferă după probă: -${d.removed} / +${d.added}`);
        if (!d.same) logDiff(d.text);
      }

      const r04 = runFile('04-apply.sql');
      if (!r04.ok) {
        record(`${pkg.id} 04`, false, `NU se aplică în ordinea de producție (pachetul ${i + 1} din ${packages.length}); eroarea e mai sus`);
        allApplied = false;
        break;
      }
      const after = fingerprint(db);
      const real = diffLines(current, after);
      save(join('packages', `${nn}-${pkg.id}`, 'before.txt'), current);
      save(join('packages', `${nn}-${pkg.id}`, 'after.txt'), after);
      saveText(join('packages', `${nn}-${pkg.id}`, 'delta.diff'), real.text);
      const done = lastResultSet(r04.stdout, ['rezultat']);
      record(`${pkg.id} 04`, done !== null && done.length === 1, `${r04.ms} ms; catalog -${real.removed} / +${real.added}; ${done?.[0]?.rezultat ?? 'fără rândul „rezultat”'}`);
      if (rehearsed !== null && entries01 !== null) {
        // pe intrări întregi, ca în 02: ce era în 01 și nu mai e după 04, ce e după 04 și nu era în 01
        const entriesAfter = fingerprintEntries(db);
        const was = new Set(entries01);
        const is = new Set(entriesAfter);
        const realRemoved = entries01.filter((e) => !is.has(e)).sort();
        const realAdded = entriesAfter.filter((e) => !was.has(e)).sort();
        const same = realRemoved.join('\u0000') === rehearsed.removed.join('\u0000') && realAdded.join('\u0000') === rehearsed.added.join('\u0000');
        saveText(join('packages', `${nn}-${pkg.id}`, 'out', '04-delta.txt'), [...realRemoved.map((l) => `-${l}`), ...realAdded.map((l) => `+${l}`)].join('\n'));
        record(
          `${pkg.id} delta 02 = delta 04`,
          same,
          same
            ? `diferența anunțată de repetiție e exact cea făcută de aplicare (-${realRemoved.length} / +${realAdded.length} intrări)`
            : `diferența anunțată de repetiție NU e cea făcută de aplicare: 02 -${rehearsed.removed.length} / +${rehearsed.added.length}, 04 -${realRemoved.length} / +${realAdded.length} intrări (out/02-delta.txt față de out/04-delta.txt, în artefact)`,
        );
      } else {
        record(`${pkg.id} delta 02 = delta 04`, false, 'necomparat: 01 sau 02 nu a întors rezultatul');
      }
      appliedPackages.push({ name: pkg.id, args: ['--csv', '-f', join(dir, '06-rollback-emergency.sql')], before: current });
      current = after;

      runRows('05-post-apply-check');
    }
  }

  // 4. Amprenta finală față de aplicarea în ordinea numelui.
  console.log('── 4. Amprenta finală: ordinea de producție vs ordinea numelui (db-tests) ──');
  save('applied-production-order.txt', current);
  const refApplied = reference('applied.txt');
  if (!allApplied) {
    record('ordinea de producție = ordinea numelui', false, 'necomparat: aplicarea s-a oprit înainte de ultimul pachet');
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

  // 5. Fișierele 06 (rollback-ul de urgență), în ordinea inversă a pachetelor.
  console.log('── 5. Rollback-ul de urgență (06) al fiecărui pachet, în ordinea inversă a celei de producție ──');
  const sweep = rollBackInReverse({ db, steps: appliedPackages, record, save, saveText, prefix: 'rb06', what: '06' });
  if (sweep.current !== null) current = sweep.current;
  save('rolled-back.txt', current);
  let backToProduction = false;
  if (appliedPackages.length > 0 && sweep.all) {
    const d = diffLines(fpProduction, current);
    backToProduction = d.same;
    if (!d.same) saveText('rolled-back-vs-production-today.diff', d.text);
    record('după toate fișierele 06 = producția de azi', d.same, d.same ? `${current.length} linii, identice` : `diferă: -${d.removed} / +${d.added}`);
    if (!d.same) logDiff(d.text);
  }

  // 6. TRECEREA 2: migrare cu migrare, pe baza adusă înapoi la starea producției.
  console.log('── 6. Trecerea 2: fiecare migrare cu psql -1, apoi fiecare rollback în ordinea inversă ──');
  if (!backToProduction) {
    record('trecerea 2 (migrare cu migrare)', false, 'nerulată: baza nu a revenit la starea producției de azi după fișierele 06');
  } else {
    // A doua aplicare pe aceeași bază: o coloană adăugată, scoasă de rollback și adăugată din nou primește altă poziție
    // (attnum), deci amprentele de aici se compară doar între ele (înainte / după rollback), nu cu ordinea numelui.
    const steps = [];
    for (const [i, f] of pending.entries()) {
      const before = current;
      const r = psql(db, ['-1', '-f', join(MIGRATIONS_DIR, f)]);
      if (r.stderr.trim()) console.log(indent(r.stderr));
      if (!r.ok) {
        record(`aplicare ${f}`, false, `NU se aplică singură în ordinea de producție (pasul ${i + 1} din ${pending.length}); eroarea e mai sus`);
        break;
      }
      current = fingerprint(db);
      const d = diffLines(before, current);
      record(`aplicare ${f}`, true, `${r.ms} ms; catalog -${d.removed} / +${d.added}`);
      steps.push({ name: version(f), args: ['-1', '-f', join(ROLLBACK_DIR, f)], before });
    }
    const back = rollBackInReverse({ db, steps, record, save: null, saveText, prefix: 'rb', what: 'rollback' });
    if (back.current !== null) current = back.current;
    if (steps.length > 0 && back.all) {
      const d = diffLines(fpProduction, current);
      if (!d.same) saveText('rolled-back-2-vs-production-today.diff', d.text);
      record('după toate rollback-urile = producția de azi', d.same, d.same ? `${current.length} linii, identice` : `diferă: -${d.removed} / +${d.added}`);
      if (!d.same) logDiff(d.text);
    }
  }

  // Rezumatul.
  const failed = results.filter((r) => !r.ok);
  const cell = (text) => String(text).split('\n')[0].replace(/\|/g, '\\|');
  const summary = [
    '### Repetiția ordinii de producție',
    '',
    `${failed.length === 0 ? 'Toate verificările au trecut.' : `**${failed.length} verificare(i) picată(e).**`} Pachete de aplicat: ${packages.length} (${pending.length} migrări); aplicate: ${appliedPackages.length}.`,
    '',
    '| | Pas | Rezultat |',
    '|---|---|---|',
    ...results.map((r) => `| ${r.ok ? 'PASS' : 'FAIL'} | ${cell(r.step)} | ${cell(r.detail)} |`),
    '',
    `#### Nerulabil în CI (${notRunnable.length} rânduri): depind de ce există doar pe producție; se verifică acolo`,
    '',
    '| Pachet | Fișier | Verificarea | În CI | Pe producție | De ce |',
    '|---|---|---|---|---|---|',
    ...notRunnable.map((n) => `| ${n.pkg} | ${n.file} | ${cell(n.k)} | ${cell(n.actual)} | ${n.prod === undefined ? '(se citește)' : cell(n.prod)} | ${cell(n.why)} |`),
  ].join('\n');
  saveText('summary.md', summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  console.log(`\nNERULABIL ÎN CI: ${notRunnable.length} rânduri (se verifică pe producție)`);
  for (const n of notRunnable) console.log(`  ${n.pkg} ${n.file}: ${n.k} — ${n.why}`);
  console.log(`\nREPETIȚIA ORDINII DE PRODUCȚIE: ${results.length - failed.length} PASS / ${failed.length} FAIL`);
  for (const r of failed) console.log(`  FAIL  ${r.step} — ${r.detail.split('\n')[0]}`);
  return failed.length === 0;
}

// ── intrarea ─────────────────────────────────────────────────────────────────────────────────────────────────

const [mode, ...rest] = process.argv.slice(2);
if (mode !== 'check' && mode !== 'run') {
  console.error('folosire: production-order.mjs check | run --db <url> --name-order <dir> --out <dir>');
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
  console.log(`production-order: OK (${order.applied.length} pe producție, ${order.pending.length} de aplicat în ${loadPackages().length} pachete; sumele pachetelor corespund)`);
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
