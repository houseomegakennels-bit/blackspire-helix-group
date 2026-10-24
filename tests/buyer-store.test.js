import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuyerStoreHandler,createSupabaseBuyerUserVerifier,validateBuyerStoreInput,BUYER_AUTH_ORIGIN} from '../packages/buyer-store/service.js';
import {readConsumedBuyerData} from '../packages/buyer-store/capability.js';
import {createHash} from 'node:crypto';
const owner='00000000-0000-4000-8000-000000000001';
const token='header.payload.signature';
const key='sb_publishable_fixture_only';
const user={id:owner,email_confirmed_at:'2026-01-01',app_metadata:{blackspire_role:'beta_tester'}};
const response=value=>new Response(JSON.stringify(value));
test('fresh fixed-project authentication derives owner and never trusts metadata supplied by caller',async()=>{
 const seen=[];const verify=createSupabaseBuyerUserVerifier({publicKey:key,operatorOwnerId:null,fetchImpl:async(url,options)=>{seen.push({url,options});return response(user);}});
 assert.deepEqual(await verify(token),{ownerId:owner,role:'beta_tester'});
 assert.equal(seen[0].url,`${BUYER_AUTH_ORIGIN}/auth/v1/user`);assert.equal(seen[0].options.redirect,'error');assert.equal(seen[0].options.headers.apikey,key);
 await assert.rejects(createSupabaseBuyerUserVerifier({publicKey:key,operatorOwnerId:null,fetchImpl:async()=>response({...user,app_metadata:{},user_metadata:{blackspire_role:'admin'}})})(token));
 await assert.rejects(createSupabaseBuyerUserVerifier({publicKey:key,operatorOwnerId:owner,fetchImpl:async()=>response({...user,app_metadata:{blackspire_role:'client_only'}})})(token));
 await assert.rejects(createSupabaseBuyerUserVerifier({publicKey:key,operatorOwnerId:owner,fetchImpl:async()=>new Response('bad',{status:401})})(token));
 assert.throws(()=>createSupabaseBuyerUserVerifier({publicKey:`x.${Buffer.from('{"role":"service_role"}').toString('base64url')}.x`,operatorOwnerId:owner}));
});
test('operation schemas reject foreign owner SQL input and bound all lists',async()=>{
 let calls=0;const handler=createBuyerStoreHandler({verifyUser:async()=>({ownerId:owner,role:'admin'}),repository:{execute:async(op,input,id,role)=>{calls++;assert.equal(id,owner);assert.equal(role,"admin");return [];}}});
 assert.deepEqual(await handler({operation:'jobs-list',accessToken:token,input:{ids:[],limit:12}}),{ok:true,data:[]});
 for(const input of [{ids:[],limit:201},{ids:[],limit:12,ownerId:owner},{ids:['bad'],limit:12}])await assert.rejects(handler({operation:'jobs-list',accessToken:token,input}));
 assert.equal(calls,1);assert.throws(()=>validateBuyerStoreInput('export-create',{id:owner,searchJobId:null,fileName:'file.csv',rowCount:0,storagePath:'foreign/file.csv'}));assert.throws(()=>validateBuyerStoreInput('export-create',{id:owner,searchJobId:null,fileName:'../foreign.csv',rowCount:0}));assert.throws(()=>validateBuyerStoreInput('sql',{query:'DELETE FROM anything'}));
});
test('capability helper binds original body and uses trusted deal lookup',async()=>{
 const request={workspaceId:'blackspire-command',opportunityId:'DE-0001',limit:5,matchesOnly:true};
 const authority={capabilityId:'buyer.matches.search',workspaceId:request.workspaceId,bodySha256:createHash('sha256').update(JSON.stringify(request)).digest('hex')};
 const bindingDigest='a'.repeat(64);let calls=0;
 const deps={lookupDeal:async id=>{assert.equal(id,'DE-0001');return {deal:{county:'Wake County',city:'Raleigh',property_address:'1 Example St, Raleigh, NC 27601',property_type:'land'},observation:{requests:1,responseBytes:80,latencyMs:1}};},repository:{readCapabilityProfiles:async input=>{calls++;assert.equal(input.county,'Wake');assert.equal(input.state,'NC');assert.equal(input.limit,200);return {rows:[],count:0,observation:{requests:2,responseBytes:20,latencyMs:1}};}}};
 const value=await readConsumedBuyerData({authority,request,bindingDigest},deps);assert.equal(value.bindingDigest,bindingDigest);assert.equal(calls,1);
 await assert.rejects(readConsumedBuyerData({authority,request:{...request,opportunityId:'DE-9999'},bindingDigest},deps));assert.equal(calls,1);
 await assert.rejects(readConsumedBuyerData({authority:{...authority,capabilityId:'deal.records.search'},request,bindingDigest},deps));
});

test('signed deal context binds purpose, task, deployment, request and bounded actual observation',async()=>{
 const {signBuyerDealContextRequest:signRequest,verifyBuyerDealContextRequest:verifyRequest,signBuyerDealContextResponse:signResponse,verifyBuyerDealContextResponse:verifyResponse}=await import('../packages/buyer-store/deal-context-contract.js');
 const key=Buffer.alloc(32,7).toString('base64url'),now=100000;
 const input={version:1,releaseSha:'b'.repeat(40),bindingDigest:'c'.repeat(64),taskId:'task-fixture',dealId:'DE-0001',expiresAt:now+10000,nonce:Buffer.alloc(32,9).toString('base64url')};
 const request=signRequest(input,key,now);assert.deepEqual(verifyRequest(request,key,input.releaseSha,now),request);
 const response=signResponse(request,null,{requests:1,responseBytes:2,latencyMs:1},key,now);
 assert.equal(verifyResponse(response,request,key,now).deal,null);
 for(const changed of [{...request,dealId:'DE-0002'},{...request,taskId:'foreign'},{...request,signature:response.signature}])assert.throws(()=>verifyRequest(changed,key,input.releaseSha,now));
 assert.throws(()=>verifyResponse({...response,deal:{city:null,county:'foreign',property_address:null,property_type:null}},request,key,now));
 assert.throws(()=>verifyResponse(response,request,key,now+10001));
 assert.throws(()=>verifyRequest(request,key,'d'.repeat(40),now));
});


test('job criteria preserve frontend purchase bound and mutation roles come only from fresh verifier',async()=>{
 const input={id:owner,state:'NC',county:'Wake',property_type:'land',date_range_start:null,date_range_end:null,min_purchases:5,cash_buyers_only:false,llc_buyers_only:false};
 assert.equal(validateBuyerStoreInput('job-create',input).min_purchases,5);
 assert.throws(()=>validateBuyerStoreInput('job-create',{...input,min_purchases:6}));
 let observed;
 const handler=createBuyerStoreHandler({verifyUser:async()=>({ownerId:owner,role:'beta_tester'}),repository:{execute:async(...args)=>{observed=args;return {};}}});
 await handler({operation:'job-create',accessToken:token,input});assert.equal(observed[3],'beta_tester');
 await assert.rejects(handler({operation:'job-create',accessToken:token,input:{...input,role:'admin'}}));
});

test('unknown deal state never runs native unscoped buyer count or trusts caller state',async()=>{
 const request={workspaceId:'blackspire-command',opportunityId:'DE-0001',state:'SC',limit:5,matchesOnly:true};
 const authority={capabilityId:'buyer.matches.search',workspaceId:request.workspaceId,bodySha256:createHash('sha256').update(JSON.stringify(request)).digest('hex')};
 let reads=0;
 await assert.rejects(readConsumedBuyerData({authority,request,bindingDigest:'a'.repeat(64)},{
 lookupDeal:async()=>({deal:{county:'Union',city:null,property_address:null,property_type:'land'},observation:{requests:1,responseBytes:80,latencyMs:1}}),
 repository:{readCapabilityProfiles:async()=>{reads++;throw Error('unscoped');}}
 }),/BUYER_STORE_REFUSED/);
 assert.equal(reads,0);
});

test('native capability uses explicit state from comma and application-produced ZIP addresses before counting buyers',async()=>{
 for(const [address,state,county] of [
  ['1 Synthetic St, Greenville, NC, 27834','NC','Pitt'],
  ['1 Synthetic St, Greenville NC 27834','NC','Pitt'],
  ['1 Synthetic St, Greenville NC','NC','Pitt'],
  ['1 Synthetic St, Greenville SC','SC','Greenville'],
  ['1 Synthetic St, Greenville NC, 27834','NC','Pitt'],
  ['1 Synthetic St, Greenville NC 27834-1234','NC','Pitt'],
  ['1 Synthetic St, Greenville SC 29601','SC','Greenville'],

  ['1 Synthetic St, Greenville, NC 27834','NC','Pitt'],
  ['1 Synthetic St, Greenville, NC, 27834-1234','NC','Pitt'],
  ['1 Synthetic St, Greenville, SC, 29601','SC','Greenville'],
 ]){
  const request={workspaceId:'blackspire-command',opportunityId:'DE-0001',state:state==='NC'?'SC':'NC',limit:5,matchesOnly:true};
  const authority={capabilityId:'buyer.matches.search',workspaceId:request.workspaceId,bodySha256:createHash('sha256').update(JSON.stringify(request)).digest('hex')};
  let reads=0;
  const value=await readConsumedBuyerData({authority,request,bindingDigest:'a'.repeat(64)},{
   lookupDeal:async()=>({deal:{county:county+' County',city:'Greenville',property_address:address,property_type:'land'},observation:{requests:1,responseBytes:80,latencyMs:1}}),
   repository:{readCapabilityProfiles:async input=>{reads++;assert.equal(input.state,state);assert.equal(input.county,county);return {rows:[{id:'synthetic-buyer',county,state}],count:1,observation:{requests:2,responseBytes:80,latencyMs:1}};}}
  });
  assert.equal(reads,1);assert.equal(value.count,1);assert.equal(value.profiles[0].state,state);
 }
});
test('native capability missing or unrecognized address state is unavailable instead of evaluated zero',async()=>{
 for(const address of [null,'1 Synthetic St, Greenville','1 Synthetic St, Greenville, ZZ, 27834','1 Synthetic St, Greenville, Unknown, 27834','1 Synthetic St, Greenville ZZ','1 Synthetic St, Greenville ZZ 27834','1 Synthetic St, Greenville North Carolina 27834']){
  const request={workspaceId:'blackspire-command',opportunityId:'DE-0001',state:'NC',limit:5,matchesOnly:true};
  const authority={capabilityId:'buyer.matches.search',workspaceId:request.workspaceId,bodySha256:createHash('sha256').update(JSON.stringify(request)).digest('hex')};
  let reads=0;
  await assert.rejects(readConsumedBuyerData({authority,request,bindingDigest:'a'.repeat(64)},{
   lookupDeal:async()=>({deal:{county:'Pitt',city:'Greenville',property_address:address,property_type:'land'},observation:{requests:1,responseBytes:80,latencyMs:1}}),
   repository:{readCapabilityProfiles:async()=>{reads++;return {rows:[],count:0,observation:{requests:2,responseBytes:2,latencyMs:1}};}}
  }),/BUYER_STORE_REFUSED/);
  assert.equal(reads,0);
 }
});
test('native capability unknown county does not become an evaluated empty buyer count',async()=>{
 const request={workspaceId:'blackspire-command',opportunityId:'DE-0001',limit:5,matchesOnly:true};
 const authority={capabilityId:'buyer.matches.search',workspaceId:request.workspaceId,bodySha256:createHash('sha256').update(JSON.stringify(request)).digest('hex')};
 let reads=0;
 await assert.rejects(readConsumedBuyerData({authority,request,bindingDigest:'a'.repeat(64)},{
  lookupDeal:async()=>({deal:{county:'Unknown',city:'Greenville',property_address:'1 Synthetic St, Greenville, NC, 27834',property_type:'land'},observation:{requests:1,responseBytes:80,latencyMs:1}}),
  repository:{readCapabilityProfiles:async()=>{reads++;return {rows:[],count:0,observation:{requests:2,responseBytes:2,latencyMs:1}};}}
 }),/BUYER_STORE_REFUSED/);
 assert.equal(reads,0);
});
