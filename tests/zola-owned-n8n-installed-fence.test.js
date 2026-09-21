import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOwnedN8nInstalledIngress,verifyOwnedN8nProtectedAsyncFence,createOwnedN8nLazySource} from '../packages/zola-release/owned-n8n-installed-fence.js';
function fixture(){
 const source={bindingFile:'/etc/blackspire/buyer-writer-binding.json',writerCredential:'w'.repeat(43),issuerCredential:'i'.repeat(43)};
 return {source,releaseSha:'a'.repeat(40),artifactDigest:'b'.repeat(64),manifest:{value:{schema:1,kind:'zola_installed_buyer_writer',releaseSha:'a'.repeat(40),artifactDigest:'b'.repeat(64),workspace:'blackspire-command',ingressConfig:{path:'/etc/blackspire/buyer-writer-ingress-'+ 'c'.repeat(64)+'.json',digest:'d'.repeat(64)}}},ingress:{digest:'d'.repeat(64),value:{version:1,workspace:'blackspire-command',...source}}};
}
test('selected writer and issuer keys must equal protected installed ingress bytes',()=>{
 const f=fixture();assert.equal(assertOwnedN8nInstalledIngress(f),true);
 for(const change of [x=>{x.source.writerCredential='x'.repeat(43);},x=>{x.source.issuerCredential='x'.repeat(43);},x=>{x.ingress.digest='e'.repeat(64);},x=>{x.manifest.value.ingressConfig.path='/tmp/ingress.json';},x=>{x.manifest.value.artifactDigest='e'.repeat(64);}]){const v=fixture();change(v);assert.throws(()=>assertOwnedN8nInstalledIngress(v));}
});
test('protected source, installed config and operator drift during awaited runtime checks prevent forwarding',async()=>{
 for(const key of ['source','ingress','operatorSha']){
  const state={source:'before',ingress:'before',operatorSha:'before'};let forwarded=false;
  await assert.rejects((async()=>{await verifyOwnedN8nProtectedAsyncFence({snapshot:()=>structuredClone(state),verifyAsync:async()=>{await Promise.resolve();state[key]='after';}});forwarded=true;})());
  assert.equal(forwarded,false);
 }
});
test('both boundary snapshots validate keys and unchanged async runtime proof succeeds',async()=>{
 const f=fixture();let reads=0;
 await verifyOwnedN8nProtectedAsyncFence({snapshot:()=>{reads++;assertOwnedN8nInstalledIngress(f);return structuredClone(f);},verifyAsync:async()=>Promise.resolve()});assert.equal(reads,2);
 await assert.rejects(verifyOwnedN8nProtectedAsyncFence({snapshot:()=>{assertOwnedN8nInstalledIngress(f);return structuredClone(f);},verifyAsync:async()=>{await Promise.resolve();f.ingress.value.writerCredential='x'.repeat(43);}}));
});

test('fresh operator starts without source; capture waits for actual pending migration after admission',()=>{
 let phase='admission_lease',source,reads=0;
 const capture=createOwnedN8nLazySource({binding:()=>{if(phase!=='n8n_migration')throw Error('wrong stage');return {operationId:'operation',attemptId:'migration'};},read:()=>{reads++;if(!source)throw Error('absent');return structuredClone(source);},validate:(s,b)=>{assert.equal(s.value.authority.operationId,b.operationId);assert.equal(s.value.authority.attemptId,'admission');}});
 assert.equal(reads,0);assert.throws(()=>capture());assert.equal(reads,0);
 // The unchanged canonical admission phase produces the file before n8n starts.
 source={identity:{ino:10},value:{authority:{operationId:'operation',attemptId:'admission'},writerCredential:'secret'}};phase='n8n_migration';
 assert.deepEqual(capture(),source);assert.deepEqual(capture(),source);
 source.identity.ino=11;assert.throws(()=>capture());
});
test('missing source at the migration gate and wrong admission authority cannot be deferred or accepted',()=>{
 const binding=()=>({operationId:'operation'});
 const missing=createOwnedN8nLazySource({binding,read:()=>{throw Error('absent');},validate:()=>{}});assert.throws(()=>missing());
 const wrong=createOwnedN8nLazySource({binding,read:()=>({value:{operationId:'other'}}),validate:(s,b)=>assert.equal(s.value.operationId,b.operationId)});assert.throws(()=>wrong());
});
