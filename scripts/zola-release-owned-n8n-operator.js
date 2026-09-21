// This root-only operator entry is separately reviewed. The canonical CLI's
// test seam is not itself authorization: all adapters below remain fixed native
// implementations, with only the exact workflow transport credential gate added.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {assertOwnedN8nInstalledIngress,verifyOwnedN8nProtectedAsyncFence,createOwnedN8nLazySource} from '../packages/zola-release/owned-n8n-installed-fence.js';
import {activateBuyerWriterBeforeHeld} from '../packages/zola-release/buyer-writer-activation.js';
import {createOwnedN8nRetiredJournalView} from '../packages/zola-release/owned-n8n-retired-journal.js';
import {createOwnedN8nRequestGate} from '../packages/zola-release/owned-n8n-request-gate.js';
import {synchronizeOwnedN8nWriter,createOwnedN8nCredentialTransport} from '../packages/zola-release/owned-n8n-credential.js';
const canonical='/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921/';
const load=p=>import(canonical+p),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=()=>{throw new Error('Owned n8n operator stopped');};
let journal;
try{
 const [mode,inputFile]=process.argv.slice(2);
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||mode!=='--release'||process.argv.length!==4)fail();
 // Both the operator worktree and canonical runtime source must remain clean.
 const operatorRoot=fileURLToPath(new URL('../',import.meta.url));
 const git=(root,args)=>execFileSync('/usr/bin/git',['-C',root,...args],{encoding:'utf8',timeout:5000,maxBuffer:65536}).trim();
 const operatorSha=git(operatorRoot,['rev-parse','HEAD']);if(git(operatorRoot,['status','--porcelain']))fail();
 const {loadProductionReleaseInput}=await load('packages/zola-release/production-release-input.js');
 const {runProductionRelease}=await load('packages/zola-release/production-release.js');
 const {createFixedProductionOperations}=await load('packages/zola-release/production-adapters.js');
 const {readReleaseProtectedBytes,verifyReleaseSource}=await load('packages/zola-release/commander-host.js');
 const {openReleaseJournal}=await load('packages/zola-release/commander-journal.js');
 const {inspectReleaseSequenceHistory}=await load('packages/zola-release/commander-sequence.js');
 const {readRootOwnedJsonSnapshot,readRootOwnedJsonDigestSnapshot}=await load('packages/buyer-writer/protected-json.js');
 const {readOwnedDatabaseProfile,databaseProfileDigest,validateDatabaseTarget}=await load('packages/buyer-writer/database-profile.js');
 const {validateBuyerWriterConfiguration,validateBuyerWriterGatewayAuthority}=await load('packages/buyer-writer/configuration.js');
 const {createBuyerStoreProtectedFiles}=await load('packages/buyer-store/protected-files.js');
 const {prepareN8nTransition,createN8nTransport,WORKFLOW_ID}=await load('packages/zola-release/commander-n8n.js');
 const {lookupBuyerWriterIdentity}=await load('packages/buyer-writer/runtime-identity.js');
 const {installedBuyerWriterManifestPath}=await load('packages/zola-release/installed-buyer-writer.js');
 const {createHeldWriterBindingHost,inspectHeldWriterBindingHistory}=await load('packages/zola-release/held-writer-binding.js');
 const input=loadProductionReleaseInput(inputFile),release=input.value;
 if(release.schema!==2||release.backendProfile!=='owned-postgres-v1')fail();
 verifyReleaseSource(release.releaseSha);journal=openReleaseJournal();
 const read=file=>readRootOwnedJsonSnapshot(file,{groupId:0,maxBytes:65536});
 const sourceFile='/var/lib/blackspire-operator/preparation/owned-gateway-provisioning.json';
 let source,v;
 const configuration=read(release.packageConfigurationFile),backup=readReleaseProtectedBytes(release.n8nBackupFile,2*1024*1024),profile=readOwnedDatabaseProfile();
 const keyFile='/var/lib/blackspire-operator/n8n-api-key',key=readReleaseProtectedBytes(keyFile,16384).trim();
 if(databaseProfileDigest(profile)!==release.profileDigest)fail();
 const plan=prepareN8nTransition({configuration:configuration.value,backupBytes:backup});if(plan.releaseSha!==release.releaseSha)fail();
 const scopedJournal=createOwnedN8nRetiredJournalView({journal,release,plan});
 const files=createBuyerStoreProtectedFiles(),root='/var/lib/blackspire-operator/preparation/owned-n8n-held-writer';files.directory(root,{create:true});
 const currentBinding=()=>{
  const state=inspectReleaseSequenceHistory(journal.stream('release').events());
  if(state.context?.releaseSha!==release.releaseSha||state.pending?.stage!=='n8n_migration')fail();
  return {namespace:plan.namespace,releaseSha:release.releaseSha,operationId:state.context.operationId,stageAttemptId:state.pending.attemptId};
 };
 const records=b=>{
  const directory=root+'/'+b.operationId;files.directory(directory,{create:true});
  return {value:(name,optional)=>files.value(directory+'/'+name+'.json',optional),record:(name,value)=>files.record(directory+'/'+name+'.json',value)};
 };
 const heldRecord=b=>{
  const record=inspectHeldWriterBindingHistory(journal.stream('release').events()).get('admission_lease');
  if(!record?.result||record.plan.releaseSha!==b.releaseSha||record.plan.operationId!==b.operationId)fail();return record;
 };
 const captureSource=createOwnedN8nLazySource({binding:currentBinding,read:()=>read(sourceFile),validate:(snapshot,b)=>{
  const v=snapshot.value,record=heldRecord(b);
 if(!same(Object.keys(v).sort(),['authority','bindingFile','creatorOid','gatewayCapability','issuer','issuerCredential','runtime','version','workspace','writerCredential'])||v.version!==3||v.workspace!=='blackspire-command'||v.authority?.releaseSha!==release.releaseSha||v.runtime?.backendProfile!=='owned-postgres-v1'||v.issuer?.backendProfile!=='owned-postgres-v1'||databaseProfileDigest(profile)!==release.profileDigest)fail();
 validateBuyerWriterGatewayAuthority(v.authority,{workspace:v.workspace});
 validateBuyerWriterConfiguration({version:1,workspace:v.workspace,bindingFile:v.bindingFile,writerCredential:v.writerCredential,issuerCredential:v.issuerCredential,creatorOid:v.creatorOid,runtime:v.runtime,issuer:v.issuer},{workspace:v.workspace,environment:'production'});
 validateDatabaseTarget(v.runtime,{ownedProfile:profile});validateDatabaseTarget(v.issuer,{ownedProfile:profile});
 if(new Set([v.writerCredential,v.issuerCredential,v.gatewayCapability,v.runtime.password,v.issuer.password]).size!==5)fail();
  if(v.authority.operationId!==b.operationId||v.authority.attemptId!==record.plan.attemptId)fail();
 }});
 const initializeSource=()=>{source=captureSource();v=source.value;};
 const retained=b=>({version:1,operatorSha,...b,profileDigest:release.profileDigest,sourceDigest:hash(source),held:heldRecord(b)});
 const protectedSnapshot=(b,record,identity)=>{
  verifyReleaseSource(release.releaseSha);
  if(!same(currentBinding(),b)||git(operatorRoot,['rev-parse','HEAD'])!==operatorSha||git(operatorRoot,['status','--porcelain'])
   ||!same(source,read(sourceFile))||!same(configuration,read(release.packageConfigurationFile))||backup!==readReleaseProtectedBytes(release.n8nBackupFile,2*1024*1024)||!same(profile,readOwnedDatabaseProfile())||key!==readReleaseProtectedBytes(keyFile,16384).trim())fail();
  const manifest=readRootOwnedJsonDigestSnapshot(installedBuyerWriterManifestPath(release.releaseSha),{groupId:0,maxBytes:16384});
  if(!/^\/etc\/blackspire\/buyer-writer-ingress-[a-f0-9]{64}\.json$/.test(manifest.value.ingressConfig?.path??''))fail();
  const ingress=readRootOwnedJsonDigestSnapshot(manifest.value.ingressConfig.path,{groupId:identity.credentialGroupId,maxBytes:65536});
  assertOwnedN8nInstalledIngress({manifest,ingress,source:v,releaseSha:release.releaseSha,artifactDigest:record.plan.artifactDigest});
  return {manifest,ingress,authority:retained(b)};
 };
 const assertConfigured=async b=>{
  const store=records(b),binding=retained(b),intent=store.value('intent',true),result=store.value('result',true);
  if(!same(store.value('authority',true),binding)||!intent||!result||!same(intent.binding,result.binding)||result.binding.sourceDigest!==binding.sourceDigest||result.binding.profileDigest!==binding.profileDigest||result.binding.namespace!==b.namespace)fail();
  const host=createHeldWriterBindingHost(),record=heldRecord(b),identity=await lookupBuyerWriterIdentity();
  try{await host.lease(release.releaseSha);
   await verifyOwnedN8nProtectedAsyncFence({snapshot:()=>protectedSnapshot(b,record,identity),verifyAsync:async()=>{
    await host.check(record.plan);const metadata=await createOwnedN8nCredentialTransport(key)('GET','/api/v1/credentials/RzOyDmXYmx58yZHi');
    if(!same(metadata,result.after))fail();const proof=await host.inspect(record.plan);
    if(proof.bindingDigest!==record.result.bindingDigest||proof.commitDigest!==record.result.commitDigest)fail();
   }});
  }finally{host.close();}
 };
 const synchronize=async b=>{
  const store=records(b),record=heldRecord(b),authority=retained(b),host=createHeldWriterBindingHost();
  const deadline=Date.now()+15*60*1000,identity=await lookupBuyerWriterIdentity();
  const fence=async()=>{
   const snapshot=()=>{if(Date.now()>=deadline||!same(authority,retained(b)))fail();return protectedSnapshot(b,record,identity);};
   await verifyOwnedN8nProtectedAsyncFence({snapshot,verifyAsync:async()=>{
    await host.check(record.plan);const proof=await host.inspect(record.plan);
    if(proof.bindingDigest!==record.result.bindingDigest||proof.commitDigest!==record.result.commitDigest)fail();
   }});
  };
  try{
   await host.lease(release.releaseSha);await fence();
   const prior=store.value('authority',true);if(prior&&!same(prior,authority))fail();if(!prior)store.record('authority',authority);
   await synchronizeOwnedN8nWriter({plan,writerCredential:v.writerCredential,profileDigest:release.profileDigest,sourceDigest:hash(source)},
    {store,request:createOwnedN8nCredentialTransport(key),fence});
  }finally{host.close();}
 };
 const transport=createN8nTransport(key);
 const operations=context=>{
  const request=createOwnedN8nRequestGate({request:transport,events:()=>scopedJournal.stream('n8n').events(),binding:currentBinding,synchronize,assertConfigured,workflowId:WORKFLOW_ID});
  // Other n8n stages inspect before the migration attempt exists. Only route
  // through the gate during the exact pending migration; all others stay native.
  const routed=(...args)=>{
   if(inspectReleaseSequenceHistory(journal.stream('release').events()).pending?.stage!=='n8n_migration')return transport(...args);
   initializeSource();return request(...args);
  };
  const activate=activation=>activateBuyerWriterBeforeHeld({...activation,backendProfile:release.backendProfile,profileDigest:release.profileDigest},{journal:scopedJournal,
   paths:{upgradeStateDirectory:'/var/lib/blackspire-operator/owned-gateway-transition'},
   run:(script,args)=>{
    verifyReleaseSource(release.releaseSha);
    if(git(operatorRoot,['rev-parse','HEAD'])!==operatorSha||git(operatorRoot,['status','--porcelain']))fail();
    const replacements={'scripts/prepare-buyer-writer-gateway-v4.js':'scripts/prepare-owned-gateway-transition.js','scripts/upgrade-buyer-writer-gateway-configuration.js':'scripts/upgrade-owned-gateway-transition.js'};
    const selected=replacements[script]?operatorRoot+replacements[script]:script;
    const stdout=execFileSync('/bin/bash',['scripts/with-node.sh',selected,...args],{cwd:canonical,encoding:'utf8',timeout:120000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',LANG:'C'}});
    verifyReleaseSource(release.releaseSha);if(git(operatorRoot,['rev-parse','HEAD'])!==operatorSha||git(operatorRoot,['status','--porcelain']))fail();return JSON.parse(stdout);
   }});
  return createFixedProductionOperations({...context,journal:scopedJournal},{n8nMigration:{n8n:{request:routed}},held:{activate}});
 };
 const result=await runProductionRelease({loadedInput:input,journal},{operations});
 process.stdout.write(JSON.stringify(result)+'\n');if(!['COMPLETE','OBSERVED'].includes(result.status))process.exitCode=1;
}catch{process.stdout.write(JSON.stringify({status:'STOPPED',reason:'OWNED_N8N_OPERATOR_REJECTED',releaseReady:false,reconciliationRequired:true})+'\n');process.exitCode=1;}
finally{journal?.close();}
