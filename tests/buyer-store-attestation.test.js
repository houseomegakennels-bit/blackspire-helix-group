import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBuyerStoreAttestation} from '../packages/buyer-store/attestation.js';
test('installed artifact and observed process generations gate repository requests',async()=>{
 const configuration={client:{releaseSha:'a'.repeat(40)}},artifactRoot='/opt/blackspire-command/releases/'+configuration.client.releaseSha;
 const manifest={version:1,kind:'buyer-store-installed',releaseSha:configuration.client.releaseSha,artifactDigest:'b'.repeat(64),configurationDigest:createHash('sha256').update(JSON.stringify(configuration)).digest('hex'),runId:'00000000-0000-0000-0000-000000000001',apiGeneration:'c'.repeat(32),workerGeneration:'d'.repeat(32)};
 let generation=manifest.apiGeneration,artifactCalls=0;
 const deps={read:()=>({value:manifest,identity:{uid:0,gid:process.getgid(),mode:0o640},digest:'e'.repeat(64)}),io:{realpathSync:()=>artifactRoot},run:(_file,args)=>JSON.stringify({type:'ay',data:[...Buffer.from(args.includes('/org/freedesktop/systemd1/unit/blackspire_2dcommand_2eservice')?generation:manifest.workerGeneration,'hex')]}),inspect:async()=>{artifactCalls++;return {artifactDigest:manifest.artifactDigest};},moduleRoot:artifactRoot};
 const attestation=createBuyerStoreAttestation(configuration,deps),digest=await attestation.verify();
 await attestation.verifyUnchanged(digest);assert.equal(artifactCalls,1);
 generation='f'.repeat(32);
 await assert.rejects(attestation.verify());
 generation=manifest.apiGeneration;
 await assert.rejects(createBuyerStoreAttestation(configuration,{...deps,moduleRoot:'/tmp/copy'}).verify());
 await assert.rejects(createBuyerStoreAttestation(configuration,{...deps,inspect:async()=>({artifactDigest:'f'.repeat(64)})}).verify());
 manifest.configurationDigest='f'.repeat(64);await assert.rejects(attestation.verify());
});
