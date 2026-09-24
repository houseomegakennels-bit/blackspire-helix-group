import {heldWriterPreparationContext} from '../shared/release-admission.js';
// Base snapshots must exclude this writer's own availability verdict. These
// observations do not provide atomic fencing across systemd/SQLite/PostgreSQL.
export function createBuyerWriterAvailability({workspace,releaseSha,apiGeneration,environment,getHealth,getReadiness,observeBinding,now=()=>performance.now()}) {
  if(typeof workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(workspace)
    ||!/^[a-f0-9]{40}$/.test(releaseSha??'')||!/^[a-f0-9]{32}$/.test(apiGeneration??'')
    ||!['production','staging','disposable-staging'].includes(environment)
    ||[getHealth,getReadiness,observeBinding,now].some(value=>typeof value!=='function'))throw new Error('Buyer writer availability configuration rejected');
  const snapshot=async()=>{
    const ready=await getReadiness(),health=await getHealth();
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
    let timer,expired=false;
    try {
      const started=now();
      return await Promise.race([
        (async()=>{const before=await snapshot();if(before===null||expired||now()-started>2000)return false;
          const proof=await observeBinding();if(expired||now()-started>2000)return false;const after=await snapshot();
          return now()-started<=2000&&after!==null&&before===after&&proof?.approved===true&&proof.credentialsSeparated===true
            &&proof.apiGeneration===apiGeneration&&proof.workerGeneration===after&&proof.releaseSha===releaseSha&&proof.workspace===workspace;
        })(),
        new Promise(resolve=>{timer=setTimeout(()=>{expired=true;resolve(false);},2000);}),
      ]);
    }catch{return false;}
    finally{clearTimeout(timer);}
  };
}

// A HELD preparation proof may omit only OPEN admission and committed writer
// activation. Missing/false unrelated readiness checks remain hard failures.
export function createBuyerWriterPreparation(options){
  const owned=options.backendProfile==='owned-postgres-v1';
  if((options.backendProfile!==undefined&&!owned)||(owned?!/^[a-f0-9]{64}$/.test(options.profileDigest??''):options.profileDigest!==undefined))throw new Error('Buyer writer preparation configuration rejected');
  if(options.environment!=='production')return createBuyerWriterAvailability(options);
  const bound=()=>{
    const scope=heldWriterPreparationContext();
    if(!scope||scope.role!=='api'||scope.releaseSha!==options.releaseSha
      ||scope.apiGeneration!==options.apiGeneration)throw new Error('Buyer writer preparation unavailable');
    return scope;
  };
  return createBuyerWriterAvailability({...options,
    getHealth:async()=>{
      const scope=bound(),health=await options.getHealth();
      if(health?.dependencies?.scheduler?.ok!==true
        ||health.dependencies?.worker?.restartDetected!==false
        ||health.dependencies.worker.generationId!==scope.workerGeneration)throw new Error('Buyer writer preparation unavailable');
      return health;
    },
    getReadiness:async()=>{
      const scope=bound(),ready=await options.getReadiness();
      const keys=['releaseAdmission','lifecycle','database','productionConfig','worker','scheduler','deploymentIdentity',...(owned?['buyerStore']:[])];
      if(ready?.ok!==false||!ready.checks||Array.isArray(ready.checks)
        ||Object.keys(ready.checks).length!==keys.length
        ||keys.some(k=>!Object.hasOwn(ready.checks,k)||ready.checks[k]!== (k!=='releaseAdmission'))
        ||ready.database!=='compatible'||ready.productionConfig?.ok!==true
        ||ready.dependencies?.scheduler?.ok!==true
        ||ready.dependencies?.worker?.restartDetected!==false
        ||ready.dependencies.worker.generationId!==scope.workerGeneration)throw new Error('Buyer writer preparation unavailable');
      return {...ready,ok:true};
    },
  });
}
