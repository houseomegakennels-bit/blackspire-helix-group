#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {inspectBuyerWriterAdmissionSecretRotation} from '../packages/buyer-writer/admission-secret-rotation.js';
import {readRootOwnedJsonSnapshot} from '../packages/buyer-writer/protected-json.js';

const fail=()=>{throw new Error('Buyer writer admission secret rotation inspection failed');};
const args=process.argv.slice(2);
try{
  if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||args.length!==7
    ||args[0]!=='--inspect'||args[1]!=='--current'||args[2]!=='/etc/blackspire-buyer-writer-gateway/gateway.json'
    ||args[3]!=='--candidate'||!path.isAbsolute(args[4])||path.resolve(args[4])!==args[4]||args[4]==='/'
    ||args[5]!=='--operation')fail();
  const group=execFileSync('/usr/bin/getent',['group','blackspire-writer'],{
    encoding:'utf8',timeout:1000,maxBuffer:4096,stdio:['ignore','pipe','pipe'],
    env:{PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C'}}).trim().split(':');
  if(group.length!==4||group[0]!=='blackspire-writer'||!/^[1-9][0-9]{0,9}$/.test(group[2]))fail();
  const oldSnapshot=readRootOwnedJsonSnapshot(args[2],{groupId:Number(group[2]),maxBytes:65536});
  const candidate=readRootOwnedJsonSnapshot(args[4],{groupId:0,maxBytes:65536});
  if(oldSnapshot.identity.uid!==0||oldSnapshot.identity.gid!==Number(group[2])
    ||(oldSnapshot.identity.mode&0o7777)!==0o640||candidate.identity.uid!==0||candidate.identity.gid!==0
    ||(candidate.identity.mode&0o7777)!==0o600)fail();
  const result=inspectBuyerWriterAdmissionSecretRotation({operationId:args[6],
    oldConfiguration:oldSnapshot.value,newConfiguration:candidate.value});
  process.stdout.write(JSON.stringify(result)+'\n');
}catch{
  process.stderr.write('Buyer writer admission secret rotation inspection stopped; no credential material was disclosed\n');
  process.exitCode=1;
}
