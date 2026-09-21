import test from 'node:test';
import assert from 'node:assert/strict';
import {observeBuyerStoreGenerations} from '../packages/buyer-store/runtime-generations.js';
import {inspectRuntimeBuyerStoreArtifact} from '../packages/buyer-store/runtime-artifact.js';
test('namespace bus observation is fixed read-only and rejects malformed generation evidence',()=>{
 const calls=[],good={type:'ay',data:Array(16).fill(17)};
 const run=(file,args,options)=>{calls.push({file,args,options});return JSON.stringify(good);};
 assert.deepEqual(observeBuyerStoreGenerations({run}),['11'.repeat(16),'11'.repeat(16)]);
 assert.equal(calls.length,2);for(const c of calls){assert.equal(c.file,'/usr/bin/busctl');assert.equal(c.args[0],'--address=unix:path=/run/dbus/system_bus_socket');assert.equal(c.args[2],'get-property');assert.equal(c.args.at(-1),'InvocationID');}
 for(const v of [{...good,extra:true},{...good,type:'s'},{...good,data:Array(15).fill(1)},{...good,data:Array(16).fill(0)},{...good,data:Array(16).fill(256)},{...good,data:Array(16).fill(1.5)}])assert.throws(()=>observeBuyerStoreGenerations({run:()=>JSON.stringify(v)}));
});
test('runtime artifact child requires exact deployed proof and fixed scope',async()=>{
 const input={artifactRoot:'/opt/blackspire-command/releases/'+'a'.repeat(40),releaseSha:'a'.repeat(40),environment:'production'},proof={releaseSha:input.releaseSha,environment:'production',artifactDigest:'b'.repeat(64)};
 const run=async(file,args,options)=>{assert.equal(file,'/opt/nodejs/node-v22.23.1-linux-x64/bin/node');assert.match(args[1],/runtime-artifact-worker.js$/);assert.equal(options.timeout,10000);return{stdout:JSON.stringify(proof),stderr:''};};
 assert.deepEqual(await inspectRuntimeBuyerStoreArtifact({...input,run}),proof);
 for(const p of [{...proof,deployed:false},{...proof,releaseSha:'c'.repeat(40)},{...proof,artifactDigest:'bad'}])await assert.rejects(inspectRuntimeBuyerStoreArtifact({...input,run:async()=>({stdout:JSON.stringify(p),stderr:''})}));
 await assert.rejects(inspectRuntimeBuyerStoreArtifact({...input,artifactRoot:'/tmp/foreign',run}));
});
