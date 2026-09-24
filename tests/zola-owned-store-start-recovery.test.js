import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileOwnedStoreStartup} from '../packages/zola-release/commander-vps.js';
function fixture(){
 const calls=[],proof={api:{generation:'a'.repeat(32)},worker:{generation:'b'.repeat(32)}};
 const plan={backendProfile:'owned-postgres-v1',newMainSha:'c'.repeat(40),epochRunId:'11111111-1111-4111-8111-111111111111'},snapshot={ownedStore:{}};
 let published=false;
 const deps={assertAdmission(){calls.push('admission');},verifyBindings:()=>true,activeStore:()=>({ActiveState:'inactive',SubState:'dead',MainPID:'0'}),observeLifecycle:async()=>proof,
 store:{observe:()=>true,observeManifest:()=>published,publishManifest:async()=>{calls.push('publish');published=true;},start:()=>calls.push('start')}};
 return {calls,plan,snapshot,deps};
}
test('retained owned-store startup checks identity before idempotent publication and start',async()=>{
 const f=fixture();assert.equal(await reconcileOwnedStoreStartup(f.plan,f.snapshot,f.deps),true);
 assert.deepEqual(f.calls,['admission','publish','admission','start']);
});
test('configuration, authority, service state and generation drift never start store',async()=>{
 for(const kind of ['configuration','authority','state','generation','publication']){
  const f=fixture();
  if(kind==='configuration')f.deps.store.observe=()=>false;
  if(kind==='authority')f.deps.verifyBindings=()=>false;
  if(kind==='state')f.deps.activeStore=()=>({ActiveState:'activating',SubState:'start',MainPID:'1'});
  if(kind==='generation'){let n=0;f.deps.observeLifecycle=async()=>({api:{generation:'a'.repeat(32)},worker:{generation:(n++?'d':'b').repeat(32)}});}
  if(kind==='publication')f.deps.store.publishManifest=async()=>{throw Error('retained receipt mismatch');};
  await assert.rejects(reconcileOwnedStoreStartup(f.plan,f.snapshot,f.deps));assert.ok(!f.calls.includes('start'));
 }
});
