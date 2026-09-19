import {readRootOwnedJsonSnapshot} from './protected-json.js';
import {matchesBuyerWriterCommitRecord} from './commit-record.js';
const id=value=>Number.isInteger(value)&&value>0&&value<=4294967294;
const generation=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);

// Binding lifetime is the approved release and service invocations, with no
// periodic renewal. Removing/replacing the protected binding invalidates an
// observation. Live API/systemd observations are combined with root-attested
// worker restrictions; API ProtectProc intentionally hides the worker process.
export function createBuyerWriterBindingObserver({filename,credentialGroupId,workspace,releaseSha,apiGeneration,apiUid,apiPid=process.pid,workerUid,
  apiUnit='blackspire-command.service',workerUnit='blackspire-command-worker.service',requireCommit=true,readSnapshot=readRootOwnedJsonSnapshot,inspectRuntime}) {
  if(typeof filename!=='string'||!id(credentialGroupId)||!id(apiUid)||!id(workerUid)||apiUid===workerUid||!id(apiPid)
    ||typeof workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(workspace)||!/^[a-f0-9]{40}$/.test(releaseSha??'')||!generation(apiGeneration)
    ||[apiUnit,workerUnit].some(value=>typeof value!=='string'||!/^[A-Za-z0-9_.@:-]{1,128}\.service$/.test(value))||apiUnit===workerUnit
    ||typeof requireCommit!=='boolean'||typeof readSnapshot!=='function'||typeof inspectRuntime!=='function')throw new Error('Buyer writer binding configuration rejected');
  const read=()=>{
    const snapshot=readSnapshot(filename,{groupId:credentialGroupId,maxBytes:4096}),value=snapshot?.value;
    const keys=['version','workspace','releaseSha','apiGeneration','workerGeneration','createdAt','workerAttestation'];
    if(!value||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key))
      ||value.version!==1||value.workspace!==workspace||value.releaseSha!==releaseSha||value.apiGeneration!==apiGeneration||!generation(value.workerGeneration)
      ||typeof value.createdAt!=='string'||new Date(value.createdAt).toISOString()!==value.createdAt||Date.parse(value.createdAt)>Date.now()+5000
      ||!snapshot.identity||typeof snapshot.identity!=='object')throw new Error();
    let commit=null;
    if(requireCommit){
      commit=readSnapshot(`${filename}.commit.json`,{groupId:credentialGroupId,maxBytes:4096});
      if(!commit?.identity||!matchesBuyerWriterCommitRecord(commit.value,snapshot))throw new Error();
    }
    return {fingerprint:JSON.stringify({snapshot,commit}),workerGeneration:value.workerGeneration,workerAttestation:value.workerAttestation};
  };
  const validate=(runtime,attestation)=>{
    const serviceKeys=['unit','user','state','subState','pid','invocationId','type','notifyAccess','pidFile','controlGroup'];
    const processKeys=['uid','euid','suid','fsuid','gid','egid','sgid','fsgid','groups','capEffective','capPermitted','capAmbient','capInheritable','noNewPrivileges','startTime','parentPid'];
    const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
    if(!exact(attestation,[...serviceKeys,...processKeys,'child'])||!exact(attestation.child,[...processKeys,'pid','controlGroup'])
      ||!exact(runtime?.worker,serviceKeys)||serviceKeys.some(key=>runtime.worker[key]!==attestation[key]))throw new Error();
    runtime={...runtime,worker:attestation};
    const output={};
    for(const kind of ['api','worker']){
      const value=runtime?.[kind],uid=kind==='api'?apiUid:workerUid;
      if(!value||value.unit!==(kind==='api'?apiUnit:workerUnit)||value.user!==`blackspire-${kind}`||value.state!=='active'||value.subState!=='running'
        ||value.type!=='simple'||value.notifyAccess!=='none'||value.pidFile!==''||!generation(value.invocationId)
        ||value.controlGroup!==`/system.slice/${value.unit}`)throw new Error();
      const parent=kind==='api'?value.supervisor:value,child=kind==='api'?value:value.child;
      if(!parent||!child||child.parentPid!==parent.pid||child.pid===parent.pid)throw new Error();
      for(const identity of [parent,child]){
        if(!id(identity.pid)||!id(identity.parentPid)||identity.controlGroup!==value.controlGroup
          ||![identity.uid,identity.euid,identity.suid,identity.fsuid].every(item=>item===uid)
          ||!id(identity.gid)||![identity.egid,identity.sgid,identity.fsgid].every(item=>item===identity.gid)
          ||!Array.isArray(identity.groups)||identity.groups.length>64||identity.groups.some(item=>!id(item))
          ||![identity.capEffective,identity.capPermitted,identity.capAmbient,identity.capInheritable].every(item=>typeof item==='string'&&/^0{1,16}$/.test(item))
          ||identity.noNewPrivileges!==true||typeof identity.startTime!=='string'||!/^[1-9][0-9]{0,19}$/.test(identity.startTime))throw new Error();
        if((kind==='api')!==new Set([...identity.groups,identity.gid]).has(credentialGroupId))throw new Error();
      }
      if(kind==='api'&&(value.pid!==apiPid||value.invocationId!==apiGeneration))throw new Error();
      if(kind==='worker'&&[parent.pid,child.pid].includes(apiPid))throw new Error();
      output[kind]={unit:value.unit,pid:value.pid,invocationId:value.invocationId};
    }
    return output;
  };
  let pending;
  const inspect=()=>{
    if(!pending){
      pending=Promise.resolve().then(async()=>{
        const first=await inspectRuntime(),fingerprint=JSON.stringify(first);
        const last=await inspectRuntime();
        if(JSON.stringify(last)!==fingerprint)throw new Error();
        return last;
      }).then(value=>{pending=null;return value;},error=>{pending=null;throw error;});
    }
    return pending;
  };
  return async()=>{
    let timer;
    try {
      const before=read(),started=performance.now();
      const runtime=await Promise.race([inspect(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1900);})]);
      const after=read();
      if(!runtime||performance.now()-started>1900||before.fingerprint!==after.fingerprint)return null;
      const verified=validate(runtime,after.workerAttestation);
      if(verified.worker.invocationId!==after.workerGeneration)return null;
      return Object.freeze({approved:true,credentialsSeparated:true,workspace,releaseSha,apiGeneration,workerGeneration:after.workerGeneration});
    }catch{return null;}
    finally{clearTimeout(timer);}
  };
}
