import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOwnedN8nInstalledIngress,verifyOwnedN8nProtectedAsyncFence} from '../packages/zola-release/owned-n8n-installed-fence.js';
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
