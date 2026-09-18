import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {BUYER_WRITER_INSTALLER_SHA256} from '../../packages/buyer-writer/production-provisioner.js';

const EXPECTED_HOST='db.kchtrvfcixnimvxxctkj.supabase.co';
const INSTALLER=fileURLToPath(new URL('../../packages/buyer-writer/sql/install.sql',import.meta.url));
const PROVISIONER=fileURLToPath(new URL('../../packages/buyer-writer/production-provisioner.js',import.meta.url));
const VERIFIER=fileURLToPath(new URL('../../packages/buyer-writer/production-verifier.js',import.meta.url));
const MODES=Object.freeze(['inspect','apply','reconcile','verify','rollback']);
const TARGET_KEYS=Object.freeze(['version','environment','host','port','database','actor','creatorOid','serverMajor']);
const IMPACT_KEYS=Object.freeze(['version','capturedAt','targetDescriptorSha256','installerSha256','unexpectedRoles',
 'unexpectedObjects','unexpectedAclDeltas','unexpectedDefaultPrivilegeDeltas','unexpectedExtensionDeltas',
 'unexpectedPublicDatabasePrivilegeDeltas','plannedPublicDatabasePrivilegeDeltas','restoreManifest']);
const RESTORE_COVERAGE=Object.freeze(['roles','objects','acl','defaultPrivileges','extensions','publicDatabasePrivileges']);
const PUBLIC_DATABASE_DELTAS=Object.freeze(['postgres:PUBLIC:CREATE:revoke','postgres:PUBLIC:TEMPORARY:revoke']);
const HEX=/^[a-f0-9]{64}$/;

const fail=()=>{throw new Error('Buyer writer production preflight failed');};
const sha256=value=>createHash('sha256').update(value).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const artifact=filename=>{
 const bytes=fs.readFileSync(filename);
 return Object.freeze({name:path.basename(filename),sha256:sha256(bytes),bytes:bytes.length});
};
const identity=creatorOid=>Object.freeze({
 actor:'postgres',database:'postgres',creatorOid,serverMajor:17,
 superuser:false,createRole:true,createDb:true,replication:true,bypassRls:true,
});
const phase=(id,mutation,transaction,checkpoint)=>Object.freeze({id,mutation,transaction,checkpoint});

function validateTarget(target){
 if(!exact(target,TARGET_KEYS)||target.version!==1||target.environment!=='production'
  ||target.host!==EXPECTED_HOST||target.port!==5432||target.database!=='postgres'
  ||target.actor!=='postgres'||!Number.isInteger(target.creatorOid)||target.creatorOid<1
  ||target.creatorOid>4294967295||target.serverMajor!==17)fail();
 return Object.freeze({...target});
}

function validateImpactManifest(value,targetDigest){
 const empty=key=>Array.isArray(value[key])&&value[key].length===0;
 if(!exact(value,IMPACT_KEYS)||value.version!==1||Number.isNaN(Date.parse(value.capturedAt))
  ||value.targetDescriptorSha256!==targetDigest||value.installerSha256!==BUYER_WRITER_INSTALLER_SHA256
  ||!['unexpectedRoles','unexpectedObjects','unexpectedAclDeltas','unexpectedDefaultPrivilegeDeltas',
    'unexpectedExtensionDeltas','unexpectedPublicDatabasePrivilegeDeltas'].every(empty)
  ||!Array.isArray(value.plannedPublicDatabasePrivilegeDeltas)
  ||value.plannedPublicDatabasePrivilegeDeltas.length!==PUBLIC_DATABASE_DELTAS.length
  ||!PUBLIC_DATABASE_DELTAS.every((delta,index)=>value.plannedPublicDatabasePrivilegeDeltas[index]===delta))fail();
 let restore=null;
 if(value.restoreManifest!==null){
  restore=value.restoreManifest;
  if(!exact(restore,['version','exact','sha256','coverage'])||restore.version!==1||restore.exact!==true
   ||typeof restore.sha256!=='string'||!HEX.test(restore.sha256)||!Array.isArray(restore.coverage)
   ||restore.coverage.length!==RESTORE_COVERAGE.length
   ||!RESTORE_COVERAGE.every((entry,index)=>restore.coverage[index]===entry))fail();
 }
 return Object.freeze({
  sha256:sha256(Buffer.from(JSON.stringify(value))),capturedAt:value.capturedAt,
  unexpectedCounts:Object.freeze({roles:0,objects:0,acl:0,defaultPrivileges:0,extensions:0,publicDatabasePrivileges:0}),
  plannedPublicDatabasePrivilegeDeltas:PUBLIC_DATABASE_DELTAS,
  exactRestoreAvailable:Boolean(restore),restoreManifestSha256:restore?.sha256??null,
 });
}

function phasesFor(mode){
 const common=[
  phase('validate-protected-snapshots',false,'none','no database access'),
  phase('attest-management-identity-and-lock',false,'session','advisory lock held'),
  phase('catalog-readiness-and-verifier',false,'read only','observed baseline'),
 ];
 if(mode==='inspect'||mode==='verify')return Object.freeze([...common,
  phase('authenticate-runtime-issuer-admission',false,'separate sessions','all identities attested'),
  phase('recheck-protected-snapshots',false,'none','inputs unchanged'),
 ]);
 if(mode==='rollback')return Object.freeze([
  ...common.slice(0,2),
  phase('disable-all-buyer-writer-logins',true,'single transaction','LOGIN disabled and re-observed'),
  phase('journal-rollback-complete',false,'none','durable rollback record'),
 ]);
 return Object.freeze([...common,
  phase('disable-all-buyer-writer-logins',true,'single transaction','fail-closed LOGIN state'),
  phase('canonical-installer',true,'installer-owned transaction','roles installed NOLOGIN'),
  phase('bind-credentials-and-grants',true,'single transaction','rollback before commit'),
  phase('verify-before-commit',false,'same transaction','catalog compliant'),
  phase('verify-after-commit',false,'read-only transaction','committed catalog compliant'),
  phase('authenticate-runtime-issuer-admission',false,'separate sessions','all identities attested'),
  phase('recheck-protected-snapshots',false,'none','inputs unchanged'),
  phase('journal-verified-complete',false,'none','durable completion record'),
 ]);
}
function rollbackCheckpoints(mode){
 if(mode==='inspect'||mode==='verify')return Object.freeze([
  Object.freeze({after:'any phase',action:'release lock and close sessions',expected:'no mutation'}),
 ]);
 if(mode==='rollback')return Object.freeze([
  Object.freeze({after:'rollback commit ambiguity',action:'reconnect and re-observe LOGIN state',expected:'all protected logins disabled'}),
 ]);
 return Object.freeze([
  Object.freeze({after:'before first mutation',action:'release lock',expected:'no database change'}),
  Object.freeze({after:'fail-closed commit',action:'retain disabled logins',expected:'safe stopped state'}),
  Object.freeze({after:'installer commit',action:'retain canonical roles NOLOGIN',expected:'safe partial installation'}),
  Object.freeze({after:'credential transaction before commit',action:'ROLLBACK',expected:'credentials and LOGIN not committed'}),
  Object.freeze({after:'credential commit or later failure',action:'reconnect, disable logins, re-observe',expected:'fail-closed state'}),
 ]);
}

export function buildBuyerWriterProductionPreflight({mode,target,impactManifest,managementConfigPath,now=()=>new Date()}={}){
 try{
  if(!MODES.includes(mode)||typeof managementConfigPath!=='string'||!path.isAbsolute(managementConfigPath)
   ||path.resolve(managementConfigPath)!==managementConfigPath||managementConfigPath==='/')fail();
  const expectedTarget=validateTarget(target);
  const descriptorDigest=sha256(Buffer.from(JSON.stringify(expectedTarget)));
  const impact=validateImpactManifest(impactManifest,descriptorDigest);
  const artifacts=Object.freeze([artifact(INSTALLER),artifact(PROVISIONER),artifact(VERIFIER)]);
  if(artifacts[0].sha256!==BUYER_WRITER_INSTALLER_SHA256)fail();
  const createdAt=now().toISOString();
  const mutating=mode==='apply'||mode==='reconcile';
  const executionClassification=mode==='rollback'?'FAIL_CLOSED_ONLY'
   :mutating&&!impact.exactRestoreAvailable?'IRREVERSIBLE_FORWARD_ONLY'
   :mutating?'REVERSIBLE_WITH_EXACT_RESTORE':'READ_ONLY';
  return Object.freeze({
   version:1,status:'READY_OFFLINE',executed:false,connectionAttempted:false,createdAt,mode,
   executionClassification,
   target:Object.freeze({
    environment:expectedTarget.environment,host:expectedTarget.host,port:expectedTarget.port,
    database:expectedTarget.database,expectedIdentity:identity(expectedTarget.creatorOid),
   }),
   protectedInput:Object.freeze({
    managementConfig:'required-at-execution',pathSha256:sha256(Buffer.from(managementConfigPath)),
    gatewayConfig:'/etc/blackspire-buyer-writer-gateway/gateway.json',
    requiredOwnership:'root',requiredModes:Object.freeze({management:'0600',gateway:'0640'}),
   }),
   contracts:Object.freeze({
    descriptorSha256:descriptorDigest,installerSha256:BUYER_WRITER_INSTALLER_SHA256,
    artifacts,advisoryLock:Object.freeze([206994,127]),
    authentication:Object.freeze(['buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission_login']),
   }),
   impact,plan:phasesFor(mode),rollback:rollbackCheckpoints(mode),
   safety:Object.freeze({
    networkCapability:'absent',credentialValuesAccepted:false,secretsEmitted:false,
    explicitExecutorRequired:true,productionMutationPerformed:false,
   }),
  });
 }catch{fail();}
}

function validateObservation(observed,expected){
 if(!exact(observed,['actor','database','creatorOid','serverMajor','superuser','createRole','createDb','replication','bypassRls'])
  ||Object.entries(expected).some(([key,value])=>observed[key]!==value))fail();
 return Object.freeze({...observed});
}

export async function runBuyerWriterProductionPreflight(options={}){
 const report=buildBuyerWriterProductionPreflight(options);
 if(options.executor===undefined)return report;
 if(typeof options.executor!=='function')fail();
 let observed;
 try{
  observed=await options.executor(Object.freeze({
   kind:'buyer-writer-production-identity-probe',version:1,
   target:report.target,expectedIdentity:report.target.expectedIdentity,
   mutationAllowed:false,credentialsProvided:false,
  }));
 }catch{fail();}
 const verified=validateObservation(observed,report.target.expectedIdentity);
 return Object.freeze({...report,status:'READY_EXECUTOR_ATTESTED',executed:true,connectionAttempted:true,
  executorEvidence:Object.freeze({identityVerified:true,observationSha256:sha256(Buffer.from(JSON.stringify(verified)))}),
  safety:Object.freeze({...report.safety,networkCapability:'caller-supplied-only',productionMutationPerformed:false}),
 });
}
