import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readRootOwnedJsonSnapshot} from './protected-json.js';
import {prepareOwnedBuyerMigrationExecution,executeOwnedBuyerMigration,OWNED_BUYER_RELATIONS} from './owned-data-migration.js';
import {prepareOwnedBuyerSchema} from './owned-schema.js';
import {holdOwnedBuyerSourceSnapshot,inspectOwnedBuyerDataSnapshot,transferOwnedBuyerRelation} from './owned-data-copy-postgres.js';

export const OWNED_MIGRATION_ROOT='/var/lib/blackspire-operator/owned-buyer-migration';
const baseline=JSON.parse(fs.readFileSync(new URL('./owned-source-schema.json',import.meta.url)));
const catalogSql=fs.readFileSync(new URL('./owned-source-catalog.sql',import.meta.url),'utf8');
const reject=()=>{throw new Error('Owned Buyer migration host rejected');};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const uuid=v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v??'');
const sourceStructure=catalog=>({relations:catalog.relations.map(({acl,policies,...relation})=>relation),authUid:catalog.authUid});
const sourceStructureDigest=digest(sourceStructure(baseline));
const targetStructure=catalog=>catalog.relations;
const targetStructureDigest=digest(targetStructure(baseline));
export const OWNED_COPY_RECEIPT_SQL=`SELECT receipt FROM owned_buyer_migration.copy_receipts WHERE operation_id=$1`;
function rootRecord(filename){
 const value=readRootOwnedJsonSnapshot(filename,{groupId:0,maxBytes:4*1024*1024});
 if(value.identity.uid!==0||value.identity.gid!==0||(value.identity.mode&0o7777)!==0o600)reject();return value.value;
}
function directory(filename){
 let current='/';for(const part of filename.split('/').filter(Boolean)){
  current=path.join(current,part);try{fs.mkdirSync(current,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=fs.lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)reject();
 }
}
function publish(filename,value){
 const bytes=JSON.stringify(value)+'\n';let fd;
 try{fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
 }finally{if(fd!==undefined)fs.closeSync(fd);}
 const parent=fs.openSync(path.dirname(filename),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
}
function retained(filename){try{fs.lstatSync(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}return rootRecord(filename);}
export function verifyOwnedBuyerMigrationQuiescence({run=spawnSync,io=fs}={}){
 const units=['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-writer-gateway.service','blackspire-buyer-store.service'];
 for(const unit of units){
  const r=run('/usr/bin/systemctl',['show',unit,'-p','LoadState','-p','ActiveState','-p','SubState','-p','MainPID'],{encoding:'utf8',timeout:3000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  if(r.status!==0||r.stderr!==''||r.error||r.signal)reject();
  const lines=r.stdout.trim().split('\n'),fields=Object.fromEntries(lines.map(v=>v.split('=')));
  if(lines.length!==4||Object.keys(fields).sort().join(',')!=='ActiveState,LoadState,MainPID,SubState'||fields.ActiveState!=='inactive'||fields.SubState!=='dead'||fields.MainPID!=='0')reject();
  if(fields.LoadState==='loaded')continue;
  if(unit!=='blackspire-buyer-store.service'||fields.LoadState!=='not-found')reject();
  // An absent optional unit is safe only with a complete process-identity scan.
  const passwd=run('/usr/bin/getent',['passwd','blackspire-buyer-store'],{encoding:'utf8',timeout:3000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  if(passwd.error||passwd.signal||passwd.stderr!==''||![0,2].includes(passwd.status))reject();
  let uid=null;
  if(passwd.status===0){const row=passwd.stdout.trim().split(':');if(row.length!==7||row[0]!=='blackspire-buyer-store'||!/^\d+$/.test(row[2]))reject();uid=row[2];}
  else if(passwd.stdout!=='')reject();
  for(const pid of io.readdirSync('/proc').filter(v=>/^\d+$/.test(v))){
   let status,command;
   try{status=io.readFileSync(`/proc/${pid}/status`,'utf8');command=io.readFileSync(`/proc/${pid}/cmdline`,'utf8');}
   catch(error){if(error.code==='ENOENT')continue;reject();}
   const ids=status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m);if(!ids)reject();
   if((uid!==null&&ids.slice(1).includes(uid))||command.includes('buyer-store'))reject();
  }
 }
}
async function connectDefault(config,ssl){
 const {default:pg}=await import('pg');const client=new pg.Client({...config,ssl,
  application_name:'blackspire-owned-buyer-migration',connectionTimeoutMillis:5000,query_timeout:35000,
  options:'-c statement_timeout=30000 -c lock_timeout=5000 -c timezone=UTC -c search_path=pg_catalog'});
 client.on('error',()=>{});try{await client.connect();return client;}catch{try{await client.end();}catch{}reject();}
}
async function catalog(client){await client.query("SET LOCAL search_path=pg_catalog,public");try{const result=await client.query(catalogSql);if(result.rows?.length!==1)reject();return result.rows[0].metadata;}finally{await client.query("SET LOCAL search_path=pg_catalog");}}
async function assertTargetInert(client){
 const r=await client.query(`SELECT NOT EXISTS(SELECT FROM pg_roles WHERE rolcanlogin AND rolname NOT IN('postgres','blackspire_cluster_admin'))
 AND NOT EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend') AS inert`);
 if(r.rows?.length!==1||r.rows[0].inert!==true)reject();
}
function sourceProof(proof,{releaseSha,operationId,profileDigest}){
 if(proof?.kind!=='owned-buyer-source-security-proof-v1'||proof.status!=='OWNED_SOURCE_SECURITY_VERIFIED'
  ||proof.releaseSha!==releaseSha||proof.operationId!==operationId||proof.profileDigest!==profileDigest
  ||proof.sourceWritesDenied!==true||proof.sourceBrowserSecurityVerified!==true||proof.sourceProviderAclChanged!==false)reject();return proof;
}

// Production paths are fixed; test substitutes are explicit dependency injection.
// No business process startup, credential creation or source grant mutation here.
export async function runOwnedBuyerMigration(input,deps={}){
 const open=deps.openReleaseGuard??(await import('../zola-release/commander-journal.js')).openReleaseJournal;
 const guard=open();
 try{return await runOwnedBuyerMigrationLocked(input,deps);}finally{guard.close();}
}
async function runOwnedBuyerMigrationLocked({releaseSha,operationId,mode},deps={}){
 if(!/^[a-f0-9]{40}$/.test(releaseSha??'')||!uuid(operationId)||!['apply','reconcile'].includes(mode)||(deps.uid??process.getuid)()!==0)reject();
 const db=deps.database??await import('./database-profile.js');
 const security=deps.security??await import('./owned-source-security.js');
 const read=deps.read??rootRecord,put=deps.publish??publish,get=deps.retained??retained,makeDir=deps.directory??directory;
 const stopped=deps.stopped??verifyOwnedBuyerMigrationQuiescence,connect=(config)=>(deps.connect??connectDefault)(config,db.databaseTlsOptions(config));
 const verifySource=deps.verifySource??(await import('../zola-release/commander-host.js')).verifyReleaseSource;
 verifySource(releaseSha);stopped();
 const profile=db.readOwnedDatabaseProfile(),profileDigest=db.databaseProfileDigest(profile);
 const configPath=`/var/lib/blackspire-operator/owned-source-security/${operationId}/configuration.json`;
 const configuration=read(configPath),{migrationVersion,...sourceInput}=configuration;
 if(!/^\d{14}$/.test(migrationVersion??'')||sourceInput.releaseSha!==releaseSha||sourceInput.operationId!==operationId||sourceInput.profileDigest!==profileDigest)reject();
 const sourcePlan=security.prepareOwnedSourceSecurityPackage(sourceInput).plan;
 const sourceCredential=db.validateManagementCredential(read(db.LEGACY_DATABASE_MANAGEMENT),{pinLegacyCa:true});
 const targetCredential=db.validateManagementCredential(read(db.OWNED_DATABASE_MANAGEMENT),{ownedProfile:profile});
 const work=`${OWNED_MIGRATION_ROOT}/${operationId}`;makeDir(work);
 let source,target,sourceHeld=false;
 try{
  source=await connect(sourceCredential);target=await connect(targetCredential);
  await db.verifyOwnedDatabaseIdentity(target,profile);
  const system=await source.query('SELECT (pg_control_system()).system_identifier::text AS id');
  if(system.rows?.length!==1||system.rows[0].id!==sourceInput.sourceSystemIdentifier||system.rows[0].id===profile.systemIdentifier)reject();
  const lock=await target.query('SELECT pg_try_advisory_lock(206994,130) AS acquired');if(lock.rows?.[0]?.acquired!==true)reject();
  await assertTargetInert(target);
  sourceProof(await security.observeOwnedSourceSecurity(source,sourcePlan,migrationVersion),{releaseSha,operationId,profileDigest});
  const sourceLock=await source.query('SELECT pg_try_advisory_lock(206994,126) AS acquired');if(sourceLock.rows?.[0]?.acquired!==true)reject();
  const prior=get(`${work}/manifest.json`);let input;
  if(prior){input=prior;if(input.releaseSha!==releaseSha||input.target.profileDigest!==profileDigest||input.source.clusterId!==system.rows[0].id)reject();}
  else{
   if(mode==='reconcile')reject();
   const proof=sourceProof(await security.observeOwnedSourceSecurity(source,sourcePlan,migrationVersion),{releaseSha,operationId,profileDigest});
   await holdOwnedBuyerSourceSnapshot(source);sourceHeld=true;
   const heldProof=sourceProof(await security.validateOwnedSourceSecurityInTransaction(source,sourcePlan,migrationVersion),{releaseSha,operationId,profileDigest});
   if(digest(heldProof)!==digest(proof))reject();
   if(digest(sourceStructure(await catalog(source)))!==sourceStructureDigest)reject();
   const data=await inspectOwnedBuyerDataSnapshot(source);
   const inventory={relations:baseline.relations.map(relation=>{const row=data.find(v=>v.name===relation.name);return{schema:'public',name:relation.name,owner:'postgres',rls:true,forceRls:false,primaryKey:['id'],rowCount:row.rowCount,dataDigest:row.dataDigest,definitionDigest:digest(relation)};}),
    foreignKeys:baseline.relations.flatMap(r=>r.constraints.filter(c=>c.type==='f').map(c=>({name:c.name,from:r.name,to:c.definition.includes('"BuyerProfile"')?'BuyerProfile':'SearchJob',columns:[c.definition.match(/^FOREIGN KEY \((\w+)\)/)[1]],referencedColumns:['id'],onDelete:c.definition.endsWith('ON DELETE CASCADE')?'CASCADE':'NO ACTION',definitionDigest:digest(c)}))),
    dependencies:[{kind:'function',identity:'auth.uid()',definitionDigest:digest(baseline.authUid)}],schemaDigest:digest(baseline)};
   const backup={schema:1,kind:'owned-source-retained-rollback-v1',releaseSha,operationId,sourceSystemIdentifier:system.rows[0].id,sourceSnapshotDigest:digest(data),sourceSecurityManifestDigest:proof.manifestDigest,sourceCatalogDigest:sourceStructureDigest,sourcePreserved:true,targetWritesEnabled:false,reverseMigrationRequiredAfterTargetWrites:true};
   const priorBackup=get(`${work}/rollback.json`);if(priorBackup&&digest(priorBackup)!==digest(backup))reject();if(!priorBackup)put(`${work}/rollback.json`,backup);
   input={releaseSha,source:{clusterId:system.rows[0].id,database:'postgres',snapshotId:(await source.query('SELECT pg_export_snapshot() AS id')).rows[0].id,snapshotDigest:digest(data),quiescenceDigest:digest(proof)},
    target:{kind:'owned-postgres-v1',clusterId:profile.systemIdentifier,database:'postgres',profileDigest,schemaDigest:inventory.schemaDigest},inventory,rollbackDigest:digest(backup)};
   put(`${work}/manifest.json`,input);
  }
  const plan=prepareOwnedBuyerMigrationExecution(input);
  const host={
   async acquireFence(){stopped();await db.verifyOwnedDatabaseIdentity(target,profile);await assertTargetInert(target);},
   async releaseFence(){},
   async observe(){stopped();if(!sourceHeld)reject();await db.verifyOwnedDatabaseIdentity(target,profile);await assertTargetInert(target);
    const proof=sourceProof(await security.validateOwnedSourceSecurityInTransaction(source,sourcePlan,migrationVersion),{releaseSha,operationId,profileDigest});
    if(digest(proof)!==input.source.quiescenceDigest||digest(sourceStructure(await catalog(source)))!==sourceStructureDigest)reject();
    if(digest(read(configPath))!==digest(configuration)||db.databaseProfileDigest(db.readOwnedDatabaseProfile())!==profileDigest)reject();
    const {releaseSha:ignored,...rest}=input;return{...rest,soleWriter:'NONE',sourceWritesDisabled:true,destinationWritesDisabled:true};},
   async readIntent(){return get(`${work}/intent.json`);},async writeIntent(value){put(`${work}/intent.json`,value);},
   async readReceipt(){const exists=await target.query("SELECT to_regclass('owned_buyer_migration.copy_receipts') IS NOT NULL AS exists");if(!exists.rows[0].exists)return null;
    const value=await target.query(OWNED_COPY_RECEIPT_SQL,[operationId]);if(value.rows.length>1)reject();return value.rows[0]?.receipt??null;},
   async begin(){await target.query("BEGIN;SET LOCAL timezone='UTC';SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s'");},
   async copyRelation(relation){const columns=baseline.relations.find(r=>r.name===relation.name).columns.map(c=>({name:c.name,type:c.type,required:c.notNull,generated:c.generated,identity:c.identity}));await transferOwnedBuyerRelation({source,target,name:relation.name,expected:relation,columns});},
   async verifyTarget(expected,{empty=false,committed=false}={}){
    if(committed)await target.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
    if(empty){const value=await target.query("SELECT NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') AND NOT EXISTS(SELECT FROM pg_namespace WHERE nspname IN('auth','owned_buyer_migration')) AS empty");if(value.rows[0]?.empty!==true)reject();
     await target.query(prepareOwnedBuyerSchema(baseline).body);
     await target.query('CREATE SCHEMA owned_buyer_migration AUTHORIZATION postgres;REVOKE ALL ON SCHEMA owned_buyer_migration FROM PUBLIC;CREATE TABLE owned_buyer_migration.copy_receipts(operation_id uuid PRIMARY KEY,receipt jsonb NOT NULL);REVOKE ALL ON TABLE owned_buyer_migration.copy_receipts FROM PUBLIC,anon,authenticated,service_role');return;}
    if(digest(targetStructure(await catalog(target)))!==targetStructureDigest)reject();
    const values=await inspectOwnedBuyerDataSnapshot(target);
    if(!expected.relations.every(row=>{const value=values.find(v=>v.name===row.name);return value&&value.rowCount===row.rowCount&&value.dataDigest===row.dataDigest;}))reject();
    }finally{if(committed)await target.query('ROLLBACK');}
   },
   async writeReceipt(value){const inserted=await target.query('INSERT INTO owned_buyer_migration.copy_receipts(operation_id,receipt) VALUES($1,$2::jsonb)',[operationId,JSON.stringify(value)]);if(inserted.rowCount!==1)reject();},
   async commit(){await target.query('COMMIT');},async rollback(){await target.query('ROLLBACK');},
  };
  const result=await executeOwnedBuyerMigration({plan,host,mode});
  // Retained native receipt remains authoritative if this final local write has
  // an unknown outcome. No target/source writer is enabled by this result.
  if(result.status!=='OWNED_BUYER_DATA_OUTCOME_UNKNOWN'&&!get(`${work}/result.json`))put(`${work}/result.json`,result);
  return result;
 }catch{throw new Error('Owned Buyer migration stopped; retain operation and reconcile');}
 finally{
  if(sourceHeld)try{await source.query('ROLLBACK');}catch{}
  if(source)try{await source.query('SELECT pg_advisory_unlock(206994,126)');}catch{}
  if(target)try{await target.query('SELECT pg_advisory_unlock(206994,130)');}catch{}
  for(const client of [source,target])try{await client?.end();}catch{}
 }
}
