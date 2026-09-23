import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {RENEWAL,renewalHash as hash,assertRenewalConfig,assertOriginalDenial,renewalAuditDetails} from './owned-denial-renewal.js';
import {readRenewalProof,readRenewalJson} from './owned-denial-host.js';
import {SUCCESSOR,checkSuccessorSource,readTerminalProof} from './owned-collector-successor-host.js';
export const DENIAL_SUCCESSOR=Object.freeze({prefix:'/var/lib/blackspire-operator/preparation/six-read-premerge-denial-successor-20260923',
 action:'auth.delegated-denial.collector-successor',authentication:'root-delegated-existing-principal-collector-successor',
 priorIntentDigest:'6db2a7e5726840dc73c7fdd5b983cba29450e2624363d4e686247bf9d881c8f0',priorReceiptDigest:'d52dd5a79480e7b799f6e08c34ee9a4ad846faa26add2cf9cc6d607b32abba7e',
 priorResultDigest:'834c4f87199e24b742907d3e41c0d3c2916040890258b93290e31c07e27e910e',priorSessionDigest:'93dc1816092159a77fd3a6db119377ee0d6a794e43384f4cd9c174678414fd35'});
export const successorDenialFail=()=>{throw Error('OWNED_DENIAL_SUCCESSOR_REJECTED');};
const fail=successorDenialFail;
const same=(a,b)=>hash(a)===hash(b);
const exact=(v,keys)=>v&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const receiptKeys='authentication,createdAt,databaseIdentity,deniedCookie,deniedPrincipal,expiresAt,marker,operatorPrincipal,releaseSha,runId,sessionId,version,workspace';
function sessionMatches(r,s){return s&&s.id===r.sessionId&&s.principal_id===r.deniedPrincipal&&s.created_at===r.createdAt&&s.expires_at===r.expiresAt&&s.user_agent===r.marker&&s.ip==='root-local-delegation'&&s.revoked_at===null;}
function bound(r,c,id){return r.releaseSha===c.releaseSha&&r.runId===c.runId&&r.workspace===c.workspace&&r.operatorPrincipal===c.principal&&r.deniedPrincipal===c.deniedPrincipal
 &&exact(r.databaseIdentity,'dev,ino,uid')&&['dev','ino','uid'].every(k=>r.databaseIdentity[k]===id[k])&&/^[a-f0-9]{48}$/.test(r.sessionId??'')&&r.deniedCookie===`bc_session=${r.sessionId}`
 &&Number.isSafeInteger(r.createdAt)&&Number.isSafeInteger(r.expiresAt)&&r.expiresAt>r.createdAt&&r.expiresAt-r.createdAt<=900000;}
export function assertExpiredRenewalLineage(prior,config,identity,observation,{now=Date.now(),policy=DENIAL_SUCCESSOR,renewalPolicy=RENEWAL}={}){
 assertRenewalConfig(config,renewalPolicy);
 const {original,receipt,intent,result}=prior;
 if(hash(intent)!==policy.priorIntentDigest||hash(receipt)!==policy.priorReceiptDigest||hash(result)!==policy.priorResultDigest||hash(receipt.sessionId)!==policy.priorSessionDigest
 ||intent.operatorSha!==SUCCESSOR.baseSha||receipt.intentDigest!==hash(intent)||result.intentDigest!==hash(intent)||result.receiptDigest!==hash(receipt)||result.expiresAt!==receipt.expiresAt
 ||!exact(receipt,receiptKeys+',intentDigest,originalReceiptDigest')||receipt.version!==2||receipt.authentication!==renewalPolicy.authentication||!bound(receipt,config,identity)
 ||receipt.originalReceiptDigest!==renewalPolicy.originalReceiptDigest||receipt.expiresAt>now||receipt.marker!==`zola-denial-renewal:${renewalPolicy.attemptId}`)fail();
 assertOriginalDenial({original,config,identity,session:observation.originalSession,audits:observation.originalAudits,family:observation.originalFamily,activeGrants:observation.activeGrants,now},renewalPolicy);
 if(!Array.isArray(observation.priorAudits)||observation.priorAudits.length!==1||observation.priorAudits[0].actor!==receipt.operatorPrincipal)fail();
 let details;try{details=JSON.parse(observation.priorAudits[0].details);}catch{fail();}if(!same(details,renewalAuditDetails(receipt,renewalPolicy)))fail();
 if(!Array.isArray(observation.priorFamily))fail();
 if(observation.priorSession==null){if(observation.priorFamily.length!==0)fail();return 'expired-session-absent';}
 if(!sessionMatches(receipt,observation.priorSession)||observation.priorFamily.length!==1||!sessionMatches(receipt,observation.priorFamily[0]))fail();
 return 'expired-session-present';
}
export function successorAuditDetails(receipt){return {runId:receipt.runId,releaseSha:receipt.releaseSha,workspace:receipt.workspace,deniedPrincipal:receipt.deniedPrincipal,
 intentDigest:receipt.intentDigest,originalReceiptDigest:RENEWAL.originalReceiptDigest,priorReceiptDigest:DENIAL_SUCCESSOR.priorReceiptDigest,
 sessionDigest:hash(receipt.sessionId),createdAt:receipt.createdAt,expiresAt:receipt.expiresAt};}
export function verifySuccessorDenial(receipt,config,identity,proof,observation,{now=Date.now(),policy=DENIAL_SUCCESSOR,renewalPolicy=RENEWAL}={}){
 const outcome=assertExpiredRenewalLineage(proof.prior,config,identity,observation,{now,policy,renewalPolicy});
 const {intent,result,terminalProof}=proof;
 if(!exact(intent,'version,kind,operatorSha,configDigest,operationId,attemptId,runId,originalReceiptDigest,priorIntentDigest,priorReceiptDigest,priorResultDigest,priorSessionDigest,priorOutcome,profileDigest,terminalProofDigest,roleProofDigest,createdAt')
 ||intent.version!==1||intent.kind!=='owned-denial-collector-successor-intent'||intent.configDigest!==renewalPolicy.configDigest||intent.operationId!==renewalPolicy.operationId||intent.attemptId!==renewalPolicy.attemptId||intent.runId!==renewalPolicy.runId
 ||intent.originalReceiptDigest!==renewalPolicy.originalReceiptDigest||['priorIntentDigest','priorReceiptDigest','priorResultDigest','priorSessionDigest'].some(k=>intent[k]!==policy[k])
 ||!['expired-session-absent','expired-session-present'].includes(intent.priorOutcome)||intent.priorOutcome==='expired-session-absent'&&outcome!=='expired-session-absent'
 ||!/^[a-f0-9]{40}$/.test(intent.operatorSha??'')||!['profileDigest','roleProofDigest'].every(k=>/^[a-f0-9]{64}$/.test(intent[k]??''))||intent.terminalProofDigest!==terminalProof.terminalProofDigest
 ||!Number.isSafeInteger(intent.createdAt)||intent.createdAt>receipt.createdAt||intent.createdAt<proof.prior.receipt.expiresAt
 ||!exact(receipt,receiptKeys+',intentDigest,priorReceiptDigest')||receipt.version!==3||receipt.authentication!==policy.authentication||!bound(receipt,config,identity)
 ||receipt.intentDigest!==hash(intent)||receipt.priorReceiptDigest!==policy.priorReceiptDigest||receipt.marker!==`zola-denial-collector-successor:${renewalPolicy.attemptId}`
 ||receipt.createdAt>now||receipt.expiresAt<=now||receipt.sessionId===proof.prior.receipt.sessionId||receipt.sessionId===proof.prior.original.sessionId
 ||!sessionMatches(receipt,observation.session)||!Array.isArray(observation.family)||observation.family.length!==1||!sessionMatches(receipt,observation.family[0])
 ||!exact(result,'version,kind,intentDigest,receiptDigest,expiresAt')||result.version!==1||result.kind!=='owned-denial-collector-successor-result'||result.intentDigest!==hash(intent)||result.receiptDigest!==hash(receipt)||result.expiresAt!==receipt.expiresAt
 ||!Array.isArray(observation.audits)||observation.audits.length!==1||observation.audits[0].actor!==receipt.operatorPrincipal)fail();
 let details;try{details=JSON.parse(observation.audits[0].details);}catch{fail();}if(!same(details,successorAuditDetails(receipt)))fail();return true;
}
function dbFence(config,identity){const s=fs.lstatSync(config.databasePath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o007)||['dev','ino','uid'].some(k=>s[k]!==identity[k]))fail();}
function observe(db,prior,config,receipt){
 const get=(q,...args)=>db.prepare(q).get(...args),all=(q,...args)=>db.prepare(q).all(...args),audits=action=>all("SELECT actor,details FROM audit_events WHERE action=? AND json_extract(details,'$.runId')=?",action,config.runId);
 const original=prior.original,old=prior.receipt,marker=`zola-denial-collector-successor:${RENEWAL.attemptId}`;
 for(const id of [config.principal,config.deniedPrincipal]){const p=get('SELECT * FROM auth_principals WHERE id=?',id);if(!p||p.type!=='admin'||p.authentication_method!=='bearer'||p.status!=='active'||p.revoked_at!==null||p.disabled_at!==null||(p.expires_at!==null&&p.expires_at<=Date.now()))fail();}
 return {originalSession:get('SELECT * FROM sessions WHERE id=?',original.sessionId),originalFamily:all('SELECT * FROM sessions WHERE user_agent=?',original.marker),originalAudits:audits('auth.delegated-denial.issued'),
 priorSession:get('SELECT * FROM sessions WHERE id=?',old.sessionId),priorFamily:all('SELECT * FROM sessions WHERE user_agent=?',old.marker),priorAudits:audits(RENEWAL.action),
 activeGrants:get("SELECT count(*) n FROM auth_workspace_grants WHERE principal_id=? AND status='active'",config.deniedPrincipal).n,
 session:receipt?get('SELECT * FROM sessions WHERE id=?',receipt.sessionId):undefined,family:all('SELECT * FROM sessions WHERE user_agent=?',marker),audits:audits(DENIAL_SUCCESSOR.action)};
}
function readonly(config,identity,fn){dbFence(config,identity);const db=new DatabaseSync(config.databasePath,{readOnly:true});try{db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000;BEGIN');return fn(db);}finally{db.exec('ROLLBACK');db.close();dbFence(config,identity);}}
export function inspectSuccessorEligibility(config,identity){const prior=readRenewalProof(config);return readonly(config,identity,db=>{const o=observe(db,prior,config);const outcome=assertExpiredRenewalLineage(prior,config,identity,o);if(o.family.length||o.audits.length)fail();return {prior,outcome};});}
export function readSuccessorDenialProof(config){
 assertRenewalConfig(config);const operatorSha=checkSuccessorSource(),terminalProof=readTerminalProof(),prior=readRenewalProof(config);
 const intent=readRenewalJson(DENIAL_SUCCESSOR.prefix+'-intent.json'),receipt=readRenewalJson(DENIAL_SUCCESSOR.prefix+'-receipt.json'),result=readRenewalJson(DENIAL_SUCCESSOR.prefix+'-result.json');
 if(intent.operatorSha!==operatorSha||intent.terminalProofDigest!==terminalProof.terminalProofDigest||receipt.intentDigest!==hash(intent)||result.intentDigest!==hash(intent)||result.receiptDigest!==hash(receipt))fail();
 return {intent,receipt,result,terminalProof,prior};
}
export function verifySuccessorDatabase(receipt,config,identity){const proof=readSuccessorDenialProof(config);if(hash(receipt)!==hash(proof.receipt))fail();return readonly(config,identity,db=>verifySuccessorDenial(receipt,config,identity,proof,observe(db,proof.prior,config,receipt)));}
export function selectSuccessorReceipt(config){const p=readSuccessorDenialProof(config);verifySuccessorDatabase(p.receipt,config,fs.lstatSync(config.databasePath));return p.receipt;}
// Publication runs while the database transaction is open; publication failure rolls back it.
export function publishBeforeCommit(transaction,build,publish){return transaction(()=>{const result=build();publish(result.receipt);return result;});}
export async function openSuccessorDenialService(databasePath){
 const db=await import('../task-engine/db.js'),sessions=await import('../shared/sessions.js'),auth=await import('../shared/authorization.js');
 if((await import('../shared/config.js')).DB_PATH!==databasePath)fail();
 const adapter={prepare:q=>({get:(...a)=>db.get(q,a),all:(...a)=>db.all(q,a)})};
 return {issue({prior,config,identity,intent,terminalProof},publish){return publishBeforeCommit(db.transaction,()=>{
  dbFence(config,identity);const o=observe(adapter,prior,config),outcome=assertExpiredRenewalLineage(prior,config,identity,o);if(!['expired-session-present','expired-session-absent'].includes(intent.priorOutcome)||intent.priorOutcome==='expired-session-absent'&&outcome!=='expired-session-absent'||o.family.length||o.audits.length)fail();
  for(const id of [config.principal,config.deniedPrincipal])if(auth.resolveAdminBearer(id)?.principalType!=='admin')fail();
  const marker=`zola-denial-collector-successor:${RENEWAL.attemptId}`,s=sessions.createSession({principalId:config.deniedPrincipal,userAgent:marker,ip:'root-local-delegation',maxExpiresAt:Date.now()+900000});
  const receipt={version:3,authentication:DENIAL_SUCCESSOR.authentication,operatorPrincipal:config.principal,deniedPrincipal:config.deniedPrincipal,workspace:config.workspace,runId:config.runId,releaseSha:config.releaseSha,
   sessionId:s.sessionId,deniedCookie:`bc_session=${s.sessionId}`,createdAt:s.createdAt,expiresAt:s.expiresAt,marker,databaseIdentity:identity,intentDigest:hash(intent),priorReceiptDigest:DENIAL_SUCCESSOR.priorReceiptDigest};
  if(!sessions.getSession(s.sessionId))fail();
  db.run('INSERT INTO audit_events(id,task_id,actor,action,details,created_at) VALUES(?,NULL,?,?,?,?)',[`aud-${randomBytes(16).toString('hex')}`,config.principal,DENIAL_SUCCESSOR.action,JSON.stringify(successorAuditDetails(receipt)),new Date().toISOString()]);
  const result={version:1,kind:'owned-denial-collector-successor-result',intentDigest:hash(intent),receiptDigest:hash(receipt),expiresAt:receipt.expiresAt};
  verifySuccessorDenial(receipt,config,identity,{prior,intent,result,terminalProof},observe(adapter,prior,config,receipt));dbFence(config,identity);return {receipt,result};
 },publish);},close:()=>db.closeDb()};
}

export const ROLE_PROOF_ROOT='/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-observer-schema-read-20260923';
export const ROLE_PROOF_SHA='61b9fc0a7b6605208eabeb0d24f0201967ffc80c';
export async function readSuccessorRoleProof(){
 const git=args=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',ROLE_PROOF_ROOT,...args],{encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_NO_REPLACE_OBJECTS:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}}).trim();
 if(fs.realpathSync(ROLE_PROOF_ROOT)!==ROLE_PROOF_ROOT||git(['rev-parse','HEAD'])!==ROLE_PROOF_SHA||git(['status','--porcelain','--untracked-files=all']))fail();
 const {verifyOwnerCanaryEvidence}=await import(ROLE_PROOF_ROOT+'/packages/zola-six-reads/owned-observer-schema-read-proof.js');
 const proof=await verifyOwnerCanaryEvidence();if(proof.operatorSha!==ROLE_PROOF_SHA)fail();return proof;
}
export async function verifySuccessorRoleProof(config){const proof=readSuccessorDenialProof(config),role=await readSuccessorRoleProof();if(hash(role)!==proof.intent.roleProofDigest)fail();return true;}
