import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {verifyReleaseSource,readReleaseProtectedBytes} from './commander-host.js';
import {inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {buildInheritedOwnedFrontend,OWNED_CONFIG_PREDECESSOR} from './owned-successor-configuration.js';
import {OWNED_BUYER_CONFIGURATION as C,createOwnedBuyerVercelTransport} from './owned-buyer-configuration.js';
import {readOwnedConfigurationBytes,publishOwnedConfigurationBytes} from './owned-buyer-configuration-host.js';
import {observeReceiverDeployment} from './receiver-origin-transition.js';
const fail=()=>{throw new Error('Owned preview preparation refused; retain deployment intent and reconcile');};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same=(a,b)=>hash(a)===hash(b);
const exact=(v,keys)=>v&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
function identity(value,releaseSha,id){
 const sources=[value.meta?.githubCommitSha,value.gitSource?.sha].filter(Boolean);
 if(value.id!==id||!/^dpl_[A-Za-z0-9]+$/.test(id??'')||value.projectId!==C.project||value.target!==null||!sources.length||sources.some(s=>s!==releaseSha)
 ||value.meta?.githubCommitRef&&value.meta.githubCommitRef!==C.branch||value.gitSource?.ref&&value.gitSource.ref!==C.branch||typeof value.url!=='string'||!(/^[a-z0-9-]+\.vercel\.app$/).test(value.url))fail();
 return {schema:1,releaseSha,frontendOrigin:'https://'+value.url,deploymentId:id};
}
export function createOwnedSuccessorPreviewTransport(host){
 const settings=createOwnedBuyerVercelTransport({token:host.token});
 const request=async(route,body,method=body?'POST':'GET')=>{const r=await fetch('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId='+C.team,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+host.token(),accept:'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok||r.redirected||!r.body)fail();let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.byteLength;if(size>1048576)fail();chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));};
 return {settings:settings.observe,async project(){const p=await request('/v9/projects/'+C.project);if(p.id!==C.project||p.accountId!==C.team||!(p.commandForIgnoringBuildStep===null||typeof p.commandForIgnoringBuildStep==='string'))fail();return p.commandForIgnoringBuildStep;},restoreIgnore:value=>request('/v9/projects/'+C.project,{commandForIgnoringBuildStep:value},'PATCH'),create:body=>request('/v13/deployments?forceNew=1',body),get:id=>{if(!/^dpl_[A-Za-z0-9]+$/.test(id??''))fail();return request('/v13/deployments/'+id);}};
}
function frontend(host,rows,releaseSha){
 const results={};for(const scope of ['preview','production'])for(const key of ['BLACKSPIRE_BUYER_STORE_MODE','BLACKSPIRE_BUYER_STORE_URL','BLACKSPIRE_BUYER_DEAL_CONTEXT_KEY']){const name=scope+'-'+key.toLowerCase();results[name]=host.readPredecessor(name+'.result.json');}
 const proof=buildInheritedOwnedFrontend({previousReleaseSha:OWNED_CONFIG_PREDECESSOR,releaseSha,frontendPlan:host.readPredecessor('frontend-plan.json'),rows,results});
 if(!same(proof,host.readInheritance()))fail();return hash(proof);
}
async function restoreIgnore(host,transport,plan){
 // The provider may persist projectSettings. Restore only the retained old value
 // from the exact requested override, with intent before any PATCH and GET reconciliation.
 const restoreIntent={version:1,planDigest:hash(plan),before:plan.ignoreBefore,override:'exit 1'};
 const retainedRestore=host.read('preview.ignore-restore-intent.json');if(retainedRestore&&!same(retainedRestore,restoreIntent))fail();
 let ignore=await transport.project();
 if(ignore!==plan.ignoreBefore){if(ignore!=='exit 1')fail();host.publish('preview.ignore-restore-intent.json',restoreIntent);await host.assertStopped();
  ignore=await transport.project();if(ignore!==plan.ignoreBefore){if(ignore!=='exit 1')fail();await transport.restoreIgnore(plan.ignoreBefore);}
  if(await transport.project()!==plan.ignoreBefore)fail();
 }
 if(retainedRestore)host.publish('preview.ignore-restore-intent.json',restoreIntent);
 host.publish('preview.ignore-restored.json',{version:1,planDigest:hash(plan),ignore:plan.ignoreBefore});

}
// A created ID is durable before polling. An intent without an ID is ambiguous and never retried.
export async function prepareOwnedSuccessorPreview({releaseSha},{host,transport,verifyReceiver=observeReceiverDeployment}={}){
 if(!/^[a-f0-9]{40}$/.test(releaseSha??''))fail();await host.assertStopped();
 const frontendDigest=frontend(host,await transport.settings(),releaseSha),before=host.readReceiver();
 let plan=host.read('preview-plan.json');
 if(!plan){if(before===null)fail();if(before!==null){let parsed;try{parsed=JSON.parse(before);}catch{fail();}if(!exact(parsed,['schema','releaseSha','frontendOrigin','deploymentId'])||parsed.schema!==1||parsed.releaseSha!==OWNED_CONFIG_PREDECESSOR)fail();}
  plan={version:1,releaseSha,frontendDigest,receiverBefore:before,ignoreBefore:await transport.project()};host.publish('preview-plan.json',plan);}
 if(!exact(plan,['version','releaseSha','frontendDigest','receiverBefore','ignoreBefore'])||plan.version!==1||plan.releaseSha!==releaseSha||plan.frontendDigest!==frontendDigest||!(plan.ignoreBefore===null||typeof plan.ignoreBefore==='string'))fail();
 host.publish('preview-plan.json',plan);
 const intent={version:1,planDigest:hash(plan)},oldIntent=host.read('preview.intent.json');let created=host.read('preview.created.json');
 if(oldIntent&&!same(oldIntent,intent)||created&&!oldIntent)fail();
 if(!created){if(oldIntent){await restoreIgnore(host,transport,plan);fail();}if(before!==plan.receiverBefore||await transport.project()!==plan.ignoreBefore)fail();await host.assertStopped();frontend(host,await transport.settings(),releaseSha);host.publish('preview.intent.json',intent);
  const response=await transport.create({name:'frontend',project:C.project,gitSource:{type:'github',repoId:'1247069814',ref:C.branch,sha:releaseSha},projectSettings:{commandForIgnoringBuildStep:'exit 1'}});
  if(!/^dpl_[A-Za-z0-9]+$/.test(response?.id??''))fail();
  created={version:1,planDigest:hash(plan),deploymentId:response.id};host.publish('preview.created.json',created);
 }
 if(!exact(created,['version','planDigest','deploymentId'])||created.version!==1||created.planDigest!==hash(plan))fail();
 host.publish('preview.intent.json',intent);host.publish('preview.created.json',created);
 const response=await transport.get(created.deploymentId),receiver=identity(response,releaseSha,created.deploymentId);
 await restoreIgnore(host,transport,plan);
 if(['QUEUED','INITIALIZING','BUILDING'].includes(response.readyState))return {status:'OWNED_SUCCESSOR_PREVIEW_BUILDING',releaseSha,deploymentId:created.deploymentId};
 if(response.readyState!=='READY')fail();
 await verifyReceiver({releaseSha,mode:'preview',origin:receiver.frontendOrigin,deploymentId:receiver.deploymentId});await host.assertStopped();frontend(host,await transport.settings(),releaseSha);
 const after=JSON.stringify(receiver)+'\n';if(![plan.receiverBefore,after].includes(host.readReceiver()))fail();
 host.publish('preview.publish-intent.json',{version:1,planDigest:hash(plan),receiver});
 host.publishReceiver(plan.receiverBefore,after);
 await verifyReceiver({releaseSha,mode:'preview',origin:receiver.frontendOrigin,deploymentId:receiver.deploymentId});await host.assertStopped();frontend(host,await transport.settings(),releaseSha);if(host.readReceiver()!==after)fail();
 host.publish('preview.result.json',{version:1,planDigest:hash(plan),receiver});return {status:'OWNED_SUCCESSOR_PREVIEW_READY',releaseSha,deploymentId:receiver.deploymentId};
}
export function createOwnedSuccessorPreviewHost(releaseSha,{sourceRoot=process.cwd()}={}){
 if(process.getuid?.()!==0||process.getgid?.()!==0||!(/^[a-f0-9]{40}$/).test(releaseSha??'')||releaseSha===OWNED_CONFIG_PREDECESSOR)fail();
 const base='/var/lib/blackspire-operator/owned-successor-preview',root=base+'/'+releaseSha;
 const synchronize=p=>{const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 readOwnedConfigurationBytes('/var/lib/blackspire-operator/.successor-preview-parent-probe');
 for(const dir of [base,root]){try{fs.mkdirSync(dir,{mode:0o700});synchronize(dir.slice(0,dir.lastIndexOf('/')));}catch(e){if(e.code!=='EEXIST')throw e;}const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||(st.mode&4095)!==0o700)fail();}
 const file=name=>{if(!(/^[a-z0-9_.-]+\.json$/).test(name))fail();return root+'/'+name;};
 const parsed=p=>{const before=readOwnedConfigurationBytes(p),stage=readOwnedConfigurationBytes(p+'.owned-buyer-stage');if(before!==null&&stage!==null)fail();return before===null&&stage===null?null:JSON.parse(before??stage);};
 return {
  async assertStopped(){verifyReleaseSource(releaseSha,{root:sourceRoot});await inspectSealedBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+releaseSha,releaseSha,environment:'production'});
   for(const unit of ['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-writer-gateway.service','blackspire-buyer-store.service']){const state=execFileSync('/usr/bin/systemctl',['show',unit,'--property=ActiveState','--property=SubState','--property=MainPID','--property=LoadState'],{encoding:'utf8',timeout:5000,maxBuffer:4096}).trim().split('\n').sort().join('\n');if(state!=='ActiveState=inactive\nLoadState=loaded\nMainPID=0\nSubState=dead')fail();}},
  read:name=>parsed(file(name)),publish:(name,value)=>publishOwnedConfigurationBytes(file(name),null,JSON.stringify(value)+'\n'),
  readPredecessor:name=>{if(!(/^[a-z0-9_.-]+\.json$/).test(name))fail();const bytes=readOwnedConfigurationBytes(C.root+'/'+name);if(bytes===null)fail();return JSON.parse(bytes);},
  readInheritance:()=>{const bytes=readOwnedConfigurationBytes('/var/lib/blackspire-operator/owned-successor-configuration/'+releaseSha+'-frontend.json');if(bytes===null)fail();return JSON.parse(bytes);},
  readReceiver:()=>readOwnedConfigurationBytes(C.receiver),publishReceiver:(before,after)=>publishOwnedConfigurationBytes(C.receiver,before,after),
  token:()=>readReleaseProtectedBytes('/var/lib/blackspire-operator/vercel-token',16384).trim(),
 };
}
