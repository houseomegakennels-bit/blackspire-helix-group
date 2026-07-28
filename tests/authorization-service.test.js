import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'authz-service-')); process.env.BLACKSPIRE_DB_PATH=path.join(root,'a.sqlite');
const { prepareDisposableDatabase }=await import('./helpers/prepare-disposable-database.js'); prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { run,all }=await import('../packages/task-engine/db.js'); const a=await import('../packages/shared/authorization.js');
const now=Date.now(); run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',['p1','admin','admin-1','bearer','admin-ref','active',now,null,null,null,1,now]);
run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',['g1','p1','w1','admin','["runtime.read","task.read"]','active',1,null,now,null,null,'system',1,now]);
test('admin principal is immutable and grant resolves',()=>{const p=a.resolveAdminBearer('p1'); assert.ok(p); assert.throws(()=>{p.actorId='x';}); assert.equal(a.canReadTask(p,'w1').allowed,true); assert.equal(a.canReadTask(p,'w2').allowed,false);});
test('unbound session and unknown principal fail closed; decisions audit',()=>{assert.equal(a.resolveBoundSession({}),null); assert.equal(a.resolveAdminBearer('bad'),null); assert.ok(all('SELECT * FROM auth_decisions').length>=1);});
