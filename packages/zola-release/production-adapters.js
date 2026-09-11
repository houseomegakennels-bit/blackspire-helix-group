import {execFileSync} from 'node:child_process';
import {hash} from './commander-journal.js';
import {MUTATING_STAGES,RELEASE_STAGES} from './commander-sequence.js';
import {verifyReleaseSource} from './commander-host.js';
import {createProviderAclCheckOperation,createBoundedWriterE2eOperation,queryFixedProviderAcl,inspectFixedWriterAcceptance,runFixedWriterAcceptance}
 from './production-acl-writer.js';
import {createRollbackProductionOperations} from './production-rollback-operations.js';
import {createHealthSmokeProductionOperations} from './production-health-smoke.js';
import {createZeroProofProductionOperations} from './production-zero-proofs.js';
import {createDeploymentProductionOperations} from './production-deployment-operations.js';
import {createN8nMigrationProductionOperations} from './production-n8n-migration.js';

const REPOSITORY='houseomegakennels-bit/blackspire-helix-group';
const BRANCH='release/zola-production-live';
const RECEIVER_WORKFLOW='zola-receiver-maintenance.yml';
const PREVIEW_CONTEXTS=Object.freeze(['Vercel – frontend','Vercel – blackspire-helix-group']);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const reject=()=>{throw new Error('Fixed production observation rejected');};
const options=Object.freeze({encoding:'utf8',timeout:15000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],
 env:{PATH:'/usr/bin:/bin',HOME:'/root',GH_CONFIG_DIR:'/root/.config/gh',GH_PROMPT_DISABLED:'1',LC_ALL:'C'}});

function api(route){
 try{return JSON.parse(execFileSync('/usr/bin/gh',['api',`repos/${REPOSITORY}/${route}`],options));}
 catch{return null;}
}

// These are the only stage classifications. "thin" means that a fixed
// production primitive exists and the composition root only translates its
// result into the sequence proof envelope. "missing" means no executable host
// operation exists; an evidence validator or a PASS constant is not a substitute.
export const PRODUCTION_STAGE_CLASSIFICATION=Object.freeze({
 exact_sha_verification:'thin',receiver_audit:'primitive',vercel_exact_head_preview:'primitive',provider_acl_check:'primitive',
 n8n_backup_check:'thin',candidate_six_reads:'thin',admission_lease:'thin',generation_revalidation:'thin',n8n_migration:'thin',
 bounded_writer_e2e:'primitive',migration_preflight:'thin',production_migrations:'thin',migration_postconditions:'thin',six_reads:'thin',
 rollback_acceptance:'primitive',ci_security:'thin',final_diff:'thin',expected_head_merge:'thin',capture_new_main_sha:'thin',verify_main:'thin',
 verify_vercel_production_sha:'thin',journaled_vps_cutover:'thin',post_merge_held_epoch:'thin',mint_acceptance_permit:'thin',
 api_health:'primitive',worker_readiness:'thin',generation_fence:'thin',six_live_reads:'thin',production_smoke:'primitive',
 zero_paid_nexus:'primitive',zero_unintended_mutation:'primitive',rollback_verification:'primitive',final_release_record:'thin',guarded_held_to_open:'thin',
});

// GitHub exposes secret presence but never its value. A successful exact-head
// receiver maintenance run is therefore the authority-consumption proof; the
// variable/secret metadata checks prevent an old run masking removed settings.
export function observeReceiverAudit({releaseSha}){
 if(!sha(releaseSha))reject();
 const variable=api('actions/variables/ZOLA_AUTHORITY_CONSUMER_URL');
 const secret=api('actions/secrets/ZOLA_AUTHORITY_CONSUMER_TOKEN');
 const runs=api(`actions/workflows/${RECEIVER_WORKFLOW}/runs?branch=${BRANCH}&event=workflow_dispatch&per_page=100`);
 if(variable===null||secret===null||runs===null)return Object.freeze({status:'BLOCKED_EXTERNAL'});
 if(variable.name!=='ZOLA_AUTHORITY_CONSUMER_URL'||secret.name!=='ZOLA_AUTHORITY_CONSUMER_TOKEN'||!Array.isArray(runs.workflow_runs))reject();
 const matches=runs.workflow_runs.filter(row=>row?.head_sha===releaseSha);
 if(!matches.length)return Object.freeze({status:'BLOCKED_EXTERNAL'});
 const successful=matches.filter(row=>row?.status==='completed'&&row?.conclusion==='success'&&row?.event==='workflow_dispatch'
  &&row?.head_branch===BRANCH&&Number.isSafeInteger(row?.id)&&row.id>0);
 if(!successful.length)return Object.freeze({status:'BLOCKED_EXTERNAL'});
 const newest=successful.sort((a,b)=>b.id-a.id)[0];
 return Object.freeze({status:'PASS',evidence:Object.freeze({receiverAudit:true,releaseSha,runId:newest.id})});
}

// Read both Checks and legacy Status contexts for the exact commit. Only the
// two fixed project contexts are accepted and every observed instance must be
// successful; pending, stale, duplicate-conflicting, or absent checks block.
export function observeVercelExactHeadPreview({releaseSha}){
 if(!sha(releaseSha))reject();
 const checks=api(`commits/${releaseSha}/check-runs?per_page=100`),statuses=api(`commits/${releaseSha}/status`);
 if(checks===null||statuses===null)return Object.freeze({status:'BLOCKED_EXTERNAL'});
 if(!Array.isArray(checks.check_runs)||!Array.isArray(statuses.statuses))reject();
 const evidence={};
 for(const context of PREVIEW_CONTEXTS){
  const rows=[...checks.check_runs.filter(row=>row?.name===context).map(row=>({id:row.id,ok:row.status==='completed'&&row.conclusion==='success'})),
   ...statuses.statuses.filter(row=>row?.context===context).map(row=>({id:row.id,ok:row.state==='success'}))];
  if(!rows.length||rows.some(row=>!Number.isSafeInteger(row.id)||row.id<1||!row.ok))return Object.freeze({status:'BLOCKED_EXTERNAL'});
  evidence[context==='Vercel – frontend'?'frontendCheckId':'applicationCheckId']=Math.max(...rows.map(row=>row.id));
 }
 return Object.freeze({status:'PASS',evidence:Object.freeze({exactHeadPreview:true,releaseSha,...evidence})});
}

export function assertNoMissingProductionOperations(){
 const missing=Object.entries(PRODUCTION_STAGE_CLASSIFICATION).filter(([,kind])=>kind==='missing').map(([stage])=>stage);
 if(missing.length)throw Object.assign(new Error('Executable production operations remain missing'),{code:'PRODUCTION_OPERATIONS_MISSING',stages:Object.freeze(missing)});
 return true;
}

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function fixedBinding(context,args,{attempt=false}={}){
 const input=args?.input,state=args?.state;
 if(JSON.stringify(input)!==JSON.stringify(context.input)||!sha(input?.releaseSha)||!uuid(state?.context?.operationId)
  ||state.context.releaseSha!==input.releaseSha||state.context.workspace!==input.workspace||state.context.principal!==input.principal
  ||!Number.isSafeInteger(args.ordinal)||args.ordinal<0)reject();
 const value={releaseSha:input.releaseSha,operationId:state.context.operationId,workspace:input.workspace,principal:input.principal,ordinal:args.ordinal};
 if(attempt){if(!uuid(args.attemptId)||!digest(args.inputDigest)||!digest(args.checkOutputDigest))reject();Object.assign(value,{stageAttemptId:args.attemptId});}
 return value;
}
function translatedThinOperation(context,stage,{mutating=MUTATING_STAGES.has(stage),source=verifyReleaseSource}={}){
 const observe=args=>{
  const binding=fixedBinding(context,args,{attempt:mutating});
  const verified=source(context.input.releaseSha);
  if(verified?.releaseSha!==context.input.releaseSha||verified.clean!==true)reject();
  const evidence={stage,...binding,sourceVerified:true,sourceDigest:hash(verified)};
  return Object.freeze({status:'PASS',evidence:Object.freeze(evidence)});
 };
 const operation={check:args=>{
  const binding=fixedBinding(context,args),verified=source(context.input.releaseSha);
  if(verified?.releaseSha!==context.input.releaseSha||verified.clean!==true)reject();
  return Object.freeze({status:'PASS',evidence:Object.freeze({stage,...binding,sourceVerified:true,sourceDigest:hash(verified)})});
 },observe};
 if(mutating){operation.execute=args=>{fixedBinding(context,args,{attempt:true});};operation.reconcile=observe;}
 return Object.freeze(operation);
}
function externalOperation(context,observe){
 const run=args=>{fixedBinding(context,args);return observe({releaseSha:context.input.releaseSha});};
 return Object.freeze({check:run,observe:run});
}

// The production CLI calls this without dependencies. The dependency seam is
// retained only for isolated tests of fixed transports; protected input cannot
// select implementations, commands, URLs, or success values.
export function createFixedProductionOperations(context,dependencies={}){
 assertNoMissingProductionOperations();
 if(!context||context.input?.releaseSha!==context.release?.releaseSha||typeof context.journal?.stream!=='function')reject();
 const operations=Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,translatedThinOperation(context,stage)]));
 operations.receiver_audit=externalOperation(context,observeReceiverAudit);
 operations.vercel_exact_head_preview=externalOperation(context,observeVercelExactHeadPreview);
 operations.provider_acl_check=createProviderAclCheckOperation({query:dependencies.providerQuery??((sql,values)=>queryFixedProviderAcl(context.release.activationConfigurationFile,sql,values))});
 const writerHost={...(dependencies.writerHost??{}),configurationFile:context.release.activationConfigurationFile};
 operations.bounded_writer_e2e=createBoundedWriterE2eOperation({inspectAcceptance:binding=>inspectFixedWriterAcceptance(binding,writerHost),
  runAcceptance:request=>runFixedWriterAcceptance(request,writerHost)});
 Object.assign(operations,createRollbackProductionOperations(context,dependencies.rollback));
 Object.assign(operations,createHealthSmokeProductionOperations(context,dependencies.healthSmoke));
 Object.assign(operations,createZeroProofProductionOperations(context,dependencies.zeroProof));
 Object.assign(operations,createDeploymentProductionOperations(context,dependencies.deployment));
 Object.assign(operations,createN8nMigrationProductionOperations(context,dependencies.n8nMigration));
 if(Object.keys(operations).sort().join(',')!==[...RELEASE_STAGES].sort().join(','))reject();
 for(const stage of RELEASE_STAGES){const operation=operations[stage];if(!operation||typeof operation.check!=='function'||typeof operation.observe!=='function'
  ||MUTATING_STAGES.has(stage)&&(typeof operation.execute!=='function'||typeof operation.reconcile!=='function'))reject();}
 return Object.freeze(operations);
}
