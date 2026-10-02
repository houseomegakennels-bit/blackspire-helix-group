#!/usr/bin/env node
import {customerOnboarding,selectCustomerModule} from '../packages/customer/onboarding.mjs';
try{
 const [action,flag,root,...extra]=process.argv.slice(2);if(!['status','choose'].includes(action)||flag!=='--directory'||!root||extra.length)throw Error('USAGE');
 let result;if(action==='status')result=customerOnboarding(root);else{let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>4096)throw Error('INPUT_LIMIT');}result=selectCustomerModule(root,JSON.parse(input));}
 console.log(JSON.stringify(result));
}catch{console.error('Onboarding refused. Use a private customer installation and a supported module with connect, create or skip. No accounts were created or enabled.');process.exitCode=1;}
