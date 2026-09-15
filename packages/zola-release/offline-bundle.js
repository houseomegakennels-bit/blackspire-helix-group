import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {prepareBuyerWorkflowPackage} from '../buyer-writer/n8n-package.js';
import {prepareBuyerMigrationPackage} from '../buyer-writer/migration-package.js';
import {prepareN8nTransition,WORKFLOW_ID} from './commander-n8n.js';
import {readReleaseProtectedBytes} from './commander-host.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const preparedBundles=new WeakSet();
const reject=()=>{throw new Error('Offline release bundle rejected');};

// Regenerate reviewed source bytes, never copy prior readiness claims or the
// secret-bearing legacy workflow backup. Backup bytes are consumed only by the
// existing strict transition planner; their digest binds the output.
export function prepareOfflineReleaseBundle({releaseSha,n8nConfiguration,providerManifest,backupBytes}){
 try{
  if(!/^[a-f0-9]{40}$/.test(releaseSha??'')||n8nConfiguration?.releaseSha!==releaseSha)reject();
  const workflow=prepareBuyerWorkflowPackage(n8nConfiguration);
  const transition=prepareN8nTransition({configuration:n8nConfiguration,backupBytes});
  const migration=prepareBuyerMigrationPackage({releaseSha,providerManifest});
  const files={
   'n8n-configuration.json':json(n8nConfiguration),
   'n8n-manifest.json':workflow.manifestBytes,
   'workflow.json':workflow.payload,
   'n8n-update.json':json(transition.payload),
   'n8n-rollback.json':json({method:'POST',pathname:`/api/v1/workflows/${WORKFLOW_ID}/deactivate`,body:{},
    prerequisite:'exact active candidate identity verified by executeN8nTransition',restoresLegacy:false}),
   'migration-input.json':json({releaseSha,providerManifest}),
   'migration-manifest.json':migration.manifestBytes,
   'application.sql':migration.sql,
   'application-body.sql':migration.body,
  };
  if(Object.values(files).some(bytes=>typeof bytes!=='string'||Buffer.byteLength(bytes)>2*1024*1024))reject();
  const manifest={version:1,kind:'zola-offline-release-bundle',releaseSha,status:'OFFLINE_PREPARED',
   backupSha256:transition.backupSha256,workflowNamespace:transition.namespace,
   sourceSha256:digest(fs.readFileSync(new URL('./offline-bundle.js',import.meta.url))),
   files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,digest(bytes)])),
   productionAccepted:false,liveApplied:false,
   pending:['fresh live backup and revision verification','provider ACL verification','credential execution',
    'writer and rollback acceptance','connected six reads','global release orchestration'],
  };
  const manifestBytes=json(manifest);
  const bundle=Object.freeze({releaseSha,files:Object.freeze({...files,'manifest.json':manifestBytes}),manifestSha256:digest(manifestBytes)});
  preparedBundles.add(bundle);return bundle;
 }catch{reject();}
}

function syncDirectory(root){const fd=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function rejectExtendedAcl(filename){
 const result=spawnSync('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--',filename],{
  encoding:'utf8',timeout:1000,maxBuffer:4096,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},
 });
 if(result.status!==0||result.error||result.stdout!==''||result.stderr!=='')reject();
}

// Safe rerun means exact byte verification, never overwrite or repair. Partial
// output stays available for investigation, and cannot pass as a complete bundle.
export function writeOfflineReleaseBundle(root,bundle){
 try{
  if(process.getuid?.()!==0||!preparedBundles.has(bundle)||!path.isAbsolute(root)||path.resolve(root)!==root||root==='/')reject();
  for(let p=path.dirname(root);;p=path.dirname(p)){
   const stat=fs.lstatSync(p);
   if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022))reject();
   rejectExtendedAcl(p);
   if(p==='/')break;
  }
  let exists=false;
  try{fs.mkdirSync(root,{mode:0o700});syncDirectory(path.dirname(root));}catch(error){if(error.code!=='EEXIST')throw error;exists=true;}
  const stat=fs.lstatSync(root);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o7777)!==0o700)reject();
  rejectExtendedAcl(root);
  if(exists){
   if(JSON.stringify(fs.readdirSync(root).sort())!==JSON.stringify(Object.keys(bundle.files).sort()))reject();
   for(const [name,bytes] of Object.entries(bundle.files))if(readReleaseProtectedBytes(path.join(root,name),2*1024*1024)!==bytes)reject();
  }else{
   // Object insertion order deliberately puts the complete manifest last.
   for(const [name,bytes] of Object.entries(bundle.files)){
    const fd=fs.openSync(path.join(root,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    syncDirectory(root);
    if(readReleaseProtectedBytes(path.join(root,name),2*1024*1024)!==bytes)reject();
   }
  }
  return{status:exists?'OFFLINE_BUNDLE_REVERIFIED':'OFFLINE_BUNDLE_WRITTEN',releaseSha:bundle.releaseSha,
   manifestSha256:bundle.manifestSha256,files:Object.keys(bundle.files).length,productionAccepted:false,liveApplied:false};
 }catch{reject();}
}
