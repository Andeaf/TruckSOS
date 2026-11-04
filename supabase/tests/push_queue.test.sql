-- pgTAP: faza 3 (PLAN_1.1_FIX #6, #31, #4, #24; migrările 20261102000100_push_queue + 20261102000200_reports_moderation):
-- push prin coadă, digest-ul canalului set-based, anunț nou set-based, RPC-urile EF, rapoarte și moderare.
-- Cron-ul nu rulează în test: funcțiile sunt apelate direct. Id-urile 74… nu se ciocnesc cu datele porții / celelalte teste.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

create function pg_temp.as_user(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
end $$;
-- cozile rândurilor NOASTRE (user_id în fixture) — datele porții pot avea și ele rânduri
create function pg_temp.q(p_user uuid) returns setof app.push_queue language sql as $$
  select * from app.push_queue where user_id = p_user order by id $$;

-- ── Fixture ────────────────────────────────────────────────────────────────────────────────────
-- push_tokens are FK către auth.users → conturi minimale (ca în supabase/gate/fixtures.sql)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change,
                        phone_change_token, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now() - interval '40 days',
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now() - interval '40 days', now() - interval '40 days',
       '', '', '', '', '', '', '', '', false, false
  from (values
    ('74000000-0000-4000-8000-0000000000a1'::uuid, 'q-driver-a@example.com'),
    ('74000000-0000-4000-8000-0000000000b1', 'q-banned-b@example.com'),
    ('74000000-0000-4000-8000-0000000000c1', 'q-mech-1@example.com'),
    ('74000000-0000-4000-8000-0000000000c2', 'q-mech-2@example.com'),
    ('74000000-0000-4000-8000-0000000000c3', 'q-mech-3@example.com'),
    ('74000000-0000-4000-8000-0000000000c4', 'q-mech-4@example.com'),
    ('74000000-0000-4000-8000-0000000000d1', 'q-admin@example.com'),
    ('74000000-0000-4000-8000-0000000000e1', 'q-member-1@example.com'),
    ('74000000-0000-4000-8000-0000000000e2', 'q-member-2@example.com'),
    ('74000000-0000-4000-8000-0000000000e3', 'q-member-3@example.com'),
    ('74000000-0000-4000-8000-0000000000e4', 'q-member-notoken@example.com')
  ) as u(id, email);

insert into app.profiles (id, full_name, role, phone, lang, push_enabled, mention_push_enabled, notify_radius_km, latitude, longitude, banned_at, created_at)
values
  ('74000000-0000-4000-8000-0000000000a1', 'Q Driver A',    'driver',   '+40700000001', 'ro', true,  true,  null, 44.43, 26.10, null, now() - interval '30 days'),
  ('74000000-0000-4000-8000-0000000000b1', 'Q Banned B',    'driver',   '+40700000002', 'ro', true,  true,  null, null,  null,  now(), now() - interval '30 days'),
  ('74000000-0000-4000-8000-0000000000c1', 'Q Mech 1 Buc',  'mechanic', '+40700000011', 'en', true,  true,  50,   44.45, 26.12, null, now() - interval '30 days'),
  ('74000000-0000-4000-8000-0000000000c2', 'Q Mech 2 Cluj', 'mechanic', '+40700000012', 'ro', true,  true,  50,   46.77, 23.60, null, now() - interval '30 days'),
  ('74000000-0000-4000-8000-0000000000c3', 'Q Mech 3 Oriunde', 'mechanic', '+40700000013', 'de', true, true, null, null, null,  null, now() - interval '30 days'),
  ('74000000-0000-4000-8000-0000000000c4', 'Q Mech 4 Push off', 'mechanic', '+40700000014', 'ro', false, true, null, 44.43, 26.10, null, now() - interval '30 days'),
  ('74000000-0000-4000-8000-0000000000d1', 'Q Admin',       'admin',    '+40700000099', 'ro', true,  true,  null, null,  null,  null, now() - interval '30 days'),
  ('74000000-0000-4000-8000-0000000000e1', 'Q Member 1',    'driver',   '+40700000021', 'ro', true,  true,  null, null,  null,  null, now() - interval '30 days'),
  ('74000000-0000-4000-8000-0000000000e2', 'Q Member 2',    'driver',   '+40700000022', 'en', true,  true,  null, null,  null,  null, now() - interval '30 days'),
  ('74000000-0000-4000-8000-0000000000e3', 'Q Member 3 citit', 'driver', '+40700000023', 'ro', true, true,  null, null,  null,  null, now() - interval '30 days'),
  ('74000000-0000-4000-8000-0000000000e4', 'Q Member 4 fara token', 'driver', '+40700000024', 'ro', true, true, null, null, null, null, now() - interval '30 days');

insert into public.push_tokens (token, user_id, platform) values
  ('ExponentPushToken[q-a1]',  '74000000-0000-4000-8000-0000000000a1', 'android'),
  ('ExponentPushToken[q-b1]',  '74000000-0000-4000-8000-0000000000b1', 'android'),
  ('ExponentPushToken[q-c1a]', '74000000-0000-4000-8000-0000000000c1', 'ios'),
  ('ExponentPushToken[q-c1b]', '74000000-0000-4000-8000-0000000000c1', 'android'),
  ('ExponentPushToken[q-c2]',  '74000000-0000-4000-8000-0000000000c2', 'android'),
  ('ExponentPushToken[q-c3]',  '74000000-0000-4000-8000-0000000000c3', 'ios'),
  ('ExponentPushToken[q-c4]',  '74000000-0000-4000-8000-0000000000c4', 'android'),
  ('ExponentPushToken[q-d1]',  '74000000-0000-4000-8000-0000000000d1', 'ios'),
  ('ExponentPushToken[q-e1]',  '74000000-0000-4000-8000-0000000000e1', 'android'),
  ('ExponentPushToken[q-e2]',  '74000000-0000-4000-8000-0000000000e2', 'ios'),
  ('ExponentPushToken[q-e3]',  '74000000-0000-4000-8000-0000000000e3', 'android');

-- canalul: trigger-ul seed pune channel_push_prefs(enabled) pentru toate profilurile existente
insert into public.channels (id, name, type) values ('74444444-0000-4000-8000-000000000001', 'Q canal', 'regional');
-- M3 a citit totul abia ce vine; U3 citește după mesaje (mai jos)

-- ── 1–4. notify_push → coadă ───────────────────────────────────────────────────────────────────────
select public.notify_push('74000000-0000-4000-8000-0000000000a1', 'T', 'B', '{"type":"conversation","id":"x"}'::jsonb, 'conversation-x', 'iT', 'iB');
select is((select status || '|' || title || '|' || body || '|' || (data->>'type') || '|' || tag || '|' || ios_title || '|' || ios_body || '|' || attempts::text
             from pg_temp.q('74000000-0000-4000-8000-0000000000a1')),
          'queued|T|B|conversation|conversation-x|iT|iB|0', '1. notify_push pune un rând queued cu toate câmpurile');
select public.notify_push('74000000-0000-4000-8000-0000000000c4', 'T', 'B');
select is((select count(*)::int from pg_temp.q('74000000-0000-4000-8000-0000000000c4')), 0, '2. push_enabled = false → niciun rând');
select public.notify_push('74000000-0000-4000-8000-0000000000b1', 'T', 'B');
select is((select count(*)::int from pg_temp.q('74000000-0000-4000-8000-0000000000b1')), 0, '3. cont banat → niciun rând');
select public.notify_push('74000000-0000-4000-8000-0000000000e4', 'T', 'B');
select is((select count(*)::int from pg_temp.q('74000000-0000-4000-8000-0000000000e4')), 0, '4. fără tokeni → niciun rând');

-- ── 5–11. Canal: eveniment + mențiune imediată + digest set-based ──────────────────────────────────
insert into public.channel_messages (id, channel_id, sender_id, content, created_at)
values ('74999999-0000-4000-8000-000000000001', '74444444-0000-4000-8000-000000000001', '74000000-0000-4000-8000-0000000000a1', 'Q primul mesaj', now() - interval '50 seconds');
select is((select count(*)::int from app.channel_events where channel_id = '74444444-0000-4000-8000-000000000001'), 1,
          '5. mesaj în canal → un eveniment, fără push imediat');
select is((select count(*)::int from app.push_queue where tag like 'channel-%' and user_id::text like '74000000-%'), 0,
          '5b. … și niciun rând de digest încă (vine din cron)');
insert into public.channel_messages (id, channel_id, sender_id, content, mentions, created_at)
values ('74999999-0000-4000-8000-000000000002', '74444444-0000-4000-8000-000000000001', '74000000-0000-4000-8000-0000000000a1', 'Q al doilea, cu mentiune',
        '[{"id":"74000000-0000-4000-8000-0000000000e1","name":"Q Member 1"}]'::jsonb, now() - interval '40 seconds');
select is((select title || '|' || body || '|' || tag || '|' || (data->>'kind') from pg_temp.q('74000000-0000-4000-8000-0000000000e1')),
          'Q Driver A te-a menționat|Q al doilea, cu mentiune|mention-74444444-0000-4000-8000-000000000001|mention',
          '6. mențiunea pleacă imediat prin coadă, ca azi (titlu, corp, tag, kind)');
select is((select count(*)::int from app.channel_events where channel_id = '74444444-0000-4000-8000-000000000001'), 2,
          '7. și mesajul cu mențiune lasă un eveniment pentru digest');
-- U3 a citit tot după al doilea mesaj
insert into public.channel_reads (channel_id, user_id, last_read_at)
values ('74444444-0000-4000-8000-000000000001', '74000000-0000-4000-8000-0000000000e3', now() - interval '30 seconds');

select app.build_channel_digests();
select is((select count(*)::int from app.channel_events where channel_id = '74444444-0000-4000-8000-000000000001'), 0, '8. digest-ul consumă evenimentele');
select is((select title || '|' || body || '|' || tag || '|' || (data->>'type') || '|' || ios_title || '|' || ios_body
             from pg_temp.q('74000000-0000-4000-8000-0000000000e2') where tag like 'channel-%'),
          'TruckSOS Community (2)|Q Driver A: Q primul mesaj' || E'\n' || 'Q Driver A: Q al doilea, cu mentiune|channel-74444444-0000-4000-8000-000000000001|channel|TruckSOS Community (2)|Q Driver A: Q al doilea, cu mentiune',
          '9. membrul obișnuit primește digest-ul: titlu cu numărul, ultimele linii în ordine, iOS = linia cea mai nouă, în limba lui');
select is((select count(*)::int from pg_temp.q('74000000-0000-4000-8000-0000000000e1') where tag like 'channel-%'), 0,
          '10. cel menționat adineauri e în cooldown (push-ul lui tocmai a plecat) → fără digest, ca azi');
select is((select count(*)::int from pg_temp.q('74000000-0000-4000-8000-0000000000e3') where tag like 'channel-%'), 0,
          '11. cine a citit canalul după mesaje nu primește digest');
select is((select count(*)::int from pg_temp.q('74000000-0000-4000-8000-0000000000a1') where tag like 'channel-%'), 0,
          '12. expeditorul nu primește digest');
select is((select count(*)::int from pg_temp.q('74000000-0000-4000-8000-0000000000e4') where tag like 'channel-%'), 0,
          '13. membrul fără tokeni nu primește rând, dar cursorul lui de push se mută (ca azi)');
select ok((select last_pushed_at > now() - interval '5 seconds' from public.channel_push_state
             where user_id = '74000000-0000-4000-8000-0000000000e4' and channel_id = '74444444-0000-4000-8000-000000000001'),
          '13b. channel_push_state actualizat pentru membrul fără tokeni');
select is(app.build_channel_digests(), 0, '14. a doua rulare, fără evenimente noi, nu trimite nimic');

-- ── 15–16. Anunț nou → mecanici, set-based ─────────────────────────────────────────────────────────
insert into app.announcements (id, driver_id, description, location, status, created_at, latitude, longitude)
values ('74111111-0000-4000-8000-0000000000a1', '74000000-0000-4000-8000-0000000000a1', 'Q pana', 'Bucuresti', 'open', now(), 44.43, 26.10);
select is((select string_agg(p.full_name, ' | ' order by p.full_name) from app.push_queue q join app.profiles p on p.id = q.user_id
             where q.data->>'type' = 'feed' and q.data->>'id' = '74111111-0000-4000-8000-0000000000a1'),
          'Q Mech 1 Buc | Q Mech 3 Oriunde',
          '15. anunț nou: mecanicul din rază și cel fără rază; nu cel din Cluj, nu cel cu push oprit, nu șoferul');
select is((select title || '|' || body from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed'),
          'Neue Anzeige|Bucuresti', '16. titlul în limba mecanicului, corpul = locația, ca azi');

-- ── 17–23. RPC-urile EF ────────────────────────────────────────────────────────────────────────────
-- ia doar rândurile noastre scadente: celelalte (datele porții) pot exista, deci numărăm pe utilizatorii noștri
select is((select count(*)::int from public.claim_push_batch(1000) c join app.push_queue q on q.id = c.queue_id
             where q.user_id = '74000000-0000-4000-8000-0000000000c1' and q.data->>'type' = 'feed'), 2,
          '17. claim întoarce un rând PER TOKEN (M1 are două dispozitive)');
select is((select string_agg(distinct status, ',') from app.push_queue where user_id::text like '74000000-%'), 'sending',
          '18. toate rândurile revendicate sunt sending');
select is((select count(*)::int from public.claim_push_batch(1000)), 0, '19. a doua revendicare nu mai întoarce nimic');
select public.finish_push_batch(jsonb_build_array(
  jsonb_build_object('queue_id', (select id from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c1' and data->>'type' = 'feed'),
                     'outcome', 'sent', 'error', null,
                     'tickets', jsonb_build_array(jsonb_build_object('ticket_id', 'q-ticket-1', 'token', 'ExponentPushToken[q-c1a]')),
                     'dead_tokens', jsonb_build_array('ExponentPushToken[q-c1b]')),
  jsonb_build_object('queue_id', (select id from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed'),
                     'outcome', 'retry', 'error', 'HTTP 429', 'tickets', '[]'::jsonb, 'dead_tokens', '[]'::jsonb),
  jsonb_build_object('queue_id', (select id from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000e2' and tag like 'channel-%'),
                     'outcome', 'failed', 'error', 'MessageTooBig: x', 'tickets', '[]'::jsonb, 'dead_tokens', '[]'::jsonb)
));
select is((select status || '|' || coalesce(last_error, '-') || '|' || (sent_at is not null)::text from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c1' and data->>'type' = 'feed'),
          'sent|-|true', '20. sent: status, sent_at');
select is((select queue_id = (select id from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c1' and data->>'type' = 'feed') from app.push_tickets where ticket_id = 'q-ticket-1'),
          true, '20b. biletul e legat de rând și de token');
select is((select count(*)::int from public.push_tokens where token = 'ExponentPushToken[q-c1b]'), 0, '21. DeviceNotRegistered → tokenul e șters (celălalt rămâne)');
select is((select status || '|' || attempts::text || '|' || (send_after > now() + interval '20 seconds')::text || '|' || last_error from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed'),
          'queued|1|true|HTTP 429', '22. retry: revine queued cu backoff și attempts + 1');
select is((select status || '|' || last_error from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000e2' and tag like 'channel-%'),
          'failed|MessageTooBig: x', '23. eroare de mesaj → failed cu motivul');
-- release: EF-ul n-a ajuns să trimită (buget/autentificare) → rândul revine imediat, FĂRĂ a consuma o încercare;
-- claimed_at greșit (rândul a fost re-revendicat de alt EF) → finish e no-op
update app.push_queue set status = 'queued', send_after = now() where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed';
select public.finish_push_batch(jsonb_build_array(jsonb_build_object('queue_id', (select id from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed'),
  'claimed_at', (select claimed_at from public.claim_push_batch(1000) where queue_id = (select id from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed') limit 1),
  'outcome', 'release', 'error', 'budget', 'tickets', '[]'::jsonb, 'dead_tokens', '[]'::jsonb)));
select is((select status || '|' || attempts::text || '|' || (send_after <= now())::text || '|' || (claimed_at is null)::text || '|' || last_error from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed'),
          'queued|1|true|true|budget', '24a. release: queued imediat, attempts neschimbat (claimed_at potrivit)');
select count(*) from public.claim_push_batch(1000);
select public.finish_push_batch(jsonb_build_array(jsonb_build_object('queue_id', (select id from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed'),
  'claimed_at', (now() - interval '1 hour')::text, 'outcome', 'sent', 'error', null, 'tickets', '[]'::jsonb, 'dead_tokens', '[]'::jsonb)));
select is((select status from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed'), 'sending',
          '24b. claimed_at nepotrivit → finish nu atinge rândul (rămâne al EF-ului care l-a revendicat)');
update app.push_queue set status = 'queued', claimed_at = null where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed';
-- a 6-a încercare eșuată → failed
update app.push_queue set attempts = 5, send_after = now(), status = 'queued' where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed';
select count(*) from public.claim_push_batch(1000);
select public.finish_push_batch(jsonb_build_array(jsonb_build_object('queue_id', (select id from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed'),
  'outcome', 'retry', 'error', 'HTTP 503', 'tickets', '[]'::jsonb, 'dead_tokens', '[]'::jsonb)));
select is((select status || '|' || attempts::text from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c3' and data->>'type' = 'feed'),
          'failed|6', '24. după 6 încercări rândul e failed');
-- chitanțe: biletul „trimis” cu 20 min în urmă e scadent; DeviceNotRegistered șterge tokenul lui
update app.push_tickets set created_at = now() - interval '20 minutes' where ticket_id = 'q-ticket-1';
-- tokenul a fost inregistrat INAINTE de trimitere (garda din finish_push_receipts: pt.updated_at < t.created_at)
update public.push_tokens set updated_at = now() - interval '1 day' where token = 'ExponentPushToken[q-c1a]';
select is((select token from public.pending_push_receipts(1000) where ticket_id = 'q-ticket-1'), 'ExponentPushToken[q-c1a]', '25. pending_push_receipts întoarce biletul scadent cu tokenul lui');
select public.finish_push_receipts(jsonb_build_array(jsonb_build_object('ticket_id', 'q-ticket-1', 'status', 'error', 'error', 'DeviceNotRegistered: gone', 'dead', true)));
select is((select receipt_status || '|' || (select count(*) from public.push_tokens where token = 'ExponentPushToken[q-c1a]')::text from app.push_tickets where ticket_id = 'q-ticket-1'),
          'error|0', '26. chitanță DeviceNotRegistered → bilet marcat, tokenul șters');
-- 26b. un token REINREGISTRAT dupa trimitere (alt cont / reinstalare) nu se sterge la o chitanta dead intarziata
insert into app.push_tickets (ticket_id, queue_id, token, created_at)
values ('q-ticket-2', (select id from app.push_queue where user_id = '74000000-0000-4000-8000-0000000000c1' and data->>'type' = 'feed'), 'ExponentPushToken[q-c3]', now() - interval '20 minutes');
update public.push_tokens set updated_at = now() - interval '5 minutes' where token = 'ExponentPushToken[q-c3]';
select public.finish_push_receipts(jsonb_build_array(jsonb_build_object('ticket_id', 'q-ticket-2', 'status', 'error', 'error', 'DeviceNotRegistered: gone', 'dead', true)));
select is((select receipt_status || '|' || (select count(*) from public.push_tokens where token = 'ExponentPushToken[q-c3]')::text from app.push_tickets where ticket_id = 'q-ticket-2'),
          'error|1', '26b. chitanță dead pentru un token reînregistrat după trimitere → biletul e marcat, tokenul RĂMÂNE');

-- ── 27. Nimic nu mai apelează Expo direct; cron-urile există ─────────────────────────────────────────
select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'app') and p.prosrc ilike '%net.http_post%'),
          'app.kick_push_dispatch, app.kick_push_receipts', '27. net.http_post doar în funcțiile kick (cron), nu în triggere');
select is((select count(*)::int from cron.job where jobname in ('push-dispatch', 'channel-digests', 'push-receipts', 'cleanup-push-queue-daily', 'cleanup-cron-run-details-daily')), 5,
          '27b. cele 5 joburi cron există');
select ok((select split_part(extversion, '.', 1)::int * 100 + split_part(extversion, '.', 2)::int >= 105 from pg_extension where extname = 'pg_cron'),
          '27c. pg_cron >= 1.5 (intervale în secunde)');

-- ── 28–30. Rapoarte și moderare (3.3) ───────────────────────────────────────────────────────────────
select pg_temp.as_user('74000000-0000-4000-8000-0000000000e1', 'authenticated');
insert into public.reports (reporter_id, reported_user_id, reason, details)
values ('74000000-0000-4000-8000-0000000000e1', '74000000-0000-4000-8000-0000000000a1', 'spam', 'Q detalii');
reset role;
-- (adminul e și membru al canalului, deci are și un rând de digest → filtrăm pe tip)
select is((select title || '|' || body || '|' || (data->>'type') from pg_temp.q('74000000-0000-4000-8000-0000000000d1') where data->>'type' = 'report'),
          'Raport nou|spam: Q detalii|report', '28. raport nou → push către admin, cu motivul');
select pg_temp.as_user('74000000-0000-4000-8000-0000000000d1', 'authenticated');
select lives_ok($$select public.admin_delete_message('channel_messages', '74999999-0000-4000-8000-000000000001', 'limbaj')$$, '29. admin_delete_message cu motiv');
select lives_ok($$select public.admin_delete_announcement('74111111-0000-4000-8000-0000000000a1')$$, '29b. semnătura veche din 1.0.x (fără p_reason) merge în continuare');
reset role;
-- (created_at e același now() în tranzacție → ordonăm după kind)
select is((select string_agg(kind || ':' || coalesce(reason, '-'), ',' order by kind desc) from app.moderation_notices where user_id = '74000000-0000-4000-8000-0000000000a1'),
          'message_deleted:limbaj,announcement_deleted:-', '30. proprietarul are notice-urile, cu motivul când există');
select is((select title || '|' || body from pg_temp.q('74000000-0000-4000-8000-0000000000a1') where data->>'type' = 'moderation' order by id limit 1),
          'Notificare de moderare|Un mesaj al tău a fost șters de un moderator: limbaj', '30b. push-ul de moderare în limba proprietarului, cu motivul');
select pg_temp.as_user('74000000-0000-4000-8000-0000000000a1', 'authenticated');
select is((select count(*)::int from public.moderation_notices), 2, '30c. proprietarul își vede notice-urile prin view (RLS)');
select lives_ok($$update public.moderation_notices set read_at = now() where kind = 'message_deleted'$$, '30d. … și le poate marca citite');
reset role;
select pg_temp.as_user('74000000-0000-4000-8000-0000000000e1', 'authenticated');
select is((select count(*)::int from public.moderation_notices), 0, '30e. altcineva nu vede nimic');
reset role;

-- ── 31. Ștergerea contului curăță coada și notice-urile (profilul rămâne piatră funerară → fără cascadă) ──
select ok((select count(*) > 0 from pg_temp.q('74000000-0000-4000-8000-0000000000a1')), '31. înainte de ștergere A are rânduri în coadă');
select public._purge_user_data('74000000-0000-4000-8000-0000000000a1');
select is((select count(*)::int from pg_temp.q('74000000-0000-4000-8000-0000000000a1')) + (select count(*)::int from app.moderation_notices where user_id = '74000000-0000-4000-8000-0000000000a1'), 0,
          '31b. după _purge_user_data: 0 rânduri în coadă (și bilete, în cascadă), 0 notice-uri');

select * from finish();
rollback;
