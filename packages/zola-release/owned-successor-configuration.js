import {createHash} from 'node:crypto';
import {validateBuyerWriterConfiguration,validateBuyerWriterGatewayProvisioningConfiguration} from '../buyer-writer/configuration.js';
import {validateOwnedDatabaseProfile,databaseProfileDigest} from '../buyer-writer/database-profile.js';
import {validateOwnedStoreTransitionPlan} from './owned-store-transition.js';
import {renderZolaGatewayConfigurations} from './gateway-configuration-render.js';
const fail=()=>{throw new Error('Owned successor configuration refused; retain stopped state and records');};
export const OWNED_CONFIG_PREDECESSOR='2636a1e75cd0f422aff036dfee8a93a81cd5008b';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),same=(a,b)=>hash(a)===hash(b);
const sha=v=>/^[a-f0-9]{40}$/.test(v??''),uuid=v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v??''),hex=v=>/^[a-f0-9]{64}$/.test(v??'');
export function renderOwnedSuccessorLiveWriter(rendered,{configDirectory='/etc/blackspire'}={}){
 const encode=v=>JSON.stringify(v)+'\n',digest=v=>createHash('sha256').update(encode(v)).digest('hex');
 const client=configDirectory+'/buyer-writer-client-'+digest(rendered.clientConfig)+'.json',ingress=configDirectory+'/buyer-writer-ingress-'+digest(rendered.ingressConfig)+'.json',signer=configDirectory+'/buyer-writer-signer-'+digest(rendered.signerConfig)+'.json';
 return {gateway:encode(rendered.gatewayConfig),dropin:'[Service]\nEnvironment=BUYER_WRITER_MODE=scoped\nEnvironment=BUYER_WRITER_WORKSPACE_ID=blackspire-command\nEnvironment=BLACKSPIRE_BUYER_WRITER_CLIENT_CONFIG='+client+'\nEnvironment=BLACKSPIRE_BUYER_WRITER_INGRESS_CONFIG='+ingress+'\nEnvironment=BLACKSPIRE_BUYER_WRITER_SIGNER_CONFIG='+signer+'\n'};
}
export function buildOwnedSuccessorWriter({previousReleaseSha,releaseSha,operationId,attemptId,profile,credentialSource,source,gateway}){
 if(previousReleaseSha!==OWNED_CONFIG_PREDECESSOR||!sha(releaseSha)||releaseSha===previousReleaseSha||!uuid(operationId)||!uuid(attemptId)||operationId===attemptId)fail();
 profile=validateOwnedDatabaseProfile(profile);const profileDigest=databaseProfileDigest(profile);
 source=validateBuyerWriterConfiguration(source,{workspace:'blackspire-command',environment:'production'});
 gateway=validateBuyerWriterGatewayProvisioningConfiguration(gateway,{workspace:'blackspire-command'});
 if(Object.keys(credentialSource).sort().join(',')!=='authority,bindingFile,creatorOid,gatewayCapability,issuer,issuerCredential,runtime,version,workspace,writerCredential'||credentialSource.version!==3||credentialSource.authority?.releaseSha!==previousReleaseSha||gateway.authority.releaseSha!==previousReleaseSha||!same(credentialSource.authority,gateway.authority)
 ||source.creatorOid!==profile.creatorOid||gateway.creatorOid!==profile.creatorOid||source.runtime.backendProfile!=='owned-postgres-v1'||source.runtime.profileDigest!==profileDigest||createHash('sha256').update(source.runtime.ca).digest('hex')!==profile.caSha256)fail();
 for(const key of ['workspace','bindingFile','writerCredential','issuerCredential','creatorOid','runtime','issuer'])if(!same(source[key],credentialSource[key])||!same(source[key],gateway[key]))fail();
 if(credentialSource.gatewayCapability!==gateway.gatewayCapability)fail();
 const authority={...gateway.authority,releaseSha,operationId,attemptId};
 const permit=JSON.parse(gateway.operationPermitConfiguration),nextGateway=validateBuyerWriterGatewayProvisioningConfiguration({...gateway,authority,operationPermitConfiguration:JSON.stringify({...permit,releaseSha,operationId,attemptId})},{workspace:'blackspire-command'});
 const nextCredentialSource={...credentialSource,authority};
 // Only the three authority fields can change. No random generator or password DDL exists here.
 if(!same({...nextGateway,authority:gateway.authority,operationPermitConfiguration:gateway.operationPermitConfiguration},gateway)||!same({...nextCredentialSource,authority:credentialSource.authority},credentialSource))fail();
 return {credentialSource:nextCredentialSource,source,gateway:nextGateway,rendered:renderZolaGatewayConfigurations(nextGateway),profileDigest};
}
export function buildInheritedOwnedFrontend({previousReleaseSha,releaseSha,frontendPlan,rows,results}){
 if(previousReleaseSha!==OWNED_CONFIG_PREDECESSOR||!sha(releaseSha)||releaseSha===previousReleaseSha||frontendPlan?.releaseSha!==previousReleaseSha||!Array.isArray(rows)||rows.length!==6)fail();
 const frontendPlanDigest=hash(frontendPlan),selected=[];
 for(const scope of ['preview','production'])for(const key of ['BLACKSPIRE_BUYER_STORE_MODE','BLACKSPIRE_BUYER_STORE_URL','BLACKSPIRE_BUYER_DEAL_CONTEXT_KEY']){
  const name=scope+'-'+key.toLowerCase(),row=rows.find(r=>r.key===key&&same(r.target,[scope])),result=results[name];
  if(!row||row.customEnvironmentIds?.length||row.type!==(key.endsWith('_KEY')?'sensitive':'plain')||(row.gitBranch??null)!==(scope==='preview'?'release/zola-production-live':null)||row.comment!=='zola-owned-buyer:'+frontendPlanDigest+':'+name
  ||result?.version!==1||result.planDigest!==frontendPlanDigest)fail();
  const identity={id:row.id,key:row.key,target:row.target,type:row.type,gitBranch:row.gitBranch??null,comment:row.comment,updatedAt:row.updatedAt};if(!same(identity,result.row))fail();selected.push(identity);
 }
 return {version:1,kind:'owned-successor-inherited-frontend',previousReleaseSha,releaseSha,frontendPlanDigest,rowsDigest:hash(selected),settingsUnchanged:true};
}
// Host supplies authenticated retirement/data-lineage/artifact checks. It cannot
// choose publication paths or credential transformations; all effects remain fixed.
export function createOwnedSuccessorConfiguration({host,store}){
 const checked=async input=>{if(Object.keys(input??{}).sort().join(',')!=='attemptId,frontendOrigin,operationId,previousReleaseSha,profileDigest,releaseSha')fail();await host.assertStoppedHeld(input);const evidence=await host.verifyEvidence(input);
  if(evidence.retirement?.previousReleaseSha!==OWNED_CONFIG_PREDECESSOR||evidence.retirement.releaseSha!==input.releaseSha||!hex(evidence.retirement.digest)
   ||evidence.lineage?.status!=='OWNED_MIGRATION_SUCCESSOR_VERIFIED'||evidence.lineage.releaseSha!==input.releaseSha||evidence.lineage.operationId!==input.operationId||evidence.lineage.profileDigest!==input.profileDigest||evidence.lineage.predecessorReleaseSha!==OWNED_CONFIG_PREDECESSOR
   ||evidence.lineage.sourceWritesDenied!==true||evidence.lineage.targetBrowserSecurityVerified!==true||evidence.lineage.dataCopied!==false||evidence.lineage.hardeningReapplied!==false||!hex(evidence.lineage.lineageDigest)
   ||!hex(evidence.previousArtifactDigest)||!hex(evidence.artifactDigest))fail();return evidence;};
 const validate=plan=>{if(plan?.version!==1||plan.kind!=='owned-successor-configuration'||!plan.input||plan.input.previousReleaseSha!==OWNED_CONFIG_PREDECESSOR)fail();
  const sp=validateOwnedStoreTransitionPlan(plan.storePlan);if(sp.releaseSha!==plan.input.releaseSha||sp.previousSha!==plan.input.previousReleaseSha||sp.origin!==plan.input.frontendOrigin||sp.profileDigest!==plan.input.profileDigest)fail();
  const derived=buildOwnedSuccessorWriter({...plan.input,...plan.before});if(!same(derived,plan.candidate)||!same(plan.input.profileDigest,derived.profileDigest))fail();return plan;};
 const barrier=releaseSha=>{if(host.readRecord(releaseSha,'restore-intent')!==null||host.readRecord(releaseSha,'restore-result')!==null)fail();};
 const result=plan=>({status:'OWNED_SUCCESSOR_CONFIGURATION_PREPARED',releaseSha:plan.input.releaseSha,profileDigest:plan.input.profileDigest,planDigest:hash(plan),storePlan:plan.storePlan});
 return {
  async observe(value){const plan=validate(value);barrier(plan.input.releaseSha);if(!same(host.readFinalPlan(plan.input.releaseSha),plan)||!same(host.readRecord(plan.input.releaseSha,'intent',{final:true}),{planDigest:hash(plan)})||!same(host.readRecord(plan.input.releaseSha,'result',{final:true}),{planDigest:hash(plan)}))fail();await host.observeWriter(plan);if(await store.observe(plan.storePlan)!==true)fail();await host.observeWriter(plan);barrier(plan.input.releaseSha);return result(plan);},
  async prepare(input){barrier(input?.releaseSha);const evidence=await checked(input);let plan=host.readPlan(input.releaseSha);
   if(plan){validate(plan);if(!same(plan.input,input)||!same(plan.evidence,evidence))fail();host.retainPlan(plan);return plan;}
   const before=host.readWriterInputs(input.previousReleaseSha),candidate=buildOwnedSuccessorWriter({...input,...before});if(candidate.profileDigest!==input.profileDigest)fail();
   const storePlan=await store.prepare({previousSha:input.previousReleaseSha,releaseSha:input.releaseSha,origin:input.frontendOrigin,backendProfile:'owned-postgres-v1',profileDigest:input.profileDigest});
   plan=validate({version:1,kind:'owned-successor-configuration',input,evidence,before,candidate,storePlan});await checked(input);host.retainPlan(plan);return plan;
  },
  async publish(value){const plan=validate(value);barrier(plan.input.releaseSha);if(!same(host.readPlan(plan.input.releaseSha),plan)||!same(await checked(plan.input),plan.evidence))fail();
   host.record(plan,'intent',{planDigest:hash(plan)});host.assertSourceUnchanged(plan.before.source);
   host.publishCredentialSource(plan.before.credentialSource,plan.candidate.credentialSource);
   host.publishGatewayCandidate(plan.input.releaseSha,plan.candidate.gateway);
   host.publishLiveWriter(plan);const installed=await host.installWriter(plan);if(installed?.status!=='INSTALLED_RELOAD_REQUIRED'||installed.releaseSha!==plan.input.releaseSha)fail();
   await store.publish(plan.storePlan);host.assertSourceUnchanged(plan.before.source);await checked(plan.input);
   host.record(plan,'result',{planDigest:hash(plan)});return result(plan);
  },
  async restore(value){const plan=validate(value);if(!same(host.readPlan(plan.input.releaseSha),plan)||!same(host.readRecord(plan.input.releaseSha,'intent'),{planDigest:hash(plan)}))fail();await host.assertStoppedHeld(plan.input);
   host.record(plan,'restore-intent',{planDigest:hash(plan)});await store.restore(plan.storePlan);host.restoreLiveWriter(plan);host.publishCredentialSource(plan.candidate.credentialSource,plan.before.credentialSource);host.assertSourceUnchanged(plan.before.source);await host.assertStoppedHeld(plan.input);
   host.record(plan,'restore-result',{planDigest:hash(plan)});return {status:'OWNED_SUCCESSOR_CONFIGURATION_RESTORED',releaseSha:plan.input.previousReleaseSha,dataRestored:false};
  },
 };
}
