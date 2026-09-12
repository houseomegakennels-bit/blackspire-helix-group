import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readRootOwnedJson,readRootOwnedMetadataSnapshot} from '../packages/buyer-writer/protected-json.js';
import {verifyReleaseSource,readReleaseProtectedBytes} from '../packages/zola-release/commander-host.js';
import {prepareN8nTransition,createN8nTransport,executeN8nTransition,WORKFLOW_ID} from '../packages/zola-release/commander-n8n.js';
import {prepareOfflineReleaseBundle,writeOfflineReleaseBundle} from '../packages/zola-release/offline-bundle.js';

const OUTPUT_ROOT='/var/lib/blackspire-operator/preparation';
const CREDENTIAL_FILE='/var/lib/blackspire-operator/n8n-api-key';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const reject=()=>{throw new Error('Exact-head n8n repin rejected');};
function checkDirectory(directory){
 for(let current=directory;;current=path.dirname(current)){
  const stat=fs.lstatSync(current),acl=spawnSync('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--',current],
   {encoding:'utf8',timeout:1000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0||acl.status!==0||acl.error||acl.stdout!==''||acl.stderr!=='')reject();
  if(current==='/')break;
 }
}
function writeProtected(filename,value){
 const bytes=JSON.stringify(value,null,2)+'\n';
 const fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 if(readReleaseProtectedBytes(filename,2*1024*1024)!==bytes)reject();
 const directory=fs.openSync(path.dirname(filename),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
 return bytes;
}

export async function repinExactHeadN8n({releaseSha,priorInputFile},{transportFactory=createN8nTransport}={}){
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||!/^[a-f0-9]{40}$/.test(releaseSha??'')
  ||typeof priorInputFile!=='string'||!path.isAbsolute(priorInputFile)||path.resolve(priorInputFile)!==priorInputFile)reject();
 verifyReleaseSource(releaseSha);checkDirectory(OUTPUT_ROOT);
 const prior=readRootOwnedJson(priorInputFile,{groupId:0});
 if(Object.keys(prior).sort().join(',')!=='backupFile,migrationConfigurationFile,n8nConfigurationFile,releaseSha')reject();
 const oldN8n=readRootOwnedJson(prior.n8nConfigurationFile,{groupId:0});
 const oldMigration=readRootOwnedMetadataSnapshot(prior.migrationConfigurationFile,{groupId:0}).value;
 const oldBackup=readReleaseProtectedBytes(prior.backupFile,2*1024*1024);
 const oldPlan=prepareN8nTransition({configuration:oldN8n,backupBytes:oldBackup});
 const key=readReleaseProtectedBytes(CREDENTIAL_FILE,16384).trim();
 if(key.length<16)reject();
 const transport=transportFactory(key),observations=[];
 const request=async(method,pathname,body)=>{
  if(method!=='GET'||pathname!==`/api/v1/workflows/${WORKFLOW_ID}`||body!==undefined||observations.length>=2)reject();
  const result=await transport(method,pathname);observations.push(result);return result;
 };
 const observed=await executeN8nTransition({plan:oldPlan,mode:'inspect',request,journal:{events:()=>[],append:()=>{}}});
 if(observations.length!==2||observed.state.kind!=='BASELINE'||observed.state.active!==true||observed.mutationSent!==false)reject();
 verifyReleaseSource(releaseSha);
 const directory=path.join(OUTPUT_ROOT,`repin-${releaseSha.slice(0,7)}-${randomUUID()}`);
 fs.mkdirSync(directory,{mode:0o700});checkDirectory(directory);
 const backupFile=path.join(directory,'n8n-backup.json'),backupBytes=writeProtected(backupFile,observations[1]);
 const n8n={...oldN8n,releaseSha,backupSha256:hash(backupBytes)},migration={...oldMigration,releaseSha};
 writeProtected(path.join(directory,'n8n-input.json'),n8n);writeProtected(path.join(directory,'migration-input.json'),migration);
 const input={releaseSha,n8nConfigurationFile:path.join(directory,'n8n-input.json'),migrationConfigurationFile:path.join(directory,'migration-input.json'),backupFile};
 const inputFile=path.join(directory,'input.json');writeProtected(inputFile,input);
 const bundle=prepareOfflineReleaseBundle({releaseSha,n8nConfiguration:n8n,providerManifest:migration.providerManifest,backupBytes});
 const result=writeOfflineReleaseBundle(path.join(directory,'bundle'),bundle);
 verifyReleaseSource(releaseSha);
 const report={...result,inputFile,bundleDirectory:path.join(directory,'bundle'),backupFile,n8nState:observed.state,
  observedAt:new Date().toISOString(),workflowReadRequests:observations.length,liveMutation:false};
 writeProtected(path.join(directory,'report.json'),report);
 return Object.freeze(report);
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4)reject();
  const report=await repinExactHeadN8n({releaseSha:process.argv[2],priorInputFile:process.argv[3]});
  process.stdout.write(JSON.stringify(report)+'\n');
 }catch{
  process.stdout.write(JSON.stringify({status:'STOPPED',reason:'EXACT_HEAD_N8N_REPIN_REJECTED',productionAccepted:false,liveMutation:false})+'\n');
  process.exitCode=1;
 }
}
