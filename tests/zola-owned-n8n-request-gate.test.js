import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareN8nTransition,executeN8nTransition,WORKFLOW_ID} from '../packages/zola-release/commander-n8n.js';
import {hash} from '../packages/zola-release/commander-journal.js';
import {synchronizeOwnedN8nWriter} from '../packages/zola-release/owned-n8n-credential.js';
import {createOwnedN8nRequestGate} from '../packages/zola-release/owned-n8n-request-gate.js';
function fixture(){
 const versionId=randomUUID(),ids=['9DiTRFOJnwA6Aw9y','RzOyDmXYmx58yZHi'];
 let workflow={id:WORKFLOW_ID,name:'Legacy Buyer',nodes:[{id:'legacy',name:'Legacy',type:'n8n-nodes-base.noOp'}],connections:{},settings:{executionOrder:'v1'},active:true,versionId,activeVersionId:versionId};
 workflow.activeVersion={versionId,workflowId:WORKFLOW_ID,nodes:workflow.nodes,connections:workflow.connections};
 const backupBytes=JSON.stringify(workflow),plan=prepareN8nTransition({configuration:{version:1,workflowId:WORKFLOW_ID,workflowVersion:versionId,releaseSha:'a'.repeat(40),backupSha256:hash(backupBytes),gatewayOrigin:'https://jarvis.blackspirehelix.com',webhookId:'buyer-engine',ingressCredentialId:ids[0],writerCredentialId:ids[1]},backupBytes});
 let credential={id:ids[1],name:'ZOLA Buyer writer',type:'httpHeaderAuth',isManaged:false,isGlobal:false,isResolvable:false,resolvableAllowFallback:false,resolverId:null,createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'};
 const events=[],calls=[],records={},state={unknown:false,drift:false,busy:false};
 const b={namespace:plan.namespace,releaseSha:plan.releaseSha,operationId:randomUUID(),stageAttemptId:randomUUID()};
 const request=async(method,path,body)=>{
  calls.push({method,path});
  if(path.includes('/executions?'))return {data:state.busy?[{id:'1',workflowId:WORKFLOW_ID,status:'running',finished:false,stoppedAt:null}]:[],nextCursor:null};
  if(path.includes('/credentials?'))return {data:ids.map(id=>({id,type:'httpHeaderAuth'})),nextCursor:null};
  if(path.includes('/schema/'))return {type:'object',additionalProperties:false,required:[],properties:{name:{type:'string'},value:{type:'string'},useCustomAuth:{type:'notice'},allowedDomains:{type:'string'},allowedHttpRequestDomains:{type:'string',enum:['all','domains','none']}}};
  if(path.includes('/credentials/')){if(method==='PATCH'){assert.ok(records.intent);assert.equal(events.some(e=>e.type==='intent'&&e.operation==='update'),false);credential={...credential,updatedAt:'2026-09-21T00:00:00Z'};if(state.unknown)throw Error('lost ack');}return structuredClone(credential);}
  if(method==='PUT'){assert.ok(records.result);workflow={...workflow,...body,versionId:randomUUID()};}
  if(path.endsWith('/deactivate'))workflow={...workflow,active:false,activeVersionId:null,activeVersion:null};
  if(path.endsWith('/activate')){assert.ok(records.result);workflow={...workflow,active:true,activeVersionId:workflow.versionId,activeVersion:{versionId:workflow.versionId,workflowId:WORKFLOW_ID,nodes:workflow.nodes,connections:workflow.connections}};}
  return structuredClone(workflow);
 };
 const store={value:n=>records[n]??null,record:(n,v)=>{assert.equal(records[n],undefined);records[n]=structuredClone(v);}};
 const synchronize=()=>synchronizeOwnedN8nWriter({plan,writerCredential:'x'.repeat(43),profileDigest:'b'.repeat(64),sourceDigest:'c'.repeat(64)},
 {request,store,fence:()=>{if(state.drift)throw Error('HELD changed');}});
 const gate=()=>createOwnedN8nRequestGate({request,events:()=>events,binding:()=>b,synchronize,assertConfigured:()=>{assert.ok(records.result);},workflowId:WORKFLOW_ID});
 let routed=gate();
 const run=mode=>executeN8nTransition({plan,mode,request:(...a)=>routed(...a),journal:{events:()=>events,append:e=>events.push({...e,...(['intent','response','unknown','confirmed'].includes(e.type)?{operationId:b.operationId,stageAttemptId:b.stageAttemptId}:{})})},verifyWriter:async()=>{},exclusiveWindowUntil:new Date(Date.now()+60000).toISOString()});
 return {run,events,calls,records,state,b,restart:()=>{routed=gate();}};
}
test('real transition and credential synchronizer compose deactivate, PATCH, update, publish in order',async()=>{
 const f=fixture();await f.run('inspect');await f.run('deactivate');assert.equal(f.records.intent,undefined);
 await f.run('update');await f.run('publish');
 assert.deepEqual(f.calls.filter(c=>c.method!=='GET').map(c=>[c.method,c.path.split('/').at(-1)]),[['POST','deactivate'],['PATCH','RzOyDmXYmx58yZHi'],['PUT',WORKFLOW_ID],['POST','activate']]);
 f.restart();await f.run('reconcile');assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);
});
test('unknown credential PATCH is retained and no update intent or repeat PATCH occurs',async()=>{
 const f=fixture();await f.run('deactivate');f.state.unknown=true;await assert.rejects(f.run('update'));
 assert.ok(f.records.intent);assert.equal(f.records.result,undefined);assert.equal(f.events.some(e=>e.type==='intent'&&e.operation==='update'),false);
 f.restart();f.state.unknown=false;await assert.rejects(f.run('update'));assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);
});
test('busy remote execution or changed HELD fence stops before PATCH and native update intent',async()=>{
 for(const key of ['busy','drift']){const f=fixture();await f.run('deactivate');f.state[key]=true;await assert.rejects(f.run('update'));assert.equal(f.calls.some(c=>c.method==='PATCH'||c.method==='PUT'),false);assert.equal(f.events.some(e=>e.operation==='update'),false);}
});
test('foreign attempt deactivation cannot authorize synchronization',async()=>{
 const f=fixture();await f.run('deactivate');f.b.stageAttemptId=randomUUID();await assert.rejects(f.run('update'));assert.equal(f.calls.some(c=>c.method==='PATCH'),false);
});
