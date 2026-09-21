import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {hash} from '../packages/zola-release/commander-journal.js';
import {renderZolaGatewayConfigurations} from '../packages/zola-release/gateway-configuration-render.js';
import {collectInstalledHeldWriterProfile} from '../packages/zola-release/held-writer-profile.js';
import {openDenialSessionRuntime} from '../packages/zola-six-reads/denial-runtime.js';

async function installedFixture(t,releaseSha){
 const root=fs.mkdtempSync('/run/zola-held-composed-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const configDirectory=path.join(root,'config'),gatewayDirectory=path.join(root,'gateway'),unitDirectory=path.join(root,'units');
 for(const d of [configDirectory,gatewayDirectory,unitDirectory,path.join(unitDirectory,'blackspire-command.service.d')])fs.mkdirSync(d,{mode:0o755});
 const secret=()=>randomBytes(32).toString('base64url'),apiGeneration='b'.repeat(32),workerGeneration='c'.repeat(32),runId=randomUUID();
 const authority={releaseSha,operationId:randomUUID(),attemptId:randomUUID(),workspace:'blackspire-command',gatewayIdentity:'blackspire-writer'};
 const keyPair=generateKeyPairSync('ed25519'),privateKeyPath=path.join(configDirectory,'key.pem');fs.writeFileSync(privateKeyPath,keyPair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});fs.chownSync(privateKeyPath,994,984);
 const permit={issuer:'zola-control',audience:'buyer-writer',subject:randomUUID(),keyId:'fixture-key',origin:'https://zola.example',releaseSha,operationId:authority.operationId,attemptId:authority.attemptId,workspace:'blackspire-command'};
 const verification={version:2,keys:[{keyId:'fixture-key',publicKeyPem:keyPair.publicKey.export({type:'spki',format:'pem'}),lifecycle:'current',verifyNotBefore:0,verifyNotAfter:null}]};
 const ca=fs.readFileSync(new URL('./fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
 const source={version:4,workspace:'blackspire-command',bindingFile:path.join(configDirectory,'buyer-writer-binding.json'),writerCredential:secret(),issuerCredential:secret(),admissionCredential:secret(),gatewayCapability:secret(),creatorOid:16384,authority,
  runtime:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:secret(),ca},issuer:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:secret(),ca},
  operationPermitConfiguration:JSON.stringify(permit),operationPermitVerificationConfiguration:verification,operationPermitSignerConfiguration:{version:1,activeKeyId:'fixture-key',activePrivateKeyPath:privateKeyPath,verification}};
 const rendered=renderZolaGatewayConfigurations(source),manifest={schema:1,kind:'zola_installed_buyer_writer',releaseSha,artifactDigest:'d'.repeat(64),workspace:'blackspire-command'};
 for(const key of ['clientConfig','ingressConfig','signerConfig','gatewayConfig']){const bytes=JSON.stringify(rendered[key])+'\n',digest=hash(bytes),file=key==='gatewayConfig'?path.join(gatewayDirectory,'gateway.json'):path.join(configDirectory,'buyer-writer-'+key.replace('Config','')+'-'+digest+'.json');fs.writeFileSync(file,bytes,{mode:0o640});fs.chownSync(file,0,key==='gatewayConfig'?982:984);manifest[key]={path:file,digest};}
 const dropin=path.join(unitDirectory,'blackspire-command.service.d/40-zola-writer.conf');fs.writeFileSync(dropin,'[Service]\n',{mode:0o644});manifest.serviceDropin={path:dropin,digest:hash('[Service]\n')};const manifestFile=path.join(configDirectory,'zola-installed-'+releaseSha+'.json');fs.writeFileSync(manifestFile,JSON.stringify(manifest)+'\n',{mode:0o600});
 const proc=(pid,parentPid,uid,groups,unit)=>({parentPid,uid,euid:uid,suid:uid,fsuid:uid,gid:986,egid:986,sgid:986,fsgid:986,groups,capEffective:'0',capPermitted:'0',capAmbient:'0',capInheritable:'0',noNewPrivileges:true,startTime:String(pid),controlGroup:'/system.slice/'+unit,pid});
 const apiUnit='blackspire-command.service',workerUnit='blackspire-command-worker.service';
 const api={supervisor:proc(process.pid+100,1,994,[984,986],apiUnit),child:proc(process.pid,process.pid+100,994,[984,986],apiUnit)};
 const worker={supervisor:proc(process.pid+101,1,993,[983,986],workerUnit),child:proc(process.pid+102,process.pid+101,993,[983,986],workerUnit)};
 const service=(unit,user,pid,invocationId)=>({unit,user,state:'active',subState:'running',pid,invocationId,type:'simple',notifyAccess:'none',pidFile:'',controlGroup:'/system.slice/'+unit,pid});
 const runtime={api:{...api.child,...service(apiUnit,'blackspire-api',api.child.pid,apiGeneration),supervisor:api.supervisor},worker:service(workerUnit,'blackspire-worker',worker.supervisor.pid,workerGeneration)};
 const inspectRuntime=async()=>structuredClone(runtime),collect=({role})=>structuredClone(role==='api'?api:worker);
 const profileOptions={configDirectory,gatewayDirectory,unitDirectory,resolveIdentity:async()=>({uid:994,credentialGroupId:984,workerUid:993}),capture:collect,inspectFactory:()=>inspectRuntime,
  run:(_file,args)=>args[0]==='group'?'blackspire-writer:x:982:\n':String(api.supervisor.pid)+'\n'};

 return {collect:sha=>collectInstalledHeldWriterProfile(sha,profileOptions),apiGeneration,workerGeneration,artifactDigest:manifest.artifactDigest};
}

const directory=fs.mkdtempSync('/tmp/zola-denial-runtime-'),database=path.join(directory,'isolated.sqlite');
process.env.BLACKSPIRE_DB_PATH=database;process.env.SESSION_TTL_MS='900000';process.env.NODE_ENV='test';
const {prepareDisposableDatabase}=await import('./helpers/prepare-disposable-database.js');prepareDisposableDatabase(database);
const {openDelegatedSessionService}=await import('../packages/zola-six-reads/denial-session.js');
const service=await openDelegatedSessionService(database),db=await import('../packages/task-engine/db.js');
for(const principal of ['operator','denied'])db.run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[principal,'admin',principal,'bearer','fixture','active',Date.now(),null,null,null,1,Date.now()]);
test.after(()=>{service.close();fs.rmSync(directory,{recursive:true,force:true});});
test('real installed v4 profile composes with actual bounded denial session at candidate and merged artifact roots',{skip:process.getuid()!==0},async t=>{
 for(const releaseSha of ['a'.repeat(40),'b'.repeat(40)]){
  const fixture=await installedFixture(t,releaseSha),root='/opt/blackspire-command/releases/'+releaseSha;
  const state={version:1,mode:'held',releaseSha,runId:randomUUID(),apiGeneration:null,workerGeneration:null};
  let held=false,closed=0,sealed=0;const proof=()=>({releaseSha,environment:'production',artifactDigest:fixture.artifactDigest});
  const dependencies={sourceRoot:root,groupId:0,collect:fixture.collect,readState:()=>structuredClone(state),
   acquire:options=>{assert.equal(options.exclusive,false);assert.equal(options.allowPending,true);held=true;return{assertIdentity(){assert.ok(held);},close(){held=false;closed++;}};},
   verifySource:()=>assert.fail('sealed artifact must not require Git checkout'),inspectSealed:async()=>{sealed++;return proof();},inspectArtifact:async()=>proof()};
  const runtime=await openDenialSessionRuntime(releaseSha,dependencies);let receipt;
  try{
   assert.equal(runtime.profile.context.releaseSha,releaseSha);assert.equal(Object.hasOwn(runtime.profile,'preparationCredential'),false);
   await runtime.assertCurrent();
   const result=service.issue({operatorPrincipal:'operator',deniedPrincipal:'denied',workspace:'blackspire-command',runId:randomUUID(),releaseSha},value=>{runtime.assertHeld();receipt=value;});
   await runtime.assertCurrent();assert.equal(result.status,'DELEGATED_DENIAL_ISSUED');assert.equal(receipt.releaseSha,releaseSha);assert.ok(sealed>=4);
   assert.equal(service.revoke(receipt).status,'DELEGATED_DENIAL_REVOKED');
   state.apiGeneration='f'.repeat(32);state.workerGeneration=fixture.workerGeneration;await assert.rejects(runtime.assertCurrent());
  }finally{runtime.close();}assert.equal(closed,1);
  await assert.rejects(openDenialSessionRuntime(releaseSha,{...dependencies,sourceRoot:root+'-foreign',verifySource:()=>{throw Error('dirty');}}));
 }
});
test('checkout callers retain exact source verification and artifact mismatches close the lease',async()=>{
 const releaseSha='c'.repeat(40),artifactDigest='d'.repeat(64),state={version:1,mode:'held',releaseSha,runId:randomUUID(),apiGeneration:null,workerGeneration:null};
 const profile={context:{releaseSha,artifactRoot:'/opt/blackspire-command/releases/'+releaseSha,environment:'production',workspace:'blackspire-command',apiGeneration:'e'.repeat(32)},workerGeneration:'f'.repeat(32),artifactDigest,configurationDigest:'0'.repeat(64)};
 let closes=0,sources=0;const deps={sourceRoot:'/reviewed/checkout',groupId:0,readState:()=>state,acquire:()=>({assertIdentity(){},close(){closes++;}}),
  verifySource:(sha,{root})=>{assert.equal(sha,releaseSha);assert.equal(root,'/reviewed/checkout');sources++;},collect:async()=>profile,
  inspectArtifact:async()=>({releaseSha,environment:'production',artifactDigest}),inspectSealed:()=>assert.fail('not artifact caller')};
 const runtime=await openDenialSessionRuntime(releaseSha,deps);runtime.close();assert.equal(sources,2);assert.equal(closes,1);
 await assert.rejects(openDenialSessionRuntime(releaseSha,{...deps,inspectArtifact:async()=>({releaseSha,environment:'production',artifactDigest:'1'.repeat(64)})}));assert.equal(closes,2);
});
