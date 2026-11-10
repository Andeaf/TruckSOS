-- pgTAP: faza 4.2a (PLAN_1.1_FIX, migrarea 20261101000100_private_tables) — tabelele private app.profiles /
-- app.announcements și view-urile public.profiles / public.announcements. Testele negative cerute (§8-bis):
-- contul A nu vede telefonul și coordonatele lui B; mecanicul neacceptat nu vede plăcuța/VIN-ul (vede ~1 km);
-- anon vede doar predicatul și coloanele permise; scrierile prin view se comportă ca pe tabel (0 rânduri pentru
-- străin, gărzile ridică aceleași erori); limita de anunțuri în ambele sensuri (prin view și prin RPC direct);
-- nicio funcție nu mai referă profiles/announcements necalificat; grant-urile pe app = politicile.
-- Rulează ca postgres (supabase test db); fiecare persoană e simulată cu SET LOCAL ROLE + request.jwt.claims.
begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

-- ── Fixturi (tranzacția se derulează înapoi la final) ──────────────────────────────────────────
create function pg_temp.as_user(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
end $$;
-- Numărul de rânduri atinse de un DML rulat ca rolul curent (un WITH cu DML nu poate sta într-o subinterogare).
create function pg_temp.affected(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.affected(text) to anon, authenticated, service_role;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
end $$;

insert into app.profiles (id, full_name, role, phone, latitude, longitude, lang, address, vat_number, contact_email, company_name, deleted_at, banned_at)
values
  ('70000000-0000-4000-8000-0000000000a1', 'T Driver A', 'driver', '+40700000001', 44.43, 26.10, 'ro', 'Str. A 1', 'RO1', 'a@example.com', null, null, null),
  ('70000000-0000-4000-8000-0000000000b1', 'T Driver B', 'driver', '+40700000002', 46.77, 23.62, 'en', 'Str. B 2', 'RO2', 'b@example.com', null, null, null),
  ('70000000-0000-4000-8000-0000000000c1', 'T Mechanic Acc', 'mechanic', '+40700000011', 44.50, 26.20, 'ro', 'Str. M1', 'RO11', 'm1@example.com', 'M1 SRL', null, null),
  ('70000000-0000-4000-8000-0000000000c2', 'T Mechanic Open', 'mechanic', '+40700000012', 46.80, 23.60, 'de', 'Str. M2', 'RO12', 'm2@example.com', 'M2 GmbH', null, null),
  ('70000000-0000-4000-8000-0000000000d1', 'T Admin', 'admin', '+40700000099', null, null, 'ro', null, null, null, null, null, null),
  ('70000000-0000-4000-8000-0000000000f1', '', 'driver', null, null, null, 'ro', null, null, null, null, now(), null),
  ('70000000-0000-4000-8000-0000000000f2', 'T Banned', 'driver', '+40700000077', null, null, 'ro', null, null, null, null, null, now());

insert into app.announcements (id, driver_id, description, location, status, mechanic_id, created_at, plate_number, chassis_number, latitude, longitude)
values
  ('71111111-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-0000000000a1', 'T deschis', 'A1', 'open', null, now() - interval '1 hour', 'B-01-TST', 'VIN0001', 44.4268, 26.1025),
  ('71111111-0000-4000-8000-0000000000a2', '70000000-0000-4000-8000-0000000000a1', 'T acceptat', 'DN1', 'accepted', '70000000-0000-4000-8000-0000000000c1', now() - interval '1 day', 'B-02-TST', 'VIN0002', 44.5500, 26.0700),
  ('71111111-0000-4000-8000-0000000000a3', '70000000-0000-4000-8000-0000000000a1', 'T anulat vechi', 'Pitesti', 'cancelled', null, now() - interval '40 hours', null, null, 44.8565, 24.8692);

-- ── 1–7. Măștile pe profiles ──────────────────────────────────────────────────────────────────
select pg_temp.as_user('70000000-0000-4000-8000-0000000000a1', 'authenticated');
select is((select phone from public.profiles where id = '70000000-0000-4000-8000-0000000000b1'), null,
          '1. A nu vede telefonul lui B');
select is((select latitude from public.profiles where id = '70000000-0000-4000-8000-0000000000b1'), null,
          '2. A nu vede coordonatele lui B');
select is((select lang || '|' || coalesce(push_enabled::text, 'null') || '|' || coalesce(address, 'null') from public.profiles where id = '70000000-0000-4000-8000-0000000000b1'), null,
          '3. A nu vede lang / push_enabled / adresa unui șofer străin');
select is((select phone || '|' || latitude::text || '|' || lang || '|' || address from public.profiles where id = '70000000-0000-4000-8000-0000000000a1'),
          '+40700000001|44.43|ro|Str. A 1', '4. A își vede propriul telefon, coordonatele, limba, adresa');
select is((select address || '|' || vat_number || '|' || contact_email || '|' || coalesce(phone, 'null') from public.profiles where id = '70000000-0000-4000-8000-0000000000c1'),
          'Str. M1|RO11|m1@example.com|null', '5. A vede adresa/TVA/e-mailul mecanicului (prestator), dar nu telefonul');
reset role;
select pg_temp.as_user('70000000-0000-4000-8000-0000000000d1', 'authenticated');
select is((select phone from public.profiles where id = '70000000-0000-4000-8000-0000000000b1'), '+40700000002',
          '6. Adminul vede telefonul lui B');
select is((select banned_at is not null from public.profiles where id = '70000000-0000-4000-8000-0000000000f2'), true,
          '7. Adminul vede ban-ul');
reset role;

-- ── 8–12. Măștile pe announcements (3.2: ~1 km, fără plăcuță/VIN până la acceptare) ────────────
select pg_temp.as_user('70000000-0000-4000-8000-0000000000c2', 'authenticated');
-- 4.6: plăcuța și VIN-ul verificate separat (NULL || orice = NULL ar fi ascuns un VIN scăpat).
select is((select plate_number from public.announcements where id = '71111111-0000-4000-8000-0000000000a1'), null,
          '8a. Mecanicul neacceptat nu vede plăcuța anunțului deschis');
select is((select chassis_number from public.announcements where id = '71111111-0000-4000-8000-0000000000a1'), null,
          '8b. Mecanicul neacceptat nu vede VIN-ul anunțului deschis');
select is((select latitude::numeric || '|' || longitude::numeric from public.announcements where id = '71111111-0000-4000-8000-0000000000a1'),
          '44.43|26.1', '9. Mecanicul neacceptat vede poziția la ~1 km (lat_approx/lng_approx)');
select is((select count(*)::int from public.announcements where id = '71111111-0000-4000-8000-0000000000a2'), 0,
          '10. Mecanicul neacceptat nu vede anunțul acceptat de altcineva (RLS urmează tabelul)');
reset role;
select pg_temp.as_user('70000000-0000-4000-8000-0000000000c1', 'authenticated');
select is((select plate_number || '|' || latitude::text from public.announcements where id = '71111111-0000-4000-8000-0000000000a2'),
          'B-02-TST|44.55', '11. Mecanicul acceptat vede plăcuța și coordonatele exacte');
reset role;
select pg_temp.as_user('70000000-0000-4000-8000-0000000000a1', 'authenticated');
select is((select plate_number || '|' || chassis_number || '|' || latitude::text from public.announcements where id = '71111111-0000-4000-8000-0000000000a1'),
          'B-01-TST|VIN0001|44.4268', '12. Șoferul vede plăcuța, VIN-ul și coordonatele exacte ale anunțului său');
reset role;

-- ── 13–18. anon: predicatul și coloanele permise ──────────────────────────────────────────────
select pg_temp.as_anon();
-- Numărătorile sunt restrânse la fixturile acestui test (baza din CI are și datele porții 4.1).
-- 4.2b (#27, 20261101000200): anon vede doar profilurile cu rost public: A (anunț deschis), M1, M2; nu B (șofer
-- fără activitate), nu adminul, nu profilul șters, nu banatul.
select is((select count(*)::int from public.profiles where id::text like '70000000-%'),
          3, '13. anon vede doar profilurile publice, neșterse și nebanate (3 din 7)');
select lives_ok($$select id, full_name, role, avatar_path, company_name, rating_avg from public.profiles$$, '14. anon citește coloanele publice din profiles');
select throws_ok($$select phone from public.profiles$$, '42501', null, '15. anon nu poate cere phone din profiles');
select is((select count(*)::int from public.announcements where driver_id = '70000000-0000-4000-8000-0000000000a1'), 1, '16. anon vede doar anunțurile deschise (1 din 3)');
select throws_ok($$select latitude from public.announcements$$, '42501', null, '17. anon nu poate cere latitude din announcements');
select is((select lat_approx::text
                  || '|' || (select count(*) from public.guest_profiles where id::text like '70000000-%')
                  || '|' || (select count(*) from public.guest_announcements where driver_id = '70000000-0000-4000-8000-0000000000a1')
             from public.announcements where id = '71111111-0000-4000-8000-0000000000a1'),
          '44.43|3|1', '18. anon vede lat_approx; view-urile guest_* merg pe tabelele mutate');
reset role;

-- ── 19–26. Scrieri prin view: ca pe tabel ─────────────────────────────────────────────────────
select pg_temp.as_user('70000000-0000-4000-8000-0000000000a1', 'authenticated');
select is(pg_temp.affected($$update public.profiles set phone = '+40700000009' where id = '70000000-0000-4000-8000-0000000000a1'$$),
          1, '19. Proprietarul își actualizează telefonul prin view (1 rând)');
select is((select phone from public.profiles where id = '70000000-0000-4000-8000-0000000000a1'), '+40700000009', '20. Telefonul nou e vizibil proprietarului');
select is(pg_temp.affected($$update public.profiles set full_name = 'Hacked' where id = '70000000-0000-4000-8000-0000000000b1'$$),
          0, '21. Străinul: 0 rânduri (RLS pe tabel), nu update fantomă');
select throws_ok($$update public.profiles set role = 'admin' where id = '70000000-0000-4000-8000-0000000000a1'$$, 'P0001', 'role_change_forbidden',
          '22. Garda tabelului se aplică prin view (role_change_forbidden)');
select is(pg_temp.affected($$update public.announcements set status = 'cancelled' where id = '71111111-0000-4000-8000-0000000000a1'$$),
          1, '23. Șoferul anulează anunțul deschis prin view (1 rând)');
select is(pg_temp.affected($$update public.announcements set status = 'open' where id = '71111111-0000-4000-8000-0000000000a1'$$),
          0, '24. Redeschiderea directă: 0 rânduri (politica update_cancel), ca pe tabel');
select is(pg_temp.affected($$delete from public.announcements where id = '71111111-0000-4000-8000-0000000000a1'$$),
          1, '25. Șoferul își șterge anunțul neacceptat prin view (1 rând)');
reset role;
select pg_temp.as_user('70000000-0000-4000-8000-0000000000b1', 'authenticated');
select is(pg_temp.affected($$delete from public.announcements where id = '71111111-0000-4000-8000-0000000000a2'$$),
          0, '26. Alt șofer: DELETE prin view = 0 rânduri');
reset role;

-- ── 27–29. INSERT prin view: default-urile și gărzile ─────────────────────────────────────────
select pg_temp.as_user('70000000-0000-4000-8000-0000000000e1', 'authenticated');
select throws_ok($$insert into public.profiles (id, full_name, role, phone) values ('70000000-0000-4000-8000-0000000000e1', 'T Evil', 'admin', '+40700000050')$$,
          'P0001', 'role_forbidden', '27. INSERT profiles cu role=admin prin view → role_forbidden (garda)');
select lives_ok($$insert into public.profiles (id, full_name, role, phone, address, vat_number) values ('70000000-0000-4000-8000-0000000000e1', 'T New', 'driver', '+40700000050', null, null)$$,
          '28. INSERT profiles cu coloanele din 1.0.8 (fără lang/push_enabled/rating) merge prin view');
select is((select lang || '|' || push_enabled::text || '|' || rating_avg::text || '|' || (created_at is not null)::text from public.profiles where id = '70000000-0000-4000-8000-0000000000e1'),
          'ro|true|0.0|true', '29. Default-urile tabelului s-au aplicat prin view (lang, push_enabled, rating_avg, created_at)');
reset role;

-- ── 30–33. Limita de anunțuri, în ambele sensuri (§8-bis.1) ────────────────────────────────────
select pg_temp.as_user('70000000-0000-4000-8000-0000000000a1', 'authenticated');
-- A are 0 deschise acum (a1 șters, a2 acceptat, a3 anulat): 5 INSERT-uri prin view trec, al 6-lea pică.
select lives_ok($$insert into public.announcements (driver_id, description, location, status, latitude, longitude)
                  select '70000000-0000-4000-8000-0000000000a1', 'T nou ' || g, 'loc', 'open', 44.1, 26.1 from generate_series(1, 5) g$$,
          '30. 5 anunțuri deschise prin view (sub plafon) trec');
select is((select status || '|' || (id is not null)::text || '|' || lat_approx::text from public.announcements where description = 'T nou 1'),
          'open|true|44.10', '31. Default-urile (id, status) și coloana generată lat_approx sunt la locul lor');
select throws_ok($$insert into public.announcements (driver_id, description, location, status) values ('70000000-0000-4000-8000-0000000000a1', 'T al 6-lea', 'loc', 'open')$$,
          'P0001', 'rate_limited', '32. Al 6-lea anunț deschis prin view → rate_limited (limita nu e ocolită de adâncimea 2)');
select throws_ok($$select public.repost_announcement('71111111-0000-4000-8000-0000000000a3')$$,
          'P0001', 'rate_limited', '33. Redeschiderea prin RPC (scriere directă, adâncime 1) rămâne limitată ca azi');
select is(current_setting('app.via_view', true), 'off', '34. Flag-ul app.via_view e resetat după scrierea prin view');
reset role;

-- ── 35–40. Catalog: RLS, grant-uri, funcții ────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'app.profiles'::regclass)
          and (select relrowsecurity from pg_class where oid = 'app.announcements'::regclass),
          '35. RLS activ pe app.profiles și app.announcements');
select is(
  (select string_agg(c.relname || '=' || (select coalesce(string_agg(priv, '/' order by priv), '-') from unnest(array['DELETE', 'INSERT', 'SELECT', 'UPDATE']) priv
                                            where has_table_privilege('authenticated', c.oid, priv)), ', ' order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relname in ('profiles', 'announcements')),
  'announcements=DELETE/INSERT/SELECT/UPDATE, profiles=INSERT/SELECT/UPDATE',
  '36. authenticated pe tabelele din app = comenzile cu politici (ca înainte de mutare)');
select is(
  (select string_agg(c.relname || '=' || (select coalesce(string_agg(priv, '/' order by priv), '-') from unnest(array['DELETE', 'INSERT', 'SELECT', 'UPDATE']) priv
                                            where has_table_privilege('anon', c.oid, priv)), ', ' order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind = 'r'),
  'announcements=SELECT, apple_tokens=-, channel_events=-, consent_log=-, moderation_notices=-, profiles=SELECT, push_queue=-, push_tickets=-, rate_events=-, report_ip_events=-, storage_gc_queue=-',
  '37. anon pe tabelele din app: doar SELECT pe cele două de sub view-uri (security_invoker), nimic altceva');
select is(
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by 1), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prokind = 'f' and pg_get_function_result(p.oid) <> 'trigger'
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      and p.proname not in ('uuid_or_null', 'storage_quota_ok', 'like_escape', 'search_norm', 'viewer_is_admin', 'profile_visible_to_anon')),
  '', '38. Funcțiile din app executabile prin API = doar allowlist-ul (uuid_or_null, storage_quota_ok, like_escape, search_norm, viewer_is_admin, profile_visible_to_anon)');
select is(
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by 1), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prokind = 'f'
      and regexp_replace(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g'), '/\*.*?\*/', ' ', 'g'), '''(?:[^'']|'''')*''', ' ', 'g')
          ~ '(^|[^[:alnum:]_.])(profiles|announcements)([^[:alnum:]_]|$)|public\.(profiles|announcements)([^[:alnum:]_]|$)'),
  '', '39. Nicio funcție din public/app nu referă profiles/announcements necalificat sau prin view');
select pg_temp.as_user('70000000-0000-4000-8000-0000000000a1', 'authenticated');
select is((select phone || '|' || (select public.is_admin())::text from public.get_own_profile()), '+40700000009|false',
          '40. get_own_profile() întoarce rândul propriu complet; is_admin() rămâne false pentru șofer (aal2 abia în faza 11)');
reset role;

-- ── 41–43. Scrierile interne și rolurile non-API (service_role, postgres) ─────────────────────────
-- 41. O scriere declanșată de alt trigger (adâncime 2, FĂRĂ view) rămâne nelimitată, ca azi: A are 5 deschise,
--     dar INSERT-ul venit dintr-un trigger trece.
create table pg_temp.t_depth (x int);
grant insert on pg_temp.t_depth to authenticated;
create function pg_temp.t_depth_fn() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into app.announcements (driver_id, description, location, status)
  values ('70000000-0000-4000-8000-0000000000a1', 'T intern adancime 2', 'loc', 'open');
  return new;
end $$;
create trigger t_depth_trg after insert on pg_temp.t_depth for each row execute function pg_temp.t_depth_fn();
select pg_temp.as_user('70000000-0000-4000-8000-0000000000a1', 'authenticated');
select lives_ok($$insert into pg_temp.t_depth values (1)$$, '41. INSERT intern la adâncimea 2 (fără view) nu e limitat, ca până acum');
reset role;
-- 42. Un rol non-API (postgres/service_role) vede valorile reale prin view (auth.uid() NULL nu înseamnă „străin”).
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((select plate_number || '|' || latitude::text from public.announcements where id = '71111111-0000-4000-8000-0000000000a2'),
          'B-02-TST|44.55', '42. service_role vede plăcuța și coordonatele exacte prin view');
-- 43. UPDATE prin view ca service_role (cum fac Edge Functions cleanup-announcements / translate-announcement):
--     doar coloana cerută se schimbă; plăcuța, VIN-ul, coordonatele rămân.
select is(pg_temp.affected($$update public.announcements set source_lang_detected = true where id = '71111111-0000-4000-8000-0000000000a2'$$),
          1, '43a. UPDATE prin view ca service_role atinge rândul');
reset role;
select is((select plate_number || '|' || chassis_number || '|' || latitude::text || '|' || source_lang_detected::text
             from app.announcements where id = '71111111-0000-4000-8000-0000000000a2'),
          'B-02-TST|VIN0002|44.55|true', '43b. După UPDATE-ul service_role, plăcuța/VIN-ul/coordonatele sunt intacte în tabel');

-- ── 44–52. 4.6 (migrarea 20261103000100): un anunț redeschis nu mai poartă mecanicul acceptat cândva ──
-- Fixture: a4 al lui B, acceptat de M1, mai vechi de 30 h (repost permis), anulat direct în tabel (drumul
-- „SQL manual” — singurul de la accepted la cancelled), apoi redeschis prin RPC. Claims-urile de aici sunt
-- cele de la 43a (service_role, fără sub): auth.uid() e NULL, limita de anunțuri nu se declanșează la fixture.
insert into app.announcements (id, driver_id, description, location, status, mechanic_id, created_at, plate_number, chassis_number, latitude, longitude)
values ('71111111-0000-4000-8000-0000000000a4', '70000000-0000-4000-8000-0000000000b1', 'T acceptat apoi redeschis', 'Cluj', 'accepted',
        '70000000-0000-4000-8000-0000000000c1', now() - interval '40 hours', 'B-04-TST', 'VIN0004', 46.7712, 23.6236);
select pg_temp.as_user('70000000-0000-4000-8000-0000000000c1', 'authenticated');
select is((select plate_number || '|' || chassis_number || '|' || latitude::text from public.announcements where id = '71111111-0000-4000-8000-0000000000a4'),
          'B-04-TST|VIN0004|46.7712', '44. Cât e acceptat, M1 vede plăcuța, VIN-ul și poziția exactă');
reset role;
update app.announcements set status = 'cancelled' where id = '71111111-0000-4000-8000-0000000000a4';
select is((select mechanic_id::text from app.announcements where id = '71111111-0000-4000-8000-0000000000a4'), '70000000-0000-4000-8000-0000000000c1',
          '45. Anularea directă (SQL) lasă mechanic_id pe loc, ca înainte');
select pg_temp.as_user('70000000-0000-4000-8000-0000000000b1', 'authenticated');
select lives_ok($$select public.repost_announcement('71111111-0000-4000-8000-0000000000a4')$$,
          '46. B redeschide anunțul prin repost_announcement (sub plafon, mai vechi de 30 h)');
reset role;
select is((select status || '|' || coalesce(mechanic_id::text, 'null') from app.announcements where id = '71111111-0000-4000-8000-0000000000a4'),
          'open|null', '47. Redeschis: status open și mechanic_id NULL (trigger-ul 4.6)');
select pg_temp.as_user('70000000-0000-4000-8000-0000000000c1', 'authenticated');
select is((select plate_number from public.announcements where id = '71111111-0000-4000-8000-0000000000a4'), null,
          '48a. Fostul mecanic nu mai vede plăcuța anunțului redeschis');
select is((select chassis_number from public.announcements where id = '71111111-0000-4000-8000-0000000000a4'), null,
          '48b. Fostul mecanic nu mai vede VIN-ul anunțului redeschis');
select is((select latitude::numeric || '|' || longitude::numeric from public.announcements where id = '71111111-0000-4000-8000-0000000000a4'),
          '46.77|23.62', '48c. Fostul mecanic vede poziția la ~1 km, ca orice mecanic neacceptat');
reset role;
-- Invariantul ține pe orice drum: un UPDATE direct care pune mechanic_id pe un anunț deschis îl pierde…
update app.announcements set mechanic_id = '70000000-0000-4000-8000-0000000000c1' where id = '71111111-0000-4000-8000-0000000000a4';
select is((select mechanic_id from app.announcements where id = '71111111-0000-4000-8000-0000000000a4'), null,
          '49. UPDATE direct cu mechanic_id pe un anunț deschis → rămâne NULL');
-- …iar acceptarea reală (RPC-ul accept_application: status = accepted și mechanic_id în ACELAȘI UPDATE) e neatinsă.
insert into public.applications (id, announcement_id, mechanic_id, price_type, price_amount, currency, status)
values ('74111111-0000-4000-8000-0000000000a4', '71111111-0000-4000-8000-0000000000a4', '70000000-0000-4000-8000-0000000000c1', 'fixed', 100, 'RON', 'pending');
select pg_temp.as_user('70000000-0000-4000-8000-0000000000b1', 'authenticated');
select lives_ok($$select public.accept_application('74111111-0000-4000-8000-0000000000a4')$$,
          '50a. B acceptă candidatura lui M1 prin RPC-ul real');
reset role;
select is((select status || '|' || mechanic_id::text from app.announcements where id = '71111111-0000-4000-8000-0000000000a4'),
          'accepted|70000000-0000-4000-8000-0000000000c1', '50b. Acceptarea păstrează mechanic_id (trigger-ul acționează doar pe open)');
-- Catalog: trigger-ul activ pe app.announcements, funcția lui neexecutabilă prin API.
select is((select count(*)::int from pg_trigger where tgname = 'announcements_open_clears_mechanic'
             and tgrelid = 'app.announcements'::regclass and tgenabled <> 'D'), 1,
          '51. Trigger-ul announcements_open_clears_mechanic e prezent și activ pe app.announcements');
select ok(not has_function_privilege('anon', 'app.announcements_open_clears_mechanic()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'app.announcements_open_clears_mechanic()', 'EXECUTE'),
          '52. Funcția trigger-ului nu e executabilă prin API');

select * from finish();
rollback;
