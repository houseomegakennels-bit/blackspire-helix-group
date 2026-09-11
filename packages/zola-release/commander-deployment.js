import {execFileSync} from 'node:child_process';
import {verifyMergedRelease} from './commander-merged.js';

const REPOSITORY='houseomegakennels-bit/blackspire-helix-group';
const TEAM='team_CaRyRaulJaFnCLSfTdyRYNIW',PROJECT='prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou',DOMAIN='blackspirehelix.com';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const reject=()=>{throw new Error('Release deployment identity rejected');};
const options={encoding:'utf8',timeout:15000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],
 env:{PATH:'/usr/bin:/bin',HOME:'/root',GH_CONFIG_DIR:'/root/.config/gh',GH_PROMPT_DISABLED:'1',LC_ALL:'C'}};

export function observeExpectedHeadMerge({releaseSha,previousMainSha,ciMergeSha,ciTreeSha},{run=execFileSync}={}){
 try{
  if(![releaseSha,previousMainSha,ciMergeSha,ciTreeSha].every(sha))reject();
  const api=route=>JSON.parse(run('/usr/bin/gh',['api',`repos/${REPOSITORY}/${route}`],options));
  const read=()=>{
   const pr=api('pulls/125'),main=api('git/ref/heads/main');
   if(pr.number!==125||pr.draft!==false||pr.head?.sha!==releaseSha||pr.head?.ref!=='release/zola-production-live'
    ||pr.head?.repo?.full_name!==REPOSITORY||pr.base?.ref!=='main'||pr.base?.repo?.full_name!==REPOSITORY||main.object?.type!=='commit')reject();
   if(pr.state==='open'&&pr.merged===false&&main.object.sha===previousMainSha)return{status:'OPEN_EXACT_HEAD',newMainSha:null};
   if(pr.state==='closed'&&pr.merged===true&&sha(pr.merge_commit_sha)){
    const proof=verifyMergedRelease({releaseSha,previousMainSha,ciMergeSha,ciTreeSha,newMainSha:pr.merge_commit_sha},{run});
    return{status:'MERGED_EXACT_HEAD',newMainSha:proof.newMainSha};
   }
   reject();
  };
  const first=read(),second=read();if(JSON.stringify(first)!==JSON.stringify(second))reject();return Object.freeze(first);
 }catch{reject();}
}

// Called only after the enclosing durable merge intent. A transport success is
// never accepted as merge proof; the caller must use observeExpectedHeadMerge.
export function requestExpectedHeadMerge({releaseSha},{run=execFileSync}={}){
 try{
  if(!sha(releaseSha))reject();
  run('/usr/bin/gh',['api','--method','PUT',`repos/${REPOSITORY}/pulls/125/merge`,'-f',`sha=${releaseSha}`,'-f','merge_method=merge'],
   {...options,stdio:['ignore','ignore','pipe']});
  return{status:'MERGE_REQUEST_SENT',releaseSha,productionAccepted:false};
 }catch{reject();}
}

async function boundedJson(response){
 if(!response?.ok||response.redirected||!response.body)reject();let size=0;const chunks=[];
 for await(const chunk of response.body){size+=chunk.byteLength;if(size>1024*1024)reject();chunks.push(Buffer.from(chunk));}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{reject();}
}
export async function observeVercelProduction({newMainSha,token},{fetchImpl=fetch}={}){
 try{
  if(!sha(newMainSha)||typeof token!=='string'||token.length<16)reject();
  const get=path=>fetchImpl(`https://api.vercel.com${path}${path.includes('?')?'&':'?'}teamId=${TEAM}`,
   {method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`}}).then(boundedJson);
  const read=async()=>{
   const value=await get(`/v13/deployments/${DOMAIN}`),sources=[value.meta?.githubCommitSha,value.gitSource?.sha,value.meta?.zolaSourceSha].filter(Boolean);
   if(value.projectId!==PROJECT||value.target!=='production'||value.readyState!=='READY'||!/^dpl_[A-Za-z0-9]+$/.test(value.id??'')
    ||typeof value.url!=='string'||!sources.length||sources.some(source=>source!==newMainSha)
    ||value.meta?.githubCommitRef&&value.meta.githubCommitRef!=='main')reject();
   return{status:'VERCEL_PRODUCTION_EXACT',newMainSha,deploymentId:value.id,url:value.url};
  };
  const first=await read(),second=await read();if(JSON.stringify(first)!==JSON.stringify(second))reject();return Object.freeze(first);
 }catch{reject();}
}
