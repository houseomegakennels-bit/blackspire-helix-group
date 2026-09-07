import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createBuyerSourceAdapters } from '../frontend/src/lib/buyer-source-adapters.ts';
import { acquireBuyerSources } from '../packages/buyer-writer/acquisition.js';
import { verifyBuyerRawPayload } from '../packages/buyer-writer/source-context.js';
import { createBuyerSourceClient } from '../packages/buyer-writer/source-http.js';

const job={county:'Ashe',state:'NC',property_type:'land',date_range_start:'2026-01-01',date_range_end:'2026-08-31'};
const row={id:'00000000-0000-4000-8000-000000000001',state:'NC',county:'Ashe',source_type:'arcgis',
  source_url:'https://source.example.invalid/query?discard=legacy',active:true,cash_disabled:false,created_at:'2026-01-01T00:00:00Z'};
const approval={sourceId:row.id,state:'NC',county:'Ashe',registeredSourceType:'arcgis',
  sourceUrlSha256:createHash('sha256').update(row.source_url).digest('hex'),cashDisabled:false,createdAt:row.created_at,
  adapterId:'ashe-v1',sourceType:'arcgis_ashe',method:'GET',pathTransform:'strip_query',timeoutMs:20000};
function harness({reply={features:[]},factory=createBuyerSourceAdapters,budgets={},changedJob={},changedApproval={}}={}) {
  let closed=0;const requests=[];
  const run=()=>acquireBuyerSources({job:{...job,...changedJob},rows:[row],approved:[{...approval,...changedApproval}],
    budgets:{maxRequests:20,maxRows:100,maxBytes:1024*1024,maxElapsedMs:10000,...budgets},adapterFactory:factory,
    clientFactory:({endpoints})=>({close:()=>{closed++;},usage:()=>({requests:requests.length,bytes:1,closed:closed>0}),
      request:async input=>{const policy=endpoints.find(e=>e.id===input.endpointId);assert.equal(input.endpointConfigDigest,policy.digest);
        const built=policy.buildParameters(input.parameters);requests.push({policy,built});return{data:reply,ok:true,status:200};}})});
  return{run,requests,closed:()=>closed};
}
test('real adapter output is bound to exact bytes and canonical cash semantics, and client is closed',async()=>{
  const h=harness({reply:{features:[{attributes:{OWNER_NAME:'SYNTHETIC'}}]}});
  const result=await h.run();assert.equal(h.closed(),1);assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].built.query.has('discard'),false);
  const rows=verifyBuyerRawPayload(result.context,result.bytes);
  assert.equal(rows[0]._source_type,'arcgis_ashe');assert.equal(rows[0]._no_cash_data,true);
  assert.equal(result.context.sources[0].cashDisabled,false);assert.equal(result.context.rawPayload.rowCount,1);
});
test('empty adapter output is a bound successful empty payload, never a fallback fetch',async()=>{
  const h=harness();const result=await h.run();assert.equal(result.bytes.toString(),'[]');assert.equal(h.requests.length,1);
  assert.equal(h.closed(),1);assert.equal(result.context.rawPayload.rowCount,0);
});
test('malformed source responses, row/byte overflow and transport failures cannot become empty success',async()=>{
  for(const reply of [{},{features:null},{features:[null]},{features:[{attributes:'invalid'}]},
    {features:[],error:{}},{features:[{attributes:{x:'a'.repeat(500)}}]}]) {
    const h=harness({reply,budgets:{maxBytes:100}});await assert.rejects(h.run());assert.equal(h.closed(),1);
  }
  const rows=harness({reply:{features:[{attributes:{}},{attributes:{}}]},budgets:{maxRows:1}});
  await assert.rejects(rows.run(),{code:'SOURCE_BUDGET_EXCEEDED'});assert.equal(rows.closed(),1);
});
test('adapter cannot escape captured destination, method, query policy or county context',async()=>{
  const attacks=[t=>t.getJson('https://other.example.invalid/query?f=json',20000),
    t=>t.getJson('https://source.example.invalid/other?f=json',20000),
    t=>t.getJson('https://source.example.invalid/query?f=json&token=secret',20000),
    t=>t.getJson('https://source.example.invalid/query?f=json&f=json',20000),
    t=>t.postFormJson('https://source.example.invalid/query',new URLSearchParams(),20000),
    t=>t.resolveSource('Other','NC'),t=>t.postForsythJson('1234-56-7890')];
  for(const attack of attacks) {
    const h=harness({factory:t=>({prefetch:async()=>{await attack(t);return[];}})});
    await assert.rejects(h.run(),{code:'SOURCE_POLICY_REJECTED'});assert.equal(h.closed(),1);assert.equal(h.requests.length,0);
  }
});
test('wrong normalization markers and unsupported adapters fail without issuing a payload',async()=>{
  const h=harness({factory:()=>({prefetch:async()=>[{_source_type:'forged'}]})});
  await assert.rejects(h.run(),{code:'SOURCE_DATA_REJECTED'});assert.equal(h.closed(),1);
  const unsupported=harness({factory:()=>({prefetch:async()=>null})});
  await assert.rejects(unsupported.run(),{code:'SOURCE_ADAPTER_UNAVAILABLE'});assert.equal(unsupported.closed(),1);
});
test('adapter processing cannot return a permit payload after the aggregate deadline',async()=>{
  const h=harness({budgets:{maxElapsedMs:1},factory:()=>({prefetch:async()=>{
    await new Promise(resolve=>setTimeout(resolve,10));return[];
  }})});
  await assert.rejects(h.run(),{code:'SOURCE_TIMEOUT'});assert.equal(h.closed(),1);
});
test('nonfinite provider and adapter values cannot be laundered into JSON null',async()=>{
  for(const number of [NaN,Infinity,-Infinity]) {
    const h=harness({factory:()=>({prefetch:async()=>[{_source_type:'arcgis_ashe',nested:{price:number}}]})});
    await assert.rejects(h.run(),{code:'SOURCE_DATA_REJECTED'});assert.equal(h.closed(),1);
  }
  const h=harness({reply:JSON.parse('{"features":[{"attributes":{"price":1e400}}]}')});
  await assert.rejects(h.run(),{code:'SOURCE_DATA_REJECTED'});assert.equal(h.closed(),1);
});
test('all 19 real adapters compose with fixed policies and preserve empty-result termination',async()=>{
  for(const county of ['Wake','Lincoln','Forsyth','Mecklenburg','Brunswick','Orange','Beaufort','Ashe','Avery','Burke','Wilkes','Haywood','Sampson','Davie','Catawba','Edgecombe','Nash','Granville','Duplin']) {
    const source={...row,county};const policy={...approval,county,adapterId:`${county.toLowerCase()}-v1`,
      method:['Wake','Lincoln','Nash','Mecklenburg'].includes(county)?'POST':'GET',
      pathTransform:county==='Mecklenburg'?'append_query':'strip_query',timeoutMs:county==='Mecklenburg'?30000:20000};
    let closed=0,requests=0;
    const result=await acquireBuyerSources({job:{...job,county},rows:[source],approved:[policy],
      budgets:{maxRequests:10,maxRows:50000,maxBytes:10000,maxElapsedMs:10000},adapterFactory:createBuyerSourceAdapters,
      clientFactory:({endpoints})=>({close:()=>closed++,usage:()=>({requests,bytes:15}),request:async input=>{
        const endpoint=endpoints.find(e=>e.id===input.endpointId);endpoint.buildParameters(input.parameters);requests++;
        assert.equal(endpoint.method,policy.method);assert.equal(endpoint.url.endsWith('/query/query'),county==='Mecklenburg');
        return{data:{features:[]},ok:true,status:200};
      }})});
    assert.equal(result.bytes.toString(),'[]');assert.equal(closed,1);assert.equal(requests,1);
  }
});
test('Forsyth acquisition uses the real bounded client with shared primary/secondary budgets and HTTP failure propagation',async()=>{
  const source={...row,county:'Forsyth'};
  const policy={...approval,county:'Forsyth',adapterId:'forsyth-v1',sourceType:'arcgis_forsyth'};
  for(const scenario of ['success','budget','http-error']) {
    const calls=[];let usage;
    const promise=acquireBuyerSources({job:{...job,county:'Forsyth'},rows:[source],approved:[policy],
      budgets:{maxRequests:scenario==='budget'?1:3,maxRows:100,maxBytes:10000,maxElapsedMs:1000},adapterFactory:createBuyerSourceAdapters,
      clientFactory:options=>{
        const client=createBuyerSourceClient({...options,dnsResolve:async()=>['93.184.216.34'],
          httpsRequest:(url,settings,callback)=>{
            const req=new EventEmitter();req.destroy=()=>{};
            req.end=body=>{calls.push({url,settings,body});queueMicrotask(()=>{
              const secondary=url.hostname==='lrcpwa.ncptscloud.com';
              const res=new PassThrough();res.complete=true;res.headers={};res.statusCode=secondary&&scenario==='http-error'?503:200;
              callback(res);if(!res.destroyed)res.end(JSON.stringify(secondary?{primaryOwnerName:'SYNTHETIC'}:
                {features:[{attributes:{XFER_PIN:'1234567890.0',XFER_XFERDATE:1785542400000,XFER_SALEPRICE:100}}]}));
            });};return req;
          }});
        const close=client.close;client.close=()=>{close();usage=client.usage();};return client;
      }});
    if(scenario==='success') {
      const result=await promise;assert.equal(verifyBuyerRawPayload(result.context,result.bytes)[0].CURRENTOWNERNAME1,'SYNTHETIC');
    }else await assert.rejects(promise,{code:scenario==='budget'?'SOURCE_BUDGET_EXCEEDED':'SOURCE_HTTP_FAILED'});
    assert.equal(usage.closed,true);assert.equal(calls.length,scenario==='budget'?1:2);
    if(calls.length===2) {
      assert.equal(calls[1].settings.headers['x-tenant'],'forsyth');assert.equal(calls[1].settings.method,'POST');
      assert.deepEqual(JSON.parse(calls[1].body),{searchKey:'pin',searchValue:'1234-56-7890'});
    }
  }
});
