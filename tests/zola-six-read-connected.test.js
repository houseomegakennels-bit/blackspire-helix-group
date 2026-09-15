import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { digest, validateCollectorConfig, collectSixReads } from '../packages/zola-six-reads/collector.js';
import { DIVISION_TABLES } from '../packages/zola-six-reads/database-observer.js';
import { createJournaledConnectedObserver, CONNECTED_OBSERVER_ENDPOINT } from '../packages/zola-six-reads/database-connected.js';
import { createProductionConnectedDatabaseObserver } from '../packages/zola-six-reads/database-connected-host.js';
import { openCollectorJournal } from '../packages/zola-six-reads/collector-host.js';
const config={version:3,releaseSha:'a'.repeat(40),runId:'connected-fixture',frontendOrigin:'https://example.test',workspace:'workspace',principal:'owner',deniedPrincipal:'other',dealId:'DE-0001',apiPid:10,workerPid:11,port:1234,databasePath:'/protected/db',credentialPath:'/protected/credential',journalDirectory:'/protected/journal',observerDatabaseConfigPath:'/protected/observer'};
const generation={apiGeneration:'api-generation',workerGeneration:'worker-generation'};
function memory(){const events=[{type:'run',binding:digest(config),releaseSha:config.releaseSha}];return {events:()=>structuredClone(events),append:e=>events.push(structuredClone(e)),raw:events};}
function response(query){
 const phase=query.includes("'phase','before'")?'before':'after';
 const common={version:1,releaseSha:config.releaseSha,runId:config.runId,phase,capturedAt:new Date().toISOString(),database:'postgres',readOnly:true,collectorBinding:query.match(/'collectorBinding','([a-f0-9]{64})'/)[1]};
 return query.includes('AS version_digest')?{...common,role:'postgres',primary:true,bypassRls:true,ordinaryTables:15,tables:DIVISION_TABLES.map(name=>({name,rows:1,digest:'b'.repeat(64),version_digest:'c'.repeat(64)}))}:{...common,role:'authenticated',witness:'d'.repeat(64),realDistinctUsers:true,ownVisible:1,foreignVisible:0};
}
const context=store=>({generation,store});
test('v3 config selects explicit connected credential path and rejects unknown options',()=>{
 assert.equal(validateCollectorConfig(config).version,3);
 for(const c of [{...config,version:4},{...config,observerDatabaseConfigPath:'relative'},{...config,authenticated:true}])assert.throws(()=>validateCollectorConfig(c));
});
test('query intents precede network, fixed SQL binds nonce, config, runtime and durable prefix; replay uses no transport',async()=>{
 const store=memory();let calls=0;
 const observe=createJournaledConnectedObserver(config,async query=>{
  calls++;assert.equal(store.events().at(-1).type,'database_query_intent');
  assert.match(query,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);assert.ok(query.endsWith('ROLLBACK;'));
  assert.equal(store.events().at(-1).queryDigest,digest(query));return response(query);
 });
 const before=await observe('before',context(store));assert.equal(calls,2);
 assert.deepEqual(await observe('before',context(store)),before);assert.equal(calls,2);
 const intents=store.events().filter(e=>e.type==='database_query_intent');assert.notEqual(intents[0].binding.nonce,intents[1].binding.nonce);
 assert.equal(intents[0].binding.endpoint,CONNECTED_OBSERVER_ENDPOINT);
 for(let index=0;index<6;index++){store.append({type:'intent',index});store.append({type:'collected',index});}
 assert.equal((await observe('after',context(store))).snapshot.phase,'after');assert.equal(calls,4);
 store.append({type:'collected',index:0});await assert.rejects(observe('after',context(store)),/INTERVAL_CLOSED/);assert.equal(calls,4);
});
test('transport uncertainty preserves durable intent and refuses retry or imported snapshots',async()=>{
 const store=memory();let calls=0;
 const observe=createJournaledConnectedObserver(config,async()=>{calls++;throw new Error('transport failed');});
 await assert.rejects(observe('before',context(store)));
 store.append({type:'imported_snapshot',authenticated:true,observation:{}});
 await assert.rejects(observe('before',context(store)),/OUTCOME_UNKNOWN/);assert.equal(calls,1);
});
test('old/wrong response bindings, clock, extra fields, role or results fail without recording result',async()=>{
 for(const change of [v=>v.collectorBinding='f'.repeat(64),v=>v.capturedAt='2020-01-01T00:00:00Z',v=>v.capturedAt='2099-01-01T00:00:00Z',v=>v.readOnly=false,v=>v.role='supabase_admin',v=>v.extra='private']){
  const store=memory();const observe=createJournaledConnectedObserver(config,async query=>{const v=response(query);change(v);return v;});
  await assert.rejects(observe('before',context(store)));assert.equal(store.events().length,2);
 }
});
test('replay rejects mixed config, generations, query digest, result digest and journal prefix',async()=>{
 for(const mutate of [s=>s.raw[1].binding.generationDigest='f'.repeat(64),s=>s.raw[1].queryDigest='f'.repeat(64),s=>s.raw[2].observationDigest='f'.repeat(64),s=>s.raw[1].binding.previousDigest='f'.repeat(64),s=>s.raw[1].binding.runId='other',s=>s.raw[1].binding.extra=true,s=>s.raw[2].completedAt=0]){
  const store=memory();const observe=createJournaledConnectedObserver(config,async q=>response(q));await observe('before',context(store));mutate(store);
  await assert.rejects(observe('before',context(store)));
 }
 const store=memory();const observe=createJournaledConnectedObserver(config,async q=>response(q));await observe('before',context(store));
 await assert.rejects(observe('before',{store,generation:{...generation,workerGeneration:'replacement'}}),/INTENT_BINDING/);
 await assert.rejects(createJournaledConnectedObserver({...config,releaseSha:'f'.repeat(40)},async()=>{})('before',context(store)),/JOURNAL_BINDING/);
});
test('missing baseline, premature after, duplicate results and interleaved journal fail closed',async()=>{
 let store=memory();store.append({type:'intent',index:0});await assert.rejects(createJournaledConnectedObserver(config,async()=>{})('before',context(store)),/BASELINE_MISSING/);
 store=memory();await assert.rejects(createJournaledConnectedObserver(config,async()=>{})('after',context(store)),/AFTER_EARLY/);
 const observe=createJournaledConnectedObserver(config,async q=>response(q));await observe('before',context(store));store.append(store.events()[2]);await assert.rejects(observe('before',context(store)),/DUPLICATE/);
 store=memory();await assert.rejects(createJournaledConnectedObserver(config,async q=>{store.append({type:'unexpected'});return response(q);})('before',context(store)),/CONCURRENT_JOURNAL/);
});
test('collector refuses a bare imported database_before before any admission',async()=>{
 const store=memory();store.append({type:'database_before',generation,observation:{snapshot:{},owner:{}}});let admissions=0;
 const host={generation:async()=>generation,deniedIdentity:async()=>{},observeDatabase:createJournaledConnectedObserver(config,async()=>{throw new Error('unavailable');}),admit:async()=>{admissions++;}};
 await assert.rejects(collectSixReads(config,host,store));assert.equal(admissions,0);
});
test('protected fsynced journal survives close/reopen and validates connected prefix without new queries',async()=>{
 const dir=fs.mkdtempSync(path.join(process.getuid()===0?'/root':os.tmpdir(),'zola-connected-journal-'));fs.chmodSync(dir,0o700);
 let store;try{
  store=openCollectorJournal(dir,config.runId,{owner:process.getuid()});store.append({type:'run',binding:digest(config),releaseSha:config.releaseSha});
  const first=await createJournaledConnectedObserver(config,async q=>response(q))('before',context(store));store.close();
  store=openCollectorJournal(dir,config.runId,{owner:process.getuid()});
  assert.deepEqual(await createJournaledConnectedObserver(config,async()=>{throw new Error('must not send');})('before',context(store)),first);
 }finally{store?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
// No real HTTP. Mock the concrete Node HTTPS boundary; protected credential
// reading remains real. Root-only tests use protected /root, never production.
for(const scenario of ['success','redirect','oversize','error','malformed','wrong-status'])test(`actual connected HTTPS host ${scenario}`,{skip:process.getuid()!==0},async t=>{
 const dir=fs.mkdtempSync('/root/zola-connected-host-test-');fs.chmodSync(dir,0o700);const credential=path.join(dir,'credential.json');
 fs.writeFileSync(credential,JSON.stringify({projectId:'kchtrvfcixnimvxxctkj',accessToken:'isolated-test-token-no-authority-0000'}),{mode:0o600});
 const c={...config,observerDatabaseConfigPath:credential},store=memory();store.raw[0].binding=digest(c);let calls=0;
 t.mock.method(https,'request',(url,options,callback)=>{
  calls++;assert.equal(url,CONNECTED_OBSERVER_ENDPOINT);assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);assert.equal(options.method,'POST');assert.equal(options.minVersion,'TLSv1.2');assert.ok(options.signal);
  const req=new EventEmitter();req.end=body=>{const packet=JSON.parse(body);assert.equal(packet.read_only,true);assert.deepEqual(Object.keys(packet),['query','read_only']);
   queueMicrotask(()=>{
    if(scenario==='error'){req.emit('error',new Error('private token'));return;}
    const res=new EventEmitter();res.statusCode=scenario==='redirect'?307:scenario==='wrong-status'?200:201;res.headers={'content-type':'application/json'};res.destroy=()=>{};callback(res);
    if(res.statusCode!==201)return;
    res.emit('data',Buffer.from(scenario==='oversize'?'x'.repeat(65537):scenario==='malformed'?'private-response':JSON.stringify([{observation:response(packet.query)}])));res.emit('end');
   });};return req;
 });
 try{
  const observe=createProductionConnectedDatabaseObserver(c);
  if(scenario==='success'){assert.equal((await observe('before',context(store))).snapshot.role,'postgres');assert.equal(calls,2);assert.ok(!JSON.stringify(store.events()).includes('isolated-test-token'));}
  else {await assert.rejects(observe('before',context(store)),/^Error: CONNECTED_OBSERVER_FAILED$/);await assert.rejects(observe('before',context(store)),/OUTCOME_UNKNOWN/);assert.equal(calls,1);}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
