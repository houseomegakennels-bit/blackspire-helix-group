import {commitBuyerWriterBinding} from './commit-file.js';
import {publishBuyerWriterBinding} from './activation-file.js';
import {inspectBuyerWriterArtifact} from './artifact-inspection.js';
import {captureBuyerWriterServiceProcesses} from './process-collector.js';
import {createBuyerWriterRuntimeInspector,readBuyerWriterProcess} from './runtime-inspection.js';
import {createBuyerWriterBindingObserver} from './binding.js';
import {checkBuyerWriterActivationReadiness} from './activation-readiness.js';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Root-only composition; context comes from the operator's validated protected
// configuration. The CLI must expose no dependency overrides or approval input.
// Its outer cgroup contains the artifact verifier and supplies the overall
// resource deadline. Rehearsal pre-start isolation remains a launcher boundary.
export async function publishVerifiedBuyerWriterActivation({context,uid=process.getuid(),
  inspectRuntime,collectProcesses=captureBuyerWriterServiceProcesses,inspectArtifact=inspectBuyerWriterArtifact,
  readProcess=readBuyerWriterProcess,createBinding=createBuyerWriterBindingObserver,checkReadiness=checkBuyerWriterActivationReadiness,publish=publishBuyerWriterBinding,commit=commitBuyerWriterBinding}){
  let committed=false;
  try{
    const keys=['filename','credentialGroupId','workspace','releaseSha','apiGeneration','apiUid','apiPid','workerUid','apiUnit','workerUnit','artifactRoot','environment','host','port'];
    if(uid!==0||!context||Object.keys(context).length!==keys.length||keys.some(key=>!Object.hasOwn(context,key))
      ||[collectProcesses,inspectArtifact,readProcess,createBinding,checkReadiness,publish,commit].some(value=>typeof value!=='function'))throw new Error();
    context=Object.freeze({...context});
    inspectRuntime??=createBuyerWriterRuntimeInspector(context);
    if(typeof inspectRuntime!=='function')throw new Error();
    const capture=async()=>{
      const [artifact,processes]=await Promise.all([
        inspectArtifact(context),
        (async()=>{
          const runtime=await inspectRuntime();
          const api=collectProcesses({mainPid:runtime.api.supervisor.pid,role:'api',artifactRoot:context.artifactRoot,controlGroup:runtime.api.controlGroup});
          const worker=collectProcesses({mainPid:runtime.worker.pid,role:'worker',artifactRoot:context.artifactRoot,controlGroup:runtime.worker.controlGroup});
          if(api.child.pid!==context.apiPid||runtime.api.invocationId!==context.apiGeneration
            ||Object.keys(api.child).some(key=>api.child[key]!==runtime.api[key]&&!equal(api.child[key],runtime.api[key]))
            ||!equal(api.supervisor,runtime.api.supervisor)||worker.supervisor.pid!==runtime.worker.pid)throw new Error();
          return{runtime,api,worker};
        })(),
      ]);
      if(artifact.releaseSha!==context.releaseSha||artifact.environment!==context.environment||!/^[a-f0-9]{64}$/.test(artifact.artifactDigest??''))throw new Error();
      return{artifact,...processes};
    };
    const initial=await capture(),fingerprint=JSON.stringify(initial);
    const value={version:1,workspace:context.workspace,releaseSha:context.releaseSha,apiGeneration:context.apiGeneration,
      workerGeneration:initial.runtime.worker.invocationId,createdAt:new Date().toISOString(),
      workerAttestation:{...initial.runtime.worker,...initial.worker.supervisor,child:initial.worker.child}};
    const verify=async filename=>{
      if(JSON.stringify(await capture())!==fingerprint)throw new Error();
      // Both observations are read-only and independent. Running them together
      // reserves time for the final identity and protected configuration checks.
      const [proof,ready]=await Promise.all([
        createBinding({...context,filename,inspectRuntime,requireCommit:false})(),
        checkReadiness({...context,workerGeneration:value.workerGeneration,requireWriterReady:false,requirePreparation:filename===context.filename}),
      ]);
      if(!proof||proof.approved!==true||proof.credentialsSeparated!==true||proof.workerGeneration!==value.workerGeneration)throw new Error();
      if(ready?.verified!==true||ready.workerGeneration!==value.workerGeneration)throw new Error();
      // No early observation becomes authoritative merely because the HTTP or
      // artifact check took time. Fence all four kernel identities and both
      // systemd invocations again at the end of each publication phase.
      for(const process of [initial.api.supervisor,initial.api.child,initial.worker.supervisor,initial.worker.child]){
        if(!equal({...readProcess(process.pid),pid:process.pid},process))throw new Error();
      }
      if(!equal(await inspectRuntime(),initial.runtime))throw new Error();
      return proof;
    };
    const prepared=await publish({filename:context.filename,credentialGroupId:context.credentialGroupId,value,verify});
    const receipt=await commit({filename:context.filename,credentialGroupId:context.credentialGroupId,expectedBinding:prepared});
    committed=true;
    const ready=await checkReadiness({...context,workerGeneration:value.workerGeneration,requireWriterReady:true,requirePreparation:false});
    if(ready?.verified!==true||ready.workerGeneration!==value.workerGeneration)throw new Error();
    return Object.freeze({state:'COMMITTED',bindingPath:prepared.path,bindingSha256:prepared.sha256,commitPath:receipt.path,commitSha256:receipt.sha256,
      releaseSha:context.releaseSha,apiGeneration:context.apiGeneration,workerGeneration:value.workerGeneration});
  }catch(error){
    if(committed||error?.message==='Buyer writer activation outcome unknown')throw new Error('Buyer writer activation outcome unknown');
    if(error?.message==='Buyer writer commit cleanup incomplete')throw new Error('Buyer writer activation cleanup incomplete');
    throw new Error(error?.message==='Buyer writer binding publication cleanup incomplete'?'Buyer writer activation cleanup incomplete':'Buyer writer activation rejected');
  }
}
