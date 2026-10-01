#!/usr/bin/env node
import readline from 'node:readline/promises';
import {Writable} from 'node:stream';
import {configureCustomer} from '../packages/customer/policy.mjs';
const [flag,root,...extra]=process.argv.slice(2);
let muted=false;
const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk,encoding);callback();}});
if(flag!=='--directory'||!root||extra.length||!process.stdin.isTTY||!process.stdout.isTTY){console.error('Use a private interactive terminal: node scripts/configure-customer-ai.mjs --directory /customer-installation');process.exitCode=1;}
else{
 const rl=readline.createInterface({input:process.stdin,output,terminal:true});
 try{
  console.log('Zola customer AI setup. Your own API billing is required. Chat subscriptions are not connected here.');
  const provider=(await rl.question('Provider (openai or anthropic): ')).trim();
  const model=(await rl.question('Exact model ID from your provider: ')).trim();
  const dollars=async label=>{const n=Number((await rl.question(label)).trim());if(!Number.isFinite(n)||n<=0||n>1000)throw Error('INVALID_AMOUNT');return Math.round(n*1e6);};
  const monthlyLimitMicroUsd=await dollars('Monthly application budget in USD: ');
  const perRequestLimitMicroUsd=await dollars('Maximum reservation per request in USD: ');
  console.log('Check the provider pricing page for this exact text model. Rates expire in 7 days.');
  const inputMicroUsdPerMillion=await dollars('Input price in USD per million tokens: ');
  const outputMicroUsdPerMillion=await dollars('Output price in USD per million tokens: ');
  const accepted=(await rl.question('These calls use my own API account; I accept metered charges (type YES): ')).trim();
  if(accepted!=='YES')throw Error('DECLINED');
  process.stdout.write('API key (hidden): ');muted=true;let apiKey;try{apiKey=(await rl.question('')).trim();}finally{muted=false;process.stdout.write('\n');}
  const now=Date.now();
  const result=configureCustomer(root,{apiKey,policy:{schemaVersion:1,provider,model,enabled:true,customerBillingAccepted:true,automaticRefill:false,monthlyLimitMicroUsd,perRequestLimitMicroUsd,maxInputBytes:8192,maxOutputTokens:1024,pricing:{inputMicroUsdPerMillion,outputMicroUsdPerMillion,checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+7*86400000).toISOString()}}},now);
  apiKey='';console.log(JSON.stringify(result));console.log('Saved. No provider call was made. Only the local text CLI is enabled; Zola OS services and integrations remain uninstalled.');
 }catch{console.error('Setup stopped. No credential values are displayed. Existing configuration may remain paused; check status.');process.exitCode=1;}
 finally{muted=false;rl.close();}
}
