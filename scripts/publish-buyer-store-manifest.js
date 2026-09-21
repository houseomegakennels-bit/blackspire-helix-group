import {readRootOwnedJson} from '../packages/buyer-writer/protected-json.js';
import {publishBuyerStoreInstalledManifest} from '../packages/buyer-store/manifest-publication.js';
try{
 if(process.argv.length!==3||!['--publish','--restore'].includes(process.argv[2]))throw new Error();
 const binding=readRootOwnedJson('/var/lib/blackspire-operator/preparation/buyer-store-publication.json',{groupId:0});
 process.stdout.write(JSON.stringify(await publishBuyerStoreInstalledManifest(binding,{restore:process.argv[2]==='--restore'}))+'\n');
}catch{process.stderr.write('Buyer store manifest publication refused; retain journal\n');process.exitCode=1;}
