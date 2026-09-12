import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zola-denial-session-'));
const database=path.join(directory,'isolated.sqlite');
process.env.BLACKSPIRE_DB_PATH=database;process.env.SESSION_TTL_MS='900000';
process.env.NODE_ENV='test';process.env.COMMAND_ADMIN_TOKEN='isolated-delegation-api-token-0000';
process.env.SESSION_SECRET='isolated-delegation-session-signing-0000';process.env.ALLOW_BEARER_AUTH='true';
process.env.BLACKSPIRE_OPERATOR_PRINCIPAL_ID='operator';
const {prepareDisposableDatabase}=await import('./helpers/prepare-disposable-database.js');prepareDisposableDatabase(database);
const {openDelegatedSessionService}=await import('../packages/zola-six-reads/denial-session.js');
const service=await openDelegatedSessionService(database);
const db=await import('../packages/task-engine/db.js');
const sessions=await import('../packages/shared/sessions.js');
const auth=await import('../packages/shared/authorization.js');
const now=Date.now()-100;
for(const [principal,status,method,type] of [['operator','active','bearer','admin'],['denied-reader','active','bearer','admin'],['disabled-reader','disabled','bearer','admin'],['service-reader','active','service','service']])
 db.run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[principal,type,principal+'-actor',method,'fixture-reference',status,now,null,null,status==='disabled'?now:null,1,now]);
let count=0;
const input=()=>({operatorPrincipal:'operator',deniedPrincipal:'denied-reader',workspace:'protected-workspace',runId:`isolated-${++count}`,releaseSha:'a'.repeat(40)});
test.after(()=>{service.close();fs.rmSync(directory,{recursive:true,force:true});});
test('shared session is bounded, bound to existing admin, unauthorised for all workspaces; audit has no credentials',()=>{
 const selected=input();let receipt;
 const result=service.issue(selected,value=>{receipt=value;
  const separate=new DatabaseSync(database,{readOnly:true});try{assert.equal(separate.prepare('SELECT count(*) AS n FROM sessions WHERE id=?').get(value.sessionId).n,0,'publication happens before SQL commit');}finally{separate.close();}
 });
 assert.equal(result.livePass,false);assert.ok(receipt.expiresAt-receipt.createdAt<=900000);
 const session=sessions.getSession(receipt.sessionId);assert.equal(session.principalId,'denied-reader');
 const principal=auth.resolveBoundSession(session);assert.equal(auth.requireWorkspacePermission(principal,'protected-workspace','task.read').allowed,false);
 assert.equal(auth.requireWorkspacePermission(principal,'unrelated-workspace','task.read').allowed,false);
 const audit=JSON.stringify(db.all('SELECT * FROM audit_events'));assert.ok(!audit.includes(receipt.sessionId));assert.ok(!audit.includes(session.csrfToken));assert.ok(!JSON.stringify(result).includes(receipt.sessionId));
 assert.equal(service.revoke(receipt).status,'DELEGATED_DENIAL_REVOKED');assert.equal(sessions.getSession(receipt.sessionId),null);
});
test('failed protected publication rolls back session and audit; no lost session is issued',()=>{
 const selected=input();let receipt;
 assert.throws(()=>service.issue(selected,value=>{receipt=value;throw new Error('disk failed');}));
 assert.equal(db.get('SELECT * FROM sessions WHERE id=?',[receipt.sessionId]),null);
 assert.equal(db.get("SELECT count(*) AS n FROM audit_events WHERE json_extract(details,'$.runId')=?",[selected.runId]).n,0);
});
test('same principal, absent/disabled/service principal, extra fields and bad operator are denied without publication',()=>{
 for(const change of [{deniedPrincipal:'operator'},{deniedPrincipal:'missing'},{deniedPrincipal:'disabled-reader'},{deniedPrincipal:'service-reader'},{operatorPrincipal:'missing'},{authenticated:true}]){
  let published=false;assert.throws(()=>service.issue({...input(),...change},()=>{published=true;}),/REJECTED/);assert.equal(published,false);
 }
});
test('any active grant in unrelated workspace refuses issuance; no grant is changed',()=>{
 db.run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',['unrelated-grant','denied-reader','unrelated-workspace','viewer','["task.read"]','active',1,null,now,null,null,'operator',1,now]);
 try{assert.throws(()=>service.issue(input(),()=>assert.fail('must not publish')),/REJECTED/);assert.equal(db.get('SELECT status FROM auth_workspace_grants WHERE id=?',['unrelated-grant']).status,'active');}
 finally{db.run('DELETE FROM auth_workspace_grants WHERE id=?',['unrelated-grant']);}
});
test('same run refuses duplicate issue and revoke binds exact original receipt',()=>{
 const selected=input();let receipt;service.issue(selected,r=>{receipt=r;});
 assert.throws(()=>service.issue(selected,()=>assert.fail('must not reissue')),/REJECTED/);
 for(const change of [{deniedPrincipal:'operator'},{operatorPrincipal:'other'},{releaseSha:'b'.repeat(40)},{sessionId:'0'.repeat(48)},{expiresAt:receipt.expiresAt+1},{marker:'other'},{workspace:'other'}])assert.throws(()=>service.revoke({...receipt,...change}),/REJECTED/);
 service.revoke(receipt);
});
test('rotation never extends delegation TTL and targeted revoke revokes original plus rotation only',()=>{
 let receipt;service.issue(input(),r=>{receipt=r;});
 const unrelated=sessions.createSession({principalId:'denied-reader'});
 const rotated=sessions.rotateSession(receipt.sessionId);assert.ok(rotated);assert.ok(rotated.expiresAt<=receipt.expiresAt);
 assert.equal(service.revoke(receipt).revokedCount,2);assert.equal(sessions.getSession(rotated.sessionId),null);assert.ok(sessions.getSession(unrelated.sessionId));sessions.destroySession(unrelated.sessionId);
});
test('canonical host CLI refuses real non-root uid before configuration/network/mutation',()=>{
 const result=spawnSync(process.execPath,['scripts/zola-denial-session.js','--issue','/does/not/exist'],{cwd:process.cwd(),encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin'},...(process.getuid()===0?{uid:65534,gid:65534}:{})});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/Delegated denial session stopped/);
});
test('session service refuses a changed database configuration',async()=>{await assert.rejects(openDelegatedSessionService('/other/database'),/REJECTED/);});

test('v4 read-only collector verifies issued receipt against DB inode/audit/session and rejects forgeries before admission',async()=>{
 const {openCollectorDatabaseReader}=await import('../packages/zola-six-reads/collector-host.js');
 const {collectSixReads}=await import('../packages/zola-six-reads/collector.js');
 const selected=input();let original;service.issue(selected,r=>{original=r;});
 const stat=fs.statSync(database),receipt={...original,databaseIdentity:{dev:stat.dev,ino:stat.ino,uid:stat.uid}};
 const config={version:4,releaseSha:selected.releaseSha,runId:selected.runId,workspace:selected.workspace,principal:selected.operatorPrincipal,deniedPrincipal:selected.deniedPrincipal,
  databasePath:database,denialReceiptPath:'/protected/receipt',observerDatabaseConfigPath:'/protected/observer',dealId:'DE-0001'};
 const reader=openCollectorDatabaseReader(config);
 try{
  reader.verifyDenialReceipt(receipt);
  for(const mutate of [r=>r.releaseSha='b'.repeat(40),r=>r.deniedPrincipal='operator',r=>r.runId='other',r=>r.workspace='other',r=>r.databaseIdentity.ino++,r=>r.expiresAt=Date.now()-1,r=>r.sessionId='0'.repeat(48),r=>r.marker='invented',r=>r.extra=true]){
   const bad=structuredClone(receipt);mutate(bad);let admissions=0;const events=[];
   const host={generation:async()=>({apiGeneration:'api',workerGeneration:'worker'}),deniedIdentity:async()=>reader.verifyDenialReceipt(bad),admit:async()=>{admissions++;}};
   await assert.rejects(collectSixReads(config,host,{events:()=>structuredClone(events),append:e=>events.push(e)}));assert.equal(admissions,0);
  }
  db.run("UPDATE audit_events SET details=json_set(details,'$.sessionDigest','wrong') WHERE action='auth.delegated-denial.issued' AND json_extract(details,'$.runId')=?",[selected.runId]);
  assert.throws(()=>reader.verifyDenialReceipt(receipt),/AUDIT_REJECTED/);
 }finally{reader.close();sessions.destroySession(receipt.sessionId);}
});

test('core-issued delegation crosses actual API authentication and collector task-disclosure denial with read-only receipt verification',async()=>{
 const {openCollectorDatabaseReader,createCollectorHttpBoundary}=await import('../packages/zola-six-reads/collector-host.js');
 const {upsertWorkspace}=await import('../packages/workspace-registry/workspaces.js');
 const {createTask}=await import('../packages/task-engine/tasks.js');
 const {start}=await import('../apps/api/server.js');
 const selected=input();let original;
 service.issue(selected,r=>{original=r;}); // Never insert or directly create the denied session.
 const stat=fs.statSync(database),receipt={...original,databaseIdentity:{dev:stat.dev,ino:stat.ino,uid:stat.uid}};
 upsertWorkspace({id:selected.workspace,name:'isolated delegation',githubRepository:'local/fixture',defaultBranch:'main',allowedPaths:['docs'],buildCommands:[],providerPolicy:{},riskLevel:'low',budgetCents:0,secretReferences:[],enabledTools:['read'],lastHealthStatus:'ok',rootPath:directory});
 db.run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',['delegation-operator-grant','operator',selected.workspace,'service','["task.read","workspace.read"]','active',1,null,now,null,null,'operator',1,now]);
 const task=createTask({workspaceId:selected.workspace,actorId:'operator',request:'isolated stored task',idempotencyKey:'delegation-http-task',initialStatus:'completed'});
 db.run("UPDATE tasks SET evidence='{}' WHERE id=?",[task.id]);task.evidence='{}';
 const server=start(0,'127.0.0.1',{exitOnListenError:false});await new Promise(resolve=>server.once('listening',resolve));
 const config={version:4,port:server.address().port,releaseSha:selected.releaseSha,runId:selected.runId,workspace:selected.workspace,principal:'operator',deniedPrincipal:'denied-reader',databasePath:database};
 const reader=openCollectorDatabaseReader(config),http=createCollectorHttpBoundary(config,{bearer:process.env.COMMAND_ADMIN_TOKEN,deniedCookie:receipt.deniedCookie});
 let receiptChecks=0;
 const host={...http,async deniedIdentity(){reader.verifyDenialReceipt(receipt);receiptChecks++;await http.deniedIdentity();}};
 try{
  await host.deniedIdentity();
  await host.disclosure(task);
  assert.equal(receiptChecks,3,'receipt revalidated before and after real API foreign disclosure');
  assert.equal(db.get("SELECT count(*) AS n FROM auth_workspace_grants WHERE principal_id='denied-reader'").n,0);
  service.revoke(receipt);
  await assert.rejects(host.deniedIdentity(),/DELEGATED_DENIAL_SESSION_REJECTED/);
  await assert.rejects(http.deniedIdentity(),/DENIAL_PRINCIPAL_UNAVAILABLE/,'actual HTTP authentication also rejects revoked delegation');
 }finally{reader.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
