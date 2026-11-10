-- pgTAP: faza 9.1 (migrarea 20261111000100_client_errors): erorile clientului fără terț — curățarea la server (e-mail, UUID,
-- telefon, tokenuri), trunchierea, hash-ul scurt al utilizatorului (fără id de cont), limita 10 / oră / cont și plafonul
-- global de 2 000 / oră, drepturile (anon nu poate trimite, nimeni nu citește tabelul direct), RPC-ul de admin și retenția
-- de 30 de zile (cron).
-- Id-urile 91… .
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

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

-- ── Fixture: șofer A, șofer B, admin D ───────────────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change,
                        phone_change_token, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false
  from (values
    ('91000000-0000-4000-8000-0000000000a1'::uuid, 'ce-driver-a@example.com'),
    ('91000000-0000-4000-8000-0000000000b1', 'ce-driver-b@example.com'),
    ('91000000-0000-4000-8000-0000000000d1', 'ce-admin-d@example.com')
  ) as u(id, email);
insert into app.profiles (id, full_name, role, phone, lang) values
  ('91000000-0000-4000-8000-0000000000a1', 'CE Driver A', 'driver', '+40700000911', 'ro'),
  ('91000000-0000-4000-8000-0000000000b1', 'CE Driver B', 'driver', '+40700000912', 'ro'),
  ('91000000-0000-4000-8000-0000000000d1', 'CE Admin D',  'admin',  '+40700000913', 'ro');

-- Rândurile fixture-ului ca jsonb, văzute ca owner chiar și cât rolul curent e `authenticated` (tabelul nu are drepturi
-- pentru el; jsonb, nu tipul rândului, ca apelantul să nu atingă nimic din schema app).
create function pg_temp.ce_rows(p_type text) returns setof jsonb language sql security definer as $$
  select to_jsonb(e) from app.client_errors e where e.error_type = p_type order by e.id;
$$;
create function pg_temp.ce_hash(p_uid uuid) returns text language sql immutable as $$
  select left(encode(sha256(convert_to(p_uid::text, 'UTF8')), 'hex'), 12);
$$;
grant execute on function pg_temp.ce_rows(text), pg_temp.ce_hash(uuid) to authenticated, anon;

-- ── 1–4. Catalog și drepturi ─────────────────────────────────────────────────────────────────────────
select ok(
  (select relrowsecurity from pg_class where oid = 'app.client_errors'::regclass)
  and not has_table_privilege('anon', 'app.client_errors', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'app.client_errors', 'SELECT, INSERT, UPDATE, DELETE'),
  '1. client_errors: RLS activ, fără drepturi pentru anon/authenticated');
select ok(
  not has_function_privilege('anon', 'public.report_client_error(text, text, text, text, text, text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.report_client_error(text, text, text, text, text, text, text)', 'EXECUTE'),
  '2. report_client_error: authenticated da, anon nu (oaspeții nu trimit; rate_limit_ok nu limitează fără uid)');
select ok(
  not has_function_privilege('anon', 'public.admin_client_errors(integer, integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.admin_client_errors(integer, integer)', 'EXECUTE'),
  '3. admin_client_errors: executabil de authenticated (verificarea is_admin e în funcție), nu de anon');
select ok(
  not has_function_privilege('anon', 'app.scrub_client_text(text, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app.scrub_client_text(text, integer)', 'EXECUTE'),
  '4. scrub_client_text e internă');

-- ── 5–9. Curățarea (funcția) ─────────────────────────────────────────────────────────────────────────
select is(app.scrub_client_text('a ion.pop@example.com b 0f8fad5b-d9cb-469f-a165-70867728950e c +40 712 345 678 d', 200),
          'a [email] b [id] c [phone] d', '5. e-mail, UUID și telefon dispar');
select is(app.scrub_client_text('Bearer abc.def-ghi x eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghij y sb_secret_AbC123_x z ExponentPushToken[abc-123] w ExpoPushToken[q] v', 200),
          '[token] x [token] y [token] z [token] w [token] v', '6. Bearer, JWT, cheile sb_ și tokenurile push (ambele forme) dispar');
select is(app.scrub_client_text('at f (index.android.bundle:1:1234567) code 404', 200),
          'at f (index.android.bundle:1:1234567) code 404', '7. pozițiile din stivă și codurile scurte rămân (sub 8 cifre)');
select is(app.scrub_client_text('tel 0171/1234567 sau (0721) 234-567 gata', 200),
          'tel [phone] sau ([phone] gata', '8. telefoanele cu / și cu doi separatori între grupuri sunt prinse');
select is(length(app.scrub_client_text(repeat('x', 900), 500)), 500, '9. trunchierea la p_max');

-- ── 10–15. Trimiterea ca utilizator ──────────────────────────────────────────────────────────────────
select pg_temp.as_user('91000000-0000-4000-8000-0000000000a1', 'authenticated');
select is(
  public.report_client_error('1.1.0', 'iOS', '18.1', '/(driver)/conversations/91333333-0000-4000-8000-000000000001', 'CeTypeError',
    'Cannot read x of john.doe@example.com tel 0712 345 678 id 91000000-0000-4000-8000-0000000000a1',
    'at f (index.bundle:1:100) Bearer abc.def-ghi eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghij'),
  '{"ok": true}'::jsonb, '10. report_client_error întoarce ok');
select is((select r->>'message' from pg_temp.ce_rows('CeTypeError') r), 'Cannot read x of [email] tel [phone] id [id]',
          '11. mesajul e curățat la server');
select is((select r->>'stack' from pg_temp.ce_rows('CeTypeError') r), 'at f (index.bundle:1:100) [token] [token]', '12. stiva e curățată');
select is((select (r->>'screen') || '|' || (r->>'platform') || '|' || (r->>'app_build') || '|' || (r->>'os_version') from pg_temp.ce_rows('CeTypeError') r),
          '/(driver)/conversations/[id]|ios|1.1.0|18.1', '13. ecranul fără id, platforma normalizată, versiunile păstrate');
select ok((select (r->>'user_hash') ~ '^[0-9a-f]{12}$' and (r->>'user_hash') = pg_temp.ce_hash('91000000-0000-4000-8000-0000000000a1')
             from pg_temp.ce_rows('CeTypeError') r),
          '14. user_hash = 12 hex din sha256(uid)');
select ok((select (r::text) not like '%91000000-0000-4000-8000-0000000000a1%' from pg_temp.ce_rows('CeTypeError') r),
          '15. id-ul contului nu apare nicăieri în rând');

-- ── 16–18. Trunchiere și valori implicite ────────────────────────────────────────────────────────────
select public.report_client_error(null, 'windows', null, repeat('s', 300), '', repeat('m', 2000), repeat('k', 6000));
select is((select length(r->>'message')::text || '|' || length(r->>'stack')::text || '|' || length(r->>'screen')::text from pg_temp.ce_rows('Error') r),
          '500|4000|120', '16. mesaj 500, stivă 4000, ecran 120');
select is((select r->>'platform' from pg_temp.ce_rows('Error') r), 'other', '17. platformă necunoscută → other; tip gol → Error');
select ok((select (r->>'app_build') is null and (r->>'os_version') is null from pg_temp.ce_rows('Error') r), '18. câmpurile goale rămân NULL');

-- ── 19–21. Limita 10 / oră / utilizator; alt utilizator are limita lui ───────────────────────────────
select public.report_client_error('1.1.0', 'android', '14', '/x', 'CeFlood', 'm', 's') from generate_series(1, 8);
select is((select count(*)::int from pg_temp.ce_rows('CeFlood')), 8, '19. primele 10 trimiteri trec (2 + 8)');
select throws_ok($$ select public.report_client_error('1.1.0', 'android', '14', '/x', 'CeFlood', 'm', 's') $$,
                 'P0001', 'rate_limited', '20. a 11-a într-o oră → rate_limited');
select pg_temp.as_postgres();
select pg_temp.as_user('91000000-0000-4000-8000-0000000000b1', 'authenticated');
select public.report_client_error('1.1.0', 'web', null, '/y', 'CeOther', 'm', 's');
select ok((select (r->>'user_hash') = pg_temp.ce_hash('91000000-0000-4000-8000-0000000000b1')
              and (r->>'user_hash') <> pg_temp.ce_hash('91000000-0000-4000-8000-0000000000a1') from pg_temp.ce_rows('CeOther') r),
          '21. alt utilizator: trimite (limita e per utilizator) și are alt hash');

-- ── 22. Utilizatorul nu poate citi tabelul ───────────────────────────────────────────────────────────
select throws_ok($$ select count(*) from app.client_errors $$, '42501', null, '22. authenticated nu poate citi app.client_errors');

-- ── 23–25. RPC-ul de admin ───────────────────────────────────────────────────────────────────────────
select throws_ok($$ select public.admin_client_errors() $$, 'P0001', 'not_admin', '23. admin_client_errors: ne-adminul e refuzat');
select pg_temp.as_postgres();
create temp table ce_admin (j jsonb) on commit drop;
grant all on ce_admin to authenticated;
select pg_temp.as_user('91000000-0000-4000-8000-0000000000d1', 'authenticated');
insert into ce_admin select public.admin_client_errors(24, 3);
select ok((select (j->>'total')::int >= 11 and (j->>'users')::int >= 2 and jsonb_array_length(j->'items') = 3 from ce_admin),
          '24. admin: totalul (≥ fixture), utilizatorii distincți, lista limitată la p_limit');
select is((select (t->>'count') || '|' || (t->>'users') from ce_admin, jsonb_array_elements(j->'by_type') t where t->>'error_type' = 'CeFlood'),
          '8|1', '25. agregatul pe tip: numărul și utilizatorii afectați');
select pg_temp.as_postgres();

-- ── 26. anon ─────────────────────────────────────────────────────────────────────────────────────────
set local role anon;
select throws_ok($$ select public.report_client_error('1.1.0', 'web', null, '/z', 'CeAnon', 'm', 's') $$, '42501', null,
                 '26. anon nu poate trimite');
reset role;

-- ── 27–28. Retenția: 30 de zile, prin cron ───────────────────────────────────────────────────────────
select is((select schedule || '|' || (command like '%app.client_errors%' and command like '%30 days%')::text
             from cron.job where jobname = 'cleanup-client-errors-daily'),
          '44 3 * * *|true', '27. cron-ul de retenție există (zilnic, 30 de zile)');
insert into app.client_errors (user_hash, platform, error_type, message, created_at)
values ('000000000000', 'ios', 'CeOld', 'vechi', now() - interval '31 days'),
       ('000000000000', 'ios', 'CeOld', 'recent', now() - interval '29 days');
do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'cleanup-client-errors-daily';
  execute v_cmd;
end $$;
select is((select string_agg(message, ',' order by message) from app.client_errors where error_type = 'CeOld'), 'recent',
          '28. comanda cron-ului șterge doar rândurile mai vechi de 30 de zile');

-- ── 29–30. Plafonul global: 2 000 de rapoarte / oră, înaintea limitei per cont ───────────────────────
insert into app.client_errors (user_hash, platform, error_type, created_at)
select '111111111111', 'ios', 'CeGlobal', now() from generate_series(1, 2000);
select pg_temp.as_user('91000000-0000-4000-8000-0000000000b1', 'authenticated');
select throws_ok($$ select public.report_client_error('1.1.0', 'web', null, '/y', 'CeOther', 'm', 's') $$,
                 'P0001', 'rate_limited', '29. peste 2 000 de rapoarte într-o oră (toate conturile) → rate_limited');
select pg_temp.as_postgres();
select is((select count(*)::int from app.rate_events where user_id = '91000000-0000-4000-8000-0000000000b1' and kind = 'client_error'), 1,
          '30. refuzul global nu consumă din limita contului (un singur eveniment: trimiterea reușită de la 21)');

select * from finish();
rollback;
