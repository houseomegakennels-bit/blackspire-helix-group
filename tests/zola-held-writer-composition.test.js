import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {hash} from '../packages/zola-release/commander-journal.js';
import {renderZolaGatewayConfigurations} from '../packages/zola-release/gateway-configuration-render.js';
import {collectInstalledHeldWriterProfile} from '../packages/zola-release/held-writer-profile.js';
import {publishVerifiedBuyerWriterActivation} from '../packages/buyer-writer/activation.js';
import {checkBuyerWriterHeldReadiness} from '../packages/buyer-writer/activation-readiness.js';
import {createBuyerWriterBindingObserver} from '../packages/buyer-writer/binding.js';
import {createBuyerWriterPreparation,createBuyerWriterAvailability} from '../packages/buyer-writer/availability.js';
import {createBuyerWriterRequestHandler} from '../packages/buyer-writer/http.js';
import {acquireReleaseAdmissionLock,createReleaseAdmissionGuard,withHeldWriterPreparation,RELEASE_ADMISSION_LOCK} from '../packages/shared/release-admission.js';

test('installed manifest to real binding/commit publication composes with authenticated HELD preparation and closed ordinary admission',{skip:process.getuid()!==0},async t=>{
 const root=fs.mkdtempSync('/run/zola-held-composed-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const configDirectory=path.join(root,'config'),gatewayDirectory=path.join(root,'gateway'),unitDirectory=path.join(root,'units');
 for(const d of [configDirectory,gatewayDirectory,unitDirectory,path.join(unitDirectory,'blackspire-command.service.d')])fs.mkdirSync(d,{mode:0o755});
 const secret=()=>randomBytes(32).toString('base64url'),releaseSha='a'.repeat(40),apiGeneration='b'.repeat(32),workerGeneration='c'.repeat(32),runId=randomUUID();
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
 const profile=await collectInstalledHeldWriterProfile(releaseSha,profileOptions);assert.equal(profile.configurationDigest.length,64);assert.equal(profile.context.apiPid,api.child.pid);
 // A correct digest cannot bless the wrong release authority or a changed input.
 const before=fs.readFileSync(manifest.clientConfig.path);const changed=JSON.parse(before);changed.authority.releaseSha='f'.repeat(40);fs.writeFileSync(manifest.clientConfig.path,JSON.stringify(changed)+'\n');await assert.rejects(collectInstalledHeldWriterProfile(releaseSha,profileOptions));fs.writeFileSync(manifest.clientConfig.path,before);
 fs.writeFileSync(path.join(root,'admission.lock'),RELEASE_ADMISSION_LOCK,{mode:0o640});
 const state={version:1,mode:'held',releaseSha,runId,apiGeneration:null,workerGeneration:null},binding={role:'api',releaseSha,runId,generation:apiGeneration,apiGeneration,workerGeneration};
 const acquire=options=>acquireReleaseAdmissionLock({root,owner:0,groupId:0,checkDirectory:()=>{},...options}),admission={required:()=>true,acquire,context:()=>binding,readState:()=>structuredClone(state)},guard=createReleaseAdmissionGuard(admission);
 const workerHealth={required:true,ok:true,state:'idle',heartbeatAgeMs:1,generationId:workerGeneration,restartDetected:false},identity={state:'VERIFIED',build:{value:releaseSha},environment:{value:'production'}};
 const health={ok:true,service:'blackspire-command-api',lifecycle:'ready',database:'available',emergencyStop:false,dependencies:{worker:workerHealth,scheduler:{ok:true}},deploymentIdentity:identity};
 const ready={ok:false,service:'blackspire-command-api',lifecycle:'ready',database:'compatible',productionConfig:{ok:true},checks:{releaseAdmission:false,lifecycle:true,database:true,productionConfig:true,worker:true,scheduler:true,deploymentIdentity:true},dependencies:{worker:workerHealth,scheduler:{ok:true}},deploymentIdentity:identity};
 const observeBinding=requireCommit=>createBuyerWriterBindingObserver({...profile.context,inspectRuntime,requireCommit});
 const base={workspace:'blackspire-command',releaseSha,apiGeneration,environment:'production',getHealth:()=>health,getReadiness:()=>ready};
 let queries=0;const writer=createBuyerWriterRequestHandler({credential:source.writerCredential,workspace:source.workspace,query:async()=>{queries++;},issuer:{credential:source.issuerCredential,query:async()=>{queries++;}},isAvailable:createBuyerWriterAvailability({...base,observeBinding:observeBinding(true)}),isPrepared:createBuyerWriterPreparation({...base,observeBinding:observeBinding(false)})},{admit:fn=>guard.run(fn),prepareAdmit:fn=>withHeldWriterPreparation(fn,admission)});
 const server=http.createServer((req,res)=>{if(req.url==='/health'||req.url==='/ready'){const body=req.url==='/health'?{...health,dependencies:{...health.dependencies,buyerWriter:{enabled:true,ok:true}}}:{...ready,checks:{...ready.checks,buyerWriter:false},dependencies:{...ready.dependencies,buyerWriter:{enabled:true,ok:true}}};res.writeHead(body.ok?200:503,{'content-type':'application/json'});res.end(JSON.stringify(body));}else writer.handleRequest(req,res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const context={...profile.context,port:server.address().port},lease=acquire({exclusive:false,allowPending:true});
 try{
  const result=await publishVerifiedBuyerWriterActivation({context,inspectRuntime,collectProcesses:collect,
inspectArtifact:async()=>({releaseSha,environment:'production',artifactDigest:manifest.artifactDigest}),
   readProcess:pid=>{const value={...Object.values(api).concat(Object.values(worker)).find(p=>p.pid===pid)};delete value.pid;return value;},
   checkReadiness:options=>checkBuyerWriterHeldReadiness({...options,requirePreparation:options.requirePreparation||options.requireWriterReady,preparationCredential:profile.preparationCredential,verifyHeld:()=>lease.assertIdentity()})});
  assert.equal(result.state,'COMMITTED');assert.equal((await observeBinding(true)()).approved,true);assert.equal(fs.statSync(source.bindingFile).nlink,1);assert.equal(fs.statSync(source.bindingFile+'.commit.json').nlink,1);
  const response=await fetch(`http://127.0.0.1:${context.port}/api/internal/buyer-writer/v1/preparation`,{headers:{'x-buyer-issuer-key':source.issuerCredential}});assert.equal(response.status,200);
  assert.equal((await fetch(`http://127.0.0.1:${context.port}/ready`)).status,503);
  const denied=await fetch(`http://127.0.0.1:${context.port}/api/internal/buyer-writer/v1/jobs/00000000-0000-4000-8000-000000000001/operations`,{method:'POST',headers:{'content-type':'application/json','x-buyer-writer-key':source.writerCredential},body:'{}'});assert.equal(denied.status,503);assert.equal(queries,0);
 }finally{lease.close();}
});
