import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeObservedResponse, observationForResult } from '../packages/capabilities/read-observation.js';
const observation = { version: 1, releaseSha: 'a'.repeat(40), transport: 'bounded PostgREST GET/HEAD', requests: 1, responseBytes: 42, forbiddenAttempts: 0, latencyMs: 1, scope: 'supplied read client only' };
const route = '/api/internal/capabilities/seller-opportunities';
const response = (value) => new Response('{}', { headers: { 'x-zola-read-observation': JSON.stringify(value) } });
test('observation binds only the decoded response object without widening public result', () => {
  const result = decodeObservedResponse('{"opportunities":[]}', response(observation), route);
  assert.deepEqual(Object.keys(result), ['opportunities']);
  assert.equal(observationForResult(result).releaseSha, observation.releaseSha);
  assert.equal(observationForResult(result).route, route);
  assert.equal(observationForResult({ ...result }), null);
  assert.ok(Object.isFrozen(observationForResult(result)));
});
test('unknown fields malformed SHA oversize counters and forbidden attempts are rejected', () => {
  for (const patch of [{ extra: 'secret' }, { releaseSha: ['a'.repeat(40)] }, { releaseSha: 'bad' }, { requests: 13 }, { responseBytes: 2097153 }, { forbiddenAttempts: 1 }, { latencyMs: -1 }, { scope: 'global egress proven' }]) {
    assert.throws(() => decodeObservedResponse('{}', response({ ...observation, ...patch }), route), /rejected/);
  }
});
test('legacy absent observation never becomes observed proof', () => {
  const result = decodeObservedResponse('{}', new Response('{}'), route);
  assert.equal(observationForResult(result), null);
});
