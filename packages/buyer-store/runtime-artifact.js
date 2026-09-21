import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile),worker=fileURLToPath(new URL('./runtime-artifact-worker.js',import.meta.url));
export async function inspectRuntimeBuyerStoreArtifact({artifactRoot,releaseSha,environment,run=execute}){
 try{
  if(!/^[a-f0-9]{40}$/.test(releaseSha??'')||artifactRoot!=='/opt/blackspire-command/releases/'+releaseSha||environment!=='production')throw new Error();
  const result=await run('/opt/nodejs/node-v22.23.1-linux-x64/bin/node',['--max-old-space-size=128',worker,artifactRoot,releaseSha,environment],{encoding:'utf8',timeout:10000,maxBuffer:4096,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  if(typeof result?.stdout!=='string'||result.stdout.length>4096||result.stderr!=='')throw new Error();
  const value=JSON.parse(result.stdout);
  if(!value||Object.keys(value).sort().join(',')!=='artifactDigest,environment,releaseSha'||value.releaseSha!==releaseSha||value.environment!==environment||!/^[a-f0-9]{64}$/.test(value.artifactDigest??''))throw new Error();
  return Object.freeze(value);
 }catch{throw new Error('Buyer store runtime artifact observation unavailable');}
}
