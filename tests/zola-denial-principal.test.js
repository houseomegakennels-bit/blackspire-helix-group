import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {DENIAL_PRINCIPAL,prepareDenialPrincipal} from '../packages/zola-six-reads/denial-principal.js';
const issuedAt=Date.now()-10000;
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE auth_principals(id TEXT PRIMARY KEY,type TEXT,actor_id TEXT,authentication_method TEXT,credential_reference TEXT,status TEXT,issued_at INTEGER,expires_at INTEGER,revoked_at INTEGER,disabled_at INTEGER,security_version INTEGER,created_at INTEGER);
 CREATE TABLE auth_workspace_grants(principal_id TEXT,status TEXT);
 CREATE TABLE sessions(id TEXT,principal_id TEXT);
 INSERT INTO auth_principals VALUES('existing','admin','existing','bearer',NULL,'active',1,NULL,NULL,NULL,1,1);
 INSERT INTO auth_workspace_grants VALUES('existing','active');`);
 const before=JSON.stringify(db.prepare('SELECT * FROM auth_principals').all());
 const prepare=assertHost=>prepareDenialPrincipal(db,{issuedAt},{assertHost:assertHost??(()=>{})});
 return{db,before,prepare};
}
test('creates only fixed active no-grant principal and exact rerun changes nothing',()=>{
 const f=fixture();try{
  assert.equal(f.prepare().status,'DENIAL_PRINCIPAL_CREATED');
  const row=f.db.prepare('SELECT * FROM auth_principals WHERE id=?').get(DENIAL_PRINCIPAL);
  assert.equal(row.type,'admin');assert.equal(row.status,'active');assert.equal(row.authentication_method,'bearer');assert.equal(row.credential_reference,null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM auth_workspace_grants WHERE principal_id=?').get(DENIAL_PRINCIPAL).n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
  assert.equal(JSON.stringify(f.db.prepare("SELECT * FROM auth_principals WHERE id='existing'").all()),f.before);
  const before=f.db.prepare('SELECT total_changes() n').get().n;
  assert.equal(f.prepare().status,'DENIAL_PRINCIPAL_VERIFIED');assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
 }finally{f.db.close();}
});
test('existing identity, lifecycle, credential and creation-time drift are rejected without repair',()=>{
 for(const [column,value] of [['type','service'],['status','disabled'],['actor_id','other'],['authentication_method','service'],['credential_reference','other'],['security_version',2],['issued_at',issuedAt-1],['created_at',issuedAt-1],['expires_at',issuedAt+100000],['revoked_at',issuedAt],['disabled_at',issuedAt]]){
  const f=fixture();try{f.prepare();f.db.prepare(`UPDATE auth_principals SET ${column}=? WHERE id=?`).run(value,DENIAL_PRINCIPAL);
   const before=JSON.stringify(f.db.prepare('SELECT * FROM auth_principals').all());assert.throws(()=>f.prepare());assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM auth_principals').all()),before);
  }finally{f.db.close();}
 }
});
test('any prior grant or session blocks creation and rerun without deleting evidence',()=>{
 for(const existing of [false,true])for(const kind of ['active','revoked','session']){
  const f=fixture();try{if(existing)f.prepare();
   if(kind==='session')f.db.prepare('INSERT INTO sessions VALUES(?,?)').run('old',DENIAL_PRINCIPAL);
   else f.db.prepare('INSERT INTO auth_workspace_grants VALUES(?,?)').run(DENIAL_PRINCIPAL,kind);
   assert.throws(()=>f.prepare());assert.equal(f.db.prepare('SELECT count(*) n FROM auth_principals WHERE id=?').get(DENIAL_PRINCIPAL).n,existing?1:0);
  }finally{f.db.close();}
 }
});
test('host drift before commit rolls creation back; alias and trigger conflicts fail closed',()=>{
 const f=fixture();try{let checks=0;assert.throws(()=>f.prepare(()=>{if(++checks===2)throw new Error('changed inode');}));assert.equal(f.db.prepare('SELECT count(*) n FROM auth_principals').get().n,1);
  f.db.prepare("UPDATE auth_principals SET actor_id=? WHERE id='existing'").run(DENIAL_PRINCIPAL);assert.throws(()=>f.prepare());
  f.db.exec("UPDATE auth_principals SET actor_id='existing'; CREATE TRIGGER unsafe AFTER INSERT ON auth_principals BEGIN INSERT INTO auth_workspace_grants VALUES(NEW.id,'active'); END;");
  assert.throws(()=>f.prepare());assert.equal(f.db.prepare('SELECT count(*) n FROM auth_workspace_grants').get().n,1);
 }finally{f.db.close();}
});
test('CLI fixes production path and identity while requiring root, pinned Node and stopped services',()=>{
 const source=fs.readFileSync(new URL('../scripts/zola-prepare-denial-principal.js',import.meta.url),'utf8');
 assert.match(source,/const DATABASE='\/opt\/blackspire-command\/shared\/database\/command.sqlite'/);
 assert.match(source,/process.getuid/);assert.match(source,/process.geteuid/);assert.match(source,/22\.23\.1/);
 assert.match(source,/ActiveState=inactive\\nMainPID=0/);assert.match(source,/findMissingSchemaObjects/);
 assert.doesNotMatch(source,/process\.env|provision-authz|INSERT INTO auth_workspace_grants|createSession/);
});
