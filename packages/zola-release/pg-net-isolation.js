import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';

// This query is observation-only. Application ownership is determined by role,
// not by trusting a schema name alone. Supabase/provider schemas and owners are
// excluded explicitly; an application-owned routine in any other schema is in
// scope. Returning even one row is a closed-gate result.
export const APPLICATION_FUNCTION_PG_NET_SQL=`select n.nspname as "schemaName",p.proname as "functionName",
 pg_get_function_identity_arguments(p.oid) as arguments,pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where pg_get_userbyid(p.proowner) in ('postgres','buyer_writer_owner')
 and n.nspname not in ('pg_catalog','information_schema','net','auth','storage','realtime','extensions',
  'graphql','graphql_public','vault','pgsodium','pgsodium_masks','cron','pgmq','supabase_functions','supabase_migrations')
 and (coalesce(p.prosrc,'') ~* '(^|[^a-z0-9_])net[[:space:]]*\\.'
  or coalesce(p.prosrc,'') ~* '(^|[^a-z0-9_])(http_get|http_post|http_delete|http_collect_response)[[:space:]]*\\(')
order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.oid`;

export const PG_NET_SOURCE_TERMS=Object.freeze([
 Object.freeze({term:'net.http_*',pattern:/\bnet\s*\.\s*http_[a-z0-9_]*/iu}),
 Object.freeze({term:'pg_net',pattern:/\bpg_net\b/iu}),
]);

// Exact files only. These contain the provider observer, the identity denial,
// the catalog hardening implementation, or native test harnesses. There is no
// directory/prefix exemption: a new test or production file containing a term
// is denied until its individual purpose is reviewed here.
export const PG_NET_SOURCE_ALLOWLIST=Object.freeze([
 'packages/zola-release/pg-net-isolation.js',
 'packages/zola-release/production-acl-writer.js',
 'packages/buyer-writer/extension-acl-catalog.js',
 'packages/buyer-writer/local-gateway-protocol.js',
 'packages/buyer-writer/local-gateway-postgres.js',
 'packages/buyer-writer/postgres.js',
 'packages/buyer-writer/production-verifier.js',
 'scripts/test-buyer-migration-executor-postgres.mjs',
 'scripts/test-buyer-migration-executor-session.mjs',
 'scripts/test-buyer-writer-acl.mjs',
 // Reviewed owned-cluster documentation and isolated provider-denial fixtures.
 'packages/buyer-writer/OWNED_POSTGRES.md',
 'scripts/test-owned-source-security-postgres.mjs',
 'tests/buyer-writer-owned-database-evidence.test.js',
 'scripts/test-buyer-writer-postgres.mjs',
 'docs/BLACKSPIRE_ACTIVE_CONTEXT.md',
 'docs/BLACKSPIRE_DECISIONS.md',
 'docs/BLACKSPIRE_NEXT_ACTIONS.md',
 'docs/BLACKSPIRE_SESSION_LOG.md',
 'docs/BLACKSPIRE_SOURCE_OF_TRUTH.md',
 'docs/ZOLA_PROVIDER_ACL_REQUEST.md',
 'tests/buyer-writer-local-gateway.test.js',
 'tests/buyer-writer-production-preflight.test.js',
 'tests/buyer-writer-production-provisioner.test.js',
 'tests/buyer-writer-production-verifier.test.js',
 'tests/zola-pg-net-host-observer.test.js',
 'tests/zola-pg-net-isolation.test.js',
]);

const sourcePath=path=>/\.(?:cjs|js|json|md|mjs|sql|ts|tsx)$/.test(path);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function repositoryFiles(root){
 const output=execFileSync('/usr/bin/git',['-C',root,'ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'buffer',timeout:5000,maxBuffer:8*1024*1024,
  stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
 return output.toString('utf8').split('\0').filter(Boolean).sort();
}

export function scanApplicationPgNetSource({root=process.cwd(),files}={}){
 try{
  const normalizedRoot=resolve(root),allow=new Set(PG_NET_SOURCE_ALLOWLIST);
  const entries=files===undefined
   ?repositoryFiles(normalizedRoot).filter(sourcePath).map(path=>{
     const absolute=resolve(normalizedRoot,path);
     if(!absolute.startsWith(`${normalizedRoot}${sep}`)||lstatSync(absolute).isSymbolicLink())throw new Error('unsafe source');
     return [path,readFileSync(absolute,'utf8')];
    })
   :Object.entries(files).sort(([a],[b])=>a.localeCompare(b));
  const violations=[];
  for(const [path,source] of entries){
   if(typeof path!=='string'||typeof source!=='string'||!sourcePath(path))throw new Error('invalid source input');
   if(allow.has(path))continue;
   for(const {term,pattern} of PG_NET_SOURCE_TERMS)if(pattern.test(source))violations.push(Object.freeze({path,term}));
  }
  const ordered=violations.sort((a,b)=>a.path.localeCompare(b.path)||a.term.localeCompare(b.term));
  return Object.freeze({available:true,applicationPgNetCallSitesZero:ordered.length===0,callSiteCount:ordered.length,
   sourceScanDigest:digest(ordered)});
 }catch{
  return Object.freeze({available:false,applicationPgNetCallSitesZero:false,callSiteCount:null,sourceScanDigest:null});
 }
}

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const runtimeKeys=['applicationDbCredentialsAbsent','gatewayTransportVerified','arbitrarySqlDenied','arbitraryFunctionDenied','arbitraryUrlDenied'];

export function createPgNetIsolationProof({query,verifyRuntimeIsolation,scanSource=scanApplicationPgNetSource,root=process.cwd()}={}){
 if(typeof query!=='function'||typeof verifyRuntimeIsolation!=='function'||typeof scanSource!=='function')
  throw new Error('PG net isolation verifier unavailable');
 return async()=>{
  try{
   const source=scanSource({root});
   if(!exact(source,['available','applicationPgNetCallSitesZero','callSiteCount','sourceScanDigest'])||source.available!==true
    ||typeof source.applicationPgNetCallSitesZero!=='boolean'||!Number.isSafeInteger(source.callSiteCount)||source.callSiteCount<0
    ||typeof source.sourceScanDigest!=='string'||!/^[a-f0-9]{64}$/.test(source.sourceScanDigest))throw new Error('invalid source proof');
   const runtime=await verifyRuntimeIsolation();
   if(!exact(runtime,runtimeKeys)||runtimeKeys.some(key=>typeof runtime[key]!=='boolean'))throw new Error('invalid runtime proof');
   const result=await query(APPLICATION_FUNCTION_PG_NET_SQL,[]),rows=result?.rows;
   if(!Array.isArray(rows))throw new Error('invalid database proof');
   for(const row of rows)if(!exact(row,['schemaName','functionName','arguments','owner'])
    ||![row.schemaName,row.functionName,row.arguments,row.owner].every(value=>typeof value==='string'&&value.length<=1024))
    throw new Error('invalid database proof');
   const applicationDbPgNetReferencesZero=rows.length===0;
   const evidence=Object.freeze({...runtime,applicationPgNetCallSitesZero:source.applicationPgNetCallSitesZero,
    applicationDbPgNetReferencesZero,applicationPgNetCallSiteCount:source.callSiteCount,
    applicationDbPgNetReferenceCount:rows.length,sourceScanDigest:source.sourceScanDigest,
    functionBodyDigest:digest(rows),pgNetIsolationVerified:runtimeKeys.every(key=>runtime[key]===true)
     &&source.applicationPgNetCallSitesZero&&applicationDbPgNetReferencesZero});
   return Object.freeze({status:evidence.pgNetIsolationVerified?'PASS':'BLOCKED_EXTERNAL',evidence});
  }catch{return Object.freeze({status:'BLOCKED_EXTERNAL'});}
 };
}
