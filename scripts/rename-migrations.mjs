#!/usr/bin/env node
// Renumerotare unică a migrărilor (faza 0.1, PLAN_1.1_FIX, 25 oct 2026).
//
// De ce: fișierele aveau versiuni de 8 cifre (YYYYMMDD) și 18 date erau folosite de mai multe
// fișiere; CLI-ul Supabase cere versiuni unice (cheie primară în supabase_migrations.schema_migrations),
// altfel `migration repair`/`migration list` nu pot reprezenta istoricul. Noua versiune are 14 cifre:
// YYYYMMDD + HHMMSS, unde HHMMSS e un contor (000100, 000200, …) în ordinea REALĂ de aplicare din
// ziua respectivă — implicit lexicografică, cu excepțiile din ORDER_OVERRIDES (stabilite din
// antetele fișierelor: „rulează DUPĂ …”, „completează …”, numerotarea etapelor).
//
// Rulare: `node scripts/rename-migrations.mjs` (dry-run, afișează maparea);
//         `node scripts/rename-migrations.mjs --apply` (git mv pentru fișierele urmărite, rename
//         pentru cele neurmărite; același nume nou și pentru supabase/rollback/<nume>.sql).
// Idempotent: fișierele cu versiune de 14 cifre sunt lăsate în pace.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const ROLLBACK = join(ROOT, 'supabase', 'rollback');
const APPLY = process.argv.includes('--apply');

/** Ordinea explicită în zilele în care ordinea alfabetică NU e ordinea de aplicare. */
const ORDER_OVERRIDES = {
  '20260622': [
    'faza2_etapa21_truck_fields',
    'faza2_etapa24_profile_fields',
    'faza2_etapa26_cancelled_status', // adaugă 'cancelled' în CHECK …
    'faza2_etapa26_cancelled_fix', //    … apoi fix-ul care rescrie CHECK-ul indiferent de nume
  ],
  '20260715': [
    'faza13_etapa133_search_history', // comis 08:46, înaintea lotului faza14 (11:09)
    'faza14_e5_reports',
    'faza14_e7_read_receipts_rls',
    'faza14_e8_photo_limits',
    'faza14_e10_applications_updated_at',
    'faza14_e23_message_ops',
    'faza14_fix_push_token_claim', // 21:21
  ],
  '20260716': [
    'faza15_schema', // „Etapa 15.1: fundație schemă”
    'faza15_purge', // „DUPĂ 20260716_faza15_schema.sql”
    'faza15_search_hide_deleted', // „după 20260716_faza15_schema.sql”
    'faza15_channel_reads_realtime', // comis 20 iul
    'company_email_profile_fields', // comis 20 iul
    'faza16_etapa160_admin_schema',
    'faza16_etapa162_ban',
    'faza16_etapa163_reports',
    'faza16_etapa164_context',
    'faza16_etapa165_users',
    'faza16_etapa166_content',
    'faza16_etapa167_dashboard',
    'faza16_etapa168_admin_dual_role',
  ],
  '20260725': [
    'fix_unread_conversations_realtime', // comis 25 iul, înaintea lotului 195/196 (2 aug)
    'faza195_chat_attachments',
    'faza196_direct_share',
  ],
  '20260914': [
    'push_ios_threads_channel_cooldown', // introduce p_ios_title/p_ios_body în notify_push …
    'channel_push_digest', // … „DUPĂ 20260914_push_ios_threads_channel_cooldown”
  ],
  '20260926': [
    'security_hardening', // auditul din 26 sept …
    'hardening_defaults', // … „Completează 20260926_security_hardening.sql”
  ],
};

const isTracked = (relPath) => {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relPath], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const files = readdirSync(MIGRATIONS)
  .filter((f) => /^\d{8}_[a-z0-9_]+\.sql$/i.test(f))
  .sort();

const byDate = new Map();
for (const f of files) {
  const date = f.slice(0, 8);
  if (!byDate.has(date)) byDate.set(date, []);
  byDate.get(date).push(f.slice(9, -4)); // descrierea, fără dată și fără .sql
}

const mapping = [];
for (const [date, descs] of byDate) {
  let ordered = [...descs].sort();
  const override = ORDER_OVERRIDES[date];
  if (override) {
    const missing = descs.filter((d) => !override.includes(d));
    const extra = override.filter((d) => !descs.includes(d));
    if (missing.length || extra.length) {
      console.error(`ORDER_OVERRIDES[${date}] nu se potrivește cu fișierele: lipsesc ${JSON.stringify(missing)}, în plus ${JSON.stringify(extra)}`);
      process.exit(1);
    }
    ordered = override;
  }
  ordered.forEach((desc, i) => {
    const seq = String((i + 1) * 100).padStart(6, '0'); // 000100, 000200, …
    mapping.push({ from: `${date}_${desc}.sql`, to: `${date}${seq}_${desc}.sql` });
  });
}

const move = (dir, from, to) => {
  const rel = (name) => join(dir, name).replace(ROOT + '\\', '').replace(ROOT + '/', '').replace(/\\/g, '/');
  if (!existsSync(join(dir, from))) return 'absent';
  if (existsSync(join(dir, to))) throw new Error(`există deja: ${rel(to)}`);
  if (!APPLY) return 'dry-run';
  if (isTracked(rel(from))) {
    execFileSync('git', ['mv', rel(from), rel(to)], { cwd: ROOT, stdio: 'inherit' });
    return 'git mv';
  }
  renameSync(join(dir, from), join(dir, to));
  return 'rename (neurmărit)';
};

for (const { from, to } of mapping) {
  const m = move(MIGRATIONS, from, to);
  const r = move(ROLLBACK, from, to);
  console.log(`${from}  →  ${to}   [migrare: ${m}; rollback: ${r}]`);
}
console.log(`${mapping.length} fișiere${APPLY ? ' redenumite' : ' (dry-run; adaugă --apply)'}`);
