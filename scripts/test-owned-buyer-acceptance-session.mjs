import pg from 'pg';
import {prepareOwnedBuyerSchema} from '../packages/buyer-writer/owned-schema.js';
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
  if(text===sql.identity||text===sql.targetIdentity)return {rows:[{safe:true}]};
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

assert.equal(process.env.ZOLA_DISPOSABLE_EXECUTOR,'1');
const ports=JSON.parse(fs.readFileSync(0,'utf8'));assert.ok([ports.source,ports.target].every(v=>/^172\.[0-9]+\.[0-9]+\.[0-9]+$/.test(v)));assert.notEqual(ports.source,ports.target);
const clients=[],cleanups=[];const connect=async (side,user='postgres')=>{const c=new pg.Client({host:ports[side],port:5432,user,database:'postgres',connectionTimeoutMillis:2000,query_timeout:10000,options:'-c statement_timeout=7000 -c lock_timeout=1000 -c search_path=pg_catalog'});await c.connect();clients.push(c);return c;};
try{
 const source=await connect('source'),admin=await connect('target','blackspire_cluster_admin');
 await admin.query('CREATE ROLE postgres LOGIN SUPERUSER BYPASSRLS;ALTER DATABASE postgres OWNER TO postgres');
 const target=await connect('target');
 await source.query(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz,raw_app_meta_data jsonb,created_at timestamptz);`);
 await source.query(`INSERT INTO auth.users(id,email_confirmed_at,raw_app_meta_data,created_at)VALUES($1,now(),' {"blackspire_role":"admin"}'::jsonb,now())`,[ownerId]);
 await target.query(prepareOwnedBuyerSchema(JSON.parse(fs.readFileSync(new URL('../packages/buyer-writer/owned-source-schema.json',import.meta.url)))).body);
 await target.query('GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO postgres;ALTER ROLE postgres NOSUPERUSER');
 const system=(await target.query('SELECT (pg_control_system()).system_identifier::text AS id')).rows[0].id;
 const f=fixture({after:fn=>cleanups.push(fn)});
 const legacy='/var/lib/blackspire-operator/writer-acceptance.json';f.write(legacy,{retained:'original target'});const original=fs.readFileSync(f.map(legacy));
 let checkedLock=false,inserts=0;
 f.deps.connect=async config=>{const c=await connect(config.fixtureSide);const query=c.query.bind(c);c.query=async(text,values)=>{
  if(text===sql.insert){inserts++;const concurrent=await connect('source');await assert.rejects(concurrent.query('UPDATE auth.users SET deleted_at=now() WHERE id=$1',[ownerId]),error=>error.code==='55P03');await concurrent.end();checkedLock=true;}
  return query(text,values);
 };return c;};
 f.deps.database.verifyOwnedDatabaseIdentity=async c=>assert.equal((await c.query('SELECT (pg_control_system()).system_identifier::text AS id')).rows[0].id,system);
 assert.equal((await prepareOwnedBuyerAcceptanceTarget(input,f.deps)).status,'OWNED_BUYER_ACCEPTANCE_TARGET_PREPARED');assert.equal(checkedLock,true);
 assert.equal((await prepareOwnedBuyerAcceptanceTarget(input,f.deps)).status,'OWNED_BUYER_ACCEPTANCE_TARGET_PREPARED');assert.equal(inserts,1);
 assert.equal((await target.query('SELECT count(*)::int AS n FROM public."SearchJob"')).rows[0].n,1);
 assert.equal((await target.query("SELECT to_regclass('auth.users') AS relation")).rows[0].relation,null);
 assert.equal((await source.query('SELECT deleted_at FROM auth.users WHERE id=$1',[ownerId])).rows[0].deleted_at,null);
 assert.deepEqual(fs.readFileSync(f.map(legacy)),original);
 await target.query('ALTER TABLE public."SearchJob" FORCE ROW LEVEL SECURITY');
 await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));await target.query('ALTER TABLE public."SearchJob" NO FORCE ROW LEVEL SECURITY');
 await admin.query('ALTER ROLE postgres NOBYPASSRLS');await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));await admin.query('ALTER ROLE postgres BYPASSRLS');
 await source.query('UPDATE auth.users SET deleted_at=now() WHERE id=$1',[ownerId]);
 await assert.rejects(prepareOwnedBuyerAcceptanceTarget(input,f.deps));assert.equal(inserts,1);
 console.log('PASS: actual original-owner lock, separate target insert, exact retry, revocation refusal and untouched legacy target; protected profile/systemd modeled.');
}finally{for(const c of clients)try{await c.end();}catch{}for(const fn of cleanups)fn();}
