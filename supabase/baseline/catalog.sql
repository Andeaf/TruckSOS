-- Extrage din catalogul bazei de date (doar SELECT) tot ce intră în baseline-ul schemei:
-- scripts/baseline-generate.mjs transformă rândurile de aici în DDL. Rulare:
--   npx supabase db query --linked -f supabase/baseline/catalog.sql > <out.json>
-- `search_path = ''` ca toate numele deparsate (pg_get_expr, pg_get_viewdef, regclass…) să iasă calificate.
set search_path = '';
with
tbl as (
  select c.oid, n.nspname, c.relname, c.relacl, c.relrowsecurity, c.relforcerowsecurity, c.relreplident, c.reloptions, c.relkind
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'app') and c.relkind in ('r', 'v', 'S')
),
cols as (
  select a.attrelid, pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'name', a.attname, 'num', a.attnum,
           'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
           'notnull', a.attnotnull, 'identity', a.attidentity::text, 'generated', a.attgenerated::text,
           'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid),
           'collation', case when a.attcollation <> t.typcollation then (select pg_catalog.quote_ident(cn.nspname) || '.' || pg_catalog.quote_ident(co.collname) from pg_catalog.pg_collation co join pg_catalog.pg_namespace cn on cn.oid = co.collnamespace where co.oid = a.attcollation) end,
           'acl', a.attacl::text[],
           'comment', pg_catalog.col_description(a.attrelid, a.attnum)
         ) order by a.attnum) as cols
    from pg_catalog.pg_attribute a join pg_catalog.pg_type t on t.oid = a.atttypid
    left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attnum > 0 and not a.attisdropped and a.attrelid in (select oid from tbl)
   group by a.attrelid
)
select 'extension' as section, e.extname as key, pg_catalog.jsonb_build_object('schema', ne.nspname, 'version', e.extversion) as payload
  from pg_catalog.pg_extension e join pg_catalog.pg_namespace ne on ne.oid = e.extnamespace
union all
select 'schema', n.nspname, pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(n.nspowner), 'acl', n.nspacl::text[])
  from pg_catalog.pg_namespace n where n.nspname in ('public', 'app')
union all
select 'default_acl', pg_catalog.pg_get_userbyid(d.defaclrole) || '|' || case when d.defaclnamespace = 0 then '' else d.defaclnamespace::regnamespace::text end || '|' || d.defaclobjtype::text,
       pg_catalog.jsonb_build_object('role', pg_catalog.pg_get_userbyid(d.defaclrole), 'schema', case when d.defaclnamespace = 0 then '' else d.defaclnamespace::regnamespace::text end, 'objtype', d.defaclobjtype::text, 'acl', d.defaclacl::text[])
  from pg_catalog.pg_default_acl d where pg_catalog.pg_get_userbyid(d.defaclrole) = 'postgres'
union all
select 'sequence', t.nspname || '.' || t.relname,
       pg_catalog.jsonb_build_object('schema', t.nspname, 'name', t.relname, 'type', pg_catalog.format_type(s.seqtypid, null),
         'start', s.seqstart, 'increment', s.seqincrement, 'min', s.seqmin, 'max', s.seqmax, 'cache', s.seqcache, 'cycle', s.seqcycle,
         'acl', t.relacl::text[],
         'owned_by', (select pg_catalog.jsonb_build_object('table', (select nn.nspname || '.' || cc.relname from pg_catalog.pg_class cc join pg_catalog.pg_namespace nn on nn.oid = cc.relnamespace where cc.oid = dep.refobjid), 'column', a.attname, 'deptype', dep.deptype::text)
                        from pg_catalog.pg_depend dep join pg_catalog.pg_attribute a on a.attrelid = dep.refobjid and a.attnum = dep.refobjsubid
                       where dep.objid = t.oid and dep.classid = 'pg_catalog.pg_class'::regclass and dep.deptype in ('a', 'i') limit 1))
  from tbl t join pg_catalog.pg_sequence s on s.seqrelid = t.oid where t.relkind = 'S'
union all
select 'table', t.nspname || '.' || t.relname,
       pg_catalog.jsonb_build_object('schema', t.nspname, 'name', t.relname, 'columns', c.cols, 'acl', t.relacl::text[],
         'rls', t.relrowsecurity, 'force_rls', t.relforcerowsecurity, 'replident', t.relreplident::text, 'options', t.reloptions,
         'comment', pg_catalog.obj_description(t.oid, 'pg_class'))
  from tbl t join cols c on c.attrelid = t.oid where t.relkind = 'r'
union all
select 'view', t.nspname || '.' || t.relname,
       pg_catalog.jsonb_build_object('schema', t.nspname, 'name', t.relname, 'definition', pg_catalog.pg_get_viewdef(t.oid, true), 'options', t.reloptions,
         'acl', t.relacl::text[], 'columns', c.cols, 'comment', pg_catalog.obj_description(t.oid, 'pg_class'))
  from tbl t join cols c on c.attrelid = t.oid where t.relkind = 'v'
union all
select 'constraint', t.nspname || '.' || t.relname || '.' || k.conname,
       pg_catalog.jsonb_build_object('schema', t.nspname, 'table', t.relname, 'name', k.conname, 'type', k.contype::text,
         'definition', pg_catalog.pg_get_constraintdef(k.oid, true), 'validated', k.convalidated, 'comment', pg_catalog.obj_description(k.oid, 'pg_constraint'))
  from pg_catalog.pg_constraint k join tbl t on t.oid = k.conrelid where t.relkind = 'r'
union all
select 'index', t.nspname || '.' || i.relname,
       pg_catalog.jsonb_build_object('schema', t.nspname, 'table', t.relname, 'name', i.relname, 'definition', pg_catalog.pg_get_indexdef(i.oid), 'comment', pg_catalog.obj_description(i.oid, 'pg_class'))
  from pg_catalog.pg_index x join pg_catalog.pg_class i on i.oid = x.indexrelid join tbl t on t.oid = x.indrelid
 where t.relkind = 'r' and not exists (select 1 from pg_catalog.pg_constraint k where k.conindid = x.indexrelid and k.contype in ('p', 'u', 'x'))
union all
select 'function', n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
       pg_catalog.jsonb_build_object('schema', n.nspname, 'name', p.proname, 'identity_args', pg_catalog.pg_get_function_identity_arguments(p.oid),
         'definition', pg_catalog.pg_get_functiondef(p.oid), 'acl', p.proacl::text[], 'owner', pg_catalog.pg_get_userbyid(p.proowner),
         'kind', p.prokind::text, 'returns_trigger', p.prorettype = 'pg_catalog.trigger'::regtype, 'comment', pg_catalog.obj_description(p.oid, 'pg_proc'))
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app')
union all
select 'extension_function_acl', n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
       pg_catalog.jsonb_build_object('schema', n.nspname, 'name', p.proname, 'identity_args', pg_catalog.pg_get_function_identity_arguments(p.oid), 'acl', p.proacl::text[])
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'extensions' and p.proacl is not null and exists (select 1 from pg_catalog.unnest(p.proacl) a where a::text like 'anon=%' or a::text like 'authenticated=%' or a::text like 'service_role=%')
union all
select 'trigger', nt.nspname || '.' || ct.relname || '.' || g.tgname,
       pg_catalog.jsonb_build_object('schema', nt.nspname, 'table', ct.relname, 'name', g.tgname, 'definition', pg_catalog.pg_get_triggerdef(g.oid, true), 'enabled', g.tgenabled::text)
  from pg_catalog.pg_trigger g join pg_catalog.pg_class ct on ct.oid = g.tgrelid join pg_catalog.pg_namespace nt on nt.oid = ct.relnamespace
 where not g.tgisinternal and (nt.nspname in ('public', 'app') or (nt.nspname = 'auth' and ct.relname = 'users'))
union all
select 'policy', p.schemaname || '.' || p.tablename || '.' || p.policyname,
       pg_catalog.jsonb_build_object('schema', p.schemaname, 'table', p.tablename, 'name', p.policyname, 'permissive', p.permissive,
         'roles', p.roles::text[], 'cmd', p.cmd, 'qual', p.qual, 'with_check', p.with_check)
  from pg_catalog.pg_policies p where p.schemaname in ('public', 'app', 'storage')
union all
select 'bucket', b.id, pg_catalog.jsonb_build_object('id', b.id, 'name', b.name, 'public', b.public, 'file_size_limit', b.file_size_limit, 'allowed_mime_types', b.allowed_mime_types)
  from storage.buckets b
union all
select 'publication_table', pt.pubname || '.' || pt.schemaname || '.' || pt.tablename,
       pg_catalog.jsonb_build_object('publication', pt.pubname, 'schema', pt.schemaname, 'table', pt.tablename)
  from pg_catalog.pg_publication_tables pt where pt.pubname = 'supabase_realtime'
union all
select 'cron', j.jobname, pg_catalog.jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'command', j.command, 'active', j.active)
  from cron.job j
order by 1, 2;
