import {recoveryDigest as hash} from './admitted-read-recovery.js';
export const MIXED_READ_FAILURE=Object.freeze({
 sourceSha:'4ac36431870cc062a321d895acbddd14b88fdbff',
 releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',
 operationId:'c8b00904-7017-434a-918e-8aaadbae82fd',
 attemptId:'e0a5951a-287f-4f84-9ec8-5b44c926153b',
 runId:'2984e391-ab5c-4a8b-88bd-f85e6743ac6a',
 planDigest:'3775ac8968ffddc5c7680a56dcc9f602452ec1c023b646946431bb53c813b6d9',
 transitionDigest:'840264d6e46408c0fbb2a2a247bae8c9ea68d4df561dad9517c6b126b1ede7d9',
 acceptanceDigest:'e992c0aa653036919f112b00017d8e78de42558d04f778a2a02f5bbf9175a09a',
 collectorDigest:'aadb5c459b6c4230552b7f5018a7c3a6897d312cf8d3ae3a82fbd70dba8a7dcd',
 releaseDigest:'7e958a8c22de9cf720f0a3191ba49227a08f7d8d6d91d5d009c1f1b462c4f206',
 configDigest:'3ecba306e59ac13883d4fa7e191356a5e3a7bb2fa6f753cff21a75b98ad49273',
 claimsDigest:'0b61f4faddffd9c51eb566dabdb2b8feaae2277ac97e1c6519ba1d1d325a9f6e',
 origin:'https://frontend-dtm0w29el-houseomegakennels-4825s-projects.vercel.app',
 deploymentId:'dpl_B1V6U9z5VQEowwBZ2LYxoCKFggh1'
});
export const MIXED_READ_ROWS=Object.freeze([
 Object.freeze({index:0,id:'task_218dbf70abb2d715',status:'completed',capability:'seller.opportunities.search',
 taskDigest:'1404ff6ae7443c3b0fce52e61305aa8b4c94ceed816b0913b3e74aa1fa8f12d5',
 attemptId:'cap_dispatch_task_218dbf70abb2d715_seller_opportunities_search',
 attemptDigest:'9d89760d98ccbc1ef079bb1288fd3081c825df4e4d8c47d55fd3dbaff8375373',
 inputDigest:'a3c4d5bc60e3c77c1ed3d385cbddd862d1500f0e5cf8be715f650b67501b8ca3'}),
 Object.freeze({index:1,id:'task_b0331114f772152e',status:'outcome_unknown',capability:'buyer.profiles.search',
 taskDigest:'16e8e92a7d7f5245b5498a8d1f39c253de6eafd4378e3aa3902be1fd93d39226',
 attemptId:'cap_dispatch_task_b0331114f772152e_buyer_profiles_search',
 attemptDigest:'f06f2d40e76f11ac410ea53653891dedace92cd1b7a5ad4b9f32a40f594fbec9',
 inputDigest:'e407e46f8774a613670b4726078530b343254d2c501e0e6d4a1f01c92184a5f0'})
]);
export function classifyMixedReadFailure(s){
 if(!s||Object.entries(MIXED_READ_FAILURE).some(([k,v])=>s[k]!==v)
  ||s.held!==true||s.priorLineageVerified!==true||s.transitionComplete!==true
  ||s.permitRetired!==true||s.permitExpired!==true||s.activePermit!==false||s.collectorRunning!==false
  ||s.outcome!=='UNKNOWN'||s.rowsUnchanged!==true||s.archivesUnchanged!==true
  ||s.otherReadTasks!==0||s.otherReadInputs!==0||s.collected!==1||s.admitted!==2
  ||s.serviceCount!==4||s.lifecycleBound!==true||s.writerBound!==true||s.deploymentVerified!==true
  ||s.stage!=='six_reads'||s.ordinal!==13||s.pendingAttemptId!==MIXED_READ_FAILURE.attemptId)
  throw Error('MIXED_READ_FAILURE_REFUSED');
 return Object.freeze({version:1,status:'MIXED_READ_FAILURE_RECONCILED',releaseSha:s.releaseSha,runId:s.runId,
  operationId:s.operationId,stageAttemptId:s.pendingAttemptId,
  completedReads:1,unknownReads:1,outcome:'UNKNOWN',
  retainedEvidenceDigest:hash({pins:MIXED_READ_FAILURE,rows:MIXED_READ_ROWS}),
  automaticReplayAllowed:false,acceptancePassed:false,productionOpen:false,
  requiredTransition:'SEALED_SUCCESSOR_WITH_RETAINED_HISTORY'});
}
