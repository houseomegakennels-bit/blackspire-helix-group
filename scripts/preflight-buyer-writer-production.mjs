#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {runBuyerWriterProductionPreflight} from './lib/buyer-writer-production-preflight.mjs';

const stopped=()=>{throw new Error('Buyer writer production preflight stopped');};

function readDescriptor(filename){
 let fd;
 try{
  if(!path.isAbsolute(filename)||path.resolve(filename)!==filename||filename==='/')stopped();
  fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC);
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size<2||stat.size>8192)stopped();
  const bytes=Buffer.alloc(stat.size);
  if(fs.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)stopped();
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }catch{stopped();}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}

function writeEvidence(filename,value){
 let fd;
 try{
  if(!path.isAbsolute(filename)||path.resolve(filename)!==filename||filename==='/')stopped();
  const bytes=Buffer.from(`${JSON.stringify(value,null,2)}\n`);
  fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL
   |fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
  if(fs.writeSync(fd,bytes,0,bytes.length,0)!==bytes.length)stopped();
  fs.fsyncSync(fd);
 }catch{stopped();}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}

try{
 const args=process.argv.slice(2);
 if((args.length!==8&&args.length!==10)||args[0]!=='--mode'||args[2]!=='--target'
  ||args[4]!=='--impact-manifest'||args[6]!=='--management-config'
  ||(args.length===10&&args[8]!=='--output'))stopped();
 const managementConfigPath=args[7];
 if(!path.isAbsolute(managementConfigPath)||path.resolve(managementConfigPath)!==managementConfigPath
  ||managementConfigPath==='/')stopped();
 const report=await runBuyerWriterProductionPreflight({
  mode:args[1],target:readDescriptor(args[3]),impactManifest:readDescriptor(args[5]),managementConfigPath,
 });
 if(args.length===10)writeEvidence(args[9],report);
 process.stdout.write(`${JSON.stringify(report)}\n`);
}catch{
 process.stderr.write('Buyer writer production preflight stopped; no connection was attempted and no protected input was disclosed\n');
 process.exitCode=1;
}
