import {provisionBuyerStore} from '../packages/buyer-store/provision.js';
try{
 if(process.argv.length!==4||process.argv[2]!=='--prepare')throw new Error();
 process.stdout.write(JSON.stringify(await provisionBuyerStore(process.argv[3]))+'\n');
}catch{process.stderr.write('Buyer store provisioning refused; retain journal for reconciliation\n');process.exitCode=1;}
