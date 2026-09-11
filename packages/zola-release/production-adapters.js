import {execFileSync} from 'node:child_process';

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
 exact_sha_verification:'thin',receiver_audit:'primitive',vercel_exact_head_preview:'primitive',provider_acl_check:'missing',
 n8n_backup_check:'thin',candidate_six_reads:'thin',admission_lease:'thin',generation_revalidation:'thin',n8n_migration:'thin',
 bounded_writer_e2e:'missing',migration_preflight:'thin',production_migrations:'thin',migration_postconditions:'thin',six_reads:'thin',
 rollback_acceptance:'missing',ci_security:'thin',final_diff:'thin',expected_head_merge:'thin',capture_new_main_sha:'thin',verify_main:'thin',
 verify_vercel_production_sha:'thin',journaled_vps_cutover:'thin',post_merge_held_epoch:'thin',mint_acceptance_permit:'thin',
 api_health:'missing',worker_readiness:'thin',generation_fence:'thin',six_live_reads:'thin',production_smoke:'missing',
 zero_paid_nexus:'missing',zero_unintended_mutation:'missing',rollback_verification:'missing',final_release_record:'thin',guarded_held_to_open:'thin',
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

// Deliberately refuses construction until every "missing" classification has
// an executable, reconcilable host primitive. This prevents the composition
// root from quietly substituting generic success adapters. Tests of the
// composition boundary use its explicit test-only operations seam.
export function createFixedProductionOperations(){
 assertNoMissingProductionOperations();
 reject();
}
