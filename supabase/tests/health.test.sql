-- pgTAP: faza 9.4 (migrarea 20261111000300_health): public.admin_health() — doar admin; secțiunile push, storage_gc,
-- retention_last, cron_failed_24h; secțiunile opționale (client_errors, public_reports_pending) apar doar dacă obiectele lor
-- există (9.1, respectiv faza 8.3) — testul le verifică în funcție de ce e aplicat pe baza curentă.
-- Id-urile 93… .
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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

-- ── Fixture: șofer A, admin D; un rând vechi în coada Storage; o rulare cron eșuată (dacă se poate scrie istoricul) ──
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change,
                        phone_change_token, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false
  from (values
    ('93000000-0000-4000-8000-0000000000a1'::uuid, 'ah-driver-a@example.com'),
    ('93000000-0000-4000-8000-0000000000d1', 'ah-admin-d@example.com')
  ) as u(id, email);
insert into app.profiles (id, full_name, role, phone, lang) values
  ('93000000-0000-4000-8000-0000000000a1', 'AH Driver A', 'driver', '+40700000931', 'ro'),
  ('93000000-0000-4000-8000-0000000000d1', 'AH Admin D',  'admin',  '+40700000932', 'ro');
insert into app.storage_gc_queue (bucket, name, reason, created_at)
values ('photos', 'chat/93333333-0000-4000-8000-000000000001/stale.jpg', 'sql_delete', now() - interval '3 days');

-- Istoricul pg_cron: o rulare eșuată a retenției, acum. Dacă rolul testului nu poate scrie în cron.job_run_details,
-- verificările 9–10 trec în gol (steagul rămâne false).
create temp table ah_flags (cron_written boolean) on commit drop;
do $$
begin
  insert into cron.job_run_details (jobid, command, database, username, status, return_message, start_time, end_time)
  select j.jobid, j.command, 'postgres', 'postgres', 'failed', 'ERROR: AH test failure', now(), now()
    from cron.job j where j.jobname = 'apply-retention-daily';
  insert into ah_flags values (found);
exception when others then
  insert into ah_flags values (false);
end $$;
create temp table ah_out (j jsonb) on commit drop;
grant all on ah_out to authenticated;

-- ── 1–3. Drepturi ────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.admin_health()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.admin_health()', 'EXECUTE'),
          '1. admin_health: executabil de authenticated (is_admin în funcție), nu de anon');
select pg_temp.as_user('93000000-0000-4000-8000-0000000000a1', 'authenticated');
select throws_ok($$ select public.admin_health() $$, 'P0001', 'not_admin', '2. ne-adminul e refuzat');
select pg_temp.as_postgres();
set local role anon;
select throws_ok($$ select public.admin_health() $$, '42501', null, '3. anon nu poate apela');
reset role;

-- ── 4–13. Răspunsul pentru admin ─────────────────────────────────────────────────────────────────────
select pg_temp.as_user('93000000-0000-4000-8000-0000000000d1', 'authenticated');
insert into ah_out select public.admin_health();
select pg_temp.as_postgres();

select ok((select j ? 'generated_at' and j ? 'push' and j ? 'storage_gc' and j ? 'retention_last' and j ? 'cron_failed_24h' from ah_out),
          '4. cheile de bază există');
select ok((select j ? 'push_error' or (j->'push' ? 'queued' and j->'push' ? 'expired_48h' and j->'push' ? 'http_401_6h') from ah_out),
          '5. push = contoarele din push_stats() (sau push_error dacă statisticile nu sunt lizibile)');
select ok((select (j->'storage_gc'->>'queued')::int >= 1 and (j->'storage_gc'->>'stale_48h')::int >= 1
                  and (j->'storage_gc'->>'oldest_at')::timestamptz <= now() - interval '2 days' from ah_out),
          '6. storage_gc: rândul vechi de 3 zile e numărat (queued, stale_48h, oldest_at)');
select is((select jsonb_typeof(j->'cron_failed_24h') from ah_out), 'array', '7. cron_failed_24h e o listă');
select ok((select not exists (select 1 from jsonb_object_keys(j) k where k like '%secret%' or k like '%key%') from ah_out),
          '8. nicio cheie de tip secret în răspuns');
select ok((select not (select cron_written from ah_flags)
                  or (j ? 'retention_last_error')
                  or (j->'retention_last'->>'status') = 'failed' from ah_out),
          '9. retention_last arată ultima rulare (eșuată) a cron-ului apply-retention-daily');
select ok((select not (select cron_written from ah_flags)
                  or (j ? 'cron_failed_24h_error')
                  or exists (select 1 from jsonb_array_elements(j->'cron_failed_24h') f
                              where f->>'jobname' = 'apply-retention-daily' and (f->>'failures')::int >= 1
                                and f->>'last_message' like '%AH test failure%') from ah_out),
          '10. cron_failed_24h conține jobul eșuat, cu numărul și ultimul mesaj');
select is((select j ? 'client_errors' from ah_out), to_regclass('app.client_errors') is not null,
          '11. client_errors apare exact când există tabelul (9.1)');
select is((select j ? 'public_reports_pending' from ah_out),
          exists (select 1 from pg_attribute where attrelid = 'public.reports'::regclass and attname = 'source' and not attisdropped),
          '12. public_reports_pending apare exact când există reports.source (faza 8.3)');
select ok((select not (j ? 'client_errors') or ((j->'client_errors'->>'h24')::int >= 0 and (j->'client_errors'->>'d7')::int >= (j->'client_errors'->>'h24')::int) from ah_out),
          '13. client_errors: h24 ≤ d7');

select * from finish();
rollback;
