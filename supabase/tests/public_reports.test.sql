-- pgTAP: faza 8.3 (migrarea 20261110000200_public_reports): sesizări publice fără cont (reporter_id NULL, source = 'public',
-- reporter_email), C8.1 (push la toți adminii și la raport public), limita pe IP din bază, invizibilitatea pentru utilizatori,
-- FK announcement_id SET NULL, snapshot-ul care ia utilizatorul raportat din țintă, admin_list_reports cu coloanele noi,
-- retenția 12 luni, raportul din app neschimbat.
-- Id-urile 81… .
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

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

-- ── Fixture: șofer A, mecanic C, doi admini cu token push, un anunț al lui A, un listing al lui C ────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change,
                        phone_change_token, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false
  from (values
    ('81000000-0000-4000-8000-0000000000a1'::uuid, 'pr-driver-a@example.com'),
    ('81000000-0000-4000-8000-0000000000c1', 'pr-mech-c@example.com'),
    ('81000000-0000-4000-8000-0000000000d1', 'pr-admin-1@example.com'),
    ('81000000-0000-4000-8000-0000000000d2', 'pr-admin-2@example.com')
  ) as u(id, email);
insert into app.profiles (id, full_name, role, phone, lang, push_enabled) values
  ('81000000-0000-4000-8000-0000000000a1', 'PR Driver A', 'driver',   '+40700000811', 'ro', true),
  ('81000000-0000-4000-8000-0000000000c1', 'PR Mech C',   'mechanic', '+40700000812', 'ro', true),
  ('81000000-0000-4000-8000-0000000000d1', 'PR Admin 1',  'admin',    '+40700000813', 'ro', true),
  ('81000000-0000-4000-8000-0000000000d2', 'PR Admin 2',  'admin',    '+40700000814', 'de', true);
insert into app.announcements (id, driver_id, description, location, status, latitude, longitude) values
  ('81111111-0000-4000-8000-000000000001', '81000000-0000-4000-8000-0000000000a1', 'PR anunt raportabil', 'B', 'open', 44.43, 26.10);
insert into public.market_listings (id, seller_id, title, description, price, category) values
  ('81444444-0000-4000-8000-000000000001', '81000000-0000-4000-8000-0000000000c1', 'PR listing', 'descriere', 100, 'parts');
-- raport public închis acum 13 luni (retenția trebuie să-l șteargă împreună cu e-mailul) — ÎNAINTE de tokenii push, ca
-- trigger-ul de notificare să nu pună push-uri în coadă (notify_push iese fără token)
insert into public.reports (reporter_id, reported_user_id, reason, status, created_at, reporter_email, source) values
  (null, '81000000-0000-4000-8000-0000000000c1', 'spam', 'dismissed', now() - interval '13 months', 'old-public@example.com', 'public');
insert into public.push_tokens (token, user_id, platform) values
  ('ExponentPushToken[pr-d1]', '81000000-0000-4000-8000-0000000000d1', 'android'),
  ('ExponentPushToken[pr-d2]', '81000000-0000-4000-8000-0000000000d2', 'ios');

-- SECURITY DEFINER (owner postgres): numără push-urile de tip report din coadă chiar și cât rolul e `authenticated`.
create function pg_temp.report_pushes() returns int language sql security definer as $$
  select count(*)::int from app.push_queue where data->>'type' = 'report' and user_id in ('81000000-0000-4000-8000-0000000000d1', '81000000-0000-4000-8000-0000000000d2');
$$;
create function pg_temp.ip(p_n int) returns text language sql immutable as $$ select repeat(lpad(p_n::text, 2, '0'), 32) $$;
grant execute on function pg_temp.report_pushes(), pg_temp.ip(int) to authenticated, anon;

-- ── 1–4. Catalog ───────────────────────────────────────────────────────────────────────────────────────
select ok(not (select attnotnull from pg_attribute where attrelid = 'public.reports'::regclass and attname = 'reporter_id'),
          '1. reports.reporter_id e nullable');
select is(
  (select string_agg(conname, ',' order by conname) from pg_constraint where conrelid = 'public.reports'::regclass
    and conname in ('reports_source_check', 'reports_public_has_email', 'reports_reporter_email_length', 'reports_reporter_lang_check', 'reports_announcement_id_fkey')),
  'reports_announcement_id_fkey,reports_public_has_email,reports_reporter_email_length,reports_reporter_lang_check,reports_source_check',
  '2. constrângerile noi există');
select ok(
  (select relrowsecurity from pg_class where oid = 'app.report_ip_events'::regclass)
  and not has_table_privilege('anon', 'app.report_ip_events', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'app.report_ip_events', 'SELECT, INSERT, UPDATE, DELETE'),
  '3. report_ip_events: RLS activ, fără drepturi pentru anon/authenticated');
select ok(
  not has_function_privilege('anon', 'public.insert_public_report(text, text, uuid, text, text, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.insert_public_report(text, text, uuid, text, text, text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.insert_public_report(text, text, uuid, text, text, text, text)', 'EXECUTE'),
  '4. insert_public_report: doar service_role');

-- ── 5–8. Raport public pe anunț (ca service_role: auth.uid() NULL) ────────────────────────────────────
select is(pg_temp.report_pushes(), 0, '5. nicio notificare de raport înainte (fixture-ul vechi a intrat fără tokeni)');
create temp table t_pub as
  select (public.insert_public_report(pg_temp.ip(1), 'announcement', '81111111-0000-4000-8000-000000000001', 'illegal',
                                      '  Conținut ilegal, vezi linkul  ', 'Reporter@Example.com', 'de')->>'id')::uuid as id;
select is((select source || '|' || (reporter_id is null)::text || '|' || reported_user_id::text || '|' || announcement_id::text || '|' || reporter_email || '|' || reporter_lang || '|' || reason || '|' || details
             from public.reports where id = (select id from t_pub)),
          'public|true|81000000-0000-4000-8000-0000000000a1|81111111-0000-4000-8000-000000000001|reporter@example.com|de|illegal|Conținut ilegal, vezi linkul',
          '6. rândul public: fără reporter, e-mail normalizat, limba, autorul anunțului ca raportat, motiv nou, detalii curățate');
select is(pg_temp.report_pushes(), 2, '7. C8.1: ambii admini primesc push la raportul public (reporter_id NULL)');
select is((select count(*)::int from app.report_ip_events where ip_hash = pg_temp.ip(1)), 1, '8. o intrare în evidența pe IP');

-- ── 9–11. Invizibil pentru utilizatori; clienții nu pot insera rapoarte publice ───────────────────────
select pg_temp.as_user('81000000-0000-4000-8000-0000000000c1', 'authenticated');
select is((select count(*)::int from public.reports where source = 'public'), 0, '9. un utilizator nu vede rapoartele publice (RLS reporter_id = uid)');
select throws_ok($$insert into public.reports (reporter_id, reported_user_id, reason, reporter_email, source)
                   values (null, '81000000-0000-4000-8000-0000000000a1', 'spam', 'x@example.com', 'public')$$,
                 '42501', null, '10. INSERT public direct din client → RLS îl refuză');
select throws_ok($$select public.insert_public_report(pg_temp.ip(1), 'user', '81000000-0000-4000-8000-0000000000a1', 'spam', null, 'x@example.com')$$,
                 '42501', 'permission denied for function insert_public_report', '11. authenticated nu poate apela insert_public_report');
select pg_temp.as_postgres();

-- ── 12–17. Validări, ținte și limita pe IP ───────────────────────────────────────────────────────────
select is((select public.insert_public_report(pg_temp.ip(2), 'announcement', '81111111-0000-4000-8000-0000000000ff', 'spam', null, 'a@b.ro')),
          '{"error": "target_not_found"}'::jsonb, '12. țintă inexistentă → {error: target_not_found}, fără excepție');
select is((select count(*)::int from app.report_ip_events where ip_hash = pg_temp.ip(2)), 1, '13. încercarea respinsă consumă limita pe IP');
select throws_ok($$select public.insert_public_report(pg_temp.ip(2), 'user', '81000000-0000-4000-8000-0000000000a1', 'spam', null, 'fara-arond')$$,
                 'P0001', 'bad_input', '14. e-mail invalid → bad_input');
select throws_ok($$select public.insert_public_report(pg_temp.ip(2), 'message', '81111111-0000-4000-8000-000000000001', 'spam', null, 'a@b.ro')$$,
                 'P0001', 'bad_input', '15. mesajele private nu se pot raporta de pe pagina publică → bad_input');
select is((select count(*) filter (where r ? 'id')::int from generate_series(1, 9) g,
             lateral (select public.insert_public_report(pg_temp.ip(2), 'listing', '81444444-0000-4000-8000-000000000001', 'scam', 'x', 'r@example.com') r) x),
          9, '16. 9 sesizări reușite pe listing (10 încercări pe același IP, cu cea respinsă)');
select is((select public.insert_public_report(pg_temp.ip(2), 'listing', '81444444-0000-4000-8000-000000000001', 'scam', 'x', 'r@example.com')),
          '{"error": "rate_limited"}'::jsonb, '17. a 11-a încercare în oră pe același IP → {error: rate_limited}');

-- ── 18–20. FK anunț: SET NULL la ștergere; dovada rămâne; fără dedup la publice ───────────────────────
delete from app.announcements where id = '81111111-0000-4000-8000-000000000001';
select is((select (announcement_id is null)::text || '|' || status from public.reports where id = (select id from t_pub)),
          'true|pending', '18. ștergerea anunțului lasă raportul (announcement_id NULL)');
select is((select count(*)::int from public.reports where listing_id = '81444444-0000-4000-8000-000000000001' and source = 'public'), 9,
          '19. rapoartele publice pe listing (fără dedup: NULL-urile nu intră în unicitate)');
select is((select count(*)::int from pg_indexes where schemaname = 'public' and indexname = 'uq_reports_reporter_announcement'), 1,
          '20. indexul unic (reporter_id, announcement_id) există pentru rapoartele din app');

-- ── 21–23. Adminul: lista cu coloanele noi; conversația pe raport public nu dă eroare ──────────────────
select pg_temp.as_user('81000000-0000-4000-8000-0000000000d1', 'authenticated');
select is((select r->>'source' || '|' || (r->>'reporter_email') || '|' || (r->>'reporter_lang') || '|' || coalesce(r->>'reporter_name', '-') || '|' || (r ? 'announcement_text')::text
             from jsonb_array_elements(public.admin_list_reports('pending')) r where (r->>'id')::uuid = (select id from t_pub)),
          'public|reporter@example.com|de|-|true', '21. admin_list_reports: source, e-mail, limbă, fără nume de raportor, cheia announcement_text');
select lives_ok($$select public.admin_report_conversation((select id from t_pub))$$, '22. admin_report_conversation pe raport public nu dă eroare');
select is((select count(*)::int from jsonb_array_elements(public.admin_list_reports('all')) r where r->>'source' = 'public'), 11,
          '23. toate rapoartele publice (10 noi + cel vechi) apar adminului');
select pg_temp.as_postgres();

-- ── 24–26. Raportul din app: source default, snapshot-ul ia raportatul din țintă, anunț raportat o singură dată ──
insert into app.announcements (id, driver_id, description, location, status, latitude, longitude) values
  ('81111111-0000-4000-8000-000000000002', '81000000-0000-4000-8000-0000000000a1', 'PR anunt al lui A', 'B', 'open', 44.43, 26.10);
select pg_temp.as_user('81000000-0000-4000-8000-0000000000c1', 'authenticated');
-- clientul trimite reported_user_id GREȘIT (adminul D2); trigger-ul îl înlocuiește cu șoferul anunțului
select lives_ok($$insert into public.reports (reporter_id, reported_user_id, reason, details, announcement_id)
                  values ('81000000-0000-4000-8000-0000000000c1', '81000000-0000-4000-8000-0000000000d2', 'spam', 'din app', '81111111-0000-4000-8000-000000000002')$$,
                '24. INSERT-ul clientului (1.0.x / 1.1) merge ca înainte');
select is((select source || '|' || (reporter_email is null)::text || '|' || reported_user_id::text
             from public.reports where reporter_id = '81000000-0000-4000-8000-0000000000c1' and details = 'din app'),
          'app|true|81000000-0000-4000-8000-0000000000a1', '25. source = app implicit, fără e-mail, raportatul = autorul anunțului (nu ce a trimis clientul)');
select throws_ok($$insert into public.reports (reporter_id, reported_user_id, reason, announcement_id)
                   values ('81000000-0000-4000-8000-0000000000c1', '81000000-0000-4000-8000-0000000000a1', 'scam', '81111111-0000-4000-8000-000000000002')$$,
                 '23505', null, '26. același anunț raportat a doua oară de același utilizator → 23505 (deja raportat)');
select pg_temp.as_postgres();

-- ── 27–28. Retenția șterge raportul public închis > 12 luni (cu e-mail); cron-ul pe IP există ────────
select ok((select (r->>'reports_deleted')::int >= 1 from app.apply_retention(false) r)
          and not exists (select 1 from public.reports where reporter_email = 'old-public@example.com'),
          '27. retenția șterge raportul public închis > 12 luni, cu e-mailul reclamantului');
select is((select count(*)::int from cron.job where jobname = 'cleanup-report-ip-events-hourly' and command like '%app.report_ip_events%' and active), 1,
          '28. cron-ul orar de curățare a evidenței pe IP există');

select * from finish();
rollback;
