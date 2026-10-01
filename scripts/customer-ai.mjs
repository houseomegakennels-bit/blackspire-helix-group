#!/usr/bin/env node
import {configureCustomer,pauseCustomer} from '../packages/customer/policy.mjs';
import {runCustomerChat} from '../packages/customer/runtime.mjs';
import {reviewCustomerRecovery} from '../packages/customer/recovery-review.mjs';
async function input(){let s='';for await(const chunk of process.stdin){s+=chunk;if(Buffer.byteLength(s)>131072)throw Error('INPUT_TOO_LARGE');}return JSON.parse(s);}
const [action,flag,root,...extra]=process.argv.slice(2);
try{
 if(!['configure','chat','pause','status'].includes(action)||flag!=='--directory'||!root||extra.length)throw Error('USAGE');
 let result;
 if(action==='configure')result=configureCustomer(root,await input());
 if(action==='chat')result=await runCustomerChat(root,await input());
 if(action==='pause')result=pauseCustomer(root);
 if(action==='status')result=reviewCustomerRecovery(root);
 console.log(JSON.stringify(result));
}catch{
 // No raw provider response, parser context, network exception, key or input is printed.
 console.error('Customer AI command could not complete. Check private configuration, current pricing, budget and request status. Uncertain requests are not retried automatically.');process.exitCode=1;
}
