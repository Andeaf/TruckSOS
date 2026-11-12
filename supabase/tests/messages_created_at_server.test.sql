-- pgTAP: 20261112000200_messages_created_at_server — `created_at` al mesajelor îl pune serverul.
--   • inserările făcute direct de client (rolul authenticated, cu JWT — ca prin PostgREST) primesc now(), orice ar trimite
--     clientul: dată din viitor, dată din trecut, NULL explicit sau nimic (cazul tuturor clienților publicați);
--   • postgres, service_role și o funcție SECURITY DEFINER își păstrează valoarea (excepția documentată în migrare);
--   • trigger-ul e primul BEFORE INSERT de pe fiecare tabel, iar funcția lui e SECURITY INVOKER și neexecutabilă prin API.
-- IMPORTANT: inserările „de client” rulează cu SET LOCAL ROLE authenticated + request.jwt.claims; ca postgres trigger-ul
-- nu face nimic și testul ar trece din motivul greșit. În tranzacția testului now() e constant, deci comparația e exactă.
-- Id-urile 95… .
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

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
-- Un drum de server: funcție SECURITY DEFINER (proprietar postgres) care inserează cu data aleasă de ea.
create function pg_temp.definer_insert_message(p_id uuid, p_conv uuid, p_sender uuid, p_at timestamptz) returns void
  language sql security definer set search_path = '' as $$
  insert into public.messages (id, conversation_id, sender_id, content, created_at) values (p_id, p_conv, p_sender, 'CA definer', p_at) $$;
grant execute on function pg_temp.as_user(uuid, text), pg_temp.as_postgres(),
                          pg_temp.definer_insert_message(uuid, uuid, uuid, timestamptz) to authenticated, anon, service_role;

-- ── Fixture: șofer A, mecanic C, o conversație directă, un canal ──────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change,
                        phone_change_token, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now() - interval '40 days',
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now() - interval '40 days', now() - interval '40 days',
       '', '', '', '', '', '', '', '', false, false
  from (values
    ('95000000-0000-4000-8000-0000000000a1'::uuid, 'ca-driver-a@example.com'),
    ('95000000-0000-4000-8000-0000000000c1', 'ca-mech-c@example.com')
  ) as u(id, email);
insert into app.profiles (id, full_name, role, phone, lang, created_at) values
  ('95000000-0000-4000-8000-0000000000a1', 'CA Driver A', 'driver',   '+40700000951', 'ro', now() - interval '30 days'),
  ('95000000-0000-4000-8000-0000000000c1', 'CA Mech C',   'mechanic', '+40700000952', 'ro', now() - interval '30 days');
insert into public.conversations (id, driver_id, mechanic_id, is_direct, announcement_id) values
  ('95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', '95000000-0000-4000-8000-0000000000c1', true, null);
insert into public.channels (id, name, type) values ('95444444-0000-4000-8000-000000000001', 'CA canal', 'regional');

-- ── 1–5. Catalogul ─────────────────────────────────────────────────────────────────────────────────────────────
select has_trigger('public', 'messages', 'aaa_created_at_server', '1. trigger-ul există pe public.messages');
select has_trigger('public', 'channel_messages', 'aaa_created_at_server', '2. trigger-ul există pe public.channel_messages');
select is((select prosecdef from pg_proc where oid = 'app.stamp_created_at_client()'::regprocedure), false,
          '3. funcția e SECURITY INVOKER (altfel current_user ar fi mereu proprietarul și trigger-ul n-ar face nimic)');
select is(has_function_privilege('anon', 'app.stamp_created_at_client()', 'EXECUTE')
          or has_function_privilege('authenticated', 'app.stamp_created_at_client()', 'EXECUTE'), false,
          '4. funcția trigger-ului nu e executabilă de anon / authenticated');
select is((select string_agg(first_trigger, ',' order by rel)
             from (select c.relname::text as rel, min(t.tgname::text collate "C") as first_trigger
                     from pg_trigger t join pg_class c on c.oid = t.tgrelid
                    where t.tgrelid in ('public.messages'::regclass, 'public.channel_messages'::regclass)
                      and not t.tgisinternal and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4
                    group by c.relname) x),
          'aaa_created_at_server,aaa_created_at_server',
          '5. e primul trigger BEFORE INSERT de pe ambele tabele (rate limit, ban și notificările văd data serverului)');

-- ── 6–14. Clientul (authenticated + JWT): orice trimite, rândul primește now() ─────────────────────────────────
select pg_temp.as_user('95000000-0000-4000-8000-0000000000a1', 'authenticated');
insert into public.messages (id, conversation_id, sender_id, content, created_at) values
  ('95888888-0000-4000-8000-000000000001', '95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA viitor', now() + interval '5 years'),
  ('95888888-0000-4000-8000-000000000002', '95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA trecut', now() - interval '5 years'),
  ('95888888-0000-4000-8000-000000000003', '95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA null', null);
insert into public.messages (id, conversation_id, sender_id, content) values
  ('95888888-0000-4000-8000-000000000004', '95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA fara created_at');
insert into public.channel_messages (id, channel_id, sender_id, content, created_at) values
  ('95999999-0000-4000-8000-000000000001', '95444444-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA canal viitor', now() + interval '5 years'),
  ('95999999-0000-4000-8000-000000000002', '95444444-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA canal trecut', now() - interval '5 years'),
  ('95999999-0000-4000-8000-000000000003', '95444444-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA canal null', null);
insert into public.channel_messages (id, channel_id, sender_id, content) values
  ('95999999-0000-4000-8000-000000000004', '95444444-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA canal fara created_at');
-- Răspunsul INSERT … RETURNING (ce primește clientul prin .insert().select()) poartă tot data serverului.
with i as (
  insert into public.messages (id, conversation_id, sender_id, content, created_at)
  values ('95888888-0000-4000-8000-000000000005', '95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA returning', '2099-01-01T00:00:00Z')
  returning created_at)
select is((select created_at from i), now(), '6. INSERT … RETURNING ca authenticated întoarce data serverului, nu 2099');
select pg_temp.as_postgres();

select is((select created_at from public.messages where id = '95888888-0000-4000-8000-000000000001'), now(), '7. messages: dată din viitor → now()');
select is((select created_at from public.messages where id = '95888888-0000-4000-8000-000000000002'), now(), '8. messages: dată din trecut → now()');
select is((select created_at from public.messages where id = '95888888-0000-4000-8000-000000000003'), now(), '9. messages: NULL explicit (coloana e nulabilă) → now()');
select is((select created_at from public.messages where id = '95888888-0000-4000-8000-000000000004'), now(), '10. messages: fără created_at (clienții publicați) → now(), ca DEFAULT-ul');
select is((select created_at from public.channel_messages where id = '95999999-0000-4000-8000-000000000001'), now(), '11. channel_messages: dată din viitor → now()');
select is((select created_at from public.channel_messages where id = '95999999-0000-4000-8000-000000000002'), now(), '12. channel_messages: dată din trecut → now()');
select is((select created_at from public.channel_messages where id = '95999999-0000-4000-8000-000000000003'), now(), '13. channel_messages: NULL explicit → now() (înainte: eroare NOT NULL)');
select is((select created_at from public.channel_messages where id = '95999999-0000-4000-8000-000000000004'), now(), '14. channel_messages: fără created_at (clienții publicați) → now(), ca DEFAULT-ul');
-- Trigger-ul AFTER de notificare (faza 3) rulează după el: evenimentul de digest poartă data serverului.
select is((select created_at from app.channel_events where message_id = '95999999-0000-4000-8000-000000000001'), now(),
          '15. evenimentul de digest al mesajului „din viitor” are data serverului');

-- ── 16–21. Drumurile de server își păstrează valoarea ──────────────────────────────────────────────────────────
insert into public.messages (id, conversation_id, sender_id, content, created_at) values
  ('95888888-0000-4000-8000-000000000011', '95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA postgres', '2020-02-02T02:02:02Z');
insert into public.channel_messages (id, channel_id, sender_id, content, created_at) values
  ('95999999-0000-4000-8000-000000000011', '95444444-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA canal postgres', '2020-02-02T02:02:02Z');
select is((select created_at from public.messages where id = '95888888-0000-4000-8000-000000000011'), '2020-02-02T02:02:02Z'::timestamptz,
          '16. messages: inserare ca postgres (migrări, seed, teste) → valoarea trimisă rămâne');
select is((select created_at from public.channel_messages where id = '95999999-0000-4000-8000-000000000011'), '2020-02-02T02:02:02Z'::timestamptz,
          '17. channel_messages: inserare ca postgres → valoarea trimisă rămâne');

set local role service_role;
insert into public.messages (id, conversation_id, sender_id, content, created_at) values
  ('95888888-0000-4000-8000-000000000012', '95333333-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA service_role', '2021-03-03T03:03:03Z');
insert into public.channel_messages (id, channel_id, sender_id, content, created_at) values
  ('95999999-0000-4000-8000-000000000012', '95444444-0000-4000-8000-000000000001', '95000000-0000-4000-8000-0000000000a1', 'CA canal service_role', '2021-03-03T03:03:03Z');
reset role;
select is((select created_at from public.messages where id = '95888888-0000-4000-8000-000000000012'), '2021-03-03T03:03:03Z'::timestamptz,
          '18. messages: inserare ca service_role (Edge Functions) → valoarea trimisă rămâne');
select is((select created_at from public.channel_messages where id = '95999999-0000-4000-8000-000000000012'), '2021-03-03T03:03:03Z'::timestamptz,
          '19. channel_messages: inserare ca service_role → valoarea trimisă rămâne');

select pg_temp.as_user('95000000-0000-4000-8000-0000000000a1', 'authenticated');
select pg_temp.definer_insert_message('95888888-0000-4000-8000-000000000013', '95333333-0000-4000-8000-000000000001',
                                      '95000000-0000-4000-8000-0000000000a1', '2022-04-04T04:04:04Z');
select pg_temp.as_postgres();
select is((select created_at from public.messages where id = '95888888-0000-4000-8000-000000000013'), '2022-04-04T04:04:04Z'::timestamptz,
          '20. funcție SECURITY DEFINER apelată de client → valoarea aleasă de funcție rămâne (excepția documentată)');
select is((select count(*)::int from public.messages where conversation_id = '95333333-0000-4000-8000-000000000001' and created_at is null), 0,
          '21. niciun mesaj al testului nu a rămas cu created_at NULL');

select * from finish();
rollback;
