
import test from 'node:test';import assert from 'node:assert/strict';
import {MIXED_RETIREMENT as P} from '../packages/zola-release/mixed-retirement-history.js';
import {adoptMixedPreview,MIXED_PREVIEW} from '../packages/zola-release/mixed-preview-adoption.js';
function fixture(){
 let current=JSON.stringify({schema:1,releaseSha:P.releaseSha,frontendOrigin:P.origin,deploymentId:P.deploymentId})+'\n',writes=0;
 const values=new Map(),host={fence:async()=>({retirementDigest:'a'.repeat(64),archiveDigest:'b'.repeat(64)}),read:()=>current,
  publish:(before,after)=>{assert.equal(current,before);current=after;writes++;},verify:async p=>assert.deepEqual(p,MIXED_PREVIEW)};
 const store={read:n=>structuredClone(values.get(n)??null),retain:(n,v)=>{if(values.has(n))assert.deepEqual(values.get(n),v);else values.set(n,structuredClone(v));}};
 return {host,store,values,writes:()=>writes};
}
test('existing Preview is adopted once; lost publication acknowledgement resumes by observation',async()=>{
 for(const lost of [false,true]){
  const f=fixture();if(lost){const write=f.host.publish;f.host.publish=(...a)=>{write(...a);throw Error('ack lost');};await assert.rejects(adoptMixedPreview(f));}
  const r=await adoptMixedPreview(f);assert.equal(r.status,'MIXED_PREVIEW_ADOPTED');assert.equal(f.writes(),1);
  assert.deepEqual(await adoptMixedPreview(f),r);assert.equal(f.writes(),1);
 }
});
test('uncertain intent never redispatches and changed authority or deployment prevents publication',async()=>{
 const f=fixture();f.host.publish=()=>{throw Error('unknown dispatch');};await assert.rejects(adoptMixedPreview(f));
 f.host.publish=()=>assert.fail('must not retry');await assert.rejects(adoptMixedPreview(f));assert.equal(f.writes(),0);
 for(const kind of ['deployment','authority']){
  const g=fixture();if(kind==='deployment')g.host.verify=async()=>{throw Error('wrong deployment');};
  else{let n=0;g.host.fence=async()=>({retirementDigest:'a'.repeat(64),archiveDigest:(n++?'c':'b').repeat(64)});}
  await assert.rejects(adoptMixedPreview(g));assert.equal(g.writes(),0);
 }
});
