import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateCollectorConfig} from '../packages/zola-six-reads/collector.js';
import {createJournaledOwnedObserver,OWNED_OBSERVER_TABLES,RETAINED_OBSERVER_TABLES,compareOwnedDivisionSnapshots,ownedObservationSQL} from '../packages/zola-six-reads/owned-database-observer.js';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const owner='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
const config={version:6,backendProfile:'owned-postgres-v1',profileDigest:'d'.repeat(64),acceptanceSearchJobId:'33333333-3333-4333-8333-333333333333',ownedObserverDatabaseConfigPath:'/etc/blackspire/owned-postgres/management.json',observerDatabaseConfigPath:'/etc/blackspire-buyer-writer-gateway/management.json',releaseSha:'a'.repeat(40),runId:'owned-observer',frontendOrigin:'https://example.test',workspace:'workspace',principal:'owner',deniedPrincipal:'other',dealId:'DE-0001',apiPid:10,workerPid:11,port:1234,databasePath:'/protected/db',credentialPath:'/protected/credential',journalDirectory:'/protected/journal',denialReceiptPath:'/protected/denial'};
const generation={apiGeneration:'api-generation',workerGeneration:'worker-generation'};
function fixture(){
 const rows=[{type:'run',binding:hash(config),releaseSha:config.releaseSha}],store={events:()=>structuredClone(rows),append:e=>rows.push(structuredClone(e))};let calls=0,auth;
 const execute=async({source,sql})=>{
  calls++;const intent=store.events().at(-1),kind=intent.binding.kind,phase=intent.binding.phase;
  assert.equal(intent.type,'database_query_intent');assert.equal(intent.queryDigest,hash(sql));assert.equal(source,['snapshot_source','auth'].includes(kind)?'source':'owned');assert.match(sql,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);assert.ok(sql.endsWith('ROLLBACK;'));
  const common={version:2,releaseSha:config.releaseSha,runId:config.runId,phase,profileDigest:config.profileDigest,capturedAt:new Date().toISOString(),database:'postgres',role:'postgres',readOnly:true};let value;
  if(kind.startsWith('snapshot_')){const tables=source==='owned'?OWNED_OBSERVER_TABLES:RETAINED_OBSERVER_TABLES;value={...common,source,primary:true,bypassRls:true,ordinaryTables:tables.length,tables:tables.map(name=>({name,rows:1,digest:'b'.repeat(64),version_digest:'c'.repeat(64)}))};}
  else if(kind==='target')value={...common,jobId:config.acceptanceSearchJobId,ownerId:owner,targetCount:1};
  else if(kind==='auth'){assert.ok(sql.includes(owner));auth={...common,ownerId:owner,ownerExists:true,foreignId:foreign};value=auth;}
  else{assert.ok(sql.includes(owner)&&sql.includes(foreign));value={...common,role:'authenticated',witness:hash(`${owner}:${foreign}:${config.acceptanceSearchJobId}`),authObservationDigest:hash(auth),realDistinctUsers:true,ownVisible:1,foreignVisible:0};}
  return {...value,collectorBinding:hash(intent.binding)};
 };return {rows,store,execute,calls:()=>calls};
}
test('owned collector versions explicitly require both fixed sources and dedicated target',()=>{
 assert.equal(validateCollectorConfig(config).version,6);assert.equal(validateCollectorConfig({...config,version:7,releaseRunId:'live-run'}).version,7);
 for(const patch of [{version:4},{backendProfile:'supabase'},{profileDigest:undefined},{ownedObserverDatabaseConfigPath:'/other'},{observerDatabaseConfigPath:'/other'},{acceptanceSearchJobId:'customer'}])assert.throws(()=>validateCollectorConfig({...config,...patch}));
});
test('five distinct durable observations bind actual source identities and replay without queries',async()=>{
 const f=fixture(),observe=createJournaledOwnedObserver(config,f.execute),context={generation,store:f.store};
 const before=await observe('before',context);assert.equal(f.calls(),5);assert.deepEqual(await observe('before',context),before);assert.equal(f.calls(),5);
 assert.deepEqual(f.rows.filter(r=>r.type==='database_query_intent').map(r=>r.binding.kind),['snapshot_source','snapshot_owned','target','auth','owner']);
 for(let index=0;index<6;index++){f.store.append({type:'intent',index});f.store.append({type:'collected',index});}
 const after=await observe('after',context),evidence=compareOwnedDivisionSnapshots(before.snapshot,after.snapshot,config);assert.equal(evidence.tableCount,17);assert.equal(evidence.netMutationDelta,0);assert.equal(after.owner.witness,before.owner.witness);
 const publicEvidence=JSON.stringify({evidence,owner:after.owner});assert.ok(!publicEvidence.includes(owner)&&!publicEvidence.includes(foreign));
 after.snapshot.owned.tables[0].version_digest='e'.repeat(64);assert.throws(()=>compareOwnedDivisionSnapshots(before.snapshot,after.snapshot,config));
});
test('uncertain query cannot be retried or replaced with imported owner evidence',async()=>{
 const f=fixture();let calls=0;const observe=createJournaledOwnedObserver(config,async()=>{calls++;throw new Error('transport lost');});
 await assert.rejects(observe('before',{generation,store:f.store}));await assert.rejects(observe('before',{generation,store:f.store}));assert.equal(calls,1);assert.equal(f.rows.length,2);
});
test('profile, endpoint, generation, source and owner witness mismatch fail closed',async()=>{
 for(const mutate of [f=>f.rows[1].binding.endpoint='postgresql://other',f=>f.rows[1].binding.profileDigest='f'.repeat(64),f=>f.rows[2].observation.tables[0].digest='e'.repeat(64)]){
  const f=fixture(),observe=createJournaledOwnedObserver(config,f.execute);await observe('before',{generation,store:f.store});mutate(f);await assert.rejects(observe('before',{generation,store:f.store}));assert.equal(f.calls(),5);
 }
 const f=fixture(),observe=createJournaledOwnedObserver(config,async args=>{const value=await f.execute(args);if(Object.hasOwn(value,'ownerExists'))value.ownerExists=false;return value;});await assert.rejects(observe('before',{generation,store:f.store}));assert.equal(f.calls(),4);
 assert.throws(()=>ownedObservationSQL(config,'before','auth',{target:{ownerId:"';delete",jobId:config.acceptanceSearchJobId}}));
});

test('generated dual-source SQL proves actual PostgreSQL owner RLS without owned auth.users',{skip:process.env.ZOLA_OWNED_OBSERVER_DISPOSABLE!=='1'},async()=>{
 const {execFileSync}=await import('node:child_process');
 const name='zola-owned-observer-test-'+process.pid;
 const docker=(args,input)=>execFileSync('/usr/bin/docker',args,{input,encoding:'utf8',timeout:30000,maxBuffer:1048576,stdio:['pipe','pipe','pipe']});
 const sql=(database,input)=>docker(['exec','-i',name+'-'+database,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],input);
 try{
  for(const database of ['source','owned']){docker(['run','--detach','--name',name+'-'+database,'--network','none','--env','POSTGRES_PASSWORD=disposable-observer-fixture','postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94']);
  let ready=false;for(let i=0;i<50;i++){try{docker(['exec',name+'-'+database,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}assert.equal(ready,true);}
  sql('owned','CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;');
  sql('source',`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${owner}'),('${foreign}');`+RETAINED_OBSERVER_TABLES.map(table=>`CREATE TABLE public."${table}"(id uuid PRIMARY KEY);`).join(''));
  sql('owned',OWNED_OBSERVER_TABLES.map(table=>`CREATE TABLE public."${table}"(id uuid PRIMARY KEY,user_id uuid);`).join('')+`INSERT INTO public."SearchJob" VALUES('${config.acceptanceSearchJobId}','${owner}');ALTER TABLE public."SearchJob" ENABLE ROW LEVEL SECURITY;CREATE POLICY owner ON public."SearchJob" USING(user_id=current_setting('request.jwt.claim.sub',true)::uuid);GRANT USAGE ON SCHEMA public TO authenticated;GRANT SELECT ON public."SearchJob" TO authenticated;`);
  const f=fixture(),observe=createJournaledOwnedObserver(config,async({source,sql:query})=>{const rows=sql(source==='source'?'source':'owned',query).trim().split('\n').filter(line=>line.startsWith('{'));assert.equal(rows.length,1);return JSON.parse(rows[0]);});
  const before=await observe('before',{generation,store:f.store});assert.equal(before.owner.ownVisible,1);assert.equal(before.owner.foreignVisible,0);
  for(let index=0;index<6;index++){f.store.append({type:'intent',index});f.store.append({type:'collected',index});}
  const after=await observe('after',{generation,store:f.store});assert.equal(compareOwnedDivisionSnapshots(before.snapshot,after.snapshot,config).tableCount,17);
  assert.equal(sql('owned',"SELECT to_regclass('auth.users') IS NULL;").trim(),'t');
  sql('owned','ALTER POLICY owner ON public."SearchJob" USING(true);');
  const denied=fixture();await assert.rejects(createJournaledOwnedObserver(config,async({source,sql:query})=>JSON.parse(sql(source==='source'?'source':'owned',query).trim().split('\n').find(line=>line.startsWith('{'))))('before',{generation,store:denied.store}),/observation rejected/);
 }finally{for(const database of ['source','owned'])try{docker(['rm','--force',name+'-'+database]);}catch{}}
});
