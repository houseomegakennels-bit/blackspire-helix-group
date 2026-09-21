import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import {once} from 'node:events';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {registerHooks,stripTypeScriptTypes} from 'node:module';

test('candidate and live HELD worker dispatch reaches real frontend authority validator and API callback exactly once',{skip:process.getuid()!==0},async t=>{
 const root=fs.mkdtempSync('/root/zola-held-callback-http-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const roles=new AsyncLocalStorage(),apiGeneration='1'.repeat(32),workerGeneration='2'.repeat(32);let binding;
 const symbol=Symbol.for('zola-held-callback-test-context');globalThis[symbol]=()=>{const role=roles.getStore()??'api';return{...binding,role,generation:role==='api'?apiGeneration:workerGeneration};};t.after(()=>delete globalThis[symbol]);
 const target=new URL('../packages/shared/release-admission.js',import.meta.url).href;let compositions=0;
 const hook=registerHooks({load(url,context,next){const loaded=next(url,context);if(url!==target)return loaded;compositions++;
  let source=String(loaded.source).replace("export const RELEASE_ADMISSION_ROOT='/etc/blackspire/release-admission';",`export const RELEASE_ADMISSION_ROOT=${JSON.stringify(root)};`);
  const start=source.indexOf('export function currentReleaseAdmissionContext('),end=source.indexOf('\n}',start)+2;
  assert.ok(start>=0&&end>start);source=source.slice(0,start)+"export function currentReleaseAdmissionContext(){return globalThis[Symbol.for('zola-held-callback-test-context')]();}"+source.slice(end);
  return{...loaded,source};}});t.after(()=>hook.deregister());
 process.env.BLACKSPIRE_DB_PATH=path.join(root,'command.sqlite');process.env.BLACKSPIRE_RUNTIME_MODE='test';process.env.COMMAND_ADMIN_TOKEN='synthetic-callback-administrator-token';process.env.ALLOW_BEARER_AUTH='true';
 process.env.BLACKSPIRE_OPERATOR_PRINCIPAL_ID='blackspire-operator';process.env.BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN='synthetic-distinct-consumer-token-0000';
 const {prepareDisposableDatabase}=await import('./helpers/prepare-disposable-database.js');prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
 const db=await import('../packages/task-engine/db.js'),tasks=await import('../packages/task-engine/tasks.js');
 const {upsertWorkspace}=await import('../packages/workspace-registry/workspaces.js');upsertWorkspace({id:'blackspire-command',name:'callback fixture',githubRepository:'owner/repo',rootPath:'.',providerPolicy:{preferred:['mock']},budgetCents:1});
 const issued=Date.now();db.run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',['blackspire-operator','admin','blackspire-operator','bearer',null,'active',issued,null,null,null,1,issued]);
 db.run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[randomUUID(),'blackspire-operator','blackspire-command','admin',JSON.stringify(['task.create','task.read','task.execute','workspace.read','seller.opportunities.read','buyer.profiles.read','buyer.matches.read','deal.records.read','deal.analysis.read','nexus.enrichment.read']),'active',1,null,issued,null,null,'synthetic-test',1,issued]);
 const {start,beginGracefulShutdown}=await import('../apps/api/server.js'),{startWorker}=await import('../apps/worker/worker.js');
 const {processTask}=await import('../packages/hermes/hermes.js'),{recordWorkerHeartbeat}=await import('../packages/task-engine/runtime-status.js');
 const {createDivisionAdapters}=await import('../packages/capabilities/http-adapters.js'),{readCases}=await import('../packages/zola-six-reads/collector.js'),{hash}=await import('../packages/zola-release/commander-journal.js');
 const server=roles.run('api',()=>start(0,'127.0.0.1',{exitOnListenError:false}));await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{delete process.env.BLACKSPIRE_RELEASE_RUN_ID;server.closeAllConnections();await beginGracefulShutdown(server,{deadlineMs:1000});});
 const write=(name,value)=>{fs.writeFileSync(path.join(root,name),typeof value==='string'?value:JSON.stringify(value)+'\n',{mode:0o640});};write('admission.lock','ZOLA_RELEASE_ADMISSION_LOCK_V1\n');
 const frontendSource=fs.readFileSync(new URL('../frontend/src/lib/internal-capability-auth.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export type .*;\n/gm,'').replace('export async function','async function');
 const capabilityToken='synthetic-capability-token-boundary-0000';let receiverCalls=0,callbacks=0,receiverError,activeTask,authorize,permitFiles;
 const callback=(authority,token=process.env.BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN)=>fetch(base+'/api/internal/capability-authority/consume',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({authority}),signal:AbortSignal.timeout(2000)});
 const snapshot=id=>JSON.stringify({attempt:db.get('SELECT * FROM provider_attempts WHERE id=?',[id]),usage:db.all('SELECT * FROM provider_usage ORDER BY id')});
 const receiver=http.createServer(async(req,res)=>{try{
  receiverCalls++;let body='';for await(const chunk of req)body+=chunk;
  const authority=JSON.parse(Buffer.from(req.headers['x-blackspire-receiver-authority'],'base64url').toString());assert.equal(authority.taskId,activeTask);
  assert.equal(db.get('SELECT status FROM provider_attempts WHERE id=?',[authority.attemptId]).status,'dispatching');
  for(const [change,token] of [[{},'wrong-token'],[{taskId:'unrelated-task'}],[{apiGeneration:'f'.repeat(32)}],[{issuedAt:Date.now()-16000,expiresAt:Date.now()-1000}]]){
   const before=snapshot(authority.attemptId),response=await callback({...authority,...change},token);assert.ok([404,503].includes(response.status));assert.equal(snapshot(authority.attemptId),before);
  }
  const denyUnchanged=async()=>{const before=snapshot(authority.attemptId);assert.ok([404,503].includes((await callback(authority)).status));assert.equal(snapshot(authority.attemptId),before);};
  for(const column of ['request','idempotency_key']){
   const original=db.get('SELECT '+column+' AS value FROM tasks WHERE id=?',[authority.taskId]).value;
   db.run('UPDATE tasks SET '+column+'=? WHERE id=?',['unpermitted-task-value',authority.taskId]);
   try{await denyUnchanged();}finally{db.run('UPDATE tasks SET '+column+'=? WHERE id=?',[original,authority.taskId]);}
  }
  db.run("UPDATE auth_workspace_grants SET status='revoked' WHERE principal_id='blackspire-operator'");
  try{await denyUnchanged();}finally{db.run("UPDATE auth_workspace_grants SET status='active' WHERE principal_id='blackspire-operator'");}
  const originalClaims=fs.readFileSync(permitFiles.claims),originalActive=fs.readFileSync(permitFiles.active);
  fs.unlinkSync(permitFiles.active);try{await denyUnchanged();}finally{fs.writeFileSync(permitFiles.active,originalActive,{mode:0o640});}
  const expiredClaims={...JSON.parse(originalClaims),issuedAt:Date.now()-61000,expiresAt:Date.now()-1000};
  fs.writeFileSync(permitFiles.claims,JSON.stringify(expiredClaims));fs.writeFileSync(permitFiles.active,JSON.stringify({...JSON.parse(originalActive),claimsDigest:hash(expiredClaims),expiresAt:expiredClaims.expiresAt}));
  try{await denyUnchanged();}finally{fs.writeFileSync(permitFiles.claims,originalClaims);fs.writeFileSync(permitFiles.active,originalActive);}
  const tasksBefore=db.get('SELECT count(*) AS n FROM tasks').n;
  assert.equal((await fetch(base+'/api/tasks',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN},body:JSON.stringify({workspaceId:'blackspire-command',request:'bypass'})})).status,503);
  assert.equal(db.get('SELECT count(*) AS n FROM tasks').n,tasksBefore);
  const request=new Request(`http://127.0.0.1:${receiver.address().port}${req.url}`,{method:req.method,headers:req.headers,body});
  const authorized=await authorize(request,body,'blackspire-command','seller.opportunities.search');assert.ok(authorized);
  assert.equal(db.get('SELECT status FROM provider_attempts WHERE id=?',[authority.attemptId]).status,'started');
  const before=snapshot(authority.attemptId);assert.equal((await callback(authority)).status,404);assert.equal(snapshot(authority.attemptId),before);
  res.writeHead(200,{'content-type':'application/json','x-blackspire-authority-binding':authorized.bindingDigest});res.end(JSON.stringify({opportunities:[],sourceSnapshotAt:new Date().toISOString()}));
 }catch(error){receiverError=error;res.writeHead(500);res.end('{}');}});
 await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve));t.after(async()=>{receiver.closeAllConnections();await new Promise(resolve=>receiver.close(resolve));});
 const adapters=createDivisionAdapters({BLACKSPIRE_SELLER_CAPABILITY_URL:`http://127.0.0.1:${receiver.address().port}`,BLACKSPIRE_SELLER_CAPABILITY_TOKEN:capabilityToken});
 for(const premerge of [true,false]){
  const releaseSha=(premerge?'a':'b').repeat(40),epoch=randomUUID(),token=randomBytes(32).toString('base64url');binding={releaseSha,runId:epoch,apiGeneration,workerGeneration};process.env.BLACKSPIRE_RELEASE_RUN_ID=epoch;
  write('state.json',{version:1,mode:'held',releaseSha,runId:epoch,apiGeneration:premerge?null:apiGeneration,workerGeneration:premerge?null:workerGeneration});
  const reads=readCases('DE-0001').map((row,index)=>{const idempotencyKey=`zola-six:${epoch}:${index}`;return{index,idempotencyKey,capability:row.capability,permission:row.permissions[0],request:row.text,requestDigest:hash({channel:'jarvis',workspaceId:'blackspire-command',text:row.text,idempotencyKey,executionIntent:'read_only'})};});
  const claims={schema:1,kind:premerge?'held-premerge-reads':'held-epoch-acceptance',permitId:randomUUID(),commanderRunId:randomUUID(),[premerge?'candidateSha':'mergeMainSha']:releaseSha,expectedDeploymentSha:releaseSha,epochRunId:epoch,workspace:'blackspire-command',principal:'blackspire-operator',apiGeneration,workerGeneration,issuedAt:Date.now(),expiresAt:Date.now()+60000,operations:premerge?['six_reads']:['api_health','worker_readiness','generation_fence','six_live_reads','production_smoke','zero_paid_nexus','zero_unintended_mutation','rollback_verification'],reads,tokenDigest:hash(token)};
  write(premerge?'premerge-reads.json':'acceptance.json',claims);write(premerge?'premerge-reads-active.json':'acceptance-active.json',{schema:1,kind:premerge?'held-premerge-reads-active':'held-acceptance-active',permitId:claims.permitId,claimsDigest:hash(claims),operation:premerge?'six_reads':'six_live_reads',attemptId:randomUUID(),expiresAt:claims.expiresAt});
  permitFiles={claims:path.join(root,premerge?'premerge-reads.json':'acceptance.json'),active:path.join(root,premerge?'premerge-reads-active.json':'acceptance-active.json')};
  authorize=vm.runInNewContext(`${stripTypeScriptTypes(frontendSource)}\nauthorizeInternalCapability`,{Buffer,URL,TextDecoder,AbortSignal,createHash,timingSafeEqual,Date,process:{env:{BLACKSPIRE_CAPABILITY_TOKEN:capabilityToken,BLACKSPIRE_SELLER_ENGINE_WORKSPACE_ID:'blackspire-command',VERCEL_GIT_COMMIT_SHA:releaseSha,BLACKSPIRE_AUTHORITY_CONSUMER_URL:base,BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN:process.env.BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN}},fetch:async(...args)=>{callbacks++;return fetch(...args);}});
  const request={channel:'jarvis',workspaceId:'blackspire-command',text:reads[0].request,idempotencyKey:reads[0].idempotencyKey,executionIntent:'read_only'};
  const headers={'content-type':'application/json',authorization:'Bearer '+process.env.COMMAND_ADMIN_TOKEN,[premerge?'x-blackspire-held-premerge':'x-blackspire-held-acceptance']:token};
  const accepted=await fetch(base+'/api/unified-input',{method:'POST',headers,body:JSON.stringify(request)});assert.equal(accepted.status,202);activeTask=(await accepted.json()).taskId;
  await roles.run('worker',()=>startWorker({once:true,processTaskImpl:(task,ownership)=>processTask(task,{...ownership,capabilityOptions:{adapters}}),recordHeartbeatImpl:input=>recordWorkerHeartbeat({...input,generationId:workerGeneration}),deliverEventsImpl:async()=>assert.fail('HELD must not drain outbox')}));
  if(receiverError)throw receiverError;
  assert.equal(tasks.getTask(activeTask).status,'completed');assert.equal((await fetch(base+'/ready')).status,503);
  fs.unlinkSync(path.join(root,premerge?'premerge-reads-active.json':'acceptance-active.json'));
 }
 assert.equal(receiverCalls,2);assert.equal(callbacks,2);assert.equal(compositions,1);
});
