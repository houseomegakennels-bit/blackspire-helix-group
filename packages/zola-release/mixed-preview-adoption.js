
import fs from 'node:fs';
import {recoveryDigest} from './admitted-read-recovery.js';
import {hash} from './commander-journal.js';
import {MIXED_RETIREMENT as P,validateMixedRetirementPrefix,validateMixedRetirementEvent} from './mixed-retirement-history.js';
import {MIXED_RETIREMENT_ROOT,verifyMixedRetirementQuiescence} from './mixed-retirement-host.js';
import {createMixedAuthorityArchiveStore} from './mixed-authority-archive-host.js';
import {createMixedAuthorityArchiveFiles,verifyMixedAuthorityArchive} from './mixed-authority-archive.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {readOwnedConfigurationBytes,publishOwnedConfigurationBytes} from './owned-buyer-configuration-host.js';
import {observeReceiverDeployment} from './receiver-origin-transition.js';
export const MIXED_PREVIEW=Object.freeze({schema:1,releaseSha:P.successorReleaseSha,frontendOrigin:'https://frontend-4rrto278r-houseomegakennels-4825s-projects.vercel.app',deploymentId:'dpl_F91bkRA33kQw1X7RsxigNUg9MdJv'});
const metadata='/var/lib/blackspire-operator/preparation/receiver-origin.json',fail=()=>{throw Error('MIXED_PREVIEW_ADOPTION_REFUSED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function adoptMixedPreview({host,store}){
 const before=await host.fence(),after=JSON.stringify(MIXED_PREVIEW)+'\n';
 let plan=store.read('plan');
 if(!plan){
  const bytes=host.read(),v=JSON.parse(bytes);
  if(!same(v,{schema:1,releaseSha:P.releaseSha,frontendOrigin:P.origin,deploymentId:P.deploymentId}))fail();
  plan={version:1,retirementDigest:before.retirementDigest,archiveDigest:before.archiveDigest,before:bytes,after};store.retain('plan',plan);
 }
 if(!same(Object.keys(plan).sort(),['version','retirementDigest','archiveDigest','before','after'].sort())||plan.version!==1
  ||plan.retirementDigest!==before.retirementDigest||plan.archiveDigest!==before.archiveDigest||plan.after!==after
  ||!same(JSON.parse(plan.before),{schema:1,releaseSha:P.releaseSha,frontendOrigin:P.origin,deploymentId:P.deploymentId}))fail();
 const fence=async()=>{if(!same(await host.fence(),before)||![plan.before,plan.after].includes(host.read()))fail();};
 const intent={version:1,planDigest:hash(plan)},old=store.read('intent');if(old&&!same(old,intent))fail();
 await fence();await host.verify(MIXED_PREVIEW);await fence();
 if(!old){store.retain('intent',intent);host.publish(plan.before,plan.after);}
 // Lost publication acknowledgement is observation-only. Existing intent with
 // unchanged old bytes stops rather than guessing that dispatch was absent.
 if(host.read()!==plan.after)fail();
 await host.verify(MIXED_PREVIEW);await fence();
 const result={version:1,status:'MIXED_PREVIEW_ADOPTED',planDigest:hash(plan),deploymentId:MIXED_PREVIEW.deploymentId,releaseSha:P.successorReleaseSha};
 const retained=store.read('result');if(retained&&!same(retained,result))fail();if(!retained)store.retain('result',result);return result;
}
export function createNativeMixedPreviewAdoption({journal,lease}){
 const files=createBuyerStoreProtectedFiles(),root=MIXED_RETIREMENT_ROOT+'/preview-adoption';files.directory(root,{create:true});
 const record=n=>{if(!['plan','intent','result'].includes(n))fail();return root+'/'+n+'.json';};
 const archiveStore=createMixedAuthorityArchiveStore(),archiveFiles=createMixedAuthorityArchiveFiles();
 const host={
  async fence(){
   lease.assertIdentity();verifyMixedRetirementQuiescence();
   const events=journal.stream('release').events();if(events.length!==P.eventCount+1)fail();
   validateMixedRetirementPrefix(events.slice(0,P.eventCount));const retired=events[P.eventCount];validateMixedRetirementEvent(retired);
   if(!same(files.value(MIXED_RETIREMENT_ROOT+'/retirement.json'),retired))fail();
   const archive=verifyMixedAuthorityArchive(archiveStore.read('plan'),{store:archiveStore,files:archiveFiles,retired});
   const snapshot=archiveStore.read('snapshot');
   for(const name of ['state.json','pending.json','runtime.env']){
    const file='/etc/blackspire/release-admission/'+name,f=snapshot.files[file],st=fs.lstatSync(file);
    if(!f||Object.keys(f.identity).some(k=>st[k]!==f.identity[k])
     ||recoveryDigest(files.read(file,{gid:f.identity.gid,mode:f.identity.mode&0o7777}))!==f.digest)fail();
   }
   for(const n of ['premerge-reads.json','premerge-reads-secret.json','premerge-reads-active.json','acceptance-active.json'])
    if(fs.existsSync('/etc/blackspire/release-admission/'+n))fail();
   for(const n of ['buyer-writer-binding.json','buyer-writer-binding.json.commit.json'])if(fs.existsSync('/etc/blackspire/'+n))fail();
   if(fs.realpathSync('/opt/blackspire-command/current')!=='/opt/blackspire-command/releases/'+P.releaseSha)fail();
   lease.assertIdentity();return {retirementDigest:hash(retired),archiveDigest:hash(archive)};
  },
  read:()=>readOwnedConfigurationBytes(metadata),
  publish:(before,after)=>publishOwnedConfigurationBytes(metadata,before,after),
  verify:p=>observeReceiverDeployment({releaseSha:p.releaseSha,mode:'preview',origin:p.frontendOrigin,deploymentId:p.deploymentId}),
 };
 return {host,store:{read:n=>files.value(record(n),true),retain:(n,v)=>files.record(record(n),v)}};
}
