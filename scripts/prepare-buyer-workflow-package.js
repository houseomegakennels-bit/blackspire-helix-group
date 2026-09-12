import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readRootOwnedJsonSnapshot} from '../packages/buyer-writer/protected-json.js';
import {prepareBuyerWorkflowPackage} from '../packages/buyer-writer/n8n-package.js';

// Offline only: no HTTP, key discovery, workflow update or activation capability.
try {
  if(process.versions.node!=='22.23.1'||process.getuid?.()!==0||process.argv.length!==4)throw new Error();
  const [configuration,output]=process.argv.slice(2);
  if(!path.isAbsolute(output)||path.resolve(output)!==output||output==='/')throw new Error();
  const input=readRootOwnedJsonSnapshot(configuration,{groupId:0});
  const prepared=prepareBuyerWorkflowPackage(input.value);
  const parent=path.dirname(output);
  for(let p=parent;;p=path.dirname(p)){
    const stat=fs.lstatSync(p);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)throw new Error();
    if(p==='/')break;
  }
  // Exclusive directory creation under trusted ancestors; never overwrite a
  // prior package. A failed write leaves an incomplete package with no manifest.
  fs.mkdirSync(output,{mode:0o700});
  const write=(name,content)=>fs.writeFileSync(path.join(output,name),content,{mode:0o600,flag:fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW});
  if(prepared.payload!==null)write('workflow.json',prepared.payload);
  write('manifest.json',prepared.manifestBytes);
  console.log(JSON.stringify({status:prepared.manifest.status,directory:output,
    manifestSha256:createHash('sha256').update(prepared.manifestBytes).digest('hex'),payloadSha256:prepared.manifest.payloadSha256,
    liveApplied:false,credentialResolution:'UNVERIFIED'}));
}catch{
  console.error('Buyer workflow offline package preparation rejected');process.exitCode=1;
}
