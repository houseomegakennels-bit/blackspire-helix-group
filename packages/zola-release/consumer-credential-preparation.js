import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';

export const CONSUMER_CREDENTIAL_PATHS=Object.freeze({
 auth:'/root/.local/share/com.vercel.cli/auth.json',
 consumer:'/var/lib/blackspire-operator/authority-consumer-token',
 vercel:'/var/lib/blackspire-operator/vercel-token',
 root:'/var/lib/blackspire-operator/preparation/consumer-credential',
});
export const CONSUMER_CREDENTIAL_TARGETS=Object.freeze({
 repository:'houseomegakennels-bit/blackspire-helix-group',secret:'ZOLA_AUTHORITY_CONSUMER_TOKEN',
 project:'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou',team:'team_CaRyRaulJaFnCLSfTdyRYNIW',
 key:'BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN',preview:'IBncje9VEZEifTRa',production:'0ppIgcXMvFAQ6Wy3',
 branch:'release/zola-production-live',
});
const P=CONSUMER_CREDENTIAL_PATHS,T=CONSUMER_CREDENTIAL_TARGETS,steps=['github','preview','production'];
const fail=()=>{throw new Error('Consumer credential preparation stopped; retained state requires reconciliation');};
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const opaque=v=>typeof v==='string'&&/^[A-Za-z0-9._~-]{20,4096}$/.test(v);
const timestamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const statSame=(a,b)=>['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
function parents(name,io){
 for(let current=path.dirname(name);;current=path.dirname(current)){
  const s=io.lstatSync(current);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0)fail();if(current==='/')break;
 }
}
function exists(io,name){try{io.lstatSync(name);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function acl(run,args,stdio=['ignore','pipe','pipe']){
 const r=run('/usr/bin/getfacl',args,{encoding:'utf8',stdio,timeout:1000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
 if(r.status!==0||r.error||r.signal||r.stdout!==''||r.stderr!=='')fail();
}
function syncParent(io,name){const fd=io.openSync(path.dirname(name),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}}
export function createConsumerCredentialStore({io=fs,run=spawnSync}={}){
 const allowed=name=>name===P.auth||name===P.consumer||name===P.vercel||name===P.consumer+'.stage'||name===P.vercel+'.stage'||name.startsWith(P.root+'/')&&path.dirname(name)===P.root;
 const read=name=>{
  if(!allowed(name)||path.resolve(name)!==name)fail();parents(name,io);let fd,bytes;
  try{
   fd=io.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   const before=io.fstatSync(fd);
   if(!before.isFile()||before.uid!==0||before.gid!==0||before.nlink!==1||(before.mode&0o7777)!==0o600||before.size<1||before.size>65536)fail();
   acl(run,['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],['ignore','pipe','pipe',fd]);
   bytes=Buffer.alloc(before.size+1);let used=0;while(used<bytes.length){const n=io.readSync(fd,bytes,used,bytes.length-used,null);if(n===0)break;used+=n;}
   if(used!==before.size||!statSame(before,io.fstatSync(fd))||!statSame(before,io.lstatSync(name)))fail();
   return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,used));
  }finally{bytes?.fill(0);if(fd!==undefined)io.closeSync(fd);}
 };
 const publish=(name,bytes)=>{
  if(!allowed(name)||name===P.auth||typeof bytes!=='string'||Buffer.byteLength(bytes)>65536)fail();
  const stage=name+'.stage';parents(name,io);
  acl(run,['--numeric','--omit-header','--skip-base','--default','--logical','--',path.dirname(name)]);
  const readStage=()=>read(stage);
  if(exists(io,name)){if(exists(io,stage)||read(name)!==bytes)fail();return;}
  if(exists(io,stage)){if(readStage()!==bytes)fail();}
  else{
   let fd;try{
    fd=io.openSync(stage,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    io.fchownSync(fd,0,0);io.fchmodSync(fd,0o600);
    acl(run,['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],['ignore','pipe','pipe',fd]);
    const buffer=Buffer.from(bytes);let offset=0;
    try{while(offset<buffer.length){const n=io.writeSync(fd,buffer,offset,buffer.length-offset);if(n<1)fail();offset+=n;}io.fsyncSync(fd);}finally{buffer.fill(0);}
   }finally{if(fd!==undefined)io.closeSync(fd);}
   if(readStage()!==bytes)fail();
  }
  if(exists(io,name))fail();io.renameSync(stage,name);syncParent(io,name);if(read(name)!==bytes)fail();
 };
 return Object.freeze({read,publish,exists:name=>{if(!allowed(name))fail();return exists(io,name);},
  acquire(){
   parents(P.root,io);
   if(!exists(io,P.root)){io.mkdirSync(P.root,{mode:0o700});syncParent(io,P.root);}
   const s=io.lstatSync(P.root);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o7777)!==0o700)fail();
   acl(run,['--numeric','--omit-header','--skip-base','--default','--logical','--',P.root]);
   const filename=P.root+'/lock',fd=io.openSync(filename,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK,0o600);
   try{
    const before=io.fstatSync(fd);if(!before.isFile()||before.uid!==0||before.gid!==0||before.nlink!==1||(before.mode&0o7777)!==0o600)fail();
    acl(run,['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],['ignore','pipe','pipe',fd]);
    const r=run('/usr/bin/flock',['--exclusive','--nonblock','3'],{encoding:'utf8',stdio:['ignore','pipe','pipe',fd],timeout:1000,env:{PATH:'/usr/bin:/bin'}});
    if(r.status!==0||r.error||r.signal||r.stdout!==''||r.stderr!==''||!statSame(before,io.lstatSync(filename)))fail();
    return {assertCurrent(){if(!statSame(before,io.fstatSync(fd))||!statSame(before,io.lstatSync(filename)))fail();},close:()=>io.closeSync(fd)};
   }catch{io.closeSync(fd);fail();}
  },
 });
}
function metadata(value){
 const {repository,secret,project,envs}=value??{};
 if(repository?.full_name!==T.repository||!Number.isSafeInteger(repository.id)||repository.id<1
  ||repository.owner?.login!=='houseomegakennels-bit'||repository.archived!==false||repository.disabled!==false
  ||secret?.name!==T.secret||!timestamp(secret.created_at)||!timestamp(secret.updated_at)
  ||project?.id!==T.project||project.accountId!==T.team||!Array.isArray(envs))fail();
 const selected=envs.filter(v=>v.key===T.key);if(selected.length!==2)fail();
 const rows={};
 for(const step of ['preview','production']){
  const row=selected.find(v=>v.id===T[step]);
  if(!row||row.type!=='sensitive'||!same(row.target,[step])||(row.gitBranch??null)!==(step==='preview'?T.branch:null)
    ||row.customEnvironmentIds!==undefined&&!same(row.customEnvironmentIds,[])
    ||!Number.isSafeInteger(row.createdAt)||!Number.isSafeInteger(row.updatedAt))fail();
  rows[step]={id:row.id,type:row.type,target:row.target,gitBranch:row.gitBranch??null,createdAt:row.createdAt,updatedAt:row.updatedAt};
 }
 return{repositoryId:repository.id,projectId:T.project,teamId:T.team,
  github:{name:T.secret,createdAt:secret.created_at,updatedAt:secret.updated_at},...rows};
}
function identities(value){return {...value,github:{...value.github,updatedAt:null},preview:{...value.preview,updatedAt:null},production:{...value.production,updatedAt:null}};}
export function createConsumerCredentialTransport({run=spawnSync,fetchImpl=fetch}={}){
 const env={PATH:'/usr/bin:/bin',HOME:'/root',GH_CONFIG_DIR:'/root/.config/gh',GH_PROMPT_DISABLED:'1',GH_HOST:'github.com',LC_ALL:'C'};
 const gh=(args,input)=>{
  const r=run('/usr/bin/gh',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000,maxBuffer:1024*1024,env});
  if(r.status!==0||r.error||r.signal)fail();return r.stdout;
 };
 const vercel=async(token,route,method='GET',value)=>{
  if(!opaque(token)||!route.startsWith(`/v9/projects/${T.project}`))fail();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await fetchImpl(`https://api.vercel.com${route}${route.includes('?')?'&':'?'}teamId=${T.team}`,{
    method,redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${token}`,accept:'application/json',...(value===undefined?{}:{'content-type':'application/json'})},
    ...(value===undefined?{}:{body:JSON.stringify({value})})});
   if(response.status!==200)fail();
   const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>1024*1024)fail();chunks.push(Buffer.from(chunk));}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch{fail();}finally{clearTimeout(timer);}
 };
 return Object.freeze({
  async observe(token){
   const repository=JSON.parse(gh(['api',`repos/${T.repository}`])),secret=JSON.parse(gh(['api',`repos/${T.repository}/actions/secrets/${T.secret}`]));
   const project=await vercel(token,`/v9/projects/${T.project}`),listed=await vercel(token,`/v9/projects/${T.project}/env`);
   return metadata({repository,secret,project,envs:listed.envs});
  },
  async apply(step,value,token){
   if(!steps.includes(step)||typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))fail();
   if(step==='github'){gh(['secret','set',T.secret,'--repo',T.repository,'--app','actions'],value);return;}
   const result=await vercel(token,`/v9/projects/${T.project}/env/${T[step]}`,'PATCH',value);
   if(result.id!==T[step]||result.key!==T.key||result.type!=='sensitive'
    ||Object.hasOwn(result,'target')&&!same(result.target,[step])
    ||Object.hasOwn(result,'gitBranch')&&(result.gitBranch??null)!==(step==='preview'?T.branch:null))fail();
  },
 });
}
export async function prepareConsumerCredential({sourceSha},{store=createConsumerCredentialStore(),transport=createConsumerCredentialTransport(),
 readAuth=()=>readRootOwnedJsonSnapshot(P.auth,{groupId:0,maxBytes:16384}),generate=()=>randomBytes(32).toString('base64url'),getuid=process.getuid}={}){
 let lease;
 try{
  if(getuid?.()!==0||!/^[a-f0-9]{40}$/.test(sourceSha??''))fail();lease=store.acquire();lease.assertCurrent();
  const auth=readAuth();if(auth.identity.uid!==0||auth.identity.gid!==0||(auth.identity.mode&0o7777)!==0o600||!opaque(auth.value?.token))fail();
  const token=auth.value.token,authDigest=hash(auth),planPath=P.root+'/plan.json';
  let plan;
  if(store.exists(planPath))plan=JSON.parse(store.read(planPath));
  else if(store.exists(planPath+'.stage'))plan=JSON.parse(store.read(planPath+'.stage'));
  else{
   const priorFiles=[P.consumer,P.vercel,...steps.flatMap(step=>[P.root+'/'+step+'.intent.json',P.root+'/'+step+'.result.json'])];
   if(priorFiles.some(file=>store.exists(file)||store.exists(file+'.stage')))fail();
   const baseline=await transport.observe(token),consumer=generate();
   if(!/^[A-Za-z0-9_-]{43}$/.test(consumer)||Buffer.from(consumer,'base64url').length!==32||Buffer.from(consumer,'base64url').toString('base64url')!==consumer||consumer===token)fail();
   plan={schema:1,kind:'zola-consumer-credential-plan',sourceSha,authDigest,consumer,baseline};
  }
  if(!exact(plan,['schema','kind','sourceSha','authDigest','consumer','baseline'])||plan.schema!==1
   ||plan.kind!=='zola-consumer-credential-plan'||plan.sourceSha!==sourceSha||plan.authDigest!==authDigest
   ||typeof plan.consumer!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(plan.consumer)||Buffer.from(plan.consumer,'base64url').length!==32||Buffer.from(plan.consumer,'base64url').toString('base64url')!==plan.consumer||plan.consumer===token)fail();
  const planDigest=hash(plan);
  store.publish(planPath,JSON.stringify(plan)+'\n');
  if(!same(readAuth(),auth))fail();
  store.publish(P.consumer,plan.consumer+'\n');store.publish(P.vercel,token+'\n');
  const retained=()=>{
   lease.assertCurrent();
   if(!same(readAuth(),auth)||store.read(P.consumer)!==plan.consumer+'\n'||store.read(P.vercel)!==token+'\n'
    ||store.read(planPath)!==JSON.stringify(plan)+'\n')fail();
  };
  const confirmed={};
  for(const step of steps){
   retained();const before=await transport.observe(token);
   if(!same(identities(before),identities(plan.baseline)))fail();
   for(const done of Object.keys(confirmed))if(!same(before[done],confirmed[done]))fail();
   const intentPath=P.root+'/'+step+'.intent.json',resultPath=P.root+'/'+step+'.result.json';
   const intent={schema:1,kind:'consumer-credential-write-intent',planDigest,step};
   store.publish(intentPath,JSON.stringify(intent)+'\n');
   if(store.exists(resultPath)||store.exists(resultPath+'.stage')){
    const result=JSON.parse(store.read(store.exists(resultPath)?resultPath:resultPath+'.stage'));
    if(!exact(result,['schema','kind','planDigest','step','acknowledged','metadata'])||result.schema!==1
     ||result.kind!=='consumer-credential-write-result'||result.planDigest!==planDigest||result.step!==step||result.acknowledged!==true
     ||!same(result.metadata,before[step]))fail();
    store.publish(resultPath,JSON.stringify(result)+'\n');confirmed[step]=result.metadata;continue;
   }
   retained();await transport.apply(step,plan.consumer,token);
   retained();const after=await transport.observe(token);
   if(!same(identities(after),identities(plan.baseline)))fail();
   for(const done of Object.keys(confirmed))if(!same(after[done],confirmed[done]))fail();
   const result={schema:1,kind:'consumer-credential-write-result',planDigest,step,acknowledged:true,metadata:after[step]};
   store.publish(resultPath,JSON.stringify(result)+'\n');confirmed[step]=after[step];
  }
  retained();const final=await transport.observe(token);
  if(!same(identities(final),identities(plan.baseline))||steps.some(step=>!same(final[step],confirmed[step])))fail();
  return Object.freeze({status:'CONSUMER_CREDENTIAL_CONFIGURATION_SYNCHRONIZED',sourceSha,
   destinationsAcknowledged:3,deploymentAccepted:false,consumedPermitVerified:false});
 }catch{fail();}finally{lease?.close();}
}
