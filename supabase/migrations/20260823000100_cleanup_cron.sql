-- ─────────────────────────────────────────────────────────────────────────────
-- 23 aug 2026 — Expirare anunțuri la 72h + curățare poze (programare orară)
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (re-rulabilă).
--
-- Politica (decisă 23 aug, opțiunea „Expiră + doar pozele"):
--   • anunțurile `open` >72h → `cancelled` (dispar din feed; rândul RĂMÂNE —
--     istoricul șoferului și RLS-ul de rating cer existența lui);
--   • pozele anunțurilor >72h se șterg din Storage (minus cele `accepted` —
--     reparație în curs; se șterg după resolved/cancelled);
--   • logica trăiește în Edge Function-ul `cleanup-announcements` (ștergerea din
--     Storage se face prin API cu service_role — un DELETE pe storage.objects ar
--     lăsa fișierele pe S3, ocupând în continuare spațiul).
--
-- PAȘI ÎNAINTE de acest script (o singură dată):
--   1. Deploy funcția:  npx supabase functions deploy cleanup-announcements
--   2. Salvează cheia service_role în Vault (Studio → Project Settings → Vault →
--      Add new secret) cu numele EXACT:  service_role_key
--      (alternativ, în SQL:  select vault.create_secret('<CHEIA>', 'service_role_key');
--       — NU lăsa cheia într-un fișier!)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extensii (echivalent cu toggle-urile din Dashboard → Database → Extensions) ──
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 2. Job orar (minutul 17 — evită vârfurile de la ore fixe) ────────────────
-- cron.schedule cu același nume ÎNLOCUIEȘTE jobul existent → idempotent.
-- Cheia se citește din Vault LA FIECARE RULARE (nu e stocată în definiția jobului).
select cron.schedule(
  'cleanup-announcements-hourly',
  '17 * * * *',
  $JOB$
  select net.http_post(
    url     := 'https://shgagwnxgliixrzeibmt.supabase.co/functions/v1/cleanup-announcements',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'service_role_key' limit 1
      )
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $JOB$
);

-- ── 3. Verificări ────────────────────────────────────────────────────────────
-- a) Jobul există:
select jobname, schedule, active from cron.job where jobname = 'cleanup-announcements-hourly';
-- b) Secretul există (doar numele, nu valoarea):
select name, created_at from vault.secrets where name = 'service_role_key';
-- c) După prima rulare (sau declanșare manuală a comenzii din job): răspunsurile
--    HTTP se văd în net._http_response (id descrescător = cele mai noi):
--      select status_code, content from net._http_response order by id desc limit 3;
--    Așteptat: 200 cu {"ok":true,"expired":N,"photosRemoved":N,...}.
-- d) Test funcțional: un anunț `open` cu created_at împins în urmă cu 4 zile
--    (update de test) trebuie să devină `cancelled` și să-și piardă pozele la
--    rularea următoare; unul `accepted` rămâne neatins.
