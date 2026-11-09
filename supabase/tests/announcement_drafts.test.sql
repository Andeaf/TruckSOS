-- pgTAP: faza 6 / 7.2 + 7.10 (migrările 20261109000100_announcement_drafts și 20261109000200_market_push_optin):
-- ciornele de anunț (invizibile, publicarea trimite push-ul, plafonul de deschise la publicare, 1.0.x neschimbat) și
-- default-ul opt-in pentru push-ul Market. Id-urile 76… nu se ciocnesc cu poarta (a0…e0), pgTAP-urile anterioare (73…, 74…)
-- sau bench-ul (75…).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

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

-- ── Fixture ──────────────────────────────────────────────────────────────────────────────────────────
-- push_tokens are FK către auth.users → cont minimal pentru mecanic (ca în push_queue.test.sql)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change,
                        phone_change_token, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now() - interval '40 days',
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now() - interval '40 days', now() - interval '40 days',
       '', '', '', '', '', '', '', '', false, false
  from (values
    ('76000000-0000-4000-8000-0000000000a1'::uuid, 'd-driver-a@example.com'),
    ('76000000-0000-4000-8000-0000000000c1', 'd-mech-1@example.com'),
    ('76000000-0000-4000-8000-0000000000e1', 'd-new-user@example.com')
  ) as u(id, email);

insert into app.profiles (id, full_name, role, phone, lang, push_enabled, latitude, longitude, notify_radius_km, created_at)
values
  ('76000000-0000-4000-8000-0000000000a1', 'D Driver A', 'driver',   '+40700000001', 'ro', true, 44.43, 26.10, null, now() - interval '30 days'),
  ('76000000-0000-4000-8000-0000000000c1', 'D Mech 1',   'mechanic', '+40700000011', 'ro', true, 44.45, 26.12, null, now() - interval '30 days');
insert into public.push_tokens (token, user_id, platform) values ('ExponentPushToken[d-c1]', '76000000-0000-4000-8000-0000000000c1', 'android');

-- SECURITY DEFINER (owner postgres): e apelată și cât rolul e `authenticated`, care n-are SELECT pe app.push_queue.
create function pg_temp.pushes_for_mech() returns int language sql security definer as $$
  select count(*)::int from app.push_queue where user_id = '76000000-0000-4000-8000-0000000000c1' $$;
-- CI (9 nov): "permission denied for function pushes_for_mech" ca authenticated — default-ul de EXECUTE nu acoperă pg_temp aici.
grant execute on function pg_temp.pushes_for_mech() to authenticated, anon;

-- ── 1–4. Ciorna: invizibilă, fără push ───────────────────────────────────────────────────────────────
select pg_temp.as_user('76000000-0000-4000-8000-0000000000a1', 'authenticated');
insert into public.announcements (id, driver_id, description, location, status, latitude, longitude, plate_number)
values ('76111111-0000-4000-8000-000000000001', '76000000-0000-4000-8000-0000000000a1', 'D ciorna', 'Bucuresti', 'draft', 44.43, 26.10, 'B-01-D');
select is((select status from public.announcements where id = '76111111-0000-4000-8000-000000000001'), 'draft',
          '1. INSERT cu status draft ca șofer → rămâne draft (garda nu îl forțează open)');
select is(pg_temp.pushes_for_mech(), 0, '2. ciorna nu trimite push mecanicilor');

select pg_temp.as_user('76000000-0000-4000-8000-0000000000c1', 'authenticated');
select is((select count(*)::int from public.announcements where id = '76111111-0000-4000-8000-000000000001'), 0,
          '3. mecanicul nu vede ciorna (RLS: doar open / acceptatul lui)');
select is((select count(*)::int from public.open_announcements_near() where id = '76111111-0000-4000-8000-000000000001'), 0,
          '3b. … nici în feed-ul pe rază');
select pg_temp.as_user('76000000-0000-4000-8000-0000000000a1', 'anon');
select is((select count(*)::int from public.announcements where id = '76111111-0000-4000-8000-000000000001'), 0,
          '4. oaspetele nu vede ciorna');

-- ── 5–7. Publicarea: draft → open, push-ul pleacă o singură dată ────────────────────────────────────
select pg_temp.as_user('76000000-0000-4000-8000-0000000000a1', 'authenticated');
update public.announcements set status = 'open' where id = '76111111-0000-4000-8000-000000000001';
select is((select status from public.announcements where id = '76111111-0000-4000-8000-000000000001'), 'open',
          '5. șoferul își publică ciorna (politica announcements_update_publish)');
select is(pg_temp.pushes_for_mech(), 1, '6. publicarea trimite push-ul către mecanicul din rază (trigger AFTER UPDATE draft → open)');
select pg_temp.as_user('76000000-0000-4000-8000-0000000000c1', 'authenticated');
select is((select count(*)::int from public.announcements where id = '76111111-0000-4000-8000-000000000001'), 1,
          '7. după publicare mecanicul îl vede');

-- ── 8–9. 1.0.x: INSERT fără status → open, push la INSERT ca azi ────────────────────────────────────
select pg_temp.as_user('76000000-0000-4000-8000-0000000000a1', 'authenticated');
insert into public.announcements (id, driver_id, description, location, latitude, longitude)
values ('76111111-0000-4000-8000-000000000002', '76000000-0000-4000-8000-0000000000a1', 'D 1.0.x fara status', 'Bucuresti', 44.43, 26.10);
select is((select status from public.announcements where id = '76111111-0000-4000-8000-000000000002'), 'open',
          '8. INSERT fără status (1.0.x) → open, ca înainte');
select is(pg_temp.pushes_for_mech(), 2, '9. … și push-ul pleacă la INSERT, ca înainte');
insert into public.announcements (id, driver_id, description, location, status)
values ('76111111-0000-4000-8000-000000000003', '76000000-0000-4000-8000-0000000000a1', 'D status fortat', 'Bucuresti', 'resolved');
select is((select status from public.announcements where id = '76111111-0000-4000-8000-000000000003'), 'open',
          '9b. orice alt status trimis de client (resolved) e forțat open, ca înainte');

-- ── 10–13. Plafonul de 5 deschise: ciornele nu ocupă loc; publicarea e numărată ───────────────────────
-- 3 deschise până acum (001 publicat, 002, 003). Încă 2 ciorne + publicarea lor = 5; a 3-a ciornă se creează, dar nu se publică.
insert into public.announcements (id, driver_id, description, location, status) values
  ('76111111-0000-4000-8000-000000000004', '76000000-0000-4000-8000-0000000000a1', 'D c4', 'B', 'draft'),
  ('76111111-0000-4000-8000-000000000005', '76000000-0000-4000-8000-0000000000a1', 'D c5', 'B', 'draft'),
  ('76111111-0000-4000-8000-000000000006', '76000000-0000-4000-8000-0000000000a1', 'D c6', 'B', 'draft');
select is((select count(*)::int from public.announcements where driver_id = '76000000-0000-4000-8000-0000000000a1' and status = 'draft'), 3,
          '10. trei ciorne create peste trei deschise: ciornele nu intră la plafonul de deschise');
update public.announcements set status = 'open' where id = '76111111-0000-4000-8000-000000000004';
update public.announcements set status = 'open' where id = '76111111-0000-4000-8000-000000000005';
select is((select count(*)::int from public.announcements where driver_id = '76000000-0000-4000-8000-0000000000a1' and status = 'open'), 5,
          '11. două publicări → 5 deschise');
select throws_ok(
  $$ update public.announcements set status = 'open' where id = '76111111-0000-4000-8000-000000000006' $$,
  'P0001', 'rate_limited',
  '12. a 6-a publicare → rate_limited (plafonul de deschise se verifică la publicare)');
select throws_ok(
  $$ insert into public.announcements (id, driver_id, description, location, status)
     values ('76111111-0000-4000-8000-000000000007', '76000000-0000-4000-8000-0000000000a1', 'D c7 resolved', 'B', 'resolved') $$,
  'P0001', 'rate_limited',
  '13. INSERT cu status ≠ draft la 5 deschise → rate_limited (garda îl forțează open, deci e o deschidere)');

-- ── 14–15. Repostul (cancelled → open) nu trece prin trigger-ul de publicare ────────────────────────
select pg_temp.as_postgres();
update app.announcements set status = 'cancelled' where id = '76111111-0000-4000-8000-000000000002';
select is(pg_temp.pushes_for_mech(), 2, '14. anularea nu trimite nimic');
update app.announcements set status = 'open' where id = '76111111-0000-4000-8000-000000000002';
select is(pg_temp.pushes_for_mech(), 2,
          '15. cancelled → open (repost; ca postgres, fără notify explicit) NU declanșează trigger-ul de publicare (WHEN OLD.status = draft)');

-- ── 16–17. CHECK-ul și ștergerea ciornei ────────────────────────────────────────────────────────────
select throws_ok(
  $$ update app.announcements set status = 'pending' where id = '76111111-0000-4000-8000-000000000006' $$,
  '23514', null, '16. CHECK-ul refuză un status necunoscut');
select pg_temp.as_user('76000000-0000-4000-8000-0000000000a1', 'authenticated');
delete from public.announcements where id = '76111111-0000-4000-8000-000000000006';
select is((select count(*)::int from public.announcements where id = '76111111-0000-4000-8000-000000000006'), 0,
          '17. șoferul își poate șterge ciorna (politica de DELETE existentă)');

-- ── 17b–17d. Mașina de stări a clientului nu se lărgește (review 9 nov) ───────────────────────────────
-- Politicile PERMISSIVE de UPDATE se combină cu OR pe USING și pe WITH CHECK; garda păstrează doar tranzițiile de azi + publicarea.
select throws_ok(
  $$ update public.announcements set description = 'D editat dupa publicare' where id = '76111111-0000-4000-8000-000000000002' $$,
  'P0001', 'announcement_update_forbidden', '17b. open → open (editare după publicare) rămâne interzis');
select pg_temp.as_postgres();
update app.announcements set status = 'accepted', mechanic_id = '76000000-0000-4000-8000-0000000000c1' where id = '76111111-0000-4000-8000-000000000004';
select pg_temp.as_user('76000000-0000-4000-8000-0000000000a1', 'authenticated');
select throws_ok(
  $$ update public.announcements set status = 'open' where id = '76111111-0000-4000-8000-000000000004' $$,
  'P0001', 'announcement_update_forbidden', '17c. accepted → open de către șofer rămâne interzis (4.6 presupune tranziția inexistentă din client)');
-- repostul (cancelled → open prin RPC) consumă în continuare cotele 10/24 h (altfel repostul în lanț le-ar ocoli)
select pg_temp.as_postgres();
update app.announcements set status = 'cancelled', created_at = now() - interval '31 hours' where id = '76111111-0000-4000-8000-000000000002';
insert into app.rate_events (user_id, kind) select '76000000-0000-4000-8000-0000000000a1', 'announcement_day' from generate_series(1, 10);
select pg_temp.as_user('76000000-0000-4000-8000-0000000000a1', 'authenticated');
select throws_ok(
  $$ select public.repost_announcement('76111111-0000-4000-8000-000000000002') $$,
  'P0001', 'rate_limited', '17d. repostul cu cota zilnică epuizată → rate_limited (ca azi)');
select pg_temp.as_postgres();
delete from app.rate_events where user_id = '76000000-0000-4000-8000-0000000000a1' and kind = 'announcement_day';

-- ── 18–21. 7.10: market_push_enabled default false pentru conturile noi ───────────────────────────────
select pg_temp.as_postgres();
select is((select market_push_enabled from app.profiles where id = '76000000-0000-4000-8000-0000000000a1'), false,
          '18. profil inserat direct în app.profiles fără coloană → default-ul tabelului e false');
select pg_temp.as_user('76000000-0000-4000-8000-0000000000e1', 'authenticated');
insert into public.profiles (id, full_name, role, phone) values ('76000000-0000-4000-8000-0000000000e1', 'D New User', 'driver', '+40700000099');
select is((select market_push_enabled from public.profiles where id = '76000000-0000-4000-8000-0000000000e1'), false,
          '19. cont nou prin view (1.0.x / 1.1, fără coloană) → market_push_enabled = false (default-ul view-ului)');
select pg_temp.as_postgres();
select is((select market_push_enabled from app.profiles where id = '76000000-0000-4000-8000-0000000000e1'), false,
          '20. … și în tabel (default-ul tabelului)');
update app.profiles set market_push_enabled = true where id = '76000000-0000-4000-8000-0000000000e1';
select is((select market_push_enabled from app.profiles where id = '76000000-0000-4000-8000-0000000000e1'), true,
          '21. comutatorul îl pornește (coloana rămâne scriibilă)');

select * from finish();
rollback;
