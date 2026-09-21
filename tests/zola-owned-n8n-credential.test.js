import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {synchronizeOwnedN8nWriter,createOwnedN8nCredentialTransport} from '../packages/zola-release/owned-n8n-credential.js';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
function fixture(){
 const w={id:'VvMHSIbycYCx4CZN',versionId:'a'.repeat(36),name:'test',nodes:[],connections:{},settings:{},active:false,activeVersionId:null};
 const graph=hash({name:w.name,nodes:w.nodes,connections:w.connections,settings:w.settings});
 let credential={id:'RzOyDmXYmx58yZHi',name:'ZOLA Buyer writer',type:'httpHeaderAuth',isManaged:false,isGlobal:false,isResolvable:false,resolvableAllowFallback:false,resolverId:null,createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'};
 const records={},calls=[],state={unknown:false,drift:false,busy:false};
 const args={plan:{credentialIds:['9DiTRFOJnwA6Aw9y','RzOyDmXYmx58yZHi'],releaseSha:'a'.repeat(40),namespace:'c'.repeat(64),baselineDigest:graph,candidateDigest:'d'.repeat(64),baselineVersion:w.versionId},writerCredential:'x'.repeat(43),profileDigest:'b'.repeat(64),sourceDigest:'c'.repeat(64)};
 const deps={store:{value:n=>records[n]??null,record:(n,v)=>{assert.equal(records[n],undefined);records[n]=structuredClone(v);}},fence:()=>{if(state.drift)throw Error('drift');},request:async(method,path,body)=>{
  calls.push({method,path,body});if(path.includes('/workflows/'))return structuredClone(w);
  if(path.includes('/executions?'))return {data:state.busy?[{workflowId:w.id,status:'running',finished:false}]:[],nextCursor:null};
  if(path.includes('/schema/'))return {type:'object',additionalProperties:false,required:[],properties:{name:{type:'string'},value:{type:'string'},useCustomAuth:{type:'notice'},allowedDomains:{type:'string'},allowedHttpRequestDomains:{type:'string',enum:['all','domains','none']}}};
  if(method==='PATCH'){assert.ok(records.intent);credential={...credential,updatedAt:'2026-09-21T00:00:00Z'};if(state.unknown)throw Error('unknown');}
  return structuredClone(credential);
 }};
 return {args,deps,records,calls,state,w};
}
test('one fixed writer update, restricted domain, durable replay without redispatch',async()=>{
 const f=fixture();assert.equal((await synchronizeOwnedN8nWriter(f.args,f.deps)).productionAccepted,false);
 await synchronizeOwnedN8nWriter(f.args,f.deps);
 const patches=f.calls.filter(c=>c.method==='PATCH');assert.equal(patches.length,1);
 assert.deepEqual(patches[0].body,{data:{name:'x-buyer-writer-key',value:f.args.writerCredential,allowedHttpRequestDomains:'domains',allowedDomains:'jarvis.blackspirehelix.com'},isPartialData:false});
 assert.ok(!JSON.stringify(f.records).includes(f.args.writerCredential));
});
test('lost mutation acknowledgement retains intent and never repeats',async()=>{
 const f=fixture();f.state.unknown=true;await assert.rejects(synchronizeOwnedN8nWriter(f.args,f.deps));f.state.unknown=false;
 await assert.rejects(synchronizeOwnedN8nWriter(f.args,f.deps));assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);assert.ok(!f.records.result);
});
test('active workflow, running execution, local drift and wrong credential IDs fail before effects',async()=>{
 for(const change of [f=>{f.w.active=true;},f=>{f.state.busy=true;},f=>{f.state.drift=true;},f=>{f.args.plan.credentialIds.reverse();}]){
  const f=fixture();change(f);await assert.rejects(synchronizeOwnedN8nWriter(f.args,f.deps));assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);
 }
});
test('post-write drift cannot publish a success receipt or retry',async()=>{
 const f=fixture(),original=f.deps.request;f.deps.request=async(...args)=>{const value=await original(...args);if(args[0]==='PATCH')f.state.drift=true;return value;};
 await assert.rejects(synchronizeOwnedN8nWriter(f.args,f.deps));assert.ok(f.records.intent);assert.equal(f.records.result,undefined);
});
test('transport rejects arbitrary credentials and actions without making a request',async()=>{
 let calls=0;const request=createOwnedN8nCredentialTransport('x'.repeat(30),{fetchImpl:async()=>{calls++;throw Error('unexpected');}});
 for(const [method,path] of [['PATCH','/api/v1/credentials/9DiTRFOJnwA6Aw9y'],['POST','/api/v1/workflows/VvMHSIbycYCx4CZN/activate'],['DELETE','/api/v1/credentials/RzOyDmXYmx58yZHi']])await assert.rejects(request(method,path,{}));assert.equal(calls,0);
});
