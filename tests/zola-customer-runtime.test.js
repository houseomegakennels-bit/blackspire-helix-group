import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {initializeCustomer} from '../scripts/init-zola-customer.mjs';
import {configureCustomer,loadPolicy,pauseCustomer,requestReservation} from '../packages/customer/policy.mjs';
import {getCredential} from '../packages/customer/vault.mjs';
import {runCustomerChat} from '../packages/customer/runtime.mjs';
import {openLedger} from '../packages/customer/ledger.mjs';
const NOW=Date.parse('2026-10-01T18:00:00Z');
const policy=(provider='openai',patch={})=>({schemaVersion:1,provider,model:'test-model',customerBillingAccepted:true,automaticRefill:false,enabled:true,monthlyLimitMicroUsd:50000,perRequestLimitMicroUsd:20000,maxInputBytes:1000,maxOutputTokens:100,pricing:{inputMicroUsdPerMillion:1000000,outputMicroUsdPerMillion:2000000,checkedAt:new Date(NOW).toISOString(),expiresAt:new Date(NOW+86400000).toISOString()},...patch});
function fixture(t,provider='openai',patch={}){
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'zola-runtime-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const {directory:root,installationId}=initializeCustomer({directory:path.join(parent,'customer'),origin:'https://customer.example',provider});
 configureCustomer(root,{policy:policy(provider,patch),apiKey:'test-only-'+provider+'-key'},NOW);return {root,installationId,parent};
}
const response=(provider='openai',patch={})=>new Response(JSON.stringify(provider==='openai'?{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Hello from Zola'}]}],usage:{input_tokens:20,output_tokens:10},...patch}:{stop_reason:'end_turn',content:[{type:'text',text:'Hello from Claude'}],usage:{input_tokens:20,output_tokens:10},...patch}));
const request=()=>({requestId:randomUUID(),prompt:'Hello'});
const opts=(fetchImpl)=>({fetchImpl,clock:()=>NOW});
test('customer credentials are encrypted on disk and authenticated to installation/provider',t=>{
 const {root,installationId}=fixture(t);const file=path.join(root,'secrets/openai.encrypted.json');const raw=fs.readFileSync(file,'utf8');
 assert.ok(!raw.includes('test-only-openai-key'));assert.equal(getCredential(root,installationId,'openai').apiKey,'test-only-openai-key');
 assert.throws(()=>getCredential(root,randomUUID(),'openai'),/CUSTOMER_CREDENTIAL_UNAVAILABLE/);
 const record=JSON.parse(raw);record.data=Buffer.from('tampered').toString('base64');fs.writeFileSync(file,JSON.stringify(record));
 assert.throws(()=>getCredential(root,installationId,'openai'),/CUSTOMER_CREDENTIAL_UNAVAILABLE/);
});
for(const provider of ['openai','anthropic'])test(provider+' dispatch uses only selected customer key and canonical host',async t=>{
 const {root}=fixture(t,provider);let calls=0;
 const result=await runCustomerChat(root,request(),opts(async(url,options)=>{calls++;
 assert.equal(url,provider==='openai'?'https://api.openai.com/v1/responses':'https://api.anthropic.com/v1/messages');
 assert.equal(options.redirect,'error');assert.ok(options.signal);const body=JSON.parse(options.body);assert.equal(body.model,'test-model');
 if(provider==='openai'){assert.equal(options.headers.authorization,'Bearer test-only-openai-key');assert.equal(body.store,false);assert.equal(body.max_output_tokens,100);assert.deepEqual(body.tools,[]);}
 else{assert.equal(options.headers['x-api-key'],'test-only-anthropic-key');assert.equal(body.max_tokens,100);assert.equal(body.tools,undefined);}
 return response(provider);
 }));assert.equal(calls,1);assert.equal(result.provider,provider);assert.equal(result.inputTokens,20);assert.equal(result.estimatedMicroUsd,40);
});
test('duplicate receipt replays without a second paid request; changed input conflicts',async t=>{
 const {root}=fixture(t);const req=request();let calls=0;const options=opts(async()=>{calls++;return response();});
 const one=await runCustomerChat(root,req,options),two=await runCustomerChat(root,req,options);assert.equal(two.answer,one.answer);assert.equal(two.replayed,true);assert.equal(calls,1);
 await assert.rejects(runCustomerChat(root,{...req,prompt:'Changed'},options),/REQUEST_ID_CONFLICT/);assert.equal(calls,1);
});
test('monthly cap persists across reopen and prevents a second dispatch',async t=>{
 const {root,installationId}=fixture(t,'openai',{monthlyLimitMicroUsd:5000,perRequestLimitMicroUsd:5000});let calls=0;
 await runCustomerChat(root,request(),opts(async()=>{calls++;return response();}));
 await assert.rejects(runCustomerChat(root,request(),opts(async()=>{calls++;return response();})),/MONTHLY_BUDGET_EXCEEDED/);assert.equal(calls,1);
 const ledger=openLedger(root,installationId);try{assert.equal(ledger.summary(NOW).reservedMicroUsd,4301);}finally{ledger.close();}
});
test('timeouts retain reservation, block retry and block new dispatch',async t=>{
 const {root}=fixture(t);const req=request();let calls=0;const options=opts(async()=>{calls++;throw Error('test-only-openai-key network detail');});
 await assert.rejects(runCustomerChat(root,req,options),e=>e.message==='REQUEST_OUTCOME_UNRESOLVED');
 await assert.rejects(runCustomerChat(root,req,options),/REQUEST_OUTCOME_UNRESOLVED/);
 await assert.rejects(runCustomerChat(root,request(),options),/BILLING_REVIEW_REQUIRED/);assert.equal(calls,1);
});
test('incomplete responses and missing usage fail closed without answer persistence',async t=>{
 const {root}=fixture(t);await assert.rejects(runCustomerChat(root,request(),opts(async()=>response('openai',{usage:null}))),/REQUEST_OUTCOME_UNRESOLVED/);
});
test('observed usage over reservation blocks future requests',async t=>{
 const {root}=fixture(t);await assert.rejects(runCustomerChat(root,request(),opts(async()=>response('openai',{usage:{input_tokens:20000,output_tokens:100}}))),/BILLING_REVIEW_REQUIRED/);
 await assert.rejects(runCustomerChat(root,request(),opts(async()=>response())),/BILLING_REVIEW_REQUIRED/);
});
test('expired prices, pause and missing key make zero network calls',async t=>{
 const {root}=fixture(t);let calls=0;const options=opts(async()=>{calls++;return response();});
 await assert.rejects(runCustomerChat(root,request(),{...options,clock:()=>NOW+2*86400000}),/PRICING_EXPIRED/);
 pauseCustomer(root);await assert.rejects(runCustomerChat(root,request(),options),/CUSTOMER_AI_PAUSED/);
 configureCustomer(root,{policy:policy(),apiKey:'test-only-replacement'},NOW);fs.unlinkSync(path.join(root,'secrets/openai.encrypted.json'));
 await assert.rejects(runCustomerChat(root,request(),options),/CUSTOMER_CREDENTIAL_UNAVAILABLE/);assert.equal(calls,0);
});
test('switching providers does not reuse former provider credentials or budget allowance',async t=>{
 const {root}=fixture(t,'openai',{monthlyLimitMicroUsd:5000,perRequestLimitMicroUsd:5000});await runCustomerChat(root,request(),opts(async()=>response()));
 configureCustomer(root,{policy:policy('anthropic',{monthlyLimitMicroUsd:5000,perRequestLimitMicroUsd:5000}),apiKey:'test-only-claude'},NOW);
 let calls=0;await assert.rejects(runCustomerChat(root,request(),opts(async()=>{calls++;return response('anthropic');})),/MONTHLY_BUDGET_EXCEEDED/);assert.equal(calls,0);
});
test('plaintext key echoed by provider is redacted before returned and saved',async t=>{
 const {root,installationId}=fixture(t);const req=request();const result=await runCustomerChat(root,req,opts(async()=>response('openai',{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'test-only-openai-key'}]}]})));
 assert.equal(result.answer,'[redacted]');const ledger=openLedger(root,installationId);ledger.close();assert.ok(!fs.readFileSync(path.join(root,'data/customer-ai.sqlite')).includes(Buffer.from('test-only-openai-key')));
});
test('bad pricing and exceeded request/input limits reject before dispatch',async t=>{
 const {root}=fixture(t);assert.throws(()=>configureCustomer(root,{policy:policy('openai',{pricing:{}}),apiKey:'test-only-key'},NOW));
 const p=loadPolicy(root,NOW).policy;assert.throws(()=>requestReservation('x'.repeat(1001),p),/INPUT_LIMIT/);
 assert.throws(()=>requestReservation('Hello',{...p,perRequestLimitMicroUsd:1}),/PER_REQUEST_LIMIT/);
});
test('ledger from another installation is rejected',t=>{
 const {root,installationId}=fixture(t);const ledger=openLedger(root,installationId);ledger.close();assert.throws(()=>openLedger(root,randomUUID()),/LEDGER_IDENTITY_MISMATCH/);
});
test('concurrent processes cannot both reserve the last available budget',async t=>{
 const {root,installationId}=fixture(t);const moduleUrl=new URL('../packages/customer/ledger.mjs',import.meta.url).href;
 const child=id=>new Promise((resolve,reject)=>{const code=`import {openLedger} from ${JSON.stringify(moduleUrl)};const db=openLedger(${JSON.stringify(root)},${JSON.stringify(installationId)});try{db.reserve({id:${JSON.stringify(id)},fingerprint:'f',amount:4000,limit:5000,now:${NOW}});console.log('reserved');}catch{console.log('refused');}finally{db.close();}`;const proc=spawn(process.execPath,['--input-type=module','-e',code]);let out='';proc.stdout.on('data',x=>out+=x);proc.on('error',reject);proc.on('exit',code=>code===0?resolve(out.trim()):reject(Error('child failure')));});
 assert.deepEqual((await Promise.all([child('a'),child('b')])).sort(),['refused','reserved']);
});
test('pending reservation from previous month blocks renewal until reviewed',t=>{
 const {root,installationId}=fixture(t);const ledger=openLedger(root,installationId);try{ledger.reserve({id:'old',fingerprint:'old',amount:1,limit:5000,now:NOW-40*86400000});assert.throws(()=>ledger.reserve({id:'new',fingerprint:'new',amount:1,limit:5000,now:NOW}),/BILLING_REVIEW_REQUIRED/);}finally{ledger.close();}
});

test('packager excludes unrelated secrets and produces runnable standalone configuration/status',async t=>{
 const {packageCustomer,CUSTOMER_FILES}=await import('../scripts/package-zola-customer.mjs');
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'zola-bundle-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const source=path.join(parent,'source');fs.mkdirSync(source);const actual=path.resolve(new URL('..',import.meta.url).pathname);
 for(const file of CUSTOMER_FILES){const dst=path.join(source,file);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(actual,file),dst);}
 fs.writeFileSync(path.join(source,'.env'),'DO_NOT_DISTRIBUTE');fs.writeFileSync(path.join(source,'customer-data.sqlite'),'DO_NOT_DISTRIBUTE');
 const out=path.join(parent,'bundle');const packaged=packageCustomer(source,out);assert.equal(packaged.files,15);
 assert.equal(fs.existsSync(path.join(out,'.env')),false);assert.equal(fs.existsSync(path.join(out,'customer-data.sqlite')),false);
 const manifest=JSON.parse(fs.readFileSync(path.join(out,'bundle-manifest.json')));assert.equal(manifest.fullZolaOs,false);
 const {spawnSync}=await import('node:child_process');const install=path.join(parent,'installed');
 const initialized=spawnSync(process.execPath,[path.join(out,'scripts/init-zola-customer.mjs'),'--directory',install,'--origin','https://customer.example','--provider','anthropic'],{encoding:'utf8'});assert.equal(initialized.status,0,initialized.stderr);
 const configured=spawnSync(process.execPath,[path.join(out,'scripts/customer-ai.mjs'),'configure','--directory',install],{input:JSON.stringify({apiKey:'test-only-bundle-key',policy:policy('anthropic',{pricing:{inputMicroUsdPerMillion:1000000,outputMicroUsdPerMillion:2000000,checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}})}),encoding:'utf8'});assert.equal(configured.status,0,configured.stderr);assert.ok(!configured.stdout.includes('test-only-bundle-key'));
 const status=spawnSync(process.execPath,[path.join(out,'scripts/customer-ai.mjs'),'status','--directory',install],{encoding:'utf8'});assert.equal(status.status,0,status.stderr);assert.equal(JSON.parse(status.stdout).provider,'anthropic');
 assert.throws(()=>packageCustomer(source,out));assert.throws(()=>packageCustomer(source,path.join(source,'nested')));
});

test('HTTP errors never persist raw provider details or automatically retry',async t=>{
 const {root}=fixture(t);let calls=0;const req=request();
 await assert.rejects(runCustomerChat(root,req,opts(async()=>{calls++;return new Response('test-only-openai-key',{status:401});})),e=>e.message==='REQUEST_OUTCOME_UNRESOLVED');
 await assert.rejects(runCustomerChat(root,req,opts(async()=>{calls++;return response();})));assert.equal(calls,1);
 assert.ok(!fs.readFileSync(path.join(root,'data/customer-ai.sqlite')).includes(Buffer.from('test-only-openai-key')));
});
test('oversized response is rejected and abort/cancel never invokes transport',async t=>{
 const {root}=fixture(t);await assert.rejects(runCustomerChat(root,request(),opts(async()=>new Response('x'.repeat(262145)))),/REQUEST_OUTCOME_UNRESOLVED/);
 const second=fixture(t);let calls=0;await assert.rejects(runCustomerChat(second.root,request(),{...opts(async()=>{calls++;return response();}),signal:AbortSignal.abort()}),/REQUEST_OUTCOME_UNRESOLVED/);assert.equal(calls,0);
});
test('unsupported policy fields cannot smuggle credentials or alternate endpoints into stored policy',t=>{
 const {root}=fixture(t);
 for(const extra of [{apiKey:'test-only-do-not-store'},{baseUrl:'https://untrusted.example'}])assert.throws(()=>configureCustomer(root,{policy:policy('openai',extra),apiKey:'test-only-key'},NOW),/POLICY_FIELDS_INVALID/);
 assert.ok(!fs.readFileSync(path.join(root,'customer-ai.json'),'utf8').includes('test-only-do-not-store'));
});
test('separately billed Anthropic cache usage requires review',async t=>{
 const {root}=fixture(t,'anthropic');await assert.rejects(runCustomerChat(root,request(),opts(async()=>response('anthropic',{usage:{input_tokens:1,output_tokens:1,cache_read_input_tokens:100}}))),/REQUEST_OUTCOME_UNRESOLVED/);
});
