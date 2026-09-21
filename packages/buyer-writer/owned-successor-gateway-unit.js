import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {readOwnedConfigurationBytes,publishOwnedConfigurationBytes} from '../zola-release/owned-buyer-configuration-host.js';
import {PARTIAL_RELEASE,validatePartialRetirementEvent} from '../zola-release/partial-retirement-history.js';
import {validateReleaseAdmissionState} from '../shared/release-admission.js';
import {readRootOwnedJsonSnapshot} from './protected-json.js';
import {readOwnedDatabaseProfile,databaseProfileDigest} from './database-profile.js';
import {observeOwnedMigrationSuccessor} from './owned-migration-successor.js';
import {verifyOwnedBuyerMigrationQuiescence} from './owned-migration-host.js';
import {inspectBuyerWriterArtifact,inspectSealedBuyerWriterArtifact} from './artifact-inspection.js';
import {renderGatewayUnit,decodeGatewayInstallState,GATEWAY_SERVICE} from './gateway-installation.js';
const P=PARTIAL_RELEASE,ROOT='/var/lib/blackspire-operator/owned-successor-gateway-units';
const defaults=Object.freeze({current:'/opt/blackspire-command/current',root:ROOT,releases:'/opt/blackspire-command/releases',unit:'/etc/systemd/system/'+GATEWAY_SERVICE,
 oldState:'/var/lib/blackspire-operator/gateway-installation/state.json',retirement:'/var/lib/blackspire-operator/release-retirements/partial-2636/retirement.json',profile:'/etc/blackspire/owned-postgres/profile.json',admission:'/etc/blackspire/release-admission/state.json'});
const hash=v=>createHash('sha256').update(v).digest('hex'),json=v=>JSON.stringify(v)+'\n',same=(a,b)=>json(a)===json(b);
const fail=()=>{throw new Error('Owned successor gateway unit rejected; retain evidence');};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const plans=new WeakMap();
function validate(input){if(!input||Object.keys(input).sort().join(',')!=='attemptId,operationId,profileDigest,releaseSha,successorLineageFile'||!uuid(input.operationId)||!uuid(input.attemptId)||input.operationId===P.operationId||input.attemptId===P.attemptId||!(/^[a-f0-9]{40}$/).test(input.releaseSha??'')||input.releaseSha===P.releaseSha||input.profileDigest!==P.profileDigest||input.successorLineageFile!==`/var/lib/blackspire-operator/owned-migration-successors/${input.operationId}/plan.json`)fail();return Object.freeze({...input});}
function host(input,deps){
 if(process.getuid()!==0||process.geteuid()!==0||typeof deps.verifyRetirement!=='function')fail();
 const paths=deps.paths??defaults,files=deps.files??createBuyerStoreProtectedFiles(),read=deps.read??readOwnedConfigurationBytes,publish=deps.publish??publishOwnedConfigurationBytes;
 const run=deps.run??((args)=>execFileSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:5000,maxBuffer:16384,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}).trim());
 const directory=path.join(paths.root,input.operationId),record=n=>path.join(directory,n+'.json');
 const rootValue=p=>{const raw=read(p);if(raw===null)fail();return JSON.parse(raw);};
 const snapshot=deps.profileSnapshot??(()=>readRootOwnedJsonSnapshot(paths.profile,{groupId:0,maxBytes:65536}));
 const currentProfile=deps.profileDigest??(()=>databaseProfileDigest(readOwnedDatabaseProfile()));
 const held=deps.held??(()=>{const gid=fs.lstatSync(paths.admission).gid;return readRootOwnedJsonSnapshot(paths.admission,{groupId:gid,maxBytes:2048}).value;});
 const stable=()=>{const profile=snapshot();if(profile.identity.uid!==0||profile.identity.gid!==0||(profile.identity.mode&0o7777)!==0o600||currentProfile()!==input.profileDigest)fail();const state=validateReleaseAdmissionState(held());if(state.mode!=='held')fail();if(state.releaseSha===P.releaseSha){if(state.runId!==P.runId||state.apiGeneration!==null||state.workerGeneration!==null)fail();}else if(state.releaseSha!==input.releaseSha||typeof deps.verifySuccessorHeld!=='function'||deps.verifySuccessorHeld(input,state)!==true)fail();return {profile,state};};
 const artifact=async(sealed,sha)=>{const proof=await(sealed?(deps.inspectSealed??inspectSealedBuyerWriterArtifact):(deps.inspectDeployed??inspectBuyerWriterArtifact))({artifactRoot:path.join(paths.releases,sha),releaseSha:sha,environment:'production'});
  if(proof.releaseSha!==sha||proof.environment!=='production'||!digest(proof.artifactDigest)||sealed&&(proof.status!=='SEALED_ARTIFACT_VERIFIED'||proof.deployed!==false||proof.productionAccepted!==false))fail();return proof;};
 const template=sha=>{const value=read(path.join(paths.releases,sha,'ops/runtime-ownership',GATEWAY_SERVICE),{gid:deps.artifactGid??fs.statSync(path.join(paths.releases,sha,'ops/runtime-ownership',GATEWAY_SERVICE)).gid,mode:0o644});if(value===null)fail();return value;};
 const stopped=deps.stopped??verifyOwnedBuyerMigrationQuiescence;
 function phase(){files.directory(path.dirname(paths.current));const st=fs.lstatSync(paths.current);if(!st.isSymbolicLink()||st.uid!==0||st.nlink!==1)fail();const target=fs.realpathSync(paths.current),releaseSha=path.basename(target);if(![P.releaseSha,input.releaseSha].includes(releaseSha)||target!==path.join(paths.releases,releaseSha))fail();return {releaseSha,target,link:fs.readlinkSync(paths.current),identity:Object.fromEntries(['dev','ino','uid','gid','nlink','mode','mtimeMs','ctimeMs'].map(k=>[k,st[k]]))};}
 async function evidence(sealed){const before=stable();if(sealed)await stopped();
  const retirement=await deps.verifyRetirement(input);validatePartialRetirementEvent(retirement);
  if(!same(rootValue(paths.retirement),retirement)||retirement.successorReleaseSha!==input.releaseSha||retirement.successorOperationId!==input.operationId||retirement.profileDigest!==input.profileDigest)fail();
  const lineage=await(deps.observeLineage??observeOwnedMigrationSuccessor)({releaseSha:input.releaseSha,operationId:input.operationId,profileDigest:input.profileDigest,successorLineageFile:input.successorLineageFile});
  if(lineage.status!=='OWNED_MIGRATION_SUCCESSOR_VERIFIED'||lineage.releaseSha!==input.releaseSha||lineage.operationId!==input.operationId||lineage.profileDigest!==input.profileDigest||lineage.lineageDigest!==retirement.proof.lineageDigest||lineage.sourceWritesDenied!==true||lineage.targetBrowserSecurityVerified!==true||lineage.dataCopied!==false||lineage.hardeningReapplied!==false)fail();
  const old=await artifact(false,P.releaseSha),next=await artifact(sealed,input.releaseSha),oldTemplate=template(P.releaseSha),nextTemplate=template(input.releaseSha);
  const stateBytes=read(paths.oldState),state=decodeGatewayInstallState(stateBytes);
  const beforeUnit=renderGatewayUnit(oldTemplate,{sha:P.releaseSha}),afterUnit=renderGatewayUnit(nextTemplate,{sha:input.releaseSha});
  if(state.version!==4||state.sha!==P.releaseSha||state.artifactDigest!==old.artifactDigest||state.installedUnitSha256!==hash(beforeUnit)||state.previousActive!==false)fail();
  if(!same(before,stable())||!same(rootValue(paths.retirement),retirement)||read(paths.oldState)!==stateBytes)fail();if(sealed)await stopped();if(!same(before,stable())||read(paths.oldState)!==stateBytes||!same(rootValue(paths.retirement),retirement)||template(P.releaseSha)!==oldTemplate||template(input.releaseSha)!==nextTemplate)fail();
  return {beforeUnit,afterUnit,dependencies:{oldStateDigest:hash(stateBytes),retirementDigest:hash(json(retirement)),lineageDigest:lineage.lineageDigest,previousArtifactDigest:old.artifactDigest,artifactDigest:next.artifactDigest,profileDigest:input.profileDigest,profileSnapshotDigest:hash(json(before.profile))}};
 }
 function loaded(requireFresh=true){const names=['LoadState','FragmentPath','DropInPaths','NeedDaemonReload','WorkingDirectory'],raw=run(['show',GATEWAY_SERVICE,...names.map(n=>'--property='+n)]),lines=raw.split('\n'),value=Object.fromEntries(lines.map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
  if(lines.length!==names.length||Object.keys(value).sort().join(',')!==names.sort().join(',')||value.LoadState!=='loaded'||value.FragmentPath!==paths.unit||value.DropInPaths!==''||!['yes','no'].includes(value.NeedDaemonReload)||!['/opt/blackspire-command/releases/'+input.releaseSha,'/opt/blackspire-command/releases/'+P.releaseSha].includes(value.WorkingDirectory))fail();const fresh=value.NeedDaemonReload==='no'&&value.WorkingDirectory==='/opt/blackspire-command/releases/'+input.releaseSha;if(requireFresh&&!fresh)fail();return fresh;}
 const retained=n=>{try{return files.value(record(n),true);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const retain=(n,v)=>files.record(record(n),v);
 function checkPlan(plan,e){if(!same(plan,{version:1,kind:'owned-successor-gateway-unit-v1',input,dependencies:e.dependencies,beforeUnit:e.beforeUnit,afterUnit:e.afterUnit}))fail();}
 const unit=()=>read(paths.unit,{gid:0,mode:0o644});
 function unchanged(plan){if(hash(json(stable().profile))!==plan.dependencies.profileSnapshotDigest||hash(read(paths.oldState))!==plan.dependencies.oldStateDigest||hash(json(rootValue(paths.retirement)))!==plan.dependencies.retirementDigest||renderGatewayUnit(template(P.releaseSha),{sha:P.releaseSha})!==plan.beforeUnit||renderGatewayUnit(template(input.releaseSha),{sha:input.releaseSha})!==plan.afterUnit)fail();}
 const intent=plan=>({version:1,planDigest:hash(json(plan)),beforeDigest:hash(plan.beforeUnit),afterDigest:hash(plan.afterUnit)});
 function checkResult(plan,result){if(!same(result,{version:1,status:'OWNED_SUCCESSOR_GATEWAY_UNIT_VERIFIED',planDigest:hash(json(plan)),releaseSha:input.releaseSha,operationId:input.operationId,attemptId:input.attemptId,unitDigest:hash(plan.afterUnit),daemonReloaded:true}))fail();return result;}
 return {paths,files,directory,record,evidence,phase,loaded,unchanged,retained,retain,checkPlan,unit,intent,checkResult,stopped,stable,publish,run};
}
// The enclosing commander owns its global lock. This adapter never provisions
// identities, starts/enables units, rewrites the predecessor journal or rotates keys.
export async function prepareOwnedSuccessorGatewayUnit(raw,deps={}){
 const input=validate(raw),h=host(input,deps),e=await h.evidence(true);let plan=h.retained('plan');
 if(plan===null){if(h.retained('intent')||h.retained('result')||h.unit()!==e.beforeUnit)fail();plan={version:1,kind:'owned-successor-gateway-unit-v1',input,dependencies:e.dependencies,beforeUnit:e.beforeUnit,afterUnit:e.afterUnit};h.files.directory(h.directory,{create:true});h.retain('plan',plan);}
 h.checkPlan(plan,e);const unit=h.unit();if(unit!==plan.beforeUnit&&unit!==plan.afterUnit)fail();
 if(unit===plan.afterUnit&&!same(h.retained('intent'),h.intent(plan)))fail();
 const value=Object.freeze(plan);plans.set(value,{h,input});return value;
}
export async function installOwnedSuccessorGatewayUnit(plan){
 const state=plans.get(plan);if(!state)fail();const {h,input}=state,e=await h.evidence(true);h.checkPlan(plan,e);
 const intended=h.intent(plan),oldIntent=h.retained('intent');if(oldIntent&&!same(oldIntent,intended))fail();
 const retainedResult=h.retained('result');if(retainedResult!==null)h.checkResult(plan,retainedResult);h.loaded(false);
 if(!oldIntent){if(h.unit()!==plan.beforeUnit||retainedResult)fail();h.retain('intent',intended);}
 await h.stopped();const last=await h.evidence(true);h.checkPlan(plan,last);h.publish(h.paths.unit,plan.beforeUnit,plan.afterUnit,{gid:0,mode:0o644});
 // A daemon-reload has no business effect and is safe to repeat only for these
 // exact retained bytes after an interrupted reload acknowledgement.
 const loaded=h.loaded(false);
 if(!loaded){await h.stopped();h.unchanged(plan);if(h.unit()!==plan.afterUnit)fail();h.run(['daemon-reload']);}
 h.loaded();const final=await h.evidence(true);h.checkPlan(plan,final);if(h.unit()!==plan.afterUnit)fail();
 const result={version:1,status:'OWNED_SUCCESSOR_GATEWAY_UNIT_VERIFIED',planDigest:hash(json(plan)),releaseSha:input.releaseSha,operationId:input.operationId,attemptId:input.attemptId,unitDigest:hash(plan.afterUnit),daemonReloaded:true};
 h.retain('result',result);h.loaded();h.stable();if(h.unit()!==plan.afterUnit)fail();return Object.freeze(result);
}
export async function observeOwnedSuccessorGatewayUnit(raw,deps={}){
 const input=validate(raw),h=host(input,deps),before=h.phase(),sealed=before.releaseSha===P.releaseSha;
 const oldHeld=()=>{const state=h.stable().state;if(state.releaseSha!==P.releaseSha||state.runId!==P.runId||state.apiGeneration!==null||state.workerGeneration!==null)fail();};
 if(sealed)oldHeld();const e=await h.evidence(sealed),plan=h.retained('plan');h.checkPlan(plan,e);
 if(sealed)oldHeld();if(!same(h.phase(),before)||!same(h.retained('intent'),h.intent(plan))||h.unit()!==plan.afterUnit)fail();const result=h.checkResult(plan,h.retained('result'));h.loaded();if(!same(h.phase(),before)||h.unit()!==plan.afterUnit)fail();return Object.freeze(result);
}
// Postmerge reads this distinct completed receipt by the candidate gateway's
// operation authority. It never reinterprets the original installation state.
export function readOwnedSuccessorGatewayUnitReceipt({releaseSha,operationId,artifactDigest},{paths=defaults,read=readOwnedConfigurationBytes}={}){
 if(process.getuid()!==0||!uuid(operationId)||!digest(artifactDigest)||!(/^[a-f0-9]{40}$/).test(releaseSha??'')||releaseSha===P.releaseSha)fail();
 const directory=path.join(paths.root,operationId),filenames=['plan','intent','result'].map(n=>path.join(directory,n+'.json'));
 const contents=filenames.map(p=>{const v=read(p);if(v===null)fail();return v;}),[plan,intent,result]=contents.map(v=>JSON.parse(v));
 const input=validate(plan.input);if(input.releaseSha!==releaseSha||input.operationId!==operationId||plan.version!==1||plan.kind!=='owned-successor-gateway-unit-v1'||Object.keys(plan).sort().join(',')!=='afterUnit,beforeUnit,dependencies,input,kind,version'
  ||Object.keys(plan.dependencies??{}).sort().join(',')!=='artifactDigest,lineageDigest,oldStateDigest,previousArtifactDigest,profileDigest,profileSnapshotDigest,retirementDigest'
  ||!Object.values(plan.dependencies).every(digest)||plan.dependencies.artifactDigest!==artifactDigest||plan.dependencies.profileDigest!==P.profileDigest||typeof plan.beforeUnit!=='string'||typeof plan.afterUnit!=='string')fail();
 const planDigest=hash(json(plan));
 if(!same(intent,{version:1,planDigest,beforeDigest:hash(plan.beforeUnit),afterDigest:hash(plan.afterUnit)})||!same(result,{version:1,status:'OWNED_SUCCESSOR_GATEWAY_UNIT_VERIFIED',planDigest,releaseSha,operationId,attemptId:input.attemptId,unitDigest:hash(plan.afterUnit),daemonReloaded:true}))fail();
 const oldBytes=read(paths.oldState),old=decodeGatewayInstallState(oldBytes);if(old.sha!==P.releaseSha||old.version!==4||hash(oldBytes)!==plan.dependencies.oldStateDigest||old.installedUnitSha256!==hash(plan.beforeUnit)||old.artifactDigest!==plan.dependencies.previousArtifactDigest)fail();
 const retirementBytes=read(paths.retirement);if(retirementBytes===null)fail();const retired=JSON.parse(retirementBytes);validatePartialRetirementEvent(retired);
 if(hash(json(retired))!==plan.dependencies.retirementDigest||retired.successorReleaseSha!==releaseSha||retired.successorOperationId!==operationId||retired.proof.lineageDigest!==plan.dependencies.lineageDigest)fail();
 if(filenames.some((p,i)=>read(p)!==contents[i])||read(paths.oldState)!==oldBytes||read(paths.retirement)!==retirementBytes)fail();
 return Object.freeze({status:'OWNED_SUCCESSOR_GATEWAY_UNIT_RECEIPT_VERIFIED',sha:releaseSha,operationId,attemptId:input.attemptId,artifactDigest,profileDigest:input.profileDigest,
  installedUnitSha256:result.unitDigest,planDigest,dependencies:[...filenames.map((filename,i)=>({filename,uid:0,gid:0,mode:0o600,digest:hash(contents[i])})),{filename:paths.oldState,uid:0,gid:0,mode:0o600,digest:hash(oldBytes)},{filename:paths.retirement,uid:0,gid:0,mode:0o600,digest:hash(retirementBytes)}]});
}
