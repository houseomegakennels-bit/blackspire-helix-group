import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {MIXED_RETIREMENT as P} from './mixed-retirement-history.js';
import {hash,openReleaseJournal} from './commander-journal.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {inspectMixedReadHistory,mixedCollectorEvidence} from './mixed-fresh-acceptance.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {readOwnedConfigurationBytes,publishOwnedConfigurationBytes} from './owned-buyer-configuration-host.js';
import {validateCollectorConfig} from '../zola-six-reads/collector.js';
import {validateOwnedAcceptanceTargetDocument} from '../buyer-writer/owned-acceptance-target-preparation.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {verifyHeldCanonicalWriter} from './held-writer-binding.js';
import {observeReceiverDeployment} from './receiver-origin-transition.js';
const root='/var/lib/blackspire-operator/preparation/mixed-successor-acceptance-'+P.successorOperationId;
const live=root+'/live',fixed='/var/lib/blackspire-operator/preparation/six-read-live-config.json';
const fail=()=>{throw Error('MIXED_LIVE_PREPARATION_REFUSED');},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const records=createBuyerStoreProtectedFiles();

export function buildMixedLiveConfiguration({premerge,newMainSha,runId,lifecycle,target}){
 const old=validateCollectorConfig(premerge);
 if(old.version!==6||old.releaseSha!==P.successorReleaseSha||old.profileDigest!==P.profileDigest
  ||!/^[a-f0-9]{40}$/.test(newMainSha??'')||[P.releaseSha,P.successorReleaseSha].includes(newMainSha)
  ||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(runId??'')||[P.runId,old.runId].includes(runId)
  ||lifecycle?.releaseSha!==newMainSha||lifecycle.runId!==runId)fail();
 const accepted=validateOwnedAcceptanceTargetDocument(target,{releaseSha:newMainSha,profileDigest:P.profileDigest});
 if(accepted.workspace!==old.workspace)fail();
 return validateCollectorConfig({...old,version:7,releaseSha:newMainSha,runId,releaseRunId:runId,
  frontendOrigin:'https://blackspirehelix.com',apiPid:lifecycle.api.pid,workerPid:lifecycle.worker.pid,
  journalDirectory:live+'/collector',denialReceiptPath:live+'/denial-receipt.json',acceptanceSearchJobId:accepted.jobId});
}
export function verifyMixedPremergeCompletion(context,state){
 let log;try{
  log=openReleaseJournal({root:root+'/acceptance'});const h=inspectMixedReadHistory(log.stream('release').events());
  if(!h.result||!h.retired||h.intent.claims.epochRunId!==state.outputs.admission_lease?.epochRunId)fail();
  const proof=mixedCollectorEvidence(records.value(root+'/collector-report.json'),h.intent.claims);
  if(!same(proof,h.result.evidence)||state.outputs.six_reads?.collectorDigest!==proof.collectorDigest)fail();
  return proof;
 }finally{log?.close();}
}
async function binding(context,call){
 if(hash(context.release)!==P.successorInputDigest||!same(call.input,context.input))fail();
 const state=inspectReleaseSequenceHistory(context.journal.stream('release').events());
 if(state.context.operationId!==P.successorOperationId||state.context.releaseSha!==P.successorReleaseSha
  ||state.nextOrdinal!==23||state.pending&&state.pending.stage!=='mint_acceptance_permit')fail();
 const premergeProof=verifyMixedPremergeCompletion(context,state),out=state.outputs;
 const newMainSha=out.capture_new_main_sha?.newMainSha,held=out.post_merge_held_epoch;
 if(!held||held.newMainSha!==newMainSha||held.held!==true||held.intakeOpen!==false
  ||out.verify_vercel_production_sha?.newMainSha!==newMainSha||out.verify_vercel_production_sha.vercelProductionExact!==true
  ||out.journaled_vps_cutover?.newMainSha!==newMainSha||out.journaled_vps_cutover.vpsCutover!==true)fail();
 const lifecycle=await observeHeldLifecycle({releaseSha:newMainSha,runId:held.epochRunId});
 const writer=await verifyHeldCanonicalWriter({releaseSha:newMainSha,journal:context.journal});
 if(writer.runId!==held.epochRunId||writer.bindingDigest!==held.writerBindingDigest||writer.commitDigest!==held.writerCommitDigest)fail();
 await observeReceiverDeployment({releaseSha:newMainSha,mode:'production',origin:'https://blackspirehelix.com',
  deploymentId:out.verify_vercel_production_sha.deploymentId});
 for(const n of ['premerge-reads-active.json','acceptance-active.json'])
  if(fs.existsSync('/etc/blackspire/release-admission/'+n))fail();
 const file='/var/lib/blackspire-operator/owned-writer-acceptance.json',st=fs.lstatSync(file);
 const target=JSON.parse(readOwnedConfigurationBytes(file,{gid:st.gid,mode:0o640}));
 const config=buildMixedLiveConfiguration({premerge:records.value(root+'/collector-config.json'),
  newMainSha,runId:held.epochRunId,lifecycle,target});
 return {config,proof:{version:1,operationId:P.successorOperationId,newMainSha,runId:held.epochRunId,
  lifecycleDigest:hash(lifecycle),writerDigest:hash(writer),premergeDigest:hash(premergeProof),targetDigest:hash(target),configDigest:hash(config)}};
}
export async function prepareMixedLiveCollector(context,call){
 const before=await binding(context,call);
 records.directory(live,{create:true});records.directory(live+'/collector',{create:true});
 const get=n=>records.value(live+'/'+n+'.json',true),put=(n,v)=>records.record(live+'/'+n+'.json',v);
 put('authority',before.proof);put('collector-config',before.config);
 const input={deniedPrincipal:before.config.deniedPrincipal,outputPath:before.config.denialReceiptPath,
  releaseSha:before.config.releaseSha,runId:before.config.runId,workspace:before.config.workspace};
 put('denial-input',input);
 const fence=async()=>{if(!same(await binding(context,call),before))fail();};
 await fence();
 const intent={version:1,authorityDigest:hash(before.proof),inputDigest:hash(input)},old=get('denial-intent');
 if(old&&!same(old,intent))fail();
 let result=get('denial-result');
 if(result&&!old)fail();
 if(!old){
  put('denial-intent',intent);
  const artifact='/opt/blackspire-command/releases/'+before.config.releaseSha;
  const out=JSON.parse(execFileSync('/opt/nodejs/node-v22.23.1-linux-x64/bin/node',
   [artifact+'/scripts/zola-denial-session.js','--issue',live+'/denial-input.json'],
   {cwd:artifact,encoding:'utf8',timeout:30000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}));
  if(out.status!=='DELEGATED_DENIAL_ISSUED')fail();
  result={version:1,authorityDigest:hash(before.proof),receiptDigest:hash(readOwnedConfigurationBytes(before.config.denialReceiptPath))};
  put('denial-result',result);
 }
 // A retained intent without result is UNKNOWN and is never reissued.
 if(!result||!same(result,{version:1,authorityDigest:hash(before.proof),receiptDigest:hash(readOwnedConfigurationBytes(before.config.denialReceiptPath))}))fail();
 await fence();
 publishOwnedConfigurationBytes(fixed,null,JSON.stringify(before.config)+'\n');
 if(hash(JSON.parse(readOwnedConfigurationBytes(fixed)))!==hash(before.config))fail();
 await fence();
 const proof={status:'MIXED_LIVE_COLLECTOR_PREPARED',configDigest:hash(before.config),authorityDigest:hash(before.proof)};
 put('result',proof);return proof;
}
export function wrapMixedLivePreparation(context,operations){
 return {...operations,mint_acceptance_permit:{...operations.mint_acceptance_permit,
  async check(call){await prepareMixedLiveCollector(context,call);return operations.mint_acceptance_permit.check(call);}
 }};
}
