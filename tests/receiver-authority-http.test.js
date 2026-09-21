import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

process.env.BLACKSPIRE_RUNTIME_MODE = 'test';
process.env.BLACKSPIRE_DATA_DIR ||= '/tmp/blackspire-receiver-authority-http';
process.env.BLACKSPIRE_DB_PATH ||= '/tmp/blackspire-receiver-authority-http/command.sqlite';
const { consumeCapabilityAuthority } = await import('../apps/api/server.js');

const token = 'authority-consumer-http-boundary-token';
function request(body, headers = {}) {
  const stream = Readable.from([body]);
  stream.headers = { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers };
  return stream;
}
function response() {
  return {
    status: null, headers: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
}
async function invoke(req, consumer = () => ({ ok: true, bindingDigest: 'a'.repeat(64) }), env = { BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN: token }, options = {}) {
  const res = response();
  await consumeCapabilityAuthority(req, res, { consumer, env, ...options });
  return { status: res.status, headers: res.headers, body: JSON.parse(res.body) };
}

test('authority HTTP boundary passes only the sole authority member to the durable consumer', async () => {
  const authority = { opaque: 'candidate' };
  let consumed;
  const result = await invoke(request(JSON.stringify({ authority })), value => {
    consumed = value;
    return { ok: true, bindingDigest: 'b'.repeat(64) };
  });
  assert.deepEqual(consumed, authority);
  assert.deepEqual(result, {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' },
    body: { ok: true, bindingDigest: 'b'.repeat(64) },
  });
});

test('authority HTTP boundary rejects token, media type, shape and size before consumption with one sanitized response', async () => {
  const cases = [
    request(JSON.stringify({ authority: {} }), { authorization: '' }),
    request(JSON.stringify({ authority: {} }), { authorization: 'Bearer wrong' }),
    request(JSON.stringify({ authority: {} }), { 'content-type': 'text/plain' }),
    request('{'),
    request(JSON.stringify({ authority: {}, extra: true })),
    request(JSON.stringify({ authority: 'x'.repeat(17000) })),
  ];
  for (const req of cases) {
    let calls = 0;
    const result = await invoke(req, () => { calls += 1; throw new Error('sensitive durable failure'); });
    assert.equal(calls, 0);
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: 'not found' });
    assert.equal(JSON.stringify(result).includes('sensitive'), false);
  }
});

test('durable consumer refusal and replay are sanitized at the HTTP boundary', async () => {
  for (const reason of ['invalid authority secret', 'already consumed replay']) {
    const result = await invoke(request(JSON.stringify({ authority: {} })), () => { throw new Error(reason); });
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: 'not found' });
    assert.equal(JSON.stringify(result).includes(reason), false);
  }
});

function ownedRequest(){
  const input={workspaceId:'test',limit:5};
  const authority={capabilityId:'buyer.profiles.search',bodySha256:crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')};
  return {authority,request:input};
}
test('owned callback binds exact request before consumption and rechecks after bounded read',async()=>{
  const body=ownedRequest(),calls=[];
  const result=await invoke(request(JSON.stringify(body)),()=>{calls.push('consume');return{ok:true,bindingDigest:'a'.repeat(64)};},undefined,{
    verifier:()=>{calls.push('verify');return{ok:true,bindingDigest:'a'.repeat(64)};},
    readBuyerData:async value=>{calls.push('read');assert.deepEqual(value.request,body.request);return{profiles:[],count:0};},
  });
  assert.equal(result.status,200);assert.deepEqual(calls,['consume','verify','read','verify']);
  assert.deepEqual(result.body.buyerData,{profiles:[],count:0});
});
test('owned callback rejects unbound requests, unavailable storage and nonbuyer authority before consume',async()=>{
  for(const change of [b=>({...b,request:{...b.request,limit:6}}),b=>({...b,authority:{...b.authority,capabilityId:'seller.opportunities.search'}}),b=>({...b,extra:1})]){
    let calls=0;const result=await invoke(request(JSON.stringify(change(ownedRequest()))),()=>{calls++;},undefined,{readBuyerData:async()=>({})});
    assert.equal(result.status,404);assert.equal(calls,0);
  }
  let calls=0;assert.equal((await invoke(request(JSON.stringify(ownedRequest())),()=>{calls++;})).status,404);assert.equal(calls,0);
});
test('owned callback cannot return data after grant or binding revocation',async()=>{
  let checks=0;
  const result=await invoke(request(JSON.stringify(ownedRequest())),()=>({ok:true,bindingDigest:'a'.repeat(64)}),undefined,{
    verifier:()=>{if(++checks===2)throw new Error('revoked');return{ok:true,bindingDigest:'a'.repeat(64)};},
    readBuyerData:async()=>({sensitive:'must not return'}),
  });
  assert.equal(result.status,404);assert.deepEqual(result.body,{error:'not found'});assert.equal(checks,2);
});
