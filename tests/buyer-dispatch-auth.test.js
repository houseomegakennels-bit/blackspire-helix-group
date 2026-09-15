import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

function fixture() {
  let operatorId='owner-a', users=[{id:'owner-a'}], token='synthetic-request-token', authError=null;
  let cookieReads=0, authReads=0;
  const source=fs.readFileSync(new URL('../frontend/src/lib/buyer-dispatch-authority.ts',import.meta.url),'utf8')
    .replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'');
  const capture=vm.runInNewContext(`${stripTypeScriptTypes(source)}\ncaptureBuyerDispatchAuthority`,{
    AbortController,setTimeout,clearTimeout,performance,
    getAuthTokensFromCookies:async()=>{cookieReads++;return{accessToken:token};},
    createPublicSupabaseAuthClient:()=>({auth:{getUser:async supplied=>{authReads++;assert.equal(supplied,'synthetic-request-token');return{data:{user:operatorId?{id:operatorId}:null},error:authError};}}}),
    listAuthUsers:async()=>{if(users instanceof Error)throw users;return users;},
  });
  return{capture,setUser:v=>operatorId=v,setUsers:v=>users=v,setToken:v=>token=v,setError:v=>authError=v,counts:()=>({cookieReads,authReads})};
}
test('dispatch authority retains only the guarded principal and privately revalidates the original token',async()=>{
  const f=fixture(),gate={operatorId:'owner-a',role:'admin'};
  const authority=await f.capture(gate);gate.operatorId='owner-b';f.setToken('changed-after-request');
  assert.equal(authority.operatorId,'owner-a');assert.equal(Object.isFrozen(authority),true);
  assert.equal(JSON.stringify(authority).includes('synthetic-request-token'),false);
  await authority.assertCurrentOwner({user_id:'owner-a'});
  assert.deepEqual(f.counts(),{cookieReads:1,authReads:2});
  await assert.rejects(()=>authority.assertCurrentOwner({user_id:'owner-b'}),/authorization unavailable/);
});
test('revoked identity, changed role or unavailable role lookup cannot issue after acquisition',async()=>{
  for(const change of ['identity','role','lookup','auth']) {
    const f=fixture();const authority=await f.capture({operatorId:'owner-a',role:'admin'});
    if(change==='identity')f.setUser('owner-b');
    if(change==='role')f.setUsers([{id:'owner-b'},{id:'owner-a'}]);
    if(change==='lookup')f.setUsers(new Error('SENSITIVE AUTH DETAIL'));
    if(change==='auth')f.setError(new Error('SENSITIVE AUTH DETAIL'));
    await assert.rejects(()=>authority.assertCurrentOwner({user_id:'owner-a'}),error=>error.message==='Buyer dispatch authorization unavailable.');
  }
});
test('capture rejects missing tokens and mismatched or unsupported route guard context',async()=>{
  for(const gate of [null,{operatorId:'owner-b',role:'admin'},{operatorId:'owner-a',role:'anonymous'}, {operatorId:'owner-a',role:'beta_tester'}])
    await assert.rejects(()=>fixture().capture(gate),/authorization unavailable/);
  const f=fixture();f.setToken(null);await assert.rejects(()=>f.capture({operatorId:'owner-a',role:'admin'}),/authorization unavailable/);
});
test('beta capture preserves the admitted role without a second action reservation',async()=>{
  const f=fixture();f.setUsers([{id:'admin'},{id:'owner-a'}]);
  const authority=await f.capture({operatorId:'owner-a',role:'beta_tester'});
  await authority.assertCurrentOwner({user_id:'owner-a'});
  assert.equal(authority.role,'beta_tester');assert.deepEqual(f.counts(),{cookieReads:1,authReads:2});
});

test('admin context guard preserves anonymous/nonadmin denial and legacy helper behavior',async()=>{
  const source=fs.readFileSync(new URL('../frontend/src/lib/operator-access.ts',import.meta.url),'utf8')
    .replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'');
  for(const [operator,users,status] of [[null,[],401],[{id:'beta'},[{id:'admin'},{id:'beta'}],403],[{id:'admin'},[{id:'admin'}],null]]) {
    const guards=vm.runInNewContext(`${stripTypeScriptTypes(source)}\n({guardAdminApiContext,guardAdminApi})`,{
      getAuthenticatedOperator:async()=>operator,listAuthUsers:async()=>users,
      NextResponse:{json:(body,options)=>({body,status:options.status})},
    });
    const gate=await guards.guardAdminApiContext(),legacy=await guards.guardAdminApi();
    if(status===null){assert.equal(gate.operatorId,'admin');assert.equal(gate.role,'admin');assert.equal(legacy,null);}
    else{assert.equal(gate.response.status,status);assert.equal(legacy.status,status);}
  }
});

test('scoped job creation and lookup use the captured owner without default-user fallback',async()=>{
  const source=fs.readFileSync(new URL('../frontend/src/lib/buyer-engine-server.ts',import.meta.url),'utf8');
  let payload,selectedOwner;
  const query={insert:value=>{payload=value;return query;},select:()=>query,eq:(key,value)=>{if(key==='user_id')selectedOwner=value;return query;},
    limit:()=>query,single:async()=>({data:{id:'job',user_id:payload.user_id},error:null}),maybeSingle:async()=>({data:{id:'job',user_id:selectedOwner},error:null})};
  const dependencies={getEnvState:()=>({enabled:true}),scopedBuyerWriterEnabled:()=>true,getSupabaseAdmin:()=>({from:()=>query}),
    getOperatorScope:async()=>({operatorId:'default-owner',requiresAuth:false}),toIsoDate:value=>value};
  const load=(name,next)=>{
    const start=source.indexOf(`export async function ${name}(`),end=source.indexOf(next,start);
    return vm.runInNewContext(`${stripTypeScriptTypes(source.slice(start,end).replace('export async function','async function'))}\n${name}`,dependencies);
  };
  const authority={operatorId:'actual-owner',assertCurrentOwner:async job=>assert.equal(job.user_id,'actual-owner')};
  const create=load('createSearchJob','export async function listBuyerReports');
  const input={state:'NC',county:'Wake',propertyType:'land',dateRangeStart:'2026-01-01',dateRangeEnd:'2026-12-31',minPurchases:1};
  assert.equal((await create(input,authority)).user_id,'actual-owner');assert.equal(payload.user_id,'actual-owner');
  await assert.rejects(()=>create(input),/authorization unavailable/);
  const get=load('getSearchJobById','export async function listSearchJobsByIds');
  assert.equal((await get('job',authority)).user_id,'actual-owner');assert.equal(selectedOwner,'actual-owner');
});
test('scoped Deal creation never retries a failed authenticated creation as a recent job owner',async()=>{
  const source=fs.readFileSync(new URL('../frontend/src/lib/deal-engine-server.ts',import.meta.url),'utf8');
  const start=source.indexOf('async function createBuyerSearchJobWithFallback('),end=source.indexOf('function parseBuyerDraftsFromLogs',start);
  let fallbackReads=0;
  const create=vm.runInNewContext(`${stripTypeScriptTypes(source.slice(start,end))}\ncreateBuyerSearchJobWithFallback`,{
    createSearchJob:async()=>{throw new Error('Sign in required');},isBuyerSearchAuthBlock:()=>true,scopedBuyerWriterEnabled:()=>true,
    getSupabaseAdmin:()=>{fallbackReads++;throw new Error('fallback forbidden');},
  });
  await assert.rejects(()=>create({county:'Wake'},{operatorId:'actual-owner'}),/Sign in required/);
  assert.equal(fallbackReads,0);
});

test('unscoped automated Deal callers cannot obtain Buyer authority in scoped mode',async()=>{
  const source=fs.readFileSync(new URL('../frontend/src/lib/deal-engine-server.ts',import.meta.url),'utf8');
  const start=source.indexOf('export async function launchBuyerSearchFromDeal('),end=source.indexOf('export async function recordBuyerSearchDispatchFailure',start);
  let reads=0;
  const launch=vm.runInNewContext(`${stripTypeScriptTypes(source.slice(start,end).replace('export async function','async function'))}\nlaunchBuyerSearchFromDeal`,{
    scopedBuyerWriterEnabled:()=>true,getSupabaseAdmin:()=>{reads++;throw new Error('unscoped read forbidden');},
  });
  const result=await launch({dealId:'existing-deal'});assert.equal(result.ok,false);assert.match(result.error,/authority is required/);assert.equal(reads,0);
});
