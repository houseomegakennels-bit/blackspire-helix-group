import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {prepareZolaConfigurationInstall,installZolaConfiguration} from '../packages/zola-release/configuration-install.js';
import {openInstalledBuyerWriterAdmittedClient} from '../packages/zola-release/installed-buyer-writer.js';
import {createBuyerWriterRuntime} from '../packages/buyer-writer/runtime.js';
import {createPostmergeAuthorityRebind} from '../packages/zola-release/postmerge-authority-rebind.js';
import {renderGatewayUnit} from '../packages/buyer-writer/gateway-installation.js';

function fixture(){
  const root=fs.mkdtempSync('/root/zola-config-test-'),paths={configDirectory:path.join(root,'etc'),gatewayConfigDirectory:path.join(root,'gateway-etc'),
    unitDirectory:path.join(root,'systemd'),releaseRoot:path.join(root,'releases')};
  for(const p of Object.values(paths))fs.mkdirSync(p,{mode:0o755});
  fs.chownSync(paths.gatewayConfigDirectory,0,982);fs.chmodSync(paths.gatewayConfigDirectory,0o750);
  const secret=()=>randomBytes(32).toString('base64url'),releaseSha='a'.repeat(40),ca=fs.readFileSync(new URL('./fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
  const authority={releaseSha,operationId:randomUUID(),attemptId:randomUUID(),workspace:'blackspire-command',gatewayIdentity:'blackspire-writer'};
  const keyPair=generateKeyPairSync('ed25519'),publicKey=keyPair.publicKey.export({type:'spki',format:'pem'});
  const privateKeyPath=path.join(paths.configDirectory,'buyer-writer-signing-key-fixture-key.pem');
  fs.writeFileSync(privateKeyPath,keyPair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  fs.chownSync(privateKeyPath,994,984);
  const permit={issuer:'zola-control',audience:'buyer-writer',subject:randomUUID(),keyId:'fixture-key',origin:'https://zola.example',
    releaseSha,operationId:authority.operationId,attemptId:authority.attemptId,workspace:'blackspire-command'};
  const config={version:4,workspace:'blackspire-command',bindingFile:path.join(paths.configDirectory,'buyer-writer-binding.json'),
    writerCredential:secret(),issuerCredential:secret(),admissionCredential:secret(),gatewayCapability:secret(),creatorOid:16384,authority,
    runtime:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:secret(),ca},
    issuer:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:secret(),ca},
    operationPermitConfiguration:JSON.stringify(permit),operationPermitVerificationConfiguration:{version:2,keys:[{
      keyId:'fixture-key',publicKeyPem:publicKey,lifecycle:'current',verifyNotBefore:0,verifyNotAfter:null}]}};
  config.operationPermitSignerConfiguration={version:1,activeKeyId:'fixture-key',activePrivateKeyPath:privateKeyPath,
    verification:config.operationPermitVerificationConfiguration};
  const input={releaseSha,configurationFile:path.join(root,'input.json')};fs.writeFileSync(input.configurationFile,JSON.stringify(config),{mode:0o600});
  const calls=[],events=[];let running=false,closed=0;
  const artifactProof={releaseSha,environment:'production',artifactDigest:'b'.repeat(64),
    status:'SEALED_ARTIFACT_VERIFIED',deployed:false,productionAccepted:false};
  const options={paths,uid:0,identity:async()=>({uid:994,credentialGroupId:984,workerUid:993,gatewayUid:992,gatewayGid:982}),
    run:async(file,args)=>{calls.push([file,args]);const unit=args.at(-1),user=unit==='blackspire-command.service'?'blackspire-api':unit==='blackspire-command-worker.service'?'blackspire-worker':'blackspire-writer';return {stdout:`ActiveState=${running?'active':'inactive'}\nSubState=${running?'running':'dead'}\nMainPID=${running?'99':'0'}\nUser=${user}\nGroup=${unit==='blackspire-buyer-writer-gateway.service'?'blackspire-api':'blackspire'}\n`,stderr:''};},
    inspectArtifact:async()=>structuredClone(artifactProof)};
  const execution={connect:async value=>{assert.equal(value.creatorOid,config.creatorOid);return{isHealthy:()=>true,close:async()=>{closed++;}};},record:event=>events.push(event)};
  return {root,paths,config,input,options,execution,artifactProof,calls,events,closed:()=>closed,start:()=>{running=true;},cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}

async function rebindFixture(t){
 const f=fixture();t.after(()=>f.cleanup());
 await installZolaConfiguration(await prepareZolaConfigurationInstall(f.input,f.options),f.execution);
 const paths={config:f.paths.configDirectory,gateway:path.join(f.paths.gatewayConfigDirectory,'gateway.json'),
  dropin:path.join(f.paths.unitDirectory,'blackspire-command.service.d/40-zola-writer.conf'),
  unit:path.join(f.paths.unitDirectory,'blackspire-buyer-writer-gateway.service'),state:path.join(f.root,'rebind'),
  candidateState:path.join(f.root,'candidate-install.json'),releases:f.paths.releaseRoot};
 const template=fs.readFileSync(new URL('../ops/runtime-ownership/blackspire-buyer-writer-gateway.service',import.meta.url),'utf8');
 fs.writeFileSync(paths.unit,renderGatewayUnit(template,{sha:f.input.releaseSha}),{mode:0o644});
 fs.writeFileSync(paths.candidateState,JSON.stringify({version:4,sha:f.input.releaseSha,mode:'prepare'})+'\n',{mode:0o600});
 const plan={candidateSha:f.input.releaseSha,newMainSha:'c'.repeat(40),candidateArtifactDigest:f.artifactProof.artifactDigest,
  artifactDigest:'d'.repeat(64),commanderRunId:randomUUID(),operationId:randomUUID(),epochRunId:randomUUID()};
 let stopped=true,sealed=true;
 const options={paths,resolveIdentity:f.options.identity,assertStopped:async()=>{if(!stopped)throw new Error('running');},
  inspectArtifact:async()=>{if(!sealed)throw new Error('artifact unavailable');return{...f.artifactProof,releaseSha:plan.newMainSha,artifactDigest:plan.artifactDigest};}};
 const before=Object.fromEntries([paths.gateway,paths.dropin,paths.unit,paths.candidateState,f.config.operationPermitSignerConfiguration.activePrivateKeyPath]
  .map(filename=>[filename,fs.readFileSync(filename)]));
 return{...f,paths,plan,options,before,setRunning:()=>{stopped=false;},setArtifactUnavailable:()=>{sealed=false;},
  open:extra=>createPostmergeAuthorityRebind(plan,{...options,...extra})};
}
const rootOnly={skip:process.getuid()!==0};
test('postmerge rebind preserves credentials, key, owner and candidate state; new manifest follows the complete bundle',rootOnly,async t=>{
 const f=await rebindFixture(t),host=f.open(),proof=await host.prepare();
 const publicBytes=JSON.stringify(proof);
 for(const secret of [f.config.gatewayCapability,f.config.runtime.password,f.config.writerCredential])assert.equal(publicBytes.includes(secret),false);
 await host.publish(proof);assert.equal(host.observe(proof),true);assert.equal(host.recoverable(proof),true);
 const manifest=JSON.parse(fs.readFileSync(path.join(f.paths.config,'zola-installed-'+f.plan.newMainSha+'.json')));
 const client=JSON.parse(fs.readFileSync(manifest.clientConfig.path)),signer=JSON.parse(fs.readFileSync(manifest.signerConfig.path));
 const gateway=JSON.parse(fs.readFileSync(f.paths.gateway));
 assert.equal(client.authority.releaseSha,f.plan.newMainSha);assert.equal(gateway.authority.releaseSha,f.plan.newMainSha);
 assert.equal(JSON.parse(signer.operationPermitConfiguration).releaseSha,f.plan.newMainSha);
 assert.equal(signer.operationPermitConfiguration,gateway.admission.operationPermitConfiguration);
 assert.equal(client.gatewayCapability,f.config.gatewayCapability);assert.equal(gateway.runtime.password,f.config.runtime.password);
 assert.equal(JSON.parse(signer.operationPermitConfiguration).subject,JSON.parse(f.config.operationPermitConfiguration).subject);
 assert.deepEqual(signer.signer,f.config.operationPermitSignerConfiguration);
 for(const filename of [f.paths.candidateState,f.config.operationPermitSignerConfiguration.activePrivateKeyPath])assert.deepEqual(fs.readFileSync(filename),f.before[filename]);
 const keyStat=fs.statSync(f.config.operationPermitSignerConfiguration.activePrivateKeyPath);assert.equal(keyStat.uid,994);assert.equal(keyStat.mode&0o777,0o600);
 assert.equal(await f.open().restore(proof),true);assert.equal(await f.open().restored(proof),true);
 for(const [filename,bytes] of Object.entries(f.before))assert.deepEqual(fs.readFileSync(filename),bytes);
 assert.equal(f.open().observe(proof),false);
});
test('every partial mutable publication restores exact candidate bytes without replay',rootOnly,async t=>{
 for(const key of ['gateway','dropin','unit']){
  const f=await rebindFixture(t),proof=await f.open().prepare();let failed=false;
  const io={...fs,renameSync(from,to){fs.renameSync(from,to);if(to===f.paths[key]&&!failed){failed=true;throw new Error('lost after rename');}}};
  await assert.rejects(()=>f.open({io}).publish(proof));assert.equal(failed,true);
  const resumed=f.open();assert.equal(resumed.observe(proof),false);await assert.rejects(()=>resumed.publish(proof));
  assert.equal(await resumed.restore(proof),true);assert.equal(await resumed.restored(proof),true);
  for(const [filename,bytes] of Object.entries(f.before))assert.deepEqual(fs.readFileSync(filename),bytes);
 }
});
test('prepublication rollback does not depend on new-main artifact availability',rootOnly,async t=>{
 const f=await rebindFixture(t),proof=await f.open().prepare();f.setArtifactUnavailable();
 assert.equal(await f.open().restore(proof),true);assert.equal(await f.open().restored(proof),true);
 assert.equal(fs.existsSync(f.paths.state),false);
});
test('retained ingress, signing key and candidate installation drift prevent publication or observation',rootOnly,async t=>{
 for(const dependency of ['ingress','key','candidate']){
  const f=await rebindFixture(t),proof=await f.open().prepare();
  const row=proof.dependencies[dependency==='ingress'?1:dependency==='key'?2:0];
  fs.appendFileSync(row.filename,' ');
  await assert.rejects(()=>f.open().publish(proof));assert.equal(f.open().observe(proof),false);
  for(const key of ['gateway','dropin','unit'])assert.deepEqual(fs.readFileSync(f.paths[key]),f.before[f.paths[key]]);
 }
 const f=await rebindFixture(t),proof=await f.open().prepare();await f.open().publish(proof);
 fs.appendFileSync(proof.dependencies[1].filename,' ');assert.equal(f.open().observe(proof),false);
});
test('running services, unexpected bytes and changed public proof fail closed',rootOnly,async t=>{
 const f=await rebindFixture(t),proof=await f.open().prepare();f.setRunning();await assert.rejects(()=>f.open().publish(proof),/running/);
 const g=await rebindFixture(t),other=await g.open().prepare();await g.open().publish(other);
 const altered=structuredClone(other);altered.binding.newMainSha='f'.repeat(40);assert.equal(g.open().observe(altered),false);
 fs.appendFileSync(g.paths.gateway,' ');assert.equal(g.open().observe(other),false);await assert.rejects(()=>g.open().restore(other));
});

test('real runtime refuses candidate authority for new main and boots only the rebound closed configuration',rootOnly,async t=>{
 const f=await rebindFixture(t),proof=await f.open().prepare();let clients=0;
 const local={runtimeQuery:async()=>({rows:[]}),issuerQuery:async()=>({rows:[]}),isHealthy:()=>true,close:async()=>{}};
 const options=manifest=>({clientConfigurationFile:manifest.clientConfig.path,ingressConfigurationFile:manifest.ingressConfig.path,
  signerConfigurationFile:manifest.signerConfig.path,workspace:'blackspire-command',releaseSha:f.plan.newMainSha,apiGeneration:'1'.repeat(32),
  environment:'production',getHealth:()=>({ok:false}),getReadiness:()=>({ok:false}),resolveIdentity:f.options.resolveIdentity,
  createClient:()=>{clients++;return local;},createAdmittedClient:()=>local,createBinding:()=>async()=>null});
 const before=JSON.parse(fs.readFileSync(path.join(f.paths.config,'zola-installed-'+f.plan.candidateSha+'.json')));
 await assert.rejects(()=>createBuyerWriterRuntime(options(before)),/initialization failed/);assert.equal(clients,0);
 await f.open().publish(proof);
 const after=JSON.parse(fs.readFileSync(path.join(f.paths.config,'zola-installed-'+f.plan.newMainSha+'.json')));
 const runtime=await createBuyerWriterRuntime(options(after));try{assert.equal(clients,1);assert.equal(runtime.isHealthy(),true);assert.equal(await runtime.checkAvailability(),false);}
 finally{await runtime.close();}
});

async function successorReceiptFixture(t){
 const f=await rebindFixture(t);f.plan.backendProfile='owned-postgres-v1';f.plan.profileDigest='2563185421523bf337e382a38ca389c5991406cb2adecc952048cdf5cf058505';f.plan.commanderRunId=f.config.authority.operationId;
 fs.writeFileSync(f.paths.candidateState,JSON.stringify({version:4,sha:'2636a1e75cd0f422aff036dfee8a93a81cd5008b'})+'\n',{mode:0o600});
 const digest=value=>createHash('sha256').update(value).digest('hex'),dependencies=[];
 for(const name of ['plan','intent','result','retirement']){const filename=path.join(f.root,'successor-'+name+'.json');fs.writeFileSync(filename,JSON.stringify({modeled:name})+'\n',{mode:0o600});dependencies.push({filename,uid:0,gid:0,mode:0o600,digest:digest(fs.readFileSync(filename))});}
 dependencies.push({filename:f.paths.candidateState,uid:0,gid:0,mode:0o600,digest:digest(fs.readFileSync(f.paths.candidateState))});
 const receipt={status:'OWNED_SUCCESSOR_GATEWAY_UNIT_RECEIPT_VERIFIED',sha:f.plan.candidateSha,operationId:f.plan.commanderRunId,attemptId:f.config.authority.attemptId,artifactDigest:f.plan.candidateArtifactDigest,profileDigest:f.plan.profileDigest,installedUnitSha256:digest(fs.readFileSync(f.paths.unit)),dependencies};
 const successorReceipt=async input=>{assert.deepEqual(input,{releaseSha:f.plan.candidateSha,operationId:f.plan.commanderRunId,artifactDigest:f.plan.candidateArtifactDigest});return structuredClone(receipt);};
 return {...f,receipt,successorReceipt};
}
test('owned postmerge retains distinct successor unit receipts and original installation state',rootOnly,async t=>{
 const f=await successorReceiptFixture(t),host=f.open({successorReceipt:f.successorReceipt}),original=fs.readFileSync(f.paths.candidateState),proof=await host.prepare();
 for(const row of f.receipt.dependencies)assert.ok(proof.dependencies.some(p=>p.filename===row.filename&&p.digest===row.digest));
 await host.publish(proof);assert.equal(host.observe(proof),true);assert.deepEqual(fs.readFileSync(f.paths.candidateState),original);
 fs.appendFileSync(f.receipt.dependencies[0].filename,' ');assert.equal(host.observe(proof),false);
});
test('foreign successor receipt binding refuses postmerge before publication',rootOnly,async t=>{
 const f=await successorReceiptFixture(t);
 for(const patch of [{attemptId:randomUUID()},{operationId:randomUUID()},{profileDigest:'e'.repeat(64)},{artifactDigest:'e'.repeat(64)},{installedUnitSha256:'e'.repeat(64)},{dependencies:f.receipt.dependencies.slice(1)}]){
  await assert.rejects(f.open({successorReceipt:async()=>({...f.receipt,...patch})}).prepare());assert.equal(fs.existsSync(f.paths.state),false);
 }
 f.plan.backendProfile=undefined;let called=false;await assert.rejects(f.open({successorReceipt:async()=>{called=true;return f.receipt;}}).prepare());assert.equal(called,false);
});
