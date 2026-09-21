// HELD startup is deliberately not OPEN readiness. Validate the exact expected
// negative admission checks without accepting unrelated unhealthy dependencies.
const reject=()=>{throw new Error('VPS HELD HTTP observation rejected');};
const generation=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
export async function requestVpsHeldJson(pathname,{fetchImpl=fetch}={}){
 if(!['/health','/ready'].includes(pathname))reject();
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2500);let reader;
 try{
  const response=await fetchImpl(`http://127.0.0.1:8789${pathname}`,{method:'GET',redirect:'error',signal:controller.signal,headers:{accept:'application/json'}});
  if(![200,503].includes(response.status)||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))reject();
  reader=response.body?.getReader();if(!reader)reject();let length=0;const chunks=[];
  for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>65536)reject();chunks.push(Buffer.from(value));}
  if(length===0)reject();return{status:response.status,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))};
 }finally{clearTimeout(timer);try{await reader?.cancel();}catch{}}
}
function worker(value,expected,generationId){
 if(value?.required!==true||value.ok!==expected||typeof value.activeTask!=='boolean'||typeof value.restartDetected!=='boolean')reject();
 if(expected){if(!['idle','working'].includes(value.state)||!Number.isFinite(value.heartbeatAgeMs)||value.heartbeatAgeMs<0||value.heartbeatAgeMs>30000
  ||value.generationId!==generationId)reject();}
 else if(!['missing','stopped','stale','draining'].includes(value.state)||value.activeTask!==false)reject();
}
export function validateVpsHeldHttp({health,ready},{releaseSha,workerExpected,workerGeneration,backendProfile,profileDigest}){
 if(typeof releaseSha!=='string'||!/^[a-f0-9]{40}$/.test(releaseSha)||typeof workerExpected!=='boolean'
  ||workerExpected&&!generation(workerGeneration)||!workerExpected&&workerGeneration!==undefined)reject();
 if(health?.status!==200||ready?.status!==503)reject();
 const owned=backendProfile==='owned-postgres-v1';
 if((backendProfile!==undefined&&!owned)||(owned?!/^[a-f0-9]{64}$/.test(profileDigest??''):profileDigest!==undefined))reject();
 const h=health.value,r=ready.value;
 for(const body of [h,r]){
  if(body?.service!=='blackspire-command-api'||body.lifecycle!=='ready'||body.deploymentIdentity?.state!=='VERIFIED'
   ||body.deploymentIdentity.build?.value!==releaseSha||body.deploymentIdentity.environment?.value!=='production'
   ||body.dependencies?.scheduler?.required!==false||body.dependencies.scheduler.ok!==true||body.dependencies.scheduler.state!=='disabled'
   ||body.dependencies?.buyerWriter?.enabled!==true||body.dependencies.buyerWriter.ok!==true)reject();
  worker(body.dependencies.worker,workerExpected,workerGeneration);
 }
 if(h.ok!==workerExpected||h.database!=='available'||h.emergencyStop!==false||r.ok!==false||r.database!=='compatible'||r.productionConfig?.ok!==true)reject();
 const expected=['releaseAdmission','lifecycle','database','productionConfig','worker','scheduler','deploymentIdentity','buyerWriter',...(owned?['buyerStore']:[])];
 if(!r.checks||Object.keys(r.checks).sort().join(',')!==expected.sort().join(',')||r.checks.releaseAdmission!==false
  ||r.checks.worker!==workerExpected||typeof r.checks.buyerWriter!=='boolean')reject();
 for(const key of ['lifecycle','database','productionConfig','scheduler','deploymentIdentity'])if(r.checks[key]!==true)reject();
 if(owned&&r.checks.buyerStore!==workerExpected)reject();
 // Writer operation availability can remain false while HELD; its health must
 // still be true above. Admission and generation-bound acceptance authorize use.
 return true;
}
export async function observeVpsHeldHttp(binding,{request=requestVpsHeldJson}={}){
 const health=await request('/health'),ready=await request('/ready');
 return validateVpsHeldHttp({health,ready},binding);
}
