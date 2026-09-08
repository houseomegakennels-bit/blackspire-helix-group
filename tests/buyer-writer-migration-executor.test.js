import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {readRootOwnedMetadataSnapshot} from '../packages/buyer-writer/protected-json.js';
import {prepareBuyerWriterExtensionAcl} from '../packages/buyer-writer/extension-acl.js';
import {prepareBuyerMigrationPackage} from '../packages/buyer-writer/migration-package.js';
import {prepareBuyerMigrationExecution,executeBuyerMigration} from '../packages/buyer-writer/migration-executor.js';
import {prepareConnectedBuyerMigration,reconcileConnectedBuyerMigration} from '../packages/buyer-writer/migration-connected.js';
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
