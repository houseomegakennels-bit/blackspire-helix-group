import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {runReleasePreflight,inspectReleaseCommander} from '../packages/zola-release/commander.js';
import {verifyReleaseArtifactDisk} from '../packages/zola-release/commander-preconditions.js';
import {WORKFLOW_ID} from '../packages/zola-release/commander-n8n.js';
import {hash} from '../packages/zola-release/commander-journal.js';

function fixture(){
 const releaseSha='a'.repeat(40),versionId='cdd141ba-8d20-4981-b598-6af8e35aff86';
 const backup={id:WORKFLOW_ID,name:'Legacy Buyer',nodes:[{id:'legacy',name:'Legacy',type:'n8n-nodes-base.noOp'}],connections:{},settings:{executionOrder:'v1'},active:true,versionId,activeVersionId:versionId};
 backup.activeVersion={versionId,workflowId:WORKFLOW_ID,nodes:backup.nodes,connections:backup.connections};
 const backupBytes=JSON.stringify(backup);
 const configuration={version:1,workflowId:WORKFLOW_ID,workflowVersion:versionId,releaseSha,backupSha256:hash(backupBytes),gatewayOrigin:'https://jarvis.blackspirehelix.com',webhookId:'buyer-engine',ingressCredentialId:'ingress',writerCredentialId:'writer'};
 const input={releaseSha,packageConfigurationFile:'/package',backupFile:'/backup',diskConfigurationFile:'/disk',backupManifestFile:'/backups'};
 const ci={releaseSha,mainSha:'b'.repeat(40),runId:10,runAttempt:1,ciMergeSha:'c'.repeat(40),ciTreeSha:'d'.repeat(40),artifactId:11,artifactZipDigest:'sha256:'+'e'.repeat(64),ciArtifactDigest:'f'.repeat(64),status:'success'};
 const streams={release:[],n8n:[]},calls=[];
 const journal={stream:name=>({events:()=>structuredClone(streams[name]),append:event=>streams[name].push(structuredClone(event))})};
 const deps={readJson:file=>file==='/disk'?{disk:'fixture'}:structuredClone(configuration),
  readBytes:file=>file==='/backup'?backupBytes:'secret-key-never-retain',
  verifySource:()=>{calls.push('source');},verifyCi:()=>{calls.push('ci');return structuredClone(ci);},
  verifyArtifactDisk:async()=>({artifact:{releaseSha},disk:{deploymentSafe:true}}),verifyBackup:async()=>({integrity:'ok'}),
  transport:()=>async(method)=>{calls.push(method);assert.equal(method,'GET');return structuredClone(backup);}};
 const run=()=>runReleasePreflight({input,journal},deps);
 return{input,configuration,ci,streams,calls,journal,deps,run};
}

test('concrete preflight orders gates, retains authenticated CI proof, observes n8n, and stops before missing release gates',async()=>{
 const f=fixture(),result=await f.run();
 assert.equal(result.reason,'RELEASE_GATES_UNWIRED');assert.equal(result.preflightCompleted,true);assert.equal(result.releaseReady,false);
 assert.equal(result.mutationSent,false);assert.equal(result.remainingGates.includes('protected_merge'),true);
 assert.deepEqual(f.calls,['source','ci','GET','GET','source','ci']);
 assert.deepEqual(f.streams.release.filter(e=>e.type==='preflight_passed').map(e=>e.stage),['source','ci','artifact_disk','protected_backup','n8n_package','n8n_live','identity_recheck']);
 assert.deepEqual(f.streams.release[2].proof,f.ci);
 assert.equal(JSON.stringify(f.streams).includes('secret-key'),false);
 assert.equal(inspectReleaseCommander(f.journal).status,'OBSERVED');
 // An observational retry re-runs every gate, never promotes persisted PASS.
 await f.run();assert.equal(f.calls.filter(c=>c==='ci').length,4);
});

for(const stage of ['source','ci','artifact_disk','protected_backup','n8n_package','n8n_live'])test(`${stage} failure closes the prefix without dispatching later gates`,async()=>{
 const f=fixture();
 const fail=()=>{throw new Error('secret-remote-detail');};
 if(stage==='source')f.deps.verifySource=fail;
 if(stage==='ci')f.deps.verifyCi=fail;
 if(stage==='artifact_disk')f.deps.verifyArtifactDisk=fail;
 if(stage==='protected_backup')f.deps.verifyBackup=fail;
 if(stage==='n8n_package')f.configuration.releaseSha='b'.repeat(40);
 if(stage==='n8n_live')f.deps.transport=()=>fail;
 const result=await f.run();assert.equal(result.preflightCompleted,false);assert.equal(result.stage,stage);
 assert.equal(JSON.stringify(result).includes('secret-remote'),false);
 assert.equal(inspectReleaseCommander(f.journal).status,'OBSERVED');
 if(stage!=='n8n_live')assert.equal(f.calls.includes('GET'),false);
});

test('rejects caller-supplied approvals and unknown durable release mutation history',async()=>{
 const f=fixture();f.input.providerAcl=true;
 assert.equal((await f.run()).preflightCompleted,false);assert.equal(f.calls.length,0);
 delete f.input.providerAcl;f.streams.release.push({type:'intent',operation:'merge'});
 assert.equal((await f.run()).preflightCompleted,false);assert.equal(f.calls.length,0);
});

test('n8n pending intent is observed without reconciliation or mutation, then stops',async()=>{
 const f=fixture();await f.run();
 const namespace=f.streams.n8n[0].namespace;
 f.streams.n8n.push({type:'intent',namespace,releaseSha:f.input.releaseSha,operation:'deactivate',target:{kind:'BASELINE',active:false}});
 const result=await f.run();assert.equal(result.stage,'n8n_live');assert.equal(result.preflightCompleted,false);
 assert.equal(f.streams.n8n.some(e=>e.type==='confirmed'),false);
});

test('CI movement after observation and protected package drift cannot become accepted proof',async()=>{
 for(const drift of ['ci','package']){
  const f=fixture();let count=0;
  if(drift==='ci')f.deps.verifyCi=()=>({...f.ci,runId:++count===1?10:12});
  else{const read=f.deps.readJson;f.deps.readJson=file=>file==='/package'&&++count>1?{...f.configuration,webhookId:'changed'}:read(file);}
  const result=await f.run();assert.equal(result.preflightCompleted,false);assert.equal(result.releaseReady,false);
 }
});

test('malformed CI proof, reordered journal stages, and journal append failure fail closed',async()=>{
 const f=fixture();f.ci.status=true;assert.equal((await f.run()).stage,'ci');
 const g=fixture();await g.run();g.streams.release[1].stage='backup';assert.throws(()=>inspectReleaseCommander(g.journal));
 const h=fixture();h.journal.stream=()=>({events:()=>[],append:()=>{throw new Error('disk full');}});
 assert.equal((await h.run()).preflightCompleted,false);assert.equal(h.calls.length,0);
});

test('artifact/disk primitive rejects SHA mismatch, digest movement, unsafe capacity and malformed envelope',async()=>{
 const releaseSha='a'.repeat(40),configuration={artifactRoot:'/artifact/'+releaseSha,databasePath:'/db',releaseRoot:'/releases',buildPeakBytes:0,packagePeakBytes:0,logTempReserveBytes:1};
 const artifact={releaseSha,environment:'production',artifactDigest:'b'.repeat(64)};
 const deps={inspect:async()=>({...artifact}),measure:()=>({deploymentSafe:true,freeBytes:10,requiredBytes:5})};
 assert.equal((await verifyReleaseArtifactDisk({releaseSha,configuration},deps)).artifact.releaseSha,releaseSha);
 await assert.rejects(verifyReleaseArtifactDisk({releaseSha,configuration:{...configuration,artifactRoot:'/wrong'}},deps));
 await assert.rejects(verifyReleaseArtifactDisk({releaseSha,configuration},{...deps,measure:()=>({deploymentSafe:true,freeBytes:1,requiredBytes:5})}));
 let n=0;await assert.rejects(verifyReleaseArtifactDisk({releaseSha,configuration},{...deps,inspect:async()=>({...artifact,artifactDigest:(++n===1?'b':'c').repeat(64)})}));
});

test('CLI rejects execute mode before opening journals or loading credentials',()=>{
 const result=spawnSync(process.execPath,['scripts/zola-release-command.js','--execute','/no-such-input'],{encoding:'utf8'});
 assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).reason,'COMMAND_FAILED_CLOSED');
});

test('migration-aware preflight retains exact package proof and rechecks before stopping closed',async()=>{
 const f=fixture();await f.run(); // Preserve and read historical schema-one records.
 f.input.migrationConfigurationFile='/bundle/migration-input.json';
 let calls=0;
 f.deps.verifyMigration=async ({releaseSha,configurationFile})=>{
  calls++;assert.equal(configurationFile,f.input.migrationConfigurationFile);
  return{releaseSha,manifestSha256:'1'.repeat(64),bodySha256:'2'.repeat(64),nativeSqlSha256:'3'.repeat(64),
   connectedQuerySha256:'4'.repeat(64),projectId:'kchtrvfcixnimvxxctkj',status:'PACKAGE_VERIFIED_EXECUTION_GATED',productionAcceptance:false};
 };
 const result=await f.run();assert.equal(result.preflightCompleted,true);assert.equal(result.releaseReady,false);
 assert.equal(calls,2);
 const records=f.streams.release.filter(row=>row.schema===2);
 assert.deepEqual(records.filter(row=>row.type==='preflight_passed').map(row=>row.stage),
  ['source','ci','artifact_disk','protected_backup','migration_package','n8n_package','n8n_live','identity_recheck']);
 assert.equal(inspectReleaseCommander(f.journal).status,'OBSERVED');
 records[1].schema=1;assert.throws(()=>inspectReleaseCommander(f.journal));
});

test('migration rejection prevents network observation; proof drift and forged approval never pass',async()=>{
 for(const mutation of ['failure','forged','drift']){
  const f=fixture();f.input.migrationConfigurationFile='/bundle/migration-input.json';let calls=0;
  f.deps.verifyMigration=async ()=>{
   if(mutation==='failure')throw new Error('PRIVATE_DATABASE_DETAIL');
   return{releaseSha:f.input.releaseSha,manifestSha256:'1'.repeat(64),bodySha256:'2'.repeat(64),nativeSqlSha256:'3'.repeat(64),
    connectedQuerySha256:(++calls>1?'5':'4').repeat(64),projectId:'kchtrvfcixnimvxxctkj',
    status:'PACKAGE_VERIFIED_EXECUTION_GATED',productionAcceptance:mutation==='forged'};
  };
  const result=await f.run();assert.equal(result.preflightCompleted,false);assert.equal(result.releaseReady,false);
  assert.equal(result.stage,mutation==='drift'?'identity_recheck':'migration_package');
  if(mutation!=='drift')assert.equal(f.calls.includes('GET'),false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_DATABASE'),false);
  assert.equal(inspectReleaseCommander(f.journal).status,'OBSERVED');
 }
});
