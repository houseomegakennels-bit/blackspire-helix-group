import {createHash} from 'node:crypto';
import pg from 'pg';
import {readRootOwnedJson,readRootOwnedMetadataSnapshot} from '../buyer-writer/protected-json.js';
import {hash} from './commander-journal.js';
import {prepareN8nTransition,createN8nTransport,executeN8nTransition} from './commander-n8n.js';
import {verifyReleaseMigrationPackage,executeReleaseNativeMigration,inspectReleaseMigrationState} from './commander-migration.js';
import {readReleaseProtectedBytes,verifyCanonicalWriter} from './commander-host.js';

const N8N_KEY_FILE='/var/lib/blackspire-operator/n8n-api-key';
const DATABASE_HOST='db.kchtrvfcixnimvxxctkj.supabase.co';
const CA_SHA256='700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const reject=()=>{throw new Error('Fixed n8n/migration production operation rejected');};

function binding(context,args,{attempt=false}={}){
 const {input,state}=args??{};
 if(JSON.stringify(input)!==JSON.stringify(context.input)||!sha(input?.releaseSha)||!uuid(state?.context?.operationId)
  ||state.context.releaseSha!==input.releaseSha||state.context.workspace!==input.workspace||state.context.principal!==input.principal
  ||!Number.isSafeInteger(args?.ordinal)||args.ordinal<0)reject();
 const value={releaseSha:input.releaseSha,operationId:state.context.operationId,workspace:input.workspace,principal:input.principal,ordinal:args.ordinal};
 if(attempt){
  if(!uuid(args.attemptId)||!digest(args.inputDigest)||!digest(args.checkOutputDigest))reject();
  value.stageAttemptId=args.attemptId;
 }
 return value;
}

function fixedN8n(context,dependencies={}){
 const readJson=dependencies.readJson??(file=>readRootOwnedJson(file,{groupId:0}));
 const readBytes=dependencies.readBytes??readReleaseProtectedBytes;
 const getPlan=()=>{
  const configuration=readJson(context.release.packageConfigurationFile);
  if(configuration.releaseSha!==context.input.releaseSha)reject();
  return prepareN8nTransition({configuration,backupBytes:readBytes(context.release.n8nBackupFile,2*1024*1024)});
 };
 const getRequest=()=>dependencies.request??createN8nTransport(readBytes(N8N_KEY_FILE,16384).trim());
 const writer=()=>dependencies.verifyWriter?dependencies.verifyWriter():verifyCanonicalWriter(context.input.releaseSha,context.release.activationConfigurationFile);
 const inspect=async(args,{attempt=false}={})=>{
  const bound=binding(context,args,{attempt}),plan=getPlan();
  const result=await executeN8nTransition({plan,mode:'inspect',request:getRequest(),journal:context.journal.stream('n8n')});
  return{bound,plan,result};
 };
 const proof=(stage,bound,plan,state,extra={})=>Object.freeze({status:'PASS',evidence:Object.freeze({stage,...bound,
  workflowNamespace:plan.namespace,backupSha256:plan.backupSha256,workflowState:state.kind,workflowActive:state.active,
  workflowVersion:state.versionId,...extra})});
 const backupObserve=async(args,{attempt=false}={})=>{
  const {bound,plan,result}=await inspect(args,{attempt});
  if(result.state.kind!=='BASELINE'||result.state.active!==true)reject();
  return proof('n8n_backup_check',bound,plan,result.state,{liveBackupMatched:true});
 };
 const backup=Object.freeze({
  check:args=>backupObserve(args),execute:args=>backupObserve(args,{attempt:true}),
  observe:args=>backupObserve(args,{attempt:true}),reconcile:args=>backupObserve(args,{attempt:true}),
 });
 const advance=async(args,reconcileFirst)=>{
  const bound=binding(context,args,{attempt:true}),plan=getPlan(),request=getRequest(),journal=context.journal.stream('n8n');
  const invoke=mode=>executeN8nTransition({plan,mode,request,journal,verifyWriter:writer,
   exclusiveWindowUntil:new Date(Date.now()+10*60*1000).toISOString()});
  let result=await invoke(reconcileFirst?'reconcile':'inspect');
  if(result.state.kind==='BASELINE'&&result.state.active)result=await invoke('deactivate');
  if(result.state.kind==='BASELINE'&&!result.state.active)result=await invoke('update');
  if(result.state.kind==='CANDIDATE'&&!result.state.active)result=await invoke('publish');
  if(result.state.kind!=='CANDIDATE'||result.state.active!==true)reject();
  return proof('n8n_migration',bound,plan,result.state,{transitionConfirmed:true});
 };
 const migration=Object.freeze({
  check:async args=>{const {bound,plan,result}=await inspect(args);return proof('n8n_migration',bound,plan,result.state,{transitionEligible:true});},
  execute:args=>advance(args,false),observe:args=>advance(args,true),reconcile:args=>advance(args,true),
 });
 return{n8n_backup_check:backup,n8n_migration:migration};
}

function validateCredential(value){
 if(!value||Object.keys(value).sort().join(',')!=='ca,host,password'||value.host!==DATABASE_HOST
  ||typeof value.password!=='string'||value.password.length<16||value.password.length>4096
  ||typeof value.ca!=='string'||!value.ca.startsWith('-----BEGIN CERTIFICATE-----')
  ||createHash('sha256').update(value.ca).digest('hex')!==CA_SHA256)reject();
 return value;
}

function fixedMigrations(context,dependencies={}){
 const readMetadata=dependencies.readMetadata??(file=>readRootOwnedMetadataSnapshot(file,{groupId:0}).value);
 const verifyPackage=dependencies.verifyPackage??verifyReleaseMigrationPackage;
 const packageProof=()=>verifyPackage({releaseSha:context.input.releaseSha,configurationFile:context.release.migrationConfigurationFile});
 const migrationInput=()=>{
  const value=readMetadata(context.release.migrationConfigurationFile);
  if(value.releaseSha!==context.input.releaseSha||typeof value.databaseConfigPath!=='string')reject();
  return value;
 };
 const connect=dependencies.connect??(async input=>{
  const credential=validateCredential(readRootOwnedJson(input.databaseConfigPath,{groupId:0,maxBytes:65536}));
  const client=new pg.Client({host:credential.host,port:5432,database:'postgres',user:'postgres',password:credential.password,
   ssl:{rejectUnauthorized:true,ca:credential.ca},connectionTimeoutMillis:5000,query_timeout:35000,
   application_name:'zola-guarded-application-migration'});
  client.on('error',()=>{});await client.connect();return client;
 });
 const packageEvidence=(stage,args)=>{
  const bound=binding(context,args),verified=packageProof();
  if(verified.releaseSha!==context.input.releaseSha||verified.status!=='PACKAGE_VERIFIED_EXECUTION_GATED')reject();
  return Object.freeze({status:'PASS',evidence:Object.freeze({stage,...bound,releaseSha:verified.releaseSha,
   manifestSha256:verified.manifestSha256,bodySha256:verified.bodySha256,nativeSqlSha256:verified.nativeSqlSha256,
   connectedQuerySha256:verified.connectedQuerySha256,projectId:verified.projectId,packageVerified:true})});
 };
 const preflight=Object.freeze({check:args=>packageEvidence('migration_preflight',args),observe:args=>packageEvidence('migration_preflight',args)});
 const stateProof=(stage,args,{attempt=false,required})=>{
  const bound=binding(context,args,{attempt}),state=inspectReleaseMigrationState(context.journal.stream('release').events());
  if(state.intent&&state.intent.releaseSha!==context.input.releaseSha
   ||required&&(!state.intent||!['committed','committed-history-verified'].includes(state.lastStatus)))reject();
  return Object.freeze({status:'PASS',evidence:Object.freeze({stage,...bound,migrationCommitted:Boolean(state.intent),
   migrationStatus:state.lastStatus??'not-started',migrationReconciliationRequired:state.reconciliationRequired})});
 };
 const run=async(args,mode)=>{
  binding(context,args,{attempt:true});packageProof();const input=migrationInput(),client=await connect(input);
  try{
   const result=await (dependencies.execute??executeReleaseNativeMigration)({input,client,journal:context.journal,mode});
   if(!['committed','committed-history-verified'].includes(result?.status))reject();
  }finally{await client.end().catch(()=>{});}
 };
 const migrations=Object.freeze({check:args=>stateProof('production_migrations',args,{required:false}),
  execute:args=>run(args,'apply'),observe:args=>stateProof('production_migrations',args,{attempt:true,required:true}),
  reconcile:async args=>{await run(args,'reconcile');return stateProof('production_migrations',args,{attempt:true,required:true});}});
 const postconditions=Object.freeze({
  check:async args=>{packageEvidence('migration_postconditions',args);
   const prior=inspectReleaseMigrationState(context.journal.stream('release').events());
   if(prior.lastStatus==='committed'){
    const input=migrationInput(),client=await connect(input);
    try{const result=await (dependencies.execute??executeReleaseNativeMigration)({input,client,journal:context.journal,mode:'reconcile'});
     if(result?.status!=='committed-history-verified')reject();}finally{await client.end().catch(()=>{});}
   }else if(prior.lastStatus!=='committed-history-verified')reject();
   return stateProof('migration_postconditions',args,{required:true});},
  observe:args=>stateProof('migration_postconditions',args,{required:true}),
 });
 return{migration_preflight:preflight,production_migrations:migrations,migration_postconditions:postconditions};
}

export function createN8nMigrationProductionOperations(context,dependencies={}){
 if(!context?.release||context.release.releaseSha!==context.input?.releaseSha||typeof context.journal?.stream!=='function')reject();
 return Object.freeze({...fixedN8n(context,dependencies.n8n),...fixedMigrations(context,dependencies.migration)});
}
