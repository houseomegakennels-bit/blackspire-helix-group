// Read-only catalog capture. No application rows, credentials or function calls
// from the affected extensions are evaluated. ACL NULL uses PostgreSQL defaults.
export const EXTENSION_ACL_CATALOG_SQL=`
with objects as (
 select c.oid,n.nspname as schema,c.relname as name,c.relkind::text as kind,c.relowner as owner_oid,
 null::text as arguments,null::text as definition_digest,null::boolean as security_definer,
 coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner)) as acl
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where (n.nspname='net' and c.relname in ('_http_response','http_request_queue','http_request_queue_id_seq'))
 or (n.nspname='extensions' and c.relname in ('pg_stat_statements','pg_stat_statements_info'))
 union all
 select p.oid,n.nspname,p.proname,'function',p.proowner,pg_get_function_identity_arguments(p.oid),md5(pg_get_functiondef(p.oid)),p.prosecdef,
 coalesce(p.proacl,acldefault('f',p.proowner)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='net'
)
select jsonb_build_object(
 'database',current_database(),
 'serverVersion',current_setting('server_version'),
 'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'oid',oid,'superuser',rolsuper,'inherit',rolinherit,'login',rolcanlogin,'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls) order by rolname) from pg_roles),
 'memberships',(select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) order by roleid,member,grantor),'[]'::jsonb) from pg_auth_members),
 'extensions',(select coalesce(jsonb_agg(jsonb_build_object('name',extname,'version',extversion,'owner',pg_get_userbyid(extowner)) order by extname),'[]'::jsonb) from pg_extension where extname in ('pg_net','pg_stat_statements')),
 'schemas',(select jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'edges',
 (select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantor,a.grantee,a.privilege_type)
 from aclexplode(coalesce(nspacl,acldefault('n',nspowner))) a)) order by nspname) from pg_namespace where nspname in ('net','extensions')),
 'objects',(select jsonb_agg(jsonb_build_object('oid',oid,'schema',schema,'name',name,'kind',kind,'owner',pg_get_userbyid(owner_oid),'arguments',arguments,'definitionDigest',definition_digest,'securityDefiner',security_definer,'edges',
 (select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantor,a.grantee,a.privilege_type) from aclexplode(acl) a)) order by schema,name,arguments) from objects),
 'columns',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'number',a.attnum,'name',a.attname,'aclIsNull',a.attacl is null,'edges',
 (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(x.grantor),'grantee',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable) order by x.grantor,x.grantee,x.privilege_type),'[]'::jsonb) from aclexplode(a.attacl) x)) order by n.nspname,c.relname,a.attnum)
 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where a.attnum>0 and not a.attisdropped
 and ((n.nspname='net' and c.relname in ('_http_response','http_request_queue')) or (n.nspname='extensions' and c.relname in ('pg_stat_statements','pg_stat_statements_info'))))
) as metadata`;
