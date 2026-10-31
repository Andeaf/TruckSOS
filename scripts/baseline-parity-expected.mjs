#!/usr/bin/env node
// Transformă ieșirea JSON a `npx supabase db query --linked -f supabase/baseline/parity.sql` în fișierul
// text pe care CI-ul îl compară (diff) cu rezultatul aceleiași interogări pe Postgres-ul local:
//   npx supabase db query --linked -f supabase/baseline/parity.sql > <parity.json>
//   node scripts/baseline-parity-expected.mjs <parity.json> supabase/baseline/parity.expected.txt
// Un rând per linie, LF, UTF-8, în ordinea dată de interogare (COLLATE "C").

import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node scripts/baseline-parity-expected.mjs <parity.json> <parity.expected.txt>');
  process.exit(2);
}
const raw = readFileSync(inPath, 'utf8');
const json = JSON.parse(raw.slice(raw.indexOf('{')));
const lines = json.rows.map((r) => r.line);
for (const l of lines) if (/[\r\n]/.test(l)) throw new Error(`rând cu newline: ${l.slice(0, 80)}`);
writeFileSync(outPath, lines.join('\n') + '\n', { encoding: 'utf8' });
console.log(`parity: ${lines.length} rânduri → ${outPath}`);
