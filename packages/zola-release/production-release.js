import {hash} from './commander-journal.js';
import {MUTATING_STAGES,RELEASE_STAGES,runReleaseSequence} from './commander-sequence.js';
import {createFixedProductionOperations} from './production-adapters.js';

const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const reject=()=>{throw new Error('Production release composition rejected; retain journal and reconcile');};
const RELEASE_INPUT_KEYS=Object.freeze(['schema','kind','releaseSha','previousMainSha','recoverySha','workspace','principal','preparationRoot',
 'packageConfigurationFile','n8nBackupFile','diskConfigurationFile','backupManifestFile','migrationConfigurationFile','activationConfigurationFile']);

function sequenceInput(loadedInput){
 if(!exact(loadedInput,['value','inputDigest','source'])||!digest(loadedInput.inputDigest))reject();
 const value=loadedInput.value;
 if(!exact(value,RELEASE_INPUT_KEYS)||value.schema!==1||value.kind!=='zola_production_release'||![value.releaseSha,value.previousMainSha,value.recoverySha].every(sha)
  ||typeof value.workspace!=='string'||typeof value.principal!=='string')reject();
 const input={releaseSha:value.releaseSha,previousMainSha:value.previousMainSha,recoverySha:value.recoverySha,
  protectedInputDigest:loadedInput.inputDigest,workspace:value.workspace,principal:value.principal};
 return Object.freeze({...input,inputDigest:hash(input)});
}

function bind(stage,operation){
 if(!operation||typeof operation!=='object'||Array.isArray(operation)
  ||typeof operation.check!=='function'||typeof operation.observe!=='function')reject();
 const adapter={check:operation.check,observe:operation.observe};
 if(MUTATING_STAGES.has(stage)){
  if(typeof operation.execute!=='function'||typeof operation.reconcile!=='function')reject();
  adapter.execute=operation.execute;adapter.reconcile=operation.reconcile;
 }
 return Object.freeze(adapter);
}

// This is the only production composition root. The CLI supplies immutable,
// root-owned input and a protected journal, never adapter implementations. The
// dependency seam exists solely for deterministic unit/adversarial tests.
export function buildProductionAdapters({loadedInput,journal},{operations=createFixedProductionOperations}={}){
 if(!journal?.stream||typeof operations!=='function')reject();
 const input=sequenceInput(loadedInput);
 const fixed=operations(Object.freeze({release:loadedInput.value,input,source:loadedInput.source,journal}));
 if(!fixed||typeof fixed!=='object'||Array.isArray(fixed)
  ||Object.keys(fixed).sort().join(',')!==[...RELEASE_STAGES].sort().join(','))reject();
 const adapter=stage=>bind(stage,fixed[stage]);
 // Keep the complete registry visible here: a stage addition cannot silently
 // inherit a generic/default implementation or a caller-provided PASS value.
 return Object.freeze({
  exact_sha_verification:adapter('exact_sha_verification'),
  receiver_audit:adapter('receiver_audit'),
  vercel_exact_head_preview:adapter('vercel_exact_head_preview'),
  provider_acl_check:adapter('provider_acl_check'),
  n8n_backup_check:adapter('n8n_backup_check'),
  candidate_six_reads:adapter('candidate_six_reads'),
  admission_lease:adapter('admission_lease'),
  generation_revalidation:adapter('generation_revalidation'),
  n8n_migration:adapter('n8n_migration'),
  bounded_writer_e2e:adapter('bounded_writer_e2e'),
  migration_preflight:adapter('migration_preflight'),
  production_migrations:adapter('production_migrations'),
  migration_postconditions:adapter('migration_postconditions'),
  six_reads:adapter('six_reads'),
  rollback_acceptance:adapter('rollback_acceptance'),
  ci_security:adapter('ci_security'),
  final_diff:adapter('final_diff'),
  expected_head_merge:adapter('expected_head_merge'),
  capture_new_main_sha:adapter('capture_new_main_sha'),
  verify_main:adapter('verify_main'),
  verify_vercel_production_sha:adapter('verify_vercel_production_sha'),
  journaled_vps_cutover:adapter('journaled_vps_cutover'),
  post_merge_held_epoch:adapter('post_merge_held_epoch'),
  mint_acceptance_permit:adapter('mint_acceptance_permit'),
  api_health:adapter('api_health'),
  worker_readiness:adapter('worker_readiness'),
  generation_fence:adapter('generation_fence'),
  six_live_reads:adapter('six_live_reads'),
  production_smoke:adapter('production_smoke'),
  zero_paid_nexus:adapter('zero_paid_nexus'),
  zero_unintended_mutation:adapter('zero_unintended_mutation'),
  rollback_verification:adapter('rollback_verification'),
  final_release_record:adapter('final_release_record'),
  guarded_held_to_open:adapter('guarded_held_to_open'),
 });
}

export async function runProductionRelease({loadedInput,journal},dependencies={}){
 try{
  const input=sequenceInput(loadedInput);
  const adapters=buildProductionAdapters({loadedInput,journal},dependencies);
  return await (dependencies.sequence??runReleaseSequence)({input,journal,adapters});
 }catch{
  return{status:'STOPPED',releaseState:'FAIL_CLOSED',reason:'PRODUCTION_COMPOSITION_REJECTED',
   releaseReady:false,mutationSent:null,reconciliationRequired:true,resumeReady:true};
 }
}
