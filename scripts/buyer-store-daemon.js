import {startBuyerStoreRuntime} from '../packages/buyer-store/runtime.js';
if(process.argv.length!==2||process.getuid()===0){process.stderr.write('Buyer store unavailable\n');process.exitCode=1;}
else{
 try{
  const server=await startBuyerStoreRuntime();
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),13000).unref();});
 }catch{process.stderr.write('Buyer store unavailable\n');process.exitCode=1;}
}
