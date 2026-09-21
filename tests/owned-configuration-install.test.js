import {renderOwnedSuccessorLiveWriter} from '../packages/zola-release/owned-successor-configuration.js';
import {publishOwnedSuccessorLiveWriter} from '../packages/zola-release/owned-successor-configuration-host.js';
import {publishOwnedConfigurationBytes} from '../packages/zola-release/owned-buyer-configuration-host.js';
import {renderZolaGatewayConfigurations} from '../packages/zola-release/gateway-configuration-render.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {prepareOwnedZolaConfigurationInstall,prepareZolaConfigurationInstall,installZolaConfiguration} from '../packages/zola-release/configuration-install.js';
import {OWNED_POSTGRES_TARGET,OWNED_POSTGRES_PROFILE_PATH} from '../packages/buyer-writer/owned-postgres.js';
import {databaseProfileDigest} from '../packages/buyer-writer/database-profile.js';
import {readRootOwnedJsonSnapshot} from '../packages/buyer-writer/protected-json.js';
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
  const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:config.creatorOid,systemIdentifier:'123456789',caSha256:createHash('sha256').update(ca).digest('hex')};
  for(const c of [config.runtime,config.issuer])Object.assign(c,{host:'127.0.0.1',port:55432,backendProfile:'owned-postgres-v1',profileDigest:databaseProfileDigest(profile)});
  fs.writeFileSync(input.configurationFile,JSON.stringify(config));
  const profileFile=path.join(root,'owned-profile.json');fs.writeFileSync(profileFile,JSON.stringify(profile),{mode:0o600});
  const calls=[],events=[];let running=false,closed=0,quiesced=true;
  const artifactProof={releaseSha,environment:'production',artifactDigest:'b'.repeat(64),
    status:'SEALED_ARTIFACT_VERIFIED',deployed:false,productionAccepted:false};
  const options={paths,uid:0,quiesce:()=>{assert.equal(quiesced,true);},
    readSnapshot:(filename,opts)=>readRootOwnedJsonSnapshot(filename===OWNED_POSTGRES_PROFILE_PATH?profileFile:filename,opts),identity:async()=>({uid:994,credentialGroupId:984,workerUid:993,gatewayUid:992,gatewayGid:982}),
    run:async(file,args)=>{calls.push([file,args]);const unit=args.at(-1),user=unit==='blackspire-command.service'?'blackspire-api':unit==='blackspire-command-worker.service'?'blackspire-worker':'blackspire-writer';return {stdout:`ActiveState=${running?'active':'inactive'}\nSubState=${running?'running':'dead'}\nMainPID=${running?'99':'0'}\nUser=${user}\nGroup=${unit==='blackspire-buyer-writer-gateway.service'?'blackspire-api':'blackspire'}\n`,stderr:''};},
    inspectArtifact:async()=>structuredClone(artifactProof)};
  const execution={connect:async value=>{assert.equal(value.creatorOid,config.creatorOid);return{isHealthy:()=>true,close:async()=>{closed++;}};},record:event=>events.push(event)};
  return {root,paths,config,input,profile,profileFile,stopQuiescence:()=>{quiesced=false;},options,execution,artifactProof,calls,events,closed:()=>closed,start:()=>{running=true;},cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}

const rootOnly={skip:process.getuid()!==0};
test('owned protected file publication uses real profile and preserves API secret separation on replay',rootOnly,async()=>{
 const f=fixture();try{
  await assert.rejects(prepareZolaConfigurationInstall(f.input,f.options));
  const plan=await prepareOwnedZolaConfigurationInstall(f.input,f.options);
  const result=await installZolaConfiguration(plan,f.execution);assert.equal(result.status,'INSTALLED_RELOAD_REQUIRED');
  const gateway=JSON.parse(fs.readFileSync(plan.gatewayConfigPath)),client=fs.readFileSync(plan.clientConfigPath,'utf8');
  assert.equal(gateway.runtime.backendProfile,'owned-postgres-v1');assert.equal(gateway.runtime.profileDigest,databaseProfileDigest(f.profile));
  for(const secret of [f.config.runtime.password,f.config.issuer.password,f.config.writerCredential,f.config.issuerCredential])assert.equal(client.includes(secret),false);
  assert.equal(fs.statSync(plan.gatewayConfigPath).gid,982);assert.equal(fs.statSync(plan.gatewayConfigPath).mode&0o777,0o640);
  const files=[plan.gatewayConfigPath,plan.clientConfigPath,plan.ingressConfigPath,plan.signerConfigPath,plan.dropinPath,plan.manifestPath],before=files.map(p=>fs.statSync(p).ino);
  await installZolaConfiguration(await prepareOwnedZolaConfigurationInstall(f.input,f.options),f.execution);
  assert.deepEqual(files.map(p=>fs.statSync(p).ino),before);
  assert.equal(JSON.stringify([result,f.events]).includes(f.config.runtime.password),false);
 }finally{f.cleanup();}
});
test('owned profile mismatch, public mode and foreign drop-in are refused before intent',rootOnly,async()=>{
 for(const kind of ['profile','mode','dropin']){const f=fixture();try{
  if(kind==='profile')fs.writeFileSync(f.profileFile,JSON.stringify({...f.profile,creatorOid:f.profile.creatorOid+1}));
  if(kind==='mode')fs.chmodSync(f.profileFile,0o640);
  if(kind==='dropin'){fs.mkdirSync(path.join(f.paths.unitDirectory,'blackspire-command.service.d'));fs.writeFileSync(path.join(f.paths.unitDirectory,'blackspire-command.service.d','40-zola-writer.conf'),'foreign\n',{mode:0o644});}
  await assert.rejects(prepareOwnedZolaConfigurationInstall(f.input,f.options));assert.equal(f.events.length,0);
 }finally{f.cleanup();}}
});
test('owned profile/source drift or lost quiescence during awaited health refuses before publication',rootOnly,async()=>{
 for(const kind of ['profile','source','quiescence']){const f=fixture();try{
  const plan=await prepareOwnedZolaConfigurationInstall(f.input,f.options);
  const connect=async value=>{await Promise.resolve();if(kind==='profile'){const bytes=fs.readFileSync(f.profileFile);fs.unlinkSync(f.profileFile);fs.writeFileSync(f.profileFile,bytes,{mode:0o600});}
   if(kind==='source')fs.writeFileSync(f.input.configurationFile,JSON.stringify({...f.config,writerCredential:randomBytes(32).toString('base64url')}));
   if(kind==='quiescence')f.stopQuiescence();return f.execution.connect(value);};
  await assert.rejects(installZolaConfiguration(plan,{...f.execution,connect}));assert.equal(f.events.length,0);assert.equal(fs.existsSync(plan.clientConfigPath),false);
 }finally{f.cleanup();}}
});
test('owned actual post-link lost acknowledgement reconciles retained files without replacement',rootOnly,async()=>{
 const f=fixture();try{
  const io=Object.create(fs);let lost=false;io.linkSync=(a,b)=>{fs.linkSync(a,b);if(!lost&&b.includes('buyer-writer-ingress-')){lost=true;throw new Error('synthetic link acknowledgement loss');}};
  const plan=await prepareOwnedZolaConfigurationInstall(f.input,{...f.options,io});
  await assert.rejects(installZolaConfiguration(plan,f.execution));assert.equal(lost,true);assert.equal(fs.statSync(plan.ingressConfigPath).nlink,2);
  const before=fs.statSync(plan.ingressConfigPath).ino;
  await installZolaConfiguration(await prepareOwnedZolaConfigurationInstall(f.input,f.options),f.execution);
  assert.equal(fs.statSync(plan.ingressConfigPath).ino,before);assert.equal(fs.statSync(plan.ingressConfigPath).nlink,1);assert.equal(fs.existsSync(plan.manifestPath),true);
 }finally{f.cleanup();}
});

test('actual protected successor gateway/dropin replacement precedes native installer and lost ACK reuses files',rootOnly,async()=>{
 const f=fixture();try{
  const oldPlan=await prepareOwnedZolaConfigurationInstall(f.input,f.options);await installZolaConfiguration(oldPlan,f.execution);
  const before={gateway:fs.readFileSync(oldPlan.gatewayConfigPath,'utf8'),dropin:fs.readFileSync(oldPlan.dropinPath,'utf8')},keyPath=f.config.operationPermitSignerConfiguration.activePrivateKeyPath,keyBefore=fs.readFileSync(keyPath),keyInode=fs.statSync(keyPath).ino;
  const nextSha='c'.repeat(40),authority={...f.config.authority,releaseSha:nextSha,attemptId:randomUUID()},next={...f.config,authority,operationPermitConfiguration:JSON.stringify({...JSON.parse(f.config.operationPermitConfiguration),releaseSha:nextSha,attemptId:authority.attemptId})};
  f.input.releaseSha=nextSha;f.artifactProof.releaseSha=nextSha;fs.writeFileSync(f.input.configurationFile,JSON.stringify(next));
  await assert.rejects(prepareOwnedZolaConfigurationInstall(f.input,f.options));
  const after=renderOwnedSuccessorLiveWriter(renderZolaGatewayConfigurations(next),{configDirectory:f.paths.configDirectory}),transition={before,after,gatewayGid:982,paths:{gateway:oldPlan.gatewayConfigPath,dropin:oldPlan.dropinPath}};let writes=0;
  assert.throws(()=>publishOwnedSuccessorLiveWriter(transition,{publish:(...args)=>{publishOwnedConfigurationBytes(...args);if(++writes===1)throw Error('lost gateway ACK');}}));
  assert.equal(fs.readFileSync(oldPlan.gatewayConfigPath,'utf8'),after.gateway);assert.equal(fs.readFileSync(oldPlan.dropinPath,'utf8'),before.dropin);
  await assert.rejects(prepareOwnedZolaConfigurationInstall(f.input,f.options));publishOwnedSuccessorLiveWriter(transition);
  const prepared=await prepareOwnedZolaConfigurationInstall(f.input,f.options);let disconnected=false;
  await assert.rejects(installZolaConfiguration(prepared,{...f.execution,record:event=>{if(event.event==='configuration_install_verified'&&!disconnected){disconnected=true;throw Error('lost final ACK');}}}));
  const files=[prepared.clientConfigPath,prepared.ingressConfigPath,prepared.signerConfigPath,prepared.manifestPath],inodes=files.map(p=>fs.statSync(p).ino);
  const result=await installZolaConfiguration(await prepareOwnedZolaConfigurationInstall(f.input,f.options),f.execution);assert.equal(result.status,'INSTALLED_RELOAD_REQUIRED');assert.deepEqual(files.map(p=>fs.statSync(p).ino),inodes);assert.ok(f.closed()>=3);
  assert.deepEqual(fs.readFileSync(keyPath),keyBefore);assert.equal(fs.statSync(keyPath).ino,keyInode);
  publishOwnedSuccessorLiveWriter({...transition,before:after,after:before});assert.equal(fs.readFileSync(oldPlan.gatewayConfigPath,'utf8'),before.gateway);assert.equal(fs.readFileSync(oldPlan.dropinPath,'utf8'),before.dropin);
 }finally{f.cleanup();}
});
