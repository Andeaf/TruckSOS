-- pgTAP: faza 4.2b (PLAN_1.1_FIX #27 + #39, migrarea 20261101000200_anon_profiles_predicate_role_checks).
-- #27: anon vede doar profilurile cu rost public (mecanici; șoferi/admini cu anunț deschis, listing activ sau
--      mesaj în canal în 7 zile), neșterse și nebanate; avatarele urmează același predicat.
-- #39: candidează doar mecanicii/adminii și nu la propriul anunț (conversația directă rămâne nerestricționată: 1.0.x o folosește către oricine).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create function pg_temp.as_user(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
end $$;

insert into app.profiles (id, full_name, role, phone, lang, deleted_at, banned_at)
values
  ('72000000-0000-4000-8000-0000000000a1', 'P Driver A (anunt deschis)', 'driver', '+40700000001', 'ro', null, null),
  ('72000000-0000-4000-8000-0000000000b1', 'P Driver B (fara activitate)', 'driver', '+40700000002', 'ro', null, null),
  ('72000000-0000-4000-8000-0000000000b2', 'P Driver B2 (listing activ)', 'driver', '+40700000003', 'ro', null, null),
  ('72000000-0000-4000-8000-0000000000b3', 'P Driver B3 (mesaj in canal)', 'driver', '+40700000004', 'ro', null, null),
  ('72000000-0000-4000-8000-0000000000c1', 'P Mechanic M1', 'mechanic', '+40700000011', 'ro', null, null),
  ('72000000-0000-4000-8000-0000000000c2', 'P Mechanic M2 (banat)', 'mechanic', '+40700000012', 'ro', null, now()),
  ('72000000-0000-4000-8000-0000000000d1', 'P Admin', 'admin', '+40700000099', 'ro', null, null);
insert into app.announcements (id, driver_id, description, location, status, mechanic_id, created_at)
values
  ('72111111-0000-4000-8000-0000000000a1', '72000000-0000-4000-8000-0000000000a1', 'P deschis', 'A1', 'open', null, now() - interval '1 hour'),
  ('72111111-0000-4000-8000-0000000000a2', '72000000-0000-4000-8000-0000000000a1', 'P rezolvat cu M1', 'A2', 'resolved', '72000000-0000-4000-8000-0000000000c1', now() - interval '3 days'),
  ('72111111-0000-4000-8000-0000000000c1', '72000000-0000-4000-8000-0000000000c1', 'P anunt al mecanicului M1', 'A3', 'open', null, now() - interval '2 hours');
insert into public.market_listings (id, seller_id, title, description, price, currency, category, status)
values ('72555555-0000-4000-8000-000000000001', '72000000-0000-4000-8000-0000000000b2', 'P anvelope', 'set', 100, 'RON', 'tires', 'active');
insert into public.channels (id, name, type) values ('72444444-0000-4000-8000-000000000001', 'P canal', 'regional');
insert into public.channel_messages (id, channel_id, sender_id, content, created_at)
values ('72999999-0000-4000-8000-000000000001', '72444444-0000-4000-8000-000000000001', '72000000-0000-4000-8000-0000000000b3', 'P salut', now() - interval '2 days');

-- ── #27 ───────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select string_agg(full_name, ' | ' order by full_name) from public.profiles where id::text like '72000000-%'),
          'P Driver A (anunt deschis) | P Driver B2 (listing activ) | P Driver B3 (mesaj in canal) | P Mechanic M1',
          '1. anon vede mecanicii nebanați și șoferii cu anunț deschis / listing activ / mesaj recent; nu șoferul inactiv, nu adminul, nu banatul');
select is((select count(*)::int from public.guest_profiles where id::text like '72000000-%'), 4, '2. guest_profiles urmează același predicat');
select is((select count(*)::int from public.guest_search_mechanics('P Mechanic')), 1, '3. guest_search_mechanics nu arată mecanicul banat');
select is((select count(*)::int from public.announcements where driver_id::text like '72000000-%'), 2, '4. anon vede în continuare anunțurile deschise (ale lui A și ale lui M1)');
reset role;
select is(app.profile_visible_to_anon('72000000-0000-4000-8000-0000000000b1'), false, '5. predicatul: șofer fără activitate → ascuns');
select is(app.profile_visible_to_anon('72000000-0000-4000-8000-0000000000b3'), true, '6. predicatul: mesaj în canal în ultimele 7 zile → vizibil');
select is(app.profile_visible_to_anon(null), false, '7. predicatul: NULL (cale de avatar fără uuid) → ascuns');
select ok((select qual like '%profile_visible_to_anon%' from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos_select_avatar_anon'),
          '8. avatarele pentru anon folosesc același predicat');
select pg_temp.as_user('72000000-0000-4000-8000-0000000000b1', 'authenticated');
select is((select count(*)::int from public.profiles where id::text like '72000000-%'), 7, '9. un cont logat vede toate profilurile, ca înainte (profiles_select_all neschimbată)');
reset role;

-- ── #39 (doar apply_to_announcement; conversația directă rămâne ca azi, vezi antetul migrării) ───────
select pg_temp.as_user('72000000-0000-4000-8000-0000000000b1', 'authenticated');
select throws_ok($$select public.apply_to_announcement('72111111-0000-4000-8000-0000000000a1', 'fixed', 100, 'RON', null)$$,
          'P0001', 'not_mechanic', '10. un șofer nu poate candida');
reset role;
select pg_temp.as_user('72000000-0000-4000-8000-0000000000c1', 'authenticated');
select throws_ok($$select public.apply_to_announcement('72111111-0000-4000-8000-0000000000c1', 'fixed', 100, 'RON', null)$$,
          'P0001', 'own_announcement', '11. mecanicul nu candidează la propriul anunț');
select lives_ok($$select public.apply_to_announcement('72111111-0000-4000-8000-0000000000a1', 'fixed', 100, 'RON', 'P oferta')$$,
          '12. mecanicul candidează la anunțul deschis al șoferului, ca înainte');
-- Regresie 1.0.x (review 1 nov): „Contactează autorul” / conversație nouă către un șofer FĂRĂ relație merge ca azi.
select lives_ok($$select public.start_direct_conversation('72000000-0000-4000-8000-0000000000b1')$$,
          '13. mecanicul poate deschide conversație directă cu un șofer fără relație, ca în 1.0.x');
reset role;

select * from finish();
rollback;
