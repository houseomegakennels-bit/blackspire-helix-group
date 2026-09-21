// Actual disposable HTTP -> authenticated Unix IPC -> PostgreSQL composition.
// Host identity/artifact observations and the external Auth/Deal data origins are
// synthetic. Admission flock, API route, SQLite authority CAS, IPC MAC, SQL/RLS,
// signed Deal contract and connection-drain lifetime are the production code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {once} from 'node:events';
import pg from 'pg';
assert.equal(process.versions.node,'22.23.1');assert.equal(process.getuid(),0);
const root=fs.mkdtempSync('/root/zola-owned-http-'),sqlSocket=fs.mkdtempSync('/tmp/zola-owned-http-pg-');fs.chmodSync(sqlSocket,0o777);
const sha='a'.repeat(40),binding={releaseSha:sha,runId:randomUUID(),apiGeneration:'b'.repeat(32),workerGeneration:'c'.repeat(32)};
const context=()=>({role:'api',generation:binding.apiGeneration,...binding});globalThis[Symbol.for('zola-owned-http-context')]=context;
const admissionUrl=new URL('../packages/shared/release-admission.js',import.meta.url).href;
const hook=registerHooks({load(url,context,next){const loaded=next(url,context);if(url!==admissionUrl)return loaded;
 let source=String(loaded.source).replace("export const RELEASE_ADMISSION_ROOT='/etc/blackspire/release-admission';",`export const RELEASE_ADMISSION_ROOT=${JSON.stringify(root)};`);
 const start=source.indexOf('export function currentReleaseAdmissionContext('),end=source.indexOf('\n}',start)+2;assert(start>=0&&end>start);
 source=source.slice(0,start)+"export function currentReleaseAdmissionContext(){return globalThis[Symbol.for('zola-owned-http-context')]();}"+source.slice(end);return{...loaded,source};}});
process.env.BLACKSPIRE_RUNTIME_MODE='test';process.env.BLACKSPIRE_DATA_DIR=root;process.env.BLACKSPIRE_DB_PATH=root+'/command.sqlite';
process.env.BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN='synthetic-composition-consumer-token-0000';process.env.BUYER_STORE_MODE='owned-postgres-v1';
const {prepareDisposableDatabase}=await import('../tests/helpers/prepare-disposable-database.js');prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const {createBuyerStoreRepository}=await import('../packages/buyer-store/repository.js');
const {createBuyerStoreHandler,createSupabaseBuyerUserVerifier,validateBuyerStoreInput}=await import('../packages/buyer-store/service.js');
const {createBuyerStoreLocalServer}=await import('../packages/buyer-store/local-server.js');
const {createBuyerStoreLocalClient}=await import('../packages/buyer-store/local-client.js');
const {createBuyerStoreApiClient}=await import('../packages/buyer-store/api-client.js');
const {createBuyerDealContextClient}=await import('../packages/buyer-store/deal-context-client.js');
const {verifyBuyerDealContextRequest,signBuyerDealContextResponse}=await import('../packages/buyer-store/deal-context-contract.js');
const {createBuyerStoreAdmissionFence}=await import('../packages/buyer-store/admission-fence.js');
const {acquireReleaseAdmissionLock,RELEASE_ADMISSION_LOCK,withPremergeReadAdmission}=await import('../packages/shared/release-admission.js');
const {start,beginGracefulShutdown}=await import('../apps/api/server.js');
const db=await import('../packages/task-engine/db.js'),tasks=await import('../packages/task-engine/tasks.js');
const {upsertWorkspace,getWorkspace}=await import('../packages/workspace-registry/workspaces.js');
const {createUnifiedInput}=await import('../packages/unified-input/unified.js');
const {resolveAdminBearer}=await import('../packages/shared/authorization.js');
const {issueReceiverAuthority,receiverRequest}=await import('../packages/capabilities/receiver-authority.js');
const {recordWorkerHeartbeat}=await import('../packages/task-engine/runtime-status.js');
const {readCases}=await import('../packages/zola-six-reads/collector.js');
const image='postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const owner='00000000-0000-4000-8000-000000000001',foreign='00000000-0000-4000-8000-000000000002',label=randomUUID();
let container,api,ipc,external,releaseDrain;let holdDrain=false,drainEntered,drainPromise;let queryCount=0,dealCalls=0,authCalls=0,tamperDeal=false;
const run=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:60000,maxBuffer:1048576});assert.equal(r.status,0,(r.stderr??'').slice(0,400));return r.stdout.trim();};
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const write=(name,value)=>fs.writeFileSync(root+'/'+name,typeof value==='string'?value:JSON.stringify(value)+'\n',{mode:0o640});
write('admission.lock',RELEASE_ADMISSION_LOCK);let state={version:1,mode:'open',...binding};write('state.json',state);
const exclusive=()=>spawnSync('/usr/bin/flock',['--exclusive','--nonblock',root+'/admission.lock','/usr/bin/true']).status;
const key=randomBytes(32).toString('base64url'),dealKey=randomBytes(32).toString('base64url');
try{
 container=run(['create','--network','none','--read-only','--memory','256m','--pids-limit','128','--label','blackspire.test-owner='+label,'--tmpfs','/var/lib/postgresql/data:rw,size=128m','--tmpfs','/tmp:rw,size=16m','--mount',`type=bind,source=${sqlSocket},target=/var/run/postgresql`,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);run(['start',container]);
 let ready=false;for(let i=0;i<80;i++){if(spawnSync('docker',['exec',container,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres'],{stdio:'ignore'}).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,100));}assert(ready);
 run(['exec','-i',container,'psql','-X','-q','-U','postgres','-v','ON_ERROR_STOP=1'],fs.readFileSync('tests/fixtures/buyer-writer/schema.sql','utf8')+'\nCREATE TABLE public.exports(id uuid PRIMARY KEY,user_id uuid NOT NULL,search_job_id uuid REFERENCES public."SearchJob"(id),file_name text NOT NULL,storage_path text NOT NULL,row_count integer,created_at timestamptz);\n'+fs.readFileSync('packages/buyer-store/repository-schema.sql','utf8')+'\nINSERT INTO public."BuyerProfile"(buyer_name,county,state,property_types,purchase_count) VALUES(\'Synthetic Buyer\',\'Wake\',\'NC\',ARRAY[\'land\'],3);');
 const connect=async user=>{const client=new pg.Client({host:sqlSocket,user,database:'postgres'});await client.connect();const query=client.query.bind(client),end=client.end.bind(client);client.query=(...args)=>{queryCount++;return query(...args);};client.end=async()=>{if(holdDrain){holdDrain=false;drainEntered();await drainPromise;}await end();};return client;};
 const repository=createBuyerStoreRepository({connect:()=>connect('buyer_repository_login'),connectCapability:()=>connect('buyer_capability_login')});
 external=http.createServer(async(req,res)=>{try{
  if(req.url==='/auth/v1/user'){authCalls++;const token=String(req.headers.authorization);const id=token==='Bearer owner.synthetic.jwt'?owner:token==='Bearer foreign.synthetic.jwt'?foreign:null;if(!id){res.writeHead(401);res.end('{}');return;}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id,email_confirmed_at:'2026-01-01',app_metadata:{blackspire_role:'beta_tester'}}));return;}
  assert.equal(req.url,'/api/internal/buyer-store/deal-context');let bytes='';for await(const chunk of req)bytes+=chunk;const request=verifyBuyerDealContextRequest(JSON.parse(bytes),dealKey,sha);dealCalls++;
  const signed=signBuyerDealContextResponse(request,{city:'Raleigh',county:'Wake County',property_address:'Synthetic',property_type:'land'},{requests:1,responseBytes:100,latencyMs:1},dealKey);if(tamperDeal)signed.deal.county='Foreign';res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(signed));
 }catch{res.writeHead(404);res.end('{}');}});await new Promise(r=>external.listen(0,'127.0.0.1',r));const externalBase='http://127.0.0.1:'+external.address().port;
 const verifyUser=createSupabaseBuyerUserVerifier({publicKey:'sb_publishable_synthetic',operatorOwnerId:null,fetchImpl:(url,options)=>{assert.equal(url,'https://kchtrvfcixnimvxxctkj.supabase.co/auth/v1/user');return fetch(externalBase+'/auth/v1/user',options);}});
 const configuration={version:1,releaseSha:sha,profileDigest:'d'.repeat(64),key},attestation={binding:()=>binding,verify:async()=>hash(binding),verifyUnchanged:async p=>assert.equal(p,hash(binding))};
 const fence=createBuyerStoreAdmissionFence({groupId:0,attestation,readState:()=>state,acquire:()=>acquireReleaseAdmissionLock({root,groupId:0})});
 ipc=createBuyerStoreLocalServer({configuration,attestation,fence,validateInput:validateBuyerStoreInput,userHandler:createBuyerStoreHandler({repository,verifyUser}),readCapabilityProfiles:v=>repository.readCapabilityProfiles(v),readiness:async()=>({status:'ready',releaseSha:sha,profileDigest:configuration.profileDigest,rolesVerified:true})});
 await new Promise(r=>ipc.listen(root+'/store.sock',r));const local=createBuyerStoreLocalClient({configuration,connect:()=>net.createConnection({path:root+'/store.sock'})});
 const dealConfiguration={version:1,releaseSha:sha,origin:'https://blackspirehelix.com',key:dealKey};
 const lookupDeal=createBuyerDealContextClient({configuration:dealConfiguration,fetchImpl:(url,options)=>{assert.equal(String(url),'https://blackspirehelix.com/api/internal/buyer-store/deal-context');return fetch(externalBase+new URL(url).pathname,options);}});
 const store=createBuyerStoreApiClient({clientConfiguration:configuration,dealConfiguration,localClient:local,lookupDeal});
 api=start(0,'127.0.0.1',{buyerStore:store});await once(api,'listening');const base='http://127.0.0.1:'+api.address().port;process.env.BLACKSPIRE_RELEASE_RUN_ID=binding.runId;
 const userCall=(operation,input,token='owner.synthetic.jwt')=>fetch(base+'/api/internal/buyer-store/v1/'+operation,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(input)});
 const job={id:randomUUID(),state:'NC',county:'Wake',property_type:'land',date_range_start:null,date_range_end:null,min_purchases:1,cash_buyers_only:false,llc_buyers_only:false};
 let response=await userCall('job-create',job);assert.equal(response.status,200);assert.equal((await response.json()).data.user_id,owner);
 response=await userCall('job-get',{id:job.id},'foreign.synthetic.jwt');assert.equal(response.status,200);assert.equal((await response.json()).data,null);
 response=await userCall('job-get',{id:job.id});assert.equal((await response.json()).data.id,job.id);
 const before=queryCount;assert.equal((await userCall('jobs-list',{limit:5,ids:[]},'invalid.synthetic.jwt')).status,404);assert.equal(queryCount,before);
 const badClient=createBuyerStoreLocalClient({configuration:{...configuration,key:'z'.repeat(43)},connect:()=>net.createConnection({path:root+'/store.sock'})});await assert.rejects(badClient.userRequest({operation:'counts',input:{},accessToken:'owner.synthetic.jwt'}));assert.equal(queryCount,before);
 // Real SQLite authority, authenticated principal/grant and worker heartbeat.
 const time=Date.now();upsertWorkspace({id:'blackspire-command',name:'synthetic',githubRepository:'owner/repo',rootPath:'.',providerPolicy:{preferred:['mock']},budgetCents:1});
 db.run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',['blackspire-operator','admin','blackspire-operator','bearer',null,'active',time,null,null,null,1,time]);
 db.run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[randomUUID(),'blackspire-operator','blackspire-command','admin',JSON.stringify(['buyer.profiles.read','buyer.matches.read','task.create','task.execute','task.read','workspace.read']),'active',1,null,time,null,null,'synthetic',1,time]);tasks.setFlag('emergency_stop','inactive');
 const reads=readCases('DE-0001').map((r,index)=>{const idempotencyKey=`zola-six:${binding.runId}:${index}`;return{index,idempotencyKey,capability:r.capability,permission:r.permissions[0],request:r.text,requestDigest:hash({channel:'jarvis',workspaceId:'blackspire-command',text:r.text,idempotencyKey,executionIntent:'read_only'})};});
 let permitToken;
 // Each independent negative scenario starts a fresh synthetic task. Retire
 // only fixture idempotency references; production never rewrites these records.
 const makeAuthority=async capabilityId=>{
  const row=reads.find(r=>r.capability===capabilityId);db.run('UPDATE unified_inputs SET idempotency_key=? WHERE idempotency_key=?',[randomUUID(),row.idempotencyKey]);db.run('UPDATE tasks SET idempotency_key=NULL WHERE idempotency_key=?',['unified:jarvis:'+row.idempotencyKey]);const create=()=>createUnifiedInput({channel:'jarvis',actorId:'blackspire-operator',channelKey:randomUUID(),workspaceId:'blackspire-command',text:row.request,idempotencyKey:row.idempotencyKey,authority:'authenticated_admin',executionIntent:'read_only'});const created=state.mode==='held'?await withPremergeReadAdmission({role:'api',token:permitToken},create):create();
  const workerId='composition-worker',claim='synthetic-claim';db.run("UPDATE tasks SET status='running',worker_id=?,claim_token=?,idempotency_key=? WHERE id=?",[workerId,claim,'unified:jarvis:'+row.idempotencyKey,created.taskId]);
  const task=tasks.getTask(created.taskId),attemptId=tasks.capabilityAttemptId(task.id,capabilityId),request=receiverRequest(capabilityId,'blackspire-command',capabilityId==='buyer.matches.search'?{opportunityId:'DE-0001',limit:5}:{county:'Wake',limit:5});
  const issued=issueReceiverAuthority({task,attemptId,capability:{id:capabilityId},workspace:getWorkspace('blackspire-command'),principal:resolveAdminBearer('blackspire-operator'),ownership:{workerId,claimToken:claim},request},{context:()=>({...context(),role:'worker'})});
  tasks.prepareCapabilityDispatch(task.id,capabilityId,{workspaceId:'blackspire-command',principalId:'blackspire-operator',workerId,claimDigest:issued.persisted.claimDigest,receiverAuthority:issued.persisted});
  recordWorkerHeartbeat({workerId,phase:'working',taskId:task.id,generationId:binding.workerGeneration});return {authority:issued.envelope,request:request.body};
 };
 const callback=value=>fetch(base+'/api/internal/capability-authority/consume',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN},body:JSON.stringify(value)});
 console.log('owner HTTP and IPC passed');let value=await makeAuthority('buyer.matches.search');response=await callback(value);assert.equal(response.status,200);let result=await response.json();assert.equal(result.buyerData.profiles[0].buyer_name,'Synthetic Buyer');assert.equal(dealCalls,1);assert.equal((await callback(value)).status,404);
 console.log('OPEN matches signed callback passed');
 // HELD has actual protected six-read claims and no ordinary operation bypass.
 state={...state,mode:'held',apiGeneration:null,workerGeneration:null};write('state.json',state);
 const token=randomBytes(32).toString('base64url'),claims={schema:1,kind:'held-premerge-reads',permitId:randomUUID(),commanderRunId:randomUUID(),candidateSha:sha,expectedDeploymentSha:sha,epochRunId:binding.runId,workspace:'blackspire-command',principal:'blackspire-operator',apiGeneration:binding.apiGeneration,workerGeneration:binding.workerGeneration,issuedAt:Date.now(),expiresAt:Date.now()+60000,operations:['six_reads'],reads,tokenDigest:hash(token)};
 permitToken=token;write('premerge-reads.json',claims);write('premerge-reads-active.json',{schema:1,kind:'held-premerge-reads-active',permitId:claims.permitId,claimsDigest:hash(claims),operation:'six_reads',attemptId:randomUUID(),expiresAt:claims.expiresAt});
 const heldQueries=queryCount;assert.equal((await userCall('job-create',{...job,id:randomUUID()})).status,503);assert.equal(queryCount,heldQueries);
 console.log('HELD ordinary denial passed');value=await makeAuthority('buyer.profiles.search');response=await callback(value);assert.equal(response.status,200);assert.equal((await response.json()).buyerData.profiles.length,1);
 value=await makeAuthority('buyer.profiles.search');const invalid={...value,request:{...value.request,county:'foreign'}};const untouched=queryCount;assert.equal((await callback(invalid)).status,404);assert.equal(queryCount,untouched);
 value=await makeAuthority('buyer.matches.search');tamperDeal=true;const beforeTamper=queryCount;assert.equal((await callback(value)).status,404);assert.equal(queryCount,beforeTamper);tamperDeal=false;
 value=await makeAuthority('buyer.profiles.search');drainPromise=new Promise(r=>{releaseDrain=r;});let readCompleted;const completed=new Promise(r=>{readCompleted=r;});drainEntered=readCompleted;holdDrain=true;
 const revokedResponse=callback(value);await completed;assert.equal(exclusive(),1);db.run("UPDATE auth_workspace_grants SET status='revoked' WHERE principal_id='blackspire-operator'");releaseDrain();assert.equal((await revokedResponse).status,404);db.run("UPDATE auth_workspace_grants SET status='active' WHERE principal_id='blackspire-operator'");
 console.log('HELD callback and altered-body denial passed');
 // Native end/drain blocked after COMMIT: disconnected HTTP cannot release the
 // daemon's shared lock while its repository operation still owns a connection.
 value=await makeAuthority('buyer.profiles.search');drainPromise=new Promise(r=>{releaseDrain=r;});const entered=new Promise(r=>{drainEntered=r;});holdDrain=true;
 const request=http.request(base+'/api/internal/capability-authority/consume',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN}});request.on('error',()=>{});request.end(JSON.stringify(value));await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(new Error('drain not entered')),5000))]);assert.equal(exclusive(),1);request.destroy();assert.equal(exclusive(),1);releaseDrain();
 for(let i=0;i<100&&exclusive()!==0;i++)await new Promise(r=>setTimeout(r,10));assert.equal(exclusive(),0);
 assert(authCalls>=4);console.log(JSON.stringify({ok:true,actualHttp:true,authenticatedUnixIpc:true,actualPostgresRls:true,sqliteAuthorityCas:true,signedDealContract:true,heldAndDisconnectDrain:true,postReadRevocation:true,signedResponseTamperDenied:true,productionTouched:false}));
}finally{
 releaseDrain?.();delete process.env.BLACKSPIRE_RELEASE_RUN_ID;
 if(api){api.closeAllConnections();await beginGracefulShutdown(api,{deadlineMs:1000});}
 if(ipc)await new Promise(r=>ipc.close(r));if(external){external.closeAllConnections();await new Promise(r=>external.close(r));}
 if(container){assert.equal(JSON.parse(run(['inspect',container]))[0].Config.Labels['blackspire.test-owner'],label);run(['rm','-f',container]);}
 hook.deregister();delete globalThis[Symbol.for('zola-owned-http-context')];fs.rmSync(root,{recursive:true,force:true});fs.rmSync(sqlSocket,{recursive:true,force:true});
}
