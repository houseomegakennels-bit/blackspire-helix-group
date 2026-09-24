import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('mixed successor gateway chains prior completed receipt and retains initial installation',{skip:process.getuid?.()!==0},()=>{
 const output=execFileSync(process.execPath,['--experimental-test-module-mocks','--input-type=module','-e',String.raw`
 import {mock} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
 import * as history from './packages/zola-release/mixed-retirement-history.js';
 import {hash} from './packages/zola-release/commander-journal.js';
 const P={...history.MIXED_RETIREMENT};
 // Only the predecessor receipt digest changes to bind this disposable host.
 mock.module('./packages/zola-release/mixed-retirement-history.js',{namedExports:{...history,MIXED_RETIREMENT:P}});
 const {createOwnedSuccessorGatewayUnitFixture}=await import('./tests/owned-successor-gateway-unit-fixture.js');
 const g=await import('./packages/buyer-writer/owned-successor-gateway-unit.js');
 const {renderGatewayUnit,GATEWAY_SERVICE}=await import('./packages/buyer-writer/gateway-installation.js');
 const f=createOwnedSuccessorGatewayUnitFixture({releaseSha:P.releaseSha,operationId:P.operationId,artifactDigest:P.artifactDigest});
 try{
  await g.installOwnedSuccessorGatewayUnit(await g.prepareOwnedSuccessorGatewayUnit(f.input,f.deps));
  const previous=g.readOwnedSuccessorGatewayUnitReceipt({releaseSha:P.releaseSha,operationId:P.operationId,artifactDigest:P.artifactDigest},{paths:f.paths});
  P.gatewayReceiptDigest=hash(previous);
  const oldState=fs.readFileSync(f.paths.oldState,'utf8'),oldRetirement=fs.readFileSync(f.paths.retirement,'utf8');
  const paths={...f.paths,predecessorRetirement:f.paths.retirement,retirement:f.root+'/mixed-retirement.json'};
  const input={releaseSha:P.successorReleaseSha,operationId:P.successorOperationId,attemptId:'33333333-3333-4333-8333-333333333333',
   profileDigest:P.profileDigest,successorLineageFile:'/var/lib/blackspire-operator/owned-migration-successors/'+P.successorOperationId+'/plan.json'};
  const proof={version:1,runId:P.runId,currentSha:P.releaseSha,hostStopped:true,noDetachedSurvivors:true,authorityInactive:true,
   bindingRetained:true,retainedEffects:true,retainedEvidenceDigest:P.retainedEvidenceDigest,acceptanceDigest:P.acceptanceDigest,
   collectorDigest:P.collectorDigest,transitionDigest:P.transitionDigest,stopPlanDigest:'a'.repeat(64),stopResultDigest:'b'.repeat(64),
   protectedStateDigest:'c'.repeat(64),successorArtifactDigest:P.successorArtifactDigest,lineageDigest:P.lineageDigest};
  const retirement={schema:6,type:'sequence_retired',operationId:P.operationId,releaseSha:P.releaseSha,attemptId:P.attemptId,
   ordinal:13,stage:'six_reads',prefixDigest:P.prefixDigest,segmentDigest:P.segmentDigest,successorReleaseSha:P.successorReleaseSha,
   successorOperationId:P.successorOperationId,backendProfile:'owned-postgres-v1',profileDigest:P.profileDigest,proof,proofDigest:hash(proof)};
  history.validateMixedRetirementEvent(retirement);f.put(paths.retirement,JSON.stringify(retirement)+'\n');
  const template=fs.readFileSync('./ops/runtime-ownership/'+GATEWAY_SERVICE,'utf8');
  f.put(paths.releases+'/'+P.successorReleaseSha+'/ops/runtime-ownership/'+GATEWAY_SERVICE,template,0o644);
  f.switchPointer();let fresh=false,reloads=0;
  const deps={...f.deps,paths,verifyRetirement:async()=>retirement,held:()=>({version:1,mode:'held',releaseSha:P.releaseSha,runId:P.runId,apiGeneration:null,workerGeneration:null}),
   observeLineage:async()=>({status:'OWNED_MIGRATION_SUCCESSOR_VERIFIED',releaseSha:P.successorReleaseSha,operationId:P.successorOperationId,
    profileDigest:P.profileDigest,lineageDigest:P.lineageDigest,sourceWritesDenied:true,targetBrowserSecurityVerified:true,dataCopied:false,hardeningReapplied:false}),
   inspectSealed:async({releaseSha})=>({releaseSha,artifactDigest:P.successorArtifactDigest,environment:'production',status:'SEALED_ARTIFACT_VERIFIED',deployed:false,productionAccepted:false}),
   run:args=>{if(args[0]==='daemon-reload'){fresh=true;reloads++;return '';}
    return 'LoadState=loaded\nFragmentPath='+paths.unit+'\nDropInPaths=\nNeedDaemonReload=no\nWorkingDirectory=/opt/blackspire-command/releases/'+(fresh?P.successorReleaseSha:P.releaseSha);}};
  const plan=await g.prepareOwnedSuccessorGatewayUnit(input,deps);
  await g.installOwnedSuccessorGatewayUnit(plan);
  assert.equal(fs.readFileSync(paths.unit,'utf8'),renderGatewayUnit(template,{sha:P.successorReleaseSha}));
  await g.installOwnedSuccessorGatewayUnit(plan);assert.equal(reloads,1);
  await g.observeOwnedSuccessorGatewayUnit(input,deps);
  const result=g.readOwnedSuccessorGatewayUnitReceipt({releaseSha:P.successorReleaseSha,operationId:P.successorOperationId,artifactDigest:P.successorArtifactDigest},{paths});
  assert.equal(result.dependencies.length,9);
  assert.equal(fs.readFileSync(paths.oldState,'utf8'),oldState);assert.equal(fs.readFileSync(paths.predecessorRetirement,'utf8'),oldRetirement);
  const priorResult=paths.root+'/'+P.operationId+'/result.json',saved=fs.readFileSync(priorResult,'utf8');
  f.put(priorResult,saved.replace('VERIFIED','TAMPERED'));
  assert.throws(()=>g.readOwnedSuccessorGatewayUnitReceipt({releaseSha:P.successorReleaseSha,operationId:P.successorOperationId,artifactDigest:P.successorArtifactDigest},{paths}));
  console.log('mixed gateway chain passed');
 }finally{f.close();}
 `],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C'},stdio:['ignore','pipe','pipe'],timeout:60000});
 assert.equal(output.trim(),'mixed gateway chain passed');
});
