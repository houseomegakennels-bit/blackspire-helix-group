import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
const source = fs.readFileSync(new URL('../frontend/src/lib/capability-read-client.ts', import.meta.url), 'utf8');
const body = stripTypeScriptTypes(source.replace(/^import.*;\n/gm, '').replace(/export /g, ''));
const create = vm.runInNewContext(`${body}\ncreateCapabilityReadScope`, { URL, URLSearchParams, performance, AbortController, AbortSignal, TextDecoder, Response, Uint8Array });
const origin = 'https://abcdefghijklmnopqrst.supabase.co';
function fixture(fetchImpl = async () => Response.json([{ id: 'one' }])) {
  const calls = [];const scope = create({ origin, key: 'synthetic-private-key', releaseSha: 'a'.repeat(40), fetchImpl: async (url, opts) => { calls.push({ url, opts }); return fetchImpl(url, opts); } });
  return { scope, calls };
}
const query = (scope) => scope.client.from('BuyerProfile').select('id').limit(1);
test('fixed-origin bounded GET produces sanitized closed observation, re-await does not replay', async () => {
  const { scope, calls } = fixture(); const q = query(scope);
  assert.equal((await q).data.length, 1); await q;
  assert.equal(calls.length, 1); assert.equal(calls[0].opts.method, 'GET');assert.equal(calls[0].opts.redirect, 'error');
  assert.equal(calls[0].url.origin, origin);
  const result = scope.respond({ ok: true });
  const evidence = JSON.parse(result.headers.get('x-zola-read-observation'));
  assert.equal(evidence.requests, 1);assert.equal(evidence.forbiddenAttempts, 0);assert.equal(evidence.releaseSha, 'a'.repeat(40));
  assert.equal(JSON.stringify(evidence).includes('synthetic-private-key'), false);
  assert.throws(() => query(scope), /REJECTED/);
});
test('caught mutation RPC Storage unknown projections and schema bypass attempts poison response', async () => {
  for (const attempt of [s => s.client.rpc, s => s.client.storage, s => s.client.auth, s => s.client.from('unknown'),
    s => s.client.from('BuyerProfile').insert, s => s.client.from('BuyerProfile').select('*'),
    s => s.client.from('BuyerProfile').select('id').eq('owner', 'other'), s => s.client.from('BuyerProfile').select('id').limit(201),
    s => s.client.from('BuyerProfile').select('id').order('id', { foreignTable: 'unknown' })]) {
    const { scope, calls } = fixture(); try { attempt(scope); } catch { /* helper swallows */ }
    assert.throws(() => scope.respond({ ok: true }), /REJECTED/);assert.equal(calls.length, 0);
  }
});
test('missing bounds, oversized rows/body, invalid JSON, redirect and errors fail closed', async () => {
  for (const response of [() => Response.json([{id:1},{id:2}]), () => new Response('x'.repeat(1024*1024+1)),
    () => new Response('invalid'), () => Response.redirect('https://paid.invalid', 302), () => new Response('private-error', {status:500})]) {
    const {scope}=fixture(response); await assert.rejects(async () => await query(scope), /REJECTED/);
    assert.throws(() => scope.respond({ok:true}), /REJECTED/);
  }
  const {scope,calls}=fixture();await assert.rejects(async () => await scope.client.from('BuyerProfile').select('id'), /REJECTED/);assert.equal(calls.length,0);
});
test('HEAD exact count and independently bounded embedded relations', async () => {
  const { scope, calls } = fixture(async (_url,opts) => opts.method==='HEAD' ? new Response(null,{headers:{'content-range':'*/34'}}) : Response.json([{deal_analysis:[{maximum_allowable_offer:1}]}]));
  assert.equal((await scope.client.from('BuyerProfile').select('id',{count:'exact',head:true}).ilike('county','%test%')).count,34);
  const selection='id,owner_name,property_address,county,status,motivation_score,recommended_next_action,deal_analysis(maximum_allowable_offer,assignment_fee_target),seller_conversations(next_action),buyer_matches(exit_strategy)';
  await scope.client.from('deal_leads').select(selection).limit(1).maybeSingle();
  for(const table of ['deal_analysis','seller_conversations','buyer_matches']) assert.equal(calls[1].url.searchParams.get(`${table}.limit`),'1');
  assert.equal(scope.observation().requests,2);
});
