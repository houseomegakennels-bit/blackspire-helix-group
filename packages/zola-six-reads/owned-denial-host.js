import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {OWNED_SIX_READ} from '../zola-release/owned-six-read-overlay.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {RENEWAL,renewalHash,renewalFail,assertRenewalConfig,assertOriginalDenial,verifyRenewedDenial} from './owned-denial-renewal.js';
export const readRenewalJson=file=>readRootOwnedJson(file,{groupId:0,maxBytes:65536});
export function checkRenewalSource(expected){
 const env={PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_NO_REPLACE_OBJECTS:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'};
 const git=(root,args)=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',root,...args],{env,encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe']}).trim();
 if(fs.realpathSync(RENEWAL.root)!==RENEWAL.root||git(RENEWAL.root,['status','--porcelain','--untracked-files=all'])!=='')renewalFail();
 git(RENEWAL.root,['merge-base','--is-ancestor',RENEWAL.baseSha,'HEAD']);
 const sha=git(RENEWAL.root,['rev-parse','HEAD']);if(sha===RENEWAL.baseSha||expected&&sha!==expected)renewalFail();
 if(git(RENEWAL.canonicalRoot,['rev-parse','HEAD'])!==RENEWAL.releaseSha||git(RENEWAL.canonicalRoot,['status','--porcelain','--untracked-files=all'])!=='')renewalFail();
 if(fs.realpathSync(OWNED_SIX_READ.frozenRoot)!==OWNED_SIX_READ.frozenRoot||git(OWNED_SIX_READ.frozenRoot,['rev-parse','HEAD'])!==OWNED_SIX_READ.frozenSha||git(OWNED_SIX_READ.frozenRoot,['status','--porcelain','--untracked-files=all'])!=='')renewalFail();
 return sha;
}
export function readRenewalProof(config){
 assertRenewalConfig(config);
 const intent=readRenewalJson(RENEWAL.prefix+'-intent.json'),result=readRenewalJson(RENEWAL.prefix+'-result.json'),receipt=readRenewalJson(RENEWAL.prefix+'-receipt.json');
 checkRenewalSource(intent.operatorSha);
 if(receipt.intentDigest!==renewalHash(intent)||result.intentDigest!==renewalHash(intent)||result.receiptDigest!==renewalHash(receipt))renewalFail();
 return {intent,result,receipt,original:readRenewalJson(config.denialReceiptPath)};
}
export function verifyRenewalDatabase(receipt,config,identity){
 const proof=readRenewalProof(config);if(renewalHash(receipt)!==renewalHash(proof.receipt))renewalFail();
 const db=new DatabaseSync(config.databasePath,{readOnly:true});db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000;BEGIN');
 try{
  const stat=fs.lstatSync(config.databasePath);if(stat.isSymbolicLink()||['dev','ino','uid'].some(k=>identity[k]!==stat[k]))renewalFail();
  const original=proof.original;
  verifyRenewedDenial(receipt,config,identity,{...proof,
   session:db.prepare('SELECT * FROM sessions WHERE id=?').get(receipt.sessionId),originalSession:db.prepare('SELECT * FROM sessions WHERE id=?').get(original.sessionId),
   renewedFamily:db.prepare('SELECT * FROM sessions WHERE user_agent=?').all(receipt.marker),
   originalFamily:db.prepare('SELECT * FROM sessions WHERE user_agent=?').all(original.marker),
   originalAudits:db.prepare("SELECT actor,details FROM audit_events WHERE action='auth.delegated-denial.issued' AND json_extract(details,'$.runId')=?").all(config.runId),
   audits:db.prepare("SELECT actor,details FROM audit_events WHERE action=? AND json_extract(details,'$.runId')=?").all(RENEWAL.action,config.runId),
   activeGrants:db.prepare("SELECT count(*) AS n FROM auth_workspace_grants WHERE principal_id=? AND status='active'").get(config.deniedPrincipal).n});
  const after=fs.lstatSync(config.databasePath);if(after.isSymbolicLink()||['dev','ino','uid'].some(k=>identity[k]!==after[k]))renewalFail();
 }finally{db.exec('ROLLBACK');db.close();}return true;
}
export function selectRenewalReceipt(config){const proof=readRenewalProof(config);verifyRenewalDatabase(proof.receipt,config,fs.lstatSync(config.databasePath));return proof.receipt;}

export function inspectOriginalRenewalDatabase(original,config,identity){
 const db=new DatabaseSync(config.databasePath,{readOnly:true});db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000;BEGIN');
 try{
  const stat=fs.lstatSync(config.databasePath);if(stat.isSymbolicLink()||['dev','ino','uid'].some(k=>stat[k]!==identity[k]))renewalFail();
  assertOriginalDenial({original,config,identity,
   session:db.prepare('SELECT * FROM sessions WHERE id=?').get(original.sessionId),family:db.prepare('SELECT * FROM sessions WHERE user_agent=?').all(original.marker),
   audits:db.prepare("SELECT actor,details FROM audit_events WHERE action='auth.delegated-denial.issued' AND json_extract(details,'$.runId')=?").all(config.runId),
   activeGrants:db.prepare("SELECT count(*) AS n FROM auth_workspace_grants WHERE principal_id=? AND status='active'").get(config.deniedPrincipal).n});
  if(db.prepare("SELECT count(*) AS n FROM audit_events WHERE action=? AND json_extract(details,'$.runId')=?").get(RENEWAL.action,config.runId).n!==0
   ||db.prepare('SELECT count(*) AS n FROM sessions WHERE user_agent=?').get(`zola-denial-renewal:${RENEWAL.attemptId}`).n!==0)renewalFail();
  for(const id of [config.principal,config.deniedPrincipal]){
   const p=db.prepare('SELECT * FROM auth_principals WHERE id=?').get(id);
   if(!p||p.type!=='admin'||p.authentication_method!=='bearer'||p.status!=='active'||p.revoked_at!==null||p.disabled_at!==null||(p.expires_at!==null&&p.expires_at<=Date.now()))renewalFail();
  }
 }finally{db.exec('ROLLBACK');db.close();}return true;
}
