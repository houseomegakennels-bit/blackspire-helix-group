import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const BUYER_WRITER_GATEWAY_CONFIG_FILE='/etc/blackspire-buyer-writer-gateway/gateway.json';
export const BUYER_WRITER_GATEWAY_UPGRADE_STATE='/var/lib/blackspire-operator/gateway-configuration-upgrade';

const plans=new WeakMap();
const fail=()=>{throw new Error('Buyer writer gateway configuration file upgrade failed');};
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
  return {version:1,kind:'buyer_writer_gateway_configuration_upgrade',
    operationId:plan.operationId,phase,configurationFile:plan.configurationFile,
    backupFile:plan.backupFile,oldConfigDigest:plan.oldConfigDigest,
    newConfigDigest:plan.newConfigDigest};
}
function currentMatches(plan,value){
  const found=snapshot(plan.io,plan.configurationFile,{uid:0,gid:plan.writerGroupId,mode:0o640,
    aclTool:plan.aclTool});
  return same(found.value,value);
}

export function createBuyerWriterGatewayConfigurationFileControls({
  operationId,writerGroupId,configurationFile=BUYER_WRITER_GATEWAY_CONFIG_FILE,
  stateDirectory=BUYER_WRITER_GATEWAY_UPGRADE_STATE,io=fs,aclTool=spawnSync,proveQuiesced,
}={}){
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(operationId??'')
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
      const plan=Object.freeze({operationId,writerGroupId,configurationFile,stateDirectory,
        backupFile,stateFile,candidateFile,restoreFile,oldConfiguration,newConfiguration,
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

export async function rollbackBuyerWriterGatewayConfigurationFile({
  operationId,writerGroupId,configurationFile=BUYER_WRITER_GATEWAY_CONFIG_FILE,
  stateDirectory=BUYER_WRITER_GATEWAY_UPGRADE_STATE,io=fs,aclTool=spawnSync,proveQuiesced,
}={}){
  try{
    if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(operationId??'')
      ||!Number.isSafeInteger(writerGroupId)||writerGroupId<1||typeof aclTool!=='function'
      ||typeof proveQuiesced!=='function'
      ||await proveQuiesced()!==true)fail();
    safeDirectory(io,path.dirname(configurationFile),{uid:0,gid:writerGroupId,mode:0o750,aclTool});
    safeDirectory(io,stateDirectory,{uid:0,gid:0,mode:0o700,aclTool});
    const stateFile=path.join(stateDirectory,operationId+'.state.json');
    const backupFile=path.join(stateDirectory,operationId+'.backup.json');
    const state=snapshot(io,stateFile,{uid:0,gid:0,mode:0o600,maxBytes:4096}).value;
    if(!state||typeof state!=='object'||Array.isArray(state)
      ||Object.keys(state).sort().join(',')!=='backupFile,configurationFile,kind,newConfigDigest,oldConfigDigest,operationId,phase,version'
      ||state.version!==1||state.kind!=='buyer_writer_gateway_configuration_upgrade'
      ||state.operationId!==operationId||state.configurationFile!==configurationFile
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
