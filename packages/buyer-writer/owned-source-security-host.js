import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {hash,openReleaseJournal} from '../zola-release/commander-journal.js';
import {verifyReleaseSource} from '../zola-release/commander-host.js';
import {readRootOwnedJsonSnapshot,readRootOwnedMetadataSnapshot} from './protected-json.js';
import * as database from './database-profile.js';
import {verifyOwnedBuyerMigrationQuiescence} from './owned-migration-host.js';
import {EXTENSION_ACL_CATALOG_SQL} from './extension-acl-catalog.js';
import {prepareBuyerWriterExtensionAcl} from './extension-acl.js';
import {prepareOwnedSourceSecurityPackage,executeOwnedSourceSecurity} from './owned-source-security.js';
export const OWNED_SOURCE_SECURITY_ROOT='/var/lib/blackspire-operator/owned-source-security';
const fail=()=>{throw new Error('Owned source security host refused; retain protected records and reconcile');};
const exact=(v,k)=>v&&Object.keys(v).sort().join(',')===[...k].sort().join(',');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const OWNED_SOURCE_IDENTITY_SQL=`SELECT (pg_control_system()).system_identifier::text AS "systemIdentifier",current_database() AS database,current_user AS actor,session_user AS session,(SELECT oid::integer FROM pg_roles WHERE rolname=current_user) AS "creatorOid",(SELECT datdba::integer FROM pg_database WHERE datname=current_database()) AS "databaseOwnerOid",(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS "bypassRls",pg_is_in_recovery() AS recovery`;
export const OWNED_SOURCE_EFFECTIVE_SQL=`WITH c AS (${EXTENSION_ACL_CATALOG_SQL}),o AS (SELECT value FROM c,jsonb_array_elements(metadata->'objects'))
SELECT jsonb_agg(jsonb_build_array(r.rolname,o.value->>'schema',o.value->>'name',o.value->>'kind',o.value->'arguments',p,
CASE WHEN o.value->>'kind'='function' THEN has_function_privilege(r.oid,(o.value->>'oid')::oid,p)
 WHEN o.value->>'kind'='S' THEN has_sequence_privilege(r.oid,(o.value->>'oid')::oid,p) ELSE has_table_privilege(r.oid,(o.value->>'oid')::oid,p) END,
CASE WHEN o.value->>'kind'='function' THEN has_function_privilege(r.oid,(o.value->>'oid')::oid,p||' WITH GRANT OPTION')
 WHEN o.value->>'kind'='S' THEN has_sequence_privilege(r.oid,(o.value->>'oid')::oid,p||' WITH GRANT OPTION') ELSE has_table_privilege(r.oid,(o.value->>'oid')::oid,p||' WITH GRANT OPTION') END)
ORDER BY r.rolname,o.value->>'schema',o.value->>'name',p) AS effective
FROM pg_roles r CROSS JOIN o CROSS JOIN LATERAL unnest(CASE WHEN o.value->>'kind'='function' THEN ARRAY['EXECUTE']
 WHEN o.value->>'kind'='S' THEN ARRAY['SELECT','UPDATE','USAGE'] ELSE ARRAY['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'] END)p`;
export const OWNED_SOURCE_SCHEMA_EFFECTIVE_SQL=`SELECT jsonb_agg(jsonb_build_array(rolname,s,has_schema_privilege(rolname,s,'USAGE'),has_schema_privilege(rolname,s,'CREATE')) ORDER BY rolname,s) AS "schemaEffective" FROM pg_roles CROSS JOIN unnest(ARRAY['extensions','net'])s`;
function rootSnapshot(filename){const record=(filename===database.LEGACY_DATABASE_MANAGEMENT?readRootOwnedJsonSnapshot(filename,{groupId:0,maxBytes:65536}):readRootOwnedMetadataSnapshot(filename,{groupId:0}));if(record.identity.uid!==0||record.identity.gid!==0||(record.identity.mode&0o7777)!==0o600)fail();return record;}
export function createOwnedSourceSecurityFiles({io=fs,readSnapshot=rootSnapshot,aclTool=spawnSync}={}){
 const sync=dir=>{const fd=io.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}};
 const acl=fd=>{const r=aclTool('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{encoding:'utf8',timeout:1000,maxBuffer:4096,stdio:['ignore','pipe','pipe',fd]});if(r.status!==0||r.error||r.stdout!==''||r.stderr!=='')fail();};
 const directory=target=>{if(!path.isAbsolute(target)||path.resolve(target)!==target)fail();let current='/';for(const part of target.split('/').filter(Boolean)){const next=path.join(current,part);try{io.mkdirSync(next,{mode:0o700});sync(current);}catch(e){if(e.code!=='EEXIST')throw e;}const s=io.lstatSync(next);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))fail();const fd=io.openSync(next,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{acl(fd);io.fsyncSync(fd);}finally{io.closeSync(fd);}sync(current);current=next;}if((io.lstatSync(target).mode&0o7777)!==0o700)fail();};
 const read=file=>{try{io.lstatSync(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}return readSnapshot(file).value;};
 const publish=(file,value)=>{const stage=file+'.pending',bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>2*1024*1024)fail();const current=read(file);if(current!==null){if(!same(current,value)||!io.readFileSync(file).equals(bytes))fail();const fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}sync(path.dirname(file));return;}const retained=read(stage);if(retained!==null){if(!same(retained,value)||!io.readFileSync(stage).equals(bytes))fail();const fd=io.openSync(stage,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}}
  else{let fd;try{fd=io.openSync(stage,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);io.fchownSync(fd,0,0);io.fchmodSync(fd,0o600);acl(fd);io.writeFileSync(fd,bytes);io.fsyncSync(fd);}finally{if(fd!==undefined)io.closeSync(fd);}sync(path.dirname(stage));}
  if(read(file)!==null)fail();io.renameSync(stage,file);sync(path.dirname(file));if(!same(read(file),value))fail();};
 return {directory,read,publish};
}
async function connectDefault(config,ssl){const {default:pg}=await import('pg');const client=new pg.Client({...config,ssl,application_name:'blackspire-owned-source-security',connectionTimeoutMillis:5000,query_timeout:35000,options:'-c statement_timeout=30000 -c lock_timeout=5000 -c timezone=UTC -c search_path=pg_catalog'});client.on('error',()=>{});try{await client.connect();return client;}catch{try{await client.end();}catch{}fail();}}
async function one(client,sql,key){const r=await client.query(sql);if(r.rows?.length!==1||!Object.hasOwn(r.rows[0],key))fail();return r.rows[0][key];}
export async function observeOwnedSourceIdentity(client,ownedProfile){const r=await client.query(OWNED_SOURCE_IDENTITY_SQL),v=r.rows?.[0];if(r.rows?.length!==1||!exact(v,['systemIdentifier','database','actor','session','creatorOid','databaseOwnerOid','superuser','bypassRls','recovery'])||v.database!=='postgres'||v.actor!=='postgres'||v.session!=='postgres'||!Number.isInteger(v.creatorOid)||v.creatorOid<=10||v.databaseOwnerOid!==v.creatorOid||v.superuser!==false||v.bypassRls!==true||v.recovery!==false||!/^[1-9][0-9]{0,19}$/.test(v.systemIdentifier??'')||v.systemIdentifier===ownedProfile.systemIdentifier)fail();return {sourceSystemIdentifier:v.systemIdentifier,sourceCreatorOid:v.creatorOid};}
export async function runOwnedSourceSecurity({mode,releaseSha,operationId},deps={}){
 if(!['prepare','apply','reconcile'].includes(mode)||!/^[a-f0-9]{40}$/.test(releaseSha??'')||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(operationId??'')||(deps.uid??process.getuid)()!==0)fail();
 const open=deps.openJournal??openReleaseJournal,global=(deps.openGlobal??openReleaseJournal)();let local,client;
 try{
  const db=deps.database??database,verify=deps.verifySource??verifyReleaseSource,stopped=deps.stopped??verifyOwnedBuyerMigrationQuiescence,readSnapshot=deps.readSnapshot??rootSnapshot,files=deps.files??createOwnedSourceSecurityFiles();
  verify(releaseSha);stopped();const profile=db.readOwnedDatabaseProfile(),profileDigest=db.databaseProfileDigest(profile),credential=readSnapshot(db.LEGACY_DATABASE_MANAGEMENT);
  const connection=db.validateManagementCredential(credential.value,{pinLegacyCa:true}),work=`${deps.root??OWNED_SOURCE_SECURITY_ROOT}/${operationId}`,configFile=work+'/configuration.json';files.directory(work);local=open({root:work});
  const fence=async()=>{verify(releaseSha);stopped();if(db.databaseProfileDigest(db.readOwnedDatabaseProfile())!==profileDigest||!same(readSnapshot(db.LEGACY_DATABASE_MANAGEMENT),credential))fail();};
  await fence();client=await (deps.connect??connectDefault)(connection,db.databaseTlsOptions(connection));
  let configuration=files.read(configFile),staged=files.read(configFile+'.pending');
  if(configuration&&staged&&!same(configuration,staged))fail();configuration??=staged;
  const prepare=deps.preparePackage??prepareOwnedSourceSecurityPackage;
  if(!configuration){
   if(mode!=='prepare'||local.stream('release').events().length)fail();let began=false;
   try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');began=true;await client.query("SET LOCAL search_path=pg_catalog;SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s'");
    const identity=await observeOwnedSourceIdentity(client,profile),baseline=await one(client,EXTENSION_ACL_CATALOG_SQL,'metadata'),effective=await one(client,OWNED_SOURCE_EFFECTIVE_SQL,'effective'),schemaEffective=await one(client,OWNED_SOURCE_SCHEMA_EFFECTIVE_SQL,'schemaEffective');
    const providerManifest=(deps.prepareProvider??prepareBuyerWriterExtensionAcl)({inventory:baseline,columns:baseline,effective:{effective,schemaEffective}}).manifest;
    const migrationVersion=(deps.now??(()=>new Date()))().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);if(!/^\d{14}$/.test(migrationVersion))fail();
    const collision=await client.query('SELECT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version=$1) AS present',[migrationVersion]);if(collision.rows?.length!==1||collision.rows[0].present!==false)fail();
    configuration={releaseSha,operationId,profileDigest,...identity,providerManifest,migrationVersion};const {migrationVersion:unused,...input}=configuration;prepare(input);await fence();await client.query('ROLLBACK');began=false;
   }finally{if(began)try{await client.query('ROLLBACK');}catch{}}
  }
  const {migrationVersion,...input}=configuration;if(!/^\d{14}$/.test(migrationVersion??'')||input.releaseSha!==releaseSha||input.operationId!==operationId||input.profileDigest!==profileDigest)fail();const {plan}=prepare(input);
  const identity=await observeOwnedSourceIdentity(client,profile);if(identity.sourceCreatorOid!==input.sourceCreatorOid||identity.sourceSystemIdentifier!==input.sourceSystemIdentifier)fail();
  if(mode==='prepare'){files.publish(configFile,configuration);await fence();return {status:'OWNED_SOURCE_SECURITY_PREPARED',releaseSha,operationId,profileDigest,manifestDigest:plan.manifestDigest,migrationVersion};}
  if(!files.read(configFile)||staged)fail();
  const executionFence=async()=>{await fence();if(!same(files.read(configFile),configuration))fail();};
  await executionFence();const result=await (deps.execute??executeOwnedSourceSecurity)({client,plan,mode,journal:local.stream('release'),migrationVersion,fence:executionFence});await executionFence();return result;
 }finally{try{await client?.end();}finally{try{local?.close();}finally{global.close();}}}
}
