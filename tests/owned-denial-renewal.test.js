import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {RENEWAL,renewalHash as hash,assertRenewalStart,assertOriginalDenial,verifyRenewedDenial,openRenewalService} from '../packages/zola-six-reads/owned-denial-renewal.js';
import {transformRenewalSource} from '../packages/zola-six-reads/owned-denial-loader.js';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'owned-denial-renewal-')),database=path.join(directory,'isolated.sqlite');
Object.assign(process.env,{BLACKSPIRE_DB_PATH:database,SESSION_TTL_MS:'900000',NODE_ENV:'test',COMMAND_ADMIN_TOKEN:'isolated-renewal-admin-0000',SESSION_SECRET:'isolated-renewal-signing-0000',ALLOW_BEARER_AUTH:'true',BLACKSPIRE_OPERATOR_PRINCIPAL_ID:'operator'});
const {prepareDisposableDatabase}=await import('./helpers/prepare-disposable-database.js');prepareDisposableDatabase(database);
const db=await import('../packages/task-engine/db.js');
const {openDelegatedSessionService}=await import('../packages/zola-six-reads/denial-session.js');
const canonical=await openDelegatedSessionService(database);
const {cleanupExpiredSessions}=await import('../packages/shared/sessions.js');
const old=Date.now()-1800000;
for(const id of ['operator','denied'])db.run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[id,'admin',id+'-actor','bearer','fixture-reference','active',old-1,null,null,null,1,old-1]);
let n=0;
function fixture(){
 const input={operatorPrincipal:'operator',deniedPrincipal:'denied',workspace:'isolated',runId:'renewal-fixture-'+(++n),releaseSha:'a'.repeat(40)};
 let original;const now=Date.now;Date.now=()=>old;try{canonical.issue(input,r=>{original=r;});}finally{Date.now=now;}
 cleanupExpiredSessions();
 const st=fs.statSync(database),identity={dev:st.dev,ino:st.ino,uid:st.uid};original={...original,databaseIdentity:identity};
 const config={version:6,releaseSha:input.releaseSha,runId:input.runId,workspace:input.workspace,principal:input.operatorPrincipal,deniedPrincipal:input.deniedPrincipal,databasePath:database};
 const policy={...RENEWAL,configDigest:hash(config),originalReceiptDigest:hash(original),originalSessionDigest:hash(original.sessionId),releaseSha:input.releaseSha,runId:input.runId,attemptId:'fixture-attempt-'+n};
 const intent={version:1,kind:'owned-denial-renewal-intent',originalOutcome:policy.originalOutcome,operatorSha:'b'.repeat(40),configDigest:policy.configDigest,originalReceiptDigest:policy.originalReceiptDigest,operationId:policy.operationId,attemptId:policy.attemptId,inputDigest:policy.inputDigest,checkOutputDigest:policy.checkOutputDigest,profileDigest:'c'.repeat(64),createdAt:Date.now()};
 return {original,config,identity,policy,intent};
}
function evidence(f,receipt){return {
 original:f.original,originalSession:db.get('SELECT * FROM sessions WHERE id=?',[f.original.sessionId]),originalFamily:db.all('SELECT * FROM sessions WHERE user_agent=?',[f.original.marker]),
 originalAudits:db.all("SELECT actor,details FROM audit_events WHERE action='auth.delegated-denial.issued' AND json_extract(details,'$.runId')=?",[f.config.runId]),
 session:db.get('SELECT * FROM sessions WHERE id=?',[receipt.sessionId]),renewedFamily:db.all('SELECT * FROM sessions WHERE user_agent=?',[receipt.marker]),
 audits:db.all("SELECT actor,details FROM audit_events WHERE action=? AND json_extract(details,'$.runId')=?",[RENEWAL.action,f.config.runId]),activeGrants:0,intent:f.intent,
 result:{version:1,kind:'owned-denial-renewal-result',intentDigest:hash(f.intent),receiptDigest:hash(receipt),expiresAt:receipt.expiresAt}};}
test.after(()=>{canonical.close();fs.rmSync(directory,{recursive:true,force:true});});
test('renewal explicitly classifies absent expired original and retains original receipt/audit, commits only after exclusive receipt publication, uses distinct bounded session and audit',async()=>{
 const f=fixture(),service=await openRenewalService(database,{policy:f.policy});
 const before=db.get('SELECT * FROM sessions WHERE id=?',[f.original.sessionId]);let receipt;
 service.issue(f,r=>{receipt=r;const separate=new DatabaseSync(database,{readOnly:true});try{assert.equal(separate.prepare('SELECT count(*) AS n FROM sessions WHERE id=?').get(r.sessionId).n,0);}finally{separate.close();}});
 assert.deepEqual(db.get('SELECT * FROM sessions WHERE id=?',[f.original.sessionId]),before);
 assert.equal(receipt.authentication,RENEWAL.authentication);assert.notEqual(receipt.sessionId,f.original.sessionId);assert.ok(receipt.expiresAt-receipt.createdAt<=900000);
 assert.equal(verifyRenewedDenial(receipt,f.config,f.identity,evidence(f,receipt),f.policy),true);
 assert.throws(()=>service.issue(f,()=>assert.fail('duplicate issuance')));
 assert.equal(db.get("SELECT count(*) AS n FROM audit_events WHERE action='auth.delegated-denial.issued' AND json_extract(details,'$.runId')=?",[f.config.runId]).n,1);
 assert.ok(!JSON.stringify(db.all('SELECT * FROM audit_events')).includes(receipt.sessionId));
});
test('publication failure rolls back new session/audit while external receipt and intent remain evidence, no canonical duplicate issuance',async()=>{
 const f=fixture(),service=await openRenewalService(database,{policy:f.policy});let retained;
 assert.throws(()=>service.issue(f,r=>{retained=r;throw Error('disk failure');}));
 assert.equal(db.get('SELECT * FROM sessions WHERE id=?',[retained.sessionId]),null);
 assert.equal(db.get("SELECT count(*) AS n FROM audit_events WHERE action=? AND json_extract(details,'$.runId')=?",[RENEWAL.action,f.config.runId]).n,0);
 assert.throws(()=>canonical.issue({operatorPrincipal:f.config.principal,deniedPrincipal:f.config.deniedPrincipal,workspace:f.config.workspace,runId:f.config.runId,releaseSha:f.config.releaseSha},()=>assert.fail('old issue duplicate')));
});
test('renewal proof rejects provenance, expiry, profile syntax, session family, old audit and identity drift',async()=>{
 const f=fixture(),service=await openRenewalService(database,{policy:f.policy});const receipt=service.issue(f,()=>{}),ev=evidence(f,receipt);
 for(const mutate of [x=>x.receipt.authentication='root-delegated-existing-principal',x=>x.receipt.expiresAt=x.receipt.createdAt+900001,x=>x.receipt.originalReceiptDigest='0'.repeat(64),x=>x.ev.now=x.receipt.expiresAt,x=>x.ev.intent.inputDigest='d'.repeat(64),x=>x.ev.intent.checkOutputDigest='d'.repeat(64),x=>x.ev.intent.profileDigest='wrong',x=>x.ev.renewedFamily.push(x.ev.session),x=>x.ev.originalSession=x.ev.session,x=>x.ev.originalFamily=[x.ev.session],x=>x.ev.originalAudits=[],x=>x.ev.audits[0].actor='other',x=>x.ev.activeGrants=1,x=>x.ev.session.revoked_at=Date.now(),x=>x.identity.ino++]){
  const x=structuredClone({receipt,ev,identity:f.identity});mutate(x);assert.throws(()=>verifyRenewedDenial(x.receipt,f.config,x.identity,x.ev,f.policy));
 }
});
test('start refuses collector or permit effects, wrong pending stage/digest, config and old receipt changes',()=>{
 const f=fixture(),state={context:{releaseSha:f.policy.releaseSha,operationId:f.policy.operationId},nextOrdinal:13,pending:{stage:'six_reads',attemptId:f.policy.attemptId,inputDigest:f.policy.inputDigest,checkOutputDigest:f.policy.checkOutputDigest},outputs:{admission_lease:{epochRunId:f.policy.runId},n8n_migration:{stage:'n8n_migration'}}};
 const good={config:f.config,original:f.original,state,events:[],collectorEmpty:true,permitAbsent:true};assert.equal(assertRenewalStart(good,f.policy),true);
 for(const mutate of [x=>x.collectorEmpty=false,x=>x.permitAbsent=false,x=>x.events.push({type:'premerge_reads_intent'}),x=>x.state.pending.stage='other',x=>x.state.pending.checkOutputDigest='0'.repeat(64),x=>x.config.version=4,x=>x.original.expiresAt=Date.now()+1]){const x=structuredClone(good);mutate(x);assert.throws(()=>assertRenewalStart(x,f.policy));}
});
test('active grants and disabled principal refuse renewal before publication',async()=>{
 const f=fixture(),service=await openRenewalService(database,{policy:f.policy});
 db.run("UPDATE auth_principals SET status='disabled',disabled_at=? WHERE id='denied'",[Date.now()]);
 try{assert.throws(()=>service.issue(f,()=>assert.fail('published disabled principal')));}finally{db.run("UPDATE auth_principals SET status='active',disabled_at=NULL WHERE id='denied'");}
 db.run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',['renewal-grant','denied','unrelated','viewer','["task.read"]','active',1,null,old,null,null,'operator',1,old]);
 try{assert.throws(()=>service.issue(f,()=>assert.fail('published granted principal')));}finally{db.run("DELETE FROM auth_workspace_grants WHERE id='renewal-grant'");}
});
test('exact source transformations add only explicit child bootstrap and renewed receipt lane',()=>{
 for(const [kind,file] of [['held','packages/zola-release/production-held-operations.js'],['collector','packages/zola-six-reads/collector-host.js']]){
  const source=fs.readFileSync(file,'utf8'),result=transformRenewalSource(kind,source);assert.notEqual(result,source);assert.throws(()=>transformRenewalSource(kind,source+' '));
  if(kind==='held'){assert.match(result,/premerge\?\['--import'/);assert.match(result,/env:\{PATH:'\/usr\/bin:\/bin',LC_ALL:'C'\}/);}
  else{assert.match(result,/config.version===6 \? selectRenewalReceipt/);assert.ok(result.includes(source.slice(source.indexOf('export function verifyCollectorDenialReceipt'))),'ordinary verifier preserved byte-for-byte');}
  const checked=spawnSync(process.execPath,['--input-type=module','--check'],{input:result,encoding:'utf8'});assert.equal(checked.status,0,checked.stderr);
 }
});
test('invalid CLI arguments fail before protected source or runtime reads',()=>{
 const result=spawnSync(process.execPath,['scripts/zola-owned-denial-renew.js','--invalid'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/renewal stopped/);
});

test('real loader composition imports exact canonical native modules without invoking release or credential reads',()=>{
 const code=`import {register} from 'node:module';
 register('file://${RENEWAL.root}/packages/zola-six-reads/owned-denial-loader.js');
 register('file://${RENEWAL.root}/packages/zola-release/owned-six-read-loader.js');
 const p=await import('${RENEWAL.canonicalRoot}/packages/zola-release/premerge-read-permit.js');
 const h=await import('${RENEWAL.canonicalRoot}/packages/zola-release/production-held-operations.js');
 if(!p.runPremergeReadPermit.toString().includes('selectRenewalReceipt(config)')||typeof h.createHeldProductionOperations!=='function')throw Error('composition');
 console.log('COMPOSED');`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:15000,env:{PATH:'/usr/bin:/bin',NODE_ENV:'test'}});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'COMPOSED\n');
});

test('malformed stage-bound intent rolls back before protected publication',async()=>{
 const f=fixture(),service=await openRenewalService(database,{policy:f.policy});
 assert.throws(()=>service.issue({...f,intent:{...f.intent,inputDigest:'0'.repeat(64)}},()=>assert.fail('published malformed intent')));
 assert.equal(db.get('SELECT count(*) AS n FROM sessions WHERE user_agent=?',[`zola-denial-renewal:${f.policy.attemptId}`]).n,0);
});
