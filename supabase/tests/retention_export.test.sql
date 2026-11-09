-- pgTAP: faza 6.3 + 6.4 (migrările 20261109000500_retention și 20261109000600_export_my_data): retenția zilnică
-- (dry-run, anonimizare, ștergeri, coada Storage, auditul mascat) și exportul datelor proprii (doar ale mele, 1/zi).
-- Id-urile 78… .
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

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
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change,
                        phone_change_token, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now() - interval '3 years',
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now() - interval '3 years', now() - interval '3 years',
       '', '', '', '', '', '', '', '', false, false
  from (values
    ('78000000-0000-4000-8000-0000000000a1'::uuid, 'r-driver-a@example.com'),
    ('78000000-0000-4000-8000-0000000000c1', 'r-mech-m@example.com'),
    ('78000000-0000-4000-8000-0000000000d1', 'r-admin@example.com')
  ) as u(id, email);
insert into app.profiles (id, full_name, role, phone, address, lang, created_at) values
  ('78000000-0000-4000-8000-0000000000a1', 'R Driver A', 'driver',   '+40700000001', 'Str. A 1', 'ro', now() - interval '3 years'),
  ('78000000-0000-4000-8000-0000000000c1', 'R Mech M',   'mechanic', '+40700000011', null,       'ro', now() - interval '3 years'),
  ('78000000-0000-4000-8000-0000000000d1', 'R Admin',    'admin',    '+40700000099', null,       'ro', now() - interval '3 years');
insert into public.trucks (id, driver_id, make, model, year, plate_number) values
  ('78555555-0000-4000-8000-000000000001', '78000000-0000-4000-8000-0000000000a1', 'MAN', 'TGX', 2020, 'B-77-RRR');

-- anunțuri: închis vechi cu date (de anonimizat), închis recent (păstrat), ciornă veche cu poză (de șters), ciornă nouă (păstrată)
insert into app.announcements (id, driver_id, description, location, status, created_at, updated_at, plate_number, chassis_number, latitude, longitude) values
  ('78111111-0000-4000-8000-000000000001', '78000000-0000-4000-8000-0000000000a1', 'R rezolvat vechi', 'B', 'resolved',  now() - interval '120 days', now() - interval '100 days', 'B-01-R', 'VINR01', 44.43, 26.10),
  ('78111111-0000-4000-8000-000000000002', '78000000-0000-4000-8000-0000000000a1', 'R anulat recent',  'B', 'cancelled', now() - interval '20 days',  now() - interval '10 days',  'B-02-R', null,     44.43, 26.10),
  ('78111111-0000-4000-8000-000000000003', '78000000-0000-4000-8000-0000000000a1', 'R ciorna veche',   'B', 'draft',     now() - interval '30 hours', now() - interval '30 hours', null, null, null, null),
  ('78111111-0000-4000-8000-000000000004', '78000000-0000-4000-8000-0000000000a1', 'R ciorna noua',    'B', 'draft',     now() - interval '1 hour',   now() - interval '1 hour',   null, null, null, null);
insert into public.announcement_photos (announcement_id, storage_path) values
  ('78111111-0000-4000-8000-000000000003', 'announcements/78111111-0000-4000-8000-000000000003/draft-photo.jpg'),
  ('78111111-0000-4000-8000-000000000001', 'announcements/78111111-0000-4000-8000-000000000001/kept.jpg');
insert into public.announcement_views (announcement_id, viewer_id, viewed_at) values
  ('78111111-0000-4000-8000-000000000001', '78000000-0000-4000-8000-0000000000c1', now() - interval '100 days'),
  ('78111111-0000-4000-8000-000000000002', '78000000-0000-4000-8000-0000000000c1', now() - interval '5 days');
-- rapoarte: închis vechi cu snapshot orfan (de șters, poza în coadă), pending vechi (păstrat), închis vechi cu snapshot =
-- poza unui mesaj VIU (rândul se șterge, poza NU intră în coadă — review 9 nov: snapshot-ul e aceeași cale cu a mesajului)
insert into public.reports (id, reporter_id, reported_user_id, reason, status, created_at, image_path_snapshot) values
  ('78222222-0000-4000-8000-000000000001', '78000000-0000-4000-8000-0000000000a1', '78000000-0000-4000-8000-0000000000c1', 'spam', 'reviewed',  now() - interval '13 months', 'chat/78333333-0000-4000-8000-000000000001/snap.jpg'),
  ('78222222-0000-4000-8000-000000000002', '78000000-0000-4000-8000-0000000000a1', '78000000-0000-4000-8000-0000000000c1', 'spam', 'pending',   now() - interval '13 months', null),
  ('78222222-0000-4000-8000-000000000003', '78000000-0000-4000-8000-0000000000a1', '78000000-0000-4000-8000-0000000000c1', 'spam', 'dismissed', now() - interval '13 months', 'chat/78333333-0000-4000-8000-000000000002/live.jpg');
-- audit: vechi (de șters), recent (păstrat)
insert into public.admin_audit_log (admin_id, action, target_type, target_id, details, created_at) values
  ('78000000-0000-4000-8000-0000000000d1', 'r_old', 'user', '78000000-0000-4000-8000-0000000000a1', '{}', now() - interval '13 months'),
  ('78000000-0000-4000-8000-0000000000d1', 'r_new', 'user', '78000000-0000-4000-8000-0000000000a1', '{}', now() - interval '1 month');
-- conversații: veche inactivă cu atașament (de șters), activă (păstrată)
-- a doua conversație nu poate fi tot directă (idx_conversations_direct_pair: o singură conversație directă per pereche) → legată de anunțul 002
insert into public.conversations (id, driver_id, mechanic_id, is_direct, announcement_id, created_at) values
  ('78333333-0000-4000-8000-000000000001', '78000000-0000-4000-8000-0000000000a1', '78000000-0000-4000-8000-0000000000c1', true,  null, now() - interval '30 months'),
  ('78333333-0000-4000-8000-000000000002', '78000000-0000-4000-8000-0000000000a1', '78000000-0000-4000-8000-0000000000c1', false, '78111111-0000-4000-8000-000000000002', now() - interval '30 months');
insert into public.messages (id, conversation_id, sender_id, content, created_at, image_path) values
  ('78444444-0000-4000-8000-000000000001', '78333333-0000-4000-8000-000000000001', '78000000-0000-4000-8000-0000000000a1', 'R vechi A', now() - interval '29 months', 'chat/78333333-0000-4000-8000-000000000001/old.jpg'),
  ('78444444-0000-4000-8000-000000000002', '78333333-0000-4000-8000-000000000001', '78000000-0000-4000-8000-0000000000c1', 'R vechi M', now() - interval '28 months', null),
  ('78444444-0000-4000-8000-000000000003', '78333333-0000-4000-8000-000000000002', '78000000-0000-4000-8000-0000000000a1', 'R activ A', now() - interval '29 months', 'chat/78333333-0000-4000-8000-000000000002/live.jpg'),
  ('78444444-0000-4000-8000-000000000004', '78333333-0000-4000-8000-000000000002', '78000000-0000-4000-8000-0000000000c1', 'R activ M', now() - interval '2 days', null);

-- ── 1–4. Dry-run: contoare, nimic schimbat ──────────────────────────────────────────────────────────
select is((select r->>'dry_run' from app.apply_retention(true) r), 'true', '1. dry-run raportat');
-- contoarele sunt pe TOATĂ baza (în CI pot exista și rânduri vechi de la poarta 4.1) → „cel puțin cât fixture-ul”
select is((select (r->>'closed_announcements_anonymized')::int >= 1 and (r->>'drafts_deleted')::int >= 1 and (r->>'views_deleted')::int >= 1
                  and (r->>'reports_deleted')::int >= 2 and (r->>'audit_deleted')::int >= 1 and (r->>'conversations_deleted')::int >= 1
             from app.apply_retention(true) r),
          true, '2. dry-run numără pe fiecare regulă cel puțin rândurile fixture-ului');
select is((select plate_number from app.announcements where id = '78111111-0000-4000-8000-000000000001'), 'B-01-R', '3. dry-run nu anonimizează');
select is((select count(*)::int from public.conversations where id::text like '78333333-%'), 2, '4. dry-run nu șterge');

-- ── 5–16. Rularea reală ─────────────────────────────────────────────────────────────────────────────
select is((select r->>'drafts_deleted' from app.apply_retention(false) r), '1', '5. rularea reală raportează ciorna ștearsă');
select is((select plate_number || '|' || coalesce(chassis_number, '-') || '|' || coalesce(latitude::text, '-') || '|' || coalesce(lat_approx::text, '-')
             from app.announcements where id = '78111111-0000-4000-8000-000000000001'),
          null, '6. anunțul închis > 90 z: plăcuța NULL (expresia întreagă devine NULL)');
select is((select chassis_number is null and latitude is null and longitude is null and lat_approx is null and location = 'B'
             from app.announcements where id = '78111111-0000-4000-8000-000000000001'),
          true, '6b. … VIN, coordonate și lat_approx (GENERATED) NULL; location păstrat');
select is((select plate_number from app.announcements where id = '78111111-0000-4000-8000-000000000002'), 'B-02-R', '7. anunțul închis recent e păstrat intact');
select is((select count(*)::int from app.announcements where id = '78111111-0000-4000-8000-000000000003'), 0, '8. ciorna > 24 h ștearsă');
select is((select count(*)::int from app.announcements where id = '78111111-0000-4000-8000-000000000004'), 1, '9. ciorna nouă păstrată');
select is((select reason from app.storage_gc_queue where name = 'announcements/78111111-0000-4000-8000-000000000003/draft-photo.jpg'),
          'expired_draft', '10. poza ciornei a intrat în coada Storage');
select is((select count(*)::int from public.announcement_views where announcement_id::text like '78111111-%'), 1, '11. vizualizarea > 90 z ștearsă, cea recentă păstrată');
select is((select string_agg(status, ',') from public.reports where id::text like '78222222-%'), 'pending', '12. raportul închis > 12 luni șters, cel pending păstrat');
select is((select reason from app.storage_gc_queue where name = 'chat/78333333-0000-4000-8000-000000000001/snap.jpg'), 'expired_report_snapshot', '13. snapshot-ul orfan al raportului în coadă');
select is((select count(*)::int from app.storage_gc_queue where name = 'chat/78333333-0000-4000-8000-000000000002/live.jpg'), 0,
          '13b. snapshot-ul care e poza unui mesaj viu NU intră în coadă (raportul e șters, poza rămâne)');
select is((select string_agg(action, ',') from public.admin_audit_log where admin_id = '78000000-0000-4000-8000-0000000000d1' and action like 'r_%'), 'r_new', '14. auditul > 12 luni șters');
select is((select string_agg(id::text, ',') from public.conversations where id::text like '78333333-%'), '78333333-0000-4000-8000-000000000002',
          '15. conversația fără mesaj în 24 luni ștearsă (cu mesajele ei), cea activă păstrată');
select is((select count(*)::int from public.messages where conversation_id = '78333333-0000-4000-8000-000000000001'), 0, '15b. mesajele ei au căzut prin cascadă');
select is((select reason from app.storage_gc_queue where name = 'chat/78333333-0000-4000-8000-000000000001/old.jpg'), 'expired_conversation', '16. atașamentul ei în coadă');

-- ── 17. Idempotență ─────────────────────────────────────────────────────────────────────────────────
select is((select (r->>'closed_announcements_anonymized') || '|' || (r->>'drafts_deleted') || '|' || (r->>'conversations_deleted') from app.apply_retention(false) r),
          '0|0|0', '17. a doua rulare nu mai găsește nimic');

-- ── 18–20. admin_update_profile: auditul fără date personale în clar ────────────────────────────────
select pg_temp.as_user('78000000-0000-4000-8000-0000000000d1', 'authenticated');
select public.admin_update_profile('78000000-0000-4000-8000-0000000000a1', '{"phone": "+40711111111", "full_name": "R Driver A2"}'::jsonb);
select pg_temp.as_postgres();
select is((select phone from app.profiles where id = '78000000-0000-4000-8000-0000000000a1'), '+40711111111', '18. profilul e actualizat');
select is((select (details->'old'->>'phone') like '#%' and (details->'new'->>'phone') like '#%' from public.admin_audit_log
             where action = 'update_profile' and target_id = '78000000-0000-4000-8000-0000000000a1' order by created_at desc limit 1),
          true, '19. telefonul vechi și nou apar doar ca hash scurt');
select is((select details->'old'->>'full_name' || '>' || (details->'new'->>'full_name') from public.admin_audit_log
             where action = 'update_profile' and target_id = '78000000-0000-4000-8000-0000000000a1' order by created_at desc limit 1),
          'R Driver A>R Driver A2', '20. numele rămâne în clar; cheile neatinse (address) nu apar');

-- ── 21–30. export_my_data ───────────────────────────────────────────────────────────────────────────
-- tabelul temporar se creează ca postgres (authenticated n-are neapărat drept de TEMP), apoi se umple ca utilizator
create temp table exp (j jsonb) on commit drop;
grant all on exp to authenticated;
select pg_temp.as_user('78000000-0000-4000-8000-0000000000a1', 'authenticated');
insert into exp select public.export_my_data();
select is((select j->'profile'->>'full_name' from exp), 'R Driver A2', '21. profilul propriu');
select is((select jsonb_array_length(j->'trucks') from exp), 1, '22. camioanele');
select is((select jsonb_array_length(j->'announcements') from exp), 3, '23. anunțurile proprii (inclusiv ciorna rămasă)');
select is((select j->'announcements'->0 ? 'lat_approx' from exp), false, '23b. fără coloanele generate');
select is((select string_agg(x->>'content', ',') from exp, jsonb_array_elements(j->'messages_sent'->'items') x), 'R activ A',
          '24. DOAR mesajele trimise de mine (nu „R activ M” al mecanicului; cele vechi au fost șterse de retenție)');
select is((select (j->'messages_sent'->>'truncated')::boolean from exp), false, '25. fără trunchiere la volum mic');
select is((select j ? 'push_devices' and j ? 'moderation_notices' and j ? 'ratings_given' and j ? 'blocked_users' from exp), true, '26. secțiunile există și goale');
select is((select (public.export_my_data()->>'user_id')::uuid), '78000000-0000-4000-8000-0000000000a1', '27. al doilea apel în 24 h merge (cota e 2/24 h — decizia din 9 nov)');
select throws_ok($$ select public.export_my_data() $$, 'P0001', 'rate_limited', '27b. al treilea apel în 24 h → rate_limited');
select pg_temp.as_user('78000000-0000-4000-8000-0000000000c1', 'authenticated');
select is((select jsonb_array_length(public.export_my_data()->'applications')), 0, '28. alt utilizator primește exportul LUI (fără camioanele lui A)');
select pg_temp.as_postgres();
select is(has_function_privilege('anon', 'public.export_my_data()', 'EXECUTE'), false, '29. anon nu poate exporta');
select is(has_function_privilege('authenticated', 'public.export_my_data()', 'EXECUTE'), true, '30. authenticated poate');

select * from finish();
rollback;
