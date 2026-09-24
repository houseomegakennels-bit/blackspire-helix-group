import {createHash} from 'node:crypto';
const fail=()=>{throw new Error('ADMITTED_READ_RECOVERY_REFUSED');};
export const recoveryDigest=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
export const ADMITTED_READ_RECOVERY=Object.freeze({
 releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',operationId:'c8b00904-7017-434a-918e-8aaadbae82fd',
 runId:'c2681636-b47f-4c66-8569-be0744c60f16',attemptId:'e0a5951a-287f-4f84-9ec8-5b44c926153b',
 configDigest:'bc04dc2c98d5d4ee167e2ace3e0dde0b40ff7256ab7de90b0b87500e29b21148',
 releaseDigest:'e777a95f4e447d59a67c82f52447fcafd700a295a504cde7eb2ce72612381a5b',
 collectorDigest:'341e067dbc2a7b9c9dde2c62b351029ffb699d6e8bfebbfb8c1f6eeffd77d6a7',
 taskId:'task_6d87d5be99669436',taskDigest:'d074da8ff385cbd38bd86cda1fcb37bbabaf677c47bc59127fd4ac21c8bdd936',
 providerAttemptId:'cap_dispatch_task_6d87d5be99669436_seller_opportunities_search',
 providerAttemptDigest:'91ab456bc3ca283e6f07a95a4e1bab6381d319978a328838b5597d9f248bd1e8',
 inputDigest:'110011d5c250894aa7ab309649e088b75476398c602e32f608c8ab04c4838e95',
 oldDeploymentId:'dpl_88HwD1heHyhM3gAJ5NxYzUzjVmbc',
 newDeploymentId:'dpl_EfJVukRyw39vR6P7koqm99TiaNCw',
 oldOrigin:'https://frontend-3qnw8695h-houseomegakennels-4825s-projects.vercel.app',
 newOrigin:'https://frontend-hjgsm49to-houseomegakennels-4825s-projects.vercel.app'
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
