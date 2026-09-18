#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {validateBuyerWriterProductionPlan} from './lib/buyer-writer-production-preflight.mjs';

const stop=()=>{throw new Error('Buyer writer production preflight stopped');};
function output(filename,value){
 let fd;
 try{
  if(!path.isAbsolute(filename)||path.resolve(filename)!==filename||filename==='/')stop();
  const bytes=Buffer.from(`${JSON.stringify(value,null,2)}\n`);
  fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL
   |fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
  if(fs.writeSync(fd,bytes)!==bytes.length)stop();fs.fsyncSync(fd);
 }catch{stop();}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
try{
 const args=process.argv.slice(2),flags=new Map();
 if(args.length%2!==0)stop();
 for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||flags.has(args[i]))stop();flags.set(args[i],args[i+1]);}
 const required=['--mode','--release-manifest','--catalog-snapshot','--gateway-config','--management-config','--nonce-claim-dir'];
 if(required.some(key=>!flags.has(key))||[...flags.keys()].some(key=>![...required,'--output'].includes(key)))stop();
 const report=validateBuyerWriterProductionPlan({
  mode:flags.get('--mode'),releaseManifestPath:flags.get('--release-manifest'),
  catalogSnapshotPath:flags.get('--catalog-snapshot'),gatewayConfigPath:flags.get('--gateway-config'),
  managementConfigPath:flags.get('--management-config'),nonceClaimDirectory:flags.get('--nonce-claim-dir'),
  now:()=>new Date(),
 });
 if(flags.has('--output'))output(flags.get('--output'),report);
 process.stdout.write(`${JSON.stringify(report)}\n`);
}catch{
 process.stderr.write('Buyer writer production preflight stopped; offline input validation did not establish production readiness\n');
 process.exitCode=1;
}
