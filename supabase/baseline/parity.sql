-- Paritatea schemei: aceeași interogare (doar SELECT) rulată pe producție și pe Postgres-ul din CI
-- (`supabase start` + migrările) trebuie să dea exact aceleași rânduri. Rezultatul producției e comis în
-- supabase/baseline/parity.expected.txt (regenerat cu scripts/baseline-parity-expected.mjs); CI-ul rulează
-- fișierul cu psql și face diff. Pasul 0.3-bis din PLAN_1.1_FIX (29 oct 2026).
--
-- Ce compară: extensiile relevante, drepturile pe scheme, drepturile implicite ale rolului postgres,
-- secvențele, tabelele (coloane, tipuri, NOT NULL, DEFAULT, coloane generate/identity, RLS, REPLICA
-- IDENTITY, comentarii), drepturile efective pe tabele/coloane/view-uri/secvențe/funcții pentru anon,
-- authenticated și service_role, constrângerile, indexurile, funcțiile (corp normalizat, atribute),
-- view-urile, triggerele, politicile (public + storage), bucket-ul, publicația Realtime și joburile cron.
-- Ce NU compară (diferă legitim între medii): proprietarii și grantorii din aclitem, versiunile
-- extensiilor, rolurile platformei, secretele din Vault, datele.
--
-- Toate valorile sunt pe o singură linie (spațiile normalizate); ordinea e COLLATE "C" ca sortarea să nu
-- depindă de localizarea serverului.
set search_path = '';
with
rel as (
  select c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relreplident, c.reloptions
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'app') and c.relkind in ('r', 'v', 'S')
),
fn as (
  select p.oid, n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as args, p.prosrc, p.provolatile, p.prosecdef,
         p.proconfig, p.proisstrict, p.prokind, p.proretset, p.proacl, l.lanname,
         pg_catalog.pg_get_function_result(p.oid) as result, pg_catalog.pg_get_function_arguments(p.oid) as full_args
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace join pg_catalog.pg_language l on l.oid = p.prolang
   where n.nspname in ('public', 'app') or (n.nspname = 'extensions' and p.proname = 'unaccent')
),
lines as (
  select 'extension|' || e.name || '|' || exists (select 1 from pg_catalog.pg_extension x where x.extname = e.name)::text as line
    from (values ('pg_cron'), ('pg_net'), ('pgcrypto'), ('unaccent'), ('uuid-ossp'), ('supabase_vault'), ('pg_stat_statements'), ('pg_graphql')) e(name)
  union all
  select 'schema|' || s.name || '|' || r.role || '|usage=' || pg_catalog.has_schema_privilege(r.role, s.name, 'USAGE')::text || '|create=' || pg_catalog.has_schema_privilege(r.role, s.name, 'CREATE')::text
    from (values ('public'), ('app')) s(name) cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
  union all
  -- Drepturile implicite ale lui postgres: pentru tabele/secvențe un rând doar cu owner-ul e totuna cu lipsa lui;
  -- pentru funcții contează explicit dacă PUBLIC are EXECUTE, iar lipsa rândului se vede distinct (PUBLIC=none),
  -- pentru că rândul pe schemă se adună la cel global (un GRANT explicit ar schimba drepturile funcțiilor noi).
  select 'default_acl|' || coalesce(nullif(s.name, ''), 'GLOBAL') || '|' || t.objtype || '|' ||
         case when t.objtype = 'f' then 'PUBLIC=' || coalesce((select exists (select 1 from pg_catalog.unnest(d.defaclacl) a where a::text like '=X%')::text
                                                                 from pg_catalog.pg_default_acl d
                                                                where pg_catalog.pg_get_userbyid(d.defaclrole) = 'postgres' and d.defaclobjtype = t.objtype
                                                                  and d.defaclnamespace = case when s.name = '' then 0 else s.name::regnamespace end), 'none') || ';'
              else '' end ||
         coalesce((select pg_catalog.string_agg(pg_catalog.regexp_replace(a::text, '/.*$', ''), ',' order by a::text collate "C")
                     from pg_catalog.pg_default_acl d, pg_catalog.unnest(d.defaclacl) a
                    where pg_catalog.pg_get_userbyid(d.defaclrole) = 'postgres' and d.defaclobjtype = t.objtype
                      and d.defaclnamespace = case when s.name = '' then 0 else s.name::regnamespace end
                      and a::text not like 'postgres=%' and a::text not like '=%'), '-')
    from (values (''), ('public'), ('app'), ('extensions'), ('storage')) s(name) cross join (values ('r'), ('S'), ('f')) t(objtype)
   where s.name = '' or exists (select 1 from pg_catalog.pg_namespace where nspname = s.name)
  union all
  select 'sequence|' || r.nspname || '.' || r.relname || '|' || pg_catalog.format_type(s.seqtypid, null) || '|start=' || s.seqstart || '|inc=' || s.seqincrement || '|min=' || s.seqmin || '|max=' || s.seqmax || '|cache=' || s.seqcache || '|cycle=' || s.seqcycle::text
    from rel r join pg_catalog.pg_sequence s on s.seqrelid = r.oid
  union all
  select 'sequence_priv|' || r.nspname || '.' || r.relname || '|' || x.role || '|' ||
         pg_catalog.concat_ws(',', case when pg_catalog.has_sequence_privilege(x.role, r.oid, 'USAGE') then 'USAGE' end,
                                   case when pg_catalog.has_sequence_privilege(x.role, r.oid, 'SELECT') then 'SELECT' end,
                                   case when pg_catalog.has_sequence_privilege(x.role, r.oid, 'UPDATE') then 'UPDATE' end)
    from rel r cross join (values ('anon'), ('authenticated'), ('service_role')) x(role) where r.relkind = 'S'
  union all
  select 'table|' || r.nspname || '.' || r.relname || '|rls=' || r.relrowsecurity::text || '|force=' || r.relforcerowsecurity::text || '|replident=' || r.relreplident::text
         || '|options=' || coalesce(pg_catalog.array_to_string(r.reloptions, ','), '-')
         || '|comment=' || coalesce(pg_catalog.regexp_replace(pg_catalog.obj_description(r.oid, 'pg_class'), '\s+', ' ', 'g'), '-')
    from rel r where r.relkind = 'r'
  union all
  -- Poziția e numărată peste coloanele nesterse (nu attnum): un DROP COLUMN în producție n-ar lăsa goluri false.
  select 'column|' || r.nspname || '.' || r.relname || '|' || pg_catalog.lpad((row_number() over (partition by r.oid order by a.attnum))::text, 3, '0') || '|' || a.attname || '|' || pg_catalog.format_type(a.atttypid, a.atttypmod)
         || '|notnull=' || a.attnotnull::text || '|identity=' || a.attidentity::text || '|generated=' || a.attgenerated::text
         || '|default=' || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '-')
         || '|collation=' || case when a.attcollation <> t.typcollation then a.attcollation::regcollation::text else '-' end
         || '|comment=' || coalesce(pg_catalog.regexp_replace(pg_catalog.col_description(a.attrelid, a.attnum), '\s+', ' ', 'g'), '-')
    from rel r join pg_catalog.pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    join pg_catalog.pg_type t on t.oid = a.atttypid
    left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where r.relkind in ('r', 'v')
  union all
  -- Drepturi efective pe tabele/view-uri: pe tabel (DELETE, TRUNCATE, REFERENCES, TRIGGER) și pe coloane (SELECT/INSERT/UPDATE)
  select 'table_priv|' || r.nspname || '.' || r.relname || '|' || x.role || '|' ||
         pg_catalog.concat_ws(',', case when pg_catalog.has_table_privilege(x.role, r.oid, 'SELECT') then 'SELECT' end,
                                   case when pg_catalog.has_table_privilege(x.role, r.oid, 'INSERT') then 'INSERT' end,
                                   case when pg_catalog.has_table_privilege(x.role, r.oid, 'UPDATE') then 'UPDATE' end,
                                   case when pg_catalog.has_table_privilege(x.role, r.oid, 'DELETE') then 'DELETE' end,
                                   case when pg_catalog.has_table_privilege(x.role, r.oid, 'TRUNCATE') then 'TRUNCATE' end,
                                   case when pg_catalog.has_table_privilege(x.role, r.oid, 'REFERENCES') then 'REFERENCES' end,
                                   case when pg_catalog.has_table_privilege(x.role, r.oid, 'TRIGGER') then 'TRIGGER' end)
    from rel r cross join (values ('anon'), ('authenticated'), ('service_role')) x(role) where r.relkind in ('r', 'v')
  union all
  select 'column_priv|' || r.nspname || '.' || r.relname || '|' || x.role || '|' || p.priv || '|' ||
         coalesce((select pg_catalog.string_agg(a.attname, ',' order by a.attnum) from pg_catalog.pg_attribute a
                    where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped and pg_catalog.has_column_privilege(x.role, r.oid, a.attnum, p.priv)), '-')
    from rel r cross join (values ('anon'), ('authenticated'), ('service_role')) x(role) cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
   where r.relkind in ('r', 'v')
  union all
  select 'constraint|' || r.nspname || '.' || r.relname || '|' || k.conname || '|' || k.contype::text || '|' || pg_catalog.pg_get_constraintdef(k.oid, true) || '|validated=' || k.convalidated::text || '|deferrable=' || k.condeferrable::text
    from pg_catalog.pg_constraint k join rel r on r.oid = k.conrelid
  union all
  select 'index|' || r.nspname || '.' || i.relname || '|' || pg_catalog.pg_get_indexdef(i.oid) || '|valid=' || x.indisvalid::text
    from pg_catalog.pg_index x join pg_catalog.pg_class i on i.oid = x.indexrelid join rel r on r.oid = x.indrelid
  union all
  select 'function|' || f.nspname || '.' || f.proname || '(' || f.args || ')|' || f.lanname || '|' || f.prokind::text || '|' || f.provolatile::text || '|secdef=' || f.prosecdef::text || '|strict=' || f.proisstrict::text
         || '|config=' || coalesce(pg_catalog.array_to_string(f.proconfig, ','), '-') || '|returns=' || f.result || '|args=' || f.full_args
         || '|body=' || pg_catalog.md5(pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.regexp_replace(f.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
         || '|anon=' || pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE')::text
         || '|authenticated=' || pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')::text
         || '|service_role=' || pg_catalog.has_function_privilege('service_role', f.oid, 'EXECUTE')::text
         || '|public=' || (f.proacl is null or exists (select 1 from pg_catalog.unnest(f.proacl) a where a::text like '=X%'))::text
    from fn f
  union all
  select 'view|' || r.nspname || '.' || r.relname || '|options=' || coalesce(pg_catalog.array_to_string(r.reloptions, ','), '-')
         || '|def=' || pg_catalog.md5(pg_catalog.regexp_replace(pg_catalog.pg_get_viewdef(r.oid, true), '\s+', ' ', 'g'))
    from rel r where r.relkind = 'v'
  union all
  select 'trigger|' || nt.nspname || '.' || ct.relname || '|' || g.tgname || '|' || pg_catalog.pg_get_triggerdef(g.oid, true) || '|enabled=' || g.tgenabled::text
    from pg_catalog.pg_trigger g join pg_catalog.pg_class ct on ct.oid = g.tgrelid join pg_catalog.pg_namespace nt on nt.oid = ct.relnamespace
   where not g.tgisinternal and (nt.nspname in ('public', 'app') or (nt.nspname = 'auth' and ct.relname = 'users'))
  union all
  select 'policy|' || p.schemaname || '.' || p.tablename || '|' || p.policyname || '|' || p.permissive || '|' || pg_catalog.array_to_string(p.roles, ',') || '|' || p.cmd
         || '|using=' || coalesce(pg_catalog.regexp_replace(p.qual, '\s+', ' ', 'g'), '-') || '|check=' || coalesce(pg_catalog.regexp_replace(p.with_check, '\s+', ' ', 'g'), '-')
    from pg_catalog.pg_policies p where p.schemaname in ('public', 'app', 'storage')
  union all
  select 'bucket|' || b.id || '|' || b.name || '|public=' || b.public::text || '|limit=' || coalesce(b.file_size_limit::text, '-') || '|mime=' || coalesce(pg_catalog.array_to_string(b.allowed_mime_types, ','), '-')
    from storage.buckets b
  union all
  select 'publication|supabase_realtime|' || pt.schemaname || '.' || pt.tablename from pg_catalog.pg_publication_tables pt where pt.pubname = 'supabase_realtime'
  union all
  select 'publication_def|supabase_realtime|alltables=' || p.puballtables::text || '|' || p.pubinsert::text || p.pubupdate::text || p.pubdelete::text || p.pubtruncate::text
    from pg_catalog.pg_publication p where p.pubname = 'supabase_realtime'
  union all
  select 'cron|' || j.jobname || '|' || j.schedule || '|active=' || j.active::text || '|command=' || pg_catalog.md5(pg_catalog.btrim(pg_catalog.regexp_replace(j.command, '\s+', ' ', 'g')))
    from cron.job j
)
select line from lines order by line collate "C";
