import fs from 'node:fs';
import {createBuyerWriterLocalClient} from './local-gateway-client.js';
import {readBuyerWriterGatewayConfiguration,resolveBuyerWriterGatewayIdentity,
  validateBuyerWriterGatewayServiceConfiguration} from './gateway-entry.js';

export async function waitForBuyerWriterGateway({configurationFile,timeoutMs=15_000,io=fs,
  resolveIdentity=resolveBuyerWriterGatewayIdentity,readConfiguration=readBuyerWriterGatewayConfiguration,
  createClient=createBuyerWriterLocalClient,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  if(configurationFile!=='/etc/blackspire-buyer-writer-gateway/gateway.json'||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30_000)
    throw new Error('Buyer writer gateway readiness rejected');
  const identity=resolveIdentity(),config=validateBuyerWriterGatewayServiceConfiguration(readConfiguration(configurationFile,{identity}));
  const client=createClient({socketPath:config.socketPath,capability:config.gatewayCapability,authority:config.authority,timeoutMs:Math.min(timeoutMs,2000)});
  const deadline=performance.now()+timeoutMs;
  try{
    do{
      try{
        const stat=io.lstatSync(config.socketPath);
        if(stat.isSocket()&&!stat.isSymbolicLink()&&stat.uid===identity.uid&&stat.gid===identity.primaryGid&&(stat.mode&0o7777)===0o660){
          const result=await client.readiness();
          return Object.freeze({...result,socketVerified:true});
        }
      }catch{}
      await pause(50);
    }while(performance.now()<deadline);
    throw new Error('Buyer writer gateway readiness unavailable');
  }finally{await client.close();}
}

if(import.meta.url===`file://${process.argv[1]}`){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--configuration')throw new Error('Buyer writer gateway readiness rejected');
  const result=await waitForBuyerWriterGateway({configurationFile:args[1]});
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
