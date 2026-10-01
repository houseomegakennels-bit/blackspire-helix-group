import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {loadCustomerInstallation} from '../shared/customer-installation.js';
import {validatePolicy} from './policy.mjs';
import {exclusive,privateDirectory,readPrivate,fail} from './private-files.mjs';
function exists(file){try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
// No credential decryption, provider calls, receipt edits or automatic hold release.
export function reviewCustomerRecovery(root,now=Date.now()){
 privateDirectory(root);
 return exclusive(root,()=>{
  const {manifest}=loadCustomerInstallation(root);privateDirectory(path.join(root,'data'));
  const p=JSON.parse(readPrivate(path.join(root,'customer-ai.json')));
  let pricingCurrent=true;try{validatePolicy(p,manifest.installationId,now);}catch(e){if(e.message!=='PRICING_EXPIRED')throw e;pricingCurrent=false;}
  if(p.provider!==manifest.ai.provider)fail('PROVIDER_SELECTION_MISMATCH');
  const holdPath=path.join(root,'recovery-hold.json');let hold=null;
  if(exists(holdPath)){
   const h=JSON.parse(readPrivate(holdPath));
   if(h.schemaVersion!==1||h.installationId!==manifest.installationId||h.automaticRelease!==false||![h.backupCreatedAt,h.restoredAt].every(x=>typeof x==='string'&&Number.isFinite(Date.parse(x))))fail('RECOVERY_HOLD_INVALID');
   hold={backupCreatedAt:h.backupCreatedAt,restoredAt:h.restoredAt,automaticRelease:false};
  }
  const file=path.join(root,'data/customer-ai.sqlite');let budget={state:'not_created',months:[],unresolved:[],unresolvedCount:0,truncated:false,totalRequests:0};
  if(exists(file)){
   readPrivate(file,64*1024*1024);
   for(const suffix of ['-journal','-wal','-shm'])if(exists(file+suffix))fail('LEDGER_RECOVERY_REQUIRED');
   const db=new DatabaseSync(file,{readOnly:true});
   try{
    db.exec('PRAGMA query_only=ON; BEGIN');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('LEDGER_INTEGRITY_FAILED');
    const identity=db.prepare('SELECT id FROM identity').all();if(identity.length!==1||identity[0].id!==manifest.installationId)fail('LEDGER_IDENTITY_MISMATCH');
    const invalid=db.prepare("SELECT count(*) n FROM requests WHERE state NOT IN ('pending','completed','unknown','overrun') OR typeof(reserved)<>'integer' OR reserved<0 OR (actual IS NOT NULL AND (typeof(actual)<>'integer' OR actual<0))").get().n;
    if(invalid)fail('LEDGER_CONTENT_INVALID');
    const totalRequests=db.prepare('SELECT count(*) n FROM requests').get().n;if(totalRequests>10000)fail('LEDGER_REVIEW_LIMIT');
    const months=db.prepare('SELECT month, count(*) requests, sum(reserved) reservedMicroUsd, COALESCE(sum(actual),0) observedMicroUsd FROM requests GROUP BY month ORDER BY month').all();
    if(months.some(x=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(x.month)||![x.reservedMicroUsd,x.observedMicroUsd].every(Number.isSafeInteger)))fail('LEDGER_CONTENT_INVALID');
    const unresolvedCount=db.prepare("SELECT count(*) n FROM requests WHERE state<>'completed'").get().n;
    const unresolved=db.prepare("SELECT id requestId,state,reserved reservedMicroUsd,actual observedMicroUsd,created FROM requests WHERE state<>'completed' ORDER BY created,id LIMIT 100").all();
    if(unresolved.some(x=>typeof x.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(x.requestId)||!Number.isSafeInteger(x.created)))fail('LEDGER_CONTENT_INVALID');
    budget={state:'reviewed_local_snapshot',months,unresolved,unresolvedCount,truncated:unresolvedCount>100,totalRequests};
    db.exec('COMMIT');
   }finally{db.close();}
  }
  const blockers=[];if(hold)blockers.push('recovery_hold');if(!p.enabled)blockers.push('paused');if(!pricingCurrent)blockers.push('pricing_expired_or_invalid');if(budget.unresolvedCount)blockers.push('unresolved_requests');
  return {scope:'text-only-cli',installationId:manifest.installationId,provider:p.provider,model:p.model,enabled:p.enabled&&!hold,configuredEnabled:p.enabled,pricingCurrent,recoveryHold:hold,budget,blockers,liveAuthentication:'not_verified_by_status',providerCharges:'not_reconciled_by_this_report',admissionVerified:false,nextSteps:hold?['Retire the original installation and confirm it cannot dispatch.','Reconcile provider charges and request receipts since the backup timestamp.','Preserve the ledger and hold. Automated reconciliation and hold release are not available.']:budget.unresolvedCount?['Review unresolved request outcomes against provider records; do not retry or delete reservations.']:[]};
 });
}
