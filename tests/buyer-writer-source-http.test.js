import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createBuyerSourceClient, isBuyerPublicIPv4 } from '../packages/buyer-writer/source-http.js';

const digest='a'.repeat(64);
const policy={id:'fixture',url:'https://source.example.invalid/service/query',method:'GET',encoding:'json',digest,timeoutMs:200,
  buildParameters:()=>({query:new URLSearchParams({f:'json'})})};
const input={endpointId:'fixture',endpointConfigDigest:digest,parameters:{}};
function harness({reply={},dns=async()=>['93.184.216.34'],budgets={},endpoint={}}={}) {
  const calls=[];let resolves=0;
  const client=createBuyerSourceClient({endpoints:[{...policy,...endpoint}],budgets:{maxRequests:5,maxBytes:1000,maxElapsedMs:1000,...budgets},
    dnsResolve:async(host)=>{resolves++;assert.equal(host,'source.example.invalid');return dns(host);},
    httpsRequest:(url,options,callback)=>{
      const req=new EventEmitter();req.destroyed=false;
      req.destroy=(error)=>{if(req.destroyed)return;req.destroyed=true;if(error)queueMicrotask(()=>req.emit('error',error));};
      req.end=(body)=>{
        calls.push({url,options,body,req});
        if(reply.stall)return;
        queueMicrotask(()=>{
          const res=new PassThrough();res.statusCode=reply.status??200;res.headers=reply.headers??{};res.complete=reply.complete??true;
          callback(res);
          if(!res.destroyed){res.write(reply.body??'[{}]');if(!reply.stallBody)res.end();}
        });
      };
      return req;
    },
  });
  return{client,calls,resolves:()=>resolves};
}
test('destination policy rejects special addresses, mixed DNS answers and caller transport overrides',async()=>{
  for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','100.100.100.200','168.63.129.16','192.0.2.1','198.18.0.1','224.0.0.1','255.255.255.255','::1','2130706433'])assert.equal(isBuyerPublicIPv4(address),false);
  assert.equal(isBuyerPublicIPv4('93.184.216.34'),true);
  const h=harness({dns:async()=>['93.184.216.34','127.0.0.1']});
  await assert.rejects(h.client.request(input),{code:'SOURCE_POLICY_REJECTED'});assert.equal(h.calls.length,0);assert.equal(h.client.usage().requests,1);
  for(const endpoint of [{url:'http://source.example.invalid/query'},{url:'https://source.example.invalid:444/query'},
    {url:'https://source.example.invalid/query?next=evil'},{url:'https://user:pass@source.example.invalid/query'},
    {url:'https://127.0.0.1/query'},{headers:{Authorization:'not-allowed'}}])assert.throws(()=>harness({endpoint}),{code:'SOURCE_POLICY_REJECTED'});
});
test('one vetted DNS answer is pinned while retaining HTTPS hostname and independent agent',async()=>{
  const h=harness();try {
    assert.deepEqual(await h.client.request(input),{status:200,ok:true,data:[{}]});
    assert.equal(h.resolves(),1);const call=h.calls[0];assert.equal(call.url.hostname,'source.example.invalid');
    assert.equal(call.options.servername,'source.example.invalid');assert.equal(call.options.rejectUnauthorized,true);
    assert.equal(call.options.family,4);assert.equal(call.options.autoSelectFamily,false);assert.notEqual(call.options.agent,https.globalAgent);
    assert.equal(call.options.headers['accept-encoding'],'identity');assert.equal(call.options.maxHeaderSize,16384);
    call.options.lookup('source.example.invalid',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'93.184.216.34');assert.equal(family,4);});
    assert.equal(h.resolves(),1);
  }finally{h.client.close();}
});
test('HTTP errors, redirects, compression, truncation and HTTP-200 provider errors never become empty success',async()=>{
  for(const reply of [{status:302},{status:500},{headers:{'content-encoding':'gzip'}},{complete:false},
    {body:'{"error":{"message":"private provider detail"}}'},{body:'not JSON'},{body:Buffer.from([0xff])}]) {
    const h=harness({reply});await assert.rejects(h.client.request(input),error=>{
      assert.equal(error.message,'Buyer source acquisition failed');assert.equal(error.message.includes('private'),false);return true;
    });assert.equal(h.calls.length,1);assert.equal(h.client.usage().closed,true);
  }
});
test('aggregate byte and request limits count attempts and close acquisition on exhaustion',async()=>{
  const h=harness({budgets:{maxBytes:7}});
  await h.client.request(input);await assert.rejects(h.client.request(input),{code:'SOURCE_BUDGET_EXCEEDED'});
  assert.deepEqual(h.client.usage(),{requests:2,bytes:8,closed:true});
  await assert.rejects(h.client.request(input),{code:'SOURCE_UNAVAILABLE'});assert.equal(h.calls.length,2);
  const quota=harness({budgets:{maxRequests:1}});await quota.client.request(input);
  await assert.rejects(quota.client.request(input),{code:'SOURCE_BUDGET_EXCEEDED'});assert.equal(quota.calls.length,1);
  const failed=harness({dns:async()=>{throw new Error('private DNS detail');}});
  await assert.rejects(failed.client.request(input),{code:'SOURCE_TRANSPORT_FAILED'});assert.equal(failed.client.usage().requests,1);
});
test('whole-request deadline covers stalled DNS and body and never opens a late socket',async()=>{
  let finishDns;
  const h=harness({dns:()=>new Promise(resolve=>{finishDns=resolve;}),endpoint:{timeoutMs:10}});
  const pending=h.client.request(input);
  await assert.rejects(h.client.request(input),{code:'SOURCE_UNAVAILABLE'});
  await assert.rejects(pending,{code:'SOURCE_TIMEOUT'});
  finishDns(['93.184.216.34']);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.length,0);
  const body=harness({reply:{stallBody:true},endpoint:{timeoutMs:10}});
  await assert.rejects(body.client.request(input),{code:'SOURCE_TIMEOUT'});assert.equal(body.calls[0].req.destroyed,true);
});
test('fixed JSON and form POST policies snapshot request parameters before DNS',async()=>{
  for(const encoding of ['form','json']) {
    const h=harness({endpoint:{method:'POST',encoding,headers:{'X-Tenant':'forsyth'},buildParameters:()=>({query:new URLSearchParams(),body:encoding==='form'?new URLSearchParams({pin:'fixture'}):{searchKey:'pin',searchValue:'fixture'}})}});
    try {
      await h.client.request(input);const call=h.calls[0];
      assert.equal(call.options.method,'POST');assert.equal(call.options.headers['x-tenant'],'forsyth');
      assert.equal(call.options.headers['content-length'],call.body.length);
      assert.equal(call.options.headers['content-type'],encoding==='form'?'application/x-www-form-urlencoded':'application/json');
      assert.equal(call.options.headers['user-agent'],encoding==='form'?'Mozilla/5.0':undefined);
    }finally{h.client.close();}
  }
});
