import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Client} from 'pg';
import {provisionBuyerStorePasswords,BUYER_STORE_LOGIN_ROLES as roles} from '../packages/buyer-store/password-provision.js';
assert.equal(process.versions.node,'22.23.1');
const image=process.env.BUYER_WRITER_TEST_IMAGE;assert.match(image??'',/^postgres@sha256:[a-f0-9]{64}$/);
const owner=randomBytes(16).toString('hex'),adminPassword=randomBytes(32).toString('base64url');
const run=(args)=>spawnSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:65536,env:{...process.env,POSTGRES_PASSWORD:adminPassword}});
let id,admin,port,alters=0,intent=false,result=false;
try{
 const created=run(['create','--label','blackspire.test-owner='+owner,'--read-only','--memory','256m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=8m','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',image]);
 assert.equal(created.status,0,'create fixture');id=created.stdout.trim();assert.match(id,/^[a-f0-9]{64}$/);
 assert.equal(run(['start',id]).status,0);
 const meta=JSON.parse(run(['inspect',id]).stdout)[0];assert.equal(meta.Config.Labels['blackspire.test-owner'],owner);
 const binding=meta.NetworkSettings.Ports['5432/tcp'];assert.equal(binding.length,1);assert.equal(binding[0].HostIp,'127.0.0.1');port=Number(binding[0].HostPort);
 const connect=async(user,password)=>{const client=new Client({host:'127.0.0.1',port,user,password,database:'postgres',connectionTimeoutMillis:1000});try{await client.connect();return client;}catch(error){await client.end().catch(()=>{});throw error;}};
 for(let n=0;n<60;n++){try{admin=await connect('postgres',adminPassword);break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(admin);
 await admin.query('CREATE ROLE buyer_repository_login LOGIN NOINHERIT; CREATE ROLE buyer_capability_login LOGIN NOINHERIT');
 const passwords=[randomBytes(32).toString('base64url'),randomBytes(32).toString('base64url')];
 const fresh=async()=>{const r=await admin.query('SELECT count(*)=2 AND bool_and(rolpassword IS NULL) as fresh FROM pg_authid WHERE rolname=ANY($1::text[])',[roles]);return r.rows[0].fresh;};
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
 await admin?.end().catch(()=>{});
 if(id){const r=run(['inspect',id]);if(r.status===0){assert.equal(JSON.parse(r.stdout)[0].Config.Labels['blackspire.test-owner'],owner);assert.equal(run(['rm','-f',id]).status,0);}}
}
