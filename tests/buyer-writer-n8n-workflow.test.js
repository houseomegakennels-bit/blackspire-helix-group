import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { buildBuyerWorkflow } from '../packages/buyer-writer/n8n-workflow.js';

const config={gatewayOrigin:'https://writer.example.invalid',ingressCredentialId:'fixture-ingress',writerCredentialId:'fixture-writer',webhookId:'fixture-webhook'};
const workflow=buildBuyerWorkflow(config);
const execute=(name,input,references={})=>JSON.parse(JSON.stringify(vm.runInNewContext(`(function(){${workflow.nodes.find(n=>n.name===name).parameters.jsCode}\n})()`,{
  Buffer,require:(name)=>{assert.equal(name,'crypto');return crypto;},
  $input:{first:()=>({json:input[0]}),all:()=>input.map(json=>({json}))},
  $:(name)=>{assert.ok(Object.hasOwn(references,name));return{item:{json:references[name][0]},all:()=>references[name].map(json=>({json}))};},
},{timeout:2000})));
const jobId='00000000-0000-4000-8000-000000000001';
const raw=Buffer.from(JSON.stringify([{OWNAM1:'SYNTHETIC LLC',PIN_NUMBER:'ISOLATED',SALEAMT:100,DATESOLD:20260801,_source_type:'arcgis'}]));
const intake={version:1,jobId,dispatchId:jobId,generation:1,permit:'x'.repeat(43),rawBase64:raw.toString('base64')};
const context={criteria:{state:'NC',county:'Wake',property_type:'land',date_range_start:'2026-01-01',date_range_end:'2026-12-31'},sourceContext:{version:1,mode:'frontend_payload',sources:[{sourceId:jobId,sourceType:'arcgis',endpointId:'fixture',endpointConfigDigest:'a'.repeat(64),cashDisabled:false}],budgets:{maxRequests:1,maxRows:10,maxBytes:10000},rawPayload:{digest:crypto.createHash('sha256').update(raw).digest('hex'),rowCount:1,byteCount:raw.length}},sourceContextDigest:'b'.repeat(64)};

test('offline definition uses secure distinct credentials, fixed gateway requests and sequential receipt loop',()=>{
  assert.equal(workflow.nodes.filter(n=>n.type==='n8n-nodes-base.httpRequest').length,3);
  assert.equal(workflow.nodes.some(n=>n.parameters.authentication===undefined&&n.type==='n8n-nodes-base.webhook'),false);
  const hook=workflow.nodes.find(n=>n.type==='n8n-nodes-base.webhook');
  assert.equal(hook.parameters.authentication,'headerAuth');assert.equal(hook.parameters.path,'buyer-engine');
  for(const n of workflow.nodes.filter(n=>n.type==='n8n-nodes-base.httpRequest')) {
    assert.equal(n.credentials.httpHeaderAuth.id,config.writerCredentialId);
    assert.equal(n.parameters.options.redirect.redirect.followRedirects,false);
    assert.equal(n.parameters.options.response.response.neverError,false);
    assert.equal(n.continueOnFail,false);assert.equal(n.retryOnFail,false);
    assert.match(n.parameters.url,/^=\{\{ "https:\/\/writer\.example\.invalid\/api\/internal\/buyer-writer/);
  }
  assert.deepEqual(workflow.connections['Next write'].main.map(o=>o[0].node),['Verify completion','Write operation']);
  assert.equal(workflow.connections['Verify receipt'].main[0][0].node,'Next write');
  assert.equal(new Set(workflow.nodes.map(n=>n.id)).size,workflow.nodes.length);
  for(const [from,edges]of Object.entries(workflow.connections)) {
    assert.ok(workflow.nodes.some(n=>n.name===from));
    for(const edge of edges.main.flat())assert.ok(workflow.nodes.some(n=>n.name===edge.node));
  }
  assert.equal(workflow.settings.saveDataErrorExecution,'none');assert.equal(workflow.settings.saveDataSuccessExecution,'none');
  assert.equal(workflow.settings.saveManualExecutions,false);assert.equal(workflow.settings.saveExecutionProgress,false);
  assert.deepEqual(workflow.pinData,{});
  const text=JSON.stringify(workflow);assert.doesNotMatch(text,/SUPABASE|service_role|Bearer eyJ|console\.log|this\.helpers\.httpRequest/);
  for(const invalid of [{gatewayOrigin:'http://writer.example.invalid'},{gatewayOrigin:'https://127.0.0.1'},
    {gatewayOrigin:'https://user:password@writer.example.invalid'},{writerCredentialId:config.ingressCredentialId}]) {
    assert.throws(()=>buildBuyerWorkflow({...config,...invalid}),/configuration rejected/);
  }
});
test('bundled cloud Code verifies bound bytes and yields ordered writes without network or repository imports',()=>{
  assert.deepEqual(execute('Validate intake',[{body:intake}])[0].json,intake);
  const plan=execute('Verify and plan',[context],{'Validate intake':[intake]}).map(i=>i.json);
  assert.deepEqual(plan.map(p=>p.operation),['raw.append','clean.append','buyers.commit','complete']);
  assert.equal(JSON.stringify(plan).includes(intake.permit),false);
  assert.equal(plan[0].payload.rows[0].buyer_name,'SYNTHETIC LLC');
  assert.deepEqual(execute('Verify start',[{ok:true,operation:'start',chunkIndex:0}])[0].json,{ok:true,operation:'start',chunkIndex:0});
  const receipts=plan.map(q=>execute('Verify receipt',[{ok:true,operation:q.operation,chunkIndex:q.chunkIndex}],{'Next write':[q]})[0].json);
  assert.deepEqual(execute('Verify completion',receipts,{'Verify and plan':plan}),[{json:{ok:true,status:'completed'}}]);
  for(const bad of [receipts.slice(1),receipts.toReversed(),[...receipts,{ok:true,operation:'complete',chunkIndex:0}]]) {
    assert.throws(()=>execute('Verify completion',bad,{'Verify and plan':plan}),/completion rejected/);
  }
});
test('malformed input, changed raw bytes, unbound markers and failed/mismatched receipts cannot report success',()=>{
  for(const bad of [{...intake,ownerId:jobId},{...intake,jobId:'invalid'},{...intake,rawBase64:'!!!!'},{...intake,rawBase64:'a'.repeat(8388609)}]) {
    assert.throws(()=>execute('Validate intake',[{body:bad}]),/intake rejected/);
  }
  const failed=execute('Verify and plan',[context],{'Validate intake':[{...intake,rawBase64:Buffer.from('[]').toString('base64')}]}).map(i=>i.json);
  assert.deepEqual(failed,[{version:1,dispatchId:jobId,generation:1,operation:'fail',chunkIndex:0,chunkCount:1,payload:{code:'INVALID_SOURCE_DATA'}}]);
  assert.throws(()=>execute('Verify completion',[{ok:true,operation:'fail',chunkIndex:0}],{'Verify and plan':failed}),/source verification rejected/);
  const changed=structuredClone(context);changed.sourceContext.sources[0].sourceType='another';
  assert.deepEqual(execute('Verify and plan',[changed],{'Validate intake':[intake]}).map(i=>i.json),failed);
  for(const receipt of [{ok:false,code:'WRITE_FAILED'},{ok:true,operation:'complete',chunkIndex:0},{ok:true,operation:'raw.append',chunkIndex:1}]) {
    assert.throws(()=>execute('Verify receipt',[receipt],{'Next write':[{operation:'raw.append',chunkIndex:0}]}),/write rejected/);
  }
});
