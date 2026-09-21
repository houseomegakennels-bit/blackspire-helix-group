import {execFileSync} from 'node:child_process';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState,RELEASE_ADMISSION_ROOT} from '../shared/release-admission.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {fail} from './local-protocol.js';
function admissionGroup(){
 const fields=execFileSync('/usr/bin/getent',['group','blackspire'],{encoding:'utf8',timeout:1000,maxBuffer:4096}).trim().split(':');
 if(fields.length!==4||fields[0]!=='blackspire'||!/^\d+$/.test(fields[2])||Number(fields[2])===0||!process.getgroups().includes(Number(fields[2])))fail();
 return Number(fields[2]);
}
// The daemon owns this lease independently of the IPC socket/API lifetime.
// It closes only after handler transaction completion (including rollback and
// connection drain), so a disconnected caller cannot permit cutover mid-write.
export function createBuyerStoreAdmissionFence({attestation,groupId=admissionGroup(),acquire=acquireReleaseAdmissionLock,
 readState=()=>readRootOwnedJson(RELEASE_ADMISSION_ROOT+'/state.json',{groupId,maxBytes:2048})}={}){
 if(typeof attestation?.binding!=='function')fail();
 return Object.freeze({async run(lane,handler){
  const lease=acquire({groupId});try{
   const binding=attestation.binding();
   const verify=()=>{
    lease.assertIdentity();const state=validateReleaseAdmissionState(readState());
    if(lane==='user'&&state.mode!=='open')fail();
    if(!['user','profiles-read','ready'].includes(lane)||state.releaseSha!==binding.releaseSha||state.runId!==binding.runId)fail();
    if(state.mode==='held'){
     if(lane!=='profiles-read'||state.apiGeneration!==null||state.workerGeneration!==null)fail();
     // Installed manifest and actual systemd generations are verified by the
     // dispatcher. HELD state deliberately retains null generation fields.
    }else if(state.apiGeneration!==binding.apiGeneration||state.workerGeneration!==binding.workerGeneration)fail();
    const current=attestation.binding();
    if(JSON.stringify(current)!==JSON.stringify(binding))fail();
   };
   verify();const result=await handler();verify();return result;
  }finally{lease.close();}
 }});
}
