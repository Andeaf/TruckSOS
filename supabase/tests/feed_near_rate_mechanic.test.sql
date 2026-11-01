-- pgTAP: faza 4.3 (PLAN_1.1_FIX #9 + D12-bis, migrarea 20261101000300_feed_near_rate_mechanic):
-- feed-ul pe rază pe server (RLS + măști ca în view), bulina, varianta pentru oaspeți și RPC-ul de notare.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.as_user(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
end $$;

insert into app.profiles (id, full_name, role, phone, lang)
values
  ('73000000-0000-4000-8000-0000000000a1', 'F Driver A', 'driver', '+40700000001', 'ro'),
  ('73000000-0000-4000-8000-0000000000b1', 'F Driver B', 'driver', '+40700000002', 'ro'),
  ('73000000-0000-4000-8000-0000000000c1', 'F Mechanic M1', 'mechanic', '+40700000011', 'ro'),
  ('73000000-0000-4000-8000-0000000000c2', 'F Mechanic M2', 'mechanic', '+40700000012', 'ro');
-- București (44.43, 26.10): A1 la ~0 km, A2 la ~55 km (Ploiești), A3 fără coordonate, A4 acceptat, B1 la ~300 km (Cluj)
insert into app.announcements (id, driver_id, description, location, status, mechanic_id, created_at, plate_number, chassis_number, latitude, longitude)
values
  ('73111111-0000-4000-8000-0000000000a1', '73000000-0000-4000-8000-0000000000a1', 'F A1 aproape', 'Bucuresti', 'open', null, now() - interval '10 minutes', 'B-01-F', 'VINF01', 44.4300, 26.1000),
  ('73111111-0000-4000-8000-0000000000a2', '73000000-0000-4000-8000-0000000000a1', 'F A2 Ploiesti', 'Ploiesti', 'open', null, now() - interval '2 hours', 'B-02-F', null, 44.9400, 26.0300),
  ('73111111-0000-4000-8000-0000000000a3', '73000000-0000-4000-8000-0000000000a1', 'F A3 fara locatie', 'undeva', 'open', null, now() - interval '3 hours', null, null, null, null),
  ('73111111-0000-4000-8000-0000000000a4', '73000000-0000-4000-8000-0000000000a1', 'F A4 rezolvat cu M1', 'A2', 'resolved', '73000000-0000-4000-8000-0000000000c1', now() - interval '5 days', null, null, 44.4, 26.1),
  ('73111111-0000-4000-8000-0000000000b1', '73000000-0000-4000-8000-0000000000b1', 'F B1 Cluj', 'Cluj', 'open', null, now() - interval '1 hour', 'CJ-01-F', null, 46.7700, 23.6000),
  ('73111111-0000-4000-8000-0000000000a5', '73000000-0000-4000-8000-0000000000a1', 'F A5 margine', 'Bucuresti N', 'open', null, now() - interval '4 hours', null, null, 44.4349, 26.1049);

-- ── Mecanicul M2 (neacceptat nicăieri) ───────────────────────────────────────────────────────
select pg_temp.as_user('73000000-0000-4000-8000-0000000000c2', 'authenticated');
select is((select string_agg(description, ' | ' order by created_at desc) from public.open_announcements_near() where driver_id::text like '73000000-%'),
          'F A1 aproape | F B1 Cluj | F A2 Ploiesti | F A3 fara locatie | F A5 margine',
          '1. fără rază: toate anunțurile deschise ale altora, cele mai noi întâi (fără cel rezolvat)');
select is((select string_agg(description, ' | ' order by distance_km nulls last, created_at desc) from public.open_announcements_near(44.43, 26.10, 100) where driver_id::text like '73000000-%'),
          'F A1 aproape | F A5 margine | F A2 Ploiesti | F A3 fara locatie',
          '2. rază 100 km din București: A1, A5, A2 și cel fără coordonate (rămâne, ca în client); nu Cluj');
select is((select latitude::numeric || '|' || longitude::numeric from public.open_announcements_near(44.43, 26.10, 100) where id = '73111111-0000-4000-8000-0000000000a1'),
          '44.43|26.1', '3. coordonatele sunt cele aproximative (~1 km) pentru mecanicul neacceptat (plăcuța/VIN-ul nu sunt coloane ale RPC-ului)');
select ok((select distance_km between 0 and 2 from public.open_announcements_near(44.43, 26.10, 100) where id = '73111111-0000-4000-8000-0000000000a1'),
          '4. distanța e calculată pe coordonatele aproximative (A1 la sub 2 km)');
select is((select driver_full_name from public.open_announcements_near() where id = '73111111-0000-4000-8000-0000000000a1'), 'F Driver A',
          '5. numele șoferului vine din același RPC (fără embed)');
select is((select count(*)::int from public.open_announcements_near(44.43, 26.10, 100, 2) where driver_id::text like '73000000-%'), 2, '6. p_limit limitează');
select is((select count(*)::int from public.open_announcements_near(null, null, null, 50, now() - interval '90 minutes') where driver_id::text like '73000000-%'), 3,
          '7. cursorul p_before întoarce doar anunțurile mai vechi (A2, A3, A5)');
-- (restrâns la ultimele 15 minute: datele porții din CI au anunțuri deschise lângă București, dar mai vechi)
select is((select public.open_announcements_near_count(44.43, 26.10, 100, now() - interval '15 minutes')), 1,
          '8. bulina: un anunț nou în rază de la ultima vizită (A1), fără plafon de 100');
-- Marginea cutiei: exactul (44.4349, 26.1049) se rotunjește la (44.43, 26.10), la ~0 km de centru; cu o rază de 0,3 km
-- cutia fără margine l-ar fi exclus pe criteriul poziției EXACTE (la ~0,66 km) și ar fi dezvăluit că exactul e departe.
select is((select count(*)::int from public.open_announcements_near(44.43, 26.10, 0.3) where id = '73111111-0000-4000-8000-0000000000a5'), 1,
          '8b. includerea depinde doar de poziția mascată: exactul în afara cercului, aproximativul înăuntru → apare');
select is((select count(*)::int from public.open_announcements_near(44.4349, 26.1049, 0.3) where id = '73111111-0000-4000-8000-0000000000a5'), 0,
          '8c. … și invers: centrul pe poziția exactă cu rază mică nu-l găsește (aproximativul e la ~0,66 km)');
reset role;

-- ── Șoferul A: RLS-ul tabelului îi arată doar propriile anunțuri, iar RPC-ul le exclude → nimic ──
select pg_temp.as_user('73000000-0000-4000-8000-0000000000a1', 'authenticated');
select is((select count(*)::int from public.open_announcements_near()), 0, '9. un șofer nu primește feed (RLS + excluderea propriilor anunțuri)');
-- ── rate_mechanic: upsert-ul din client, pe server, cu politicile ratings_* neschimbate ───────
select lives_ok($$select public.rate_mechanic('73000000-0000-4000-8000-0000000000c1', 5::smallint, 'F prompt')$$, '10. A îl notează pe M1 (anunț rezolvat împreună)');
select lives_ok($$select public.rate_mechanic('73000000-0000-4000-8000-0000000000c1', 3::smallint, null)$$, '11. a doua notare actualizează (ON CONFLICT)');
select is((select stars || '|' || coalesce(comment, 'null') || '|' || (select count(*) from public.ratings where mechanic_id = '73000000-0000-4000-8000-0000000000c1' and driver_id = '73000000-0000-4000-8000-0000000000a1')::text
             from public.ratings where mechanic_id = '73000000-0000-4000-8000-0000000000c1' and driver_id = '73000000-0000-4000-8000-0000000000a1'),
          '3|null|1', '12. un singur rând, cu ultima notă');
select throws_ok($$select public.rate_mechanic('73000000-0000-4000-8000-0000000000c2', 1::smallint, null)$$, '42501', null,
          '13. notarea unui mecanic fără anunț rezolvat împreună e respinsă de RLS, ca la upsert-ul direct');
reset role;

-- ── Oaspete ───────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select string_agg(description, ' | ' order by distance_km nulls last, created_at desc) from public.guest_announcements_near(44.43, 26.10, 100) where driver_id::text like '73000000-%'),
          'F A1 aproape | F A5 margine | F A2 Ploiesti | F A3 fara locatie',
          '14. oaspetele primește aceleași anunțuri deschise în rază, doar cu coloanele publice');
reset role;

select * from finish();
rollback;
