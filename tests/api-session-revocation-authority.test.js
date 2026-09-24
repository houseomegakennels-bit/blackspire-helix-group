import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackspire-revocation-authority-'));
process.env.BLACKSPIRE_DB_PATH=path.join(root,'command.sqlite');
process.env.COMMAND_ADMIN_TOKEN='revocation-authority-test-token';
process.env.SESSION_SECRET='revocation-authority-test-session-secret-not-real';
process.env.ALLOW_BEARER_AUTH='true';
process.env.BLACKSPIRE_OPERATOR_PRINCIPAL_ID='canonical-operator';
const {prepareDisposableDatabase}=await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const {run,all,closeDb}=await import('../packages/task-engine/db.js');
const {createSession,getSession}=await import('../packages/shared/sessions.js');
const now=Date.now();
for(const principal of ['canonical-operator','distinct-principal'])run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
 [principal,'admin',principal,'bearer',null,'active',now,null,null,null,1,now]);
const {start}=await import('../apps/api/server.js');
const server=start(0,'127.0.0.1',{exitOnListenError:false});
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
test.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));closeDb();fs.rmSync(root,{recursive:true,force:true});});
const post=session=>fetch(base+'/api/auth/revoke-all',{method:'POST',headers:{cookie:`bc_session=${session.sessionId}`,'x-csrf-token':session.csrfToken}});
const snapshot=()=>({sessions:all('SELECT * FROM sessions ORDER BY id'),flags:all('SELECT * FROM system_flags ORDER BY key'),
 audits:all('SELECT * FROM audit_events ORDER BY id'),tasks:all('SELECT * FROM tasks ORDER BY id'),inputs:all('SELECT * FROM unified_inputs ORDER BY id')});

test('disabled test-mode helpers refuse all authenticated identities before body parsing or global mutation',async()=>{
 const mode=await (await fetch(base+'/api/test-mode')).json();assert.equal(mode.enabled,false);
 for(const principalId of ['canonical-operator','distinct-principal']){
  const session=createSession({principalId});
  for(const endpoint of ['delivery-failure','queued-task','telegram-input'])for(const body of ['{',JSON.stringify({attempts:3,updateId:'test-id',text:'Show seller opportunities'})]){
   const before=snapshot();
   const response=await fetch(base+`/api/test-mode/${endpoint}`,{method:'POST',headers:{cookie:`bc_session=${session.sessionId}`,
    'x-csrf-token':session.csrfToken,'content-type':'application/json'},body});
   assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'not found'});assert.deepEqual(snapshot(),before);
  }
 }
});

test('distinct authenticated principal with valid CSRF cannot revoke another session or alter the global fence',async()=>{
 const owner=createSession({principalId:'canonical-operator'}),foreign=createSession({principalId:'distinct-principal'});
 const identity=await fetch(base+'/api/auth/session',{headers:{cookie:`bc_session=${foreign.sessionId}`}});
 const body=await identity.json();assert.equal(body.authenticated,true);assert.equal(body.principalId,'distinct-principal');
 const before=snapshot();const result=await post(foreign);
 assert.equal(result.status,404);assert.deepEqual(await result.json(),{error:'not found'});
 assert.deepEqual(snapshot(),before);assert.ok(getSession(owner.sessionId));assert.ok(getSession(foreign.sessionId));
});
test('unbound or revoked operator authority cannot cause global revocation',async()=>{
 for(const principalId of [null,'canonical-operator']){
  const session=createSession({principalId});
  if(principalId)run("UPDATE auth_principals SET status='revoked',revoked_at=? WHERE id=?",[Date.now(),principalId]);
  try{const before=snapshot();assert.equal((await post(session)).status,404);assert.deepEqual(snapshot(),before);}
  finally{if(principalId)run("UPDATE auth_principals SET status='active',revoked_at=NULL WHERE id=?",[principalId]);}
 }
});
test('currently authorized canonical operator retains global revocation',async()=>{
 const owner=createSession({principalId:'canonical-operator'}),foreign=createSession({principalId:'distinct-principal'});
 assert.equal((await post(owner)).status,200);
 assert.equal(getSession(owner.sessionId),null);assert.equal(getSession(foreign.sessionId),null);
 assert.equal(all("SELECT * FROM system_flags WHERE key='sessions_revoked_before'").length,1);
});
