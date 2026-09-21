import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {createOwnedStoreTransition,ownedBackendFields,resolveOwnedStoreTransitionGroup} from '../packages/zola-release/owned-store-transition.js';
import {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest} from '../packages/buyer-writer/owned-postgres.js';
import {renderBuyerStoreNamespaceDropin} from '../packages/buyer-store/namespace.js';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const oldSha='a'.repeat(40),releaseSha='b'.repeat(40),apiGid=61011,storeGid=61012;
const json=v=>JSON.stringify(v)+'\n';
function fixture(){
 const dir=fs.mkdtempSync('/run/owned-transition-');fs.chmodSync(dir,0o700);
 const paths=Object.fromEntries(['runtime','client','deal','target','manifest','namespace','current'].map(k=>[k,dir+'/'+k]));paths.root=dir+'/retained';
 const ca='synthetic test certificate';const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16385,systemIdentifier:'7000000000000000001',caSha256:hash(ca)};
 const profileDigest=ownedPostgresProfileDigest(profile),client={version:1,releaseSha:oldSha,profileDigest,key:randomBytes(32).toString('base64url')};
 const runtime={version:1,client,profile,ca,repositoryPassword:randomBytes(32).toString('base64url'),capabilityPassword:randomBytes(32).toString('base64url'),publicKey:'sb_publishable_fixture',operatorOwnerId:null,ipcGroupId:61013};
 const deal={version:1,releaseSha:oldSha,origin:'https://fixture.vercel.app',key:randomBytes(32).toString('base64url')};
 const write=(k,v,g,m=0o640)=>{fs.writeFileSync(paths[k],typeof v==='string'?v:json(v));fs.chownSync(paths[k],0,g);fs.chmodSync(paths[k],m);};
 const target={schema:1,kind:'zola_owned_bounded_writer_acceptance_target',backendProfile:'owned-postgres-v1',profileDigest,releaseSha:oldSha,workspace:'blackspire-command',principal:'blackspire-release-root',capability:'buyer.writer.acceptance',jobId:'11111111-1111-4111-8111-111111111111',ownerId:'22222222-2222-4222-8222-222222222222',criteria:{state:'FL',county:'Zola Acceptance',property_type:'acceptance',date_range_start:'2026-01-01',date_range_end:'2026-01-02',min_purchases:1,cash_buyers_only:false,llc_buyers_only:false},updatedAt:'2026-09-21T00:00:00.000000Z'};
 write('target',target,apiGid);write('runtime',runtime,storeGid);write('client',client,apiGid);write('deal',deal,apiGid);write('manifest',{old:'retained-exact'},storeGid);write('namespace',renderBuyerStoreNamespaceDropin(oldSha),0,0o600);fs.symlinkSync('releases/'+oldSha,paths.current);
 const before=Object.fromEntries(['runtime','client','deal','target','manifest','namespace'].map(k=>[k,fs.readFileSync(paths[k])]));
 let interrupted=false,crash=null,active=false,published=0;
 const io=new Proxy(fs,{get(t,k){if(k==='renameSync')return(...args)=>{const r=fs.renameSync(...args);if(crash===args[1]&&!interrupted){interrupted=true;throw new Error('simulated process interruption');}return r;};return t[k];}});
 const options={paths,io,verifyNamespace:()=>{},apiGroup:()=>apiGid,storeGroup:()=>storeGid,inspect:async()=>({artifactDigest:'c'.repeat(64)}),
  run:(_file,args)=>{if(args[0]==='start'){active=true;return '';}if(args[0]==='stop'){active=false;return '';}const running=active&&args.at(-1)==='blackspire-buyer-store.service';return running?'ActiveState=active\nSubState=running\nMainPID=123\n':'ActiveState=inactive\nSubState=dead\nMainPID=0\n';},
  publishManifest:async b=>{published++;const configuration=JSON.parse(fs.readFileSync(paths.runtime));write('manifest',{version:1,kind:'buyer-store-installed',releaseSha:b.releaseSha,artifactDigest:'c'.repeat(64),configurationDigest:hash(configuration),runId:b.runId,apiGeneration:b.apiGeneration,workerGeneration:b.workerGeneration},storeGid);return{status:'BUYER_STORE_MANIFEST_PUBLISHED'};}};
 return{dir,paths,before,runtime,client,deal,target,options,helper:()=>createOwnedStoreTransition(options),input:{releaseSha,previousSha:oldSha,origin:'https://blackspirehelix.com',backendProfile:'owned-postgres-v1',profileDigest},crash:file=>{crash=file;},published:()=>published,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('owned profile selection never reinterprets partial or legacy inputs',()=>{assert.deepEqual(ownedBackendFields({}),{});for(const v of [{backendProfile:'owned-postgres-v1'},{profileDigest:'a'.repeat(64)},{backendProfile:'supabase',profileDigest:'a'.repeat(64)}])assert.throws(()=>ownedBackendFields(v));});
test('real protected transition preserves keys, restores exact config and namespace after partial publication',{skip:process.getuid()!==0},async()=>{
 const f=fixture();try{const p=await f.helper().prepare(f.input);assert.equal(JSON.stringify(p).includes(f.client.key),false);assert.equal(JSON.stringify(p).includes('repositoryPassword'),false);
 f.crash(f.paths.runtime);await assert.rejects(f.helper().publish(p));assert.equal(JSON.parse(fs.readFileSync(f.paths.runtime)).client.releaseSha,releaseSha);
 await f.helper().publish(p);assert.equal(f.helper().observe(p),true);const r=JSON.parse(fs.readFileSync(f.paths.runtime)),c=JSON.parse(fs.readFileSync(f.paths.client)),d=JSON.parse(fs.readFileSync(f.paths.deal));
 assert.deepEqual({...r,client:f.runtime.client},f.runtime);assert.equal(c.key,f.client.key);assert.equal(d.key,f.deal.key);assert.equal(d.origin,f.input.origin);assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.target)),{...f.target,releaseSha});assert.equal(fs.readlinkSync(f.paths.current),'releases/'+releaseSha);
 await f.helper().restore(p);assert.equal(f.helper().restored(p),true);for(const[k,b]of Object.entries(f.before))assert.deepEqual(fs.readFileSync(f.paths[k]),b);assert.equal(fs.readlinkSync(f.paths.current),'releases/'+oldSha);
 }finally{f.cleanup();}
});
test('manifest is journaled before effect and exact retained rollback survives publication and daemon restart',{skip:process.getuid()!==0},async()=>{
 const f=fixture();try{const h=f.helper(),p=await h.prepare(f.input);await h.publish(p);const b={releaseSha,runId:'00000000-0000-4000-8000-000000000001',apiGeneration:'d'.repeat(32),workerGeneration:'e'.repeat(32)};
 const publish=f.options.publishManifest;let once=true;f.options.publishManifest=async binding=>{assert.equal(fs.existsSync(f.paths.root+'/manifest-'+releaseSha+'.json'),true);const result=await publish(binding);if(once){once=false;throw new Error('lost publication acknowledgement');}return result;};
 await assert.rejects(f.helper().publishManifest(b));assert.equal(f.helper().observe(p),true);await f.helper().publishManifest(b);f.helper().start();f.helper().start();await assert.rejects(f.helper().restore(p));f.helper().stop();await f.helper().restore(p);assert.deepEqual(fs.readFileSync(f.paths.manifest),f.before.manifest);
 }finally{f.cleanup();}
});
test('foreign credentials, weak permissions and unretained manifest drift refuse without overwriting',{skip:process.getuid()!==0},async()=>{
 const f=fixture();try{const p=await f.helper().prepare(f.input);await f.helper().publish(p);const changed={...JSON.parse(fs.readFileSync(f.paths.client)),key:randomBytes(32).toString('base64url')};fs.writeFileSync(f.paths.client,json(changed));await assert.rejects(f.helper().restore(p));assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.client)),changed);
 fs.writeFileSync(f.paths.client,f.before.client);fs.chmodSync(f.paths.runtime,0o644);await assert.rejects(f.helper().restore(p));fs.chmodSync(f.paths.runtime,0o640);fs.writeFileSync(f.paths.manifest,json({foreign:true}));await assert.rejects(f.helper().restore(p));
 }finally{f.cleanup();}
});

test('owned candidate and cutover journals bind explicit versions and store ordering without legacy reinterpretation',async()=>{
 const {prepareCandidateDeployment,inspectCandidateDeploymentHistory}=await import('../packages/zola-release/candidate-deployment.js');
 const {runVpsCutover,inspectVpsCutoverHistory}=await import('../packages/zola-release/commander-vps.js');
 const events=[],calls=[],done=new Set(),profile={backendProfile:'owned-postgres-v1',profileDigest:'1'.repeat(64)};
 const input={operationId:'11111111-1111-4111-8111-111111111111',releaseSha:oldSha,recoverySha:'c'.repeat(40),...profile};
 const ownedStore={version:1,releaseSha:oldSha,previousSha:'d'.repeat(40),origin:'https://fixture.vercel.app',...profile,retainedDigest:'2'.repeat(64)};
 const candidate={...input,runId:'22222222-2222-4222-8222-222222222222',previousSha:'d'.repeat(40),artifactDigest:'3'.repeat(64),recoveryArtifactDigest:'4'.repeat(64),previousArtifactDigest:'5'.repeat(64),stateDigest:'6'.repeat(64),ownedStore,
 receiverOrigin:{schema:1,mode:'preview',releaseSha:oldSha,origin:ownedStore.origin,deploymentId:'dpl_fixture',previousOrigin:null,previousDropin:false}};
 const journal={stream:()=>({events:()=>structuredClone(events),append:v=>events.push(structuredClone(v))})};
 const host={lease:()=>({assertIdentity(){},close(){}}),prepare:async()=>candidate,check(){},execute:async step=>{calls.push(step);done.add(step);},observe:async step=>done.has(step)};
 await prepareCandidateDeployment(input,{journal,host});assert.deepEqual(calls,['pointer','runtime','receivers','owned_store','reload']);assert.ok(events.every(e=>e.schema===2));assert.equal(inspectCandidateDeploymentHistory(events).completed,true);
 for(const mutate of [e=>e[0].schema=1,e=>delete e[0].profileDigest,e=>e[1].profileDigest='f'.repeat(64),e=>e[0].ownedStore.releaseSha=releaseSha]){const copy=structuredClone(events);mutate(copy);assert.throws(()=>inspectCandidateDeploymentHistory(copy));}
 const snapshot={ownedStore},p={operationId:'33333333-3333-4333-8333-333333333333',commanderRunId:input.operationId,epochRunId:'44444444-4444-4444-8444-444444444444',rollbackEpochRunId:'55555555-5555-4555-8555-555555555555',newMainSha:releaseSha,candidateSha:oldSha,rollbackSha:input.recoverySha,artifactDigest:'7'.repeat(64),candidateArtifactDigest:candidate.artifactDigest,candidateDeploymentDigest:hash(inspectCandidateDeploymentHistory(events).plan),rollbackArtifactDigest:candidate.recoveryArtifactDigest,backupDigest:'8'.repeat(64),backupManifestFile:'/protected/backup.json',admissionDigest:'9'.repeat(64),snapshotDigest:hash(snapshot),...profile};
 const order=[],observed=new Set();let failOnce=true;
 const vps={lease:host.lease,snapshot:()=>snapshot,execute:async step=>{order.push(step);observed.add(step);if(step==='store_start'&&failOnce){failOnce=false;throw new Error('lost acknowledgement');}},observe:async step=>step==='backup'||observed.has(step)};
 let result=await runVpsCutover({plan:p,journal},{host:vps});assert.equal(result.reason,'VPS_STEP_OUTCOME_UNKNOWN');result=await runVpsCutover({plan:p,journal,reconcile:true},{host:vps});assert.equal(result.status,'VPS_CUTOVER_COMPLETE');assert.equal(order.filter(s=>s==='store_start').length,1);assert.ok(order.indexOf('worker_start')<order.indexOf('store_start')&&order.indexOf('store_start')<order.indexOf('readiness'));
 const vpsRows=events.filter(e=>e.type.startsWith('vps_'));assert.ok(vpsRows.every(e=>e.schema===6));assert.equal(inspectVpsCutoverHistory(events).completed,true);
 for(const mutate of [e=>e[0].schema=5,e=>delete e[0].backendProfile,e=>e[1].profileDigest='f'.repeat(64)]){const copy=structuredClone(vpsRows);mutate(copy);assert.throws(()=>inspectVpsCutoverHistory(copy));}
});

test('exact journaled namespace staging symlink can reconcile while foreign staging refuses',{skip:process.getuid()!==0},async()=>{
 const f=fixture();try{const h=f.helper(),p=await h.prepare(f.input);await h.publish(p);fs.symlinkSync('releases/'+releaseSha,f.paths.current+'.owned-transition');await h.restore(p);assert.equal(fs.existsSync(f.paths.current+'.owned-transition'),false);assert.equal(h.restored(p),true);fs.symlinkSync('/foreign',f.paths.current+'.owned-transition');await assert.rejects(h.publish(p));assert.equal(fs.readlinkSync(f.paths.current+'.owned-transition'),'/foreign');
 }finally{f.cleanup();}
});

test('root transition resolves only the exact named private group without API process identity',()=>{assert.equal(resolveOwnedStoreTransitionGroup('blackspire-api',()=> 'blackspire-api:x:61011:\n'),61011);for(const output of ['blackspire:x:61011:','blackspire-api:x:0:','blackspire-api:x:61011:\nforeign:x:1:'])assert.throws(()=>resolveOwnedStoreTransitionGroup('blackspire-api',()=>output));});
test('stopped namespace rebinding removes only the empty prior systemd artifact mountpoint and restores it exactly',{skip:process.getuid()!==0},async()=>{const f=fixture();try{fs.mkdirSync(f.dir+'/releases');fs.mkdirSync(f.dir+'/releases/'+oldSha,{mode:0o755});const p=await f.helper().prepare(f.input);await f.helper().publish(p);assert.equal(fs.existsSync(f.dir+'/releases/'+oldSha),false);fs.mkdirSync(f.dir+'/releases/'+releaseSha,{mode:0o755});await f.helper().restore(p);assert.equal(fs.existsSync(f.dir+'/releases/'+releaseSha),false);assert.equal(fs.statSync(f.dir+'/releases/'+oldSha).mode&0o7777,0o755);fs.writeFileSync(f.dir+'/releases/'+oldSha+'/foreign','x');await assert.rejects(f.helper().publish(p));assert.equal(fs.readFileSync(f.dir+'/releases/'+oldSha+'/foreign','utf8'),'x');}finally{f.cleanup();}});


test('target SHA transition retains owner/job/profile and recovers lost publication without changing target data',{skip:process.getuid()!==0},async()=>{
 const f=fixture();try{const h=f.helper(),p=await h.prepare(f.input);f.crash(f.paths.target);await assert.rejects(h.publish(p));
 assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.target)),{...f.target,releaseSha});await h.publish(p);assert.equal(h.observe(p),true);
 await h.restore(p);assert.deepEqual(fs.readFileSync(f.paths.target),f.before.target);
 const bad={...f.target,profileDigest:'f'.repeat(64)};fs.writeFileSync(f.paths.target,json(bad));await assert.rejects(h.prepare(f.input));assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.target)),bad);
 }finally{f.cleanup();}
});
