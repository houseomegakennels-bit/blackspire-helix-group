import {validateOwnedN8nAttempt4Supervisor} from './owned-n8n-cloud-attempt4-supervisor.js';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {openOwnedN8nNotReadyRecoveryContext,CLOUD_ROOT} from './owned-n8n-cloud-attempt4-host.js';
import {NOT_READY_NAMES,NOT_READY_WORKFLOW,validateNotReadyOwnedN8nAttempt,validateNotReadyOwnedN8nRetirement,retireNotReadyOwnedN8nAttempt} from './owned-n8n-cloud-not-ready.js';
const files=createBuyerStoreProtectedFiles(),ROOT=CLOUD_ROOT+'-retirement',PROXY='/etc/nginx/sites-available/jarvis-staging.conf',fail=()=>{throw Error('Interrupted native recovery refused');};
const run=(f,args)=>execFileSync(f,args,{encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}).trim();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const old=()=>Object.fromEntries(NOT_READY_NAMES.map(n=>{const p=CLOUD_ROOT+'/'+n+'.json';if(files.value(p+'.pending',true))fail();return[n,files.value(p,true)];}));
const read=n=>{const p=ROOT+'/'+n+'.json',a=files.value(p,true),b=files.value(p+'.pending',true);if(a&&b)fail();return a??b;};
export function observeInterruptedOwnedN8nLocal(){
 const s=fs.lstatSync(PROXY);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||s.nlink!==1||(s.mode&4095)!==0o644||s.size>65536||run('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--',PROXY])!=='')fail();
 try{fs.lstatSync(PROXY+'.zola-cloud-proof');fail();}catch(e){if(e.code!=='ENOENT')throw e;}
 if(run('/usr/bin/ss',['-H','-ltn','sport = :18947'])!=='')fail();return {proxy:fs.readFileSync(PROXY,'utf8'),listenerAbsent:true,temporaryAbsent:true};
}
export function readOwnedN8nNotReadyAttempt4({checkLocal=true}={}){
 const records=old();validateNotReadyOwnedN8nAttempt(records);const retained={observation:read('observation'),intent:read('intent'),result:read('result')};for(const n of ['observation','intent','result'])if(files.value(ROOT+'/'+n+'.json.pending',true))fail();
 const result=validateNotReadyOwnedN8nRetirement(records,retained);if(retained.observation?.local?.supervisorExitedAt!==verifyCompletedSupervisor(records))fail();if(checkLocal){const local=observeInterruptedOwnedN8nLocal();if(local.proxy!==records['proxy-bytes'].before)fail();}return {records,...retained,result};
}
export async function cleanupNotReadyOwnedN8nAttempt4(){
 const c=await openOwnedN8nNotReadyRecoveryContext();try{const records=old();validateNotReadyOwnedN8nAttempt(records);files.directory(ROOT,{create:true});
 const fence=async()=>{if(!same(old(),records))fail();verifyCompletedSupervisor(records);await c.fence();if(!same(old(),records))fail();verifyCompletedSupervisor(records);};
 verifyCompletedSupervisor(records);const result=await retireNotReadyOwnedN8nAttempt(records,{request:async(method,route)=>{if(!['GET','DELETE'].includes(method)||!['/api/v1/workflows/'+NOT_READY_WORKFLOW,'/api/v1/executions?workflowId='+NOT_READY_WORKFLOW+'&limit=100&includeData=false'].includes(route)||method==='DELETE'&&route.includes('executions'))fail();return c.request(method,route);},store:{value:read,record:(n,v)=>{if(!['observation','intent','result'].includes(n))fail();files.record(ROOT+'/'+n+'.json',v);}},fence,observeLocal:()=>({...observeInterruptedOwnedN8nLocal(),supervisorExitedAt:verifyCompletedSupervisor(records)})});
 await fence();return {status:'FAILED_AFTER_PROXY_BEFORE_READY_RETIRED',workflowDeleted:result.workflowDeleted,positiveProof:false,attempt:4};
 }finally{c.close();}
}

function verifyCompletedSupervisor(records){
 const keys=['Type','User','Group','UMask','RuntimeMaxUSec','TimeoutStopUSec','Restart','KillMode','RemainAfterExit','NoNewPrivileges','ActiveState','SubState','MainPID','InvocationID','ExecStart','Result','ExecMainStatus','ExecMainExitTimestamp'];
 const text=run('/usr/bin/systemctl',['show','zola-n8n-cloud-proof-attempt4.service','--property='+keys.join(','),'--no-pager']);
 const properties=Object.fromEntries(text.split('\n').map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
 validateOwnedN8nAttempt4Supervisor({plan:records.plan,operatorRoot:'/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt4-20260922',root:CLOUD_ROOT,intent:records['supervisor-intent'],result:records['supervisor-result'],properties,phase:'failed'});
 const exit=Date.parse(properties.ExecMainExitTimestamp);if(!Number.isFinite(exit)||exit<Date.parse(records.plan.createdAt)||exit>=Date.parse(records.plan.expiresAt))fail();return new Date(exit).toISOString();
}
