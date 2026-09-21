import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {openOwnedN8nInterruptedRecoveryContext,CLOUD_ROOT} from './owned-n8n-cloud-host.js';
import {INTERRUPTED_NAMES,INTERRUPTED_WORKFLOW,validateInterruptedOwnedN8nAttempt,validateInterruptedOwnedN8nAbandonment,abandonInterruptedOwnedN8nAttempt} from './owned-n8n-cloud-interrupted.js';
const files=createBuyerStoreProtectedFiles(),ROOT=CLOUD_ROOT+'-abandonment',PROXY='/etc/nginx/sites-available/jarvis-staging.conf',fail=()=>{throw Error('Interrupted native recovery refused');};
const run=(f,args)=>execFileSync(f,args,{encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}).trim();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const old=()=>Object.fromEntries(INTERRUPTED_NAMES.map(n=>{const p=CLOUD_ROOT+'/'+n+'.json';if(files.value(p+'.pending',true))fail();return[n,files.value(p,true)];}));
const read=n=>{const p=ROOT+'/'+n+'.json',a=files.value(p,true),b=files.value(p+'.pending',true);if(a&&b)fail();return a??b;};
export function observeInterruptedOwnedN8nLocal(){
 const s=fs.lstatSync(PROXY);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||s.nlink!==1||(s.mode&4095)!==0o644||s.size>65536||run('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--',PROXY])!=='')fail();
 try{fs.lstatSync(PROXY+'.zola-cloud-proof');fail();}catch(e){if(e.code!=='ENOENT')throw e;}
 if(run('/usr/bin/ss',['-H','-ltn','sport = :18947'])!=='')fail();return {proxy:fs.readFileSync(PROXY,'utf8'),listenerAbsent:true,temporaryAbsent:true};
}
export function readOwnedN8nInterruptedAttempt2({checkLocal=true}={}){
 const records=old();validateInterruptedOwnedN8nAttempt(records);const retained={observation:read('observation'),intent:read('intent'),result:read('result')};for(const n of ['observation','intent','result'])if(files.value(ROOT+'/'+n+'.json.pending',true))fail();
 const result=validateInterruptedOwnedN8nAbandonment(records,retained);if(checkLocal){const local=observeInterruptedOwnedN8nLocal();if(local.proxy!==records['proxy-bytes'].before)fail();}return {records,...retained,result};
}
export async function cleanupInterruptedOwnedN8nAttempt2(){
 const c=await openOwnedN8nInterruptedRecoveryContext();try{const records=old();validateInterruptedOwnedN8nAttempt(records);files.directory(ROOT,{create:true});
 const fence=async()=>{if(!same(old(),records))fail();await c.fence();if(!same(old(),records))fail();};
 const result=await abandonInterruptedOwnedN8nAttempt(records,{request:async(method,route)=>{if(!['GET','DELETE'].includes(method)||!['/api/v1/workflows/'+INTERRUPTED_WORKFLOW,'/api/v1/executions?workflowId='+INTERRUPTED_WORKFLOW+'&limit=100&includeData=false'].includes(route)||method==='DELETE'&&route.includes('executions'))fail();return c.request(method,route);},store:{value:read,record:(n,v)=>{if(!['observation','intent','result'].includes(n))fail();files.record(ROOT+'/'+n+'.json',v);}},fence,observeLocal:observeInterruptedOwnedN8nLocal});
 await fence();return {status:'INTERRUPTED_BEFORE_READY_ABANDONED',workflowDeleted:result.workflowDeleted,positiveProof:false,attempt:2};
 }finally{c.close();}
}
