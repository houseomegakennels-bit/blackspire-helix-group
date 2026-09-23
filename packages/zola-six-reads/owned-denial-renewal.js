import {createHash,randomBytes} from 'node:crypto';
export const renewalHash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export const RENEWAL=Object.freeze({
 root:'/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-denial-renewal-20260923',
 baseSha:'93611c3b6178cbafb869f6baf9ec6a5bb4b8f454',
 canonicalRoot:'/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921',
 releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',operationId:'c8b00904-7017-434a-918e-8aaadbae82fd',
 inputDigest:'9eef628a183afe6abf337ec6ec5c6e9fda68a7b8ae7caeb173edf327c2befc0d',checkOutputDigest:'0211a5bc114faca7025a736503347880b7782eeff02c9180b6a1e5dac572aeb0',
 attemptId:'e0a5951a-287f-4f84-9ec8-5b44c926153b',runId:'c2681636-b47f-4c66-8569-be0744c60f16',
 configPath:'/var/lib/blackspire-operator/preparation/six-read-premerge-config.json',
 configDigest:'bc04dc2c98d5d4ee167e2ace3e0dde0b40ff7256ab7de90b0b87500e29b21148',
 originalReceiptDigest:'18b505632eadb971a59fb5924336f5561fc00d29f94b5a5ed86849ce1c3a17ca',
 originalSessionDigest:'586c73a34dd3c06c6c908231c284bd5a46e99b5763d9cf2e8efd13b7423c6236',
 prefix:'/var/lib/blackspire-operator/preparation/six-read-premerge-denial-renewal-20260923',
 authentication:'root-delegated-existing-principal-renewal',action:'auth.delegated-denial.renewed'
});
export const renewalFail=()=>{throw Error('OWNED_DENIAL_RENEWAL_REJECTED');};
const exact=(v,keys)=>v&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const same=(a,b)=>renewalHash(a)===renewalHash(b);
const receiptKeys='authentication,createdAt,databaseIdentity,deniedCookie,deniedPrincipal,expiresAt,marker,operatorPrincipal,releaseSha,runId,sessionId,version,workspace';
export function assertRenewalConfig(config,policy=RENEWAL){if(!config||renewalHash(config)!==policy.configDigest)renewalFail();return true;}
export function assertRenewalStart({config,original,state,events,collectorEmpty,permitAbsent,now=Date.now()},policy=RENEWAL){
 assertRenewalConfig(config,policy);
 if(renewalHash(original)!==policy.originalReceiptDigest||renewalHash(original.sessionId)!==policy.originalSessionDigest
  ||original.expiresAt>now||state?.context?.releaseSha!==policy.releaseSha||state.context.operationId!==policy.operationId
  ||state.pending?.stage!=='six_reads'||state.pending.attemptId!==policy.attemptId||state.nextOrdinal!==13
  ||state.pending.inputDigest!==policy.inputDigest||state.pending.checkOutputDigest!==policy.checkOutputDigest
  ||state.outputs?.admission_lease?.epochRunId!==policy.runId||!state.outputs?.n8n_migration
  ||!Array.isArray(events)||events.some(e=>String(e.type).startsWith('premerge_reads_'))||collectorEmpty!==true||permitAbsent!==true)renewalFail();
 return true;
}
function sessionMatches(receipt,session){return session&&session.id===receipt.sessionId&&session.principal_id===receipt.deniedPrincipal
 &&session.created_at===receipt.createdAt&&session.expires_at===receipt.expiresAt&&session.user_agent===receipt.marker&&session.ip==='root-local-delegation'&&session.revoked_at===null;}
function bound(receipt,config,identity){return receipt.releaseSha===config.releaseSha&&receipt.runId===config.runId&&receipt.workspace===config.workspace
 &&receipt.operatorPrincipal===config.principal&&receipt.deniedPrincipal===config.deniedPrincipal
 &&exact(receipt.databaseIdentity,'dev,ino,uid')&&['dev','ino','uid'].every(k=>receipt.databaseIdentity[k]===identity[k])
 &&/^[a-f0-9]{48}$/.test(receipt.sessionId??'')&&receipt.deniedCookie===`bc_session=${receipt.sessionId}`
 &&Number.isSafeInteger(receipt.createdAt)&&Number.isSafeInteger(receipt.expiresAt)&&receipt.expiresAt>receipt.createdAt&&receipt.expiresAt-receipt.createdAt<=900000;}
export function assertOriginalDenial({original,config,identity,session,audits,activeGrants,family,now=Date.now()},policy=RENEWAL){
 assertRenewalConfig(config,policy);
 if(!exact(original,receiptKeys)||original.version!==1||original.authentication!=='root-delegated-existing-principal'
  ||renewalHash(original)!==policy.originalReceiptDigest||!bound(original,config,identity)||original.expiresAt>now
  ||!sessionMatches(original,session)||activeGrants!==0||!Array.isArray(family)||family.length!==1||family[0].id!==original.sessionId
  ||!Array.isArray(audits)||audits.length!==1||audits[0].actor!==original.operatorPrincipal)renewalFail();
 const expected={runId:original.runId,releaseSha:original.releaseSha,deniedPrincipal:original.deniedPrincipal,workspace:original.workspace,sessionDigest:renewalHash(original.sessionId),expiresAt:original.expiresAt};
 let details;try{details=JSON.parse(audits[0].details);}catch{renewalFail();}if(!same(details,expected))renewalFail();return true;
}
export function renewalAuditDetails(receipt,policy=RENEWAL){return {runId:receipt.runId,releaseSha:receipt.releaseSha,deniedPrincipal:receipt.deniedPrincipal,workspace:receipt.workspace,
 originalReceiptDigest:policy.originalReceiptDigest,originalSessionDigest:policy.originalSessionDigest,intentDigest:receipt.intentDigest,
 sessionDigest:renewalHash(receipt.sessionId),createdAt:receipt.createdAt,expiresAt:receipt.expiresAt};}
export function verifyRenewedDenial(receipt,config,identity,{original,originalSession,originalAudits,originalFamily,renewedFamily,session,audits,activeGrants,intent,result,now=Date.now()},policy=RENEWAL){
 assertOriginalDenial({original,config,identity,session:originalSession,audits:originalAudits,family:originalFamily,activeGrants,now},policy);
 if(!exact(receipt,receiptKeys+',intentDigest,originalReceiptDigest')||receipt.version!==2||receipt.authentication!==policy.authentication
  ||!bound(receipt,config,identity)||receipt.originalReceiptDigest!==policy.originalReceiptDigest||receipt.createdAt>now||receipt.expiresAt<=now
  ||receipt.createdAt<original.expiresAt||receipt.sessionId===original.sessionId||receipt.marker!==`zola-denial-renewal:${policy.attemptId}`
  ||!sessionMatches(receipt,session)||!Array.isArray(renewedFamily)||renewedFamily.length!==1||renewedFamily[0].id!==receipt.sessionId||!exact(intent,'version,kind,operatorSha,configDigest,originalReceiptDigest,operationId,attemptId,inputDigest,checkOutputDigest,profileDigest,createdAt')
  ||intent.version!==1||intent.kind!=='owned-denial-renewal-intent'||intent.configDigest!==policy.configDigest||intent.originalReceiptDigest!==policy.originalReceiptDigest
  ||intent.inputDigest!==policy.inputDigest||intent.checkOutputDigest!==policy.checkOutputDigest
  ||intent.operationId!==policy.operationId||intent.attemptId!==policy.attemptId||!['operatorSha'].every(k=>/^[a-f0-9]{40}$/.test(intent[k]??''))
  ||!['inputDigest','checkOutputDigest','profileDigest'].every(k=>/^[a-f0-9]{64}$/.test(intent[k]??''))||!Number.isSafeInteger(intent.createdAt)||intent.createdAt>receipt.createdAt
  ||receipt.intentDigest!==renewalHash(intent)||!exact(result,'version,kind,intentDigest,receiptDigest,expiresAt')||result.version!==1||result.kind!=='owned-denial-renewal-result'
  ||result.intentDigest!==receipt.intentDigest||result.receiptDigest!==renewalHash(receipt)||result.expiresAt!==receipt.expiresAt
  ||!Array.isArray(audits)||audits.length!==1||audits[0].actor!==receipt.operatorPrincipal)renewalFail();
 let details;try{details=JSON.parse(audits[0].details);}catch{renewalFail();}if(!same(details,renewalAuditDetails(receipt,policy)))renewalFail();return true;
}
// Uses the shared production session subsystem. No grants or principals are created.
export async function openRenewalService(databasePath,{policy=RENEWAL}={}){
 const db=await import('../task-engine/db.js'),sessions=await import('../shared/sessions.js'),auth=await import('../shared/authorization.js');
 if((await import('../shared/config.js')).DB_PATH!==databasePath)renewalFail();
 const observations=(original,config)=>({session:db.get('SELECT * FROM sessions WHERE id=?',[original.sessionId]),
  audits:db.all("SELECT actor,details FROM audit_events WHERE action='auth.delegated-denial.issued' AND json_extract(details,'$.runId')=?",[config.runId]),
  family:db.all('SELECT * FROM sessions WHERE user_agent=?',[original.marker]),
  activeGrants:db.get("SELECT count(*) AS n FROM auth_workspace_grants WHERE principal_id=? AND status='active'",[config.deniedPrincipal]).n});
 return {issue({original,config,identity,intent},publish){return db.transaction(()=>{
  assertOriginalDenial({original,config,identity,...observations(original,config)},policy);
  for(const id of [config.principal,config.deniedPrincipal])if(auth.resolveAdminBearer(id)?.principalType!=='admin')renewalFail();
  if(db.get("SELECT count(*) AS n FROM audit_events WHERE action=? AND json_extract(details,'$.runId')=?",[policy.action,config.runId]).n!==0)renewalFail();
  const marker=`zola-denial-renewal:${policy.attemptId}`;
  if(db.get('SELECT count(*) AS n FROM sessions WHERE user_agent=?',[marker]).n!==0)renewalFail();
  const s=sessions.createSession({principalId:config.deniedPrincipal,userAgent:marker,ip:'root-local-delegation',maxExpiresAt:Date.now()+900000});
  const receipt={version:2,authentication:policy.authentication,operatorPrincipal:config.principal,deniedPrincipal:config.deniedPrincipal,workspace:config.workspace,
   runId:config.runId,releaseSha:config.releaseSha,sessionId:s.sessionId,deniedCookie:`bc_session=${s.sessionId}`,createdAt:s.createdAt,expiresAt:s.expiresAt,marker,databaseIdentity:identity,
   originalReceiptDigest:policy.originalReceiptDigest,intentDigest:renewalHash(intent)};
  if(!bound(receipt,config,identity)||!sessions.getSession(s.sessionId))renewalFail();
  db.run('INSERT INTO audit_events(id,task_id,actor,action,details,created_at) VALUES(?,NULL,?,?,?,?)',[
   `aud-${randomBytes(16).toString('hex')}`,config.principal,policy.action,JSON.stringify(renewalAuditDetails(receipt,policy)),new Date().toISOString()]);
  const prior=observations(original,config);
  verifyRenewedDenial(receipt,config,identity,{original,originalSession:prior.session,originalAudits:prior.audits,originalFamily:prior.family,activeGrants:prior.activeGrants,
   session:db.get('SELECT * FROM sessions WHERE id=?',[receipt.sessionId]),renewedFamily:db.all('SELECT * FROM sessions WHERE user_agent=?',[marker]),
   audits:db.all("SELECT actor,details FROM audit_events WHERE action=? AND json_extract(details,'$.runId')=?",[policy.action,config.runId]),intent,
   result:{version:1,kind:'owned-denial-renewal-result',intentDigest:renewalHash(intent),receiptDigest:renewalHash(receipt),expiresAt:receipt.expiresAt}},policy);
  publish(receipt);return receipt;
 });},close:()=>db.closeDb()};
}
