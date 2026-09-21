import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {buildBuyerWriterGatewayV4Preparation,publishBuyerWriterGatewayV4Preparation} from '../packages/buyer-writer/gateway-v4-preparation.js';
import {inputFixture,translatedFilesystem,deterministicDependencies} from './helpers/buyer-writer-gateway-v4-preparation.js';
import {BLOCKED_RELEASE} from '../packages/zola-release/retired-release-history.js';
import {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest} from '../packages/buyer-writer/owned-postgres.js';
import {renderZolaGatewayConfigurations} from '../packages/zola-release/gateway-configuration-render.js';
import {validateBuyerWriterGatewayServiceConfiguration} from '../packages/buyer-writer/gateway-entry.js';
import {inspectBuyerWriterGatewayConfigurationUpgrade,inspectOwnedBuyerWriterGatewayConfigurationUpgrade,upgradeOwnedBuyerWriterGatewayConfiguration} from '../packages/buyer-writer/gateway-configuration-upgrade.js';
import {createBuyerWriterGatewayConfigurationFileControls,reconcileBuyerWriterGatewayConfigurationFile} from '../packages/buyer-writer/gateway-configuration-upgrade-files.js';
const rootOnly={skip:process.getuid?.()!==0},secret=()=>randomBytes(32).toString('base64url');
const digest=v=>createHash('sha256').update(JSON.stringify(v)+'\n').digest('hex');
const ca=fs.readFileSync(new URL('./fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
function fixture(t){
 const workspace='blackspire-command',bindingFile='/etc/blackspire/buyer-writer-binding.json';
 const source=(owned)=>{
  const authority={releaseSha:owned?'a'.repeat(40):BLOCKED_RELEASE.releaseSha,operationId:owned?randomUUID():BLOCKED_RELEASE.operationId,attemptId:owned?randomUUID():BLOCKED_RELEASE.attemptId,workspace,gatewayIdentity:'blackspire-writer'};
  const runtime=owned?{backendProfile:'owned-postgres-v1',profileDigest:ownedPostgresProfileDigest(profile),host:profile.host,port:profile.port,database:profile.database,ca,password:secret()}:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',ca,password:secret()};
  return {version:3,workspace,bindingFile,writerCredential:secret(),issuerCredential:secret(),gatewayCapability:secret(),creatorOid:owned?profile.creatorOid:16388,authority,runtime,issuer:{...runtime,password:secret()}};
 };
 const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16384,systemIdentifier:'1234567890123456789',caSha256:createHash('sha256').update(ca).digest('hex')};
 const oldSource=source(false),ownedSource=source(true);
 const rendered=s=>{
  const keyId='zola-'+s.authority.releaseSha.slice(0,16),publicKeyPem=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
  const verification={version:2,keys:[{keyId,publicKeyPem,lifecycle:'current',verifyNotBefore:0,verifyNotAfter:null}]};
  const permit={issuer:'zola-control',audience:'buyer-writer',subject:'00000000-0000-4000-8000-000000000004',keyId,origin:'https://blackspirehelix.com',...Object.fromEntries(['releaseSha','operationId','attemptId','workspace'].map(k=>[k,s.authority[k]]))};
  const provisioning={...s,version:4,admissionCredential:secret(),operationPermitConfiguration:JSON.stringify(permit),operationPermitVerificationConfiguration:verification,operationPermitSignerConfiguration:{version:1,activeKeyId:keyId,activePrivateKeyPath:'/etc/blackspire/buyer-writer-signing-key-'+keyId+'.pem',verification}};
  return renderZolaGatewayConfigurations(provisioning).gatewayConfig;
 };
 const oldConfiguration=rendered(oldSource),newConfiguration=rendered(ownedSource);
 validateBuyerWriterGatewayServiceConfiguration(oldConfiguration);validateBuyerWriterGatewayServiceConfiguration(newConfiguration);
 const bound={...Object.fromEntries(['releaseSha','operationId','attemptId'].map(k=>[k,ownedSource.authority[k]])),artifactDigest:'b'.repeat(64),candidateDigest:'c'.repeat(64)};
 const root=fs.mkdtempSync('/root/owned-gateway-transition-test-'),configurationDirectory=path.join(root,'gateway'),stateDirectory=path.join(root,'owned-state'),configurationFile=path.join(configurationDirectory,'gateway.json'),writerGroupId=982;
 fs.mkdirSync(configurationDirectory,{mode:0o750});fs.chownSync(configurationDirectory,0,writerGroupId);fs.mkdirSync(stateDirectory,{mode:0o700});
 fs.writeFileSync(configurationFile,JSON.stringify(oldConfiguration)+'\n',{mode:0o640});fs.chownSync(configurationFile,0,writerGroupId);fs.chmodSync(configurationFile,0o640);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const events=[],args={...bound,oldConfiguration,newConfiguration,ownedProfile:profile,ownedSource};
 const fileArgs={...bound,configurationFile,stateDirectory,writerGroupId,proveQuiesced:async()=>true};
 const controls=createBuyerWriterGatewayConfigurationFileControls(fileArgs);
 const appendJournal=async e=>events.push(structuredClone(e));
 return {args,fileArgs,controls,events,appendJournal,configurationFile,stateDirectory,root};
}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const reconcile=f=>{inspectOwnedBuyerWriterGatewayConfigurationUpgrade(f.args);return reconcileBuyerWriterGatewayConfigurationFile({...f.args,...f.fileArgs,journalEvents:f.events,appendJournal:f.appendJournal});};
function prefix(f){return ['started','quiesced','prepared'].map(phase=>({version:1,kind:'buyer_writer_gateway_configuration_upgrade',...Object.fromEntries(['releaseSha','operationId','attemptId','artifactDigest','candidateDigest'].map(k=>[k,f.args[k]])),phase,status:'IN_PROGRESS',oldConfigDigest:digest(f.args.oldConfiguration),newConfigDigest:digest(f.args.newConfiguration),updatedAt:'2026-09-21T00:00:00.000Z'}));}
test('genuine legacy v4 to owned v4 uses actual renderer/validator and protected backup',rootOnly,async t=>{
 const f=fixture(t);assert.equal(f.args.oldConfiguration.version,4);assert.equal(f.args.newConfiguration.version,4);
 assert.throws(()=>inspectBuyerWriterGatewayConfigurationUpgrade(f.args));
 assert.equal(inspectOwnedBuyerWriterGatewayConfigurationUpgrade(f.args).status,'UPGRADE_PREPARED');
 const result=await upgradeOwnedBuyerWriterGatewayConfiguration({...f.args,controls:f.controls,appendJournal:f.appendJournal,now:()=>Date.now()});
 assert.equal(result.status,'UPGRADED');assert.deepEqual(read(f.configurationFile),f.args.newConfiguration);
 const backup=path.join(f.stateDirectory,f.args.operationId+'.backup.json');assert.deepEqual(read(backup),f.args.oldConfiguration);assert.equal(fs.statSync(backup).mode&0o7777,0o600);
 assert.equal(fs.statSync(f.configurationFile).mode&0o7777,0o640);assert.equal(fs.statSync(f.configurationFile).gid,f.fileArgs.writerGroupId);
 const inode=fs.statSync(f.configurationFile).ino;assert.equal((await reconcile(f)).status,'UPGRADED');assert.equal((await reconcile(f)).status,'UPGRADED');assert.equal(fs.statSync(f.configurationFile).ino,inode);
 const serialized=JSON.stringify([result,f.events,read(path.join(f.stateDirectory,f.args.operationId+'.state.json'))]);
 for(const value of [f.args.ownedSource.writerCredential,f.args.ownedSource.gatewayCapability,f.args.oldConfiguration.runtime.password,f.args.newConfiguration.runtime.password])assert.equal(serialized.includes(value),false);
});
test('lost real rename acknowledgement reconciles exact owned bytes without another publication',rootOnly,async t=>{
 const f=fixture(t);let renames=0;
 const io={...fs,renameSync:(from,to)=>{fs.renameSync(from,to);if(to===f.configurationFile){renames++;throw Error('synthetic lost rename acknowledgement');}}};
 const controls=createBuyerWriterGatewayConfigurationFileControls({...f.fileArgs,io});
 inspectOwnedBuyerWriterGatewayConfigurationUpgrade(f.args);
 const prepared=await controls.prepareReplacement(f.args.oldConfiguration,f.args.newConfiguration);f.events.push(...prefix(f));
 await assert.rejects(controls.publishReplacement(prepared,f.args.newConfiguration));
 assert.deepEqual(read(f.configurationFile),f.args.newConfiguration);assert.equal(read(path.join(f.stateDirectory,f.args.operationId+'.state.json')).phase,'PREPARED');
 assert.equal((await reconcile(f)).status,'UPGRADED');assert.equal((await reconcile(f)).status,'UPGRADED');assert.equal(renames,1);
 assert.deepEqual(read(path.join(f.stateDirectory,f.args.operationId+'.backup.json')),f.args.oldConfiguration);
});
test('unpublished prepared state reconciles rollback and never installs a new target on retry',rootOnly,async t=>{
 const f=fixture(t),before=fs.statSync(f.configurationFile).ino;
 await f.controls.prepareReplacement(f.args.oldConfiguration,f.args.newConfiguration);f.events.push(...prefix(f));
 assert.equal((await reconcile(f)).status,'ROLLED_BACK');assert.deepEqual(read(f.configurationFile),f.args.oldConfiguration);assert.equal(fs.statSync(f.configurationFile).ino,before);
});
test('foreign backup or configuration and lost quiescence refuse reconciliation',rootOnly,async t=>{
 for(const kind of ['backup','current','running']){
  const f=fixture(t);await upgradeOwnedBuyerWriterGatewayConfiguration({...f.args,controls:f.controls,appendJournal:f.appendJournal,now:()=>Date.now()});
  if(kind==='backup')fs.writeFileSync(path.join(f.stateDirectory,f.args.operationId+'.backup.json'),JSON.stringify({...f.args.oldConfiguration,creatorOid:77777})+'\n');
  if(kind==='current')fs.writeFileSync(f.configurationFile,JSON.stringify({...f.args.newConfiguration,creatorOid:77777})+'\n');
  if(kind==='running')f.fileArgs.proveQuiesced=async()=>false;
  const before=fs.readFileSync(f.configurationFile);await assert.rejects(reconcile(f));assert.deepEqual(fs.readFileSync(f.configurationFile),before);
 }
});


test('real owned candidate builder publishes fresh capability and new permit for genuine old v4',rootOnly,t=>{
 const f=fixture(t),translated=translatedFilesystem(t),base=inputFixture(),s=f.args.ownedSource;
 const {authority,gatewayCapability,...credentials}=s;
 const target={...base.acceptanceTarget,kind:'zola_owned_bounded_writer_acceptance_target',releaseSha:authority.releaseSha,backendProfile:'owned-postgres-v1',profileDigest:ownedPostgresProfileDigest(f.args.ownedProfile)};
 const input={...base,...Object.fromEntries(['releaseSha','operationId','attemptId'].map(k=>[k,authority[k]])),keyId:'zola-'+authority.releaseSha.slice(0,16),candidatePath:'/var/lib/blackspire-operator/preparation/owned-buyer-writer-v4-'+authority.releaseSha+'.json',artifact:{...base.artifact,releaseSha:authority.releaseSha},sourceConfiguration:{...credentials,version:1},currentGatewayConfiguration:f.args.oldConfiguration,acceptanceTarget:target};
 const dependencies={...deterministicDependencies(),ownedTransition:{ownedSource:s,ownedProfile:f.args.ownedProfile}};
 const plan=buildBuyerWriterGatewayV4Preparation(input,dependencies);
 publishBuyerWriterGatewayV4Preparation(plan,{io:translated.io,aclTool:dependencies.aclTool});
 const candidate=JSON.parse(translated.io.readFileSync(input.candidatePath,'utf8'));
 assert.equal(candidate.version,4);assert.equal(candidate.gatewayCapability,gatewayCapability);assert.notEqual(candidate.gatewayCapability,f.args.oldConfiguration.gatewayCapability);
 assert.deepEqual(candidate.runtime,s.runtime);assert.deepEqual(candidate.issuer,s.issuer);assert.deepEqual(candidate.authority,authority);
 assert.equal(JSON.parse(candidate.operationPermitConfiguration).subject,target.ownerId);
 const rendered=renderZolaGatewayConfigurations(candidate).gatewayConfig;validateBuyerWriterGatewayServiceConfiguration(rendered);
 assert.equal(inspectOwnedBuyerWriterGatewayConfigurationUpgrade({...f.args,newConfiguration:rendered}).status,'UPGRADE_PREPARED');
});
