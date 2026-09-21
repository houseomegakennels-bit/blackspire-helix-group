import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {BUYER_STORE_MANIFEST} from './attestation.js';
import {exact,fail} from './local-protocol.js';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const defaultPaths={manifest:BUYER_STORE_MANIFEST,root:'/var/lib/blackspire-operator/buyer-store/publications',current:'/opt/blackspire-command/current',releases:'/opt/blackspire-command/releases'};
const readConfiguration=async()=>{
 const {validateBuyerStoreConfiguration,BUYER_STORE_CONFIGURATION}=await import('./configuration.js');
 const group=execFileSync('/usr/bin/getent',['group','blackspire-buyer-store'],{encoding:'utf8',timeout:1000,maxBuffer:4096}).trim().split(':');
 if(group.length!==4||group[0]!=='blackspire-buyer-store'||!/^\d+$/.test(group[2])||Number(group[2])===0)fail();
 const gid=Number(group[2]);
 return {configuration:validateBuyerStoreConfiguration(readRootOwnedJson(BUYER_STORE_CONFIGURATION,{groupId:gid,maxBytes:32768})),gid};
};
const observe=()=>execFileSync('/usr/bin/systemctl',['show','--property=InvocationID','--value','blackspire-command.service','blackspire-command-worker.service'],{encoding:'utf8',timeout:1000,maxBuffer:4096}).trim().split(/\s+/);
export async function publishBuyerStoreInstalledManifest(binding,{restore=false,paths=defaultPaths,io=fs,uid=process.getuid(),readConfig=readConfiguration,observeGenerations=observe,inspect=inspectSealedBuyerWriterArtifact,readProtected=readRootOwnedJson}={}){
 if(uid!==0||!exact(binding,['releaseSha','runId','apiGeneration','workerGeneration'])||!/^[a-f0-9]{40}$/.test(binding.releaseSha)||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(binding.runId)||![binding.apiGeneration,binding.workerGeneration].every(x=>/^[a-f0-9]{32}$/.test(x))||binding.apiGeneration===binding.workerGeneration)fail();
 const bytes=v=>Buffer.from(JSON.stringify(v)+'\n');
 const exists=p=>{try{io.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 const syncDir=p=>{const fd=io.openSync(p,io.constants.O_RDONLY);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}};
 const directory=p=>{if(!exists(p)){io.mkdirSync(p,{mode:0o700});syncDir(p.slice(0,p.lastIndexOf('/')));}const s=io.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0)fail();};
 const retain=(p,value)=>{let fd;try{fd=io.openSync(p,io.constants.O_CREAT|io.constants.O_EXCL|io.constants.O_WRONLY|io.constants.O_NOFOLLOW,0o600);io.writeFileSync(fd,bytes(value));io.fsyncSync(fd);}catch(e){if(e.code!=='EEXIST')throw e;if(JSON.stringify(readProtected(p,{groupId:0,maxBytes:32768}))!==JSON.stringify(value))fail();}finally{if(fd!==undefined)io.closeSync(fd);}syncDir(p.slice(0,p.lastIndexOf('/')));};
 const {configuration,gid}=await readConfig();
 if(configuration.client.releaseSha!==binding.releaseSha)fail();
 const artifactRoot=paths.releases+'/'+binding.releaseSha;
 if(io.realpathSync(paths.current)!==artifactRoot)fail();
 const proof=await inspect({artifactRoot,releaseSha:binding.releaseSha,environment:'production'});
 const candidate={version:1,kind:'buyer-store-installed',releaseSha:binding.releaseSha,artifactDigest:proof.artifactDigest,configurationDigest:hash(configuration),runId:binding.runId,apiGeneration:binding.apiGeneration,workerGeneration:binding.workerGeneration};
 if(!/^[a-f0-9]{64}$/.test(candidate.artifactDigest))fail();
 const check=()=>{const g=observeGenerations();if(g.length!==2||g[0]!==binding.apiGeneration||g[1]!==binding.workerGeneration||io.realpathSync(paths.current)!==artifactRoot)fail();};
 directory(paths.root);const operation=paths.root+'/'+hash(binding);directory(operation);
 let lock;try{
  lock=io.openSync(paths.root+'/lock',io.constants.O_CREAT|io.constants.O_EXCL|io.constants.O_WRONLY|io.constants.O_NOFOLLOW,0o600);
  const current=()=>{
   if(!exists(paths.manifest))return null;
   const value=readProtected(paths.manifest,{groupId:gid,maxBytes:16384}),stat=io.lstatSync(paths.manifest);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||stat.gid!==gid||stat.nlink!==1||(stat.mode&0o7777)!==0o640||!io.readFileSync(paths.manifest).equals(bytes(value)))fail();
   return value;
  };
  const planFile=operation+'/plan.json';
  let plan;
  if(exists(planFile))plan=readProtected(planFile,{groupId:0,maxBytes:32768});
  else{if(restore)fail();check();plan={version:1,binding,before:current(),candidate};retain(planFile,plan);}
  if(!exact(plan,['version','binding','before','candidate'])||plan.version!==1||JSON.stringify(plan.binding)!==JSON.stringify(binding)||JSON.stringify(plan.candidate)!==JSON.stringify(candidate))fail();
  const destination=restore?plan.before:plan.candidate,source=restore?plan.candidate:plan.before,actual=current();
  if(JSON.stringify(actual)!==JSON.stringify(source)&&JSON.stringify(actual)!==JSON.stringify(destination))fail();
  if(!restore)check();
  retain(operation+(restore?'/restore-intent.json':'/intent.json'),{version:1,planDigest:hash(plan)});
  if(JSON.stringify(actual)!==JSON.stringify(destination)){
   if(destination===null)io.unlinkSync(paths.manifest);
   else{
    const temporary=paths.manifest+'.'+hash(binding)+'.pending';
    if(exists(temporary)){
     const retained=readProtected(temporary,{groupId:gid,maxBytes:16384});
     if(JSON.stringify(retained)!==JSON.stringify(destination))fail();
    }else{
     const fd=io.openSync(temporary,io.constants.O_CREAT|io.constants.O_EXCL|io.constants.O_WRONLY|io.constants.O_NOFOLLOW,0o640);
     try{io.writeFileSync(fd,bytes(destination));io.fchownSync(fd,0,gid);io.fchmodSync(fd,0o640);io.fsyncSync(fd);}finally{io.closeSync(fd);}
    }
    io.renameSync(temporary,paths.manifest);
   }
   syncDir(paths.manifest.slice(0,paths.manifest.lastIndexOf('/')));
  }
  if(!restore)check();
  const finalConfig=await readConfig();if(finalConfig.gid!==gid||JSON.stringify(finalConfig.configuration)!==JSON.stringify(configuration))fail();
  if(JSON.stringify(current())!==JSON.stringify(destination))fail();
  retain(operation+(restore?'/restore-result.json':'/result.json'),{version:1,planDigest:hash(plan),status:restore?'RESTORED':'PUBLISHED'});
  return {status:restore?'BUYER_STORE_MANIFEST_RESTORED':'BUYER_STORE_MANIFEST_PUBLISHED',releaseSha:binding.releaseSha,manifestDigest:destination===null?null:hash(destination)};
 }finally{if(lock!==undefined){io.closeSync(lock);io.unlinkSync(paths.root+'/lock');syncDir(paths.root);}}
}
