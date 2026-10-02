#!/usr/bin/env node
import {loadCustomerInstallation,customerProviderStatus} from '../packages/shared/customer-installation.js';
const args=process.argv.slice(2);
if(args.length!==2 || args[0]!=='--directory'){
 console.error('Usage: node scripts/customer-status.mjs --directory /customer-installation');
 process.exitCode=1;
}else{
 try{
  const installation=loadCustomerInstallation(args[1]);
  console.log(JSON.stringify({installationId:installation.manifest.installationId,...customerProviderStatus(installation)}));
 }catch{
  console.error('Customer configuration rejected; check ownership, private permissions and installation identity.');
  process.exitCode=1;
 }
}
