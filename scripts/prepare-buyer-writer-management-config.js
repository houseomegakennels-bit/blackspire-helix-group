#!/usr/bin/env node
import fs from 'node:fs';
import tty from 'node:tty';
import {execFileSync,spawnSync} from 'node:child_process';
import {
  BUYER_WRITER_MANAGEMENT_CONFIG,prepareBuyerWriterManagementConfig,
} from '../packages/buyer-writer/management-config-preparation.js';

const fail=()=>{throw new Error('Buyer writer management configuration preparation failed');};
const commandEnvironment=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C'});

function writerGroupId(){
  const value=execFileSync('/usr/bin/getent',['group','blackspire-writer'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],
    timeout:1000,maxBuffer:4096,env:commandEnvironment}).trim().split(':');
  if(value.length!==4||value[0]!=='blackspire-writer'||!/^[1-9][0-9]{0,9}$/.test(value[2]))fail();
  return Number(value[2]);
}

function terminalCommand(fd,args){
  const result=spawnSync('/usr/bin/stty',args,{encoding:'utf8',stdio:[fd,'ignore','pipe'],env:commandEnvironment,
    timeout:1000,maxBuffer:4096,killSignal:'SIGKILL'});
  if(result.status!==0||result.error||result.signal!==null||result.stderr!=='')fail();
}

function hiddenTerminalInput(label){
  let fd,bytes,one,echoDisabled=false;
  const restore=()=>{if(fd!==undefined&&echoDisabled)try{terminalCommand(fd,['echo']);echoDisabled=false;}catch{}};
  const handlers=new Map(['SIGINT','SIGTERM','SIGHUP'].map(signal=>[signal,()=>{
    restore();process.removeListener(signal,handlers.get(signal));process.kill(process.pid,signal);
  }]));
  try{
    fd=fs.openSync('/dev/tty',fs.constants.O_RDWR|fs.constants.O_NOCTTY|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC);
    const stat=fs.fstatSync(fd);if(!stat.isCharacterDevice()||!tty.isatty(fd))fail();
    for(const [signal,handler] of handlers)process.once(signal,handler);
    terminalCommand(fd,['-echo']);echoDisabled=true;fs.writeSync(fd,label);
    bytes=Buffer.alloc(4097);one=Buffer.alloc(1);let used=0;
    while(used<bytes.length){const count=fs.readSync(fd,one,0,1,null);if(count!==1)fail();
      if(one[0]===10||one[0]===13)break;bytes[used++]=one[0];}
    if(used<1||used>4096)fail();
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,used));
  }catch{fail();}finally{
    for(const [signal,handler] of handlers)process.removeListener(signal,handler);
    if(fd!==undefined){restore();try{fs.writeSync(fd,'\n');}catch{}try{fs.closeSync(fd);}catch{}}
    bytes?.fill(0);one?.fill(0);
  }
}

try{
  if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==2
    ||process.stdin.isTTY!==true||process.stdout.isTTY!==true)fail();
  const password=hiddenTerminalInput('Authorized postgres management credential: ');
  const result=prepareBuyerWriterManagementConfig({password,writerGroupId:writerGroupId()});
  process.stdout.write(`${result.status}: ${result.path}\nNext: bash scripts/with-node.sh scripts/provision-buyer-writer-production.js --inspect --management-config ${BUYER_WRITER_MANAGEMENT_CONFIG}\n`);
}catch{
  process.stderr.write('Buyer writer management configuration preparation stopped; no credential material was disclosed\n');
  process.exitCode=1;
}
