import {validateOwnedN8nCloudHistory,createOwnedN8nCloudContinuation,assertOwnedN8nCloudContinuationOperator} from '../packages/zola-release/owned-n8n-cloud-continuation.js';
import {retainOwnedN8nResponse} from '../packages/zola-release/owned-n8n-response-receipt.js';
import {assertOwnedN8nRecoveryAuthority,createOwnedN8nRecoveryContinuation} from '../packages/zola-release/owned-n8n-recovery-authority.js';
import {reassertOwnedN8nWriter,validateOwnedN8nReassertionProof} from '../packages/zola-release/owned-n8n-credential-reassertion.js';
import {observeOwnedN8nConsumerClosure,observeOwnedN8nContinuationClosure} from '../packages/zola-release/owned-n8n-consumer-closure.js';
import {bindOwnedProviderInput} from '../packages/zola-release/owned-provider-input.js';
import {createOwnedRuntimeVpsHost} from '../packages/zola-release/commander-vps.js';
import {createOwnedRuntimeStoreTransition} from '../packages/zola-release/owned-runtime-store.js';
import {queryFixedProviderAcl,createProviderAclCheckOperation} from '../packages/zola-release/production-acl-writer.js';
import {createPgNetIsolationProof} from '../packages/zola-release/pg-net-isolation.js';
import {createOwnedAclObserverPool,verifyOwnedOperatorAclResult} from '../packages/zola-release/owned-acl-operator-observer.js';
// This root-only operator entry is separately reviewed. The canonical CLI's
// test seam is not itself authorization. Fixed owned gateway/provisioning and
// catalog adapters supplement the native phases, alongside the credential gate.
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
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||!['--release','--reassert-credential','--release-cloud-proof'].includes(mode)||process.argv.length!==4)fail();
 // Both the operator worktree and canonical runtime source must remain clean.
 const operatorRoot=fileURLToPath(new URL('../',import.meta.url));
 const git=(root,args)=>execFileSync('/usr/bin/git',['-C',root,...args],{encoding:'utf8',timeout:5000,maxBuffer:65536}).trim();
 const operatorSha=git(operatorRoot,['rev-parse','HEAD']);if(git(operatorRoot,['status','--porcelain']))fail();
 const {loadProductionReleaseInput}=await load('packages/zola-release/production-release-input.js');
 const {runProductionRelease}=await load('packages/zola-release/production-release.js');
 const {createFixedProductionOperations}=await load('packages/zola-release/production-adapters.js');
 const {establishCandidateHeld}=await load('packages/zola-release/production-held-operations.js');
 const {prepareVpsCutoverPlan,runVpsCutover}=await load('packages/zola-release/commander-vps.js');
 const {Pool}=await import('pg');
 const {observeBuyerWriterRuntimeIsolation}=await load('packages/zola-release/pg-net-host-observer.js');
 const {readReleaseProtectedBytes,verifyReleaseSource}=await load('packages/zola-release/commander-host.js');
 const {openReleaseJournal}=await load('packages/zola-release/commander-journal.js');
 const {inspectReleaseSequenceHistory}=await load('packages/zola-release/commander-sequence.js');
 const {readRootOwnedJsonSnapshot,readRootOwnedJsonDigestSnapshot}=await load('packages/buyer-writer/protected-json.js');
 const {readOwnedDatabaseProfile,databaseProfileDigest,validateDatabaseTarget}=await load('packages/buyer-writer/database-profile.js');
 const {validateBuyerWriterConfiguration,validateBuyerWriterGatewayAuthority}=await load('packages/buyer-writer/configuration.js');
 const {createBuyerStoreProtectedFiles}=await load('packages/buyer-store/protected-files.js');
 const {prepareN8nTransition,createN8nTransport,WORKFLOW_ID,N8N_ORIGIN}=await load('packages/zola-release/commander-n8n.js');
 const {lookupBuyerWriterIdentity}=await load('packages/buyer-writer/runtime-identity.js');
 const {installedBuyerWriterManifestPath}=await load('packages/zola-release/installed-buyer-writer.js');
 const {createHeldWriterBindingHost,inspectHeldWriterBindingHistory}=await load('packages/zola-release/held-writer-binding.js');
 const input=loadProductionReleaseInput(inputFile),release=input.value;
 if(![2,3].includes(release.schema)||release.backendProfile!=='owned-postgres-v1')fail();
 verifyReleaseSource(release.releaseSha);journal=openReleaseJournal();
 if(release.releaseSha==='a8e05ef40e44b6695df5b30356af0e411fe36f1a'){const {verifyOwnedSequenceOperator}=await import('../packages/zola-release/owned-sequence-operator-fence.js');verifyOwnedSequenceOperator(release,journal);}
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
 const retained=b=>assertOwnedN8nRecoveryAuthority({original:records(b).value('authority',true),expected:{version:1,operatorSha,...b,profileDigest:release.profileDigest,sourceDigest:hash(source),held:heldRecord(b)},currentOperatorSha:operatorSha});
 const recoveryStore=b=>{
  const directory='/var/lib/blackspire-operator/preparation/owned-n8n-credential-reassertion/'+b.releaseSha+'-'+b.operationId;
  if(mode==='--reassert-credential')files.directory(directory,{create:true});
  return {value:(name,optional)=>{if(!['intent','http-ack','result','transport-headers','transport-body'].includes(name))fail();const file=directory+'/'+name+'.json',final=files.value(file,optional),staged=files.value(file+'.pending',true);if(final&&staged)fail();if(mode!=='--reassert-credential'&&staged)fail();return final??staged;},record:(name,value)=>{if(mode!=='--reassert-credential'||!['intent','http-ack','result','transport-headers','transport-body'].includes(name))fail();files.directory(directory,{create:true});return files.record(directory+'/'+name+'.json',value);}};
 };
 const recoveryInputs=b=>({authority:retained(b),originalIntent:records(b).value('intent',true),originalResult:records(b).value('result',true),source:v,operatorSha});
 const recoveryProof=b=>{const store=recoveryStore(b),proof=validateOwnedN8nReassertionProof({...recoveryInputs(b),intent:store.value('intent',true),httpAck:store.value('http-ack',true),result:store.value('result',true)}),headers=store.value('transport-headers',true),body=store.value('transport-body',true),ack=store.value('http-ack',true);
  if(!same(headers,{version:1,status:200,method:'PATCH',credentialId:'RzOyDmXYmx58yZHi',bodyDigest:proof.bodyDigest,operatorSha})||body?.version!==1||body.complete!==true||body.status!==200||body.responseDigest!==ack.responseDigest||!/^[a-f0-9]{64}$/.test(body.rawDigest??'')||!Number.isInteger(body.bytes)||body.bytes<1||body.bytes>2*1024*1024)fail();return proof;};
 const protectedSnapshot=(b,record,identity)=>{
  verifyReleaseSource(release.releaseSha);
  if(!same(currentBinding(),b)||git(operatorRoot,['rev-parse','HEAD'])!==operatorSha||git(operatorRoot,['status','--porcelain'])
   ||!same(source,read(sourceFile))||!same(configuration,read(release.packageConfigurationFile))||backup!==readReleaseProtectedBytes(release.n8nBackupFile,2*1024*1024)||!same(profile,readOwnedDatabaseProfile())||key!==readReleaseProtectedBytes(keyFile,16384).trim())fail();
  const manifest=readRootOwnedJsonDigestSnapshot(installedBuyerWriterManifestPath(release.releaseSha),{groupId:0,maxBytes:16384});
  if(!/^\/etc\/blackspire\/buyer-writer-ingress-[a-f0-9]{64}\.json$/.test(manifest.value.ingressConfig?.path??''))fail();
  const ingress=readRootOwnedJsonDigestSnapshot(manifest.value.ingressConfig.path,{groupId:identity.credentialGroupId,maxBytes:65536});
  assertOwnedN8nInstalledIngress({manifest,ingress,source:v,releaseSha:release.releaseSha,artifactDigest:record.plan.artifactDigest});
  return {manifest,ingress,authority:retained(b),originalIntent:records(b).value('intent',true),originalResult:records(b).value('result',true)};
 };
 const withRecoveryFence=async(b,action)=>{
  const record=heldRecord(b),authority=retained(b),host=createHeldWriterBindingHost(),identity=await lookupBuyerWriterIdentity();
  const originalIntent=records(b).value('intent',true);if(!originalIntent||records(b).value('result',true)!==null)fail();
  const deadline=Date.now()+15*60*1000;
  const fence=async()=>{await verifyOwnedN8nProtectedAsyncFence({snapshot:()=>{if(Date.now()>=deadline||!same(authority,retained(b))||!same(originalIntent,records(b).value('intent',true))||records(b).value('result',true)!==null)fail();return protectedSnapshot(b,record,identity);},verifyAsync:async()=>{
   await host.check(record.plan);const proof=await host.inspect(record.plan);if(proof.bindingDigest!==record.result.bindingDigest||proof.commitDigest!==record.result.commitDigest)fail();
  }});};
  try{await host.lease(release.releaseSha);await fence();const result=await action(fence);await fence();return result;}finally{host.close();}
 };
 // Both gate callbacks only observe the distinct acknowledged recovery proof.
 const cloudProof=async b=>{
  const {readCompletedOwnedN8nCloudProof}=await import('../packages/zola-release/owned-n8n-cloud-host.js');
  const complete=await readCompletedOwnedN8nCloudProof({releaseSha:b.releaseSha,operationId:b.operationId,stageAttemptId:b.stageAttemptId});
  const store=recoveryStore(b),history=validateOwnedN8nCloudHistory({authority:retained(b),originalIntent:records(b).value('intent',true),originalResult:records(b).value('result',true),source:v,plan:complete.plan,
   reassertion:{intent:store.value('intent',true),httpAck:store.value('http-ack',true),result:store.value('result',true),headers:store.value('transport-headers',true),body:store.value('transport-body',true)}});
  const identity=await lookupBuyerWriterIdentity(),snapshot=protectedSnapshot(b,heldRecord(b),identity);
  assertOwnedN8nCloudContinuationOperator({plan:complete.plan,workflowCreated:complete.workflowCreated,adoption:complete.adoption,currentOperatorSha:operatorSha});
  if(complete.plan.ingressDigest!==snapshot.ingress.digest||!same(complete.initialClosure,history.initialClosure))fail();
  return {after:complete.credentialMetadata,initialClosure:complete.initialClosure,history,receiptDigest:complete.receiptDigest,plan:complete.plan};
 };
 const metadata=()=>createOwnedN8nCredentialTransport(key)('GET','/api/v1/credentials/RzOyDmXYmx58yZHi');
 const closure=(b,initialClosure)=>observeOwnedN8nContinuationClosure({request:reassertRequest,tokenSubject:JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8')).sub,plan,events:scopedJournal.stream('n8n').events(),initialClosure});
 const {assertConfigured,synchronize}=mode==='--release-cloud-proof'
  ?createOwnedN8nCloudContinuation({withFence:withRecoveryFence,proof:cloudProof,metadata,closure})
  :createOwnedN8nRecoveryContinuation({withFence:withRecoveryFence,proof:recoveryProof,metadata:async()=>{const b=currentBinding();await closure(b,recoveryStore(b).value('intent',true)?.closure);return metadata();}});
 const reassertRequest=async(method,route,body)=>{
  if(method==='GET'){if(body!==undefined||!/^\/api\/v1\/(?:users|projects|workflows|executions)(?:\?[^#]*)?$/.test(route)&&route!=='/api/v1/credentials/RzOyDmXYmx58yZHi'&&route!=='/api/v1/workflows/'+WORKFLOW_ID)fail();}
  else if(mode!=='--reassert-credential'||method!=='PATCH'||route!=='/api/v1/credentials/RzOyDmXYmx58yZHi'||!same(body,{data:{name:'x-buyer-writer-key',value:v.writerCredential,allowedHttpRequestDomains:'domains',allowedDomains:'jarvis.blackspirehelix.com'},isPartialData:false}))fail();
  const r=await fetch(N8N_ORIGIN+route,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{'X-N8N-API-KEY':key,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return retainOwnedN8nResponse(r,{store:method==='PATCH'?recoveryStore(currentBinding()):null,bodyDigest:body?hash(body):null,operatorSha});
 };
 const administrativeReassertion=async()=>{
  const b=currentBinding();initializeSource();
  const events=scopedJournal.stream('n8n').events();if(!events.some(e=>e.type==='confirmed'&&e.operation==='deactivate'&&e.state?.active===false)||events.some(e=>e.type==='intent'&&e.operation!=='deactivate'))fail();
  const tokenSubject=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8')).sub;
  return withRecoveryFence(b,fence=>reassertOwnedN8nWriter(recoveryInputs(b),{request:reassertRequest,store:recoveryStore(b),fence,closure:()=>observeOwnedN8nConsumerClosure({request:reassertRequest,tokenSubject})}));
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
  const activate=async activation=>{
   if(release.schema===3){const {activateOwnedSuccessorBeforeHeld}=await load('packages/zola-release/owned-successor-activation.js');
    return activateOwnedSuccessorBeforeHeld({...activation,profileDigest:release.profileDigest,successorLineageFile:release.successorLineageFile},{journal:scopedJournal});}
   return activateBuyerWriterBeforeHeld({...activation,backendProfile:release.backendProfile,profileDigest:release.profileDigest},{journal:scopedJournal,
   paths:{upgradeStateDirectory:'/var/lib/blackspire-operator/owned-gateway-transition'},
   run:(script,args)=>{
    verifyReleaseSource(release.releaseSha);
    if(git(operatorRoot,['rev-parse','HEAD'])!==operatorSha||git(operatorRoot,['status','--porcelain']))fail();
    const replacements={'scripts/zola-config-install.js':'scripts/zola-owned-config-install.js','scripts/prepare-buyer-writer-gateway-v4.js':'scripts/prepare-owned-gateway-transition.js','scripts/upgrade-buyer-writer-gateway-configuration.js':'scripts/upgrade-owned-gateway-transition.js','scripts/provision-buyer-writer-production.js':'scripts/provision-owned-buyer-writer-production.js'};
    const selected=replacements[script]?operatorRoot+replacements[script]:script;
    const stdout=execFileSync('/bin/bash',['scripts/with-node.sh',selected,...args],{cwd:canonical,encoding:'utf8',timeout:120000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',LANG:'C'}});
    verifyReleaseSource(release.releaseSha);if(git(operatorRoot,['rev-parse','HEAD'])!==operatorSha||git(operatorRoot,['status','--porcelain']))fail();return JSON.parse(stdout);
   }});
  };
  const providerQuery=async(sql,values)=>{verifyReleaseSource(release.releaseSha);if(git(operatorRoot,['rev-parse','HEAD'])!==operatorSha||git(operatorRoot,['status','--porcelain']))fail();
   const result=await queryFixedProviderAcl('/etc/blackspire-buyer-writer-gateway/gateway.json',sql,values,{Pool:createOwnedAclObserverPool(Pool,profile),verifyAcl:verifyOwnedOperatorAclResult});
   verifyReleaseSource(release.releaseSha);if(git(operatorRoot,['rev-parse','HEAD'])!==operatorSha||git(operatorRoot,['status','--porcelain']))fail();return result;};
  const deployment={prepareVps:input=>prepareVpsCutoverPlan(input,{host:createOwnedRuntimeVpsHost()}),runVps:(input,options)=>runVpsCutover(input,{...options,host:createOwnedRuntimeVpsHost()})};
  const fixed=createFixedProductionOperations({...context,journal:scopedJournal},{providerQuery,deployment,n8nMigration:{n8n:{request:routed}},held:{activate,establishHeld:()=>establishCandidateHeld({...context,journal:scopedJournal},{ownedStore:()=>createOwnedRuntimeStoreTransition()})}});
  const isolationProof=createPgNetIsolationProof({query:providerQuery,verifyRuntimeIsolation:()=>observeBuyerWriterRuntimeIsolation({releaseSha:release.releaseSha,gatewayConfigurationFile:'/etc/blackspire-buyer-writer-gateway/gateway.json'})});
  const providerOperation=createProviderAclCheckOperation({query:providerQuery,isolationProof,backendProfile:release.backendProfile,profileDigest:release.profileDigest,verifyAcl:verifyOwnedOperatorAclResult});
  const providerAdapter=release.schema===3?bindOwnedProviderInput({operation:providerOperation,input:context.input,release,protectedInputDigest:input.inputDigest,fence:()=>{
   const fresh=loadProductionReleaseInput(inputFile);
   if(!same(fresh,input)||databaseProfileDigest(readOwnedDatabaseProfile())!==release.profileDigest||git(operatorRoot,['rev-parse','HEAD'])!==operatorSha||git(operatorRoot,['status','--porcelain']))fail();
   return {input:fresh,operatorSha,profileDigest:release.profileDigest};
  }}):providerOperation;
  return {...fixed,provider_acl_check:providerAdapter};
 };
 const result=mode==='--reassert-credential'?await administrativeReassertion():await runProductionRelease({loadedInput:input,journal},{operations});
 process.stdout.write(JSON.stringify(mode==='--reassert-credential'?{status:'OWNED_N8N_CREDENTIAL_REASSERTED',proofDigest:hash(result),originalOutcome:'UNKNOWN',providerExtraEffects:'UNVERIFIED',releaseReady:false}:result)+'\n');if(mode!=='--reassert-credential'&&!['COMPLETE','OBSERVED'].includes(result.status))process.exitCode=1;
}catch{process.stdout.write(JSON.stringify({status:'STOPPED',reason:'OWNED_N8N_OPERATOR_REJECTED',releaseReady:false,reconciliationRequired:true})+'\n');process.exitCode=1;}
finally{journal?.close();}
