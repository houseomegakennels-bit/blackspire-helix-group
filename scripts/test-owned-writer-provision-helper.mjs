import {createBuyerWriterGatewayPostgres} from '../packages/buyer-writer/local-gateway-postgres.js';
import {verifyBuyerWriterProductionEvidence,verifyOwnedBuyerWriterProductionEvidence} from '../packages/buyer-writer/production-verifier.js';
import {observeOwnedAclScoped,verifyOwnedOperatorAclResult} from '../packages/zola-release/owned-acl-operator-observer.js';
import {ownedDatabaseAclParameters} from '../packages/buyer-writer/owned-database-evidence.js';
import assert from 'node:assert/strict';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import pg from 'pg';
import {provisionBuyerWriterProduction,provisionOwnedBuyerWriterProduction,authenticateBuyerWriterProductionIdentity} from '../packages/buyer-writer/production-provisioner.js';
import {databaseProfileDigest,OWNED_DATABASE_MANAGEMENT} from '../packages/buyer-writer/database-profile.js';
export async function proveOwnedWriterProvisioning({connect,profile,ca,owner,host,releaseSha,operationId,rolePasswords}){
 const credentials=Array.from({length:5},()=>randomBytes(32).toString('base64url'));
 const authority={releaseSha,operationId,attemptId:'00000000-0000-4000-8000-000000000088',workspace:'blackspire-command',gatewayIdentity:'blackspire-writer'};
 const base={backendProfile:'owned-postgres-v1',profileDigest:databaseProfileDigest(profile),host:'127.0.0.1',port:55432,database:'postgres',ca};
 const gateway={version:4,mode:'research-admission',workspace:'blackspire-command',socketPath:'/run/blackspire/buyer-writer.sock',gatewayCapability:credentials[3],creatorOid:profile.creatorOid,authority,
 runtime:{...base,password:credentials[0]},issuer:{...base,password:credentials[1]},admission:{connection:{...base,user:'buyer_writer_admission_login',password:credentials[2]},
 operationPermitConfiguration:JSON.stringify({issuer:'zola-control',audience:'buyer-writer',subject:owner,keyId:'fixture-key',origin:'https://zola.example',releaseSha,operationId,attemptId:authority.attemptId,workspace:authority.workspace}),
 verificationConfiguration:{version:2,keys:[{keyId:'fixture-key',publicKeyPem:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}),lifecycle:'current',verifyNotBefore:0,verifyNotAfter:null}]}}};
 const management={backendProfile:base.backendProfile,profileDigest:base.profileDigest,host:base.host,password:credentials[4],ca};
 const identity=mode=>({uid:0,gid:mode===0o640?44:0,mode,nlink:1,size:100,dev:1,ino:mode,mtimeMs:1,ctimeMs:1});
 let bindings=0,latestEvidence;const journal=[];
 const options={managementConfigPath:OWNED_DATABASE_MANAGEMENT,readProfile:()=>profile,lookupWriterGroup:()=> 'blackspire-writer:x:44:',
 readSnapshot:p=>p.endsWith('/gateway.json')?{value:structuredClone(gateway),identity:identity(0o640)}:{value:structuredClone(management),identity:identity(0o600)},
 connect:async()=>{const c=await connect('owned_fixture'),query=c.query.bind(c);c.query=async(text,...args)=>{if(text.startsWith('select pg_temp.blackspire_bind'))bindings++;const result=await query(text,...args);if(result.rows?.[0]?.evidence)latestEvidence=structuredClone(result.rows[0].evidence);return result;};return c;},
 authenticate:(kind,credential,creatorOid)=>authenticateBuyerWriterProductionIdentity({kind,credential,creatorOid,Client:class extends pg.Client{constructor(config){super({...config,host,port:5432,ssl:false});}}}),
 writeJournal:v=>journal.push(structuredClone(v))};
 await assert.rejects(provisionBuyerWriterProduction({...options,mode:'apply'}));assert.equal(bindings,0);
 const admin=await connect('owned_fixture','blackspire_cluster_admin');
 try{
  await admin.query('ALTER ROLE buyer_writer_runtime SUPERUSER');
  await assert.rejects(provisionOwnedBuyerWriterProduction({...options,mode:'reconcile'}));assert.equal(bindings,0);
  assert.equal((await admin.query("SELECT rolsuper FROM pg_roles WHERE rolname='buyer_writer_runtime'")).rows[0].rolsuper,true);
  await admin.query('ALTER ROLE buyer_writer_runtime NOSUPERUSER');
 }finally{await admin.end();}
 assert.equal((await provisionOwnedBuyerWriterProduction({...options,mode:'reconcile'})).status,'PROVISIONED');
 assert.equal(bindings,3);
 for(const [i,role] of ['buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission_login'].entries()){
  rolePasswords.set(role,credentials[i]);
  const wrong=new pg.Client({host,port:5432,user:role,password:'wrong-fixture-password',database:'postgres',connectionTimeoutMillis:2000});
  await assert.rejects(wrong.connect(),e=>e.code==='28P01');await wrong.end();
 }
 assert.equal((await provisionOwnedBuyerWriterProduction({...options,mode:'reconcile'})).status,'ALREADY_COMPLIANT');assert.equal(bindings,3);
 assert.equal((await provisionOwnedBuyerWriterProduction({...options,mode:'verify'})).status,'COMPLIANT');assert.equal(bindings,3);
 assert.equal((await provisionOwnedBuyerWriterProduction({...options,mode:'rollback'})).status,'LOGIN_DISABLED');
 const disabled=await connect('owned_fixture');try{assert.equal((await disabled.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN('buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission_login') AND rolcanlogin")).rows[0].n,0);}finally{await disabled.end();}
 const drift=await connect('owned_fixture');try{
  await drift.query('SET ROLE buyer_writer_owner;GRANT EXECUTE ON FUNCTION buyer_writer.lock_scope() TO PUBLIC;RESET ROLE;');
  await assert.rejects(provisionOwnedBuyerWriterProduction({...options,mode:'reconcile'}));assert.equal(bindings,3);
  await drift.query('SET ROLE buyer_writer_owner;REVOKE EXECUTE ON FUNCTION buyer_writer.lock_scope() FROM PUBLIC;RESET ROLE;');
 }finally{await drift.end();}
 assert.equal((await provisionOwnedBuyerWriterProduction({...options,mode:'reconcile'})).status,'PROVISIONED');assert.equal(bindings,6);
 assert.equal((await provisionOwnedBuyerWriterProduction({...options,mode:'verify'})).status,'COMPLIANT');assert.equal(bindings,6);
 assert.equal(latestEvidence.memberships.length,7);assert.equal(verifyOwnedBuyerWriterProductionEvidence(latestEvidence,profile).memberships.length,7);
 assert.throws(()=>verifyBuyerWriterProductionEvidence(latestEvidence,profile.creatorOid));
 for(const [field,value] of [['grantor','foreign_admin'],['grantorOid','11'],['memberOid','11'],['memberLogin',false],['admin',false],['inherit',true],['set',true]]){
  const changed=structuredClone(latestEvidence),edge=changed.memberships.find(e=>e.role==='buyer_writer_admission_login');edge[field]=value;
  assert.throws(()=>verifyOwnedBuyerWriterProductionEvidence(changed,profile));
 }
 const duplicate=structuredClone(latestEvidence);duplicate.memberships.push(duplicate.memberships.find(e=>e.role==='buyer_writer_admission_login'));assert.throws(()=>verifyOwnedBuyerWriterProductionEvidence(duplicate,profile));
 const acl=await connect('owned_fixture');try{
  await acl.query('BEGIN READ ONLY');const result=await observeOwnedAclScoped(acl,profile,ownedDatabaseAclParameters(profile));
  assert.equal(result.rows[0].writer.memberships.length,7);assert.equal(verifyOwnedOperatorAclResult(result,profile).writerIsolationVerified,true);
  assert.equal((await acl.query('SELECT current_user AS actor')).rows[0].actor,'postgres');await acl.query('ROLLBACK');
 }finally{await acl.end();}
 const gatewayDatabase=await createBuyerWriterGatewayPostgres({runtime:gateway.runtime,issuer:gateway.issuer,creatorOid:profile.creatorOid,Pool:class extends pg.Pool{constructor(config){super({...config,host,port:5432,ssl:false});}}});
 try{assert.equal(gatewayDatabase.isHealthy(),true);}finally{await gatewayDatabase.close();}
 assert.ok(journal.some(v=>v.phase==='verified-committed'&&v.status==='COMPLETED'));
 console.log('PASS: native apply refusal; bounded owned reconcile; unsafe superuser refusal; actual SCRAM login and wrong-password denial for all three writer roles; exact repeat performs no password binding; rollback and intact-layout recovery preserve credentials; altered layout refuses before rebinding; scoped ACL and exact seven-edge policy pass');
}
