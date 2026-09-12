import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {readRootOwnedMetadataSnapshot} from '../packages/buyer-writer/protected-json.js';
import {prepareBuyerWriterExtensionAcl} from '../packages/buyer-writer/extension-acl.js';
import {prepareBuyerMigrationPackage} from '../packages/buyer-writer/migration-package.js';
import {prepareBuyerMigrationExecution,executeBuyerMigration} from '../packages/buyer-writer/migration-executor.js';
import {prepareConnectedBuyerMigration,reconcileConnectedBuyerMigration} from '../packages/buyer-writer/migration-connected.js';
import {verifyReleaseMigrationPackage,executeReleaseNativeMigration,recoverReleaseNativeMigration,inspectReleaseMigrationHistory,inspectReleaseMigrationState,inspectReleaseMigrationRecovery} from '../packages/zola-release/commander-migration.js';
import {inspectReleaseCommander} from '../packages/zola-release/commander.js';
import {openReleaseJournal} from '../packages/zola-release/commander-journal.js';
import {claimBuyerMigrationIntent,verifyOrCreateBuyerMigrationClaim} from '../packages/buyer-writer/migration-journal.js';
const functions=['_await_response','_encode_url_with_params_array','_http_collect_response','_urlencode_string','check_worker_is_up','http_collect_response','http_delete','http_get','http_post','wait_until_running','wake','worker_restart'];
function fixture(){
 const roles=['postgres','supabase_admin','consumer'].map((name,i)=>({name,oid:String(i+10),superuser:false,inherit:true,login:false,createRole:false,createDb:false,replication:false,bypassRls:false}));
 const objects=[...functions.map(name=>({schema:'net',name,kind:'function',arguments:'',definitionDigest:'a'.repeat(32),securityDefiner:false})),
 ...['_http_response','http_request_queue'].map(name=>({schema:'net',name,kind:'r',arguments:null,definitionDigest:null,securityDefiner:null})),
 {schema:'net',name:'http_request_queue_id_seq',kind:'S',arguments:null,definitionDigest:null,securityDefiner:null},
 ...['pg_stat_statements','pg_stat_statements_info'].map(name=>({schema:'extensions',name,kind:'v',arguments:null,definitionDigest:null,securityDefiner:null}))];
 const privileges=o=>o.kind==='function'?['EXECUTE']:o.kind==='S'?['SELECT','UPDATE','USAGE']:['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'];
 for(const [i,o] of objects.entries()){
  o.oid=String(i+100);o.owner=o.schema==='net'?'supabase_admin':'postgres';
  const publicPrivileges=o.kind==='v'?['SELECT']:privileges(o);
  o.edges=[...privileges(o).map(privilege=>({grantor:o.owner,grantee:o.owner,privilege,grantable:true})),...publicPrivileges.map(privilege=>({grantor:o.owner,grantee:'PUBLIC',privilege,grantable:false}))];
 }
 const columns=objects.filter(o=>['r','v'].includes(o.kind)).map(o=>({schema:o.schema,table:o.name,number:1,name:'synthetic',aclIsNull:true,edges:[]}));
 const inventory={serverVersion:'17.6',database:'fixture',roles,memberships:[],extensions:[],schemas:[],objects};
 const effective=roles.flatMap(r=>objects.flatMap(o=>privileges(o).map(p=>[r.name,o.schema,o.name,o.kind,o.arguments,p,true,r.name===o.owner])));
 return{inventory,columns:{columns},effective:{effective,schemaEffective:roles.flatMap(r=>['extensions','net'].map(s=>[r.name,s,true,false]))}};
}

const providerManifest=prepareBuyerWriterExtensionAcl(fixture()).manifest;
const releaseSha='a'.repeat(40),migrationVersion='20260908000000';
const prepared=prepareBuyerMigrationPackage({releaseSha,providerManifest});
const args={releaseSha,providerManifest,manifestBytes:prepared.manifestBytes,body:prepared.body,
 expectedManifestSha256:createHash('sha256').update(prepared.manifestBytes).digest('hex'),migrationVersion};
const plan=prepareBuyerMigrationExecution(args);
const authorityDeps={acquireAuthority:async()=>({assertCurrent:async()=>{},close(){}})};
function completedLifecycle(){
 const runId='12345678-1234-4234-8234-123456789abc',stateDigest='d'.repeat(64),base={schema:1,releaseSha,runId,stateDigest};
 const proof={releaseSha,runId,artifactDigest:'e'.repeat(64),api:{role:'api',generation:'1'.repeat(32),pid:101,startTime:'1001'},
  worker:{role:'worker',generation:'2'.repeat(32),pid:102,startTime:'1002'}};
 return [{...base,type:'release_hold_intent'},{...base,type:'release_hold_result'},
  {...base,type:'release_lifecycle_intent'},{...base,type:'release_lifecycle_result',proof}];
}
test('release adapter independently regenerates both migration transports and refuses changed protected bytes',()=>{
 const input={releaseSha,configurationFile:'/bundle/migration-input.json'};
 const files={'migration-manifest.json':prepared.manifestBytes,'application-body.sql':prepared.body,'application.sql':prepared.sql};
 const deps={readJson:()=>({releaseSha,providerManifest}),readBytes:file=>files[file.split('/').at(-1)]};
 const proof=verifyReleaseMigrationPackage(input,deps);
 assert.equal(proof.productionAcceptance,false);assert.equal(proof.status,'PACKAGE_VERIFIED_EXECUTION_GATED');
 assert.equal(proof.connectedQuerySha256,prepareConnectedBuyerMigration(args).querySha256);
 assert.equal(JSON.stringify(proof).includes('CREATE'),false);
 for(const file of Object.keys(files)){
  const value=files[file];files[file]+=' ';
  assert.throws(()=>verifyReleaseMigrationPackage(input,deps),/preparation rejected/);files[file]=value;
 }
 assert.throws(()=>verifyReleaseMigrationPackage({...input,releaseSha:'b'.repeat(40)},deps));
 assert.throws(()=>verifyReleaseMigrationPackage({...input,configurationFile:'/bundle/../migration-input.json'},deps));
 let reads=0;
 assert.throws(()=>verifyReleaseMigrationPackage(input,{...deps,readBytes:file=>++reads>3?deps.readBytes(file)+' ':deps.readBytes(file)}));
 assert.throws(()=>verifyReleaseMigrationPackage(input,{...deps,readJson:()=>({releaseSha,providerManifest,approved:true})}));
});
function session({prior=[],fail='',locked=true,actor='postgres',superuser=false,commitLost=false}={}){
 const calls=[];let history;
 return {processID:77,calls,get history(){return history;},async query(sql,params){
  calls.push({sql,params});
  if(sql===fail)throw new Error('SECRET DRIVER DETAIL');
  if(sql.startsWith('SELECT current_user'))return {rows:[{actor,database:'postgres',pid:77,version:170006,superuser}]};
  if(sql.startsWith('SELECT pg_try'))return {rows:[{acquired:locked}]};
  if(sql.startsWith('SELECT version'))return {rows:prior};
  if(sql.startsWith('INSERT INTO')){history={version:params[0],name:params[1],statements:params[2],idempotency_key:params[3]};return {rowCount:1};}
  if(sql==='COMMIT'&&commitLost)throw new Error('SECRET DRIVER DETAIL');
  return {rows:[]};
 }};
}
test('global migration adapter records intent before shared claim and SQL, then only reconciles',async()=>{
 const events=completedLifecycle(),order=[],client=session();
 const query=client.query.bind(client);client.query=async (...a)=>{order.push('SQL');return query(...a);};
 const journal={stream:name=>{assert.equal(name,'release');return{events:()=>structuredClone(events),append:row=>{order.push(row.type);events.push(structuredClone(row));}};}};
 const options={...authorityDeps,claim:()=>{order.push('claim');}};
 const result=await executeReleaseNativeMigration({input:args,client,journal,mode:'apply'},options);
 assert.equal(result.status,'committed');assert.equal(result.productionAcceptance,false);
 assert.deepEqual(order.slice(0,3),['release_migration_intent','claim','SQL']);
 const count=client.calls.length;
 assert.equal((await executeReleaseNativeMigration({input:args,client,journal,mode:'apply'},options)).status,'STOPPED');
 assert.equal(client.calls.length,count);
 const reconcile=session({prior:[client.history]});
 assert.equal((await executeReleaseNativeMigration({input:args,client:reconcile,journal,mode:'reconcile'},options)).status,'committed-history-verified');
 assert.equal(reconcile.calls[0].sql,'BEGIN READ ONLY');assert.ok(!reconcile.calls.some(row=>row.sql===prepared.body));
 assert.equal(inspectReleaseMigrationHistory(events).releaseSha,releaseSha);
 assert.deepEqual(inspectReleaseMigrationState(events),{intent:events.find(row=>row.type==='release_migration_intent'),lastStatus:'committed-history-verified',reconciliationRequired:false});
 const inspected=inspectReleaseCommander(journal);
 assert.equal(inspected.migrationAttempted,true);assert.equal(inspected.migrationStatus,'committed-history-verified');
 assert.equal(inspected.migrationReconciliationRequired,false);
});
test('completed hold and lifecycle authority permit migration while pending lifecycle refuses before intent',async()=>{
 const completed=completedLifecycle();
 const make=events=>({stream:()=>({events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))})});
 const events=structuredClone(completed),client=session();
 const result=await executeReleaseNativeMigration({input:args,client,journal:make(events),mode:'apply'},{...authorityDeps,claim:()=>{}});
 assert.equal(result.status,'committed');assert.equal(events.at(-1).type,'release_migration_result');
 const pending=completed.slice(0,-1),blockedClient=session();
 const blocked=await executeReleaseNativeMigration({input:args,client:blockedClient,journal:make(pending),mode:'apply'},{...authorityDeps,claim:()=>{}});
 assert.equal(blocked.status,'STOPPED');assert.equal(blockedClient.calls.length,0);
 assert.equal(pending.some(row=>row.type==='release_migration_intent'),false);
 for(const invalid of [
  [],
  completed.slice(0,2),
  completed.map(row=>row.type.includes('lifecycle')?{...row,releaseSha:'b'.repeat(40)}:row),
  [...completed,...completed.map(row=>({...row,runId:'87654321-4321-4321-8321-cba987654321'}))],
  [completed[2],completed[3],completed[0],completed[1]],
 ]){
  const rejected=structuredClone(invalid),refusedClient=session();let claims=0;
  const stopped=await executeReleaseNativeMigration({input:args,client:refusedClient,journal:make(rejected),mode:'apply'},{...authorityDeps,claim:()=>{claims++;}});
  assert.equal(stopped.status,'STOPPED');assert.equal(refusedClient.calls.length,0);
  assert.equal(stopped.mutationSent,null);assert.equal(stopped.reconciliationRequired,true);assert.equal(claims,0);
  assert.equal(rejected.some(row=>row.type==='release_migration_intent'),false);
 }
});
test('global migration uncertainty, failed claim and failed durable append never authorize retry',async()=>{
 for(const failure of ['claim','intent','result','commit']){
  const events=completedLifecycle(),client=session({commitLost:failure==='commit'});
  const journal={stream:()=>({events:()=>structuredClone(events),append:row=>{
   if(failure==='intent'||failure==='result'&&row.type==='release_migration_result')throw new Error('disk full');
   events.push(structuredClone(row));
  }})};
  let claims=0;const options={...authorityDeps,claim:()=>{claims++;if(failure==='claim')throw new Error('PRIVATE_DETAIL');}};
  const result=await executeReleaseNativeMigration({input:args,client,journal,mode:'apply'},options);
  assert.equal(result.status,'STOPPED');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  if(['claim','intent'].includes(failure))assert.equal(client.calls.length,0);
  if(failure==='intent')assert.equal(claims,0);
  if(failure!=='intent'){
   const count=client.calls.length;
   assert.equal((await executeReleaseNativeMigration({input:args,client,journal,mode:'apply'},options)).status,'STOPPED');
   assert.equal(client.calls.length,count);assert.equal(claims,1);
   const empty=session();
   await executeReleaseNativeMigration({input:args,client:empty,journal,mode:'reconcile'},options);
   assert.equal(empty.calls[0].sql,'BEGIN READ ONLY');assert.ok(!empty.calls.some(row=>row.sql===prepared.body));
  }
 }
});
test('migration journal FSM rejects duplicate, reordered, and contradictory terminal results',()=>{
 const intent={schema:1,type:'release_migration_intent',operationId:'12345678-1234-4234-8234-123456789abc',
  releaseSha,migrationVersion,bodySha256:plan.bodySha256,manifestSha256:plan.manifestSha256};
 const result=status=>({...intent,type:'release_migration_result',status});
 for(const events of [
  [result('committed')],
  [intent,result('committed'),result('committed')],
  [intent,result('committed'),result('execution-failed')],
  [intent,result('not-recorded-retry-not-authorized'),result('outcome-unknown')],
  [intent,result('outcome-unknown'),result('not-recorded-retry-not-authorized'),result('committed-history-verified')],
 ])assert.throws(()=>inspectReleaseMigrationState(events),/rejected/);
 assert.equal(inspectReleaseMigrationState([intent,result('outcome-unknown'),result('committed-history-verified')]).reconciliationRequired,false);
});
test('release migration refuses success on post-commit authority drift or lease close failure',async()=>{
 for(const failure of ['post-commit','close']){
  const events=completedLifecycle(),journal={stream:()=>({events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))})};
  let assertions=0,closes=0;
  const acquireAuthority=async()=>({assertCurrent:async()=>{if(failure==='post-commit'&&++assertions===6)throw new Error('drift');},
   close(){closes++;if(failure==='close')throw new Error('lease close failed');}});
  const result=await executeReleaseNativeMigration({input:args,client:session(),journal,mode:'apply'},{claim:()=>{},acquireAuthority});
  assert.equal(result.status,'STOPPED');assert.equal(result.productionAcceptance,false);assert.equal(closes,1);
  assert.equal(events.at(-1).status,failure==='post-commit'?'committed-lifecycle-invalid':'committed');
 }
});
test('explicit recovery applies once after retained failure and exact replay sends no SQL',async()=>{
 const events=completedLifecycle(),make=()=>({stream:()=>({events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))})});
 const failed=session({fail:prepared.body});
 assert.equal((await executeReleaseNativeMigration({input:args,client:failed,journal:make(),mode:'apply'},{...authorityDeps,claim:()=>{}})).status,'STOPPED');
 let claims=0;const recovered=session();
 const result=await recoverReleaseNativeMigration({input:args,client:recovered,journal:make()},{...authorityDeps,verifyClaim:()=>{claims++;}});
 assert.equal(result.status,'committed-recovered');assert.equal(claims,1);assert.equal(recovered.calls.filter(row=>row.sql===prepared.body).length,1);
 assert.equal(inspectReleaseMigrationRecovery(events).status,'committed-recovered');
 const count=recovered.calls.length;
 assert.equal((await recoverReleaseNativeMigration({input:args,client:recovered,journal:make()},{...authorityDeps,verifyClaim:()=>{claims++;}})).status,'committed-recovered');
 assert.equal(recovered.calls.length,count);assert.equal(claims,1);
});
test('recovery resolves exact committed history without body and journals abort uncertainty distinctly',async()=>{
 for(const kind of ['existing','abort','rollback-lost']){
  const events=completedLifecycle(),make=()=>({stream:()=>({events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))})});
  await executeReleaseNativeMigration({input:args,client:session({commitLost:true}),journal:make(),mode:'apply'},{...authorityDeps,claim:()=>{}});
  const baseline=session();await executeBuyerMigration({client:baseline,plan,mode:'apply'});
  const client=kind==='existing'?session({prior:[baseline.history]}):session({fail:prepared.body});
  if(kind==='rollback-lost'){
   const query=client.query.bind(client);client.query=async(sql,...rest)=>{if(sql==='ROLLBACK')throw new Error('lost');return query(sql,...rest);};
  }
  const result=await recoverReleaseNativeMigration({input:args,client,journal:make()},{...authorityDeps,verifyClaim:()=>{}});
  if(kind==='existing'){assert.equal(result.status,'committed-history-verified');assert.ok(!client.calls.some(row=>row.sql===prepared.body));}
  else assert.equal(events.at(-1).status,kind==='abort'?'recovery-aborted':'rollback-outcome-unknown');
 }
});
test('recovery reconciles a lost rollback response without repeating an unverified transaction',async()=>{
 const events=completedLifecycle(),make=()=>({stream:()=>({events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))})});
 await executeReleaseNativeMigration({input:args,client:session({fail:prepared.body}),journal:make(),mode:'apply'},{...authorityDeps,claim:()=>{}});
 const uncertain=session({fail:prepared.body}),query=uncertain.query.bind(uncertain);
 uncertain.query=async(sql,...rest)=>{if(sql==='ROLLBACK')throw Object.assign(new Error('lost'),{code:'CONNECTION_LOST'});return query(sql,...rest);};
 assert.equal((await recoverReleaseNativeMigration({input:args,client:uncertain,journal:make()},{...authorityDeps,verifyClaim:()=>{}})).reason,'rollback-outcome-unknown');
 const resolved=session();
 assert.equal((await recoverReleaseNativeMigration({input:args,client:resolved,journal:make()},{...authorityDeps,verifyClaim:()=>{}})).status,'committed-recovered');
 assert.equal(inspectReleaseMigrationRecovery(events).status,'committed-recovered');
 assert.equal(resolved.calls.filter(row=>row.sql===prepared.body).length,1);
});
test('real protected global and migration journals retain uncertainty across close and reopen',{skip:process.getuid?.()!==0},async t=>{
 const root=fs.mkdtempSync('/root/.zola-migration-release-test-');fs.chmodSync(root,0o700);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const journalRoot=root+'/release';fs.mkdirSync(journalRoot,{mode:0o700});
 const options={...authorityDeps,claim:plan=>claimBuyerMigrationIntent(plan,{root:root+'/migration'})};
 let journal=openReleaseJournal({root:journalRoot});
 try{
  for(const event of completedLifecycle())journal.stream('release').append(event);
  const result=await executeReleaseNativeMigration({input:args,client:session({commitLost:true}),journal,mode:'apply'},options);
  assert.equal(result.reason,'MIGRATION_OUTCOME_UNKNOWN');assert.equal(fs.readdirSync(root+'/migration').length,1);
 }finally{journal.close();}
 journal=openReleaseJournal({root:journalRoot});
 try{
  const client=session();
  assert.equal((await executeReleaseNativeMigration({input:args,client,journal,mode:'apply'},options)).status,'STOPPED');
  assert.equal(client.calls.length,0);
  const result=await executeReleaseNativeMigration({input:args,client,journal,mode:'reconcile'},options);
  assert.equal(result.status,'not-recorded-retry-not-authorized');
  assert.equal(client.calls[0].sql,'BEGIN READ ONLY');assert.equal(fs.readdirSync(root+'/migration').length,1);
 }finally{journal.close();}
});
test('recovery claim is created once and exact protected bytes are required',{skip:process.getuid?.()!==0},t=>{
 const base=fs.mkdtempSync('/root/.zola-recovery-claim-');fs.chmodSync(base,0o700);t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const root=base+'/claims',claim={...plan,transport:'native'};
 const first=verifyOrCreateBuyerMigrationClaim(claim,{root});assert.equal(first.created,true);
 assert.equal(verifyOrCreateBuyerMigrationClaim(claim,{root}).created,false);
 fs.appendFileSync(first.filename,' ');assert.throws(()=>verifyOrCreateBuyerMigrationClaim(claim,{root}),/rejected/);
});
test('only exact independently regenerated package becomes an execution plan',()=>{
 for(const change of [{body:args.body+'SELECT 1;'}, {manifestBytes:args.manifestBytes+' '}, {releaseSha:'b'.repeat(40)},
  {expectedManifestSha256:'0'.repeat(64)}, {migrationVersion:'2026;DROP'}])assert.throws(()=>prepareBuyerMigrationExecution({...args,...change}),/package rejected/);
});
test('dedicated session applies body and history atomically before one commit',async()=>{
 const client=session();const result=await executeBuyerMigration({client,plan,mode:'apply'});
 assert.equal(result.status,'committed');assert.equal(result.productionAcceptance,false);
 const bodyAt=client.calls.findIndex(x=>x.sql===prepared.body),insertAt=client.calls.findIndex(x=>x.sql.startsWith('INSERT INTO'));
 assert.ok(bodyAt>0&&insertAt>bodyAt);assert.equal(client.calls.at(-1).sql,'COMMIT');
 assert.equal(client.history.statements[0],prepared.body);
});
test('read-only reconciliation and exact recorded replay never execute migration body',async()=>{
 const initial=session();await executeBuyerMigration({client:initial,plan,mode:'apply'});
 for(const mode of ['apply','reconcile']){
  const client=session({prior:[initial.history]});
  assert.equal((await executeBuyerMigration({client,plan,mode})).status,'committed-history-verified');
  assert.ok(!client.calls.some(x=>x.sql===prepared.body||x.sql.startsWith('INSERT INTO')));
 }
 const empty=session();assert.equal((await executeBuyerMigration({client:empty,plan,mode:'reconcile'})).status,'not-recorded-retry-not-authorized');
 assert.equal(empty.calls[0].sql,'BEGIN READ ONLY');assert.ok(!empty.calls.some(x=>x.sql===prepared.body));
});
test('wrong identity, busy old backend, conflicting history and forged plans fail before body',async()=>{
 const initial=session();await executeBuyerMigration({client:initial,plan,mode:'apply'});
 for(const client of [session({actor:'supabase_admin'}),session({superuser:true}),session({locked:false}),
  session({prior:[{...initial.history,statements:['SELECT 1']}]}),session({prior:[initial.history,initial.history]})]){
  await assert.rejects(executeBuyerMigration({client,plan,mode:'apply'}),e=>e.code==='MIGRATION_FAILED'&&!e.message.includes('SECRET'));
  assert.ok(!client.calls.some(x=>x.sql===prepared.body));assert.equal(client.calls.at(-1).sql,'ROLLBACK');
 }
 await assert.rejects(executeBuyerMigration({client:session(),plan:{...plan},mode:'apply'}),/rejected/);
 await assert.rejects(executeBuyerMigration({client:{query(){}},plan,mode:'apply'}),/rejected/);
});
test('body failure rolls back and commit response loss remains unknown without retry',async()=>{
 const failed=session({fail:prepared.body});await assert.rejects(executeBuyerMigration({client:failed,plan,mode:'apply'}),e=>e.code==='MIGRATION_FAILED');
 assert.equal(failed.calls.at(-1).sql,'ROLLBACK');assert.equal(failed.history,undefined);
 const lost=session({commitLost:true});await assert.rejects(executeBuyerMigration({client:lost,plan,mode:'apply'}),e=>e.code==='OUTCOME_UNKNOWN'&&!e.message.includes('SECRET'));
 assert.equal(lost.calls.at(-1).sql,'COMMIT');assert.equal(lost.calls.filter(x=>x.sql===prepared.body).length,1);
});
test('live admission fence is checked under advisory lock, immediately before body, and immediately before commit',async()=>{
 for(const rejectAt of [1,2,3]){
  const client=session();let checks=0;
  await assert.rejects(executeBuyerMigration({client,plan,mode:'apply',fence:async()=>{if(++checks===rejectAt)throw new Error('moved');}}),
   error=>error.code==='MIGRATION_FAILED'&&!error.message.includes('moved'));
  assert.equal(client.calls.at(-1).sql,'ROLLBACK');
  if(rejectAt<=2){assert.ok(!client.calls.some(row=>row.sql===prepared.body));assert.equal(client.history,undefined);}
  else {assert.equal(client.calls.filter(row=>row.sql===prepared.body).length,1);assert.ok(client.history);}
 }
 const client=session();let checks=0;
 assert.equal((await executeBuyerMigration({client,plan,mode:'apply',fence:async()=>{checks++;}})).status,'committed');
 assert.equal(checks,3);
});


test('connected migration binds exact body and leaves transaction/history to API',()=>{
 const p=prepareConnectedBuyerMigration(args);
 assert.equal(p.request.project_id,'kchtrvfcixnimvxxctkj');
 assert.match(p.request.query,/^SET LOCAL statement_timeout='30s';/);
 assert.match(p.request.query,/DO \$zola_connected\$/);
 assert.ok(p.request.query.includes(prepared.body));
 assert.ok(!p.request.query.includes('COMMIT;'));
 assert.match(p.request.query,/pg_try_advisory_xact_lock\(206994,125\)/);
 assert.ok(p.request.query.includes('zola_guarded_application_'+releaseSha));
 assert.equal(p.productionAcceptance,false);
 for(const change of [{body:args.body+'SELECT 1;'}, {manifestBytes:args.manifestBytes+' '}, {releaseSha:'b'.repeat(40)}])
  assert.throws(()=>prepareConnectedBuyerMigration({...args,...change}),/rejected/);
});
test('connected history verifies actual API version, rejects unknown/foreign/rewritten histories',()=>{
 const p=prepareConnectedBuyerMigration(args);
 const row={actor:'postgres',database:'postgres',superuser:false,acquired:true,history:[]};
 assert.equal(reconcileConnectedBuyerMigration(p,[row]).status,'not-recorded-retry-not-authorized');
 const entry={version:'20260908123456',name:p.request.name,statementCount:1,querySha256:p.querySha256};
 const result=reconcileConnectedBuyerMigration(p,[{...row,history:[entry]}]);
 assert.equal(result.status,'committed-history-verified');assert.equal(result.migrationVersion,entry.version);
 for(const bad of [{...row,acquired:false},{...row,superuser:true},{...row,actor:'supabase_admin'},
  {...row,history:[{...entry,statementCount:2}]},{...row,history:[{...entry,querySha256:'0'.repeat(64)}]},
  {...row,history:[{...entry,version:20260908123456}]},{...row,history:[entry,entry]},{...row,history:[{...entry,name:'zola_guarded_application_'+releaseSha}]}])
  assert.throws(()=>reconcileConnectedBuyerMigration(p,[bad]),/rejected/);
 assert.throws(()=>reconcileConnectedBuyerMigration({...p},[row]),/rejected/);
});


test('protected connected history requires an object envelope and unwraps rows for reconciliation',()=>{
 const p=prepareConnectedBuyerMigration(args);
 const rows=[{actor:'postgres',database:'postgres',superuser:false,acquired:true,history:[]}];
 const read=value=>{
  const bytes=Buffer.from(JSON.stringify(value));let offset=0,closed=0;
  const stat={uid:0,gid:0,mode:0o100600,nlink:1,size:bytes.length,dev:1,ino:2,mtimeMs:1,ctimeMs:1,isFile:()=>true};
  const io={lstatSync:()=>({uid:0,mode:0o40755,isDirectory:()=>true,isSymbolicLink:()=>false}),
   openSync:(_path,flags)=>{assert.ok(flags&fs.constants.O_NOFOLLOW);return 7;},fstatSync:()=>stat,
   readSync:(_fd,buffer,start,length)=>{const count=Math.min(length,bytes.length-offset);bytes.copy(buffer,start,offset,offset+count);offset+=count;return count;},
   closeSync:()=>{closed++;}};
  try{return readRootOwnedMetadataSnapshot('/protected/connected-observation.json',{groupId:0,io,aclTool:()=>({status:0,stdout:'',stderr:''})}).value;}
  finally{assert.equal(closed,1);}
 };
 assert.throws(()=>read(rows),/protected configuration unavailable/);
 const observation=read({rows});assert.deepEqual(Object.keys(observation),['rows']);
 assert.throws(()=>reconcileConnectedBuyerMigration(p,observation),/rejected/);
 assert.equal(reconcileConnectedBuyerMigration(p,observation.rows).status,'not-recorded-retry-not-authorized');
});
