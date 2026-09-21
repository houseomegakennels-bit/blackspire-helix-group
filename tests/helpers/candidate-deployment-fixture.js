import {hash} from '../../packages/zola-release/commander-journal.js';
export function candidateHistory({operationId='22222222-2222-4222-8222-222222222222',releaseSha='e'.repeat(40),recoverySha='a'.repeat(40),artifactDigest='1'.repeat(64),recoveryArtifactDigest='f'.repeat(64)}={}){
 const plan={operationId,releaseSha,recoverySha,runId:'55555555-5555-4555-8555-555555555555',artifactDigest,recoveryArtifactDigest,previousSha:'9'.repeat(40),previousArtifactDigest:'2'.repeat(64),stateDigest:'3'.repeat(64),receiverOrigin:{schema:1,mode:'preview',releaseSha,origin:'https://fixture.vercel.app',deploymentId:'dpl_fixture',previousOrigin:null,previousDropin:false}};
 const row=type=>({schema:1,type,...plan}),events=[row('candidate_deployment_intent')];
 for(const step of ['pointer','runtime','receivers','reload'])events.push({...row('candidate_deployment_step_intent'),step},{...row('candidate_deployment_step_result'),step});
 events.push(row('candidate_deployment_result'));return{plan,events,digest:hash(plan)};
}
