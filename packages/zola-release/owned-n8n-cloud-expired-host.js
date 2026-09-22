import {validateOwnedN8nAttempt3Supervisor} from './owned-n8n-cloud-supervisor.js';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {openOwnedN8nExpiredRecoveryContext,CLOUD_ROOT} from './owned-n8n-cloud-attempt3-host.js';
import {EXPIRED_NAMES,EXPIRED_WORKFLOW,validateExpiredOwnedN8nAttempt,validateExpiredOwnedN8nRetirement,retireExpiredOwnedN8nAttempt} from './owned-n8n-cloud-expired.js';
const files=createBuyerStoreProtectedFiles(),ROOT=CLOUD_ROOT+'-retirement',PROXY='/etc/nginx/sites-available/jarvis-staging.conf',fail=()=>{throw Error('Interrupted native recovery refused');};
const run=(f,args)=>execFileSync(f,args,{encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}).trim();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const old=()=>Object.fromEntries(EXPIRED_NAMES.map(n=>{const p=CLOUD_ROOT+'/'+n+'.json';if(files.value(p+'.pending',true))fail();return[n,files.value(p,true)];}));
const read=n=>{const p=ROOT+'/'+n+'.json',a=files.value(p,true),b=files.value(p+'.pending',true);if(a&&b)fail();return a??b;};
export function observeInterruptedOwnedN8nLocal(){
 const s=fs.lstatSync(PROXY);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||s.nlink!==1||(s.mode&4095)!==0o644||s.size>65536||run('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--',PROXY])!=='')fail();
 try{fs.lstatSync(PROXY+'.zola-cloud-proof');fail();}catch(e){if(e.code!=='ENOENT')throw e;}
 if(run('/usr/bin/ss',['-H','-ltn','sport = :18947'])!=='')fail();return {proxy:fs.readFileSync(PROXY,'utf8'),listenerAbsent:true,temporaryAbsent:true};
}
export function readOwnedN8nExpiredAttempt3({checkLocal=true}={}){
 const records=old();validateExpiredOwnedN8nAttempt(records);const retained={observation:read('observation'),intent:read('intent'),result:read('result')};for(const n of ['observation','intent','result'])if(files.value(ROOT+'/'+n+'.json.pending',true))fail();
 const result=validateExpiredOwnedN8nRetirement(records,retained);if(retained.observation?.local?.supervisorExitedAt!==verifyCompletedSupervisor(records))fail();if(checkLocal){const local=observeInterruptedOwnedN8nLocal();if(local.proxy!==records['proxy-bytes'].before)fail();}return {records,...retained,result};
}
export async function cleanupExpiredOwnedN8nAttempt3(){
 const c=await openOwnedN8nExpiredRecoveryContext();try{const records=old();validateExpiredOwnedN8nAttempt(records);files.directory(ROOT,{create:true});
 const fence=async()=>{if(!same(old(),records))fail();verifyCompletedSupervisor(records);await c.fence();if(!same(old(),records))fail();verifyCompletedSupervisor(records);};
 verifyCompletedSupervisor(records);const result=await retireExpiredOwnedN8nAttempt(records,{request:async(method,route)=>{if(!['GET','DELETE'].includes(method)||!['/api/v1/workflows/'+EXPIRED_WORKFLOW,'/api/v1/executions?workflowId='+EXPIRED_WORKFLOW+'&limit=100&includeData=false','/api/v1/executions/2?includeData=true'].includes(route)||method==='DELETE'&&route.includes('executions'))fail();return c.request(method,route);},store:{value:read,record:(n,v)=>{if(!['observation','intent','result'].includes(n))fail();files.record(ROOT+'/'+n+'.json',v);}},fence,observeLocal:()=>({...observeInterruptedOwnedN8nLocal(),supervisorExitedAt:verifyCompletedSupervisor(records)})});
 await fence();return {status:'EXPIRED_BEFORE_REQUEST_RETIRED',workflowDeleted:result.workflowDeleted,positiveProof:false,attempt:3};
 }finally{c.close();}
}

function verifyCompletedSupervisor(records){
 const keys=['Type','User','Group','UMask','RuntimeMaxUSec','TimeoutStopUSec','Restart','KillMode','RemainAfterExit','NoNewPrivileges','ActiveState','SubState','MainPID','InvocationID','ExecStart','Result','ExecMainStatus','ExecMainExitTimestamp'];
 const text=run('/usr/bin/systemctl',['show','zola-n8n-cloud-proof-attempt3.service','--property='+keys.join(','),'--no-pager']);
 const properties=Object.fromEntries(text.split('\n').map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
 validateOwnedN8nAttempt3Supervisor({plan:records.plan,operatorRoot:'/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt3-20260921',root:CLOUD_ROOT,intent:records['supervisor-intent'],result:records['supervisor-result'],properties,phase:'complete'});
 const exit=Date.parse(properties.ExecMainExitTimestamp);if(!Number.isFinite(exit)||exit<Date.parse(records.plan.expiresAt))fail();return new Date(exit).toISOString();
}
