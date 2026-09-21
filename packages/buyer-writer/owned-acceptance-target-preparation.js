import {verifyOwnedBuyerMigrationQuiescence} from './owned-migration-host.js';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {captureBuyerJobVersion} from './criteria.js';
import {readRootOwnedJsonSnapshot} from './protected-json.js';

export const OWNED_ACCEPTANCE_OWNER_FILE='/var/lib/blackspire-operator/preparation/writer-acceptance-owner.json';
export const OWNED_ACCEPTANCE_INTENT_FILE='/var/lib/blackspire-operator/preparation/owned-writer-acceptance-intent.json';
export const OWNED_ACCEPTANCE_TARGET_FILE='/var/lib/blackspire-operator/owned-writer-acceptance.json';
const MANAGEMENT='/etc/blackspire-buyer-writer-gateway/management.json';
const HOST='db.kchtrvfcixnimvxxctkj.supabase.co';
const fail=()=>{throw new Error('Buyer acceptance target preparation failed');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)
  &&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const fields=['state','county','property_type','date_range_start','date_range_end','min_purchases','cash_buyers_only','llc_buyers_only'];
const targetKeys=['backendProfile','profileDigest','schema','kind','releaseSha','workspace','principal','capability','jobId','ownerId','criteria','updatedAt'];
const identitySql=`select current_user='postgres' and session_user='postgres'
 and current_database()='postgres' and current_setting('server_version_num')::int between 170000 and 179999
 and (select rolbypassrls from pg_roles where rolname=current_user) as safe`;
const ownerSql=`select u.id::text as id from auth.users u where u.id=$1::uuid
 and deleted_at is null and (banned_until is null or banned_until<=now())
 and email_confirmed_at is not null
 and (raw_app_meta_data->>'blackspire_role' in ('admin','beta_tester')
 or (coalesce(raw_app_meta_data->>'blackspire_role','') not in ('admin','beta_tester','demo_viewer','client_only')
 and u.created_at is not null and not exists(select from auth.users other
 where other.id<>u.id and (other.created_at is null
 or date_trunc('milliseconds',other.created_at)<=date_trunc('milliseconds',u.created_at))))) for share of u`;
const targetIdentitySql=`select current_user='postgres' and session_user='postgres'
 and exists(select from pg_roles r join pg_database d on d.datdba=r.oid
 where r.rolname=current_user and not r.rolsuper and r.rolbypassrls and d.datname=current_database())
 and exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='SearchJob' and c.relowner=(select oid from pg_roles where rolname=current_user)
 and c.relrowsecurity and not c.relforcerowsecurity) as safe`;
const readSql=`select id::text as id,user_id::text as owner,
 jsonb_build_object('state',state,'county',county,'property_type',property_type,
 'date_range_start',date_range_start::text,'date_range_end',date_range_end::text,
 'min_purchases',min_purchases,'cash_buyers_only',cash_buyers_only,'llc_buyers_only',llc_buyers_only) as criteria,
 to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated,
 to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created,
 status,total_sales_analyzed,total_buyers_found,error_message
 from public."SearchJob" where id=$1::uuid for update`;
const insertSql=`insert into public."SearchJob"
 (id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,
 cash_buyers_only,llc_buyers_only,status,total_sales_analyzed,total_buyers_found,error_message,created_at,updated_at)
 values($1::uuid,$2::uuid,$3,$4,$5,$6::date,$7::date,$8::int,$9::boolean,$10::boolean,
 'pending',null,null,null,$11::timestamptz,$11::timestamptz)`;
const catalogSql=`select jsonb_build_object(
 'heap',c.relkind='r' and c.relpersistence='p' and am.amname='heap',
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',a.atttypid::int,
  'generated',a.attgenerated,'identity',a.attidentity) order by a.attnum)
  from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname),'[]'::jsonb)
  from pg_constraint k where k.conrelid=c.oid),
 'noEffects',not exists(select from pg_rewrite where ev_class=c.oid)
  and not exists(select from pg_trigger where tgrelid=c.oid and (tgtype::int & 4)<>0)
  and not exists(select from pg_inherits where inhrelid=c.oid or inhparent=c.oid)
  and not exists(select from pg_index i join pg_class ix on ix.oid=i.indexrelid
   join pg_am iam on iam.oid=ix.relam where i.indrelid=c.oid and
   (i.indexprs is not null or i.indpred is not null or iam.amname<>'btree'
    or exists(select from unnest(i.indclass) o(oid) join pg_opclass op on op.oid=o.oid
      join pg_namespace n on n.oid=op.opcnamespace where n.nspname<>'pg_catalog')
    or exists(select from unnest(i.indcollation) o(oid) join pg_collation co on co.oid=o.oid
      join pg_namespace n on n.oid=co.collnamespace where n.nspname<>'pg_catalog')))
 ) as proof from pg_class c join pg_namespace n on n.oid=c.relnamespace
 join pg_am am on am.oid=c.relam where n.nspname='public' and c.relname='SearchJob'`;
const columnTypes={id:2950,user_id:2950,state:25,county:25,property_type:25,
 date_range_start:1082,date_range_end:1082,min_purchases:23,cash_buyers_only:16,
 llc_buyers_only:16,status:25,total_sales_analyzed:23,total_buyers_found:23,
 error_message:25,created_at:1184,updated_at:1184};
export function validateOwnedBuyerAcceptanceCatalog(value){
 if(!value||value.heap!==true||value.noEffects!==true||!Array.isArray(value.columns)
  ||value.columns.length!==Object.keys(columnTypes).length
  ||new Set(value.columns.map(c=>c.name)).size!==value.columns.length
  ||value.columns.some(c=>columnTypes[c.name]!==c.type||c.generated!==''||c.identity!=='')
  ||!Array.isArray(value.constraints))fail();
 const definitions=value.constraints.map(c=>typeof c==='string'?c.replace(/\s+/g,''):null);
 const primary='PRIMARYKEY(id)',status="CHECK((status=ANY(ARRAY['pending'::text,'processing'::text,'completed'::text,'failed'::text])))";
 if(definitions.filter(c=>c===primary).length!==1
  ||definitions.some(c=>c!==primary&&c!==status)||definitions.filter(c=>c===status).length>1)fail();
}
export const OWNED_ACCEPTANCE_PREPARATION_SQL=Object.freeze({identity:identitySql,targetIdentity:targetIdentitySql,owner:ownerSql,read:readSql,insert:insertSql,catalog:catalogSql});
function ownerInput(v){
 if(!exact(v,['schema','kind','ownerId','criteria'])||v.schema!==1
  ||v.kind!=='zola_acceptance_owner'||!uuid(v.ownerId)||!exact(v.criteria,fields))fail();
 const criteria=captureBuyerJobVersion({...v.criteria,updated_at:null}).criteria;
 // Deliberately synthetic geography prevents this pending fixture from looking
 // like a customer search. No provider dispatch is performed by this command.
 if(criteria.county!=='Zola Acceptance'||criteria.property_type!=='acceptance')fail();
 return {ownerId:v.ownerId,criteria};
}
function target(v,releaseSha,owner,profileDigest){
 if(!exact(v,targetKeys)||v.schema!==1||v.kind!=='zola_owned_bounded_writer_acceptance_target'||v.backendProfile!=='owned-postgres-v1'||v.profileDigest!==profileDigest
  ||v.releaseSha!==releaseSha||v.workspace!=='blackspire-command'
  ||v.principal!=='blackspire-release-root'||v.capability!=='buyer.writer.acceptance'
  ||!uuid(v.jobId)||v.ownerId!==owner.ownerId||!exact(v.criteria,fields)
  ||!same(captureBuyerJobVersion({...v.criteria,updated_at:v.updatedAt}).criteria,owner.criteria)
  ||typeof v.updatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v.updatedAt))fail();
 return v;
}
function matchesRow(row,v){
 if(!row||row.id!==v.jobId||row.owner!==v.ownerId||row.updated!==v.updatedAt
  ||row.created!==v.updatedAt||row.status!=='pending'||row.total_sales_analyzed!==null
  ||row.total_buyers_found!==null||row.error_message!==null||!exact(row.criteria,fields))fail();
 if(!same(captureBuyerJobVersion({...row.criteria,updated_at:row.updated}).criteria,v.criteria))fail();
}
function rootRecord(snapshot){
 if(snapshot.identity.uid!==0||snapshot.identity.gid!==0
  ||(snapshot.identity.mode&0o7777)!==0o600)fail();
 return snapshot.value;
}
function exists(io,name){try{io.lstatSync(name);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function safeParents(io,name){
 let current='/';for(const part of ['',...path.dirname(name).split('/').filter(Boolean)]){
  if(part)current=path.join(current,part);const s=io.lstatSync(current);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0)fail();
 }
}
function syncDir(io,name){
 const fd=io.openSync(path.dirname(name),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{io.fsyncSync(fd);}finally{io.closeSync(fd);}
}
function aclFree(run,args,stdio=['ignore','pipe','pipe']){
 const r=run('/usr/bin/getfacl',args,{encoding:'utf8',stdio,timeout:1000,maxBuffer:4096,
  env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
 if(r.status!==0||r.error||r.signal||r.stdout!==''||r.stderr!=='')fail();
}
// Atomic rename is protected by the host flock and root-only ancestors. A
// surviving complete stage is reconciled; a torn stage is retained fail-closed.
// Never unlink a durable intent, target or unknown staging inode.
function syncValidatedFile(io,name,snapshot){
 const fd=io.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const stat=io.fstatSync(fd);for(const key of ['uid','gid','mode','nlink','size','dev','ino','mtimeMs','ctimeMs'])if(stat[key]!==snapshot.identity[key])fail();io.fsyncSync(fd);}
 finally{io.closeSync(fd);}
}
function publish(name,value,gid,{io,run,read}){
 const stage=name+'.stage',bytes=Buffer.from(JSON.stringify(value)+'\n');
 safeParents(io,name);
 aclFree(run,['--numeric','--omit-header','--skip-base','--default','--logical','--',path.dirname(name)]);
 if(exists(io,name)){
  if(exists(io,stage))fail();
  const found=read(name,gid);if(!same(found.value,value)||found.identity.gid!==gid
   ||(found.identity.mode&0o7777)!==(gid===0?0o600:0o640))fail();syncValidatedFile(io,name,found);syncDir(io,name);return;
 }
 if(exists(io,stage)){
  const found=read(stage,gid);if(!same(found.value,value)||found.identity.gid!==gid
   ||(found.identity.mode&0o7777)!==(gid===0?0o600:0o640))fail();syncValidatedFile(io,stage,found);
 }else{
  let fd;
  try{
   fd=io.openSync(stage,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   io.fchownSync(fd,0,gid);io.fchmodSync(fd,gid===0?0o600:0o640);
   aclFree(run,['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],['ignore','pipe','pipe',fd]);
   let offset=0;while(offset<bytes.length){const n=io.writeSync(fd,bytes,offset,bytes.length-offset);if(n<1)fail();offset+=n;}
   io.fsyncSync(fd);
  }finally{if(fd!==undefined)io.closeSync(fd);}
  if(!same(read(stage,gid).value,value))fail();
 }
 if(exists(io,name))fail();
 io.renameSync(stage,name);syncDir(io,name);
 if(!same(read(name,gid).value,value))fail();
}
function hostLock({io,run}){
 const name=OWNED_ACCEPTANCE_INTENT_FILE+'.lock';safeParents(io,name);
 const fd=io.openSync(name,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK,0o600);
 try{
  const s=io.fstatSync(fd);
  if(!s.isFile()||s.uid!==0||s.gid!==0||s.nlink!==1||(s.mode&0o7777)!==0o600)fail();
  aclFree(run,['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],['ignore','pipe','pipe',fd]);
  const r=run('/usr/bin/flock',['--exclusive','--nonblock','3'],{
   stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:1000,env:{PATH:'/usr/bin:/bin'}});
  if(r.status!==0||r.error||r.signal||r.stdout!==''||r.stderr!=='')fail();
  return ()=>io.closeSync(fd);
 }catch{io.closeSync(fd);fail();}
}
export async function prepareOwnedBuyerAcceptanceTarget({releaseSha,credentialGroupId},deps={}){
 const {io=fs,run=spawnSync,readSnapshot=readRootOwnedJsonSnapshot,connect,
  getuid=process.getuid,now=()=>new Date().toISOString(),newId=randomUUID}=deps;
 let closeLock,client,ownerClient;
 try{
  if(getuid?.()!==0||! /^[a-f0-9]{40}$/.test(releaseSha??'')
   ||!Number.isInteger(credentialGroupId)||credentialGroupId<1||typeof connect!=='function')fail();
  const database=deps.database??await import('./database-profile.js');
  const profile=database.readOwnedDatabaseProfile(),profileDigest=database.databaseProfileDigest(profile);
  const read=(name,gid=0)=>readSnapshot(name,{groupId:gid,maxBytes:32768,io,aclTool:run});
  closeLock=hostLock({io,run});verifyOwnedBuyerMigrationQuiescence({run,io});
  const ownerSnapshot=read(OWNED_ACCEPTANCE_OWNER_FILE),owner=ownerInput(rootRecord(ownerSnapshot));
  const managementSnapshot=read(MANAGEMENT),management=rootRecord(managementSnapshot);
  const sourceConnection=database.validateManagementCredential(management,{pinLegacyCa:true});
  const ownedSnapshot=read(database.OWNED_DATABASE_MANAGEMENT),ownedManagement=rootRecord(ownedSnapshot);
  const targetConnection=database.validateManagementCredential(ownedManagement,{ownedProfile:profile});
  let reserved;
  if(exists(io,OWNED_ACCEPTANCE_INTENT_FILE))reserved=rootRecord(read(OWNED_ACCEPTANCE_INTENT_FILE));
  else if(exists(io,OWNED_ACCEPTANCE_INTENT_FILE+'.stage'))reserved=rootRecord(read(OWNED_ACCEPTANCE_INTENT_FILE+'.stage'));
  else{
   if(exists(io,OWNED_ACCEPTANCE_TARGET_FILE)||exists(io,OWNED_ACCEPTANCE_TARGET_FILE+'.stage'))fail();
   reserved={backendProfile:'owned-postgres-v1',profileDigest,schema:1,kind:'zola_owned_bounded_writer_acceptance_target',releaseSha,
    workspace:'blackspire-command',principal:'blackspire-release-root',capability:'buyer.writer.acceptance',
    jobId:newId(),ownerId:owner.ownerId,criteria:owner.criteria,updatedAt:now().replace(/\.(\d{3})Z$/,'.$1000Z')};
  }
  target(reserved,releaseSha,owner,profileDigest);
  publish(OWNED_ACCEPTANCE_INTENT_FILE,reserved,0,{io,run,read});
  // The UUID is now durable. Every retry observes only this exact UUID and must
  // take the same database lock before interpreting absence after a lost commit.
  ownerClient=await connect(sourceConnection,database.databaseTlsOptions(sourceConnection));
  client=await connect(targetConnection,database.databaseTlsOptions(targetConnection));
  await database.verifyOwnedDatabaseIdentity(client,profile);
  const identity=await ownerClient.query(identitySql,[]);
  if(identity.rows?.length!==1||identity.rows[0]?.safe!==true)fail();
  await ownerClient.query('begin',[]);
  await client.query('begin',[]);
  await client.query('select pg_advisory_xact_lock(206994,128)',[]);
  await client.query('lock table public."SearchJob" in share row exclusive mode',[]);
  const targetAuthority=await client.query(targetIdentitySql,[]);
  if(targetAuthority.rows?.length!==1||targetAuthority.rows[0]?.safe!==true)fail();
  const catalog=await client.query(catalogSql,[]);
  if(catalog.rows?.length!==1)fail();validateOwnedBuyerAcceptanceCatalog(catalog.rows[0]?.proof);
  const verifiedOwner=await ownerClient.query(ownerSql,[owner.ownerId]);
  if(verifiedOwner.rows?.length!==1||verifiedOwner.rows[0].id!==owner.ownerId)fail();
  if(!same(read(OWNED_ACCEPTANCE_OWNER_FILE),ownerSnapshot)||!same(read(MANAGEMENT),managementSnapshot))fail();
  let observed=await client.query(readSql,[reserved.jobId]);
  if(!Array.isArray(observed.rows)||observed.rows.length>1)fail();
  if(observed.rows.length===0){
   // An installed target means this job previously existed: never recreate a
   // deleted acceptance job or overwrite a consumed acceptance version.
   if(exists(io,OWNED_ACCEPTANCE_TARGET_FILE)||exists(io,OWNED_ACCEPTANCE_TARGET_FILE+'.stage'))fail();
   const c=reserved.criteria;
   const inserted=await client.query(insertSql,[reserved.jobId,reserved.ownerId,...fields.map(k=>c[k]),reserved.updatedAt]);
   if(inserted.rowCount!==1)fail();
   observed=await client.query(readSql,[reserved.jobId]);
  }
  if(observed.rows?.length!==1)fail();matchesRow(observed.rows[0],reserved);
  verifyOwnedBuyerMigrationQuiescence({run,io});
  const currentOwner=await ownerClient.query(ownerSql,[owner.ownerId]);if(currentOwner.rows?.length!==1||currentOwner.rows[0].id!==owner.ownerId)fail();
  await database.verifyOwnedDatabaseIdentity(client,profile);
  if(database.databaseProfileDigest(database.readOwnedDatabaseProfile())!==profileDigest||!same(read(database.OWNED_DATABASE_MANAGEMENT),ownedSnapshot))fail();
  await client.query('commit',[]);
  // A thrown/lost COMMIT response cannot reach publication. The durable intent
  // and database lock make the next invocation a reconciliation, not a new job.
  if(!same(read(OWNED_ACCEPTANCE_OWNER_FILE),ownerSnapshot)||!same(read(MANAGEMENT),managementSnapshot))fail();
  verifyOwnedBuyerMigrationQuiescence({run,io});
  if(database.databaseProfileDigest(database.readOwnedDatabaseProfile())!==profileDigest||!same(read(database.OWNED_DATABASE_MANAGEMENT),ownedSnapshot))fail();
  await database.verifyOwnedDatabaseIdentity(client,profile);
  publish(OWNED_ACCEPTANCE_TARGET_FILE,reserved,credentialGroupId,{io,run,read});
  return Object.freeze({status:'OWNED_BUYER_ACCEPTANCE_TARGET_PREPARED',releaseSha,profileDigest,
   dedicatedJobVerified:true,ownerVerified:true,paidProviderCalls:0});
 }catch{try{await client?.query('rollback',[]);}catch{}fail();}
 finally{try{await ownerClient?.query('rollback',[]);}catch{}try{await ownerClient?.end();}catch{}try{await client?.end();}catch{}closeLock?.();}
}
