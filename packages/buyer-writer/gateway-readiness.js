import fs from 'node:fs';
import {BUYER_WRITER_DEFAULT_SOCKET} from './local-gateway-protocol.js';

export async function waitForBuyerWriterGateway({socketPath=BUYER_WRITER_DEFAULT_SOCKET,timeoutMs=15_000,io=fs,
  uid=process.getuid?.(),gid=process.getgid?.(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const deadline=performance.now()+timeoutMs;
  do{
    try{const stat=io.lstatSync(socketPath);if(stat.isSocket()&&!stat.isSymbolicLink()&&stat.uid===uid&&stat.gid===gid&&(stat.mode&0o777)===0o660)return true;}catch{}
    await pause(50);
  }while(performance.now()<deadline);
  throw new Error('Buyer writer gateway readiness unavailable');
}

if(import.meta.url===`file://${process.argv[1]}`){
  if(process.argv.length!==2)throw new Error('Buyer writer gateway readiness rejected');
  await waitForBuyerWriterGateway();
}
