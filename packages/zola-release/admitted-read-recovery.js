import {createHash} from 'node:crypto';
const fail=()=>{throw new Error('ADMITTED_READ_RECOVERY_REFUSED');};
export const recoveryDigest=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
export const ADMITTED_READ_RECOVERY=Object.freeze({
 releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',operationId:'c8b00904-7017-434a-918e-8aaadbae82fd',
 runId:'2cc33dc9-486b-4f59-ab79-386f81c6b2f5',attemptId:'e0a5951a-287f-4f84-9ec8-5b44c926153b',
 configDigest:'d249c5d60d366ebf4768aa3ade9f2eac7e9b52019a1b588b1d94b205b6e14ae1',
 releaseDigest:'cd36d04dde54bda546ea7da51b19bd3c5ea314ecc181922f791e62cf38a5a426',
 collectorDigest:'009ee43f3d9ed7f68274653db2177faea754ca08415089ec0706205b09df3994',
 taskId:'task_c5c8d9bca504952a',taskDigest:'7ff28e8213bb2edf9a6da656ab1032a402868655eba54c00aca2a28b48cb49d0',
 providerAttemptId:'cap_dispatch_task_c5c8d9bca504952a_seller_opportunities_search',
 providerAttemptDigest:'e543cd23198ac79d784fc7ea6371b662618d9550e5567191617d2211fea8ccb0',
 inputDigest:'3dfe1f52e6a428e60d6532a304e5b2f6ce178afd1854489187e623122d6e0804',
 oldDeploymentId:'dpl_EfJVukRyw39vR6P7koqm99TiaNCw',
 newDeploymentId:'dpl_B1V6U9z5VQEowwBZ2LYxoCKFggh1',
 oldOrigin:'https://frontend-hjgsm49to-houseomegakennels-4825s-projects.vercel.app',
 newOrigin:'https://frontend-dtm0w29el-houseomegakennels-4825s-projects.vercel.app'
});
export function readRecoveryJournal(bytes,expectedDigest){
 if(!Buffer.isBuffer(bytes)||recoveryDigest(bytes)!==expectedDigest||bytes.at(-1)!==10)fail();
 let previous='0'.repeat(64);
 return bytes.toString('utf8').trimEnd().split('\n').map((line,sequence)=>{
  const r=JSON.parse(line);
  if(Object.keys(r).sort().join(',')!=='digest,event,previous,sequence'||r.sequence!==sequence||r.previous!==previous||r.digest!==recoveryDigest({sequence,previous,event:r.event}))fail();
  previous=r.digest;return r.event;
 });
}
// Reconciliation of retained evidence does not turn an unknown provider result
// into success or permit redispatch. A later lifecycle transition must establish
// a new held epoch, new runtime generations and its own complete acceptance.
export function classifyAdmittedReadRecovery(s,p=ADMITTED_READ_RECOVERY){
 if(!s||s.releaseDigest!==p.releaseDigest||s.collectorDigest!==p.collectorDigest||s.configDigest!==p.configDigest
 ||s.taskDigest!==p.taskDigest||s.providerAttemptDigest!==p.providerAttemptDigest||s.inputDigest!==p.inputDigest
 ||s.runId!==p.runId||s.operationId!==p.operationId||s.releaseSha!==p.releaseSha||s.stageAttemptId!==p.attemptId
 ||s.stage!=='six_reads'||s.ordinal!==13||s.admissionMode!=='held'||s.activePermit!==false||s.collectorRunning!==false
 ||s.permitExpired!==true||s.taskId!==p.taskId||s.providerAttemptId!==p.providerAttemptId
 ||s.taskStatus!=='outcome_unknown'||s.providerAttemptStatus!=='outcome_unknown'||s.executionIntent!=='read_only'
 ||s.capability!=='seller.opportunities.search'||s.provider!=='blackspire-capability'
 ||s.taskCount!==1||s.attemptCount!==1||s.otherReadTasks!==0||s.otherReadInputs!==0
 ||s.collectedCount!==0||s.admittedCount!==1||s.baselineComplete!==true||s.denialConfirmed!==true
 ||s.oldOrigin!==p.oldOrigin||s.newOrigin!==p.newOrigin||s.newDeploymentId!==p.newDeploymentId
 ||s.newDeploymentVerified!==true||s.retainedOldArchiveVerified!==true)fail();
 return Object.freeze({version:1,status:'ADMITTED_READ_RECONCILED_UNKNOWN',releaseSha:p.releaseSha,operationId:p.operationId,
  runId:p.runId,stageAttemptId:p.attemptId,taskId:p.taskId,providerAttemptId:p.providerAttemptId,
  retainedEvidenceDigest:recoveryDigest({release:p.releaseDigest,collector:p.collectorDigest,task:p.taskDigest,attempt:p.providerAttemptDigest,input:p.inputDigest}),
  oldDeploymentId:p.oldDeploymentId,newDeploymentId:p.newDeploymentId,
  outcome:'UNKNOWN',automaticReplayAllowed:false,acceptancePassed:false,productionOpen:false,
  requiredTransition:'NEW_HELD_EPOCH_WITH_FRESH_ACCEPTANCE'});
}
