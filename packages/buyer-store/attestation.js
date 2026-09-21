import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {readRootOwnedJsonDigestSnapshot} from '../buyer-writer/protected-json.js';
import {exact,fail} from './local-protocol.js';
export const BUYER_STORE_MANIFEST='/etc/blackspire-buyer-store/installed.json';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createBuyerStoreAttestation(configuration,{read=readRootOwnedJsonDigestSnapshot,io=fs,run=execFileSync,inspect=inspectSealedBuyerWriterArtifact,moduleRoot=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'')}={}){
 const releaseSha=configuration.client.releaseSha,artifactRoot='/opt/blackspire-command/releases/'+releaseSha;
 let verifiedDigest=null;
 const snapshot=()=>{
  const record=read(BUYER_STORE_MANIFEST,{groupId:process.getgid(),maxBytes:16384}),v=record.value;
  if(!exact(v,['version','kind','releaseSha','artifactDigest','configurationDigest','runId','apiGeneration','workerGeneration'])
   ||v.version!==1||v.kind!=='buyer-store-installed'||v.releaseSha!==releaseSha||!/^[a-f0-9]{64}$/.test(v.artifactDigest)
   ||v.configurationDigest!==hash(configuration)||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v.runId)
   ||![v.apiGeneration,v.workerGeneration].every(x=>/^[a-f0-9]{32}$/.test(x))||v.apiGeneration===v.workerGeneration
   ||record.identity.uid!==0||record.identity.gid!==process.getgid()||(record.identity.mode&0o7777)!==0o640)fail();
  return record;
 };
 const verify=async()=>{
  const before=snapshot();
  if(moduleRoot!==artifactRoot||io.realpathSync('/opt/blackspire-command/current')!==artifactRoot)fail();
  if(verifiedDigest!==before.value.artifactDigest){
   const proof=await inspect({artifactRoot,releaseSha,environment:'production'});
   if(proof.artifactDigest!==before.value.artifactDigest)fail();verifiedDigest=proof.artifactDigest;
  }
  const generations=run('/usr/bin/systemctl',['show','--property=InvocationID','--value','blackspire-command.service','blackspire-command-worker.service'],{encoding:'utf8',timeout:1000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}}).trim().split(/\s+/);
  if(generations.length!==2||generations[0]!==before.value.apiGeneration||generations[1]!==before.value.workerGeneration)fail();
  const after=snapshot();if(JSON.stringify(before)!==JSON.stringify(after))fail();
  return before.digest;
 };
 return Object.freeze({binding:()=>structuredClone(snapshot().value),verify,verifyUnchanged:async digest=>{if(await verify()!==digest)fail();}});
}
