import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareOwnedBuyerAcceptanceTarget,OWNED_ACCEPTANCE_PREPARATION_SQL as sql,
 OWNED_ACCEPTANCE_OWNER_FILE as OWNER,OWNED_ACCEPTANCE_INTENT_FILE as INTENT,
 OWNED_ACCEPTANCE_TARGET_FILE as TARGET} from '../packages/buyer-writer/owned-acceptance-target-preparation.js';
const releaseSha='a'.repeat(40),ownerId='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222';
const input={releaseSha,credentialGroupId:1234};
const ownedManagement='/etc/blackspire/owned-postgres/management.json',profileDigest='c'.repeat(64);
const criteria={state:'NC',county:'Zola Acceptance',property_type:'acceptance',date_range_start:'2026-01-01',date_range_end:'2026-01-02',min_purchases:1,cash_buyers_only:false,llc_buyers_only:false};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acceptance-prep-'));fs.chmodSync(root,0o700);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const map=v=>typeof v==='string'&&v.startsWith('/')?path.join(root,v):v;
 for(const name of [OWNER,INTENT,TARGET,ownedManagement,'/etc/blackspire-buyer-writer-gateway/management.json'])fs.mkdirSync(path.dirname(map(name)),{recursive:true,mode:0o700});
 const io={...fs};for(const key of ['lstatSync','openSync','renameSync'])io[key]=(...args)=>fs[key](...args.map((a,i)=>i===0||key==='renameSync'&&i===1?map(a):a));
 const write=(name,v)=>fs.writeFileSync(map(name),JSON.stringify(v)+'\n',{mode:0o600});
 write(OWNER,{schema:1,kind:'zola_acceptance_owner',ownerId,criteria});
 write('/etc/blackspire-buyer-writer-gateway/management.json',{host:'db.kchtrvfcixnimvxxctkj.supabase.co',password:'fixture-only',ca:'-----BEGIN CERTIFICATE-----\nfixture-only'});
 write(ownedManagement,{host:'127.0.0.1',password:'fixture-only',ca:'-----BEGIN CERTIFICATE-----\nfixture-only'});
 let row=null,inserts=0,connections=0,ids=0,loseCommit=false,denyOwner=false,unsafeCatalog=false,active=false;
 const run=(cmd,args,options)=>cmd==='/usr/bin/systemctl'?{status:0,stderr:'',stdout:`LoadState=loaded\nActiveState=${active?'active':'inactive'}\nSubState=dead\nMainPID=0\n`}:spawnSync(cmd,args.map(v=>typeof v==='string'&&v.startsWith('/')&&!v.startsWith('/proc/')?map(v):v),options);
 const connect=async connection=>{connections++;return {fixtureSide:connection.fixtureSide,async query(text,values){
  if(text===sql.owner)assert.equal(connection.fixtureSide,'source');
  if(text===sql.insert||text===sql.read||text===sql.catalog)assert.equal(connection.fixtureSide,'target');
  if(text===sql.identity)return {rows:[{safe:true}]};
  if(text===sql.catalog)return {rows:[{proof:{heap:true,noEffects:!unsafeCatalog,columns:Object.entries({id:2950,user_id:2950,state:25,county:25,property_type:25,date_range_start:1082,date_range_end:1082,min_purchases:23,cash_buyers_only:16,llc_buyers_only:16,status:25,total_sales_analyzed:23,total_buyers_found:23,error_message:25,created_at:1184,updated_at:1184}).map(([name,type])=>({name,type,generated:'',identity:''})),constraints:['PRIMARY KEY (id)']}}]};
  if(text===sql.owner)return {rows:denyOwner?[]:[{id:ownerId}]};
  if(text===sql.read)return {rows:row?[structuredClone(row)]:[]};
  if(text===sql.insert){
   assert.equal(values[0],jobId);assert.equal(values[1],ownerId);assert.equal(row,null);inserts++;
   row={id:jobId,owner:ownerId,criteria:structuredClone(criteria),created:values[10],updated:values[10],status:'pending',total_sales_analyzed:null,total_buyers_found:null,error_message:null};
   return {rowCount:1};
  }
  if(text==='commit'&&loseCommit){loseCommit=false;throw new Error('private connection information');}
  assert.ok(['begin','commit','rollback','select pg_advisory_xact_lock(206994,128)','lock table public."SearchJob" in share row exclusive mode'].includes(text));return {rows:[]};
 },async end(){}};};
 const database={OWNED_DATABASE_MANAGEMENT:ownedManagement,readOwnedDatabaseProfile:()=>({fixture:true}),databaseProfileDigest:()=>profileDigest,validateManagementCredential:v=>({fixtureSide:v.host==='127.0.0.1'?'target':'source'}),databaseTlsOptions:()=>({fixture:true}),verifyOwnedDatabaseIdentity:async c=>assert.equal(c.fixtureSide,'target')};
 const deps={database,io,run,connect,getuid:()=>0,newId:()=>{ids++;return jobId;},now:()=> '2026-09-21T10:20:30.123Z'};
 return {deps,map,write,get row(){return row;},set row(v){row=v;},get inserts(){return inserts;},get ids(){return ids;},get connections(){return connections;},loseCommit(){loseCommit=true;},denyOwner(){denyOwner=true;},unsafeCatalog(){unsafeCatalog=true;},active(){active=true;}};
}
const options={skip:process.getuid?.()!==0};
test('creates exactly one dedicated job, preserves six-digit revision and reconciles without insertion',options,async t=>{
 const f=fixture(t);assert.equal((await prepareOwnedBuyerAcceptanceTarget(input,f.deps)).status,'OWNED_BUYER_ACCEPTANCE_TARGET_PREPARED');
 const target=JSON.parse(fs.readFileSync(f.map(TARGET)));assert.equal(target.updatedAt,'2026-09-21T10:20:30.123000Z');
 assert.deepEqual(target.criteria,criteria);assert.equal(target.workspace,'blackspire-command');assert.equal(target.principal,'blackspire-release-root');
 assert.equal(fs.statSync(f.map(INTENT)).mode&0o777,0o600);assert.equal(fs.statSync(f.map(TARGET)).mode&0o777,0o640);
 assert.equal(fs.statSync(f.map(TARGET)).gid,1234);
 await prepareOwnedBuyerAcceptanceTarget(input,f.deps);assert.equal(f.inserts,1);assert.equal(f.ids,1);
});
test('unknown commit keeps durable intent and retry observes same reserved job',options,async t=>{
 const f=fixture(t);f.loseCommit();await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps),/^Error: Buyer acceptance target preparation failed$/);
 assert.ok(fs.existsSync(f.map(INTENT)));assert.equal(fs.existsSync(f.map(TARGET)),false);
 await prepareOwnedBuyerAcceptanceTarget(input,f.deps);assert.equal(f.inserts,1);assert.equal(f.ids,1);
});
test('denied owner never inserts; existing intent survives and can reconcile later',options,async t=>{
 const f=fixture(t);f.denyOwner();await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));
 assert.equal(f.inserts,0);assert.ok(fs.existsSync(f.map(INTENT)));assert.equal(fs.existsSync(f.map(TARGET)),false);
});
test('changed release, owner, or consumed/deleted job fails closed without replacing target',options,async t=>{
 const f=fixture(t);await prepareOwnedBuyerAcceptanceTarget(input,f.deps);const bytes=fs.readFileSync(f.map(TARGET));
 await assert.rejects(prepareOwnedBuyerAcceptanceTarget({...input,releaseSha:'b'.repeat(40)},f.deps));
 f.row.status='failed';await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));
 f.row=null;await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));
 f.write(OWNER,{schema:1,kind:'zola_acceptance_owner',ownerId:jobId,criteria});
 await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));
 assert.deepEqual(fs.readFileSync(f.map(TARGET)),bytes);assert.equal(f.inserts,1);
});
test('crash after target rename is reconciled without new database write',options,async t=>{
 const f=fixture(t),rename=f.deps.io.renameSync;let interrupted=false;
 f.deps.io.renameSync=(from,to)=>{rename(from,to);if(to===TARGET&&!interrupted){interrupted=true;throw new Error('crash');}};
 await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));
 await prepareOwnedBuyerAcceptanceTarget(input,f.deps);assert.equal(f.inserts,1);assert.equal(f.ids,1);
});
test('torn intent stage, symlink target, unexpected criteria and broad owner mode refuse',options,async t=>{
 const f=fixture(t);fs.writeFileSync(f.map(INTENT+'.stage'),'{',{mode:0o600});
 await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));assert.equal(f.connections,0);
 fs.unlinkSync(f.map(INTENT+'.stage'));fs.symlinkSync(f.map(OWNER),f.map(TARGET));
 await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));assert.equal(f.connections,0);
 fs.unlinkSync(f.map(TARGET));f.write(OWNER,{schema:1,kind:'zola_acceptance_owner',ownerId,criteria:{...criteria,extra:true}});
 await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));assert.equal(f.connections,0);
 f.write(OWNER,{schema:1,kind:'zola_acceptance_owner',ownerId,criteria});fs.chmodSync(f.map(OWNER),0o640);
 await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));assert.equal(f.connections,0);
});
test('host flock excludes overlapping invocation and is released after failure',options,async t=>{
 const f=fixture(t),connect=f.deps.connect;let release,entered;
 const started=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 f.deps.connect=async(...args)=>{entered();await hold;return connect(...args);};
 const first=prepareOwnedBuyerAcceptanceTarget(input,f.deps);await started;
 await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));release();await first;
 await prepareOwnedBuyerAcceptanceTarget(input,f.deps);assert.equal(f.inserts,1);
});

test('unsafe relation effects and running services refuse before insertion',options,async t=>{
 const f=fixture(t);f.unsafeCatalog();await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));assert.equal(f.inserts,0);
 f.active();const prior=f.connections;await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));assert.equal(f.connections,prior);
});
