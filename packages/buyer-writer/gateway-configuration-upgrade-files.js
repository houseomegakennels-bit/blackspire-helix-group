import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const BUYER_WRITER_GATEWAY_CONFIG_FILE='/etc/blackspire-buyer-writer-gateway/gateway.json';
export const BUYER_WRITER_GATEWAY_UPGRADE_STATE='/var/lib/blackspire-operator/gateway-configuration-upgrade';

const plans=new WeakMap();
const fail=()=>{throw new Error('Buyer writer gateway configuration file upgrade failed');};
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

function noExtendedAcl(aclTool,fd){
  const result=aclTool('/usr/bin/getfacl',
    ['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{
      stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:250,maxBuffer:4096,
      killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin'},
    });
  if(result.status!==0||result.error||result.signal!==null||result.stdout!==''||result.stderr!=='')fail();
}
function safeDirectory(io,directory,{uid=0,gid=0,mode,aclTool=spawnSync}={}){
  let fd;
  try{
    fd=io.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
    const stat=io.fstatSync(fd);
    if(!stat.isDirectory()||stat.uid!==uid||stat.gid!==gid||(stat.mode&0o7777)!==mode)fail();
    noExtendedAcl(aclTool,fd);
  }finally{if(fd!==undefined)io.closeSync(fd);}
}
function syncDirectory(io,directory){
  const fd=io.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{io.fsyncSync(fd);}finally{io.closeSync(fd);}
}
function requireAbsent(io,filename){
  try{io.lstatSync(filename);fail();}catch(error){if(error?.code!=='ENOENT')throw error;}
}
function snapshot(io,filename,{uid,gid,mode,maxBytes=65_536,aclTool=spawnSync}){
  let fd;
  try{
    fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const before=io.fstatSync(fd);
    if(!before.isFile()||before.isSymbolicLink?.()||before.uid!==uid||before.gid!==gid
      ||before.nlink!==1||(before.mode&0o7777)!==mode||before.size<2||before.size>maxBytes)fail();
    noExtendedAcl(aclTool,fd);
    const bytes=Buffer.alloc(before.size);
    if(io.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)fail();
    const after=io.fstatSync(fd);
    for(const key of ['uid','gid','mode','nlink','size','dev','ino','mtimeMs','ctimeMs'])
      if(before[key]!==after[key])fail();
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    return {bytes,value,identity:before};
  }catch(error){
    if(error?.message==='Buyer writer gateway configuration file upgrade failed')throw error;
    fail();
  }finally{if(fd!==undefined)try{io.closeSync(fd);}catch{}}
}
function exclusive(io,filename,bytes,{uid,gid,mode,aclTool=spawnSync}){
  let fd,created=false,complete=false;
  try{
    fd=io.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL
      |fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);created=true;
    io.fchownSync(fd,uid,gid);io.fchmodSync(fd,mode);noExtendedAcl(aclTool,fd);
    if(io.writeSync(fd,bytes,0,bytes.length,0)!==bytes.length)fail();
    io.fsyncSync(fd);complete=true;
  }finally{
    if(fd!==undefined)io.closeSync(fd);
    if(created&&!complete)try{io.unlinkSync(filename);}catch(error){if(error?.code!=='ENOENT')throw error;}
  }
}
function atomicState(io,filename,value,aclTool=spawnSync){
  const bytes=Buffer.from(JSON.stringify(value)+'\n');
  const temporary=filename+'.new-'+randomUUID();
  let renamed=false;
  try{
    exclusive(io,temporary,bytes,{uid:0,gid:0,mode:0o600,aclTool});
    io.renameSync(temporary,filename);renamed=true;syncDirectory(io,path.dirname(filename));
  }finally{
    if(!renamed)try{io.unlinkSync(temporary);}catch(error){if(error?.code!=='ENOENT')throw error;}
  }
}
function stateValue(plan,phase){
  return {version:2,kind:'buyer_writer_gateway_configuration_upgrade',
    releaseSha:plan.releaseSha,operationId:plan.operationId,attemptId:plan.attemptId,
    artifactDigest:plan.artifactDigest,candidateDigest:plan.candidateDigest,
    phase,configurationFile:plan.configurationFile,backupFile:plan.backupFile,
    oldConfigDigest:plan.oldConfigDigest,newConfigDigest:plan.newConfigDigest};
}
function currentMatches(plan,value){
  const found=snapshot(plan.io,plan.configurationFile,{uid:0,gid:plan.writerGroupId,mode:0o640,
    aclTool:plan.aclTool});
  return same(found.value,value);
}

export function createBuyerWriterGatewayConfigurationFileControls({
  releaseSha,operationId,attemptId,artifactDigest,candidateDigest,
  writerGroupId,configurationFile=BUYER_WRITER_GATEWAY_CONFIG_FILE,
  stateDirectory=BUYER_WRITER_GATEWAY_UPGRADE_STATE,io=fs,aclTool=spawnSync,proveQuiesced,
}={}){
  if(!SHA.test(releaseSha??'')||!UUID.test(operationId??'')||!UUID.test(attemptId??'')
    ||operationId===attemptId||!DIGEST.test(artifactDigest??'')||!DIGEST.test(candidateDigest??'')
    ||!Number.isSafeInteger(writerGroupId)||writerGroupId<1||typeof aclTool!=='function'
    ||typeof proveQuiesced!=='function'
    ||!path.isAbsolute(configurationFile)||path.resolve(configurationFile)!==configurationFile
    ||!path.isAbsolute(stateDirectory)||path.resolve(stateDirectory)!==stateDirectory)fail();
  safeDirectory(io,path.dirname(configurationFile),{uid:0,gid:writerGroupId,mode:0o750,aclTool});
  safeDirectory(io,stateDirectory,{uid:0,gid:0,mode:0o700,aclTool});
  const backupFile=path.join(stateDirectory,operationId+'.backup.json');
  const stateFile=path.join(stateDirectory,operationId+'.state.json');
  const candidateFile=path.join(stateDirectory,'.'+operationId+'.candidate');
  const restoreFile=path.join(stateDirectory,'.'+operationId+'.restore');
  const controls={
    async assertQuiesced(){return await proveQuiesced()===true;},
    async prepareReplacement(oldConfiguration,newConfiguration){
      requireAbsent(io,backupFile);requireAbsent(io,stateFile);requireAbsent(io,candidateFile);
      const current=snapshot(io,configurationFile,{uid:0,gid:writerGroupId,mode:0o640});
      if(!same(current.value,oldConfiguration))fail();
      const candidateBytes=Buffer.from(JSON.stringify(newConfiguration)+'\n');
      const plan=Object.freeze({releaseSha,operationId,attemptId,artifactDigest,candidateDigest,
        writerGroupId,configurationFile,stateDirectory,backupFile,stateFile,candidateFile,
        restoreFile,oldConfiguration,newConfiguration,
        oldConfigDigest:hash(Buffer.from(JSON.stringify(oldConfiguration)+'\n')),
        newConfigDigest:hash(candidateBytes),candidateBytes,io,aclTool});
      atomicState(io,stateFile,stateValue(plan,'INTENT'));
      exclusive(io,backupFile,current.bytes,{uid:0,gid:0,mode:0o600});
      exclusive(io,candidateFile,candidateBytes,{uid:0,gid:writerGroupId,mode:0o640});
      atomicState(io,stateFile,stateValue(plan,'PREPARED'));
      const prepared=Object.freeze({operationId});
      plans.set(prepared,plan);return prepared;
    },
    async publishReplacement(prepared,newConfiguration){
      const plan=plans.get(prepared);
      if(!plan||plan.operationId!==operationId||!same(plan.newConfiguration,newConfiguration)
        ||await proveQuiesced()!==true||!currentMatches(plan,plan.oldConfiguration))fail();
      const candidate=snapshot(io,candidateFile,{uid:0,gid:writerGroupId,mode:0o640});
      if(!candidate.bytes.equals(plan.candidateBytes)||await proveQuiesced()!==true)fail();
      io.renameSync(candidateFile,configurationFile);syncDirectory(io,path.dirname(configurationFile));
      atomicState(io,stateFile,stateValue(plan,'PUBLISHED'));
      return currentMatches(plan,plan.newConfiguration);
    },
    async verifyReplacement(configuration){
      try{
        const found=snapshot(io,configurationFile,{uid:0,gid:writerGroupId,mode:0o640});
        return same(found.value,configuration);
      }catch{return false;}
    },
    async restoreReplacement(prepared,oldConfiguration){
      const plan=plans.get(prepared);
      if(!plan||!same(plan.oldConfiguration,oldConfiguration)||await proveQuiesced()!==true)fail();
      requireAbsent(io,restoreFile);
      const backup=snapshot(io,backupFile,{uid:0,gid:0,mode:0o600});
      if(!same(backup.value,plan.oldConfiguration))fail();
      let renamed=false;
      try{
        exclusive(io,restoreFile,backup.bytes,{uid:0,gid:writerGroupId,mode:0o640});
        if(await proveQuiesced()!==true)fail();
        io.renameSync(restoreFile,configurationFile);renamed=true;
        syncDirectory(io,path.dirname(configurationFile));
      }finally{
        if(!renamed)try{io.unlinkSync(restoreFile);}catch(error){if(error?.code!=='ENOENT')throw error;}
      }
      atomicState(io,stateFile,stateValue(plan,'RESTORED'));
      return currentMatches(plan,plan.oldConfiguration);
    },
    async finalizeReplacement(prepared,mode){
      const plan=plans.get(prepared);
      if(!plan||!['commit','rollback'].includes(mode))fail();
      const expected=mode==='commit'?plan.newConfiguration:plan.oldConfiguration;
      if(!currentMatches(plan,expected))fail();
      atomicState(io,stateFile,stateValue(plan,mode==='commit'?'COMPLETED':'ROLLED_BACK'));
      return true;
    },
  };
  return Object.freeze(controls);
}

function binding({releaseSha,operationId,attemptId,artifactDigest,candidateDigest}){
  if(!SHA.test(releaseSha??'')||!UUID.test(operationId??'')||!UUID.test(attemptId??'')
    ||operationId===attemptId||!DIGEST.test(artifactDigest??'')||!DIGEST.test(candidateDigest??''))fail();
  return {releaseSha,operationId,attemptId,artifactDigest,candidateDigest};
}
function inspectJournal(events,bound,oldConfigDigest,newConfigDigest){
  if(!Array.isArray(events)||events.length<1)fail();
  const next={started:['quiesced','fail-closed'],
    quiesced:['prepared','rolled-back','fail-closed'],
    prepared:['configuration-published','rolled-back','fail-closed'],
    'configuration-published':['configuration-verified','rolled-back','fail-closed'],
    'configuration-verified':['completed','rolled-back','fail-closed'],
    completed:[],'rolled-back':[],'fail-closed':[]};
  let prior;
  for(const row of events){
    const keys=['version','kind','releaseSha','operationId','attemptId','artifactDigest',
      'candidateDigest','phase','status','oldConfigDigest','newConfigDigest','updatedAt'];
    if(!row||typeof row!=='object'||Array.isArray(row)
      ||Object.keys(row).sort().join(',')!==keys.sort().join(',')
      ||row.version!==1||row.kind!=='buyer_writer_gateway_configuration_upgrade'
      ||Object.keys(bound).some(key=>row[key]!==bound[key])
      ||row.oldConfigDigest!==oldConfigDigest||row.newConfigDigest!==newConfigDigest
      ||!Object.hasOwn(next,row.phase)||!Number.isFinite(Date.parse(row.updatedAt))
      ||(prior===undefined?row.phase!=='started':!next[prior].includes(row.phase)))fail();
    const expected=row.phase==='completed'?'COMPLETED':row.phase==='rolled-back'?'ROLLED_BACK'
      :row.phase==='fail-closed'?'FAIL_CLOSED':'IN_PROGRESS';
    if(row.status!==expected)fail();prior=row.phase;
  }
  return prior;
}
function journalRow(bound,state,phase,now){
  return {version:1,kind:'buyer_writer_gateway_configuration_upgrade',...bound,phase,
    status:phase==='completed'?'COMPLETED':phase==='rolled-back'?'ROLLED_BACK':'IN_PROGRESS',
    oldConfigDigest:state.oldConfigDigest,newConfigDigest:state.newConfigDigest,
    updatedAt:new Date(now()).toISOString()};
}

export async function rollbackBuyerWriterGatewayConfigurationFile({
  releaseSha,operationId,attemptId,artifactDigest,candidateDigest,
  writerGroupId,configurationFile=BUYER_WRITER_GATEWAY_CONFIG_FILE,
  stateDirectory=BUYER_WRITER_GATEWAY_UPGRADE_STATE,io=fs,aclTool=spawnSync,proveQuiesced,
}={}){
  try{
    if(!SHA.test(releaseSha??'')||!UUID.test(operationId??'')||!UUID.test(attemptId??'')
      ||operationId===attemptId||!DIGEST.test(artifactDigest??'')||!DIGEST.test(candidateDigest??'')
      ||!Number.isSafeInteger(writerGroupId)||writerGroupId<1||typeof aclTool!=='function'
      ||typeof proveQuiesced!=='function'
      ||await proveQuiesced()!==true)fail();
    safeDirectory(io,path.dirname(configurationFile),{uid:0,gid:writerGroupId,mode:0o750,aclTool});
    safeDirectory(io,stateDirectory,{uid:0,gid:0,mode:0o700,aclTool});
    const stateFile=path.join(stateDirectory,operationId+'.state.json');
    const backupFile=path.join(stateDirectory,operationId+'.backup.json');
    const state=snapshot(io,stateFile,{uid:0,gid:0,mode:0o600,maxBytes:4096}).value;
    if(!state||typeof state!=='object'||Array.isArray(state)
      ||Object.keys(state).sort().join(',')!=='artifactDigest,attemptId,backupFile,candidateDigest,configurationFile,kind,newConfigDigest,oldConfigDigest,operationId,phase,releaseSha,version'
      ||state.version!==2||state.kind!=='buyer_writer_gateway_configuration_upgrade'
      ||state.releaseSha!==releaseSha||state.operationId!==operationId||state.attemptId!==attemptId
      ||state.artifactDigest!==artifactDigest||state.candidateDigest!==candidateDigest
      ||state.configurationFile!==configurationFile
      ||state.backupFile!==backupFile
      ||!['INTENT','PREPARED','PUBLISHED','COMPLETED'].includes(state.phase)
      ||!['oldConfigDigest','newConfigDigest'].every(key=>/^[a-f0-9]{64}$/.test(state[key])))fail();
    const current=snapshot(io,configurationFile,{uid:0,gid:writerGroupId,mode:0o640});
    const canonical=value=>hash(Buffer.from(JSON.stringify(value)+'\n'));
    const currentDigest=canonical(current.value);
    if(currentDigest===state.oldConfigDigest){
      if(state.phase!=='INTENT'){
        const backup=snapshot(io,backupFile,{uid:0,gid:0,mode:0o600});
        if(canonical(backup.value)!==state.oldConfigDigest)fail();
      }
      atomicState(io,stateFile,{...state,phase:'ROLLED_BACK'});
    }else{
      if(currentDigest!==state.newConfigDigest)fail();
      const backup=snapshot(io,backupFile,{uid:0,gid:0,mode:0o600});
      if(canonical(backup.value)!==state.oldConfigDigest)fail();
      const restoreFile=path.join(stateDirectory,'.'+operationId+'.manual-restore');
      requireAbsent(io,restoreFile);
      let renamed=false;
      try{
        exclusive(io,restoreFile,backup.bytes,{uid:0,gid:writerGroupId,mode:0o640});
        if(await proveQuiesced()!==true)fail();
        io.renameSync(restoreFile,configurationFile);renamed=true;
        syncDirectory(io,path.dirname(configurationFile));
      }finally{
        if(!renamed)try{io.unlinkSync(restoreFile);}catch(error){if(error?.code!=='ENOENT')throw error;}
      }
      const restored=snapshot(io,configurationFile,{uid:0,gid:writerGroupId,mode:0o640});
      if(canonical(restored.value)!==state.oldConfigDigest)fail();
      atomicState(io,stateFile,{...state,phase:'ROLLED_BACK'});
    }
    return Object.freeze({status:'ROLLED_BACK',operationId,
      oldConfigDigest:state.oldConfigDigest,newConfigDigest:state.newConfigDigest});
  }catch(error){
    if(error?.message==='Buyer writer gateway configuration file upgrade failed')throw error;
    fail();
  }
}

export async function reconcileBuyerWriterGatewayConfigurationFile({
  releaseSha,operationId,attemptId,artifactDigest,candidateDigest,
  oldConfiguration,newConfiguration,journalEvents,appendJournal,now=Date.now,
  writerGroupId,configurationFile=BUYER_WRITER_GATEWAY_CONFIG_FILE,
  stateDirectory=BUYER_WRITER_GATEWAY_UPGRADE_STATE,io=fs,aclTool=spawnSync,proveQuiesced,
}={}){
  try{
    const bound=binding({releaseSha,operationId,attemptId,artifactDigest,candidateDigest});
    if(!Number.isSafeInteger(writerGroupId)||writerGroupId<1||typeof appendJournal!=='function'
      ||typeof now!=='function'||typeof proveQuiesced!=='function'||await proveQuiesced()!==true)fail();
    safeDirectory(io,path.dirname(configurationFile),{uid:0,gid:writerGroupId,mode:0o750,aclTool});
    safeDirectory(io,stateDirectory,{uid:0,gid:0,mode:0o700,aclTool});
    const stateFile=path.join(stateDirectory,operationId+'.state.json');
    const backupFile=path.join(stateDirectory,operationId+'.backup.json');
    const state=snapshot(io,stateFile,{uid:0,gid:0,mode:0o600,maxBytes:4096}).value;
    const keys='artifactDigest,attemptId,backupFile,candidateDigest,configurationFile,kind,newConfigDigest,oldConfigDigest,operationId,phase,releaseSha,version';
    if(!state||typeof state!=='object'||Array.isArray(state)
      ||Object.keys(state).sort().join(',')!==keys||state.version!==2
      ||state.kind!=='buyer_writer_gateway_configuration_upgrade'
      ||Object.keys(bound).some(key=>state[key]!==bound[key])
      ||state.configurationFile!==configurationFile||state.backupFile!==backupFile
      ||!['INTENT','PREPARED','PUBLISHED','COMPLETED','ROLLED_BACK'].includes(state.phase)
      ||!DIGEST.test(state.oldConfigDigest??'')||!DIGEST.test(state.newConfigDigest??''))fail();
    const canonical=value=>hash(Buffer.from(JSON.stringify(value)+'\n'));
    if(canonical(oldConfiguration)!==state.oldConfigDigest
      ||canonical(newConfiguration)!==state.newConfigDigest)fail();
    const prior=inspectJournal(journalEvents,bound,state.oldConfigDigest,state.newConfigDigest);
    if(prior==='fail-closed')fail();
    const current=snapshot(io,configurationFile,{uid:0,gid:writerGroupId,mode:0o640,aclTool});
    const currentDigest=canonical(current.value);
    if(![state.oldConfigDigest,state.newConfigDigest].includes(currentDigest))fail();
    if(state.phase!=='INTENT'){
      const backup=snapshot(io,backupFile,{uid:0,gid:0,mode:0o600,aclTool});
      if(canonical(backup.value)!==state.oldConfigDigest)fail();
    }
    if(currentDigest===state.newConfigDigest){
      if(['INTENT','ROLLED_BACK'].includes(state.phase)||prior==='rolled-back')fail();
      if(prior==='completed'){
        if(!['PUBLISHED','COMPLETED'].includes(state.phase))fail();
        if(await proveQuiesced()!==true)fail();
        if(state.phase==='PUBLISHED')
          atomicState(io,stateFile,{...state,phase:'COMPLETED'},aclTool);
        return Object.freeze({status:'UPGRADED',reconciled:true,...bound,
          oldConfigDigest:state.oldConfigDigest,newConfigDigest:state.newConfigDigest});
      }
      const phases=['configuration-published','configuration-verified','completed'];
      const indices={prepared:0,'configuration-published':1,'configuration-verified':2,completed:3};
      if(indices[prior]===undefined)fail();
      for(const phase of phases.slice(indices[prior])){
        await appendJournal(journalRow(bound,state,phase,now));
      }
      if(await proveQuiesced()!==true)fail();
      atomicState(io,stateFile,{...state,phase:'COMPLETED'},aclTool);
      return Object.freeze({status:'UPGRADED',reconciled:true,...bound,
        oldConfigDigest:state.oldConfigDigest,newConfigDigest:state.newConfigDigest});
    }
    if(prior==='completed'||state.phase==='COMPLETED')fail();
    let rollbackPrior=prior;
    if(state.phase==='PREPARED'&&rollbackPrior==='quiesced'){
      await appendJournal(journalRow(bound,state,'prepared',now));
      rollbackPrior='prepared';
    }
    if(rollbackPrior!=='rolled-back'){
      await appendJournal(journalRow(bound,state,'rolled-back',now));
    }
    if(await proveQuiesced()!==true)fail();
    atomicState(io,stateFile,{...state,phase:'ROLLED_BACK'},aclTool);
    return Object.freeze({status:'ROLLED_BACK',reconciled:true,...bound,
      oldConfigDigest:state.oldConfigDigest,newConfigDigest:state.newConfigDigest});
  }catch(error){
    if(error?.message==='Buyer writer gateway configuration file upgrade failed')throw error;
    fail();
  }
}
