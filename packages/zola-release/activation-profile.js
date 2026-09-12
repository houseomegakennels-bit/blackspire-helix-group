import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {validateBuyerWriterConfiguration} from '../buyer-writer/configuration.js';
import {captureBuyerWriterServiceProcesses} from '../buyer-writer/process-collector.js';
import {createBuyerWriterRuntimeInspector} from '../buyer-writer/runtime-inspection.js';
import {resolveBuyerWriterIdentity} from '../buyer-writer/runtime-identity.js';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';

const execute=promisify(execFile);
const fail=()=>{throw new Error('Zola activation profile preparation rejected');};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Observe actual supervisors/children and systemd invocations. No inferred PID,
// environment import, activation, credential installation or service restart.
export async function collectZolaActivationProfile({releaseSha,configurationFile},{run=execute,readSnapshot=readRootOwnedJsonSnapshot,
  collect=captureBuyerWriterServiceProcesses,inspectFactory=createBuyerWriterRuntimeInspector,resolveIdentity=resolveBuyerWriterIdentity,
  inspectArtifact=inspectBuyerWriterArtifact,uid=process.getuid()}={}){
  try{
    if(uid!==0||!(/^[a-f0-9]{40}$/).test(releaseSha??'')||typeof configurationFile!=='string')fail();
    const artifactRoot='/opt/blackspire-command/releases/'+releaseSha;
    const apiUnit='blackspire-command.service',workerUnit='blackspire-command-worker.service';
    const result=await run('/usr/bin/systemctl',['show','--no-pager','--property=MainPID','--value','--',apiUnit],
      {encoding:'utf8',timeout:1000,maxBuffer:1024,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
    if(result.stderr!==''||!(/^[1-9][0-9]{0,9}\n$/).test(result.stdout??''))fail();
    const mainPid=Number(result.stdout);
    const api=collect({mainPid,role:'api',artifactRoot,controlGroup:'/system.slice/'+apiUnit});
    const inspect=inspectFactory({apiPid:api.child.pid,apiUnit,workerUnit});
    const runtime=await inspect();
    if(runtime.api.supervisor.pid!==mainPid||!equal(runtime.api.supervisor,api.supervisor))fail();
    const identity=await resolveIdentity(api.child);
    const snapshot=readSnapshot(configurationFile,{groupId:identity.credentialGroupId,maxBytes:65536});
    const config=validateBuyerWriterConfiguration(snapshot.value,{workspace:'blackspire-command',environment:'production'});
    const worker=collect({mainPid:runtime.worker.pid,role:'worker',artifactRoot,controlGroup:'/system.slice/'+workerUnit});
    if(api.child.uid!==identity.uid||worker.child.uid!==identity.workerUid)fail();
    const context={filename:config.bindingFile,credentialGroupId:identity.credentialGroupId,workspace:config.workspace,releaseSha,
      apiGeneration:runtime.api.invocationId,apiUid:identity.uid,apiPid:api.child.pid,workerUid:identity.workerUid,
      apiUnit,workerUnit,artifactRoot,environment:'production',host:'127.0.0.1',port:8789};
    const artifact=await inspectArtifact(context);
    if(artifact.releaseSha!==releaseSha||artifact.environment!=='production'||!(/^[a-f0-9]{64}$/).test(artifact.artifactDigest??''))fail();
    if(!equal(snapshot,readSnapshot(configurationFile,{groupId:identity.credentialGroupId,maxBytes:65536}))
      ||!equal(runtime,await inspect())||!equal(api,collect({mainPid,role:'api',artifactRoot,controlGroup:runtime.api.controlGroup}))
      ||!equal(worker,collect({mainPid:runtime.worker.pid,role:'worker',artifactRoot,controlGroup:runtime.worker.controlGroup})))fail();
    return{profile:{version:1,configurationFile,context},artifactDigest:artifact.artifactDigest,workerGeneration:runtime.worker.invocationId};
  }catch{fail();}
}

// Exclusive publication: a stale/partial profile is never overwritten. The
// activation CLI independently re-observes everything before binding authority.
export function writeZolaActivationProfile(destination,value,{io=fs,uid=process.getuid()}={}){
  let fd;
  try{
    if(uid!==0||typeof destination!=='string'||!path.isAbsolute(destination)||path.resolve(destination)!==destination||destination==='/')fail();
    let current='/';
    for(const part of destination.split('/').slice(1,-1)){
      current=path.join(current,part);const stat=io.lstatSync(current);
      if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)fail();
    }
    const bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>16384)fail();
    fd=io.openSync(destination,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    const stat=io.fstatSync(fd);if(!stat.isFile()||stat.uid!==0||stat.nlink!==1)fail();
    io.fchmodSync(fd,0o600);io.writeFileSync(fd,bytes);io.fsyncSync(fd);io.closeSync(fd);fd=undefined;
    const parent=io.openSync(path.dirname(destination),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
    try{io.fsyncSync(parent);}finally{io.closeSync(parent);}
    return{sha256:createHash('sha256').update(bytes).digest('hex')};
  }catch{fail();}finally{if(fd!==undefined)io.closeSync(fd);}
}
