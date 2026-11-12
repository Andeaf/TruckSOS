-- pgTAP: faza 5, varianta B (migrarea 20261113000100_unread_counts_mark_read): unread_counts() = numărătoarea
-- clientului 1.0.x pe fiecare ramură (citit / necitit / niciodată deschis / tombstone / mesaj propriu / conversație
-- ștearsă / conversația altcuiva / plafon 100), channel_unread_count() cu regula „de după crearea contului”,
-- mark_*_read (nu merge înapoi, nu trece de plafon — now() sau cel mai nou mesaj existent + 1 ms —, nu scrie când
-- nu se schimbă, aduce înapoi un cursor rămas în viitor, doar participanții), drepturile,
-- și drumul 1.0.x (upsert direct pe message_reads / channel_reads) neatins.
-- Id-urile 95… .
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

create function pg_temp.as_user(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
end $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on function pg_temp.as_user(uuid, text), pg_temp.as_postgres() to authenticated, anon;

-- ── Fixture ────────────────────────────────────────────────────────────────────────────────────────────────────
-- A = șofer (contul de test); M1…M5 = mecanici; X = alt șofer; Y = cont nou (creat acum 1 oră); D = admin (creat acum 30 min)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change,
                        phone_change_token, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now() - interval '30 days',
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now() - interval '30 days', now() - interval '30 days',
       '', '', '', '', '', '', '', '', false, false
  from (values
    ('95000000-0000-4000-8000-0000000000a1'::uuid, 'u-driver-a@example.com'),
    ('95000000-0000-4000-8000-0000000000a2', 'u-driver-x@example.com'),
    ('95000000-0000-4000-8000-0000000000a3', 'u-new-y@example.com'),
    ('95000000-0000-4000-8000-0000000000c1', 'u-mech-1@example.com'),
    ('95000000-0000-4000-8000-0000000000c2', 'u-mech-2@example.com'),
    ('95000000-0000-4000-8000-0000000000c3', 'u-mech-3@example.com'),
    ('95000000-0000-4000-8000-0000000000c4', 'u-mech-4@example.com'),
    ('95000000-0000-4000-8000-0000000000c5', 'u-mech-5@example.com'),
    ('95000000-0000-4000-8000-0000000000d1', 'u-admin@example.com')
  ) as u(id, email);
insert into app.profiles (id, full_name, role, phone, lang, created_at) values
  ('95000000-0000-4000-8000-0000000000a1', 'U Driver A', 'driver',   '+40795000001', 'ro', now() - interval '30 days'),
  ('95000000-0000-4000-8000-0000000000a2', 'U Driver X', 'driver',   '+40795000002', 'ro', now() - interval '30 days'),
  ('95000000-0000-4000-8000-0000000000a3', 'U New Y',    'driver',   '+40795000003', 'ro', now() - interval '1 hour'),
  ('95000000-0000-4000-8000-0000000000c1', 'U Mech 1',   'mechanic', '+40795000011', 'ro', now() - interval '30 days'),
  ('95000000-0000-4000-8000-0000000000c2', 'U Mech 2',   'mechanic', '+40795000012', 'ro', now() - interval '30 days'),
  ('95000000-0000-4000-8000-0000000000c3', 'U Mech 3',   'mechanic', '+40795000013', 'ro', now() - interval '30 days'),
  ('95000000-0000-4000-8000-0000000000c4', 'U Mech 4',   'mechanic', '+40795000014', 'ro', now() - interval '30 days'),
  ('95000000-0000-4000-8000-0000000000c5', 'U Mech 5',   'mechanic', '+40795000015', 'ro', now() - interval '30 days'),
  ('95000000-0000-4000-8000-0000000000d1', 'U Admin',    'admin',    '+40795000099', 'ro', now() - interval '30 minutes');

-- conversațiile: c1 A–M1 (parțial citită), c2 A–M2 (niciodată deschisă), c3 A–M3 (citită la zi), c4 A–M4 (ștearsă de A),
-- c5 X–M1 (a altcuiva), c6 A–M5 (120 de necitite → plafon 100)
insert into public.conversations (id, driver_id, mechanic_id, is_direct, announcement_id, created_at) values
  ('95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', '95000000-0000-4000-8000-0000000000c1', true, null, now() - interval '20 days'),
  ('95333333-0000-4000-8000-000000000002', '95000000-0000-4000-8000-0000000000a1', '95000000-0000-4000-8000-0000000000c2', true, null, now() - interval '20 days'),
  ('95333333-0000-4000-8000-000000000003', '95000000-0000-4000-8000-0000000000a1', '95000000-0000-4000-8000-0000000000c3', true, null, now() - interval '20 days'),
  ('95333333-0000-4000-8000-000000000004', '95000000-0000-4000-8000-0000000000a1', '95000000-0000-4000-8000-0000000000c4', true, null, now() - interval '20 days'),
  ('95333333-0000-4000-8000-000000000005', '95000000-0000-4000-8000-0000000000a2', '95000000-0000-4000-8000-0000000000c1', true, null, now() - interval '20 days'),
  ('95333333-0000-4000-8000-000000000006', '95000000-0000-4000-8000-0000000000a1', '95000000-0000-4000-8000-0000000000c5', true, null, now() - interval '20 days');
insert into public.messages (id, conversation_id, sender_id, content, created_at, deleted_at) values
  -- c1: cursorul lui A e la −2 h → 1 citit, 2 necitite, 1 tombstone, 1 propriu
  ('95444444-0000-4000-8000-000000000101', '95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000c1', 'U c1 citit',      now() - interval '3 hours',    null),
  ('95444444-0000-4000-8000-000000000102', '95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000c1', 'U c1 necitit 1',  now() - interval '1 hour',     null),
  ('95444444-0000-4000-8000-000000000103', '95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000c1', 'U c1 necitit 2',  now() - interval '30 minutes', null),
  ('95444444-0000-4000-8000-000000000104', '95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000c1', 'U c1 sters',      now() - interval '20 minutes', now() - interval '19 minutes'),
  ('95444444-0000-4000-8000-000000000105', '95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'U c1 al lui A',   now() - interval '10 minutes', null),
  -- c2: niciun rând de citire → toate cele 3 sunt necitite
  ('95444444-0000-4000-8000-000000000201', '95333333-0000-4000-8000-000000000002', '95000000-0000-4000-8000-0000000000c2', 'U c2 1',          now() - interval '2 days',     null),
  ('95444444-0000-4000-8000-000000000202', '95333333-0000-4000-8000-000000000002', '95000000-0000-4000-8000-0000000000c2', 'U c2 2',          now() - interval '1 day',      null),
  ('95444444-0000-4000-8000-000000000203', '95333333-0000-4000-8000-000000000002', '95000000-0000-4000-8000-0000000000c2', 'U c2 3',          now() - interval '5 minutes',  null),
  -- c3: citită la zi
  ('95444444-0000-4000-8000-000000000301', '95333333-0000-4000-8000-000000000003', '95000000-0000-4000-8000-0000000000c3', 'U c3 citit',      now() - interval '4 hours',    null),
  -- c4: necitite, dar conversația e ștearsă de A (rândul de ștergere se pune DUPĂ mesaje: un mesaj nou o reînvie)
  ('95444444-0000-4000-8000-000000000401', '95333333-0000-4000-8000-000000000004', '95000000-0000-4000-8000-0000000000c4', 'U c4 necitit',    now() - interval '2 hours',    null),
  -- c5: a lui X cu M1 — X a scris de două ori (necitite pentru M1, invizibile pentru A)
  ('95444444-0000-4000-8000-000000000501', '95333333-0000-4000-8000-000000000005', '95000000-0000-4000-8000-0000000000a2', 'U c5 1',          now() - interval '2 hours',    null),
  ('95444444-0000-4000-8000-000000000502', '95333333-0000-4000-8000-000000000005', '95000000-0000-4000-8000-0000000000a2', 'U c5 2',          now() - interval '1 hour',     null);
insert into public.messages (conversation_id, sender_id, content, created_at)
select '95333333-0000-4000-8000-000000000006', '95000000-0000-4000-8000-0000000000c5', 'U c6 ' || g, now() - interval '6 hours' + g * interval '1 second'
  from generate_series(1, 120) g;
insert into public.message_reads (conversation_id, user_id, last_read_at) values
  ('95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', now() - interval '2 hours'),
  ('95333333-0000-4000-8000-000000000003', '95000000-0000-4000-8000-0000000000a1', now() - interval '1 minute');
delete from public.conversation_deletions where conversation_id::text like '95333333-%';
insert into public.conversation_deletions (conversation_id, user_id) values
  ('95333333-0000-4000-8000-000000000004', '95000000-0000-4000-8000-0000000000a1');

-- canalele: k1 (mesaje de dinainte și de după crearea contului lui Y), k2 (120 de mesaje → plafon 100)
insert into public.channels (id, name, type) values
  ('95555555-0000-4000-8000-000000000001', 'U canal 1', 'regional'),
  ('95555555-0000-4000-8000-000000000002', 'U canal 2', 'regional');
insert into public.channel_messages (id, channel_id, sender_id, content, created_at, deleted_at) values
  ('95666666-0000-4000-8000-000000000001', '95555555-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000c1', 'U k1 vechi',     now() - interval '5 days',     null),
  ('95666666-0000-4000-8000-000000000002', '95555555-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000c1', 'U k1 acum 2h',   now() - interval '2 hours',    null),
  ('95666666-0000-4000-8000-000000000003', '95555555-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000c1', 'U k1 sters',     now() - interval '50 minutes', now() - interval '49 minutes'),
  ('95666666-0000-4000-8000-000000000004', '95555555-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'U k1 al lui A',  now() - interval '40 minutes', null),
  ('95666666-0000-4000-8000-000000000005', '95555555-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000c2', 'U k1 acum 10m',  now() - interval '10 minutes', null);
insert into public.channel_messages (channel_id, sender_id, content, created_at)
select '95555555-0000-4000-8000-000000000002', '95000000-0000-4000-8000-0000000000c1', 'U k2 ' || g, now() - interval '6 hours' + g * interval '1 second'
  from generate_series(1, 120) g;

-- ── 1–6. unread_counts ─────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('95000000-0000-4000-8000-0000000000a1', 'authenticated');
select is((select string_agg(right(conversation_id::text, 1) || '=' || unread, ',' order by conversation_id) from public.unread_counts()),
          '1=2,2=3,6=100',
          '1. A: c1 = 2 (fără citit / tombstone / propriu), c2 = 3 (niciodată deschisă), c6 = 100 (plafon); fără c3 (citită), c4 (ștearsă), c5 (a altcuiva)');
-- aceeași numărătoare, făcută „de mână” ca în clientul 1.0.x (prin RLS), pentru conversațiile fără plafon
select is((select string_agg(right(c.id::text, 1) || '=' || n, ',' order by c.id)
             from public.conversations c
             left join public.message_reads r on r.conversation_id = c.id and r.user_id = '95000000-0000-4000-8000-0000000000a1'
             cross join lateral (select count(*) as n from public.messages m
                                  where m.conversation_id = c.id and m.sender_id <> '95000000-0000-4000-8000-0000000000a1'
                                    and m.deleted_at is null and (r.last_read_at is null or m.created_at > r.last_read_at)) x
            where c.id::text like '95333333-%' and c.id::text not like '%6'
              and not exists (select 1 from public.conversation_deletions d where d.conversation_id = c.id and d.user_id = '95000000-0000-4000-8000-0000000000a1')
              and n > 0),
          '1=2,2=3', '2. numărătoarea manuală prin RLS (ca în 1.0.x) dă același rezultat');
select pg_temp.as_user('95000000-0000-4000-8000-0000000000c1', 'authenticated');
select is((select string_agg(right(conversation_id::text, 1) || '=' || unread, ',' order by conversation_id) from public.unread_counts()),
          '1=1,5=2', '3. M1: mesajul lui A din c1 și cele două ale lui X din c5 (rezultatul e per utilizator)');
select pg_temp.as_user('95000000-0000-4000-8000-0000000000d1', 'authenticated');
select is((select count(*)::int from public.unread_counts()), 0, '4. un cont fără conversații (chiar admin) primește zero rânduri');
select pg_temp.as_user('95000000-0000-4000-8000-0000000000a1', 'anon');
select throws_ok($$ select * from public.unread_counts() $$, '42501', null, '5. anon nu poate apela unread_counts');
select pg_temp.as_postgres();
select is((select count(*)::int from public.unread_counts()), 0, '6. fără auth.uid() (postgres) nu întoarce nimic');

-- ── 7–15. mark_conversation_read ───────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('95000000-0000-4000-8000-0000000000a1', 'authenticated');
select is((select public.mark_conversation_read('95333333-0000-4000-8000-000000000002', now() - interval '5 minutes' + interval '1 millisecond')),
          now() - interval '5 minutes' + interval '1 millisecond', '7. prima citire: cursorul = cel mai nou mesaj afișat + 1 ms');
select is((select string_agg(right(conversation_id::text, 1) || '=' || unread, ',' order by conversation_id) from public.unread_counts()),
          '1=2,6=100', '8. c2 a dispărut din necitite');
create temp table t_ctid on commit drop as
  select ctid as c from public.message_reads where conversation_id = '95333333-0000-4000-8000-000000000002' and user_id = '95000000-0000-4000-8000-0000000000a1';
select is((select public.mark_conversation_read('95333333-0000-4000-8000-000000000002', now() - interval '1 day')),
          now() - interval '5 minutes' + interval '1 millisecond', '9. un cursor mai vechi NU dă cursorul înapoi (întoarce valoarea existentă)');
select is((select ctid from public.message_reads where conversation_id = '95333333-0000-4000-8000-000000000002' and user_id = '95000000-0000-4000-8000-0000000000a1'),
          (select c from t_ctid), '10. când cursorul nu avansează nu se scrie nimic (același ctid → niciun eveniment Realtime)');
select is((select public.mark_conversation_read('95333333-0000-4000-8000-000000000002', now() - interval '5 minutes' + interval '1 millisecond')), now() - interval '5 minutes' + interval '1 millisecond',
          '10b. același cursor a doua oară → aceeași valoare');
select is((select ctid from public.message_reads where conversation_id = '95333333-0000-4000-8000-000000000002' and user_id = '95000000-0000-4000-8000-0000000000a1'),
          (select c from t_ctid), '10c. … tot fără scriere');
select is((select public.mark_conversation_read('95333333-0000-4000-8000-000000000001', now() + interval '1 day')), now(),
          '11. un cursor din viitor (ceasul telefonului înainte) e adus la now()');
select is((select string_agg(right(conversation_id::text, 1) || '=' || unread, ',' order by conversation_id) from public.unread_counts()),
          '6=100', '12. c1 citită');
select is((select public.mark_conversation_read('95333333-0000-4000-8000-000000000006') = now()), true, '13. fără p_at → now()');
select is((select public.mark_conversation_read('95333333-0000-4000-8000-000000000006', null)), now(), '13b. p_at NULL explicit → plafonul (now())');
select throws_ok($$ select public.mark_conversation_read('95333333-0000-4000-8000-000000000005') $$, '42501', 'not_participant',
                 '14. conversația altcuiva → not_participant (și niciun rând scris)');
select throws_ok($$ select public.mark_conversation_read('95333333-0000-4000-8000-0000000000ff') $$, '42501', 'not_participant',
                 '14b. conversație inexistentă → ACEEAȘI eroare (existența unei conversații nu se poate sonda)');
select pg_temp.as_postgres();
select is((select count(*)::int from public.message_reads where conversation_id = '95333333-0000-4000-8000-000000000005'), 0,
          '15. niciun rând de citire pe conversația altcuiva');

-- ── 16–18. drumul 1.0.x: upsert direct din client ──────────────────────────────────────────────────────────────
select pg_temp.as_user('95000000-0000-4000-8000-0000000000c1', 'authenticated');
select lives_ok($$ insert into public.message_reads (conversation_id, user_id, last_read_at)
                   values ('95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000c1', now())
                   on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at $$,
                '16. 1.0.x: upsert direct pe message_reads merge ca înainte');
select lives_ok($$ insert into public.channel_reads (channel_id, user_id, last_read_at)
                   values ('95555555-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000c1', now() - interval '3 hours')
                   on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at $$,
                '17. 1.0.x: upsert direct pe channel_reads merge ca înainte');
select is((select string_agg(right(conversation_id::text, 1) || '=' || unread, ',' order by conversation_id) from public.unread_counts()),
          '5=2', '18. după upsert-ul direct, unread_counts vede c1 citită (aceleași tabele)');

-- ── 18b–18e. mesaj cu dată din viitor (clientul poate trimite created_at la INSERT) și cursor rămas în viitor ───
select pg_temp.as_postgres();
insert into public.messages (id, conversation_id, sender_id, content, created_at) values
  ('95444444-0000-4000-8000-000000000302', '95333333-0000-4000-8000-000000000003', '95000000-0000-4000-8000-0000000000c3', 'U c3 din viitor', now() + interval '2 days');
select pg_temp.as_user('95000000-0000-4000-8000-0000000000a1', 'authenticated');
select is((select string_agg(right(conversation_id::text, 1) || '=' || unread, ',' order by conversation_id) from public.unread_counts()), '3=1', '18b. mesajul cu dată din viitor e numărat ca necitit');
select is((select public.mark_conversation_read('95333333-0000-4000-8000-000000000003', now() + interval '2 days' + interval '1 millisecond')),
          now() + interval '2 days' + interval '1 millisecond',
          '18c. plafonul urcă până la cel mai nou mesaj EXISTENT + 1 ms: mesajul poate fi citit (altfel bulina ar rămâne aprinsă)');
select is((select count(*)::int from public.unread_counts()), 0, '18d. … și nu mai e numărat');
select pg_temp.as_postgres();
update public.messages set deleted_at = now() where id = '95444444-0000-4000-8000-000000000302';
select pg_temp.as_user('95000000-0000-4000-8000-0000000000a1', 'authenticated');
select is((select public.mark_conversation_read('95333333-0000-4000-8000-000000000003')), now(),
          '18e. după ștergerea mesajului, cursorul rămas în viitor e adus înapoi la now() (la fel pentru unul scris de 1.0.x cu ceasul înainte)');

-- ── 19–27. channel_unread_count ────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('95000000-0000-4000-8000-0000000000a1', 'authenticated');
select is((select public.channel_unread_count('95555555-0000-4000-8000-000000000001')), 3,
          '19. A (cont vechi, canal niciodată deschis): 3 = vechi + acum 2h + acum 10m; fără tombstone, fără mesajul propriu');
select is((select count(*)::int from public.channel_messages m
            where m.channel_id = '95555555-0000-4000-8000-000000000001' and m.sender_id <> '95000000-0000-4000-8000-0000000000a1' and m.deleted_at is null), 3,
          '20. numărătoarea manuală prin RLS (ca în 1.0.x) dă același rezultat');
select is((select public.channel_unread_count('95555555-0000-4000-8000-000000000002')), 100, '21. plafon 100');
select pg_temp.as_user('95000000-0000-4000-8000-0000000000a3', 'authenticated');
select is((select public.channel_unread_count('95555555-0000-4000-8000-000000000001')), 2,
          '22. Y (cont creat acum 1 oră): doar mesajele de după crearea contului (al lui A de acum 40 min + cel de acum 10 min)');
select is((select count(*)::int from public.channel_messages m
            where m.channel_id = '95555555-0000-4000-8000-000000000001' and m.sender_id <> '95000000-0000-4000-8000-0000000000a3' and m.deleted_at is null), 2,
          '23. … exact ce îi lasă RLS-ul să vadă');
select pg_temp.as_user('95000000-0000-4000-8000-0000000000d1', 'authenticated');
select is((select public.channel_unread_count('95555555-0000-4000-8000-000000000001')), 4,
          '24. adminul (cont creat acum 30 min) vede și mesajele de dinaintea contului: 4');
select pg_temp.as_user('95000000-0000-4000-8000-0000000000c1', 'authenticated');
select is((select public.channel_unread_count('95555555-0000-4000-8000-000000000001')), 2,
          '25. M1 (cursor la −3 h, pus prin upsert direct): mesajul lui A + cel al lui M2; ale lui proprii nu se numără');
select is((select public.channel_unread_count('95555555-0000-4000-8000-0000000000ff')), 0, '26. canal inexistent → 0');
select pg_temp.as_user('95000000-0000-4000-8000-0000000000ee', 'authenticated');
select is((select public.channel_unread_count('95555555-0000-4000-8000-000000000001')), 0, '26b. cont fără profil (și fără rol de admin) → 0, ca prin RLS');
select pg_temp.as_user('95000000-0000-4000-8000-0000000000a1', 'anon');
select throws_ok($$ select public.channel_unread_count('95555555-0000-4000-8000-000000000001') $$, '42501', null, '27. anon nu poate apela channel_unread_count');

-- ── 28–32. mark_channel_read ───────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('95000000-0000-4000-8000-0000000000a1', 'authenticated');
select is((select public.mark_channel_read('95555555-0000-4000-8000-000000000001')), now(), '28. fără p_at → ceasul serverului');
select is((select public.channel_unread_count('95555555-0000-4000-8000-000000000001')), 0, '29. canalul e citit');
select is((select public.mark_channel_read('95555555-0000-4000-8000-000000000001', now() - interval '1 day')), now(), '30. nu merge înapoi');
select is((select public.mark_channel_read('95555555-0000-4000-8000-000000000002', now() + interval '2 days')), now(), '31. un cursor din viitor e adus la now()');
select throws_ok($$ select public.mark_channel_read('95555555-0000-4000-8000-0000000000ff') $$, '42501', 'channel_not_found', '32. canal inexistent → eroare, niciun rând');

-- ── 33–34. drepturile ──────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_postgres();
select is((select count(*)::int from public.channel_reads where channel_id = '95555555-0000-4000-8000-0000000000ff'), 0,
          '32b. … și niciun rând de citire pentru canalul inexistent');
select is((select bool_or(has_function_privilege('anon', f, 'EXECUTE'))
             from unnest(array['public.unread_counts()', 'public.channel_unread_count(uuid)',
                               'public.mark_conversation_read(uuid, timestamptz)', 'public.mark_channel_read(uuid, timestamptz)']) f), false,
          '33. anon nu are EXECUTE pe niciuna dintre cele patru funcții');
select is((select bool_and(has_function_privilege('authenticated', f, 'EXECUTE'))
             from unnest(array['public.unread_counts()', 'public.channel_unread_count(uuid)',
                               'public.mark_conversation_read(uuid, timestamptz)', 'public.mark_channel_read(uuid, timestamptz)']) f), true,
          '34. authenticated are EXECUTE pe toate patru');

select * from finish();
rollback;
