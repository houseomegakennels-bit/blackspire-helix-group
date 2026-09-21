import {provisionBuyerStoreSchema,BUYER_STORE_SCHEMA_SHA256} from '../packages/buyer-store/schema-provision.js';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Client} from 'pg';
import {provisionBuyerStorePasswords,BUYER_STORE_LOGIN_ROLES as roles} from '../packages/buyer-store/password-provision.js';
assert.equal(process.versions.node,'22.23.1');
const image=process.env.BUYER_WRITER_TEST_IMAGE;assert.match(image??'',/^postgres@sha256:[a-f0-9]{64}$/);
const owner=randomBytes(16).toString('hex'),adminPassword=randomBytes(32).toString('base64url');
const run=(args)=>spawnSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:65536,env:{...process.env,POSTGRES_PASSWORD:adminPassword}});
let id,admin,observer,port,alters=0,intent=false,result=false;
try{
 const created=run(['create','--label','blackspire.test-owner='+owner,'--read-only','--memory','256m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=8m','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=fixture_cluster_admin','--env','POSTGRES_DB=postgres','--env','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',image]);
 assert.equal(created.status,0,'create fixture');id=created.stdout.trim();assert.match(id,/^[a-f0-9]{64}$/);
 assert.equal(run(['start',id]).status,0);
 const meta=JSON.parse(run(['inspect',id]).stdout)[0];assert.equal(meta.Config.Labels['blackspire.test-owner'],owner);
 const binding=meta.NetworkSettings.Ports['5432/tcp'];assert.equal(binding.length,1);assert.equal(binding[0].HostIp,'127.0.0.1');port=Number(binding[0].HostPort);
 const connect=async(user,password)=>{const client=new Client({host:'127.0.0.1',port,user,password,database:'postgres',connectionTimeoutMillis:1000});try{await client.connect();return client;}catch(error){await client.end().catch(()=>{});throw error;}};
 for(let n=0;n<60;n++){try{admin=await connect('fixture_cluster_admin',adminPassword);break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(admin);
 observer=admin;
 await observer.query("CREATE ROLE postgres LOGIN NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS PASSWORD '"+adminPassword+"';ALTER DATABASE postgres OWNER TO postgres;ALTER SCHEMA public OWNER TO postgres");
 admin=await connect('postgres',adminPassword);
 await admin.query('CREATE TABLE public."SearchJob"(id uuid PRIMARY KEY,user_id uuid);CREATE TABLE public."BuyerReport"(search_job_id uuid);CREATE TABLE public."BuyerProfile"(id uuid);CREATE TABLE public.exports(user_id uuid,search_job_id uuid)');
 await admin.query("CREATE SCHEMA auth AUTHORIZATION postgres;REVOKE ALL ON SCHEMA auth FROM PUBLIC;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC");
 const schemaBinding={releaseSha:'a'.repeat(40),operationId:'11111111-1111-4111-8111-111111111111',profileDigest:'b'.repeat(64),artifactDigest:'c'.repeat(64),schemaDigest:BUYER_STORE_SCHEMA_SHA256};let schemaIntent=null,schemaResult=null,schemaDispatch=0,loseSchemaCommit=true;
 const schemaClient={query:async(...args)=>{if(args[0].includes('CREATE ROLE buyer_repository_user'))schemaDispatch++;const r=await admin.query(...args);if(args[0]==='COMMIT'&&loseSchemaCommit){loseSchemaCommit=false;throw new Error('synthetic lost schema commit');}return r;}};
 const prepareSchema=()=>provisionBuyerStoreSchema({client:schemaClient,binding:schemaBinding,verifyIdentity:async()=>{},fence:async()=>{},journal:{intent:()=>schemaIntent,writeIntent:v=>{schemaIntent=v;},result:v=>{schemaResult=v;}}});
 await assert.rejects(prepareSchema());assert.equal(schemaDispatch,1);assert.equal(schemaResult,null);
 await prepareSchema();await prepareSchema();assert.equal(schemaDispatch,1);assert.ok(schemaResult);
 await admin.query('ALTER ROLE buyer_repository_login CREATEDB');await assert.rejects(prepareSchema());assert.equal(schemaDispatch,1);await admin.query('ALTER ROLE buyer_repository_login NOCREATEDB');
 await admin.query('GRANT EXECUTE ON FUNCTION auth.uid() TO buyer_capability_reader');await assert.rejects(prepareSchema());assert.equal(schemaDispatch,1);await admin.query('REVOKE EXECUTE ON FUNCTION auth.uid() FROM buyer_capability_reader');await prepareSchema();
 await admin.query('GRANT USAGE ON SCHEMA auth TO buyer_capability_reader');await assert.rejects(prepareSchema());assert.equal(schemaDispatch,1);await admin.query('REVOKE USAGE ON SCHEMA auth FROM buyer_capability_reader');await prepareSchema();
 console.log('PASS: real fixed repository DDL, atomic receipt, unknown commit reconciliation, drift refusal, no DDL repeat');
 const passwords=[randomBytes(32).toString('base64url'),randomBytes(32).toString('base64url')];
 const fresh=async()=>{const r=await observer.query('SELECT count(*)=2 AND bool_and(rolpassword IS NULL) as fresh FROM pg_authid WHERE rolname=ANY($1::text[])',[roles]);return r.rows[0].fresh;};
 const verifyPasswords=async()=>{
  for(const [i,user] of roles.entries()){const c=await connect(user,passwords[i]);try{assert.equal((await c.query('select current_user as actor')).rows[0].actor,user);}finally{await c.end();}}
 };
 let failCommit=false;
 const management={query:async(...args)=>{if(args[0].startsWith('ALTER ROLE'))alters++;const value=await admin.query(...args);if(args[0]==='COMMIT'&&failCommit){failCommit=false;throw new Error('synthetic lost commit acknowledgement');}return value;}};
 const journal={hasIntent:()=>intent,writeIntent:()=>{intent=true;},verifyIntent:()=>{},writeResult:()=>{result=true;}};
 const apply=()=>provisionBuyerStorePasswords({management,verifyIdentity:async()=>{},observeFresh:fresh,verifyPasswords,journal,passwords});
 // Unknown existing credentials must refuse without changing either role.
 await admin.query("ALTER ROLE buyer_repository_login PASSWORD 'synthetic-existing-password'");
 await assert.rejects(apply());assert.equal(alters,0);assert.equal(intent,false);
 await admin.query('ALTER ROLE buyer_repository_login PASSWORD NULL');
 // Commit succeeded but acknowledgment lost: retained intent reconciles only
 // through authenticated role login, never a second ALTER ROLE.
 failCommit=true;await assert.rejects(apply());assert.equal(intent,true);assert.equal(result,false);assert.equal(alters,2);
 await apply();assert.equal(result,true);assert.equal(alters,2);
 await apply();assert.equal(alters,2);
 // Existing intent with foreign passwords refuses and never rotates.
 await admin.query("ALTER ROLE buyer_capability_login PASSWORD 'synthetic-foreign-password'");
 await assert.rejects(apply());assert.equal(alters,2);
 console.log('PASS: owned PostgreSQL password ownership, commit ambiguity, authenticated reconciliation and no repeat rotation');
}finally{
 await admin?.end().catch(()=>{});await observer?.end().catch(()=>{});
 if(id){const r=run(['inspect',id]);if(r.status===0){assert.equal(JSON.parse(r.stdout)[0].Config.Labels['blackspire.test-owner'],owner);assert.equal(run(['rm','-f',id]).status,0);}}
}
