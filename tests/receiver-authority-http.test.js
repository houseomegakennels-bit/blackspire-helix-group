import test from 'node:test';
import assert from 'node:assert/strict';
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
async function invoke(req, consumer = () => ({ ok: true, bindingDigest: 'a'.repeat(64) }), env = { BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN: token }) {
  const res = response();
  await consumeCapabilityAuthority(req, res, { consumer, env });
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
