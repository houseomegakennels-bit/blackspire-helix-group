import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {chmodSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {ADMISSION_SQL,createAdmissionBridge} from '../packages/buyer-writer/admission-bridge.js';
import {ADMISSION_IDENTITY_SQL} from '../packages/buyer-writer/admission-executor.js';
import {createBuyerWriterAdmissionPostgres} from '../packages/buyer-writer/admission-postgres.js';
import {createBuyerWriterLocalClient} from '../packages/buyer-writer/local-gateway-client.js';
import {createBuyerWriterLocalGateway} from '../packages/buyer-writer/local-gateway-server.js';

assert.equal(process.versions.node,'22.23.1');
const image=process.env.BUYER_WRITER_TEST_IMAGE;
assert.match(image??'',/^postgres@sha256:[a-f0-9]{64}$/);
const {Pool}=pg;
const id=randomUUID(),name=`zola-admission-e2e-${id}`,network=`${name}-net`;
const ownership=randomUUID(),password='disposable-admission-e2e';
const directory=mkdtempSync(join(tmpdir(),'zola-admission-e2e-'));
chmodSync(directory,0o700);
const socketPath=join(directory,'gateway.sock');
let containerId,networkOwned=false,containerOwned=false,admission,gateway,client;
const run=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',timeout:60_000}).trim();
const checked=(args,input)=>{
 const value=spawnSync('docker',args,{input,encoding:'utf8',timeout:60_000,maxBuffer:2**20});
 assert.equal(value.status,0,`docker failure: ${(value.stderr??'').slice(0,600)}`);
 return value.stdout.trim();
};
const psql=(user,database,statement)=>checked(
 ['exec','-i',name,'psql','-X','-qAt','-U',user,'-d',database,'-v','ON_ERROR_STOP=1'],statement);
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const cleanup=async()=>{
 try{await client?.close();}catch{}
 try{await gateway?.close();}catch{}
 try{await admission?.close();}catch{}
 if(containerOwned)try{run(['rm','-f',containerId]);}catch{}
 if(networkOwned)try{run(['network','rm',network]);}catch{}
 rmSync(directory,{recursive:true,force:true});
};
for(const [signal,code] of [['SIGTERM',143],['SIGINT',130]])process.once(signal,()=>{cleanup().finally(()=>process.exit(code));});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const digest=value=>createHash('sha256').update(value).digest('hex');
const owner='00000000-0000-4000-8000-000000000001';
const workspace='isolated-buyer-workspace',releaseSha='a'.repeat(40);
const operationId=randomUUID(),attemptId=randomUUID();
const authority={releaseSha,operationId,attemptId,workspace,gatewayIdentity:'blackspire-writer'};
const capability=randomBytes(32).toString('base64url');
const issuer='https://issuer.example',origin='https://writer.example',audience='zola-buyer-writer';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
const verificationConfiguration={version:2,keys:[{keyId:'test-key',publicKeyPem,
 lifecycle:'current',verifyNotBefore:0,verifyNotAfter:null}]};
const configuration=JSON.stringify({issuer,audience,subject:owner,keyId:'test-key',origin,
 releaseSha,operationId,attemptId,workspace});
const sourceContext={version:1,mode:'county_fetch',sources:[{
 sourceId:'00000000-0000-4000-8000-000000000003',sourceType:'arcgis',
 endpointId:'isolated',endpointConfigDigest:'b'.repeat(64),cashDisabled:false,
}],budgets:{maxRequests:10,maxRows:100,maxBytes:10000},rawPayload:null};
const criteria={state:'NC',county:'Wake',property_type:'land',date_range_start:'2026-01-01',
 date_range_end:'2026-12-31',min_purchases:1,cash_buyers_only:false,llc_buyers_only:false};
const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function signedRequest(operation,parameters,{jti=randomUUID(),requestId=randomUUID()}={}){
 const kind=operation==='recover'?'recovery':['issue','cancel','reconcile'].includes(operation)?'issuer':'runtime';
 const envelope={version:1,requestId,operation,parameters,releaseSha,operationId,attemptId,workspace};
 const body=Buffer.from(JSON.stringify({envelope}));
 const now=Math.floor(Date.now()/1000);
 const header=encoded({alg:'Ed25519',typ:'zola-operation+jwt',kid:'test-key'});
 const recoveryClaims=operation==='recover'?{
  originalIssuer:parameters.p_original_issuer,originalJti:parameters.p_original_jti,
  originalRequestId:parameters.p_original_request,originalBodyDigest:parameters.p_original_digest,
  routeOperation:parameters.p_route_operation,
 }:{};
 const claims=encoded({iss:issuer,aud:audience,sub:owner,jti,iat:now,nbf:now,exp:now+30,
  kind,operation,requestId,bodyDigest:digest(body),releaseSha,operationId,attemptId,workspace,...recoveryClaims});
 const token=`${header}.${claims}.${sign(null,Buffer.from(`${header}.${claims}`),privateKey).toString('base64url')}`;
 return {origin,method:'POST',path:`/rest/v1/rpc/${operation}`,
  rawHeaders:['Authorization',`Bearer ${token}`,'Content-Type','application/json','Content-Length',String(body.length)],body};
}
let dropNextApplyAcknowledgement=false,dropNextCorrelationAcknowledgement=false,applyExecutions=0;
class FaultPool extends Pool{
 async connect(){
  const connection=await super.connect(),query=connection.query.bind(connection);
  connection.query=async config=>{
   const result=await query(config);
   if(config?.text===ADMISSION_SQL.correlate&&dropNextCorrelationAcknowledgement){
    dropNextCorrelationAcknowledgement=false;
    throw Object.assign(new Error('synthetic correlation acknowledgement loss'),{code:'ECONNRESET'});
   }
   if(config?.text===ADMISSION_SQL.apply){
    applyExecutions++;
    if(dropNextApplyAcknowledgement){
     dropNextApplyAcknowledgement=false;
     const error=new Error('synthetic post-commit acknowledgement loss');
     error.code='ECONNRESET';
     throw error;
    }
   }
   return result;
  };
  return connection;
 }
}
try{
 checked(['network','create','--label',`blackspire.test-owner=${ownership}`,network]);
 networkOwned=true;
 containerId=checked(['create','--name',name,'--label','blackspire.disposable=buyer-writer-admission-e2e',
  '--label',`blackspire.test-owner=${ownership}`,'--network',network,'-p','127.0.0.1::5432',
  '--read-only','--memory','512m','--cpus','1','--pids-limit','128',
  '--tmpfs','/var/lib/postgresql/data:rw,size=192m','--tmpfs','/var/run/postgresql:rw,size=8m',
  '--tmpfs','/tmp:rw,size=16m','-e','POSTGRES_USER=fixture_admin',
  '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=writer_test',image]);
 assert.match(containerId,/^[a-f0-9]{64}$/);containerOwned=true;
 checked(['start',containerId]);
 let ready=false,consecutiveReady=0;
 for(let i=0;i<120;i++){
  const probe=spawnSync('docker',['exec',name,'sh','-c',
   'test "$(cat /proc/1/comm)" = postgres && pg_isready -U fixture_admin -d writer_test >/dev/null'],{stdio:'ignore'});
  consecutiveReady=probe.status===0?consecutiveReady+1:0;
  if(consecutiveReady>=3){ready=true;break;}await wait(250);
 }
 assert.equal(ready,true,'disposable PostgreSQL did not become ready');
 assert.match(psql('fixture_admin','writer_test','show server_version'),/^17\.6/);
 psql('fixture_admin','writer_test',`create role fixture_oid_padding_1;create role fixture_oid_padding_2;
  create role fixture_oid_padding_3;
  create role postgres superuser createdb createrole replication bypassrls login;
  alter database writer_test owner to postgres;create database writer_other;`);
 psql('postgres','writer_test',`revoke connect,temporary on database postgres,writer_other,template0 from public;
  revoke temporary on database writer_test,template1 from public;`);
 psql('postgres','writer_test',readFileSync(new URL('../tests/fixtures/buyer-writer/schema.sql',import.meta.url),'utf8'));
 psql('postgres','writer_test',readFileSync(new URL('../tests/fixtures/buyer-writer/nexus.sql',import.meta.url),'utf8'));
 const migrations=[
  '20260904201014_nexus_read_security.sql',
  '20260904223151_buyer_browser_security.sql',
 ].map(file=>readFileSync(new URL('../frontend/supabase/migrations/'+file,import.meta.url),'utf8')).join('\n');
 psql('postgres','writer_test',`begin;${migrations}commit;`);
 const creatorOid=Number(psql('fixture_admin','writer_test',"select oid from pg_roles where rolname='postgres'"));
 assert.equal(creatorOid,16388,'fixture creator OID drifted from managed shape');
 psql('fixture_admin','writer_test','alter role postgres nosuperuser createrole');
 const installer=readFileSync(new URL('../packages/buyer-writer/sql/install.sql',import.meta.url),'utf8');
 psql('postgres','writer_test',`set blackspire.buyer_writer_creator_oid=${literal(creatorOid)};${installer}`);
 psql('postgres','writer_test',`
  create role buyer_writer_admission_login login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${literal(password)};
  grant buyer_writer_admission to buyer_writer_admission_login with admin false,inherit false,set true granted by postgres;`);
 const certKey=join(directory,'server.key'),certFile=join(directory,'server.crt');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
  '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1',
  '-keyout',certKey,'-out',certFile],{stdio:'ignore',timeout:30_000});
 checked(['exec','-i',name,'sh','-c','umask 077; tee /tmp/server.key >/dev/null'],readFileSync(certKey));
 checked(['exec','-i',name,'sh','-c','umask 022; tee /tmp/server.crt >/dev/null'],readFileSync(certFile));
 checked(['exec',name,'chown','postgres:postgres','/tmp/server.key','/tmp/server.crt']);
 checked(['exec',name,'chmod','600','/tmp/server.key']);
 psql('fixture_admin','writer_test',`alter system set ssl='on';
  alter system set ssl_cert_file='/tmp/server.crt';alter system set ssl_key_file='/tmp/server.key';
  select pg_reload_conf();`);
 await wait(500);
 const portText=run(['port',name,'5432/tcp']);
 const match=portText.match(/127\.0\.0\.1:(\d+)/);assert.ok(match,'published disposable port unavailable');
 const connection={host:'localhost',port:Number(match[1]),database:'writer_test',
  user:'buyer_writer_admission_login',password,ca:readFileSync(certFile,'utf8')};
 const direct=new Pool({host:connection.host,port:connection.port,database:connection.database,
  user:connection.user,password,ssl:{rejectUnauthorized:true,ca:connection.ca},
  options:'-c role=buyer_writer_admission -c search_path=pg_catalog',max:1});
 const identityClient=await direct.connect();
 try{
  const identity=await identityClient.query(ADMISSION_IDENTITY_SQL,[connection.user,creatorOid]);
  if(identity.rows[0]?.safe!==true){
   const diagnostic=await identityClient.query(`select jsonb_build_object(
    'session',session_user,'current',current_user,
    'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,
      'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypass',rolbypassrls))
      from pg_roles where rolname in('buyer_writer_admission','buyer_writer_admission_login','postgres')),
    'members',(select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),
      'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option))
      from pg_auth_members where roleid='buyer_writer_admission'::regrole or member in
       ('buyer_writer_admission'::regrole,'buyer_writer_admission_login'::regrole)),
    'databases',(select jsonb_agg(jsonb_build_object('name',datname,
      'connect',has_database_privilege(session_user,oid,'CONNECT'),
      'create',has_database_privilege(session_user,oid,'CREATE'),
      'temp',has_database_privilege(session_user,oid,'TEMP')) order by datname) from pg_database),
    'callable',(select jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema'
       and has_schema_privilege(current_user,n.oid,'USAGE') and has_function_privilege(current_user,p.oid,'EXECUTE'))
   ) as evidence`);
   process.stderr.write(JSON.stringify(diagnostic.rows[0].evidence)+'\\n');
  }
  assert.deepEqual(identity.rows,[{safe:true}],'same-session admission identity or callable surface rejected');
  const graph=await identityClient.query(`select session_user as login,current_user as role,
   (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='buyer_writer' and has_function_privilege(current_user,p.oid,'EXECUTE')) as callable`);
  assert.deepEqual(graph.rows,[{login:'buyer_writer_admission_login',role:'buyer_writer_admission',callable:9}],
   'same-session role graph exposed a mismatched callable surface');
 }finally{identityClient.release();await direct.end();}
 admission=await createBuyerWriterAdmissionPostgres({connection,expectedCreatorOid:creatorOid,Pool:FaultPool});
 const bridge=createAdmissionBridge({mode:'research-admission',configuration,verificationConfiguration,
  admissionExecutor:admission.executor,now:()=>Math.floor(Date.now()/1000)});
 const rejectedQuery=async()=>{throw new Error('legacy writer path was reachable');};
 gateway=createBuyerWriterLocalGateway({socketPath,capability,authority,gatewayIdentityVerified:true,
  runtimeQuery:rejectedQuery,issuerQuery:rejectedQuery,admissionBridge:bridge});
 await gateway.listen();
 client=createBuyerWriterLocalClient({socketPath,capability,authority});
 assert.equal(await client.checkAvailability(),true,'authenticated local gateway readiness failed');
 const admin=new Pool({host:'127.0.0.1',port:Number(match[1]),database:'writer_test',
  user:'fixture_admin',ssl:{rejectUnauthorized:false},max:1});
 const createJob=async()=>{const jobId=randomUUID();await admin.query(`
  insert into public."SearchJob"(id,user_id,state,county,property_type,date_range_start,date_range_end)
  values($1,$2,'NC','Wake','land','2026-01-01','2026-12-31')`,[jobId,owner]);return jobId;};
 const jobId=await createJob(),cancelJob=await createJob();
 const captured=(await admin.query(`select updated_at::text as updated_at from public."SearchJob" where id=$1`,[jobId])).rows[0];
 const permitDigest=randomBytes(32).toString('hex'),issueDispatch=randomUUID();
 const issueRequest=signedRequest('issue',{
  p_job:jobId,p_owner:owner,p_workspace:workspace,p_digest:permitDigest,p_context:sourceContext,
  p_expected_criteria:criteria,p_expected_updated_at:captured.updated_at,p_request:issueDispatch,
 },{requestId:issueDispatch});
 const issue=await client.admittedRequest(issueRequest);
 const issueEvidence=(await admin.query('select issuer,jti,request_id,state from buyer_writer.operation_admissions')).rows;
 assert.equal(issue.status,200,JSON.stringify({issue,issueEvidence}));
 assert.deepEqual(issue.body,{dispatchId:issueDispatch,generation:1,automaticRetry:false});
 const q={jobId,version:1,dispatchId:issueDispatch,generation:1,operation:'start',
  chunkIndex:0,chunkCount:1,payload:{}};
 const applyJti=randomUUID(),applyRequestId=randomUUID();
 const applyRequest=signedRequest('apply',{p_digest:permitDigest,p_workspace:workspace,q},
  {jti:applyJti,requestId:applyRequestId});
 dropNextApplyAcknowledgement=true;
 dropNextCorrelationAcknowledgement=true;
 const apply=await client.admittedRequest(applyRequest);
 assert.deepEqual(apply,{status:503,body:{ok:false,code:'ADMISSION_UNKNOWN',automaticRetry:false}},
  'double acknowledgement loss must require an explicit fresh recovery permit');
 assert.equal(applyExecutions,1,'lost acknowledgement replayed the admitted apply');
 const originalDigest=digest(applyRequest.body);
 await client.close();client=undefined;
 await gateway.close();gateway=undefined;
 await admission.close();admission=undefined;
 const childRequest=request=>({
  connection,expectedCreatorOid:creatorOid,configuration,verificationConfiguration,
  request:{...request,bodyBase64:request.body.toString('base64'),body:undefined},
 });
 const cold=request=>{
  const child=spawnSync(process.execPath,['scripts/test-buyer-writer-admission-recovery-child.mjs'],{
   cwd:process.cwd(),encoding:'utf8',timeout:30_000,input:JSON.stringify(childRequest(request)),
  });
  assert.equal(child.status,0,(child.stderr??'').slice(0,500));
  return JSON.parse(child.stdout);
 };
 const recoveryParameters=overrides=>({
  p_workspace:workspace,p_owner:owner,p_original_issuer:issuer,p_original_jti:applyJti,
  p_original_request:applyRequestId,p_original_digest:originalDigest,p_route_operation:'apply',...overrides,
 });
 const wrongBinding=cold(signedRequest('recover',recoveryParameters({p_original_digest:'0'.repeat(64)})));
 assert.deepEqual(wrongBinding,{status:403,body:{ok:false,code:'ADMISSION_REJECTED',automaticRetry:false}});
 const crossRoute=cold(signedRequest('recover',recoveryParameters({p_route_operation:'issue'})));
 assert.deepEqual(crossRoute,{status:403,body:{ok:false,code:'ADMISSION_REJECTED',automaticRetry:false}});
 const reservedJti=randomUUID(),reservedRequest=randomUUID(),reservedDigest='1'.repeat(64);
 await admin.query(`insert into buyer_writer.operation_admissions
  (issuer,jti,request_id,raw_body_digest,expires_at) values($1,$2,$3,$4,clock_timestamp()+interval '1 minute')`,
  [issuer,reservedJti,reservedRequest,reservedDigest]);
 const incomplete=cold(signedRequest('recover',recoveryParameters({
  p_original_jti:reservedJti,p_original_request:reservedRequest,p_original_digest:reservedDigest,
 })));
 assert.deepEqual(incomplete,{status:403,body:{ok:false,code:'ADMISSION_REJECTED',automaticRetry:false}});
 const recoveryRequest=signedRequest('recover',recoveryParameters({}));
 const recovered=cold(recoveryRequest);
 assert.deepEqual(recovered,{status:200,body:{ok:true,operation:'start',chunkIndex:0,
  recovered:true,automaticRetry:false}});
 const replay=cold(recoveryRequest);
 assert.deepEqual(replay,{status:401,body:{ok:false,code:'ADMISSION_REJECTED',automaticRetry:false}});
 const receiptAdmission=await createBuyerWriterAdmissionPostgres({connection,expectedCreatorOid:creatorOid,Pool});
 const receiptBridge=createAdmissionBridge({mode:'research-admission',configuration,verificationConfiguration,
  admissionExecutor:receiptAdmission.executor,now:()=>Math.floor(Date.now()/1000)});
 const receipt=await receiptBridge(signedRequest('receipt',{
  p_digest:permitDigest,p_workspace:workspace,p_job:jobId,p_dispatch:issueDispatch,
  p_generation:1,p_operation:'start',p_index:0,
 }));
 assert.equal(receipt.status,200,JSON.stringify(receipt));
 assert.equal(receipt.body.found,true);
 assert.deepEqual(receipt.body.receipt,{ok:true,operation:'start',chunkIndex:0});
 assert.equal(receipt.body.automaticRetry,false);
 const absentDispatch=randomUUID();
 const reconcile=await receiptBridge(signedRequest('reconcile',{
  p_job:jobId,p_owner:owner,p_workspace:workspace,p_request:absentDispatch,
  p_expected_updated_at:null,
 }));
 assert.equal(reconcile.status,200,JSON.stringify(reconcile));
 assert.deepEqual(reconcile.body,{dispatchId:absentDispatch,generation:null,state:'absent',automaticRetry:false});
 const cancel=await receiptBridge(signedRequest('cancel',{
  p_job:cancelJob,p_owner:owner,p_workspace:workspace,
 }));
 assert.equal(cancel.status,200,JSON.stringify(cancel));
 assert.deepEqual(cancel.body,{cancelled:true,jobId:cancelJob,automaticRetry:false});
 const correlated=(await admin.query(`select state,route_operation,result from buyer_writer.operation_admissions
  where issuer=$1 and jti=$2`,[issuer,applyJti])).rows;
 assert.equal(correlated.length,1,'lost-ack apply admission was not persisted once');
 assert.equal(correlated[0].state,'succeeded');
 assert.equal(correlated[0].route_operation,'apply');
 assert.deepEqual(correlated[0].result,{ok:true,operation:'start',chunkIndex:0});
 const counts=(await admin.query(`select
  (select count(*)::int from buyer_writer.operation_admissions) as admissions,
  (select count(*)::int from buyer_writer.receipts where dispatch_id=$1 and operation='start' and chunk_index=0) as receipts`,
  [issueDispatch])).rows[0];
 assert.deepEqual(counts,{admissions:10,receipts:1},'recovery admissions or exactly-once receipt count mismatched');
 await receiptAdmission.close();
 await admin.end();
 process.stdout.write(JSON.stringify({ok:true,postgres:'17.6',canonicalInstaller:true,
  dedicatedAdmissionLogin:true,sameSessionIdentity:true,admittedRoutes:['issue','apply','receipt','reconcile','cancel'],
  lostAcknowledgementRecovered:true,freshProcessRecovered:true,recoveryAdversarial:true,
  applyExecutions,admissions:counts.admissions,receipts:counts.receipts,
  productionTouched:false})+'\n');
}finally{await cleanup();}
