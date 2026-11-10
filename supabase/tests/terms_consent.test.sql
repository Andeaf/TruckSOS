-- pgTAP: faza 8.2 (migrarea 20261110000100_terms_consent): consimțământul la termeni + 18+ cu dovadă pe server,
-- starea în app.profile_terms (tabel separat — app.profiles rămâne neatins, altfel scrierile prin view-ul public.profiles
-- ar pica), jurnalul app.consent_log (fără FK, 3 ani), RPC-urile accept_terms / my_terms_status, drepturile.
-- Id-urile 80… .
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false
  from (values
    ('80000000-0000-4000-8000-0000000000a1'::uuid, 't-driver-a@example.com'),
    ('80000000-0000-4000-8000-0000000000b1', 't-driver-b@example.com'),
    ('80000000-0000-4000-8000-0000000000e1', 't-deleted@example.com')
  ) as u(id, email);
insert into app.profiles (id, full_name, role, phone, lang) values
  ('80000000-0000-4000-8000-0000000000a1', 'T Driver A', 'driver', '+40700000801', 'ro'),
  ('80000000-0000-4000-8000-0000000000b1', 'T Driver B', 'driver', '+40700000802', 'ro');
insert into app.profiles (id, full_name, role, lang, deleted_at) values
  ('80000000-0000-4000-8000-0000000000e1', '', 'driver', 'ro', now());
-- jurnal vechi (de șters la retenție) + jurnal al unui cont care nu mai există deloc (D8.2: rămâne)
insert into app.consent_log (user_id, version, accepted_at, age_confirmed, source) values
  ('80000000-0000-4000-8000-0000000000a1', '1.0.0', now() - interval '37 months', true, 'signup'),
  ('80000000-0000-4000-8000-0000000000f9', '1.0.0', now() - interval '2 months', true, 'signup');

-- ── 1–3. Catalog ───────────────────────────────────────────────────────────────────────────────────────
select ok(
  (select relrowsecurity from pg_class where oid = 'app.profile_terms'::regclass)
  and not has_table_privilege('anon', 'app.profile_terms', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'app.profile_terms', 'SELECT, INSERT, UPDATE, DELETE'),
  '1. app.profile_terms: RLS activ, fără drepturi pentru anon/authenticated');
-- Garda lecției din 10 nov (poarta 4.1): triggerele INSTEAD OF ale view-urilor întorc rândul tabelului (`RETURNING * INTO NEW`),
-- deci tabelul și view-ul trebuie să aibă același număr de coloane; o coloană nouă pe tabel rupe TOATE scrierile prin view.
select is(
  (select count(*)::int from pg_attribute where attrelid = 'app.profiles'::regclass and attnum > 0 and not attisdropped),
  (select count(*)::int from pg_attribute where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped),
  '1b. app.profiles are exact coloanele view-ului public.profiles (nicio coloană adăugată pe tabel)');
select is(
  (select count(*)::int from pg_attribute where attrelid = 'app.announcements'::regclass and attnum > 0 and not attisdropped),
  (select count(*)::int from pg_attribute where attrelid = 'public.announcements'::regclass and attnum > 0 and not attisdropped),
  '1c. app.announcements are exact coloanele view-ului public.announcements');
select is(
  (select count(*)::int from pg_constraint where conrelid = 'app.consent_log'::regclass and contype = 'f'),
  0, '2. app.consent_log nu are FK (dovada supraviețuiește ștergerii contului, D8.2)');
select ok(
  (select relrowsecurity from pg_class where oid = 'app.consent_log'::regclass)
  and not has_table_privilege('anon', 'app.consent_log', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'app.consent_log', 'SELECT, INSERT, UPDATE, DELETE'),
  '3. consent_log: RLS activ, fără drepturi pentru anon/authenticated');

-- ── 4–6. Starea înainte de acceptare ─────────────────────────────────────────────────────────────────
select pg_temp.as_user('80000000-0000-4000-8000-0000000000a1', 'authenticated');
select is((select public.my_terms_status()), '{"terms_version": null, "terms_accepted_at": null, "age_confirmed_at": null}'::jsonb,
          '4. my_terms_status: NULL-uri înainte de acceptare');
select throws_ok($$select public.accept_terms('v1.1', 'update')$$, 'P0001', 'bad_version', '5. versiune cu litere → bad_version');
select throws_ok($$select public.accept_terms('1.1.0', 'web')$$, 'P0001', 'bad_source', '6. sursă necunoscută → bad_source');

-- ── 7–11. Acceptarea ─────────────────────────────────────────────────────────────────────────────────
select is((select (public.accept_terms('1.1.0', 'signup'))->>'terms_version'), '1.1.0', '7. accept_terms întoarce versiunea');
select is((select (public.my_terms_status())->>'terms_version'), '1.1.0', '8. my_terms_status vede versiunea acceptată');
-- Regresia prinsă de poarta 4.1: după migrare, scrierea prin view-ul public.profiles (drumul clienților 1.0.x) merge.
select lives_ok($$update public.profiles set full_name = 'T Driver A2' where id = '80000000-0000-4000-8000-0000000000a1'$$,
                '9. UPDATE prin view-ul public.profiles merge după migrare (clienții 1.0.x)');
select pg_temp.as_postgres();
select is((select full_name from app.profiles where id = '80000000-0000-4000-8000-0000000000a1'), 'T Driver A2',
          '9b. … și a ajuns în app.profiles');
select ok((select terms_accepted_at is not null and age_confirmed_at is not null and terms_version = '1.1.0'
             from app.profile_terms where user_id = '80000000-0000-4000-8000-0000000000a1'),
          '9c. starea e scrisă în app.profile_terms');
select is((select count(*)::int from app.consent_log where user_id = '80000000-0000-4000-8000-0000000000a1' and version = '1.1.0' and source = 'signup' and age_confirmed),
          1, '10. un rând în jurnal (signup, 18+)');
select pg_temp.as_user('80000000-0000-4000-8000-0000000000a1', 'authenticated');
select lives_ok($$select public.accept_terms('1.1.0', 'update')$$, '11. a doua acceptare (versiune nouă / reconfirmare) merge');
select pg_temp.as_postgres();
select is((select count(*)::int from app.consent_log where user_id = '80000000-0000-4000-8000-0000000000a1' and version = '1.1.0'),
          2, '12. fiecare acceptare = un rând (istoric, nu doar ultima)');
select is((select count(*)::int from app.profile_terms where user_id = '80000000-0000-4000-8000-0000000000a1'), 1,
          '12b. … iar starea rămâne un singur rând per cont (upsert)');

-- ── 13–15. Izolare: alt utilizator, anon, cont șters ─────────────────────────────────────────────────
select pg_temp.as_user('80000000-0000-4000-8000-0000000000b1', 'authenticated');
select is((select (public.my_terms_status())->>'terms_version'), null, '13. B nu vede acceptarea lui A (starea e proprie)');
select pg_temp.as_postgres();
select ok(not has_function_privilege('anon', 'public.accept_terms(text, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.my_terms_status()', 'EXECUTE'),
          '14. anon fără EXECUTE pe accept_terms / my_terms_status');
select pg_temp.as_user('80000000-0000-4000-8000-0000000000e1', 'authenticated');
select throws_ok($$select public.accept_terms('1.1.0', 'update')$$, 'P0001', 'profile_not_found', '15. cont șters (piatră funerară) → profile_not_found');
select pg_temp.as_postgres();

-- ── 16–18. Rata: 20/oră ──────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('80000000-0000-4000-8000-0000000000b1', 'authenticated');
select lives_ok($$select public.accept_terms('1.1.0', 'update') from generate_series(1, 20)$$, '16. 20 de acceptări într-o oră trec');
select throws_ok($$select public.accept_terms('1.1.0', 'update')$$, 'P0001', 'rate_limited', '17. a 21-a → rate_limited');
select pg_temp.as_postgres();
select is((select count(*)::int from app.rate_events where user_id = '80000000-0000-4000-8000-0000000000b1' and kind = 'accept_terms'),
          20, '18. evidența ratei în app.rate_events');

-- ── 19–21. Retenția: 3 ani; jurnalul contului dispărut rămâne ────────────────────────────────────────
select is((select r->>'consent_log_deleted' from app.apply_retention(true) r), '1', '19. dry-run: un rând > 3 ani de șters');
select is((select r->>'consent_log_deleted' from app.apply_retention(false) r), '1', '20. rularea reală șterge rândul vechi');
select is((select count(*)::int from app.consent_log where user_id = '80000000-0000-4000-8000-0000000000f9'), 1,
          '21. rândul contului care nu mai există rămâne (sub 3 ani)');

-- ── 22. Fără accept_terms reușit nu există rând de stare (starea conturilor 1.0.x) ──────────────────────
select is((select count(*)::int from app.profile_terms where user_id = '80000000-0000-4000-8000-0000000000e1'), 0,
          '22. profil fără accept_terms reușit → niciun rând în app.profile_terms (ca la clienții 1.0.x)');
select * from finish();
rollback;
