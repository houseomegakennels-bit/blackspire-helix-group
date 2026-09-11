import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hash} from '../packages/zola-release/commander-journal.js';
import {WORKFLOW_ID} from '../packages/zola-release/commander-n8n.js';
import {createN8nMigrationProductionOperations} from '../packages/zola-release/production-n8n-migration.js';

const releaseSha='a'.repeat(40);
function fixture(){
 const streams=new Map(),stream=name=>({events:()=>structuredClone(streams.get(name)??[]),append:event=>streams.set(name,[...(streams.get(name)??[]),structuredClone(event)])});
 const journal={stream};
 const input={releaseSha,previousMainSha:'b'.repeat(40),recoverySha:'c'.repeat(40),protectedInputDigest:'d'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root',inputDigest:'e'.repeat(64)};
 const release={releaseSha,packageConfigurationFile:'/fixed/package.json',n8nBackupFile:'/fixed/backup.json',migrationConfigurationFile:'/fixed/migration-input.json',activationConfigurationFile:'/fixed/activation.json'};
 const state={context:{operationId:randomUUID(),releaseSha,workspace:input.workspace,principal:input.principal}};
 const args={input,state,ordinal:8,attemptId:randomUUID(),inputDigest:'f'.repeat(64),checkOutputDigest:'1'.repeat(64)};
 return{streams,journal,input,release,state,args,context:{input,release,journal}};
}

function n8nFixture(){
 const versionId='cdd141ba-8d20-4981-b598-6af8e35aff86';
 const backup={id:WORKFLOW_ID,name:'Legacy Buyer',nodes:[{id:'legacy',name:'Legacy',type:'n8n-nodes-base.noOp'}],connections:{},settings:{executionOrder:'v1'},active:true,versionId,activeVersionId:versionId};
 backup.activeVersion={versionId,workflowId:WORKFLOW_ID,nodes:backup.nodes,connections:backup.connections};
 const backupBytes=JSON.stringify(backup);
 const configuration={version:1,workflowId:WORKFLOW_ID,workflowVersion:versionId,releaseSha,backupSha256:hash(backupBytes),gatewayOrigin:'https://jarvis.blackspirehelix.com',webhookId:'buyer-engine',ingressCredentialId:'ingress',writerCredentialId:'writer'};
 let current=structuredClone(backup),failAfterMutation=false,unavailable=false,mutations=0;
 const request=async(method,pathname,body)=>{
  if(unavailable)throw new Error('offline');
  if(pathname.startsWith('/api/v1/credentials?'))return{data:[{id:'ingress',type:'httpHeaderAuth'},{id:'writer',type:'httpHeaderAuth'}],nextCursor:null};
  if(pathname.startsWith('/api/v1/executions?'))return{data:[],nextCursor:null};
  if(method==='GET')return structuredClone(current);
  mutations++;
  if(method==='PUT')current={...current,...body,versionId:randomUUID()};
  else if(pathname.endsWith('/deactivate'))current={...current,active:false,activeVersionId:null,activeVersion:null};
  else if(pathname.endsWith('/activate'))current={...current,active:true,activeVersionId:current.versionId,activeVersion:{versionId:current.versionId,workflowId:WORKFLOW_ID,nodes:current.nodes,connections:current.connections}};
  if(failAfterMutation){failAfterMutation=false;unavailable=true;throw new Error('lost');}
  return structuredClone(current);
 };
 return{backupBytes,configuration,request,current:()=>current,fail:()=>{failAfterMutation=true;},restore:()=>{unavailable=false;},mutations:()=>mutations};
}

test('fixed n8n operations verify the backup then journal and confirm the complete live transition',async()=>{
 const f=fixture(),n=n8nFixture();
 const operations=createN8nMigrationProductionOperations(f.context,{n8n:{readJson:()=>n.configuration,readBytes:file=>file.endsWith('key')?'x'.repeat(24):n.backupBytes,request:n.request,verifyWriter:async()=>({})},migration:{readMetadata:()=>({releaseSha,databaseConfigPath:'/fixed/db.json'}),verifyPackage:()=>({releaseSha,status:'PACKAGE_VERIFIED_EXECUTION_GATED',manifestSha256:'2'.repeat(64),bodySha256:'3'.repeat(64),nativeSqlSha256:'4'.repeat(64),connectedQuerySha256:'5'.repeat(64),projectId:'fixed'}) ,connect:async()=>({end:async()=>{}}),execute:async()=>({status:'committed'})}});
 const backup=await operations.n8n_backup_check.check({...f.args,attemptId:undefined,inputDigest:undefined,checkOutputDigest:undefined,ordinal:4});
 assert.equal(backup.evidence.liveBackupMatched,true);
 await operations.n8n_migration.execute(f.args);
 const deployed=await operations.n8n_migration.reconcile(f.args);
 assert.equal(deployed.evidence.transitionConfirmed,true);assert.equal(n.current().active,true);assert.equal(n.mutations(),3);
 const events=f.journal.stream('n8n').events();
 assert.deepEqual(events.filter(row=>row.type==='intent').map(row=>row.operation),['deactivate','update','publish']);
 assert.equal(events.filter(row=>row.type==='confirmed').length,3);
});

test('fixed n8n reconciliation retains the same stage attempt and never retries an unknown dispatch',async()=>{
 const f=fixture(),n=n8nFixture();
 const operations=createN8nMigrationProductionOperations(f.context,{n8n:{readJson:()=>n.configuration,readBytes:()=>n.backupBytes,request:n.request,verifyWriter:async()=>({})},migration:{}});
 n.fail();await assert.rejects(operations.n8n_migration.execute(f.args));assert.equal(n.mutations(),1);
 const pending=f.journal.stream('n8n').events().find(row=>row.type==='intent');assert.equal(pending.operation,'deactivate');
 n.restore();const proof=await operations.n8n_migration.reconcile(f.args);
 assert.equal(proof.evidence.stageAttemptId,f.args.attemptId);assert.equal(n.mutations(),3);
 assert.equal(f.journal.stream('n8n').events().filter(row=>row.type==='intent'&&row.operation==='deactivate').length,1);
});

test('fixed native migration apply and unknown-outcome reconciliation use durable release history',async()=>{
 const f=fixture(),calls=[];
 const migrationInput={releaseSha,databaseConfigPath:'/fixed/db.json'};
 const verified={releaseSha,status:'PACKAGE_VERIFIED_EXECUTION_GATED',manifestSha256:'2'.repeat(64),bodySha256:'3'.repeat(64),nativeSqlSha256:'4'.repeat(64),connectedQuerySha256:'5'.repeat(64),projectId:'fixed'};
 const execute=async({mode,journal})=>{
  calls.push(mode);const stream=journal.stream('release');
  if(mode==='apply'){
   const intent={schema:1,type:'release_migration_intent',operationId:randomUUID(),releaseSha,migrationVersion:'20260911000000',bodySha256:verified.bodySha256,manifestSha256:verified.manifestSha256};
   stream.append(intent);stream.append({...intent,type:'release_migration_result',status:'outcome-unknown'});return{status:'STOPPED'};
  }
  const intent=stream.events().find(row=>row.type==='release_migration_intent');stream.append({...intent,type:'release_migration_result',status:'committed-history-verified'});return{status:'committed-history-verified'};
 };
 const operations=createN8nMigrationProductionOperations(f.context,{n8n:{},migration:{readMetadata:()=>migrationInput,verifyPackage:()=>verified,connect:async()=>({end:async()=>{}}),execute}});
 const initial=await operations.production_migrations.check({...f.args,attemptId:undefined,inputDigest:undefined,checkOutputDigest:undefined});
 assert.equal(initial.evidence.migrationCommitted,false);
 await assert.rejects(operations.production_migrations.execute(f.args));
 const proof=await operations.production_migrations.reconcile(f.args);
 assert.deepEqual(calls,['apply','reconcile']);assert.equal(proof.evidence.migrationStatus,'committed-history-verified');
 assert.equal(proof.evidence.stageAttemptId,f.args.attemptId);
 const post=await operations.migration_postconditions.check({...f.args,attemptId:undefined,inputDigest:undefined,checkOutputDigest:undefined,ordinal:12});
 assert.equal(post.evidence.migrationStatus,'committed-history-verified');assert.deepEqual(calls,['apply','reconcile']);
});
