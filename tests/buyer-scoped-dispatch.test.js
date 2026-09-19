import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const job={id:'00000000-0000-4000-8000-000000000001',user_id:'owner',county:'Wake',state:'NC',updated_at:'2026-09-07T00:00:00.123456Z'};
const attempt='00000000-0000-4000-8000-000000000002';
function fixture({issuanceError=false,workflowError=false,state='completed',registryError=false,truncated=false,roleLost=false,reconcileError=false}={}) {
  const calls=[];let authChecks=0;
  const source=fs.readFileSync(new URL('../frontend/src/lib/buyer-scoped-dispatch.ts',import.meta.url),'utf8')
    .replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'');
  const context={version:1};const criteria={county:'Wake'};
  const transport=async(url,credentialHeader,credential,body)=>{
    calls.push({url:String(url),credentialHeader,credential,body});
    if(String(url).endsWith('/issuance')) {
      if(issuanceError)throw new Error('SENSITIVE TRANSPORT DETAIL');
      return{version:1,jobId:job.id,dispatchId:attempt,generation:1,permit:'p'.repeat(43)};
    }
    if(String(url).endsWith('/reconciliation')){if(reconcileError)throw new Error('SENSITIVE DB DETAIL');return{dispatchId:attempt,generation:state==='absent'?null:1,state};}
    if(workflowError)throw new Error('SENSITIVE WORKFLOW DETAIL');
    return{ok:true,status:'completed'};
  };
  const loaded=vm.runInNewContext(`${stripTypeScriptTypes(source)}\n({dispatchScopedBuyer,scopedBuyerWriterEnabled})`,{
    process:{env:{BUYER_WRITER_MODE:'scoped',BUYER_WRITER_BASE_URL:'https://writer.test',BUYER_WRITER_ISSUER_KEY:'i'.repeat(43),BUYER_WRITER_N8N_INGRESS_KEY:'n'.repeat(43)}},
    URL,Buffer,TextDecoder,structuredClone,AbortSignal,randomUUID:()=>attempt,
    approvedBuyerSources:()=>[],createBuyerSourceAdapters:()=>{},
    acquireBuyerSources:async()=>({context,criteria,updatedAt:job.updated_at,bytes:Buffer.from('[]')}),
  });
  const query={abortSignal(){return query;},select(){return query;},eq(){return query;},order(){return query;},limit(){return query;},
    then(resolve){return Promise.resolve({data:[],count:truncated?1:0,error:registryError?{message:'SENSITIVE DATABASE DETAIL'}:null}).then(resolve);}};
  const authority={operatorId:'owner',role:'admin',remainingMs:()=>270000,assertCurrentOwner:async value=>{assert.equal(value.user_id,'owner');authChecks++;if(roleLost&&authChecks===3)throw new Error('revoked');}};
  return{run:()=>loaded.dispatchScopedBuyer(job,authority,{from:()=>query},transport),calls,authChecks:()=>authChecks,criteria};
}
test('scoped dispatch binds original capture, keeps secrets server-side and verifies durable completion',async()=>{
  const f=fixture();const result=await f.run();assert.equal(result.response.status,'completed');
  assert.equal(f.authChecks(),3);assert.equal(f.calls.length,3);
  assert.equal(f.calls[0].body.requestId,attempt);assert.equal(f.calls[0].body.updatedAt,job.updated_at);
  assert.deepEqual(f.calls[0].body.criteria,f.criteria);
  assert.equal(f.calls[1].body.rawBase64,'W10=');assert.equal(f.calls[1].body.permit,'p'.repeat(43));
  assert.equal(f.calls[2].body.requestId,attempt);assert.equal(f.calls[2].body.updatedAt,job.updated_at);
  assert.equal(JSON.stringify(result).includes('p'.repeat(43)),false);
});
test('uncertain workflow completion reconciles once without retrying and preserves completed work',async()=>{
  const f=fixture({workflowError:true});assert.equal((await f.run()).response.status,'completed');assert.equal(f.calls.length,3);
});
test('unknown issuance and revoked authority reconcile the same attempt without invoking or replaying workflow',async()=>{
  for(const options of [{issuanceError:true,state:'absent'},{roleLost:true,state:'cancelled'}]) {
    const f=fixture(options);await assert.rejects(f.run, error=>error.message==='Buyer Engine scoped dispatch failed.');
    assert.equal(f.calls.length,2);assert.match(f.calls[1].url,/reconciliation$/);
    assert.equal(f.calls[1].body.requestId,attempt);
  }
});
test('registry errors and truncation cannot authorize fallback or any issuance',async()=>{
  for(const options of [{registryError:true},{truncated:true}]) {
    const f=fixture(options);await assert.rejects(f.run,/scoped dispatch failed/);assert.equal(f.calls.length,0);
  }
});
test('a successful webhook response cannot hide cancelled or failed database completion',async()=>{
  for(const state of ['failed','cancelled']) {
    const f=fixture({state});await assert.rejects(f.run,/scoped dispatch failed/);assert.equal(f.calls.length,3);
  }
});

test('unavailable or malformed reconciliation preserves sanitized recovery coordinates as unknown outcome',async()=>{
  for(const options of [{reconcileError:true},{state:'processing'},{state:'absent'}]) {
    const f=fixture(options);await assert.rejects(f.run,error=>error.name==='BuyerDispatchUncertainError'
      && error.jobId===job.id && error.requestId===attempt && error.updatedAt===job.updated_at
      && !JSON.stringify(error).includes('SENSITIVE'));
  }
});

test('scoped Deal uncertainty preserves launch effects without legacy guidance rewrites or retry tasks',async()=>{
  const source=fs.readFileSync(new URL('../frontend/src/app/api/deal-engine/launch-buyer-search/route.ts',import.meta.url),'utf8')
    .replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'');
  for(const uncertain of [false,true]) {
    let legacyWrites=0;const logged=[];
    const run=vm.runInNewContext(`${stripTypeScriptTypes(source)}\nPOST`,{
      performance,guardAdminApiContext:async()=>({operatorId:'owner',role:'admin'}),scopedBuyerWriterEnabled:()=>true,
      captureBuyerDispatchAuthority:async()=>({operatorId:'owner'}),
      launchBuyerSearchFromDeal:async()=>({ok:true,job,workflow:{dispatch:'queued'}}),
      triggerBuyerEngineWorkflow:async()=>{throw Object.assign(new Error('safe error'),{jobId:job.id,requestId:attempt,updatedAt:job.updated_at});},
      isBuyerDispatchUncertainError:()=>uncertain,
      recordBuyerSearchDispatchFailure:async()=>{legacyWrites++;},
      console:{error:(...values)=>logged.push(values)},NextResponse:{json:(body,options={})=>({body,status:options.status??200})},
    });
    const result=await run({json:async()=>({dealId:'fixture-deal'})});
    assert.equal(result.status,202);assert.equal(result.body.job,job);assert.equal(legacyWrites,0);
    assert.equal(result.body.workflow.dispatch,uncertain?'unknown':'failed');assert.equal(logged.length,uncertain?1:0);
    assert.equal(JSON.stringify(result.body).includes('retry task'),false);
  }
});
