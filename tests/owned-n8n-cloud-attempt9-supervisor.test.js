import {interruptedFixture} from "./helpers/owned-n8n-cloud-interrupted.js";
import test from 'node:test';import assert from 'node:assert/strict';
import {cloudProofDigest as hash} from '../packages/zola-release/owned-n8n-cloud-workflow.js';
import {ownedN8nAttempt9SupervisorArguments,validateOwnedN8nAttempt9Supervisor,awaitOwnedN8nAttempt9SupervisorAcknowledgment} from '../packages/zola-release/owned-n8n-cloud-attempt9-supervisor.js';
test('READY and completion bind exact supervisor intent, unit, PID start and invocation',()=>{
 const f=interruptedFixture(),plan={...f.records.plan,attempt:9,predecessorInterruptionDigest:'f'.repeat(64)},operatorRoot='/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt9-20260921',root='/var/lib/blackspire-operator/preparation/owned-n8n-cloud-proof/a8e05ef40e44b6695df5b30356af0e411fe36f1a-c8b00904-7017-434a-918e-8aaadbae82fd-attempt9';
 const command=['/opt/nodejs/node-v22.23.1-linux-x64/bin/node',operatorRoot+'/scripts/zola-n8n-cloud-proof-attempt9.js','--serve'];
 const properties={Type:'exec',User:'root',Group:'root',UMask:'0077',RuntimeMaxUSec:'17min',TimeoutStopUSec:'40s',Restart:'no',KillMode:'control-group',RemainAfterExit:'yes',NoNewPrivileges:'yes',ActiveState:'active',SubState:'running',MainPID:'1234',InvocationID:'a'.repeat(32),Result:'success',ExecMainStatus:'0',ExecStart:'{ path='+command[0]+' ; argv[]='+command.join(' ')+' ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=1234 ; code=(null) ; status=0/0 }'};
 const intent={version:1,planDigest:hash(plan),unit:'zola-n8n-cloud-proof-attempt9.service',argumentsDigest:hash(ownedN8nAttempt9SupervisorArguments({operatorRoot,root}))},process={pid:1234,uid:0,startTime:'987654',command},input={plan,operatorRoot,root,intent,properties,process,phase:'launch'};
 const supervisor=validateOwnedN8nAttempt9Supervisor(input),result={version:1,planDigest:hash(plan),unit:intent.unit,started:true,supervisor};assert.deepEqual(validateOwnedN8nAttempt9Supervisor({...input,result,phase:'ready'}),supervisor);
 for(const key of Object.keys(properties).filter(k=>!['Result','ExecMainStatus'].includes(k)))assert.throws(()=>validateOwnedN8nAttempt9Supervisor({...input,result,phase:'ready',properties:{...properties,[key]:'foreign'}}));
 for(const patch of [{intent:null},{result:null},{process:{...process,startTime:'999'}},{process:{...process,command:['foreign']}}])assert.throws(()=>validateOwnedN8nAttempt9Supervisor({...input,result,phase:'ready',...patch}));
 const complete={...input,result,phase:'complete',properties:{...properties,MainPID:'0',SubState:'exited'}};assert.deepEqual(validateOwnedN8nAttempt9Supervisor(complete),supervisor);assert.throws(()=>validateOwnedN8nAttempt9Supervisor({...complete,properties:{...complete.properties,ExecMainStatus:'1'}}));
});

test('child-first launch waits for exact parent acknowledgment without service redispatch',async()=>{
 for(const delay of [0,1,5]){let clock=0,waits=0,result=delay===0?{retained:true}:null,observations=0;const identity={invocationId:'a'.repeat(32),pid:1234,startTime:'100'};
 const ready=await awaitOwnedN8nAttempt9SupervisorAcknowledgment({pid:1234,observe:()=>{observations++;return {...identity};},readResult:()=>result,validateReady:()=>{assert.ok(result);return {...identity};},now:()=>clock,pause:async ms=>{clock+=ms;if(++waits===delay)result={retained:true};}});
 assert.deepEqual(ready,identity);assert.equal(waits,delay);assert.equal(observations,delay+1);
 }
});
test('missing, late, foreign or changed launch acknowledgment cannot reach serving',async()=>{
 for(const mode of ['missing','late','foreign','identity','wrong-pid']){let clock=0,result=null,n=0;const identity={invocationId:'a'.repeat(32),pid:1234,startTime:'100'};
 await assert.rejects(awaitOwnedN8nAttempt9SupervisorAcknowledgment({pid:mode==='wrong-pid'?999:1234,timeoutMs:300,observe:()=>({...identity,startTime:mode==='identity'&&n>0?'changed':'100'}),readResult:()=>result,validateReady:()=>{if(mode==='foreign')throw Error('foreign receipt');return identity;},now:()=>clock,pause:async ms=>{clock+=ms;n++;if(mode==='foreign'||mode==='late'&&clock>=300)result={retained:true};}}));
 }
});
