#!/usr/bin/env node
// Verifică, în CI și local (`npm run check:migrations`), că migrațiile noi respectă
// convenția de grant-uri din 20261025000100_grants_baseline.sql. Din 30 oct 2026 Supabase
// nu mai acordă automat privilegii Data API pe obiectele noi din `public`: un tabel
// creat fără GRANT merge în Studio și pică în aplicație cu „permission denied”.
//
// Reguli (pentru fișierele cu dată >= CONVENTION_SINCE; istoricul nu se rescrie):
//   CREATE TABLE t      → ENABLE ROW LEVEL SECURITY pe t
//                       → decizie explicită pentru anon: REVOKE … ON t FROM anon  sau  GRANT … ON t TO … anon
//                       → decizie explicită pentru authenticated: GRANT … ON t TO … authenticated
//                                                              sau REVOKE … ON t FROM authenticated
//                       → GRANT … ON t TO … service_role
//   CREATE VIEW v       → GRANT SELECT … ON v TO …
//                       → dacă GRANT-ul include anon: view-ul e `security_invoker = true`
//   CREATE FUNCTION f   → (dacă nu întoarce trigger) REVOKE EXECUTE ON FUNCTION f … FROM PUBLIC
//   numele fișierului   → YYYYMMDDHHMMSS_descriere.sql (versiune unică de 14 cifre; din 25 oct 2026,
//                         faza 0.1 din PLAN_1.1_FIX — CLI-ul Supabase cere versiuni unice)
//
// Ieșire: lista problemelor `fișier:linie — mesaj`; cod de ieșire 1 dacă există vreuna.
// Comentariile și corpurile $$ … $$ sunt ignorate la detecție (dar grant-urile trebuie
// să fie instrucțiuni simple, nu EXECUTE format(...) într-un bloc DO).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const CONVENTION_SINCE = process.env.CHECK_MIGRATIONS_SINCE ?? '20261025';

const problems = [];
const report = (file, line, message) => problems.push(`${file}:${line} — ${message}`);

/** Înlocuiește comentariile și blocurile $$ cu spații, păstrând numerele de linie. */
function blank(text) {
  const keepNewlines = (s) => s.replace(/[^\n]/g, ' ');
  return text
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, keepNewlines)
    .replace(/\/\*[\s\S]*?\*\//g, keepNewlines)
    .replace(/--[^\n]*/g, keepNewlines);
}

// Acceptă `x`, `public.x`, `app.x`, `"x"`, `"public"."x"` (din 26 oct 2026 există și schema privată `app`;
// regulile de RLS/grant se aplică la fel acolo).
const qualified = String.raw`(?:"?[a-z_][a-z0-9_]*"?\.)?`;
const ident = String.raw`${qualified}"?([A-Za-z_][A-Za-z0-9_]*)"?`;
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Toate potrivirile unui regex pe textul curățat, cu linia. */
function findAll(text, regex) {
  const out = [];
  for (const m of text.matchAll(regex)) out.push({ name: m[1], line: lineOf(text, m.index), match: m });
  return out;
}

/** Există o instrucțiune GRANT/REVOKE pe obiectul `name` care numește rolul `role`? */
function hasPrivilegeStatement(text, kind, name, role) {
  // GRANT … ON [TABLE] name TO roluri   |   REVOKE … ON [TABLE] name FROM roluri
  const re = new RegExp(
    String.raw`\b${kind}\b[^;]*?\bON\s+(?:TABLE\s+)?${qualified}"?${name}"?\s+(?:TO|FROM)\s+([^;]*);`,
    'gi',
  );
  for (const m of text.matchAll(re)) {
    if (new RegExp(String.raw`\b${role}\b`, 'i').test(m[1])) return true;
  }
  return false;
}

function hasRls(text, name) {
  return new RegExp(
    String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${qualified}"?${name}"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY`,
    'i',
  ).test(text);
}

function hasFunctionRevokeFromPublic(text, name) {
  const re = new RegExp(
    String.raw`REVOKE\s+(?:EXECUTE|ALL(?:\s+PRIVILEGES)?)\s+ON\s+FUNCTION\s+${qualified}"?${name}"?\s*\([^)]*\)\s+FROM\s+([^;]*);`,
    'gi',
  );
  // Convenția: REVOKE … FROM PUBLIC, anon, authenticated, apoi GRANT selectiv. Cerem cel puțin
  // PUBLIC și anon în același REVOKE. Potrivirea e pe nume: orice overload o satisface.
  for (const m of text.matchAll(re)) {
    if (/\bPUBLIC\b/i.test(m[1]) && /\banon\b/i.test(m[1])) return true;
  }
  return false;
}

function checkFile(file) {
  const raw = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  const text = blank(raw);

  for (const t of findAll(text, new RegExp(String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${ident}`, 'gi'))) {
    if (!hasRls(text, t.name)) report(file, t.line, `tabelul ${t.name}: lipsește ENABLE ROW LEVEL SECURITY`);
    if (!hasPrivilegeStatement(text, 'REVOKE', t.name, 'anon') && !hasPrivilegeStatement(text, 'GRANT', t.name, 'anon')) {
      report(file, t.line, `tabelul ${t.name}: decide explicit pentru anon (REVOKE ALL … FROM anon sau GRANT … TO anon)`);
    }
    if (!hasPrivilegeStatement(text, 'GRANT', t.name, 'authenticated') && !hasPrivilegeStatement(text, 'REVOKE', t.name, 'authenticated')) {
      report(file, t.line, `tabelul ${t.name}: lipsește GRANT … TO authenticated (sau REVOKE explicit dacă nu e pentru client)`);
    }
    if (!hasPrivilegeStatement(text, 'GRANT', t.name, 'service_role')) {
      report(file, t.line, `tabelul ${t.name}: lipsește GRANT ALL … TO service_role`);
    }
  }

  for (const v of findAll(text, new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+${ident}`, 'gi'))) {
    const grantedToAnon = hasPrivilegeStatement(text, 'GRANT', v.name, 'anon');
    const grantedToAuth = hasPrivilegeStatement(text, 'GRANT', v.name, 'authenticated');
    if (!grantedToAnon && !grantedToAuth) report(file, v.line, `view-ul ${v.name}: lipsește GRANT SELECT … TO anon/authenticated`);
    if (grantedToAnon) {
      const def = text.slice(v.match.index, text.indexOf(';', v.match.index));
      if (!/security_invoker\s*=\s*(true|on)/i.test(def)) {
        report(file, v.line, `view-ul ${v.name} e dat lui anon fără security_invoker = true (ar ocoli RLS)`);
      }
    }
  }

  for (const f of findAll(text, new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+${ident}\s*\(`, 'gi'))) {
    // „Capul” funcției = de la CREATE până la `AS $…$` (corpul e deja albit de blank(), dar
    // marcajul `AS $$` rămâne); fără potrivire, până la primul `;`. Căutare insensibilă la
    // majuscule, altfel un `as $$` ar lăsa capul să înghită restul fișierului.
    const rest = text.slice(f.match.index);
    const asAt = rest.search(/\bAS\s+\$/i);
    const head = asAt >= 0 ? rest.slice(0, asAt) : rest.slice(0, Math.max(rest.indexOf(';'), 0));
    if (/RETURNS\s+trigger/i.test(head)) continue;
    if (!hasFunctionRevokeFromPublic(text, f.name)) {
      report(file, f.line, `funcția ${f.name}: lipsește REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon (+ authenticated)`);
    }
  }
}

// Helperele manuale (`_TEST_*`, `*_ALL_*`) stau în supabase/checks/ (gitignorate); aici sunt doar migrări.
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && !f.startsWith('_') && !/_TEST_|_ALL_/.test(f))
  .sort();

const versions = new Set();
for (const file of files) {
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(file)) report(file, 1, 'numele nu respectă YYYYMMDDHHMMSS_descriere.sql (14 cifre)');
  const version = file.slice(0, 14);
  if (versions.has(version)) report(file, 1, `versiunea ${version} e folosită de două fișiere (CLI-ul cere versiuni unice)`);
  versions.add(version);
  if (file.slice(0, 8) < CONVENTION_SINCE) continue;
  checkFile(file);
}

const checked = files.filter((f) => f.slice(0, 8) >= CONVENTION_SINCE).length;
if (problems.length > 0) {
  console.error(`check-migrations: ${problems.length} problemă(e) în ${checked} fișier(e) verificate:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-migrations: OK (${checked} fișier(e) verificate de la ${CONVENTION_SINCE}, ${files.length} în total)`);
