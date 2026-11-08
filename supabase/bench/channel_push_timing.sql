-- Faza 3 (PLAN_1.1_FIX §3 „Teste”, condiția lui David din 25 oct 2026): MĂSURĂTORI la scară, RAPORTATE — nu asserturi.
--   (1) un mesaj în canal cu 10 000 de membri cu push → INSERT în channel_messages: ținta ≤ 50 ms
--       (azi, pe producție, 936–1 051 ms cu 836 de membri: AUDIT; după 3.1 trigger-ul scrie UN rând în app.channel_events);
--   (2) app.build_channel_digests() pentru acel eveniment (10 000 de digest-uri în app.push_queue): ținta < 2 s.
-- Rulează în CI (job db-tests, pasul „Faza 3: măsurători la scară”), ca postgres, pe baza locală cu TOATE migrările
-- aplicate, într-o singură tranzacție încheiată cu ROLLBACK: nimic nu rămâne pentru pgTAP. Niciodată pe producție.
-- Rulare: psql "$DB" -X -v ON_ERROR_STOP=1 -f supabase/bench/channel_push_timing.sql   (fără -q: liniile „Time:” ale
-- lui \timing și etichetele comenzilor sunt chiar rezultatul; ci.yml le citește cu awk).
-- Id-urile 75… nu se ciocnesc cu datele porții (a0/b0/c0/d0/e0…) și nici cu pgTAP (74…).
-- Fără faza 3 (main înainte de merge, alte branch-uri): sare cu un mesaj, exit 0.

SELECT (to_regclass('app.channel_events') IS NOT NULL) AS has_faza3 \gset
\if :has_faza3

BEGIN;
SET LOCAL statement_timeout = '180s';

-- ── Seed: 10 000 de conturi cu profil, push pornit și câte un token (digest-ul sare peste membrii fără token) ────
-- push_tokens are FK către auth.users → conturi GoTrue minimale (aceeași listă de coloane ca în supabase/tests/push_queue.test.sql).
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change,
                        phone_change_token, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
SELECT '00000000-0000-0000-0000-000000000000', ('75000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'authenticated', 'authenticated',
       'bench-' || g || '@example.com', '', now() - interval '40 days',
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now() - interval '40 days', now() - interval '40 days',
       '', '', '', '', '', '', '', '', false, false
  FROM generate_series(1, 10000) AS g;

-- created_at în trecut: since-join-ul (pr.created_at <= evenimentul) îi include pe toți.
INSERT INTO app.profiles (id, full_name, role, lang, push_enabled, mention_push_enabled, created_at)
SELECT ('75000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'Bench ' || g, 'driver',
       (ARRAY['ro', 'en', 'de'])[1 + g % 3], true, true, now() - interval '30 days'
  FROM generate_series(1, 10000) AS g;

INSERT INTO public.push_tokens (token, user_id, platform)
SELECT 'ExponentPushToken[bench-' || g || ']', ('75000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       CASE WHEN g % 2 = 0 THEN 'android' ELSE 'ios' END
  FROM generate_series(1, 10000) AS g;

-- Canalul: trigger-ul channels_seed_channel_push_prefs pune channel_push_prefs(enabled) pentru TOATE profilurile
-- existente (cele 10 000 + fixture-urile porții). Expeditorul e membrul 1 (exclus din propriul digest).
INSERT INTO public.channels (id, name, type) VALUES ('75555555-0000-4000-8000-000000000001', 'Bench canal', 'regional');

-- Statistici reale pentru planificator (tabele proaspăt umplute; pe producție există).
ANALYZE app.profiles, public.push_tokens, public.channel_push_prefs, public.channel_messages, public.channel_reads,
        public.channel_push_state, public.channels, app.channel_events, app.push_queue;

SELECT count(*) AS bench_members_with_push
  FROM public.channel_push_prefs p
  JOIN app.profiles pr ON pr.id = p.user_id AND pr.push_enabled
 WHERE p.channel_id = '75555555-0000-4000-8000-000000000001' AND p.enabled;

-- ── (1) INSERT în channel_messages — ținta ≤ 50 ms ───────────────────────────────────────────────────────────────
\echo bench: INSERT channel_messages (10 000 membri)
\timing on
INSERT INTO public.channel_messages (id, channel_id, sender_id, content)
VALUES ('75999999-0000-4000-8000-000000000001', '75555555-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001', 'Bench: un mesaj în canal');
\timing off

SELECT count(*) AS bench_channel_events
  FROM app.channel_events WHERE channel_id = '75555555-0000-4000-8000-000000000001';

-- ── (2) build_channel_digests() — ținta < 2 s; întoarce numărul de rânduri puse în coadă (așteptat 9 999) ─────────
\echo bench: build_channel_digests()
\timing on
SELECT app.build_channel_digests() AS bench_digest_rows;
\timing off

SELECT count(*) AS bench_push_queue_rows
  FROM app.push_queue WHERE tag = 'channel-75555555-0000-4000-8000-000000000001';

ROLLBACK;

\else
\echo bench: faza 3 nu e aplicata (lipseste app.channel_events) -> masuratoarea e sarita
\endif
