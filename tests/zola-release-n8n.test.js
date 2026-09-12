import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {prepareN8nTransition,createN8nTransport,executeN8nTransition,WORKFLOW_ID} from '../packages/zola-release/commander-n8n.js';
import {hash} from '../packages/zola-release/commander-journal.js';

function fixture(){
 const versionId='cdd141ba-8d20-4981-b598-6af8e35aff86';
 const backup={id:WORKFLOW_ID,name:'Legacy Buyer',nodes:[{id:'legacy',name:'Legacy',type:'n8n-nodes-base.noOp'}],connections:{},settings:{executionOrder:'v1'},active:true,versionId,activeVersionId:versionId};
 backup.activeVersion={versionId,workflowId:WORKFLOW_ID,nodes:backup.nodes,connections:backup.connections};
 const backupBytes=JSON.stringify(backup);
 const configuration={version:1,workflowId:WORKFLOW_ID,workflowVersion:versionId,releaseSha:'a'.repeat(40),backupSha256:hash(backupBytes),gatewayOrigin:'https://jarvis.blackspirehelix.com',webhookId:'buyer-engine',ingressCredentialId:'ingress',writerCredentialId:'writer'};
 const plan=prepareN8nTransition({configuration,backupBytes});
 return{plan,backup,configuration,backupBytes};
}
async function serverFixture(t){
 const fixtureData=fixture(),events=[],calls=[];
 const model={value:structuredClone(fixtureData.backup),busy:false,lose:null,credentialsPresent:true};
 const server=http.createServer(async(req,res)=>{
  assert.equal(req.headers['x-n8n-api-key'],'test-key-'.repeat(5));
  let body='';for await(const part of req)body+=part;
  calls.push({method:req.method,path:req.url,body:body?JSON.parse(body):null});
  let value;
  if(req.url.startsWith('/api/v1/credentials?'))value={data:model.credentialsPresent?[{id:'ingress',type:'httpHeaderAuth'},{id:'writer',type:'httpHeaderAuth'}]:[],nextCursor:null};
  else if(req.url.startsWith('/api/v1/executions?'))value={data:model.busy?[{id:'1',workflowId:WORKFLOW_ID,finished:false,status:'running',stoppedAt:null}]:[],nextCursor:null};
  else if(req.method==='GET')value=model.value;
  else{
   if(req.method==='PUT'){
    assert.equal(model.value.active,false);
    const payload=JSON.parse(body);assert.deepEqual(Object.keys(payload).sort(),['connections','name','nodes','settings']);
    model.value={...model.value,...payload,versionId:randomUUID()};
   }else if(req.url.endsWith('/deactivate'))model.value={...model.value,active:false,activeVersionId:null,activeVersion:null};
   else if(req.url.endsWith('/activate')){
    assert.equal(JSON.parse(body).versionId,model.value.versionId);
    model.value={...model.value,active:true,activeVersionId:model.value.versionId,
     activeVersion:{versionId:model.value.versionId,workflowId:WORKFLOW_ID,nodes:model.value.nodes,connections:model.value.connections}};
   }else assert.fail('unexpected mutation');
   if(model.lose===req.method){model.lose=null;req.socket.destroy();return;}
   value=model.value;
  }
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const request=createN8nTransport('test-key-'.repeat(5),{origin:`http://127.0.0.1:${server.address().port}`});
 let writerChecks=0;
 const run=mode=>executeN8nTransition({plan:fixtureData.plan,mode,request,journal:{events:()=>structuredClone(events),append:event=>events.push(structuredClone(event))},
  verifyWriter:async()=>{writerChecks++;},exclusiveWindowUntil:new Date(Date.now()+60000).toISOString()});
 return{...fixtureData,model,events,calls,request,run,writerChecks:()=>writerChecks};
}

test('actual HTTP lifecycle deactivates before PUT, pins publication version, reconciles and safe rollback never restores legacy',async t=>{
 const f=await serverFixture(t);
 await f.run('inspect');assert.equal(f.writerChecks(),0);
 await f.run('deactivate');await f.run('update');await f.run('publish');
 const deployed=await f.run('reconcile');assert.equal(deployed.state.kind,'CANDIDATE');assert.equal(deployed.state.active,true);
 await f.run('rollback');assert.equal(f.model.value.active,false);assert.equal(f.model.value.name,f.plan.payload.name);
 assert.deepEqual(f.calls.filter(c=>c.method!=='GET').map(c=>[c.method,c.path.split('/').at(-1)]),[['POST','deactivate'],['PUT',WORKFLOW_ID],['POST','activate'],['POST','deactivate']]);
 assert.ok(f.writerChecks()>=7);assert.equal(f.events.filter(e=>e.type==='intent').length,4);
 assert.equal(f.events.some(e=>JSON.stringify(e).includes('test-key')),false);
});

test('lost mutation acknowledgement is reconciled with GETs, no retry; fresh mode cannot bypass intent',async t=>{
 const f=await serverFixture(t);f.model.lose='POST';
 const result=await f.run('deactivate');assert.equal(result.acknowledged,false);assert.equal(result.status,'CONFIRMED');
 await assert.rejects(f.run('deactivate'),e=>e.code==='PRIOR_INTENT_RECONCILE_ONLY');
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});

test('active PUT and busy execution are rejected before any unsafe mutation',async t=>{
 const f=await serverFixture(t);await assert.rejects(f.run('update'),e=>e.code==='TRANSITION_REJECTED');
 assert.equal(f.calls.some(c=>c.method!=='GET'),false);
 await f.run('deactivate');f.model.busy=true;
 await assert.rejects(f.run('update'),e=>e.code==='EXECUTIONS_NOT_QUIESCENT');
 assert.equal(f.calls.filter(c=>c.method==='PUT').length,0);
});

test('reconcile after process crash confirms exact pending target, old state stays unknown',async t=>{
 const f=await serverFixture(t);
 const state=(await f.run('inspect')).state;
 f.events.push({type:'intent',namespace:f.plan.namespace,releaseSha:f.plan.releaseSha,operation:'deactivate',before:state,target:{...state,active:false}});
 await assert.rejects(f.run('reconcile'),e=>e.code==='OUTCOME_UNKNOWN_RECONCILE_ONLY');
 f.model.value={...f.model.value,active:false,activeVersionId:null,activeVersion:null};
 await f.run('reconcile');assert.ok(f.events.some(e=>e.type==='confirmed'&&e.reconciled));
 await f.run('update');assert.equal(f.calls.filter(c=>c.method!=='GET').length,1);
});

test('foreign edits, contradictory active version, missing exclusive window and caller forged plans fail closed',async t=>{
 const f=await serverFixture(t);f.model.value.name='foreign';await assert.rejects(f.run('inspect'),e=>e.code==='WORKFLOW_DRIFT');
 f.model.value=structuredClone(f.backup);f.model.value.activeVersion.nodes=[];
 await assert.rejects(f.run('inspect'),e=>e.code==='PUBLISHED_VERSION_DRIFT');
 await assert.rejects(executeN8nTransition({plan:{...f.plan},mode:'inspect'}),e=>e.code==='COMMAND_REJECTED');
 f.model.value=structuredClone(f.backup);
 await assert.rejects(executeN8nTransition({plan:f.plan,mode:'deactivate',request:f.request,journal:{events:()=>[],append:()=>assert.fail('must not journal intent')},verifyWriter:()=>assert.fail('must not check writer'),exclusiveWindowUntil:'invalid'}),e=>e.code==='EXCLUSIVE_WINDOW_REQUIRED');
 assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
});

test('credential loss cannot prevent exact candidate deactivation rollback',async t=>{
 const f=await serverFixture(t);await f.run('deactivate');await f.run('update');await f.run('publish');
 f.model.credentialsPresent=false;f.model.value.staticData={retained:'preserve during emergency containment'};const before=f.calls.length,checks=f.writerChecks();
 await f.run('rollback');assert.equal(f.model.value.active,false);assert.equal(f.writerChecks(),checks);
 const calls=f.calls.slice(before);assert.equal(calls.some(c=>c.path.startsWith('/api/v1/credentials')),false);
 assert.deepEqual(calls.filter(c=>c.method!=='GET').map(c=>[c.method,c.path]),[['POST',`/api/v1/workflows/${WORKFLOW_ID}/deactivate`]]);
});

test('unexpected retained workflow data prevents replacement before any mutation',async t=>{
 const f=await serverFixture(t);f.model.value.staticData={persisted:'do-not-discard'};
 await assert.rejects(f.run('deactivate'),e=>e.code==='WORKFLOW_SCHEMA_REJECTED');
 assert.equal(f.calls.some(c=>c.method!=='GET'),false);
 f.model.value.staticData={};f.model.value.pinData={retained:[]};
 await assert.rejects(f.run('inspect'),e=>e.code==='WORKFLOW_SCHEMA_REJECTED');
});
