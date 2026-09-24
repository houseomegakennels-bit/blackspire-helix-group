
import fs from 'node:fs';
import path from 'node:path';
import {hash} from './commander-journal.js';
import {recoveryDigest} from './admitted-read-recovery.js';
import {MIXED_RETIREMENT as P,validateMixedRetirementEvent} from './mixed-retirement-history.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
export const MIXED_ARCHIVE_ROOT='/var/lib/blackspire-operator/release-retirements/mixed-a8e-20260924/authority-archive';
export const MIXED_ARCHIVE_FILES=Object.freeze({
 claims:'/etc/blackspire/release-admission/premerge-reads.json',
 secret:'/etc/blackspire/release-admission/premerge-reads-secret.json',
 writerCommit:'/etc/blackspire/buyer-writer-binding.json.commit.json',
 writerBinding:'/etc/blackspire/buyer-writer-binding.json',
});
const names=Object.keys(MIXED_ARCHIVE_FILES),fail=()=>{throw Error('MIXED_AUTHORITY_ARCHIVE_REFUSED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(v,keys)=>v&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function createMixedAuthorityArchivePlan(snapshot,before){
 if(!exact(snapshot,'unitConfig,files')||hash(snapshot)!==before.protectedStateDigest
  ||before.retainedEvidenceDigest!==P.retainedEvidenceDigest||before.artifactDigest!==P.artifactDigest
  ||before.bindingRetained!==true||before.authorityInactive!==true)fail();
 const plan={version:1,releaseSha:P.releaseSha,runId:P.runId,successorReleaseSha:P.successorReleaseSha,
  successorOperationId:P.successorOperationId,protectedStateDigest:hash(snapshot),
  retainedEvidenceDigest:P.retainedEvidenceDigest,files:{}};
 for(const name of names){const file=MIXED_ARCHIVE_FILES[name],entry=snapshot.files[file];if(!entry)fail();plan.files[name]={path:file,...entry};}
 return validateMixedAuthorityArchivePlan(plan);
}
export function validateMixedAuthorityArchivePlan(p){
 if(!exact(p,'version,releaseSha,runId,successorReleaseSha,successorOperationId,protectedStateDigest,retainedEvidenceDigest,files')
  ||p.version!==1||['releaseSha','runId','successorReleaseSha','successorOperationId','retainedEvidenceDigest'].some(k=>p[k]!==P[k])
  ||!digest(p.protectedStateDigest)||!exact(p.files,names.join(',')))fail();
 for(const name of names){
  const f=p.files[name],s=f?.identity;
  if(!exact(f,'path,digest,identity')||f.path!==MIXED_ARCHIVE_FILES[name]||!digest(f.digest)
   ||!exact(s,'dev,ino,uid,gid,mode,nlink,size,mtimeMs,ctimeMs')||Object.values(s).some(v=>typeof v!=='number'||!Number.isFinite(v))
   ||s.uid!==0||s.nlink!==1||s.size<1||s.size>2097152||(s.mode&0o170000)!==0o100000
   ||!Number.isInteger(s.gid)||s.gid<0||(s.mode&0o7777)!==(name==='secret'?0o600:0o640))fail();
 }
 return p;
}
export function createMixedAuthorityArchiveFiles({root=MIXED_ARCHIVE_ROOT,paths=MIXED_ARCHIVE_FILES,io=fs,records=createBuyerStoreProtectedFiles()}={}){
 const sync=dir=>{const fd=io.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}};
 const location=(p,name)=>{validateMixedAuthorityArchivePlan(p);if(!names.includes(name))fail();return {file:paths[name],dest:root+'/'+name,f:p.files[name]};};
 const inspect=(file,f,archived=false)=>{
  const st=io.lstatSync(file),bytes=records.read(file,{gid:f.identity.gid,mode:f.identity.mode&0o7777});
  const keys=archived?['dev','ino','uid','gid','mode','nlink','size','mtimeMs']:Object.keys(f.identity);
  if(keys.some(k=>st[k]!==f.identity[k])||recoveryDigest(bytes)!==f.digest)fail();
  return {digest:f.digest,dev:st.dev,ino:st.ino};
 };
 const exists=file=>{try{io.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 const observe=(p,name,{requireAbsent=true}={})=>{const {file,dest,f}=location(p,name);if(requireAbsent&&exists(file))fail();return inspect(dest,f,true);};
 return {
  prepare(p){validateMixedAuthorityArchivePlan(p);records.directory(root,{create:true});
   for(const name of names){const {file,dest,f}=location(p,name);if(exists(dest)||io.lstatSync(root).dev!==f.identity.dev)fail();inspect(file,f);}
  },
  execute(p,name){const {file,dest,f}=location(p,name);records.directory(root);
   if(exists(dest)||io.lstatSync(root).dev!==f.identity.dev)fail();inspect(file,f);if(exists(dest))fail();
   io.renameSync(file,dest);sync(path.dirname(file));sync(root);return observe(p,name);
  },observe,
 };
}
// One durable intent per source. An uncertain rename is observation-only on
// resume; a still-present source cannot authorize automatic redispatch.
export async function archiveMixedAuthority(plan,{host,store,files,uid=process.getuid()}){
 if(uid!==0)fail();validateMixedAuthorityArchivePlan(plan);
 const planDigest=hash(plan),retired=await host.fence();
 validateMixedRetirementEvent(retired);
 if(retired.proof.protectedStateDigest!==plan.protectedStateDigest)fail();
 const fence=async()=>{if(!same(await host.fence(),retired))fail();};
 if(!same(store.read('plan'),plan))fail();
 for(const name of names){
  const intent={version:1,planDigest,name},resultName=name+'-result';
  let old=store.read(name+'-intent'),result=store.read(resultName);
  if(result&&!old||old&&!same(old,intent))fail();
  if(!old){await fence();store.retain(name+'-intent',intent);files.execute(plan,name);}
  const evidence=files.observe(plan,name),expected={version:1,planDigest,name,evidence};
  if(result&&!same(result,expected))fail();
  if(!result){await fence();store.retain(resultName,expected);}
 }
 await fence();
 for(const name of names)files.observe(plan,name);
 const result={version:1,status:'MIXED_AUTHORITY_ARCHIVED',planDigest,retirementDigest:hash(retired),retainedEffects:true};
 const old=store.read('result');if(old&&!same(old,result))fail();if(!old)store.retain('result',result);
 return result;
}
export function verifyMixedAuthorityArchive(plan,{store,files,retired}){
 validateMixedAuthorityArchivePlan(plan);validateMixedRetirementEvent(retired);
 if(retired.proof.protectedStateDigest!==plan.protectedStateDigest||!same(store.read('plan'),plan))fail();
 const planDigest=hash(plan);
 for(const name of names){
  if(!same(store.read(name+'-intent'),{version:1,planDigest,name})
   ||!same(store.read(name+'-result'),{version:1,planDigest,name,evidence:files.observe(plan,name,{requireAbsent:false})}))fail();
 }
 const result={version:1,status:'MIXED_AUTHORITY_ARCHIVED',planDigest,retirementDigest:hash(retired),retainedEffects:true};
 if(!same(store.read('result'),result))fail();return result;
}
