import {createHash} from 'node:crypto';
import {loadPolicy,requestReservation,estimatedCost} from './policy.mjs';
import {getCredential} from './vault.mjs';
import {openLedger} from './ledger.mjs';
import {fail} from './private-files.mjs';
const SYSTEM='You are Zola, a helpful personal assistant. Answer the user naturally. You have no tools or access to external accounts in this text session; do not claim to have performed actions or read workspace data.';
const ENDPOINTS={openai:'https://api.openai.com/v1/responses',anthropic:'https://api.anthropic.com/v1/messages'};
async function limitedJson(response){
 if(!response.body)fail('EMPTY_PROVIDER_RESPONSE');
 const reader=response.body.getReader();let bytes=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>262144)fail('PROVIDER_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(value));}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{await reader.cancel().catch(()=>{});}
}
function decode(body,provider,apiKey){
 let parts;
 if(provider==='openai'){
  if(body?.status!=='completed'||!Array.isArray(body.output))fail('PROVIDER_RESPONSE_INCOMPLETE');
  parts=body.output.filter(x=>x.type==='message'&&x.role==='assistant').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text);
 }else{
  if(!['end_turn','stop_sequence'].includes(body?.stop_reason)||!Array.isArray(body.content)||body.content.some(x=>x.type!=='text'))fail('PROVIDER_RESPONSE_INCOMPLETE');
  parts=body.content.map(x=>x.text);
 }
 if(parts.some(x=>typeof x!=='string'))fail('PROVIDER_RESPONSE_INVALID');
 const answer=parts.join('\n').split(apiKey).join('[redacted]');
 const input=body?.usage?.input_tokens,output=body?.usage?.output_tokens;
 if(!answer.trim()||Buffer.byteLength(answer)>65536||![input,output].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000))fail('PROVIDER_USAGE_UNAVAILABLE');
 // Explicitly disabled prompt caching must not result in separately billed cache writes.
 if(provider==='anthropic'&&(Number(body.usage.cache_creation_input_tokens||0)!==0||Number(body.usage.cache_read_input_tokens||0)!==0))fail('UNEXPECTED_BILLING_DIMENSION');
 return {answer,inputTokens:input,outputTokens:output};
}
export async function runCustomerChat(root,{requestId,prompt},{fetchImpl=fetch,clock=Date.now,signal}={}){
 if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)||typeof prompt!=='string')fail('REQUEST_INVALID');
 const {manifest,policy}=loadPolicy(root,clock());if(!policy.enabled)fail('CUSTOMER_AI_PAUSED');
 const {apiKey,keyId}=getCredential(root,manifest.installationId,policy.provider);
 const amount=requestReservation(prompt,policy),fingerprint=createHash('sha256').update(JSON.stringify({prompt,policy,keyId})).digest('hex');
 const ledger=openLedger(root,manifest.installationId);let reserved=false;
 try{
  const reservation=ledger.reserve({id:requestId,fingerprint,amount,limit:policy.monthlyLimitMicroUsd,now:clock()});
  if(reservation.replay)return {...reservation.replay,replayed:true};reserved=true;
  if(signal?.aborted)fail('CANCELLED');
  // Re-read paused/provider policy after the reservation, immediately before dispatch.
  const fresh=loadPolicy(root,clock()).policy;if(!fresh.enabled||JSON.stringify(fresh)!==JSON.stringify(policy))fail('CONFIGURATION_CHANGED');
  const body=policy.provider==='openai'?{model:policy.model,instructions:SYSTEM,input:prompt,max_output_tokens:policy.maxOutputTokens,store:false,stream:false,tools:[]}:
   {model:policy.model,system:SYSTEM,max_tokens:policy.maxOutputTokens,messages:[{role:'user',content:prompt}],stream:false};
  const headers={'content-type':'application/json',...(policy.provider==='openai'?{authorization:'Bearer '+apiKey}:{'x-api-key':apiKey,'anthropic-version':'2023-06-01'})};
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000);
  const response=await fetchImpl(ENDPOINTS[policy.provider],{method:'POST',headers,body:JSON.stringify(body),signal:combined,redirect:'error'});
  if(!response.ok){await response.body?.cancel().catch(()=>{});fail('PROVIDER_REQUEST_FAILED');}
  const decoded=decode(await limitedJson(response),policy.provider,apiKey);
  const actual=estimatedCost(decoded.inputTokens,decoded.outputTokens,policy);
  if(actual>amount){ledger.finish(requestId,{state:'overrun',actual});reserved=false;fail('BILLING_REVIEW_REQUIRED');}
  const result={requestId,provider:policy.provider,model:policy.model,...decoded,estimatedMicroUsd:actual,reservedMicroUsd:amount,replayed:false};
  ledger.finish(requestId,{state:'completed',actual,result});reserved=false;return result;
 }catch(error){if(reserved){ledger.finish(requestId,{state:'unknown'});fail('REQUEST_OUTCOME_UNRESOLVED');}throw error;}
 finally{ledger.close();}
}
