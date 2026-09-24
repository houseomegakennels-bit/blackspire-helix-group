import {createHash} from 'node:crypto';
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
const fail=()=>{throw new Error('Owned source current demo restriction evidence refused');};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const OWNED_DEMO_RESTRICTION_MIGRATION=Object.freeze({version:'20260921180643',name:'deny_demo_direct_production_access',idempotencyKey:null,statementCount:1,statementSha256:'40d41dd38f6b8f168be8feed8633af14bf1d93b7fb1c6517ba485252d264e9cc'});
// Receipt bytes independently match reviewed main3019785 migration180603.
// Only the applied timestamp differs. Neither migration is dispatched here.
const predicate="(COALESCE(((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'blackspire_role'::text), ''::text) <> ALL (ARRAY['demo_viewer'::text, 'demo_operator'::text]))";
const tables=['BuyerProfile','BuyerReport','CleanSale','RawSale','SearchJob','exports','nexus_contacts'];
const policy=(table,name,permissive,command,roles,using,check)=>({table,name,permissive,command,roles,using,check});
const policies=tables.map(table=>policy(table,'blackspire_deny_demo_direct_access','RESTRICTIVE','ALL',['authenticated'],predicate,predicate));
policies.push(policy('SearchJob','user_read_own_search_jobs','PERMISSIVE','SELECT',['authenticated'],'(user_id = auth.uid())',null),policy('exports','users_insert_own_exports','PERMISSIVE','INSERT',['public'],null,'(auth.uid() = user_id)'),policy('exports','users_read_own_exports','PERMISSIVE','SELECT',['public'],'(auth.uid() = user_id)',null));
policies.sort((a,b)=>a.table<b.table?-1:a.table>b.table?1:a.name<b.name?-1:a.name>b.name?1:0);
export const OWNED_DEMO_RESTRICTION_EXPECTED=freeze({migration:OWNED_DEMO_RESTRICTION_MIGRATION,policies,
 jwt:{oid:16714,ownerOid:16545,owner:'supabase_auth_admin',language:'sql',volatility:'s',securityDefiner:false,configuration:null,returnType:3802,kind:'f',leakproof:false,strict:false,parallel:'u',support:'-',binary:null,definitionSha256:'7ce3ad8fb99f7ad5f5cd869fbd5479a6325e9444da472c26394cfa66c83b2d11',acl:['=X/supabase_auth_admin','postgres=X/supabase_auth_admin','supabase_auth_admin=X/supabase_auth_admin','dashboard_user=X/supabase_auth_admin']},
 dependencySafe:true,ownerReadPreserved:true});
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export function validateOwnedDemoRestrictionEvidence(value){if(JSON.stringify(canonical(value))!==JSON.stringify(canonical(OWNED_DEMO_RESTRICTION_EXPECTED)))fail();return Object.freeze({status:'OWNED_SOURCE_DEMO_RESTRICTION_VERIFIED',migrationVersion:OWNED_DEMO_RESTRICTION_MIGRATION.version,migrationSha256:OWNED_DEMO_RESTRICTION_MIGRATION.statementSha256,currentCatalogDigest:hash(canonical(value)),sourceWritesDenied:true,ownerReadPreserved:true,demoReadDenied:true,sourceSqlReapplied:false});}
export const OWNED_DEMO_RESTRICTION_SQL=`SELECT jsonb_build_object(
 'migration',(SELECT jsonb_build_object('version',version,'name',name,'idempotencyKey',idempotency_key,'statementCount',cardinality(statements),'statementSha256',encode(sha256(convert_to(statements[1],'UTF8')),'hex')) FROM supabase_migrations.schema_migrations WHERE version='20260921180643' OR name='deny_demo_direct_production_access'),
 'policies',(SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'permissive',permissive,'command',cmd,'roles',roles,'using',qual,'check',with_check) ORDER BY tablename COLLATE "C",policyname COLLATE "C") FROM pg_policies WHERE schemaname='public' AND tablename=ANY(ARRAY['BuyerProfile','BuyerReport','CleanSale','RawSale','SearchJob','exports','nexus_contacts'])),
 'jwt',(SELECT jsonb_build_object('oid',p.oid::int,'ownerOid',p.proowner::int,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'volatility',p.provolatile,'securityDefiner',p.prosecdef,'configuration',p.proconfig,'returnType',p.prorettype::int,'kind',p.prokind,'leakproof',p.proleakproof,'strict',p.proisstrict,'parallel',p.proparallel,'support',p.prosupport::text,'binary',p.probin,'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),'acl',p.proacl::text[]) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='auth' AND p.proname='jwt' AND p.pronargs=0),
 'dependencySafe',(SELECT count(*)=1 FROM pg_namespace WHERE nspname='auth' AND oid=16498 AND pg_get_userbyid(nspowner)='supabase_admin')
 AND NOT EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role'])r WHERE has_schema_privilege(r,'auth','CREATE') OR pg_has_role(r,'supabase_auth_admin','MEMBER'))
 AND EXISTS(SELECT FROM pg_roles WHERE oid=16545 AND rolname='supabase_auth_admin' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
 AND EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=3294 AND n.nspname='pg_catalog' AND p.proname='current_setting' AND p.proargtypes='25 16'::oidvector AND pg_get_userbyid(p.proowner)='supabase_admin' AND p.prolang=12 AND NOT p.prosecdef AND p.proconfig IS NULL)
 AND NOT EXISTS(SELECT FROM pg_depend d JOIN pg_policy p ON p.oid=d.objid WHERE d.classid='pg_policy'::regclass AND d.refclassid='pg_proc'::regclass AND p.polrelid='public."SearchJob"'::regclass AND d.refobjid NOT IN(16542,16714)),
 'ownerReadPreserved',has_table_privilege('authenticated','public."SearchJob"','SELECT') AND has_schema_privilege('authenticated','auth','USAGE') AND has_function_privilege('authenticated','auth.uid()','EXECUTE') AND has_function_privilege('authenticated','auth.jwt()','EXECUTE') AND (SELECT relrowsecurity FROM pg_class WHERE oid='public."SearchJob"'::regclass)
 ) AS evidence`;

export function validateOwnedSourceCurrentSecurityProof(value){
 if(!value||!(/^[a-f0-9]{64}$/).test(value.historicalProofDigest??''))fail();
 const expected={...validateOwnedDemoRestrictionEvidence(OWNED_DEMO_RESTRICTION_EXPECTED),historicalProofDigest:value.historicalProofDigest,manifestDigest:'a07fb7bf9e998c976eb57abcdd422a463ba2718c1b9ec8c59c6108da4edb81ac',originalBodySha256:'4687ea2738680ad3fa5b0bc522246a48298877167b91c3866f275e8217c71091'};
 if(JSON.stringify(canonical(value))!==JSON.stringify(canonical(expected)))fail();return value;
}
