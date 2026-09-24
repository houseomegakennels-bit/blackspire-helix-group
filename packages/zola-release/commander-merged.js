import {execFileSync} from 'node:child_process';

const repository='houseomegakennels-bit/blackspire-helix-group';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const reject=()=>{throw new Error('Merged release identity rejected');};

// The caller must durably retain this premerge CI proof before requesting a
// merge, and retain the returned merge SHA before calling this GET-only gate.
// This verifies identity, not production readiness or permission to merge.
export function verifyMergedRelease({releaseSha,previousMainSha,ciMergeSha,ciTreeSha,newMainSha},{run=execFileSync}={}){
 try{
  if(![releaseSha,previousMainSha,ciMergeSha,ciTreeSha,newMainSha].every(sha)
   ||new Set([releaseSha,previousMainSha,newMainSha]).size!==3)reject();
  const options={encoding:'utf8',timeout:15000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],
   env:{PATH:'/usr/bin:/bin',HOME:'/root',GH_CONFIG_DIR:'/root/.config/gh',GH_PROMPT_DISABLED:'1',LC_ALL:'C'}};
  const api=route=>JSON.parse(run('/usr/bin/gh',['api',`repos/${repository}/${route}`],options));
  const commit=(value,expected)=>{
   if(value.sha!==expected||value.tree?.sha!==ciTreeSha||!Array.isArray(value.parents)||value.parents.length!==2
    ||value.parents[0].sha!==previousMainSha||value.parents[1].sha!==releaseSha)reject();
   return{sha:value.sha,tree:value.tree.sha,parents:value.parents.map(parent=>parent.sha)};
  };
  const observe=()=>{
   const pr=api('pulls/125'),main=api('git/ref/heads/main');
   if(pr.number!==125||pr.state!=='closed'||pr.merged!==true||pr.draft!==false
    ||pr.head?.sha!==releaseSha||pr.head?.ref!=='release/zola-production-live'||pr.head?.repo?.full_name!==repository
    ||pr.base?.ref!=='main'||pr.base?.repo?.full_name!==repository||pr.merge_commit_sha!==newMainSha
    ||main.ref!=='refs/heads/main'||main.object?.type!=='commit'||main.object.sha!==newMainSha)reject();
   return JSON.stringify({releaseSha,newMainSha,tested:commit(api(`git/commits/${ciMergeSha}`),ciMergeSha),
    merged:commit(api(`git/commits/${newMainSha}`),newMainSha)});
  };
  if(observe()!==observe())reject();
  return{status:'MERGED_IDENTITY_VERIFIED',releaseSha,previousMainSha,newMainSha,ciMergeSha,ciTreeSha,productionAccepted:false};
 }catch{reject();}
}
