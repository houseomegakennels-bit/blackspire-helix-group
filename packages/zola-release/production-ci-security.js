import {verifyReleaseCi} from './commander-host.js';

const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const reject=()=>{throw new Error('Fixed production CI/security observation rejected');};

function binding(context,args){
 const {input,state}=args??{};
 if(JSON.stringify(input)!==JSON.stringify(context.input)||input?.releaseSha!==context.release?.releaseSha
  ||!sha(input.releaseSha)||!uuid(state?.context?.operationId)||state.context.releaseSha!==input.releaseSha
  ||state.context.previousMainSha!==input.previousMainSha||state.context.workspace!==input.workspace
  ||state.context.principal!==input.principal||!Number.isSafeInteger(args.ordinal)||args.ordinal<0)reject();
 return{releaseSha:input.releaseSha,operationId:state.context.operationId,workspace:input.workspace,principal:input.principal};
}

export function createCiSecurityProductionOperation(context,{verify=verifyReleaseCi}={}){
 if(typeof verify!=='function')reject();
 const observe=args=>{
  const bound=binding(context,args);let proof;
  try{proof=verify(bound.releaseSha);}catch{return Object.freeze({status:'BLOCKED_EXTERNAL'});}
  if(proof?.status!=='success'||proof.releaseSha!==bound.releaseSha||proof.mainSha!==context.input.previousMainSha
   ||![proof.ciMergeSha,proof.ciTreeSha].every(sha)||!digest(proof.ciArtifactDigest)
   ||!Number.isSafeInteger(proof.runId)||proof.runId<1||!Number.isSafeInteger(proof.runAttempt)||proof.runAttempt<1)reject();
  return Object.freeze({status:'PASS',evidence:Object.freeze({...bound,ciSecurity:true,runId:proof.runId,
   runAttempt:proof.runAttempt,mainSha:proof.mainSha,ciMergeSha:proof.ciMergeSha,ciTreeSha:proof.ciTreeSha,
   ciArtifactDigest:proof.ciArtifactDigest})});
 };
 return Object.freeze({check:observe,observe});
}
