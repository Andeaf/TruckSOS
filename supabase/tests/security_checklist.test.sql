-- pgTAP: checklist-ul de securitate (portat din supabase/checks/_TEST_security_checklist.sql,
-- faza 0.3 din PLAN_1.1_FIX, 26 oct 2026). Rulează în CI pe `supabase start` cu `supabase test db`
-- și local la fel. Fiecare verificare e o aserțiune; orice eșec = job roșu.
--
-- Regula din audit (26 sept 2026): orice RPC nou cere GRANT EXECUTE explicit pentru authenticated
-- și intrare în allowlist-ul de mai jos; orice coloană nouă dată lui anon cere intrare în
-- anon_table_allow. Listele se schimbă DOAR în aceeași migrare care schimbă drepturile.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ── Liste de referință (temporare, dispar la rollback) ────────────────────────────────────
create temp table allowlist(fn text) on commit drop;
insert into allowlist values
  ('accept_application'), ('apply_to_announcement'), ('block_user'), ('claim_push_token'),
  ('delete_message'), ('dismiss_application'), ('edit_message'), ('get_driver_phone'),
  ('get_mechanic_phone'), ('purge_user_data'), ('reject_application'), ('repost_announcement'),
  ('resolve_open_announcement'), ('resubmit_application'), ('search_market_listings'),
  ('search_mechanics'), ('search_users'), ('set_announcements_hidden'),
  ('start_direct_conversation'), ('start_market_conversation'), ('withdraw_application'),
  ('record_announcement_view'), ('get_own_profile'),
  ('admin_ban_user'), ('admin_dashboard_stats'), ('admin_delete_announcement'),
  ('admin_delete_listing'), ('admin_delete_message'), ('admin_delete_review'),
  ('admin_list_channel_messages'), ('admin_list_recent_announcements'),
  ('admin_list_recent_listings'), ('admin_list_recent_reviews'), ('admin_list_reports'),
  ('admin_pending_reports_count'), ('admin_report_context'), ('admin_report_conversation'),
  ('admin_search_announcements'), ('admin_search_users'), ('admin_unban_user'),
  ('admin_update_profile'), ('admin_update_report_status'), ('admin_user_detail'),
  ('is_admin'), ('is_banned'), ('is_block_between'), ('is_conversation_blocked'),
  ('distance_km'), ('push_text'), ('user_lang');

create temp table anon_fn_allow(fn text) on commit drop;
insert into anon_fn_allow values ('guest_search_mechanics'), ('guest_search_market');

create temp table anon_table_allow(tbl text, col text) on commit drop;
insert into anon_table_allow values
  ('guest_profiles', '*'), ('guest_announcements', '*'),
  ('guest_market_listings', '*'), ('guest_market_listing_photos', '*'), ('guest_channels', '*'),
  ('guest_channel_messages', '*'), ('app_versions', '*'),
  ('profiles', 'id'), ('profiles', 'full_name'), ('profiles', 'role'), ('profiles', 'avatar_path'),
  ('profiles', 'specialization'), ('profiles', 'activity_zone'), ('profiles', 'company_name'),
  ('profiles', 'rating_avg'), ('profiles', 'rating_count'), ('profiles', 'created_at'),
  ('announcements', 'id'), ('announcements', 'driver_id'), ('announcements', 'description'),
  ('announcements', 'location'), ('announcements', 'status'), ('announcements', 'created_at'),
  ('announcements', 'truck_make'), ('announcements', 'truck_model'), ('announcements', 'truck_year'),
  ('announcements', 'lat_approx'), ('announcements', 'lng_approx'),
  ('market_listings', 'id'), ('market_listings', 'seller_id'), ('market_listings', 'title'),
  ('market_listings', 'description'), ('market_listings', 'price'), ('market_listings', 'currency'),
  ('market_listings', 'category'), ('market_listings', 'status'), ('market_listings', 'created_at'),
  ('market_listing_photos', 'id'), ('market_listing_photos', 'listing_id'),
  ('market_listing_photos', 'storage_path'), ('market_listing_photos', 'position'),
  ('channels', 'id'), ('channels', 'name'), ('channels', 'type'), ('channels', 'created_at'),
  ('channel_messages', 'id'), ('channel_messages', 'channel_id'), ('channel_messages', 'sender_id'),
  ('channel_messages', 'content'), ('channel_messages', 'created_at'), ('channel_messages', 'reply_to_id'),
  ('channel_messages', 'mentions'), ('channel_messages', 'has_image'), ('channel_messages', 'announcement_id'),
  ('channel_messages', 'listing_id'), ('channel_messages', 'recommended_mechanic_id');

create temp view fns as
  select p.proname as fn, p.oid, p.prosecdef,
         pg_get_function_result(p.oid) = 'trigger' as is_trigger,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x,
         exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as has_sp
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f';

-- 1. RLS pe toate tabelele din public
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  '', 'RLS activ pe toate tabelele din public');

-- 2. Nicio funcție în plus față de allowlist executabilă de authenticated
select is(
  (select coalesce(string_agg(fn, ', ' order by fn), '') from fns
    where auth_x and not is_trigger and fn not in (select fn from allowlist)),
  '', 'Funcții executabile de authenticated = doar allowlist');

-- 3. Tot ce e în allowlist există și e executabil (RPC nou fără GRANT = aplicație ruptă)
select is(
  (select coalesce(string_agg(a.fn, ', ' order by a.fn), '') from allowlist a
    left join fns f on f.fn = a.fn and f.auth_x where f.fn is null),
  '', 'Allowlist-ul e complet executabil de authenticated');

-- 4. Funcțiile interne cunoscute NU sunt executabile de anon/authenticated
select is(
  (select coalesce(string_agg(fn, ', ' order by fn), '') from fns
    where (anon_x or auth_x)
      and fn in ('_purge_user_data', 'notify_push', 'notify_mechanics_new_announcement',
                 'storage_api_delete', 'recompute_mechanic_rating', 'is_blocked_by', 'accept_announcement')),
  '', 'Funcțiile interne rămân închise');

-- 5. SECURITY DEFINER fără search_path fixat
select is(
  (select coalesce(string_agg(fn, ', ' order by fn), '') from fns where prosecdef and not has_sp),
  '', 'Funcțiile SECURITY DEFINER au search_path fixat');

-- 6. Drepturile implicite pe funcții noi nu includ PUBLIC/anon/authenticated (A1 + 26 sept)
select ok(
  exists (select 1 from pg_default_acl d where d.defaclobjtype = 'f' and pg_get_userbyid(d.defaclrole) = 'postgres'
            and d.defaclnamespace = 0 and d.defaclacl::text not like '{=X%' and d.defaclacl::text not like '%,=X%')
  and not exists (select 1 from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
                   where n.nspname = 'public' and d.defaclobjtype = 'f' and pg_get_userbyid(d.defaclrole) = 'postgres'
                     and (d.defaclacl::text like '%anon=%' or d.defaclacl::text like '%authenticated=%')),
  'Funcțiile noi nu primesc EXECUTE implicit');

-- 7. Bucket photos: privat, cu limită de mărime
select ok(
  (select bool_and(not public and file_size_limit is not null) from storage.buckets where id = 'photos'),
  'Bucket photos: privat, cu limită de mărime');

-- 8. Gărzile din 26 sept + garda de ban pe toate tabelele de conținut (12 triggere active)
select is(
  (select count(*)::int from (values
      ('profiles', 'profiles_guard_privileged'), ('announcements', 'announcements_guard_client'),
      ('reports', 'reports_snapshot'),
      ('announcements', 'ban_guard_ins'), ('applications', 'ban_guard_ins'), ('channel_messages', 'ban_guard_ins'),
      ('ratings', 'ban_guard_ins'), ('reports', 'ban_guard_ins'), ('conversations', 'ban_guard_ins'),
      ('market_listings', 'ban_guard_ins'), ('market_listing_photos', 'ban_guard_ins'), ('messages', 'ban_guard_ins')
    ) e(tbl, trg)
    join pg_trigger t on t.tgname = e.trg and t.tgrelid = ('public.' || e.tbl)::regclass and t.tgenabled <> 'D'),
  12, 'Triggerele de gardă sunt prezente și active (12/12)');

-- 9. Nicio politică de scriere cu USING/WITH CHECK = true
select is(
  (select coalesce(string_agg(tablename || '.' || policyname, ', '), '') from pg_policies
    where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')),
  '', 'Nicio politică de scriere cu true');

-- 10. Funcții executabile de anon = doar allowlist-ul anon
select is(
  (select coalesce(string_agg(fn, ', ' order by fn), '') from fns
    where anon_x and not is_trigger and fn not in (select fn from anon_fn_allow)),
  '', 'Funcții executabile de anon = doar allowlist-ul anon');

-- 11. anon: privilegii pe tabele / view-uri / coloane = doar allowlist-ul anon
select is(
  (select coalesce(string_agg(x, ', ' order by x), '') from (
      select c.relname || '.' || a.attname as x
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
         and has_column_privilege('anon', c.oid, a.attnum, 'SELECT, INSERT, UPDATE, REFERENCES')
         and not exists (select 1 from anon_table_allow t
                          where t.tbl = c.relname and (t.col = '*' or t.col = a.attname))
    ) s),
  '', 'anon: privilegii pe tabele/coloane = doar allowlist');

-- 12. authenticated: grant-uri = exact comenzile cu politici, pe fiecare tabel (A1)
select is(
  (select coalesce(string_agg(relname || ' (politici=' || expected || ', grant=' || actual || ')', '; ' order by relname), '')
     from (
      select c.relname,
             (select coalesce(string_agg(distinct cmd, '/' order by cmd), '-') from (
                select unnest(case when p.cmd = 'ALL' then array['DELETE', 'INSERT', 'SELECT', 'UPDATE']
                                   else array[p.cmd::text] end) as cmd
                  from pg_policies p
                 where p.schemaname = 'public' and p.tablename = c.relname
                   and (p.roles @> array['authenticated']::name[] or p.roles @> array['public']::name[])) q) as expected,
             (select coalesce(string_agg(priv, '/' order by priv), '-')
                from unnest(array['DELETE', 'INSERT', 'SELECT', 'UPDATE']) as priv
               where has_table_privilege('authenticated', c.oid, priv)) as actual,
             has_table_privilege('authenticated', c.oid, 'TRUNCATE, REFERENCES, TRIGGER') as extra
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
    ) t
    where expected <> actual or extra),
  '', 'authenticated: grant-uri = comenzi cu politici');

-- 13. Toate view-urile din public sunt security_invoker (Security Advisor: security_definer_view)
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not exists (select 1 from unnest(coalesce(c.reloptions, '{}')) o where o in ('security_invoker=true', 'security_invoker=on'))),
  '', 'Toate view-urile din public sunt security_invoker');

-- 14. API-ul nu expune alte scheme decât public/graphql_public (schema privată `app` din faza 3+
--     nu are voie să apară în pgrst.db_schemas sau în extra search path); pg_graphql nu e instalat
select ok(
  not exists (select 1 from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) cfg
               where r.rolname = 'authenticator'
                 and (cfg like 'pgrst.db_schemas=%' or cfg like 'pgrst.db_extra_search_path=%')
                 and cfg ~ '(^|[=, ])app([, ]|$)')
  and not exists (select 1 from pg_extension where extname = 'pg_graphql'),
  'Schema privată app nu e expusă prin PostgREST; pg_graphql nu e instalat');

select * from finish();
rollback;
