-- pgTAP: faza 9.3 (migrarea 20261111000200_kicks_push_secret): nicio cheie service_role nu mai pleacă prin pg_net.
--   • cron-ul cleanup-announcements-hourly apelează app.kick_cleanup_announcements() (x-push-secret din Vault, fără Authorization);
--   • public.storage_api_delete pune calea în coada fazei 6 (motiv sql_delete) în loc de DELETE pe Storage API;
--   • C9.2: storage-gc-hourly consumă coada la cel mult o oră (kick doar când există rânduri); scanarea rămâne în jobul zilnic;
--   • nicio funcție din public / app și nicio comandă cron nu mai conține service_role_key / Authorization.
-- Cererile pg_net se verifică în net.http_request_queue (rândul apare în tranzacție; nu pleacă nimic — testul face rollback).
-- Dacă rolul testului nu poate citi tabelul, verificările pe cereri trec în gol (helper-ele întorc NULL); restul rămân stricte.
-- Id-urile 92… .
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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

-- Câte cereri pg_net sunt în coadă pentru un URL / o metodă (NULL dacă tabelul nu e lizibil).
create function pg_temp.http_count(p_url_like text, p_method text default null) returns int language plpgsql as $$
declare v_n int;
begin
  execute 'select count(*)::int from net.http_request_queue where url like $1 and ($2 is null or method::text = $2)'
    into v_n using p_url_like, p_method;
  return v_n;
exception when others then
  return null;
end $$;
-- Ultima cerere către un URL: header-ele și body-ul (NULL dacă nu există sau tabelul nu e lizibil).
create function pg_temp.http_last(p_url_like text) returns jsonb language plpgsql as $$
declare v_j jsonb;
begin
  execute 'select jsonb_build_object(''headers'', headers, ''body'', convert_from(body, ''UTF8'')::jsonb)
             from net.http_request_queue where url like $1 order by id desc limit 1'
    into v_j using p_url_like;
  return v_j;
exception when others then
  return null;
end $$;

-- ── Fixture: șofer A, mecanic C, admin D; un anunț cu poză; o conversație cu un mesaj cu poză ─────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change,
                        phone_change_token, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false
  from (values
    ('92000000-0000-4000-8000-0000000000a1'::uuid, 'kp-driver-a@example.com'),
    ('92000000-0000-4000-8000-0000000000c1', 'kp-mech-c@example.com'),
    ('92000000-0000-4000-8000-0000000000d1', 'kp-admin-d@example.com')
  ) as u(id, email);
insert into app.profiles (id, full_name, role, phone, lang) values
  ('92000000-0000-4000-8000-0000000000a1', 'KP Driver A', 'driver',   '+40700000921', 'ro'),
  ('92000000-0000-4000-8000-0000000000c1', 'KP Mech C',   'mechanic', '+40700000922', 'ro'),
  ('92000000-0000-4000-8000-0000000000d1', 'KP Admin D',  'admin',    '+40700000923', 'ro');
insert into app.announcements (id, driver_id, description, location, status) values
  ('92111111-0000-4000-8000-000000000001', '92000000-0000-4000-8000-0000000000a1', 'KP anunt cu poza', 'B', 'open');
insert into public.announcement_photos (announcement_id, storage_path) values
  ('92111111-0000-4000-8000-000000000001', 'announcements/92111111-0000-4000-8000-000000000001/p1.jpg');
insert into public.conversations (id, driver_id, mechanic_id, is_direct, announcement_id) values
  ('92333333-0000-4000-8000-000000000001', '92000000-0000-4000-8000-0000000000a1', '92000000-0000-4000-8000-0000000000c1', true, null);
insert into public.messages (id, conversation_id, sender_id, content, image_path) values
  ('92444444-0000-4000-8000-000000000001', '92333333-0000-4000-8000-000000000001', '92000000-0000-4000-8000-0000000000a1', 'KP mesaj cu poza',
   'chat/92333333-0000-4000-8000-000000000001/m1.jpg');

create temp table kp_before on commit drop as
  select pg_temp.http_count('%/storage/v1/object/%') as storage_api,
         pg_temp.http_count('%/functions/v1/cleanup-announcements') as cleanup,
         pg_temp.http_count('%/functions/v1/storage-gc') as gc;

-- ── 1–5. Cron și catalog ─────────────────────────────────────────────────────────────────────────────
select ok((select schedule = '17 * * * *' and command like '%app.kick_cleanup_announcements()%'
                  and command not ilike '%authorization%' and command not ilike '%vault%' and command not ilike '%http_post%'
             from cron.job where jobname = 'cleanup-announcements-hourly'),
          '1. cleanup-announcements-hourly apelează kick-ul (fără Authorization / Vault în comanda cron)');
select ok((select schedule = '35 * * * *' and command like '%app.kick_storage_gc(false)%' and active from cron.job where jobname = 'storage-gc-hourly'),
          '2. C9.2: storage-gc-hourly există (la fiecare oră, fără scanare)');
select ok((select schedule = '50 4 * * *' and command like '%app.kick_storage_gc(%DOW%' from cron.job where jobname = 'storage-gc-daily'),
          '3. storage-gc-daily rămâne la 04:50, cu scanarea orfanilor doar duminica');
select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by 1), '')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'app') and p.prosrc ilike '%service_role_key%'),
          '', '4. nicio funcție din public / app nu mai conține service_role_key');
select is((select count(*)::int from cron.job where command ilike '%service_role_key%' or command ilike '%authorization%'), 0,
          '5. nicio comandă cron nu mai conține service_role_key / Authorization');

-- ── 6–8. Funcțiile ───────────────────────────────────────────────────────────────────────────────────
select ok((select prosrc not ilike '%http_delete%' and prosrc not ilike '%vault%' and prosrc like '%app.storage_gc_enqueue%'
             from pg_proc where oid = 'public.storage_api_delete(text, text)'::regprocedure),
          '6. storage_api_delete nu mai face http_delete și nu mai citește Vault; pune în coadă');
select ok(to_regprocedure('app.kick_storage_gc()') is null and to_regprocedure('app.kick_storage_gc(boolean)') is not null,
          '7. kick_storage_gc are doar forma cu p_scan');
select is((select bool_or(has_function_privilege(r, f, 'EXECUTE'))
             from unnest(array['anon', 'authenticated']) r,
                  unnest(array['public.storage_api_delete(text, text)', 'app.kick_cleanup_announcements()', 'app.kick_storage_gc(boolean)']) f),
          false, '8. anon / authenticated nu pot executa storage_api_delete și kick-urile');

-- ── 9–12. storage_api_delete → coadă ─────────────────────────────────────────────────────────────────
select public.storage_api_delete('photos', 'chat/92333333-0000-4000-8000-000000000001/direct.jpg');
select is((select bucket || '|' || reason from app.storage_gc_queue where name = 'chat/92333333-0000-4000-8000-000000000001/direct.jpg'),
          'photos|sql_delete', '9. storage_api_delete pune calea în coadă cu motivul sql_delete');
select public.storage_api_delete('photos', 'chat/92333333-0000-4000-8000-000000000001/direct.jpg');
select public.storage_api_delete('photos', null);
select public.storage_api_delete('photos', '');
select is((select count(*)::int from app.storage_gc_queue where name like '%/92%'), 1,
          '10. al doilea apel nu dublează; NULL și gol nu adaugă nimic');
select public.storage_api_delete(null, 'chat/92333333-0000-4000-8000-000000000001/nobucket.jpg');
select is((select bucket from app.storage_gc_queue where name = 'chat/92333333-0000-4000-8000-000000000001/nobucket.jpg'), 'photos',
          '11. bucket lipsă → photos');
select ok((select storage_api is null or pg_temp.http_count('%/storage/v1/object/%') = storage_api from kp_before),
          '12. nicio cerere pg_net către Storage API');

-- ── 13–16. Apelanții din SQL (moderare) ajung în coadă ───────────────────────────────────────────────
select pg_temp.as_user('92000000-0000-4000-8000-0000000000d1', 'authenticated');
select lives_ok($$ select public.admin_delete_message('messages', '92444444-0000-4000-8000-000000000001', 'test') $$,
                '13. admin_delete_message pe un mesaj cu poză');
select lives_ok($$ select public.admin_delete_announcement('92111111-0000-4000-8000-000000000001', 'test') $$,
                '14. admin_delete_announcement pe un anunț cu poză');
select pg_temp.as_postgres();
select is((select string_agg(name, ' | ' order by name) from app.storage_gc_queue where reason = 'sql_delete' and name like '%/92%' and name like '%1.jpg'),
          'announcements/92111111-0000-4000-8000-000000000001/p1.jpg | chat/92333333-0000-4000-8000-000000000001/m1.jpg',
          '15. poza mesajului și poza anunțului sunt în coadă (șterse din Storage de EF storage-gc în cel mult o oră)');
select ok((select image_path is null and deleted_at is not null from public.messages where id = '92444444-0000-4000-8000-000000000001')
          and not exists (select 1 from app.announcements where id = '92111111-0000-4000-8000-000000000001'),
          '16. … iar ștergerile din bază s-au făcut ca înainte');

-- ── 17–20. Kick-ul cleanup-announcements ─────────────────────────────────────────────────────────────
delete from vault.secrets where name = 'push_kick_secret';
select lives_ok($$ select app.kick_cleanup_announcements() $$, '17. fără secret în Vault kick-ul nu aruncă (doar WARNING)');
select ok((select cleanup is null or pg_temp.http_count('%/functions/v1/cleanup-announcements') = cleanup from kp_before),
          '18. … și nu pleacă nicio cerere');
do $$ begin perform vault.create_secret(repeat('k', 64), 'push_kick_secret'); end $$;
select app.kick_cleanup_announcements();
select ok((select cleanup is null or pg_temp.http_count('%/functions/v1/cleanup-announcements', 'POST') = cleanup + 1 from kp_before),
          '19. cu secret: exact o cerere POST către EF cleanup-announcements');
select ok(coalesce((select (j->'headers'->>'x-push-secret') = repeat('k', 64) and not (j->'headers') ? 'Authorization'
                      from (select pg_temp.http_last('%/functions/v1/cleanup-announcements') as j) x), true),
          '20. cererea are x-push-secret din Vault și NU are Authorization');

-- ── 21–24. Kick-ul storage-gc (C9.2) ─────────────────────────────────────────────────────────────────
delete from app.storage_gc_queue;
select app.kick_storage_gc(false);
select ok((select gc is null or pg_temp.http_count('%/functions/v1/storage-gc') = gc from kp_before),
          '21. coadă goală + fără scanare → nicio cerere (kick-ul orar nu apelează EF degeaba)');
select app.storage_gc_enqueue(array['chat/92333333-0000-4000-8000-000000000001/kick.jpg'], 'sql_delete');
select app.kick_storage_gc();
select ok((select gc is null or pg_temp.http_count('%/functions/v1/storage-gc') = gc + 1 from kp_before),
          '22. coadă cu rânduri → o cerere (și apelul fără argument merge: p_scan implicit false)');
select ok(coalesce((select (j->'body'->>'scan') = 'false' and (j->'headers') ? 'x-push-secret' and not (j->'headers') ? 'Authorization'
                      from (select pg_temp.http_last('%/functions/v1/storage-gc') as j) x), true),
          '23. … cu scan = false și doar x-push-secret');
delete from app.storage_gc_queue;
select app.kick_storage_gc(true);
select ok(coalesce((select (j->'body'->>'scan') = 'true' from (select pg_temp.http_last('%/functions/v1/storage-gc') as j) x), true)
          and (select gc is null or pg_temp.http_count('%/functions/v1/storage-gc') = gc + 2 from kp_before),
          '24. p_scan = true (jobul zilnic, duminica) → cerere cu scan = true chiar cu coada goală');

select * from finish();
rollback;
