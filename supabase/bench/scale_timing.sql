-- Faza 10 (PLAN_1.1_FIX §3 „Faza 10”, 10.1 + 10.2; cererea lui David din 12 nov 2026): TESTE LA SCARĂ, în CI, pe baza
-- efemeră — niciodată local pe datele cuiva și NICIODATĂ pe producție. Seed mare, apoi interogările grele cronometrate.
-- Rezultatele sunt RAPORTATE (linii `BENCH|…`, citite de ci.yml); pragurile din plan dau doar avertismente, nu eșec.
--
-- Seed-ul (ținta din plan, 10.1): 50 000 de conturi cu profil (20 % mecanici, coordonate în România, rază 50–300 km),
-- 5 000 de anunțuri deschise + 100 000 istorice, 20 000 de conversații cu 200 000 de mesaje (+ 12 000 ale utilizatorului
-- „greu”), 30 000 de mesaje în canal, channel_push_prefs și token de push pentru toți. Triggerele de utilizator sunt oprite
-- pe durata seed-ului (altfel fiecare rând ar pune notificări în coadă) și repornite înainte de măsurători.
--
-- Utilizatorul „greu” H (șofer, …0001): 202 conversații (primele 200 + două nimerite de formula seed-ului; 100 cu cursor
-- de citire, restul niciodată deschise → 610 necitite), 13 000 de mesaje trimise (exportul atinge plafonul de 10 000),
-- 300 de anunțuri istorice.
--
-- Măsurătorile rulează cu rolul REAL: `authenticated` + request.jwt.claims pentru apelurile clientului (ca postgres
-- auth.uid() e NULL și totul ar întoarce gol în 1 ms), postgres pentru joburile de server (digest, claim, retenție).
-- Fiecare măsurătoare de citire rulează de două ori: prima (cache rece, cu planificare) și cea mai bună.
-- Pragurile din plan (10.2) sunt p95 k6 la 200 de utilizatori simultani; aici e O SINGURĂ interogare pe o bază fără altă
-- încărcare, deci cifra e un minim, nu un p95 — e scris așa și în raport.
--
-- O singură tranzacție încheiată cu ROLLBACK: nimic nu rămâne în bază (în CI e ultimul pas, după pgTAP).
-- GARDĂ CONTRA PRODUCȚIEI: scriptul refuză să pornească fără `-v bench_ephemeral=1` și pe o bază cu peste 200 de
-- conturi (baza din CI are doar fixture-urile porții). Pe o bază reală `DISABLE TRIGGER USER` ar ține blocate scrierile
-- pe profiluri, anunțuri, conversații și mesaje cât durează seed-ul și măsurătorile.
-- Rulare: psql "$DB" -X -v ON_ERROR_STOP=1 -v bench_ephemeral=1 -f supabase/bench/scale_timing.sql
-- Id-urile 76… nu se ciocnesc cu poarta (a0…e0), cu bench-ul fazei 3 (75…) sau cu pgTAP.

\if :{?bench_ephemeral}
\else
  \echo 'bench: REFUZ - lipseste -v bench_ephemeral=1 (scriptul ruleaza DOAR pe baza efemera din CI, niciodata pe productie)'
  DO $$ BEGIN RAISE EXCEPTION 'scale_timing.sql: lipseste -v bench_ephemeral=1'; END $$;
\endif
SELECT ((SELECT count(*) FROM auth.users) > 200) AS bench_real_db \gset
\if :bench_real_db
  \echo 'bench: REFUZ - baza are peste 200 de conturi: nu e baza efemera din CI'
  DO $$ BEGIN RAISE EXCEPTION 'scale_timing.sql: baza are peste 200 de conturi (nu e baza efemera din CI)'; END $$;
\endif

SELECT (to_regclass('app.profiles') IS NOT NULL AND to_regclass('app.announcements') IS NOT NULL) AS has_faza4 \gset
\if :has_faza4

BEGIN;
SET LOCAL statement_timeout = '600s';
SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE bench_results (
  seq serial, label text, target_ms numeric, ms_first numeric, ms_best numeric, n bigint, note text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.u(g integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('76000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid $$;

-- ── Seed ────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.profiles            DISABLE TRIGGER USER;
ALTER TABLE app.announcements       DISABLE TRIGGER USER;
ALTER TABLE public.conversations    DISABLE TRIGGER USER;
ALTER TABLE public.messages         DISABLE TRIGGER USER;
ALTER TABLE public.channel_messages DISABLE TRIGGER USER;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change,
                        phone_change_token, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
SELECT '00000000-0000-0000-0000-000000000000', pg_temp.u(g), 'authenticated', 'authenticated',
       'scale-' || g || '@example.com', '', now() - interval '400 days',
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now() - interval '400 days', now() - interval '400 days',
       '', '', '', '', '', '', '', '', false, false
  FROM generate_series(1, 50000) AS g;

-- 20 % mecanici (g multiplu de 5), cu poziție și rază; șoferii fără poziție. Coordonate deterministe în România.
INSERT INTO app.profiles (id, full_name, role, lang, push_enabled, mention_push_enabled, created_at, latitude, longitude, notify_radius_km)
SELECT pg_temp.u(g), 'Scale ' || g, CASE WHEN g % 5 = 0 THEN 'mechanic' ELSE 'driver' END,
       (ARRAY['ro', 'en', 'de'])[1 + g % 3], true, true, now() - interval '400 days',
       CASE WHEN g % 5 = 0 THEN 43.7 + ((g::bigint * 7919) % 4500) / 1000.0 END,
       CASE WHEN g % 5 = 0 THEN 20.3 + ((g::bigint * 104729) % 9300) / 1000.0 END,
       CASE WHEN g % 5 = 0 THEN 50 + g % 251 END
  FROM generate_series(1, 50000) AS g;

INSERT INTO public.push_tokens (token, user_id, platform)
SELECT 'ExponentPushToken[scale-' || g || ']', pg_temp.u(g), CASE WHEN g % 2 = 0 THEN 'android' ELSE 'ios' END
  FROM generate_series(1, 50000) AS g;

-- 5 000 de anunțuri deschise (ultimele 20 de ore; cel mult unul per șofer) + 100 000 istorice (ultimul an; primele 300 ale lui H)
INSERT INTO app.announcements (driver_id, description, location, status, created_at, updated_at, latitude, longitude, truck_make)
SELECT pg_temp.u(5 * (a % 9000) + 2), 'Scale anunț deschis ' || a, 'Scale loc ' || a, 'open',
       now() - (a % 1200) * interval '1 minute', now() - (a % 1200) * interval '1 minute',
       43.7 + ((a::bigint * 7919) % 4500) / 1000.0, 20.3 + ((a::bigint * 104729) % 9300) / 1000.0, 'MAN'
  FROM generate_series(1, 5000) AS a;
INSERT INTO app.announcements (driver_id, description, location, status, created_at, updated_at, latitude, longitude, plate_number, chassis_number)
SELECT CASE WHEN a <= 300 THEN pg_temp.u(1) ELSE pg_temp.u(5 * (a % 9000) + 3) END,
       'Scale anunț istoric ' || a, 'Scale loc ' || a, CASE WHEN a % 2 = 0 THEN 'resolved' ELSE 'cancelled' END,
       now() - (2 + a % 365) * interval '1 day', now() - (1 + a % 365) * interval '1 day',
       43.7 + ((a::bigint * 7919) % 4500) / 1000.0, 20.3 + ((a::bigint * 104729) % 9300) / 1000.0, 'B-' || a, 'VIN' || a
  FROM generate_series(1, 100000) AS a;

-- 20 000 de conversații: primele 200 ale lui H (cu 200 de mecanici diferiți), restul între șoferi și mecanici oarecare
CREATE TEMP TABLE bench_conv ON COMMIT DROP AS
SELECT n, ('76333333-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid AS id,
       CASE WHEN n <= 200 THEN pg_temp.u(1) ELSE pg_temp.u(5 * (n % 9000) + 1 + n % 4) END AS driver_id,
       CASE WHEN n <= 200 THEN pg_temp.u(5 * n) ELSE pg_temp.u(5 * (1 + (n::bigint * 7) % 10000)::integer) END AS mechanic_id
  FROM generate_series(1, 20000) AS n;
INSERT INTO public.conversations (id, driver_id, mechanic_id, is_direct, announcement_id, created_at)
SELECT id, driver_id, mechanic_id, false, null, now() - interval '330 days' FROM bench_conv;

-- 200 000 de mesaje: 10 per conversație, la 30 de zile distanță; mecanicul scrie j = 0, 2, 4, 6, 8, șoferul restul
INSERT INTO public.messages (conversation_id, sender_id, content, created_at)
SELECT c.id, CASE WHEN j % 2 = 0 THEN c.mechanic_id ELSE c.driver_id END, 'Scale mesaj ' || j,
       now() - (10 - j) * interval '30 days' + c.n * interval '1 second'
  FROM bench_conv c CROSS JOIN generate_series(0, 9) AS j;
-- + 12 000 de mesaje ale lui H (60 în fiecare dintre conversațiile lui) → 13 000 trimise: exportul atinge plafonul de 10 000
INSERT INTO public.messages (conversation_id, sender_id, content, created_at)
SELECT c.id, c.driver_id, 'Scale mesaj H ' || k, now() - interval '200 days' + (c.n * 60 + k) * interval '1 minute'
  FROM bench_conv c CROSS JOIN generate_series(1, 60) AS k
 WHERE c.n <= 200;
-- H a citit jumătate dintre conversații până acum 100 de zile (rămâne 1 necitit în fiecare); cealaltă jumătate niciodată (5)
INSERT INTO public.message_reads (conversation_id, user_id, last_read_at)
SELECT id, driver_id, now() - interval '100 days' FROM bench_conv WHERE n <= 100;

-- canalul: trigger-ul de pe channels pune channel_push_prefs pentru TOATE profilurile; apoi 30 000 de mesaje în 28 de zile
INSERT INTO public.channels (id, name, type) VALUES ('76555555-0000-4000-8000-000000000001', 'Scale canal', 'regional');
INSERT INTO public.channel_messages (channel_id, sender_id, content, created_at)
SELECT '76555555-0000-4000-8000-000000000001', pg_temp.u(1 + ((g::bigint * 13) % 50000)::integer), 'Scale canal ' || g,
       now() - interval '28 days' + g * interval '80 seconds'
  FROM generate_series(1, 30000) AS g;

ALTER TABLE app.profiles            ENABLE TRIGGER USER;
ALTER TABLE app.announcements       ENABLE TRIGGER USER;
ALTER TABLE public.conversations    ENABLE TRIGGER USER;
ALTER TABLE public.messages         ENABLE TRIGGER USER;
ALTER TABLE public.channel_messages ENABLE TRIGGER USER;

ANALYZE app.profiles, app.announcements, public.conversations, public.messages, public.message_reads, public.channel_messages,
        public.channel_reads, public.channel_push_prefs, public.push_tokens, public.channels, public.conversation_deletions;

INSERT INTO bench_results (label, ms_first, n, note)
SELECT 'seed', round(1000 * extract(epoch FROM clock_timestamp() - now())::numeric, 0),
       (SELECT count(*) FROM app.profiles WHERE full_name LIKE 'Scale %'),
       'profiluri=' || (SELECT count(*) FROM app.profiles WHERE full_name LIKE 'Scale %')
       || ' anunturi_deschise=' || (SELECT count(*) FROM app.announcements WHERE status = 'open' AND description LIKE 'Scale %')
       || ' anunturi_istorice=' || (SELECT count(*) FROM app.announcements WHERE status <> 'open' AND description LIKE 'Scale %')
       || ' conversatii=' || (SELECT count(*) FROM bench_conv)
       || ' mesaje=' || (SELECT count(*) FROM public.messages m JOIN bench_conv c ON c.id = m.conversation_id)
       || ' mesaje_canal=' || (SELECT count(*) FROM public.channel_messages WHERE channel_id = '76555555-0000-4000-8000-000000000001')
       || ' prefs_canal=' || (SELECT count(*) FROM public.channel_push_prefs WHERE channel_id = '76555555-0000-4000-8000-000000000001');

-- ── Unealta de măsurat ──────────────────────────────────────────────────────────────────────────────────────────
-- p_uid NULL = ca postgres (job de server); altfel ca `authenticated` cu acel cont. p_sql întoarce UN bigint (numărul de
-- rânduri / octeți). p_requires = funcția de care depinde măsurătoarea (lipsește → „SARIT”). O eroare (inclusiv
-- statement_timeout) e notată și măsurătorile următoare continuă.
CREATE FUNCTION pg_temp.bench(p_label text, p_target_ms numeric, p_uid uuid, p_sql text,
                              p_runs integer DEFAULT 2, p_requires text DEFAULT NULL, p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  t0 timestamptz;
  v_n bigint;
  v_ms numeric;
  v_first numeric;
  v_best numeric;
  v_err text;
  i integer;
BEGIN
  IF p_requires IS NOT NULL AND to_regprocedure(p_requires) IS NULL THEN
    INSERT INTO bench_results (label, target_ms, note) VALUES (p_label, p_target_ms, 'SARIT: lipseste ' || p_requires);
    RETURN;
  END IF;
  FOR i IN 1..p_runs LOOP
    BEGIN
      IF p_uid IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
        EXECUTE 'SET LOCAL ROLE authenticated';
      END IF;
      t0 := clock_timestamp();
      EXECUTE p_sql INTO v_n;
      v_ms := round(1000 * extract(epoch FROM clock_timestamp() - t0)::numeric, 1);
      EXECUTE 'RESET ROLE';
      PERFORM set_config('request.jwt.claims', '', true);
      IF v_first IS NULL THEN v_first := v_ms; END IF;
      IF v_best IS NULL OR v_ms < v_best THEN v_best := v_ms; END IF;
    EXCEPTION WHEN query_canceled OR others THEN
      -- anularea sub-tranzacției readuce și rolul, și claims-urile
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      EXIT;
    END;
  END LOOP;
  INSERT INTO bench_results (label, target_ms, ms_first, ms_best, n, note)
  VALUES (p_label, p_target_ms, v_first, v_best, v_n,
          CASE WHEN v_err IS NOT NULL THEN 'EROARE: ' || left(v_err, 200) ELSE p_note END);
END;
$fn$;

SET LOCAL statement_timeout = '120s';

-- ── Măsurătorile clientului (rol authenticated) ─────────────────────────────────────────────────────────────────
-- 1. Feed pe rază: mecanicul …0005, 150 km în jurul Bucureștiului, prima pagină (50)
SELECT pg_temp.bench('feed pe raza: open_announcements_near(150 km, 50)', 300, pg_temp.u(5),
  $q$ SELECT count(*) FROM public.open_announcements_near(44.43, 26.10, 150, 50) $q$, 2,
  'public.open_announcements_near(double precision, double precision, double precision, integer, timestamp with time zone)',
  'prag plan: feed p95 <= 300 ms (k6, 200 VU)');
SELECT pg_temp.bench('bulina feed: open_announcements_near_count(150 km)', 300, pg_temp.u(5),
  $q$ SELECT public.open_announcements_near_count(44.43, 26.10, 150, now() - interval '1 day')::bigint $q$, 2,
  'public.open_announcements_near_count(double precision, double precision, double precision, timestamp with time zone)',
  'prag plan: feed p95 <= 300 ms');

-- 2. Bulinele conversațiilor: RPC-ul fazei 5 și, pentru comparație, numărătoarea veche scrisă ca o singură interogare
--    prin RLS (clientul 1.0.x o face în până la 200 de cereri separate, deci costul lui real e mai mare)
SELECT pg_temp.bench('bulina: unread_counts() - H, 200 conversatii', 100, pg_temp.u(1),
  $q$ SELECT count(*) FROM public.unread_counts() $q$, 2, 'public.unread_counts()',
  'prag plan: bulina p95 <= 100 ms; asteptat 202 randuri');
SELECT pg_temp.bench('bulina (inainte): numaratoarea veche prin RLS, intr-o singura interogare', 100, pg_temp.u(1),
  $q$ SELECT count(*)
        FROM public.conversations c
        LEFT JOIN public.message_reads r ON r.conversation_id = c.id AND r.user_id = auth.uid()
       CROSS JOIN LATERAL (SELECT count(*) AS k FROM public.messages m
                            WHERE m.conversation_id = c.id AND m.sender_id <> auth.uid() AND m.deleted_at IS NULL
                              AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)) x
       WHERE (c.driver_id = auth.uid() OR c.mechanic_id = auth.uid()) AND x.k > 0 $q$, 2, NULL,
  'referinta: clientul 1.0.x face asta in <= 200 de cereri');
SELECT pg_temp.bench('bulina canal: channel_unread_count() - 30 000 de mesaje', 100, pg_temp.u(1),
  $q$ SELECT public.channel_unread_count('76555555-0000-4000-8000-000000000001')::bigint $q$, 2,
  'public.channel_unread_count(uuid)', 'prag plan: bulina p95 <= 100 ms; asteptat 100 (plafon)');

-- 3. Chat: ultima pagină de 50 a unei conversații a lui H, prin RLS (fără embed-urile PostgREST)
SELECT pg_temp.bench('chat: ultimele 50 de mesaje ale unei conversatii (RLS)', 150, pg_temp.u(1),
  $q$ SELECT count(*) FROM (SELECT m.id FROM public.messages m
                             WHERE m.conversation_id = '76333333-0000-4000-8000-000000000001'
                             ORDER BY m.created_at DESC LIMIT 50) x $q$, 2, NULL, 'prag plan: chat p95 <= 150 ms');
SELECT pg_temp.bench('INSERT mesaj privat (RLS + triggere)', 200, pg_temp.u(1),
  $q$ WITH i AS (INSERT INTO public.messages (conversation_id, sender_id, content)
                 VALUES ('76333333-0000-4000-8000-000000000001', auth.uid(), 'Scale: mesaj nou') RETURNING 1)
      SELECT count(*) FROM i $q$, 1, NULL, 'prag plan: INSERT mesaj p95 <= 200 ms');

-- 4. Căutarea de mecanici (10 000 de mecanici)
SELECT pg_temp.bench('cautare: search_mechanics(''Scale 12'')', 200, pg_temp.u(1),
  $q$ SELECT count(*) FROM public.search_mechanics('Scale 12') $q$, 2, 'public.search_mechanics(text)',
  'prag plan: cautare p95 <= 200 ms');

-- 5. Exportul datelor lui H (13 000 de mesaje trimise → plafonul de 10 000; cota e 2 / 24 h, deci exact două rulări)
SELECT pg_temp.bench('export_my_data() - H (octeti)', NULL, pg_temp.u(1),
  $q$ SELECT octet_length(public.export_my_data()::text)::bigint $q$, 2, 'public.export_my_data()', 'fara prag in plan');

-- 6. Un mesaj în canalul cu 50 000 de membri, trimis de client (RLS + triggere), apoi digest-ul lui (job de server)
SELECT pg_temp.bench('INSERT channel_messages (canal cu 50 000 de membri; RLS + triggere)', 50, pg_temp.u(1),
  $q$ WITH i AS (INSERT INTO public.channel_messages (channel_id, sender_id, content)
                 VALUES ('76555555-0000-4000-8000-000000000001', auth.uid(), 'Scale: mesaj nou in canal')
                 RETURNING 1)
      SELECT count(*) FROM i $q$, 1, NULL, 'prag plan: INSERT in canal <= 50 ms');

-- ── Joburile de server (postgres) ───────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.bench('digest de canal: build_channel_digests() - 50 000 de membri', 2000, NULL,
  $q$ SELECT app.build_channel_digests()::bigint $q$, 1, 'app.build_channel_digests()',
  'prag faza 3: < 2 s la 10 000 de membri (aici sunt 50 000)');

-- Coada tocmai a primit ~50 000 de rânduri: statistici proaspete, ca pe producție după autovacuum (nemăsurat) — altfel
-- claim-ul ar fi cronometrat cu un plan făcut pentru o coadă goală.
DO $$
BEGIN
  IF to_regclass('app.push_queue') IS NOT NULL THEN EXECUTE 'ANALYZE app.push_queue'; END IF;
  IF to_regclass('app.channel_events') IS NOT NULL THEN EXECUTE 'ANALYZE app.channel_events'; END IF;
END $$;

-- 7. claim_push_batch pe coada umplută de digest
SELECT pg_temp.bench('claim_push_batch(100)', NULL, NULL,
  $q$ SELECT count(*) FROM public.claim_push_batch(100) $q$, 1, 'public.claim_push_batch(integer)', 'fara prag in plan');
SELECT pg_temp.bench('claim_push_batch(1000)', NULL, NULL,
  $q$ SELECT count(*) FROM public.claim_push_batch(1000) $q$, 1, 'public.claim_push_batch(integer)', 'fara prag in plan');

-- 8. Retenția, dry-run (p_dry_run = true: doar numără; rezumatul apare ca NOTICE în log)
SELECT pg_temp.bench('apply_retention(dry-run) - 100 000 de anunturi istorice (chei in rezumat)', NULL, NULL,
  $q$ SELECT count(*) FROM jsonb_object_keys(app.apply_retention(true)) $q$, 1, 'app.apply_retention(boolean)', 'fara prag in plan');

-- ── Rezultatele ─────────────────────────────────────────────────────────────────────────────────────────────────
\pset format unaligned
\pset tuples_only on
SELECT 'BENCH|' || label || '|' || coalesce(ms_first::text, '-') || '|' || coalesce(ms_best::text, '-') || '|'
       || coalesce(n::text, '-') || '|' || coalesce(target_ms::text, '-') || '|' || coalesce(note, '')
  FROM bench_results ORDER BY seq;
\pset tuples_only off
\pset format aligned

ROLLBACK;

\else
\echo bench: faza 4 nu e aplicata (lipseste app.profiles) -> masuratorile la scara sunt sarite
\endif
