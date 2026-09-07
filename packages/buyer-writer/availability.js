// Base snapshots must exclude this writer's own availability verdict. These
// observations do not provide atomic fencing across systemd/SQLite/PostgreSQL.
export function createBuyerWriterAvailability({workspace,releaseSha,apiGeneration,environment,getHealth,getReadiness,observeBinding,now=()=>performance.now()}) {
  if(typeof workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(workspace)
    ||!/^[a-f0-9]{40}$/.test(releaseSha??'')||!/^[a-f0-9]{32}$/.test(apiGeneration??'')
    ||!['production','staging','disposable-staging'].includes(environment)
    ||[getHealth,getReadiness,observeBinding,now].some(value=>typeof value!=='function'))throw new Error('Buyer writer availability configuration rejected');
  const snapshot=()=>{
    const health=getHealth(),ready=getReadiness();
    if(health?.ok!==true||ready?.ok!==true||health.emergencyStop!==false||health.database!=='available')return null;
    for(const value of [health,ready]){
      if(value.service!=='blackspire-command-api'||value.lifecycle!=='ready'||value.deploymentIdentity?.state!=='VERIFIED'
        ||value.deploymentIdentity.build?.value!==releaseSha||value.deploymentIdentity.environment?.value!==environment)return null;
      const worker=value.dependencies?.worker;
      if(worker?.required!==true||worker.ok!==true||!['idle','working'].includes(worker.state)
        ||!Number.isFinite(worker.heartbeatAgeMs)||worker.heartbeatAgeMs<0||worker.heartbeatAgeMs>30000
        ||!/^[a-f0-9]{32}$/.test(worker.generationId??''))return null;
    }
    const generation=health.dependencies.worker.generationId;
    return generation===ready.dependencies.worker.generationId?generation:null;
  };
  return async()=>{
    let timer;
    try {
      const started=now(),before=snapshot();if(before===null)return false;
      const proof=await Promise.race([
        Promise.resolve().then(()=>observeBinding()),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2000);}),
      ]);
      const after=snapshot();
      return now()-started<=2000&&after!==null&&before===after&&proof?.approved===true&&proof.credentialsSeparated===true
        &&proof.apiGeneration===apiGeneration&&proof.workerGeneration===after&&proof.releaseSha===releaseSha&&proof.workspace===workspace;
    }catch{return false;}
    finally{clearTimeout(timer);}
  };
}
