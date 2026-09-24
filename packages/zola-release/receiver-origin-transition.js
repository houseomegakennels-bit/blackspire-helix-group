import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {readReleaseProtectedBytes} from './commander-host.js';
import {observeVercelProduction} from './commander-deployment.js';
const TEAM='team_CaRyRaulJaFnCLSfTdyRYNIW',PROJECT='prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou';
const metadata='/var/lib/blackspire-operator/preparation/receiver-origin.json';
const defaults={environment:'/etc/blackspire/receiver-origin.env',dropin:'/etc/systemd/system/blackspire-command-worker.service.d/45-zola-receiver-origin.conf'};
const divisions=['SELLER','BUYER','DEAL','NEXUS'];
const reject=()=>{throw new Error('Receiver origin transition rejected; retain journal and stopped state');};
const exact=(v,k)=>v&&Object.keys(v).sort().join(',')===[...k].sort().join(',');
const sha=v=>/^[a-f0-9]{40}$/.test(v??'');
const origin=v=>{try{const u=new URL(v);return u.protocol==='https:'&&u.origin===v&&!u.username&&!u.password&&(u.hostname==='blackspirehelix.com'||/^[a-z0-9-]+\.vercel\.app$/.test(u.hostname));}catch{return false;}};
const envBytes=value=>Buffer.from(divisions.map(d=>`BLACKSPIRE_${d}_CAPABILITY_URL=${value}\n`).join(''));
export function validateReceiverOriginPlan(p){
 if(!exact(p,['schema','mode','releaseSha','origin','deploymentId','previousOrigin','previousDropin'])||p.schema!==1||!['preview','production'].includes(p.mode)||!sha(p.releaseSha)||!origin(p.origin)
  ||!/^dpl_[A-Za-z0-9]+$/.test(p.deploymentId??'')||!(p.previousOrigin===null||origin(p.previousOrigin))||typeof p.previousDropin!=='boolean'||p.previousDropin!==(p.previousOrigin!==null)
  ||p.mode==='production'&&p.origin!=='https://blackspirehelix.com'||p.mode==='preview'&&!p.origin.endsWith('.vercel.app'))reject();return structuredClone(p);
}
export async function observeReceiverDeployment({releaseSha,mode,origin:frontendOrigin,deploymentId},{fetchImpl=fetch,token=()=>readReleaseProtectedBytes('/var/lib/blackspire-operator/vercel-token',16384).trim()}={}){
 try{
  if(!sha(releaseSha)||!['preview','production'].includes(mode)||!origin(frontendOrigin)||!/^dpl_[A-Za-z0-9]+$/.test(deploymentId??'')
   ||mode==='production'&&frontendOrigin!=='https://blackspirehelix.com'||mode==='preview'&&!frontendOrigin.endsWith('.vercel.app'))reject();
  const credential=token();if(typeof credential!=='string'||credential.length<16)reject();
  const read=async selector=>{const response=await fetchImpl(`https://api.vercel.com/v13/deployments/${selector}?teamId=${TEAM}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${credential}`}});
   if(!response.ok||response.redirected||!response.body)reject();let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.byteLength;if(size>1024*1024)reject();chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));};
  const verify=v=>{const sources=[v.meta?.githubCommitSha,v.gitSource?.sha,v.meta?.zolaSourceSha].filter(Boolean);
   if(v.id!==deploymentId||v.projectId!==PROJECT||v.readyState!=='READY'||!sources.length||sources.some(s=>s!==releaseSha)||v.target!==(mode==='production'?'production':null)
    ||v.meta?.githubCommitRef&&v.meta.githubCommitRef!==(mode==='production'?'main':'release/zola-production-live')||typeof v.url!=='string'||mode==='preview'&&frontendOrigin!=='https://'+v.url)reject();};
  verify(await read(deploymentId));verify(await read(mode==='production'?'blackspirehelix.com':new URL(frontendOrigin).hostname));
  return{releaseSha,mode,origin:frontendOrigin,deploymentId};
 }catch{reject();}
}
export function createReceiverOriginTransition({assertStopped,paths=defaults,groupId,
 readMetadata=()=>readRootOwnedJson(metadata,{groupId:0,maxBytes:2048}),verifyDeployment=observeReceiverDeployment,resolveProduction=releaseSha=>observeVercelProduction({newMainSha:releaseSha,token:readReleaseProtectedBytes('/var/lib/blackspire-operator/vercel-token',16384).trim()}),io=fs,aclTool=spawnSync}={}){
 if(typeof assertStopped!=='function')reject();
 const dropin=Buffer.from('[Service]\nEnvironmentFile='+paths.environment+'\n');
 const gid=()=>groupId??Number(execFileSync('/usr/bin/getent',['group','blackspire'],{encoding:'utf8',timeout:1000,maxBuffer:4096,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}}).trim().split(':')[2]);
 function acl(fd){const r=aclTool('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{encoding:'utf8',stdio:['ignore','pipe','pipe',fd],timeout:1000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});if(r.status!==0||r.error||r.stdout!==''||r.stderr!=='')reject();}
 function directory(name){for(let p=name;;p=path.dirname(p)){const s=io.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))reject();const fd=io.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{acl(fd);}finally{io.closeSync(fd);}if(p==='/')break;}}
 function read(file,mode,expectedGid){directory(path.dirname(file));let fd;try{fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const a=io.fstatSync(fd);if(!a.isFile()||a.uid!==0||a.gid!==expectedGid||a.nlink!==1||(a.mode&0o7777)!==mode||a.size<1||a.size>4096)reject();acl(fd);const bytes=io.readFileSync(fd),b=io.fstatSync(fd);if(bytes.length!==a.size||['dev','ino','mtimeMs','ctimeMs','mode','gid','uid','size','nlink'].some(k=>a[k]!==b[k]))reject();return bytes;}catch(e){if(e.code==='ENOENT')return null;throw e;}finally{if(fd!==undefined)io.closeSync(fd);}}
 function snapshot(){let oldDropin;try{oldDropin=read(paths.dropin,0o644,0);}catch(e){if(e.code==='ENOENT')oldDropin=null;else throw e;}
  const oldEnv=read(paths.environment,0o640,gid());if(Boolean(oldDropin)!==Boolean(oldEnv)||oldDropin&&!oldDropin.equals(dropin))reject();
  let previousOrigin=null;if(oldEnv){const lines=oldEnv.toString('utf8').split('\n');previousOrigin=lines[0].split('=').slice(1).join('=');if(!origin(previousOrigin)||!oldEnv.equals(envBytes(previousOrigin)))reject();}
  return{previousOrigin,previousDropin:Boolean(oldDropin)};}
 function sync(dir){const fd=io.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}}
 function write(file,bytes,mode,ownerGroup){directory(path.dirname(file));const temporary=file+'.pending-'+randomUUID();let fd;
  try{fd=io.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);io.fchownSync(fd,0,ownerGroup);io.fchmodSync(fd,mode);acl(fd);io.writeFileSync(fd,bytes);io.fsyncSync(fd);io.closeSync(fd);fd=undefined;io.renameSync(temporary,file);sync(path.dirname(file));}finally{if(fd!==undefined)io.closeSync(fd);}}
 const matches=(p,restored=false)=>{try{const found=snapshot();return found.previousOrigin===(restored?p.previousOrigin:p.origin)&&found.previousDropin===(restored?p.previousDropin:true);}catch{return false;}};
 return {
  async prepare({releaseSha,mode,candidateSha}){await assertStopped();let target;
   if(mode==='preview'){const m=readMetadata();if(!exact(m,['schema','releaseSha','frontendOrigin','deploymentId'])||m.schema!==1||m.releaseSha!==releaseSha)reject();target={releaseSha,mode,origin:m.frontendOrigin,deploymentId:m.deploymentId};}
   else if(mode==='production'){const m=readMetadata();if(!exact(m,['schema','releaseSha','frontendOrigin','deploymentId'])||m.schema!==1||m.releaseSha!==candidateSha||snapshot().previousOrigin!==m.frontendOrigin)reject();const proof=await resolveProduction(releaseSha);if(proof.status!=='VERCEL_PRODUCTION_EXACT'||proof.newMainSha!==releaseSha)reject();target={releaseSha,mode,origin:'https://blackspirehelix.com',deploymentId:proof.deploymentId};}else reject();
   await verifyDeployment(target);await assertStopped();return validateReceiverOriginPlan({schema:1,...target,...snapshot()});},
  async publish(input){const p=validateReceiverOriginPlan(input);await assertStopped();await verifyDeployment(p);if(!matches(p,true))reject();
   const parent=path.dirname(paths.dropin);try{directory(parent);}catch(e){if(e.code!=='ENOENT')throw e;directory(path.dirname(parent));io.mkdirSync(parent,{mode:0o755});sync(path.dirname(parent));}
   write(paths.environment,envBytes(p.origin),0o640,gid());write(paths.dropin,dropin,0o644,0);await assertStopped();if(!matches(p))reject();},
  observe(input){return matches(validateReceiverOriginPlan(input));},
  async restore(input){const p=validateReceiverOriginPlan(input);await assertStopped();
   // Partial publication is recoverable only from individually exact old/new bytes.
   const e=read(paths.environment,0o640,gid());let d;try{d=read(paths.dropin,0o644,0);}catch(error){if(error.code!=='ENOENT')throw error;d=null;}
   if(e!==null&&!e.equals(envBytes(p.origin))&&!(p.previousOrigin!==null&&e.equals(envBytes(p.previousOrigin)))||d!==null&&!d.equals(dropin))reject();
   if(p.previousOrigin===null){if(e!==null){io.unlinkSync(paths.environment);sync(path.dirname(paths.environment));}if(d!==null){io.unlinkSync(paths.dropin);sync(path.dirname(paths.dropin));}}
   else{write(paths.environment,envBytes(p.previousOrigin),0o640,gid());write(paths.dropin,dropin,0o644,0);}return matches(p,true);},
  restored(input){return matches(validateReceiverOriginPlan(input),true);},
 };
}
