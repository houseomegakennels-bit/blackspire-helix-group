import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {RENEWAL,renewalHash as hash,renewalAuditDetails} from '../packages/zola-six-reads/owned-denial-renewal.js';
import {DENIAL_SUCCESSOR,assertExpiredRenewalLineage,verifySuccessorDenial,successorAuditDetails,publishBeforeCommit} from '../packages/zola-six-reads/owned-denial-successor.js';
const row=r=>({id:r.sessionId,principal_id:r.deniedPrincipal,created_at:r.createdAt,expires_at:r.expiresAt,user_agent:r.marker,ip:'root-local-delegation',revoked_at:null});
function fixture(){
 const config={releaseSha:RENEWAL.releaseSha,runId:RENEWAL.runId,workspace:'workspace',principal:'operator',deniedPrincipal:'denied'},identity={dev:1,ino:2,uid:0};
 const original={version:1,authentication:'root-delegated-existing-principal',operatorPrincipal:config.principal,deniedPrincipal:config.deniedPrincipal,workspace:config.workspace,runId:config.runId,releaseSha:config.releaseSha,
 sessionId:'a'.repeat(48),deniedCookie:'bc_session='+ 'a'.repeat(48),createdAt:1000000,expiresAt:1900000,marker:'original',databaseIdentity:identity};
 const renewalPolicy={...RENEWAL,configDigest:hash(config),originalReceiptDigest:hash(original),originalSessionDigest:hash(original.sessionId)};
 const oldIntent={operatorSha:'30fcdaa81c8f6fb070cc0f5ec67e597ecd17330a'},old={...original,version:2,authentication:RENEWAL.authentication,sessionId:'b'.repeat(48),deniedCookie:'bc_session='+ 'b'.repeat(48),createdAt:2000000,expiresAt:2900000,
 marker:`zola-denial-renewal:${RENEWAL.attemptId}`,intentDigest:hash(oldIntent),originalReceiptDigest:hash(original)};
 const oldResult={intentDigest:hash(oldIntent),receiptDigest:hash(old),expiresAt:old.expiresAt};
 const policy={...DENIAL_SUCCESSOR,priorIntentDigest:hash(oldIntent),priorReceiptDigest:hash(old),priorResultDigest:hash(oldResult),priorSessionDigest:hash(old.sessionId)};
 const prior={original,receipt:old,intent:oldIntent,result:oldResult},terminalProof={terminalProofDigest:'c'.repeat(64)};
 const observation={originalSession:null,originalFamily:[],originalAudits:[{actor:config.principal,details:JSON.stringify({runId:config.runId,releaseSha:config.releaseSha,deniedPrincipal:config.deniedPrincipal,workspace:config.workspace,sessionDigest:hash(original.sessionId),expiresAt:original.expiresAt})}],
 priorSession:null,priorFamily:[],priorAudits:[{actor:config.principal,details:JSON.stringify(renewalAuditDetails(old,renewalPolicy))}],activeGrants:0};
 const intent={version:1,kind:'owned-denial-collector-successor-intent',operatorSha:'d'.repeat(40),configDigest:hash(config),operationId:RENEWAL.operationId,attemptId:RENEWAL.attemptId,runId:RENEWAL.runId,originalReceiptDigest:hash(original),
 priorIntentDigest:policy.priorIntentDigest,priorReceiptDigest:policy.priorReceiptDigest,priorResultDigest:policy.priorResultDigest,priorSessionDigest:policy.priorSessionDigest,priorOutcome:'expired-session-absent',profileDigest:'e'.repeat(64),terminalProofDigest:terminalProof.terminalProofDigest,roleProofDigest:'f'.repeat(64),createdAt:3000000};
 const receipt={...original,version:3,authentication:policy.authentication,sessionId:'c'.repeat(48),deniedCookie:'bc_session='+ 'c'.repeat(48),createdAt:3000001,expiresAt:3900000,marker:`zola-denial-collector-successor:${RENEWAL.attemptId}`,intentDigest:hash(intent),priorReceiptDigest:policy.priorReceiptDigest};
 const result={version:1,kind:'owned-denial-collector-successor-result',intentDigest:hash(intent),receiptDigest:hash(receipt),expiresAt:receipt.expiresAt};
 observation.session=row(receipt);observation.family=[row(receipt)];observation.audits=[{actor:config.principal,details:JSON.stringify(successorAuditDetails(receipt))}];
 return {config,identity,prior,observation,proof:{prior,intent,result,terminalProof},receipt,options:{now:3100000,policy,renewalPolicy}};
}
function verify(f){return verifySuccessorDenial(f.receipt,f.config,f.identity,f.proof,f.observation,f.options);}
function refresh(f){f.receipt.intentDigest=hash(f.proof.intent);f.proof.result.intentDigest=hash(f.proof.intent);f.proof.result.receiptDigest=hash(f.receipt);f.proof.result.expiresAt=f.receipt.expiresAt;f.observation.session=row(f.receipt);f.observation.family=[row(f.receipt)];f.observation.audits=[{actor:f.config.principal,details:JSON.stringify(successorAuditDetails(f.receipt))}];}
test('explicit expired absent lineage and 899999ms successor accepted',()=>{const f=fixture();assert.equal(assertExpiredRenewalLineage(f.prior,f.config,f.identity,f.observation,f.options),'expired-session-absent');assert.equal(verify(f),true);});
test('expired present prior can transition only to absent cleanup',()=>{const f=fixture();f.proof.intent.priorOutcome='expired-session-present';f.observation.priorSession=row(f.prior.receipt);f.observation.priorFamily=[row(f.prior.receipt)];refresh(f);assert.equal(verify(f),true);f.observation.priorSession=null;f.observation.priorFamily=[];assert.equal(verify(f),true);f.proof.intent.priorOutcome='expired-session-absent';f.observation.priorSession=row(f.prior.receipt);f.observation.priorFamily=[row(f.prior.receipt)];refresh(f);assert.throws(()=>verify(f));});
test('session over fifteen minutes or expired is rejected',()=>{let f=fixture();f.receipt.expiresAt=f.receipt.createdAt+900001;refresh(f);assert.throws(()=>verify(f));f=fixture();f.options.now=f.receipt.expiresAt;assert.throws(()=>verify(f));});
test('prior lineage byte changes and live prior session reject',()=>{for(const key of ['intent','result','receipt']){const f=fixture();f.prior[key].unexpected=true;assert.throws(()=>verify(f));}const f=fixture();f.options.now=f.prior.receipt.expiresAt-1;assert.throws(()=>verify(f));});
test('grant, session family, audit duplication and inode mismatch reject',()=>{for(const mutate of [f=>f.observation.activeGrants=1,f=>f.observation.family.push(row(f.receipt)),f=>f.observation.priorAudits.push(f.observation.priorAudits[0]),f=>f.observation.audits=[],f=>f.identity.ino=3,f=>f.observation.session.revoked_at=3100000]){const f=fixture();mutate(f);assert.throws(()=>verify(f));}});
test('terminal and intent identity mismatches reject',()=>{for(const key of ['terminalProofDigest','profileDigest','priorReceiptDigest','operationId']){const f=fixture();f.proof.intent[key]='invalid';refresh(f);assert.throws(()=>verify(f));}});
test('durable publication precedes commit and failed publication rolls back session and audit',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE sessions(id TEXT); CREATE TABLE audits(id TEXT)');
 const transaction=fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const build=()=>{db.prepare('INSERT INTO sessions VALUES(?)').run('test');db.prepare('INSERT INTO audits VALUES(?)').run('test');return {receipt:{id:'test'},result:{ok:true}};};
 let observed=false;
 assert.throws(()=>publishBeforeCommit(transaction,build,()=>{assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,1);observed=true;throw Error('durable publication failed');}));
 assert.equal(observed,true);assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM audits').get().n,0);
 const result=publishBeforeCommit(transaction,build,r=>{assert.equal(r.id,'test');assert.equal(db.prepare('SELECT count(*) n FROM audits').get().n,1);});
 assert.equal(result.result.ok,true);assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,1);db.close();
});
