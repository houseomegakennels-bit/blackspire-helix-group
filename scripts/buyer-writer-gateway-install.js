#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  GATEWAY_CONFIG_PATH,GATEWAY_SERVICE,assertGatewayOnlyEffects,decodeGatewayInstallState,
  encodeGatewayInstallState,gatewayInstallEffects,inspectGatewayArtifact,renderGatewayUnit,validateGatewayReleaseSha,
} from '../packages/buyer-writer/gateway-installation.js';
import {inspectSealedBuyerWriterArtifact} from '../packages/buyer-writer/artifact-inspection.js';
import {validateBuyerWriterGatewayServiceConfiguration} from '../packages/buyer-writer/gateway-entry.js';

const args=process.argv.slice(2);
const validModes=new Set(['--inspect','--install','--rollback']);
const fail=message=>{throw new Error(message);};
const explicitMode=args[0]?.startsWith('--');
const mode=explicitMode?args[0]:'--inspect';
const sha=explicitMode?args[1]:args[0];
if(!validModes.has(mode)||args.length!==(explicitMode?2:1))fail('usage: buyer-writer-gateway-install.js [--inspect|--install|--rollback] <full-sha>');
validateGatewayReleaseSha(sha);

const releaseRoot='/opt/blackspire-command';
const artifact=path.join(releaseRoot,'releases',sha);
const unitSource=path.join(artifact,'ops/runtime-ownership',GATEWAY_SERVICE);
const unitDestination=path.join('/etc/systemd/system',GATEWAY_SERVICE);
const stateDirectory='/var/lib/blackspire-operator/gateway-installation';
const stateFile=path.join(stateDirectory,'state.json');
const backupDirectory=path.join(stateDirectory,'backups');
const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

const commandEnvironment=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C'});
function run(command,commandArgs,{stdout='pipe',env=commandEnvironment,timeout=15_000,maxBuffer=65_536}={}){
  const result=spawnSync(command,commandArgs,{encoding:'utf8',stdio:['ignore',stdout,'pipe'],env,timeout,maxBuffer,killSignal:'SIGKILL'});
  if(result.status!==0||result.error)fail(`gateway installer command failed: ${path.basename(command)}`);
  return result.stdout??'';
}
async function validateArtifact(){
  const proof=await inspectSealedBuyerWriterArtifact({artifactRoot:artifact,releaseSha:sha,environment:'production'});
  return inspectGatewayArtifact({sha,releaseRoot,validateCompletedRelease:()=>proof.releaseSha===sha
    &&proof.status==='SEALED_ARTIFACT_VERIFIED'&&proof.deployed===false&&proof.productionAccepted===false});
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
  safeDirectory(directory,{uid:0,gid:0,mode:0o700});
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
  }catch(error){if(error?.message?.startsWith('gateway secret'))throw error;fail('gateway secret configuration authority rejected');}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
function atomicRootFile(filename,bytes,mode){
  safeDestination(filename);const temp=`${filename}.new-${process.pid}`;
  fs.writeFileSync(temp,bytes,{mode,flag:'wx'});fs.chownSync(temp,0,0);fs.chmodSync(temp,mode);fs.renameSync(temp,filename);
}
async function inspect(){
  const verified=await validateArtifact();
  const template=fs.readFileSync(unitSource,'utf8');
  const rendered=renderGatewayUnit(template,{sha});
  const installed=fs.readFileSync(unitDestination,'utf8');
  if(installed!==rendered)fail('installed gateway unit does not match the exact release');
  validateSecretMetadata();validateSecretAuthority();
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
  let backup=null,previous=null;
  if(fs.existsSync(unitDestination)){
    previous=fs.readFileSync(unitDestination);
    backup=path.join(backupDirectory,`${sha}-${Date.now()}.service`);
    fs.writeFileSync(backup,previous,{flag:'wx',mode:0o600});fs.chownSync(backup,0,0);fs.chmodSync(backup,0o600);
  }
  const rendered=renderGatewayUnit(fs.readFileSync(unitSource,'utf8'),{sha});
  // Persist rollback intent before changing the unit. A crash at any later point
  // therefore leaves an explicit, SHA-bound recovery path rather than orphaning
  // a partially installed service definition.
  atomicRootFile(stateFile,encodeGatewayInstallState({sha,unitBackup:backup,previousUnit:previous,installedUnit:rendered}),0o600);
  atomicRootFile(unitDestination,rendered,0o644);
  run('/usr/bin/systemctl',['daemon-reload']);run('/usr/bin/systemctl',['enable','--now',GATEWAY_SERVICE]);await inspect();
}
function rollback(){
  assertRoot();safeDestination(stateFile);const stateStat=fs.lstatSync(stateFile);
  if(stateStat.uid!==0||stateStat.gid!==0||(stateStat.mode&0o777)!==0o600||stateStat.nlink!==1)fail('gateway installation state metadata rejected');
  const state=decodeGatewayInstallState(fs.readFileSync(stateFile,'utf8'));
  if(state.sha!==sha)fail('gateway rollback SHA rejected');
  let installed=null;
  try{installed=fs.readFileSync(unitDestination);}catch(error){if(error?.code!=='ENOENT')throw error;}
  const installedDigest=installed===null?null:createHash('sha256').update(installed).digest('hex');
  if(installedDigest!==state.installedUnitSha256&&installedDigest!==state.previousUnitSha256)fail('installed gateway unit changed after installation');
  run('/usr/bin/systemctl',['disable','--now',GATEWAY_SERVICE]);safeDestination(unitDestination);
  if(state.unitBackup===null){if(installed!==null)fs.unlinkSync(unitDestination);}
  else{
    const backup=fs.lstatSync(state.unitBackup);
    if(!backup.isFile()||backup.isSymbolicLink()||backup.uid!==0||(backup.mode&0o777)!==0o600)fail('gateway unit backup rejected');
    const backupBytes=fs.readFileSync(state.unitBackup);
    if(createHash('sha256').update(backupBytes).digest('hex')!==state.previousUnitSha256)fail('gateway unit backup changed after installation');
    atomicRootFile(unitDestination,backupBytes,0o644);
  }
  run('/usr/bin/systemctl',['daemon-reload']);fs.unlinkSync(stateFile);
  process.stdout.write(`${JSON.stringify({state:'ROLLED_BACK',sha,service:GATEWAY_SERVICE})}\n`);
}

if(mode==='--inspect')await inspect();else if(mode==='--install')await install();else rollback();
