import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';

test('actual API and worker admit only candidate six-read authority while ordinary and alternate HTTP paths stay HELD',{skip:process.getuid()!==0},async t=>{
 const root=fs.mkdtempSync('/root/zola-premerge-http-'),epoch=randomUUID(),releaseSha='a'.repeat(40),apiGeneration='1'.repeat(32),workerGeneration='2'.repeat(32);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const target=new URL('../packages/shared/release-admission.js',import.meta.url).href;let compositions=0;
 const binding={releaseSha,runId:epoch,apiGeneration,workerGeneration};
 const hook=registerHooks({load(url,context,next){const loaded=next(url,context);if(url!==target)return loaded;compositions++;
  let source=String(loaded.source);source=source.replace("export const RELEASE_ADMISSION_ROOT='/etc/blackspire/release-admission';",`export const RELEASE_ADMISSION_ROOT=${JSON.stringify(root)};`);
  source=source.replaceAll('context=currentReleaseAdmissionContext',`context=()=>({...${JSON.stringify(binding)},role:process.env.TEST_PREMERGE_ROLE||'api',generation:process.env.TEST_PREMERGE_ROLE==='worker'?${JSON.stringify(workerGeneration)}:${JSON.stringify(apiGeneration)}})`);
  return{...loaded,source};}});t.after(()=>hook.deregister());
 const dbPath=`.blackspire-command/premerge-http-${process.pid}.sqlite`;
 process.env.BLACKSPIRE_DB_PATH=dbPath;process.env.COMMAND_ADMIN_TOKEN='synthetic-premerge-http-administrator';process.env.ALLOW_BEARER_AUTH='true';process.env.BLACKSPIRE_OPERATOR_PRINCIPAL_ID='blackspire-operator';
 const {prepareDisposableDatabase}=await import('./helpers/prepare-disposable-database.js');prepareDisposableDatabase(dbPath);
 const db=await import('../packages/task-engine/db.js'),tasks=await import('../packages/task-engine/tasks.js');
 const issued=Date.now();db.run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',['blackspire-operator','admin','blackspire-operator','bearer',null,'active',issued,null,null,null,1,issued]);
 db.run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[randomUUID(),'blackspire-operator','blackspire-command','admin',JSON.stringify(['task.create','task.read','seller.opportunities.read','buyer.profiles.read','buyer.matches.read','deal.records.read','deal.analysis.read','nexus.enrichment.read']),'active',1,null,issued,null,null,'synthetic-test',1,issued]);
 const {start,beginGracefulShutdown}=await import('../apps/api/server.js');const {startWorker}=await import('../apps/worker/worker.js');
 const {readCases}=await import('../packages/zola-six-reads/collector.js');const {hash}=await import('../packages/zola-release/commander-journal.js');
 const ordinary=tasks.createTask({workspaceId:'blackspire-command',request:'ordinary work must not run',idempotencyKey:'ordinary-premerge-outside-permit'});
 const server=start(0,'127.0.0.1',{exitOnListenError:false});await once(server,'listening');
 t.after(async()=>{delete process.env.BLACKSPIRE_RELEASE_RUN_ID;delete process.env.TEST_PREMERGE_ROLE;server.closeAllConnections();await beginGracefulShutdown(server,{deadlineMs:1000});});
 const write=(name,value,mode=0o640)=>{const file=path.join(root,name);fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value)+'\n',{mode});fs.chmodSync(file,mode);};
 write('admission.lock','ZOLA_RELEASE_ADMISSION_LOCK_V1\n');write('state.json',{version:1,mode:'held',releaseSha,runId:epoch,apiGeneration:null,workerGeneration:null});
 const token=randomBytes(32).toString('base64url'),reads=readCases('DE-0001').map((row,index)=>{const idempotencyKey=`zola-six:${epoch}:${index}`;
  return{index,idempotencyKey,capability:row.capability,permission:row.permissions[0],request:row.text,requestDigest:hash({channel:'jarvis',workspaceId:'blackspire-command',text:row.text,idempotencyKey,executionIntent:'read_only'})};});
 const claims={schema:1,kind:'held-premerge-reads',permitId:randomUUID(),commanderRunId:randomUUID(),candidateSha:releaseSha,expectedDeploymentSha:releaseSha,
  epochRunId:epoch,workspace:'blackspire-command',principal:'blackspire-operator',apiGeneration,workerGeneration,issuedAt:Date.now(),expiresAt:Date.now()+60000,
  operations:['six_reads'],reads,tokenDigest:hash(token)};
 write('premerge-reads.json',claims);write('premerge-reads-active.json',{schema:1,kind:'held-premerge-reads-active',permitId:claims.permitId,claimsDigest:hash(claims),
  operation:'six_reads',attemptId:randomUUID(),expiresAt:claims.expiresAt});process.env.BLACKSPIRE_RELEASE_RUN_ID=epoch;
 const base=`http://127.0.0.1:${server.address().port}`,headers={'content-type':'application/json',authorization:'Bearer '+process.env.COMMAND_ADMIN_TOKEN};
 const body={channel:'jarvis',workspaceId:'blackspire-command',text:reads[0].request,idempotencyKey:reads[0].idempotencyKey,executionIntent:'read_only'};
 const send=(route,value,extra={})=>fetch(base+route,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(value),signal:AbortSignal.timeout(2000)});
 const count=()=>db.get('SELECT count(*) AS n FROM tasks').n,before=count();
 for(const extra of [{},{'x-blackspire-held-premerge':'x'.repeat(43)},{'x-blackspire-held-acceptance':token},{'x-blackspire-held-premerge':token,'x-blackspire-held-acceptance':token}])
  assert.equal((await send('/api/unified-input',body,extra)).status,503);
 assert.equal(count(),before);
 assert.equal((await send('/api/tasks',{workspaceId:'blackspire-command',request:'bypass'},{'x-blackspire-held-premerge':token})).status,503);
 assert.equal((await send('/api/unified-input',{...body,idempotencyKey:'unbounded-key'},{'x-blackspire-held-premerge':token})).status,503);
 assert.equal(count(),before);
 const accepted=await send('/api/unified-input',body,{'x-blackspire-held-premerge':token});assert.equal(accepted.status,202);const result=await accepted.json();
 assert.equal(count(),before+1);assert.equal(db.get('SELECT idempotency_key FROM tasks WHERE id=?',[result.taskId]).idempotency_key,'unified:jarvis:'+reads[0].idempotencyKey);
 process.env.TEST_PREMERGE_ROLE='worker';let dispatched=0;
 await startWorker({once:true,processTaskImpl:async task=>{dispatched++;assert.equal(task.id,result.taskId);},deliverEventsImpl:async()=>{throw new Error('outbox must not run');},recordHeartbeatImpl:()=>{}});
 assert.equal(dispatched,1);assert.equal(db.get('SELECT status FROM tasks WHERE id=?',[ordinary.id]).status,'queued');
 process.env.TEST_PREMERGE_ROLE='api';fs.unlinkSync(path.join(root,'premerge-reads-active.json'));
 assert.equal((await send('/api/unified-input',{...body,text:reads[1].request,idempotencyKey:reads[1].idempotencyKey},{'x-blackspire-held-premerge':token})).status,503);
 assert.equal((await fetch(base+'/ready')).status,503);assert.equal(compositions,1);
});
