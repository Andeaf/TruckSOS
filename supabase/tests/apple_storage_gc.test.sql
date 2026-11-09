-- pgTAP: faza 6.1 + 6.2 (migrările 20261109000300_apple_tokens și 20261109000400_storage_gc): token-ul Apple criptat
-- cu cheia din Vault, RPC-urile doar pentru service_role, evidența ștergerii contului; coada de ștergere Storage și
-- scanarea orfanilor. Id-urile 77… .
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

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
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now() - interval '40 days',
       '{"provider":"apple","providers":["apple"]}'::jsonb, '{}'::jsonb, now() - interval '40 days', now() - interval '40 days',
       '', '', '', '', '', '', '', '', false, false
  from (values
    ('77000000-0000-4000-8000-0000000000a1'::uuid, 'g-apple-a@example.com'),
    ('77000000-0000-4000-8000-0000000000b1', 'g-noprofile-b@example.com')
  ) as u(id, email);
insert into app.profiles (id, full_name, role, phone, lang)
values ('77000000-0000-4000-8000-0000000000a1', 'G Apple A', 'driver', '+40700000001', 'ro');

-- ── 1–3. Fără cheie în Vault: fail closed ───────────────────────────────────────────────────────────
delete from vault.secrets where name = 'apple_token_key';
select throws_ok($$ select public.store_apple_token('77000000-0000-4000-8000-0000000000a1', 'rt-secret-1') $$,
                 'P0001', 'apple_token_key_missing', '1. fără cheie în Vault store_apple_token refuză (nimic stocat necriptat)');
select is((select count(*)::int from app.apple_tokens), 0, '2. … și tabelul rămâne gol');
select is(public.read_apple_token('77000000-0000-4000-8000-0000000000a1'), null, '3. fără cheie read întoarce NULL');

-- ── 4–9. Cu cheie: criptare, upsert, citire ─────────────────────────────────────────────────────────
do $$ begin perform vault.create_secret('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'apple_token_key'); end $$;
select lives_ok($$ select public.store_apple_token('77000000-0000-4000-8000-0000000000a1', 'rt-secret-1') $$, '4. store cu cheie');
select is((select count(*)::int from app.apple_tokens where user_id = '77000000-0000-4000-8000-0000000000a1'), 1, '5. un rând');
select isnt((select encode(refresh_token_enc, 'escape') from app.apple_tokens where user_id = '77000000-0000-4000-8000-0000000000a1'), 'rt-secret-1',
            '6. token-ul NU e stocat în clar');
select is(public.read_apple_token('77000000-0000-4000-8000-0000000000a1'), 'rt-secret-1', '7. read decriptează corect');
select public.store_apple_token('77000000-0000-4000-8000-0000000000a1', 'rt-secret-2');
select is(public.read_apple_token('77000000-0000-4000-8000-0000000000a1'), 'rt-secret-2', '8. a doua conectare înlocuiește token-ul (upsert)');
select is((select count(*)::int from app.apple_tokens where user_id = '77000000-0000-4000-8000-0000000000a1'), 1, '8b. … tot un rând');
select throws_ok($$ select public.store_apple_token('77999999-0000-4000-8000-000000000000', 'x') $$, 'P0001', 'user_not_found',
                 '9. cont inexistent → user_not_found');

-- ── 10–11. Evidența ștergerii ───────────────────────────────────────────────────────────────────────
select public.record_account_deletion('77000000-0000-4000-8000-0000000000a1', 'true');
select is((select details->>'apple_revoked' from public.admin_audit_log where admin_id = '77000000-0000-4000-8000-0000000000a1' and action = 'self_delete_account'),
          'true', '10. record_account_deletion scrie rândul de audit cu rezultatul revocării');
select public.record_account_deletion('77000000-0000-4000-8000-0000000000b1', 'no_token');
select is((select count(*)::int from public.admin_audit_log where admin_id = '77000000-0000-4000-8000-0000000000b1'), 0,
          '11. cont fără profil → nimic de scris (FK-ul admin_id → profiles)');

-- ── 12–13. Drepturile: doar service_role ────────────────────────────────────────────────────────────
select is((select bool_or(has_function_privilege(r, p.oid, 'EXECUTE'))
             from pg_proc p, unnest(array['anon', 'authenticated']) r
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('store_apple_token', 'read_apple_token', 'record_account_deletion', 'storage_gc_claim', 'storage_gc_finish')),
          false, '12. anon/authenticated nu pot executa RPC-urile Apple / storage-gc');
select is((select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
             from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('store_apple_token', 'read_apple_token', 'record_account_deletion', 'storage_gc_claim', 'storage_gc_finish')),
          true, '13. service_role le poate executa pe toate 5');

-- ── 14–20. Coada Storage și orfanii ─────────────────────────────────────────────────────────────────
insert into app.announcements (id, driver_id, description, location, status, created_at)
values ('77111111-0000-4000-8000-000000000001', '77000000-0000-4000-8000-0000000000a1', 'G anunt', 'B', 'open', now() - interval '2 days');
insert into public.announcement_photos (announcement_id, storage_path)
values ('77111111-0000-4000-8000-000000000001', 'announcements/77111111-0000-4000-8000-000000000001/kept.jpg');
-- obiecte Storage: unul referit (păstrat), unul orfan vechi, unul orfan nou (< 24 h, upload în curs), unul Market orfan, unul din chat (nescanat)
insert into storage.objects (bucket_id, name, created_at) values
  ('photos', 'announcements/77111111-0000-4000-8000-000000000001/kept.jpg', now() - interval '2 days'),
  ('photos', 'announcements/77111111-0000-4000-8000-000000000001/orphan-old.jpg', now() - interval '2 days'),
  ('photos', 'announcements/77111111-0000-4000-8000-000000000001/orphan-new.jpg', now() - interval '1 hour'),
  ('photos', 'market/77222222-0000-4000-8000-000000000001/orphan-market.jpg', now() - interval '3 days'),
  ('photos', 'chat/77333333-0000-4000-8000-000000000001/not-scanned.jpg', now() - interval '30 days');

-- coada e globală (în CI pot exista obiecte/rânduri de la poarta 4.1) → aserțiunile se uită doar la căile fixture-ului (77…)
select is((select count(*)::int from public.storage_gc_claim(1000, false) where name like '%/77%'), 0, '14. fără scanare coada nu are căile noastre');
select is((select string_agg(name, ' | ' order by name) from public.storage_gc_claim(1000, true) where name like '%/77%'),
          'announcements/77111111-0000-4000-8000-000000000001/orphan-old.jpg | market/77222222-0000-4000-8000-000000000001/orphan-market.jpg',
          '15. scanarea pune în coadă DOAR orfanii vechi din announcements/ și market/ (nu cel referit, nu cel nou, nu chat/)');
select is((select reason from app.storage_gc_queue where name like 'market/77%'), 'orphan_market_photo', '16. motivul e notat');
select is((select count(*)::int from public.storage_gc_claim(1000, true) where name like '%/77%'), 2, '17. a doua scanare nu dublează (UNIQUE bucket+name)');
select is(app.storage_gc_enqueue(array['chat/77333333-0000-4000-8000-000000000001/not-scanned.jpg', null, ''], 'expired_conversation'), 1,
          '18. enqueue explicit (retenție) adaugă căile valide, ignoră NULL și gol');
select is(public.storage_gc_finish((select array_agg(id) from app.storage_gc_queue where name like 'announcements/77%')), 1,
          '19. finish scoate din coadă id-urile șterse din Storage');
select is((select count(*)::int from app.storage_gc_queue where name like '%/77%'), 2, '20. … restul (market + chat) rămân pentru rularea următoare');

select * from finish();
rollback;
