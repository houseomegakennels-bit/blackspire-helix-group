#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
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
function journal(operationId){
  const filename=path.join(BUYER_WRITER_GATEWAY_UPGRADE_STATE,operationId+'.journal.jsonl');
  const fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL
    |fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
  fs.fchownSync(fd,0,0);fs.fchmodSync(fd,0o600);fs.fsyncSync(fd);
  const parent=fs.openSync(BUYER_WRITER_GATEWAY_UPGRADE_STATE,
    fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  return {
    append(event){
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
    ||!['--inspect','--upgrade','--rollback'].includes(mode))fail();
  lock=acquireLock();
  const groupId=writerGroupId();
  if(mode==='--rollback'){
    if(args.length!==2||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(args[1]??''))fail();
    const result=await rollbackBuyerWriterGatewayConfigurationFile({
      operationId:args[1],writerGroupId:groupId,proveQuiesced});
    process.stdout.write(JSON.stringify(result)+'\n');
  }else{
    const [,releaseSha,operationId,candidateFile]=args;
    if(args.length!==4||!/^[a-f0-9]{40}$/.test(releaseSha??'')
      ||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(operationId??'')
      ||!path.isAbsolute(candidateFile)||path.resolve(candidateFile)!==candidateFile
      ||candidateFile==='/')fail();
    const artifact=await inspectSealedBuyerWriterArtifact({
      artifactRoot:path.join(releaseRoot,releaseSha),releaseSha,environment:'production',
    });
    if(artifact.status!=='SEALED_ARTIFACT_VERIFIED'||artifact.deployed!==false
      ||artifact.productionAccepted!==false)fail();
    const current=readRootOwnedJsonSnapshot(BUYER_WRITER_GATEWAY_CONFIG_FILE,{
      groupId,maxBytes:65_536}).value;
    const candidate=readRootOwnedJsonSnapshot(candidateFile,{groupId:0,maxBytes:65_536}).value;
    const rendered=renderZolaGatewayConfigurations(candidate),config=rendered.config;
    const gatewayConfig=rendered.gatewayConfig;
    if(config.authority.releaseSha!==releaseSha)fail();
    const inspection=inspectBuyerWriterGatewayConfigurationUpgrade({
      operationId,oldConfiguration:current,newConfiguration:gatewayConfig});
    if(mode==='--inspect')process.stdout.write(JSON.stringify(inspection)+'\n');
    else{
      safeStateDirectory();stream=journal(operationId);
      const controls=createBuyerWriterGatewayConfigurationFileControls({
        operationId,writerGroupId:groupId,proveQuiesced});
      const result=await upgradeBuyerWriterGatewayConfiguration({
        operationId,oldConfiguration:current,newConfiguration:gatewayConfig,controls,
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
