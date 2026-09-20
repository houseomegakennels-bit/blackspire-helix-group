#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readRootOwnedJsonSnapshot} from '../packages/buyer-writer/protected-json.js';
import {inspectSealedBuyerWriterArtifact} from '../packages/buyer-writer/artifact-inspection.js';
import {renderZolaGatewayConfigurations} from '../packages/zola-release/gateway-configuration-render.js';
import {
  inspectBuyerWriterGatewayConfigurationUpgrade,
  upgradeBuyerWriterGatewayConfiguration,
} from '../packages/buyer-writer/gateway-configuration-upgrade.js';
import {
  BUYER_WRITER_GATEWAY_CONFIG_FILE,BUYER_WRITER_GATEWAY_UPGRADE_STATE,
  createBuyerWriterGatewayConfigurationFileControls,
  reconcileBuyerWriterGatewayConfigurationFile,
  rollbackBuyerWriterGatewayConfigurationFile,
} from '../packages/buyer-writer/gateway-configuration-upgrade-files.js';

const fail=()=>{throw new Error('Buyer writer gateway configuration upgrade stopped');};
const commandEnvironment=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C'});
const releaseRoot='/opt/blackspire-command/releases';
const lockFile='/run/blackspire-buyer-writer-gateway-configuration-upgrade.lock';
const services=['blackspire-command.service','blackspire-command-worker.service',
  'blackspire-buyer-writer-gateway.service'];

function acquireLock(){
  const parent=fs.lstatSync(path.dirname(lockFile));
  if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||(parent.mode&0o022)!==0)fail();
  const fd=fs.openSync(lockFile,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.uid!==0||stat.gid!==0||stat.nlink!==1||(stat.mode&0o777)!==0o600)fail();
    const result=spawnSync('/usr/bin/flock',['--exclusive','--nonblock','3'],{
      encoding:'utf8',stdio:['ignore','ignore','pipe',fd],env:commandEnvironment,
      timeout:2000,maxBuffer:4096,killSignal:'SIGKILL',
    });
    if(result.status!==0||result.error||result.signal!==null||result.stderr!=='')fail();
    return fd;
  }catch(error){fs.closeSync(fd);throw error;}
}
function writerGroupId(){
  const fields=execFileSync('/usr/bin/getent',['group','blackspire-writer'],{
    encoding:'utf8',timeout:1000,maxBuffer:4096,stdio:['ignore','pipe','pipe'],
    env:commandEnvironment}).trim().split(':');
  if(fields.length!==4||fields[0]!=='blackspire-writer'||!/^[1-9][0-9]{0,9}$/.test(fields[2]))fail();
  return Number(fields[2]);
}
function safeStateDirectory(){
  try{
    const stat=fs.lstatSync(BUYER_WRITER_GATEWAY_UPGRADE_STATE);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||stat.gid!==0
      ||(stat.mode&0o7777)!==0o700)fail();
    return;
  }catch(error){if(error?.code!=='ENOENT')throw error;}
  const parent=path.dirname(BUYER_WRITER_GATEWAY_UPGRADE_STATE),stat=fs.lstatSync(parent);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)fail();
  fs.mkdirSync(BUYER_WRITER_GATEWAY_UPGRADE_STATE,{mode:0o700});
  fs.chownSync(BUYER_WRITER_GATEWAY_UPGRADE_STATE,0,0);
  fs.chmodSync(BUYER_WRITER_GATEWAY_UPGRADE_STATE,0o700);
  const fd=fs.openSync(parent,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function proveQuiesced(){
  for(const service of services){
    const result=spawnSync('/usr/bin/systemctl',['show','--no-pager',
      '--property=ActiveState,SubState,MainPID','--',service],{
      encoding:'utf8',stdio:['ignore','pipe','pipe'],env:commandEnvironment,
      timeout:5000,maxBuffer:4096,killSignal:'SIGKILL'});
    if(result.status!==0||result.error||result.signal!==null||result.stderr!=='')return false;
    const entries=result.stdout.trim().split('\n').map(line=>line.split('='));
    if(entries.length!==3||entries.some(row=>row.length!==2))return false;
    const state=Object.fromEntries(entries);
    if(state.ActiveState!=='inactive'||state.SubState!=='dead'||state.MainPID!=='0')return false;
  }
  return true;
}
function journal(operationId,{resume=false}={}){
  const filename=path.join(BUYER_WRITER_GATEWAY_UPGRADE_STATE,operationId+'.journal.jsonl');
  const flags=resume?fs.constants.O_RDWR|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW
    :fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW;
  const fd=fs.openSync(filename,flags|fs.constants.O_CLOEXEC,0o600);
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.uid!==0||stat.gid!==0||stat.nlink!==1
    ||(stat.mode&0o7777)!==0o600||stat.size>65_536)fail();
  if(!resume){fs.fchownSync(fd,0,0);fs.fchmodSync(fd,0o600);fs.fsyncSync(fd);}
  const source=resume?fs.readFileSync(fd,'utf8'):'';
  if(resume&&source!==''&&!source.endsWith('\n'))fail();
  const events=source===''?[]:source.trimEnd().split('\n').map(row=>JSON.parse(row));
  const parent=fs.openSync(BUYER_WRITER_GATEWAY_UPGRADE_STATE,
    fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  return {
    events,
    append(event){
      events.push(event);
      const bytes=Buffer.from(JSON.stringify(event)+'\n');
      if(fs.writeSync(fd,bytes,0,bytes.length,null)!==bytes.length)fail();
      fs.fsyncSync(fd);
    },
    close(){fs.closeSync(fd);},
  };
}

let lock,stream;
try{
  const args=process.argv.slice(2),mode=args[0];
  if(process.getuid?.()!==0||process.versions.node!=='22.23.1'
    ||!['--inspect','--upgrade','--reconcile','--rollback'].includes(mode))fail();
  lock=acquireLock();
  const groupId=writerGroupId();
  const [,releaseSha,operationId,attemptId,artifactDigest,candidateDigest,candidateFile]=args;
  if(!/^[a-f0-9]{40}$/.test(releaseSha??'')
    ||![operationId,attemptId].every(value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value??''))
    ||operationId===attemptId)fail();
  if(mode==='--rollback'){
    if(args.length!==4)fail();
    const stateFile=path.join(BUYER_WRITER_GATEWAY_UPGRADE_STATE,operationId+'.state.json');
    const state=readRootOwnedJsonSnapshot(stateFile,{groupId:0,maxBytes:4096}).value;
    if(state?.version!==2||state.kind!=='buyer_writer_gateway_configuration_upgrade'
      ||state.releaseSha!==releaseSha||state.operationId!==operationId
      ||state.attemptId!==attemptId
      ||![state.artifactDigest,state.candidateDigest]
        .every(value=>/^[a-f0-9]{64}$/.test(value??'')))fail();
    const bound={releaseSha:state.releaseSha,operationId:state.operationId,
      attemptId:state.attemptId,artifactDigest:state.artifactDigest,
      candidateDigest:state.candidateDigest};
    const result=await rollbackBuyerWriterGatewayConfigurationFile({
      ...bound,writerGroupId:groupId,proveQuiesced});
    process.stdout.write(JSON.stringify(result)+'\n');
  }else{
    if(args.length!==7
      ||![artifactDigest,candidateDigest].every(value=>/^[a-f0-9]{64}$/.test(value??''))
      ||!path.isAbsolute(candidateFile)||path.resolve(candidateFile)!==candidateFile
      ||candidateFile==='/')fail();
    const artifact=await inspectSealedBuyerWriterArtifact({
      artifactRoot:path.join(releaseRoot,releaseSha),releaseSha,environment:'production',
    });
    if(artifact.status!=='SEALED_ARTIFACT_VERIFIED'||artifact.deployed!==false
      ||artifact.productionAccepted!==false||artifact.artifactDigest!==artifactDigest)fail();
    const candidate=readRootOwnedJsonSnapshot(candidateFile,{groupId:0,maxBytes:65_536}).value;
    const observedCandidateDigest=createHash('sha256')
      .update(JSON.stringify(candidate)+'\n').digest('hex');
    if(observedCandidateDigest!==candidateDigest)fail();
    const rendered=renderZolaGatewayConfigurations(candidate),config=rendered.config;
    const gatewayConfig=rendered.gatewayConfig;
    if(config.authority.releaseSha!==releaseSha||config.authority.operationId!==operationId
      ||config.authority.attemptId!==attemptId)fail();
    const bound={releaseSha,operationId,attemptId,artifactDigest,candidateDigest};
    let oldFile=BUYER_WRITER_GATEWAY_CONFIG_FILE;
    if(mode==='--reconcile'){
      const stateFile=path.join(BUYER_WRITER_GATEWAY_UPGRADE_STATE,operationId+'.state.json');
      const state=readRootOwnedJsonSnapshot(stateFile,{groupId:0,maxBytes:4096}).value;
      if(state?.phase!=='INTENT')
        oldFile=path.join(BUYER_WRITER_GATEWAY_UPGRADE_STATE,operationId+'.backup.json');
    }
    const oldConfiguration=readRootOwnedJsonSnapshot(oldFile,{
      groupId:oldFile===BUYER_WRITER_GATEWAY_CONFIG_FILE?groupId:0,maxBytes:65_536}).value;
    const inspection=inspectBuyerWriterGatewayConfigurationUpgrade({
      ...bound,oldConfiguration,newConfiguration:gatewayConfig});
    if(mode==='--inspect')process.stdout.write(JSON.stringify(inspection)+'\n');
    else if(mode==='--reconcile'){
      stream=journal(operationId,{resume:true});
      const result=await reconcileBuyerWriterGatewayConfigurationFile({
        ...bound,oldConfiguration,newConfiguration:gatewayConfig,
        journalEvents:stream.events,appendJournal:event=>stream.append(event),
        writerGroupId:groupId,proveQuiesced});
      process.stdout.write(JSON.stringify(result)+'\n');
    }else{
      safeStateDirectory();stream=journal(operationId);
      const controls=createBuyerWriterGatewayConfigurationFileControls({
        ...bound,writerGroupId:groupId,proveQuiesced});
      const result=await upgradeBuyerWriterGatewayConfiguration({
        ...bound,oldConfiguration,newConfiguration:gatewayConfig,controls,
        appendJournal:event=>stream.append(event),now:Date.now,
      });
      process.stdout.write(JSON.stringify(result)+'\n');
    }
  }
}catch{
  process.stderr.write('Buyer writer gateway configuration upgrade stopped; protected inputs and state were not disclosed\n');
  process.exitCode=1;
}finally{
  try{stream?.close();}catch{}
  if(lock!==undefined)try{fs.closeSync(lock);}catch{}
}
