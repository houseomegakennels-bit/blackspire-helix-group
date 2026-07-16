import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from '../packages/shared/net.js';

function fakeReq(remoteAddress, headers = {}) {
  return { socket: { remoteAddress }, headers };
}

test('trust disabled by default: spoofed X-Forwarded-For is ignored, socket IP is used', () => {
  delete process.env.TRUST_PROXY;
  const req = fakeReq('203.0.113.9', { 'x-forwarded-for': '9.9.9.9, 8.8.8.8' });
  assert.equal(clientIp(req), '203.0.113.9');
});

test('trust disabled explicitly (TRUST_PROXY=false): spoofed header still ignored', () => {
  process.env.TRUST_PROXY = 'false';
  const req = fakeReq('203.0.113.9', { 'x-forwarded-for': '9.9.9.9' });
  assert.equal(clientIp(req), '203.0.113.9');
  delete process.env.TRUST_PROXY;
});

test('trust enabled explicitly: leftmost forwarded IP is honored', () => {
  process.env.TRUST_PROXY = 'true';
  const req = fakeReq('10.0.0.1', { 'x-forwarded-for': '9.9.9.9, 8.8.8.8' });
  assert.equal(clientIp(req), '9.9.9.9');
  delete process.env.TRUST_PROXY;
});

test('trust enabled but no forwarded header present: falls back to socket IP', () => {
  process.env.TRUST_PROXY = 'true';
  const req = fakeReq('10.0.0.1', {});
  assert.equal(clientIp(req), '10.0.0.1');
  delete process.env.TRUST_PROXY;
});

test('malformed forwarded header does not crash and falls back to socket IP', () => {
  process.env.TRUST_PROXY = 'true';
  const req = fakeReq('10.0.0.1', { 'x-forwarded-for': '<script>alert(1)</script>' });
  assert.equal(clientIp(req), '10.0.0.1');
  delete process.env.TRUST_PROXY;
});

test('missing socket address falls back to the "local" sentinel', () => {
  delete process.env.TRUST_PROXY;
  const req = { socket: {}, headers: {} };
  assert.equal(clientIp(req), 'local');
});

test('IPv4-mapped IPv6 socket addresses are normalized', () => {
  delete process.env.TRUST_PROXY;
  const req = fakeReq('::ffff:127.0.0.1', {});
  assert.equal(clientIp(req), '127.0.0.1');
});
