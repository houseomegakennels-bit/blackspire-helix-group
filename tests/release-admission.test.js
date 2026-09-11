import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {createBuyerWriterHttpServer} from '../packages/buyer-writer/http.js';
import {acquireReleaseAdmissionLock,createReleaseAdmissionGuard,heldAcceptanceContext,RELEASE_ADMISSION_LOCK,releaseAdmissionRequired,withHeldAcceptanceAdmission,withReleaseAdmission} from '../packages/shared/release-admission.js';
import {engageReleaseAdmissionHold,reconcileReleaseAdmissionHold,inspectAdmissionHoldHistory} from '../packages/zola-release/admission-hold.js';

const sha='a'.repeat(40),runId='12345678-1234-4234-8234-123456789abc';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'admission-fixture-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'admission.lock'),RELEASE_ADMISSION_LOCK,{mode:0o640});fs.chmodSync(path.join(root,'admission.lock'),0o640);
  const context={role:'api',releaseSha:sha,runId,generation:'b'.repeat(32),apiGeneration:'b'.repeat(32),workerGeneration:'c'.repeat(32)};
  const state={version:1,mode:'open',releaseSha:sha,runId,apiGeneration:context.apiGeneration,workerGeneration:context.workerGeneration};
  const readState=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const filename=path.join(root,'state.json');fs.writeFileSync(filename,JSON.stringify(state),{mode:0o640});
  // Explicit library seams confine fixtures to their disposable root. Production
  // entrypoints never accept these owner/path/reader substitutions.
  const acquire=options=>acquireReleaseAdmissionLock({root,owner:process.getuid(),groupId:process.getgid(),checkDirectory:()=>{},...options});
  const guard=createReleaseAdmissionGuard({required:()=>true,context:()=>context,acquire:()=>acquire(),readState:()=>readState(filename)});
  const events=[],journal={stream:()=>({events:()=>structuredClone(events),append:event=>events.push(structuredClone(event))})};
  const options={root,owner:process.getuid(),groupId:process.getgid(),checkDirectory:()=>{},stopped:()=>{},acquire,readState};
  return {root,filename,context,state,guard,acquire,events,journal,options};
}
test('production cannot omit the run setting or downgrade to test mode',()=>{
  assert.equal(releaseAdmissionRequired({BLACKSPIRE_STATE_OWNER:'vps-production',BLACKSPIRE_RUNTIME_MODE:'test'}),true);
  assert.equal(releaseAdmissionRequired({BLACKSPIRE_RELEASE_RUN_ID:''}),true);
  assert.equal(releaseAdmissionRequired({NODE_ENV:'production'}),true);
  assert.equal(releaseAdmissionRequired({BLACKSPIRE_RUNTIME_MODE:'production'}),true);
  assert.equal(releaseAdmissionRequired({NODE_ENV:'test'}),false);
});
test('shared leases span nested sync/async work; exclusive publication refuses until settlement',async t=>{
  const f=fixture(t);let finish;
  const pending=f.guard.run(()=>f.guard.run(()=>new Promise(resolve=>{finish=resolve;})));
  assert.throws(()=>f.acquire({exclusive:true}),/held/);
  finish(7);assert.equal(await pending,7);
  const exclusive=f.acquire({exclusive:true});assert.throws(()=>f.guard.run(()=>assert.fail('dispatch')),/held/);exclusive.close();
  assert.equal(f.guard.run(()=>9),9);
  await assert.rejects(f.guard.run(async()=>{throw new Error('callback rejection');}),/callback rejection/);
  f.acquire({exclusive:true}).close();
});
test('wrong run, source, either generation, role, malformed state and missing lock deny before callback',t=>{
  const f=fixture(t);let calls=0;
  for(const change of [{runId:'a'.repeat(36)},{releaseSha:'d'.repeat(40)},{apiGeneration:'d'.repeat(32)},{workerGeneration:'d'.repeat(32)},{mode:'held'},{extra:true}]){
    fs.writeFileSync(f.filename,JSON.stringify({...f.state,...change}));assert.throws(()=>f.guard.run(()=>calls++),/held/);
  }
  fs.writeFileSync(f.filename,JSON.stringify(f.state));f.context.role='other';assert.throws(()=>f.guard.run(()=>calls++),/held/);f.context.role='api';
  fs.unlinkSync(path.join(f.root,'admission.lock'));assert.throws(()=>f.guard.run(()=>calls++),/held/);assert.equal(calls,0);
});
test('linked, modified or permissive lock inode and pending publication fail closed',t=>{
  const f=fixture(t),lock=path.join(f.root,'admission.lock');
  fs.chmodSync(lock,0o666);assert.throws(()=>f.guard.run(()=>0),/held/);fs.chmodSync(lock,0o640);
  fs.linkSync(lock,path.join(f.root,'second-link'));assert.throws(()=>f.guard.run(()=>0),/held/);fs.unlinkSync(path.join(f.root,'second-link'));
  const lease=f.acquire();fs.appendFileSync(lock,'changed');assert.throws(()=>lease.assertIdentity(),/held/);lease.close();
  fs.writeFileSync(lock,RELEASE_ADMISSION_LOCK);fs.writeFileSync(path.join(f.root,'pending.json'),'{}');assert.throws(()=>f.guard.run(()=>0),/held/);
});
test('publisher refuses an active lease and cannot consume or alter its state',t=>{
  const f=fixture(t),lease=f.acquire(),before=fs.readFileSync(f.filename,'utf8');
  assert.throws(()=>engageReleaseAdmissionHold({releaseSha:sha,journal:f.journal},f.options),/rejected/);
  assert.equal(fs.readFileSync(f.filename,'utf8'),before);assert.deepEqual(f.events,[]);lease.close();
  const held=engageReleaseAdmissionHold({releaseSha:sha,journal:f.journal},f.options);
  assert.equal(held.intakeOpen,false);assert.equal(inspectAdmissionHoldHistory(f.events),null);assert.throws(()=>f.guard.run(()=>0),/held/);
  const beforeReplay=JSON.stringify(f.events);assert.equal(engageReleaseAdmissionHold({releaseSha:sha,journal:f.journal},f.options).alreadyHeld,true);assert.equal(JSON.stringify(f.events),beforeReplay);
});
test('crash at every publication boundary stays closed; only exact published held state can reconcile',t=>{
  for(const stage of ['intent','prepared','published','confirmed']){
    const f=fixture(t);
    assert.throws(()=>engageReleaseAdmissionHold({releaseSha:sha,journal:f.journal},{...f.options,fault:at=>{if(at===stage)throw new Error('crash');}}),/rejected/);
    assert.throws(()=>f.guard.run(()=>assert.fail('opened after crash')),/held/);
    if(stage==='confirmed')assert.equal(engageReleaseAdmissionHold({releaseSha:sha,journal:f.journal},f.options).alreadyHeld,true);
    else assert.throws(()=>engageReleaseAdmissionHold({releaseSha:sha,journal:f.journal},f.options),/rejected/);
    if(stage==='published')assert.equal(reconcileReleaseAdmissionHold({journal:f.journal},f.options).status,'RELEASE_ADMISSION_HOLD_RECONCILED');
    else if(stage==='confirmed')assert.equal(reconcileReleaseAdmissionHold({journal:f.journal},f.options).status,'NO_PENDING_RELEASE_HOLD');
    else assert.throws(()=>reconcileReleaseAdmissionHold({journal:f.journal},f.options),/rejected/);
    assert.throws(()=>f.guard.run(()=>0),/held/);
  }
});
test('a killed lease owner releases the kernel lock without deleting or replacing the lock file',async t=>{
  const f=fixture(t),module=new URL('../packages/shared/release-admission.js',import.meta.url).href;
  const source=`import {acquireReleaseAdmissionLock} from ${JSON.stringify(module)}; const lease=acquireReleaseAdmissionLock({root:process.argv[1],owner:process.getuid(),groupId:process.getgid(),checkDirectory:()=>{}});process.send('locked');setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','--eval',source,f.root],{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','ignore','ignore','ipc']});
  const done=once(child,'close');t.after(async()=>{child.kill('SIGKILL');await done;});
  await once(child,'message');const inode=fs.statSync(path.join(f.root,'admission.lock')).ino;
  assert.throws(()=>f.acquire({exclusive:true}),/held/);child.kill('SIGKILL');await done;
  f.acquire({exclusive:true}).close();assert.equal(fs.statSync(path.join(f.root,'admission.lock')).ino,inode);
});
test('actual Buyer HTTP lease survives disconnect until the database promise settles',async t=>{
  const f=fixture(t);let releaseQuery,started;
  const startedQuery=new Promise(resolve=>{started=resolve;});
  const pendingQuery=new Promise(resolve=>{releaseQuery=resolve;});
  const credential='q'.repeat(43),permit='p'.repeat(43);
  const server=createBuyerWriterHttpServer({credential,workspace:'isolated',isAvailable:()=>true,query:async()=>{started();await pendingQuery;return {rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]};}}, {admit:fn=>f.guard.run(fn)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{releaseQuery();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const req=http.request({host:'127.0.0.1',port:server.address().port,method:'POST',path:'/api/internal/buyer-writer/v1/jobs/00000000-0000-4000-8000-000000000001/operations',
    headers:{'content-type':'application/json','x-buyer-writer-key':credential,'x-buyer-job-permit':permit}});
  req.on('error',()=>{});
  req.end(JSON.stringify({version:1,dispatchId:'00000000-0000-4000-8000-000000000002',generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}}));
  await startedQuery;req.destroy();await new Promise(resolve=>setImmediate(resolve));
  assert.throws(()=>engageReleaseAdmissionHold({releaseSha:sha,journal:f.journal},f.options),/rejected/);
  assert.deepEqual(f.events,[]);releaseQuery();
  let lease;
  for(let i=0;i<50;i++){try{lease=f.acquire({exclusive:true});break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
  assert.ok(lease,'lease released after actual handler settlement');lease.close();
});

test('generation changes during acquisition or validation deny before dispatch',t=>{
  const f=fixture(t);let calls=0;
  for(const phase of ['acquire','readState']){
    f.context.workerGeneration=f.state.workerGeneration;
    const guard=createReleaseAdmissionGuard({required:()=>true,context:()=>f.context,
      acquire:()=>{const lease=f.acquire();if(phase==='acquire')f.context.workerGeneration='d'.repeat(32);return lease;},
      readState:()=>{if(phase==='readState')f.context.workerGeneration='d'.repeat(32);return f.state;}});
    assert.throws(()=>guard.run(()=>calls++),/held/);
    f.acquire({exclusive:true}).close();
  }
  assert.equal(calls,0);
});

test('HELD acceptance admits only the bound API token or worker role under one shared lease',async t=>{
  const f=fixture(t),epoch='22345678-1234-4234-8234-123456789abc',token='t'.repeat(43),api='1'.repeat(32),worker='2'.repeat(32);
  const crypto=await import('node:crypto'),claims={schema:1,kind:'held-epoch-acceptance',permitId:'32345678-1234-4234-8234-123456789abc',
    commanderRunId:'42345678-1234-4234-8234-123456789abc',mergeMainSha:sha,expectedDeploymentSha:sha,epochRunId:epoch,workspace:'blackspire-command',principal:'operator',
    apiGeneration:api,workerGeneration:worker,issuedAt:1000,expiresAt:2000,
    operations:['api_health','worker_readiness','generation_fence','six_live_reads','production_smoke','zero_paid_nexus','zero_unintended_mutation','rollback_verification'],
    reads:['seller.opportunities.search','buyer.profiles.search','buyer.matches.search','deal.records.search','deal.analysis.get','nexus.enrichment.status'].map((capability,index)=>{const idempotencyKey=`zola-six:${epoch}:${index}`,request=`read-${index}`;return{index,
      idempotencyKey,capability,permission:['seller.opportunities.read','buyer.profiles.read','buyer.matches.read','deal.records.read','deal.analysis.read','nexus.enrichment.read'][index],request,
      requestDigest:crypto.createHash('sha256').update(JSON.stringify({channel:'jarvis',workspaceId:'blackspire-command',text:request,idempotencyKey,executionIntent:'read_only'})).digest('hex')};}),
    tokenDigest:crypto.createHash('sha256').update(token).digest('hex')};
  const state={version:1,mode:'held',releaseSha:sha,runId:epoch,apiGeneration:api,workerGeneration:worker};
  fs.writeFileSync(f.filename,JSON.stringify(state));
  const binding=role=>({role,releaseSha:sha,runId:epoch,generation:role==='api'?api:worker,apiGeneration:api,workerGeneration:worker});
  const deps=role=>({root:f.root,required:()=>true,now:()=>1500,context:()=>binding(role),
    acquire:o=>f.acquire({...o,owner:process.getuid(),groupId:process.getgid(),allowPending:true}),
    read:file=>path.basename(file)==='state.json'?state:claims});
  assert.equal(await withHeldAcceptanceAdmission({role:'api',token},async()=>{
    assert.equal(heldAcceptanceContext().role,'api');return withReleaseAdmission(()=>7);
  },deps('api')),7);
  assert.equal(withHeldAcceptanceAdmission({role:'worker'},()=>heldAcceptanceContext().taskKeys.length,deps('worker')),6);
  assert.throws(()=>withHeldAcceptanceAdmission({role:'api',token:'x'.repeat(43)},()=>0,deps('api')),/held/);
  assert.throws(()=>withHeldAcceptanceAdmission({role:'worker'},()=>0,{...deps('worker'),now:()=>2000}),/held/);
});
