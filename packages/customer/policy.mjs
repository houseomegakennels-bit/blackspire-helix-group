import path from 'node:path';
import {loadCustomerInstallation,selectCustomerProvider} from '../shared/customer-installation.js';
import {readPrivate,atomicPrivate,exclusive,privateDirectory,fail,assertNoRecoveryHold} from './private-files.mjs';
import {putCredential} from './vault.mjs';
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
export function validatePolicy(p,id,now=Date.now()){
 const fields=['schemaVersion','installationId','provider','model','customerBillingAccepted','automaticRefill','enabled','monthlyLimitMicroUsd','perRequestLimitMicroUsd','maxInputBytes','maxOutputTokens','pricing'];
 if(!p||typeof p!=='object'||Object.keys(p).some(k=>!fields.includes(k))||!p.pricing||Object.keys(p.pricing).some(k=>!['inputMicroUsdPerMillion','outputMicroUsdPerMillion','checkedAt','expiresAt'].includes(k)))fail('POLICY_FIELDS_INVALID');
 if(p?.schemaVersion!==1||p.installationId!==id||!['openai','anthropic'].includes(p.provider)||typeof p.model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(p.model))fail('PROVIDER_POLICY_INVALID');
 if(p.customerBillingAccepted!==true||p.automaticRefill!==false||typeof p.enabled!=='boolean')fail('CUSTOMER_BILLING_REQUIRED');
 if(!integer(p.monthlyLimitMicroUsd,1,1e9)||!integer(p.perRequestLimitMicroUsd,1,p.monthlyLimitMicroUsd)||!integer(p.maxInputBytes,1,32768)||!integer(p.maxOutputTokens,16,4096))fail('BUDGET_POLICY_INVALID');
 if(!integer(p.pricing?.inputMicroUsdPerMillion,1,1e9)||!integer(p.pricing?.outputMicroUsdPerMillion,1,1e9))fail('PRICING_REQUIRED');
 const checked=Date.parse(p.pricing.checkedAt),expires=Date.parse(p.pricing.expiresAt);
 if(!Number.isFinite(checked)||!Number.isFinite(expires)||checked>now||expires<=now||expires-checked>7*86400000)fail('PRICING_EXPIRED');
 return p;
}
export function loadPolicy(root,now=Date.now()){
 assertNoRecoveryHold(root);
 const {manifest}=loadCustomerInstallation(root);privateDirectory(path.join(root,'data'));
 const policy=validatePolicy(JSON.parse(readPrivate(path.join(root,'customer-ai.json'))),manifest.installationId,now);
 if(manifest.ai.provider!==policy.provider)fail('PROVIDER_SELECTION_MISMATCH');
 return {manifest,policy};
}
export function configureCustomer(root,input,now=Date.now()){
 return exclusive(root,()=>{assertNoRecoveryHold(root);const {manifest}=loadCustomerInstallation(root);
 const policy=validatePolicy({...input.policy,installationId:manifest.installationId},manifest.installationId,now);
 // Save disabled policy first. Any interruption or failed credential write leaves execution off.
 atomicPrivate(path.join(root,'customer-ai.json'),JSON.stringify({...policy,enabled:false},null,2)+'\n');
 putCredential(root,manifest.installationId,policy.provider,input.apiKey);
 atomicPrivate(path.join(root,'installation.json'),JSON.stringify(selectCustomerProvider(manifest,policy.provider),null,2)+'\n');
 atomicPrivate(path.join(root,'customer-ai.json'),JSON.stringify(policy,null,2)+'\n');
 return {provider:policy.provider,model:policy.model,enabled:policy.enabled,authentication:'not_verified'};
 });
}
export function pauseCustomer(root){return exclusive(root,()=>{const {manifest}=loadCustomerInstallation(root);const p=JSON.parse(readPrivate(path.join(root,'customer-ai.json')));if(p.installationId!==manifest.installationId)fail('IDENTITY_MISMATCH');atomicPrivate(path.join(root,'customer-ai.json'),JSON.stringify({...p,enabled:false},null,2)+'\n');return {paused:true};});}
export function estimatedCost(tokensIn,tokensOut,p){return Math.ceil(tokensIn*p.pricing.inputMicroUsdPerMillion/1e6)+Math.ceil(tokensOut*p.pricing.outputMicroUsdPerMillion/1e6);}
export function requestReservation(prompt,p){const bytes=Buffer.byteLength(prompt);if(!prompt.trim()||bytes>p.maxInputBytes)fail('INPUT_LIMIT');
 // Text-only conservative byte-token allowance plus fixed protocol/system overhead; no tools or files.
 const amount=estimatedCost(bytes+4096,p.maxOutputTokens,p);if(amount>p.perRequestLimitMicroUsd)fail('PER_REQUEST_LIMIT');return amount;
}
