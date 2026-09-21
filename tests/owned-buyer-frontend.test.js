import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHash,timingSafeEqual} from 'node:crypto';
import * as contract from '../packages/buyer-store/deal-context-contract.js';
const load=(file,name,globals)=>{const source=fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');return vm.runInNewContext(`${stripTypeScriptTypes(source)}\n${name}`,{Buffer,URL,URLSearchParams,performance,AbortController,AbortSignal,TextDecoder,Response,Uint8Array,Date,...globals});};
const sha='a'.repeat(40),binding='b'.repeat(64);
const observation={version:2,releaseSha:sha,transport:'bounded owned PostgreSQL SELECT and Supabase GET/HEAD',requests:2,responseBytes:40,forbiddenAttempts:0,latencyMs:2,scope:'authority-bound Buyer read only'};
test('owned frontend scope combines measured native reads with actual registry GET and prohibits stale Buyer queries',async()=>{
 const create=load('frontend/src/lib/capability-read-client.ts','createCapabilityReadScope',{});let calls=0;
 const options={origin:'https://kchtrvfcixnimvxxctkj.supabase.co',key:'fixture',releaseSha:sha,receiverAuthorityDigest:binding,ownedObservation:observation,fetchImpl:async()=>{calls++;return Response.json([]);}};
 const scope=create(options);await scope.client.from('buyer_group_registry').select('id,canonical_name,group_type,aliases,states,counties,website,notes,active,created_at,updated_at').eq('active',true).limit(201);
 const result=scope.respond({profiles:[]});const header=JSON.parse(result.headers.get('x-zola-read-observation'));
 assert.equal(header.version,2);assert.equal(header.requests,3);assert.equal(header.responseBytes,42);assert.equal(calls,1);assert.equal(result.headers.get('x-blackspire-authority-binding'),binding);
 const forbidden=create(options);assert.throws(()=>forbidden.client.from('BuyerProfile'));assert.throws(()=>forbidden.respond({}));
 assert.throws(()=>create({...options,ownedObservation:{...observation,releaseSha:'c'.repeat(40)}}));
});
test('owned user client sends current session only to fixed service and never retries failed writes',async()=>{
 let calls=0;const process={env:{BLACKSPIRE_BUYER_STORE_MODE:'owned-postgres-v1',BLACKSPIRE_BUYER_STORE_URL:'https://command.blackspirehelix.com'}};
 const call=load('frontend/src/lib/buyer-store-client.ts','buyerStoreRequest',{process,getAuthTokensFromCookies:async()=>({accessToken:'synthetic-session'}),fetch:async(url,options)=>{calls++;assert.equal(url,'https://command.blackspirehelix.com/api/internal/buyer-store/v1/job-create');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer synthetic-session');return new Response('unknown',{status:502});}});
 await assert.rejects(call('job-create',{}));assert.equal(calls,1);
 process.env.BLACKSPIRE_BUYER_STORE_URL='https://foreign.invalid';await assert.rejects(call('job-create',{}));assert.equal(calls,1);
});
test('actual deal-context endpoint verifies signed authority before fixed bounded read and signs measured response',async()=>{
 const key=Buffer.alloc(32,7).toString('base64url'),now=Date.now();let calls=0;
 const input=contract.signBuyerDealContextRequest({version:1,releaseSha:sha,bindingDigest:binding,taskId:'task-fixture',dealId:'DE-0001',expiresAt:now+15000,nonce:Buffer.alloc(32,8).toString('base64url')},key);
 const post=load('frontend/src/app/api/internal/buyer-store/deal-context/route.ts','POST',{...contract,NextResponse:Response,readBoundedRequestBody:r=>r.text(),process:{env:{BLACKSPIRE_BUYER_DEAL_CONTEXT_KEY:key,VERCEL_GIT_COMMIT_SHA:sha,SUPABASE_URL:'https://kchtrvfcixnimvxxctkj.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-only'}},fetch:async(url,options)=>{calls++;assert.equal(url.pathname,'/rest/v1/deal_leads');assert.equal(url.searchParams.get('id'),'eq.DE-0001');assert.equal(url.searchParams.get('select'),'property_address,county,city,property_type');assert.equal(options.method,'GET');return Response.json([{city:null,county:'Wake',property_address:null,property_type:'land'}]);}});
 const request=value=>new Request('https://frontend.invalid/api/internal/buyer-store/deal-context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await post(request({...input,dealId:'DE-0002'}))).status,404);assert.equal(calls,0);
 const result=await post(request(input));assert.equal(result.status,200);const verified=contract.verifyBuyerDealContextResponse(await result.json(),input,key);assert.equal(verified.deal.county,'Wake');assert.equal(verified.observation.requests,1);assert.equal(calls,1);
});
test('owned receiver sends exact original body and validates bound owned response',async()=>{
 const requestBody={workspaceId:'blackspire-command',limit:5},body=JSON.stringify(requestBody),now=Date.now();
 const authority={version:1,releaseSha:sha,releaseRunId:'11111111-1111-4111-8111-111111111111',apiGeneration:'c'.repeat(32),workerGeneration:'d'.repeat(32),workspaceId:'blackspire-command',principalId:'principal',principalSecurityVersion:1,grantId:'grant',grantVersion:1,grantSecurityVersion:1,capabilityId:'buyer.profiles.search',permission:'buyer.profiles.read',taskId:'task',attemptId:'attempt',workerId:'worker',claimDigest:'e'.repeat(64),method:'POST',path:'/api/internal/capabilities/buyer-profiles',bodySha256:createHash('sha256').update(body).digest('hex'),issuedAt:now,expiresAt:now+15000,proof:'f'.repeat(43)};
 const {proof,...claims}=authority;const digest=createHash('sha256').update(JSON.stringify({...claims,proofDigest:createHash('sha256').update(proof).digest('hex')})).digest('hex');
 const data={version:1,capabilityId:authority.capabilityId,bindingDigest:digest,profiles:[],count:0,deal:null,observation};
 const authorize=load('frontend/src/lib/internal-capability-auth.ts','authorizeInternalCapability',{createHash,timingSafeEqual,process:{env:{BLACKSPIRE_BUYER_STORE_MODE:'owned-postgres-v1',BLACKSPIRE_CAPABILITY_TOKEN:'x'.repeat(32),BLACKSPIRE_SELLER_ENGINE_WORKSPACE_ID:'blackspire-command',VERCEL_GIT_COMMIT_SHA:sha,BLACKSPIRE_AUTHORITY_CONSUMER_URL:'https://command.blackspirehelix.com',BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN:'y'.repeat(32)}},fetch:async(_url,options)=>{const sent=JSON.parse(options.body);assert.deepEqual(sent.request,requestBody);assert.deepEqual(sent.authority,authority);return Response.json({ok:true,bindingDigest:digest,buyerData:data});}});
 const req=()=>new Request('https://frontend.invalid/api/internal/capabilities/buyer-profiles',{method:'POST',headers:{authorization:`Bearer ${'x'.repeat(32)}`,'x-blackspire-receiver-authority':Buffer.from(JSON.stringify(authority)).toString('base64url')},body});
 assert.equal((await authorize(req(),body,'blackspire-command',authority.capabilityId)).buyerData.count,0);
 data.bindingDigest=binding;assert.equal(await authorize(req(),body,'blackspire-command',authority.capabilityId),null);
});
