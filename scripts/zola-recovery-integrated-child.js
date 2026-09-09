#!/usr/bin/env node
// Actual fixed API -> separate fixed worker -> exact fixed Next HTTP routes.
// All identities and database responses are disposable synthetic fixtures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { RECOVERY_SHA, RECOVERY_ARTIFACT } from '../packages/zola-rollback/intake.js';
import { startRecoveryFrontend, assertRecoveryIsolation } from '../packages/zola-rollback/frontend-fixture.js';
import { rehearseRecoveryBoot } from '../packages/zola-rollback/boot.js';
import { prepareDisposableDatabase } from '../tests/helpers/prepare-disposable-database.js';
import { readCases } from '../packages/zola-six-reads/collector.js';
import { cases } from '../packages/zola-six-reads/offline.js';
import { computeArtifactDigest } from '../packages/shared/release-evidence.js';

let frontend, closeDb;
try {
  assert.equal(process.argv.length, 2);
  assert.deepEqual(Object.keys(process.env).sort(), ['PATH','NODE_NO_WARNINGS','ZOLA_SIX_READ_DISPOSABLE_DIR','ZOLA_CANDIDATE_PARENT_NET'].sort());
  assertRecoveryIsolation();
  const root=process.env.ZOLA_SIX_READ_DISPOSABLE_DIR;
  assert.deepEqual(fs.readdirSync(root), []);
  frontend=await startRecoveryFrontend(root);
  const artifact=`/var/lib/blackspire-zola-rehearsal/releases/${RECOVERY_SHA}`;
  assert.equal(computeArtifactDigest(artifact), RECOVERY_ARTIFACT);
  process.env.BLACKSPIRE_DB_PATH=path.join(root,'command.sqlite');
  process.env.BLACKSPIRE_DATA_DIR=root;
  process.env.BLACKSPIRE_RUNTIME_MODE='test';
  const cwd=process.cwd(); process.chdir(artifact);
  try { prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH); } finally { process.chdir(cwd); }
  const load=name=>import(pathToFileURL(path.join(artifact,name)).href);
  const db=await load('packages/task-engine/db.js'); closeDb=db.closeDb;
  const { upsertWorkspace }=await load('packages/workspace-registry/workspaces.js');
  const { blackspireCapabilityRegistry }=await load('packages/capabilities/index.js');
  const { validateCapabilityOutput }=await load('packages/capabilities/contract.js');
  const principalId='recovery-owner', timestamp=Date.now();
  const permissions=['task.create','task.execute','task.read','workspace.read',...readCases('DE-0001').flatMap(row=>row.permissions)];
  upsertWorkspace({id:frontend.workspace,name:'Recovery integrated fixture',githubRepository:'local/recovery',rootPath:root,providerPolicy:{preferred:['mock']},budgetCents:0});
  db.run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[principalId,'admin',principalId,'bearer',null,'active',timestamp,null,null,null,1,timestamp]);
  db.run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',['recovery-grant',principalId,frontend.workspace,'service',JSON.stringify([...new Set(permissions)].sort()),'active',1,null,timestamp,null,null,'fixture',1,timestamp]);
  const snapshot=()=>['tasks','unified_inputs','conversations','provider_attempts','provider_usage'].map(table=>db.all(`SELECT * FROM ${table} ORDER BY rowid`));
  const boot=await rehearseRecoveryBoot({artifact,root,frontend,principalId,exercise:async({base,token,apiGeneration,workerGeneration,apiPid,workerPid})=>{
    assert.notEqual(apiPid,workerPid); assert.notEqual(apiPid,process.pid); assert.notEqual(workerPid,process.pid);
    const post=async(body,credential=token)=>{
      const response=await fetch(`${base}/api/tasks`,{method:'POST',redirect:'error',headers:{'content-type':'application/json',...(credential?{authorization:`Bearer ${credential}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(2000)});
      const text=await response.text(); assert.ok(text.length<128*1024);return {status:response.status,body:JSON.parse(text)};
    };
    const reads=[];
    for(const [index,entry] of readCases('DE-0001').entries()){
      const input={workspaceId:frontend.workspace,request:entry.text,executionIntent:'read_only',idempotencyKey:randomUUID()};
      const before=snapshot(),eventCount=frontend.events.length;
      assert.equal((await post(input,null)).status,401);
      assert.equal((await post(input,'wrong-recovery-credential')).status,401);
      assert.equal((await post({...input,workspaceId:'foreign-workspace'})).status,404);
      assert.deepEqual(snapshot(),before); assert.equal(frontend.events.length,eventCount);
      const admitted=await post(input); assert.equal(admitted.status,202,`${entry.capability} admission failed`);
      const taskId=admitted.body.task.id, deadline=Date.now()+60000;
      let task;
      while(Date.now()<deadline){
        task=db.get('SELECT * FROM tasks WHERE id=?',[taskId]);
        if(['completed','failed','outcome_unknown'].includes(task?.status))break;
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      assert.equal(task?.status,'completed',`${entry.capability} actual worker did not complete`);
      assert.equal(task.actor_id,principalId); assert.equal(task.workspace_id,frontend.workspace);
      assert.equal(task.source_channel,'api'); assert.equal(task.execution_intent,'read_only');
      assert.equal(task.authority_class,'authenticated_admin'); assert.equal(task.idempotency_key,input.idempotencyKey);
      assert.equal(task.worker_id,'recovery-boot'); assert.equal(task.request,entry.text);
      const attempts=db.all('SELECT * FROM provider_attempts WHERE task_id=?',[taskId]);
      assert.equal(attempts.length,1); const attempt=attempts[0];
      assert.equal(attempt.provider,'blackspire-capability'); assert.equal(attempt.mode,entry.capability); assert.equal(attempt.status,'completed');
      const packet=JSON.parse(attempt.request_packet), evidence=JSON.parse(task.evidence);
      assert.equal(packet.principalId,principalId); assert.equal(packet.workspaceId,frontend.workspace); assert.equal(packet.workerId,task.worker_id);
      assert.equal(packet.claimDigest,createHash('sha256').update(task.claim_token).digest('hex'));
      const result=validateCapabilityOutput(blackspireCapabilityRegistry.get(entry.capability),JSON.parse(attempt.response_packet).result);
      const collection=cases[index].collection;
      const count=collection?result[collection].length:result.found===false||result.source===null?0:1;
      assert.ok(count>0&&count<=5); assert.equal(evidence.resultCount,count); assert.equal(evidence.capabilityId,entry.capability); assert.equal(evidence.readOnly,true);
      assert.deepEqual(evidence.changedFiles,[]); assert.ok(frontend.events.length>eventCount);
      const after=snapshot(),afterEvents=frontend.events.length;
      const replay=await post(input); assert.equal(replay.status,202); assert.equal(replay.body.task.id,taskId);
      assert.deepEqual(snapshot(),after); assert.equal(frontend.events.length,afterEvents);
      reads.push({capability:entry.capability,route:entry.route,status:'PASS_FIXED_PROCESS_HTTP',boundedResultCount:count,taskId,receiptId:attempt.id,
        apiGeneration,workerGeneration,apiPid,workerPid,authorityBinding:true,claimReceiptBinding:true,idempotentReplay:true,
        anonymousDenial:true,wrongCredentialDenial:true,foreignWorkspaceDenial:true,databaseRequests:afterEvents-eventCount});
    }
    db.run("UPDATE auth_workspace_grants SET status='superseded' WHERE id='recovery-grant'");
    const revoked=snapshot(),eventCount=frontend.events.length;
    assert.equal((await post({workspaceId:frontend.workspace,request:readCases('DE-0001')[0].text,executionIntent:'read_only',idempotencyKey:randomUUID()})).status,404);
    assert.deepEqual(snapshot(),revoked); assert.equal(frontend.events.length,eventCount);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks').n,6);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM provider_attempts').n,6);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM provider_usage WHERE cost_cents>0').n,0);
    frontend.assertIntegrity();
    return {reads,revokedGrantDenied:true,paidUsageRows:0};
  }});
  frontend.assertIntegrity();
  const report={version:1,status:'PASS_FIXED_INTEGRATED_HTTP',recoverySha:RECOVERY_SHA,artifactDigest:RECOVERY_ARTIFACT,
    sourceDigest:frontend.sourceDigest,archiveDigest:frontend.archiveDigest,productionAccepted:false,
    observedDatabaseMutationAttempts:0,externalNetwork:'kernel isolated; loopback only',boot,
    limitations:['Next development runtime; installed dependency integrity unverified','Synthetic identities and database; no live owner-policy proof',
      'Disposable process supervision; no systemd activation or production generation fence','No historical URL containment or full functional rollback acceptance']};
  // Success is exposed only after owned services, database and checkout close.
  closeDb(); closeDb=null; await frontend.close(); frontend=null;
  process.stdout.write(JSON.stringify(report)+'\n');
}catch(error){process.stderr.write(`Integrated recovery failed: ${String(error.message).slice(0,180)}\n`);process.exitCode=1;}
finally{closeDb?.();await frontend?.close();}
