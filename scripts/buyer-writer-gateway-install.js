#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  GATEWAY_CONFIG_PATH,GATEWAY_NODE,GATEWAY_SERVICE,assertGatewayOnlyEffects,decodeGatewayInstallState,
  encodeGatewayInstallState,encodeGatewayPreparedState,validateGatewayPreparedObservation,runGatewayUnitPreparation,gatewayActivationActions,gatewayInstallEffects,gatewayRollbackActions,inspectGatewayArtifact,
  renderGatewayUnit,validateGatewayReleaseSha,validateGatewayRestoredServiceState,validateGatewayRuntimeObservation,
} from '../packages/buyer-writer/gateway-installation.js';
import {inspectSealedBuyerWriterArtifact} from '../packages/buyer-writer/artifact-inspection.js';
import {validateBuyerWriterGatewayServiceConfiguration} from '../packages/buyer-writer/gateway-entry.js';

const args=process.argv.slice(2);
const validModes=new Set(['--inspect','--install','--rollback','--prepare','--reconcile-prepared']);
const fail=message=>{throw new Error(message);};
const explicitMode=args[0]?.startsWith('--');
const mode=explicitMode?args[0]:'--inspect';
const sha=explicitMode?args[1]:args[0];
if(!validModes.has(mode)||args.length!==(explicitMode?2:1))fail('usage: buyer-writer-gateway-install.js [--inspect|--install|--rollback|--prepare|--reconcile-prepared] <full-sha>');
validateGatewayReleaseSha(sha);

const releaseRoot='/opt/blackspire-command';
const artifact=path.join(releaseRoot,'releases',sha);
const unitSource=path.join(artifact,'ops/runtime-ownership',GATEWAY_SERVICE);
const unitDestination=path.join('/etc/systemd/system',GATEWAY_SERVICE);
const stateDirectory='/var/lib/blackspire-operator/gateway-installation';
const stateFile=path.join(stateDirectory,'state.json');
const backupDirectory=path.join(stateDirectory,'backups');
const lockFile='/run/blackspire-buyer-writer-gateway-install.lock';
const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

const commandEnvironment=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C'});
function run(command,commandArgs,{stdout='pipe',env=commandEnvironment,timeout=15_000,maxBuffer=65_536}={}){
  const result=spawnSync(command,commandArgs,{encoding:'utf8',stdio:['ignore',stdout,'pipe'],env,timeout,maxBuffer,killSignal:'SIGKILL'});
  if(result.status!==0||result.error)fail(`gateway installer command failed: ${path.basename(command)}`);
  return result.stdout??'';
}
function serviceState(){
  const output=run('/usr/bin/systemctl',['show','--no-pager','--property=ActiveState,SubState,MainPID,User,Group','--',GATEWAY_SERVICE]);
  const rows=output.trim().split('\n').map(line=>{const at=line.indexOf('=');return at<1?[]:[line.slice(0,at),line.slice(at+1)];});
  if(rows.length!==5||rows.some(row=>row.length!==2)||new Set(rows.map(row=>row[0])).size!==5)fail('gateway service state rejected');
  return Object.fromEntries(rows);
}
function enabledState({allowMissing=false}={}){
  const result=spawnSync('/usr/bin/systemctl',['is-enabled',GATEWAY_SERVICE],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:commandEnvironment,
    timeout:15_000,maxBuffer:4096,killSignal:'SIGKILL'});
  if(result.error||result.signal!==null||result.stderr!=='')fail('gateway service enablement state rejected');
  const value=result.stdout.trim();
  if(result.status===0&&value==='enabled')return true;
  if(result.status===1&&value==='disabled')return false;
  if(allowMissing&&result.status===4&&value==='not-found')return false;
  fail('gateway service enablement state rejected');
}
function acquireInstallLock(){
  const parent=fs.lstatSync(path.dirname(lockFile));
  if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||(parent.mode&0o022)!==0)fail('gateway installer lock parent rejected');
  const fd=fs.openSync(lockFile,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.uid!==0||stat.gid!==0||stat.nlink!==1||(stat.mode&0o777)!==0o600)fail('gateway installer lock rejected');
    const result=spawnSync('/usr/bin/flock',['--exclusive','--nonblock','3'],{encoding:'utf8',stdio:['ignore','ignore','pipe',fd],env:commandEnvironment,
      timeout:2000,maxBuffer:4096,killSignal:'SIGKILL'});
    if(result.status!==0||result.error||result.signal!==null||result.stderr!=='')fail('gateway installer is already running');
    return fd;
  }catch(error){fs.closeSync(fd);throw error;}
}
async function validateArtifact(){
  const proof=await inspectSealedBuyerWriterArtifact({artifactRoot:artifact,releaseSha:sha,environment:'production'});
  const checked=inspectGatewayArtifact({sha,releaseRoot,validateCompletedRelease:()=>proof.releaseSha===sha
    &&proof.status==='SEALED_ARTIFACT_VERIFIED'&&proof.deployed===false&&proof.productionAccepted===false});
  return {...checked,artifactDigest:proof.artifactDigest};
}
function assertRoot(){if(process.getuid?.()!==0)fail('gateway installation requires root');}
function assertExactCleanSource(){
  const head=run('/usr/bin/git',['-C',repositoryRoot,'rev-parse','HEAD']).trim();
  const status=run('/usr/bin/git',['-C',repositoryRoot,'status','--porcelain']);
  if(head!==sha||status!=='')fail('gateway artifact creation requires a clean exact-SHA source checkout');
}
function safeDestination(filename){
  try{const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)fail('gateway installation destination rejected');}
  catch(error){if(error?.code!=='ENOENT')throw error;}
}
function requireAbsent(filename){
  try{fs.lstatSync(filename);fail('an unresolved gateway installation state already exists');}
  catch(error){if(error?.code!=='ENOENT')throw error;}
}
function safeDirectory(directory,{uid=0,gid=0,mode}={}){
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==uid||stat.gid!==gid||(stat.mode&0o777)!==mode)fail('gateway installation directory metadata rejected');
}
function ensurePrivateDirectory(directory){
  try{safeDirectory(directory,{uid:0,gid:0,mode:0o700});return;}
  catch(error){if(error?.code!=='ENOENT')throw error;}
  const parent=path.dirname(directory),parentStat=fs.lstatSync(parent);
  if(!parentStat.isDirectory()||parentStat.isSymbolicLink()||parentStat.uid!==0||(parentStat.mode&0o022)!==0)fail('gateway installation parent directory rejected');
  fs.mkdirSync(directory,{mode:0o700});fs.chownSync(directory,0,0);fs.chmodSync(directory,0o700);
  safeDirectory(directory,{uid:0,gid:0,mode:0o700});syncDirectory(directory);syncDirectory(parent);
}
function writerIdentity(){
  const passwd=run('/usr/bin/getent',['passwd','blackspire-writer']).trim().split(':');
  const group=run('/usr/bin/getent',['group','blackspire-writer']).trim().split(':');
  const memberships=run('/usr/bin/id',['-Gn','blackspire-writer']).trim().split(/\s+/);
  if(passwd.length!==7||passwd[0]!=='blackspire-writer'||passwd[5]!=='/nonexistent'||passwd[6]!=='/usr/sbin/nologin'
    ||group.length!==4||group[0]!=='blackspire-writer'||!/^\d+$/.test(group[2])
    ||memberships.length!==1||memberships[0]!=='blackspire-writer')fail('gateway writer identity rejected');
  return {gid:Number(group[2])};
}
function validateSecretMetadata(){
  const {gid}=writerIdentity();
  safeDirectory(path.dirname(GATEWAY_CONFIG_PATH),{uid:0,gid,mode:0o750});
  const config=fs.lstatSync(GATEWAY_CONFIG_PATH);
  if(!config.isFile()||config.isSymbolicLink()||config.uid!==0||config.gid!==gid||config.nlink!==1||(config.mode&0o777)!==0o640)fail('gateway secret configuration metadata rejected');
}
function validateSecretAuthority(){
  const stat=fs.lstatSync(GATEWAY_CONFIG_PATH);
  if(stat.size<2||stat.size>65_536)fail('gateway secret configuration size rejected');
  let fd;
  try{
    fd=fs.openSync(GATEWAY_CONFIG_PATH,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const before=fs.fstatSync(fd),bytes=Buffer.alloc(before.size);
    if(fs.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)fail('gateway secret configuration read rejected');
    const after=fs.fstatSync(fd);
    for(const key of ['uid','gid','mode','nlink','size','dev','ino','mtimeMs','ctimeMs'])if(before[key]!==after[key])fail('gateway secret configuration changed during inspection');
    const value=validateBuyerWriterGatewayServiceConfiguration(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
    if(value.authority.releaseSha!==sha||value.authority.workspace!==value.workspace
      ||value.authority.gatewayIdentity!=='blackspire-writer')fail('gateway secret configuration authority rejected');
    return createHash('sha256').update(bytes).digest('hex');
  }catch(error){if(error?.message?.startsWith('gateway secret'))throw error;fail('gateway secret configuration authority rejected');}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
function syncDirectory(directory){
  const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function atomicRootFile(filename,bytes,mode){
  safeDestination(filename);const temp=`${filename}.new-${process.pid}`;
  let fd,identity,renamed=false;
  try{
    fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);
    identity=fs.fstatSync(fd);fs.fchownSync(fd,0,0);fs.fchmodSync(fd,mode);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.renameSync(temp,filename);renamed=true;syncDirectory(path.dirname(filename));
  }finally{
    if(fd!==undefined)fs.closeSync(fd);
    if(!renamed)try{const stat=fs.lstatSync(temp);if(identity&&stat.dev===identity.dev&&stat.ino===identity.ino)fs.unlinkSync(temp);}catch(error){if(error?.code!=='ENOENT')throw error;}
  }
}
async function inspect(){
  const verified=await validateArtifact();
  const template=fs.readFileSync(unitSource,'utf8');
  const rendered=renderGatewayUnit(template,{sha});
  const installed=fs.readFileSync(unitDestination,'utf8');
  if(installed!==rendered)fail('installed gateway unit does not match the exact release');
  validateSecretMetadata();validateSecretAuthority();
  const state=serviceState(),pid=state.MainPID;
  let cmdline;
  try{
    const bytes=fs.readFileSync(`/proc/${pid}/cmdline`);
    if(bytes.length<1||bytes.length>65_536||bytes.at(-1)!==0)fail('gateway runtime exact authority rejected');
    cmdline=bytes.subarray(0,-1).toString('utf8').split('\0');
    validateGatewayRuntimeObservation({state,exe:fs.readlinkSync(`/proc/${pid}/exe`),cwd:fs.readlinkSync(`/proc/${pid}/cwd`),cmdline},{sha});
  }catch(error){if(error?.message==='gateway runtime exact authority rejected')throw error;fail('gateway runtime exact authority rejected');}
  process.stdout.write(`${JSON.stringify({state:'VERIFIED',sha:verified.sha,artifact:verified.artifact,service:GATEWAY_SERVICE})}\n`);
}
async function install(){
  assertRoot();
  if(!fs.existsSync(artifact)){
    assertExactCleanSource();
    run(path.join(repositoryRoot,'scripts/release-create.sh'),[sha],{stdout:'inherit',timeout:120_000,maxBuffer:65_536,env:{...commandEnvironment,
      BLACKSPIRE_RELEASE_ROOT:releaseRoot,BLACKSPIRE_SOURCE_ROOT:repositoryRoot,
      BLACKSPIRE_STATE_OWNER:'vps-production',BLACKSPIRE_EXPECTED_ENVIRONMENT:'production'}});
  }
  await validateArtifact();
  const effects=gatewayInstallEffects({sha,artifact,sourceUnit:unitSource});assertGatewayOnlyEffects(effects);
  const sysusers=effects.find(effect=>effect.kind==='provision-identity').source;
  const tmpfiles=effects.find(effect=>effect.kind==='provision-directories').source;
  run('/usr/bin/systemd-sysusers',[sysusers]);run('/usr/bin/systemd-tmpfiles',['--create',tmpfiles]);
  // Secret material is deliberately provisioned out of band. The installer only proves metadata
  // and never reads, copies, emits, or manufactures a database credential or capability.
  validateSecretMetadata();validateSecretAuthority();
  ensurePrivateDirectory(stateDirectory);ensurePrivateDirectory(backupDirectory);
  requireAbsent(stateFile);
  safeDestination(unitDestination);
  let backup=null,previous=null,previousEnabled=false,previousActive=false;
  if(fs.existsSync(unitDestination)){
    const prior=serviceState();
    if(prior.ActiveState==='active'){
      if(prior.SubState!=='running'||!/^[1-9][0-9]*$/.test(prior.MainPID))fail('gateway prior service state rejected');
      previousActive=true;
    }else if(!(['inactive','failed'].includes(prior.ActiveState))||prior.MainPID!=='0')fail('gateway prior service state rejected');
    previousEnabled=enabledState();
    previous=fs.readFileSync(unitDestination);
    backup=path.join(backupDirectory,`${sha}-${Date.now()}.service`);
    atomicRootFile(backup,previous,0o600);
  }
  const rendered=renderGatewayUnit(fs.readFileSync(unitSource,'utf8'),{sha});
  // Persist rollback intent before changing the unit. A crash at any later point
  // therefore leaves an explicit, SHA-bound recovery path rather than orphaning
  // a partially installed service definition.
  atomicRootFile(stateFile,encodeGatewayInstallState({sha,unitBackup:backup,previousUnit:previous,installedUnit:rendered,previousEnabled,previousActive}),0o600);
  atomicRootFile(unitDestination,rendered,0o644);
  run('/usr/bin/systemctl',['daemon-reload']);for(const action of gatewayActivationActions())run('/usr/bin/systemctl',action);await inspect();
}
function stoppedPreparationServices(){
 for(const unit of [GATEWAY_SERVICE,'blackspire-command.service','blackspire-command-worker.service']){
  const rows=Object.fromEntries(run('/usr/bin/systemctl',['show','--no-pager','--property=ActiveState,SubState,MainPID','--',unit]).trim().split('\n').map(s=>s.split('=')));
  if(Object.keys(rows).length!==3||rows.ActiveState!=='inactive'||rows.SubState!=='dead'||rows.MainPID!=='0')fail('gateway preparation requires stopped services');
 }
 return true;
}
function readPreparationState(){
 safeDirectory(stateDirectory,{mode:0o700});safeDirectory(backupDirectory,{mode:0o700});safeDestination(stateFile);
 const stat=fs.lstatSync(stateFile);if(stat.gid!==0||stat.nlink!==1||(stat.mode&0o777)!==0o600||stat.size>8192)fail('gateway preparation state metadata rejected');
 const state=decodeGatewayInstallState(fs.readFileSync(stateFile,'utf8'));
 if(state.version!==4||state.sha!==sha||state.unitBackup!==null&&path.dirname(state.unitBackup)!==backupDirectory)fail('gateway preparation state binding rejected');
 return state;
}
async function inspectPrepared(){
 const state=readPreparationState(),verified=await validateArtifact();validateSecretMetadata();const configurationSha256=validateSecretAuthority();
 safeDestination(unitDestination);const unitStat=fs.lstatSync(unitDestination);if(unitStat.gid!==0||unitStat.nlink!==1||(unitStat.mode&0o777)!==0o644)fail('gateway prepared unit metadata rejected');
 const installedUnit=fs.readFileSync(unitDestination,'utf8');
 if(installedUnit!==renderGatewayUnit(fs.readFileSync(unitSource,'utf8'),{sha}))fail('gateway prepared template drift');
 let backupUnit=null;if(state.unitBackup!==null){safeDestination(state.unitBackup);const stat=fs.lstatSync(state.unitBackup);
  if(stat.gid!==0||stat.nlink!==1||(stat.mode&0o777)!==0o600)fail('gateway preparation backup metadata rejected');backupUnit=fs.readFileSync(state.unitBackup);}
 const daemonReloaded=run('/usr/bin/systemctl',['show','--no-pager','--property=NeedDaemonReload','--value','--',GATEWAY_SERVICE]).trim()==='no';
 return validateGatewayPreparedObservation(state,{sha,artifactDigest:verified.artifactDigest,configurationSha256,installedUnit,backupUnit,
  enabled:enabledState(),servicesStopped:stoppedPreparationServices(),daemonReloaded});
}
async function prepareUnitPlan(){
 // Artifact and credentials already exist. Preparation never provisions identity,
 // builds a release, changes enablement, or starts any service.
 assertRoot();stoppedPreparationServices();const verified=await validateArtifact();validateSecretMetadata();
 const configurationSha256=validateSecretAuthority();ensurePrivateDirectory(stateDirectory);ensurePrivateDirectory(backupDirectory);requireAbsent(stateFile);safeDestination(unitDestination);
 let previous=null,backup=null;const previousEnabled=enabledState({allowMissing:true});
 if(fs.existsSync(unitDestination)){previous=fs.readFileSync(unitDestination);backup=path.join(backupDirectory,`${sha}-${Date.now()}.service`);requireAbsent(backup);atomicRootFile(backup,previous,0o600);}
 const rendered=renderGatewayUnit(fs.readFileSync(unitSource,'utf8'),{sha});
 const state=encodeGatewayPreparedState({sha,unitBackup:backup,previousUnit:previous,installedUnit:rendered,previousEnabled,previousActive:false,
  artifactDigest:verified.artifactDigest,configurationSha256});
 stoppedPreparationServices();if(validateSecretAuthority()!==configurationSha256||(await validateArtifact()).artifactDigest!==verified.artifactDigest)fail('gateway preparation input drift');
 return {state,rendered,configurationSha256,previous,previousEnabled};
}

function preparedUnitHost(){return {
 prepare:prepareUnitPlan,
 persist(plan){requireAbsent(stateFile);atomicRootFile(stateFile,plan.state,0o600);},
 publish(plan){stoppedPreparationServices();if(validateSecretAuthority()!==plan.configurationSha256||enabledState({allowMissing:true})!==plan.previousEnabled)fail('gateway preparation configuration drift');
  safeDestination(unitDestination);const previous=fs.existsSync(unitDestination)?fs.readFileSync(unitDestination):null;
  if((previous===null)!==(plan.previous===null)||previous!==null&&!previous.equals(plan.previous))fail('gateway preparation previous unit drift');
  atomicRootFile(unitDestination,plan.rendered,0o644);},
 reload(){run('/usr/bin/systemctl',['daemon-reload']);},inspect:inspectPrepared,
};}

function rollback(){
  assertRoot();safeDestination(stateFile);const stateStat=fs.lstatSync(stateFile);
  if(stateStat.uid!==0||stateStat.gid!==0||(stateStat.mode&0o777)!==0o600||stateStat.nlink!==1)fail('gateway installation state metadata rejected');
  const state=decodeGatewayInstallState(fs.readFileSync(stateFile,'utf8'));
  if(state.sha!==sha)fail('gateway rollback SHA rejected');
  let installed=null;
  try{installed=fs.readFileSync(unitDestination);}catch(error){if(error?.code!=='ENOENT')throw error;}
  const installedDigest=installed===null?null:createHash('sha256').update(installed).digest('hex');
  if(installedDigest!==state.installedUnitSha256&&installedDigest!==state.previousUnitSha256)fail('installed gateway unit changed after installation');
  const actions=gatewayRollbackActions(state);run('/usr/bin/systemctl',actions[0]);safeDestination(unitDestination);
  if(state.unitBackup===null){if(installed!==null)fs.unlinkSync(unitDestination);}
  else{
    const backup=fs.lstatSync(state.unitBackup);
    if(!backup.isFile()||backup.isSymbolicLink()||backup.uid!==0||(backup.mode&0o777)!==0o600)fail('gateway unit backup rejected');
    const backupBytes=fs.readFileSync(state.unitBackup);
    if(createHash('sha256').update(backupBytes).digest('hex')!==state.previousUnitSha256)fail('gateway unit backup changed after installation');
    atomicRootFile(unitDestination,backupBytes,0o644);
  }
  for(const action of actions.slice(1))run('/usr/bin/systemctl',action);
  const restoredExists=fs.existsSync(unitDestination);
  validateGatewayRestoredServiceState({unitExists:restoredExists,enabled:enabledState({allowMissing:!restoredExists}),
    active:restoredExists&&serviceState().ActiveState==='active'},state);
  fs.unlinkSync(stateFile);
  process.stdout.write(`${JSON.stringify({state:'ROLLED_BACK',sha,service:GATEWAY_SERVICE})}\n`);
}

let lock;
try{
  if(mode==='--inspect')await inspect();
  else{assertRoot();lock=acquireInstallLock();if(mode==='--install')await install();
   else if(mode==='--prepare'||mode==='--reconcile-prepared'){const proof=await runGatewayUnitPreparation({reconcile:mode==='--reconcile-prepared'},{host:preparedUnitHost()});process.stdout.write(JSON.stringify(proof)+'\n');}
   else rollback();}
}finally{if(lock!==undefined)fs.closeSync(lock);}
