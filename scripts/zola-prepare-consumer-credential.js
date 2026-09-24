#!/usr/bin/env node
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareConsumerCredential} from '../packages/zola-release/consumer-credential-preparation.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const fail=()=>{throw new Error('Consumer credential preparation stopped');};
try{
 const [mode,sourceSha,...extra]=process.argv.slice(2);
 if(process.versions.node!=='22.23.1'||process.getuid?.()!==0||process.geteuid?.()!==0
  ||mode!=='--synchronize'||extra.length||!/^[a-f0-9]{40}$/.test(sourceSha??'')
  ||process.cwd()!==fs.realpathSync(root))fail();
 const git=args=>{
  const r=spawnSync('/usr/bin/git',['--no-replace-objects','-C',root,...args],{
   encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:65536,
   env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'}});
  if(r.status!==0||r.error||r.signal||r.stderr!=='')fail();return r.stdout.trim();
 };
 if(git(['rev-parse','HEAD'])!==sourceSha||git(['status','--porcelain','--untracked-files=all'])!==''
  ||git(['remote','get-url','origin'])!=='https://github.com/houseomegakennels-bit/blackspire-helix-group.git')fail();
 const result=await prepareConsumerCredential({sourceSha});
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{
 process.stderr.write('Consumer credential preparation stopped; secret values were not disclosed and retained state must be reconciled\n');
 process.exitCode=1;
}
