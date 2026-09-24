import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  authenticateWriter,
  parseWriterOperation,
  WriterProtocolError,
} from '../packages/buyer-writer/protocol.js';

const jobId = '00000000-0000-4000-8000-000000000001';
const dispatchId = '00000000-0000-4000-8000-000000000002';
const sale = {
  buyer_name: 'ISOLATED BUYER', seller_name: null, property_address: null,
  mailing_address: null, sale_price: 120000, sale_date: '2026-08-01',
  property_type: 'land', parcel_id: 'SYNTHETIC-1', deed_type: null, lender_name: null,
};
const envelope = (overrides = {}) => ({
  version: 1, dispatchId, generation: 1, operation: 'start', chunkIndex: 0,
  chunkCount: 1, payload: {}, ...overrides,
});
const parse = (body) => parseWriterOperation({ jobId, body: Buffer.from(JSON.stringify(body)) });
const denied = (fn, status = 400) => assert.throws(fn, (e) =>
  e instanceof WriterProtocolError && e.status === status && !e.message.includes('ISOLATED'));

test('writer authentication requires an explicit dedicated credential and separate permit', () => {
  const credential = randomBytes(32).toString('base64url');
  const permit = randomBytes(32).toString('base64url');
  const headers = { 'x-buyer-writer-key': credential, 'x-buyer-job-permit': permit };
  const result = authenticateWriter({ headers, expectedCredential: credential });
  assert.match(result.permitDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(permit), false);
  assert.equal(JSON.stringify(result).includes(credential), false);
  for (const supplied of [undefined, '', 'wrong', [credential], `${credential},${credential}`]) {
    denied(() => authenticateWriter({ headers: { ...headers, 'x-buyer-writer-key': supplied }, expectedCredential: credential }), 401);
  }
  denied(() => authenticateWriter({ headers: { ...headers, 'x-buyer-writer-key': randomBytes(32).toString('base64url') }, expectedCredential: credential }), 401);
  denied(() => authenticateWriter({ headers, expectedCredential: undefined }), 503);
  denied(() => authenticateWriter({ headers: { ...headers, 'x-buyer-job-permit': '' }, expectedCredential: credential }), 401);
});

test('all fixed operations parse without granting a table or owner selection', () => {
  for (const operation of ['start', 'buyers.commit', 'complete']) {
    const parsed = parse(envelope({ operation }));
    assert.equal(parsed.jobId, jobId);
    assert.equal(parsed.operation, operation);
    assert.match(parsed.payloadDigest, /^[a-f0-9]{64}$/);
  }
  assert.equal(parse(envelope({ operation: 'fail', payload: { code: 'NO_DATA_SOURCE' } })).payload.code, 'NO_DATA_SOURCE');
  for (const operation of ['raw.append', 'clean.append']) {
    assert.deepEqual(parse(envelope({ operation, payload: { rows: [sale] } })).payload.rows, [sale]);
  }
});

test('rejects arbitrary authority, SQL routing, profile facts and lifecycle claims', () => {
  for (const field of ['user_id', 'workspace', 'table', 'filter', 'url', 'sql', 'payloadDigest']) {
    denied(() => parse(envelope({ [field]: 'untrusted' })));
  }
  for (const operation of ['select', 'BuyerProfile', 'raw.delete', '__proto__']) {
    denied(() => parse(envelope({ operation })));
  }
  denied(() => parse(envelope({ operation: 'buyers.commit', payload: { score: 100 } })));
  denied(() => parse(envelope({ operation: 'complete', payload: { total_buyers_found: 42 } })));
  denied(() => parse(envelope({ operation: 'fail', payload: { code: 'NO_DATA_SOURCE', message: 'ISOLATED secret' } })));
});

test('sale rows cannot override ownership, generated identifiers or canonical county', () => {
  for (const field of ['search_job_id', 'id', 'user_id', 'county', 'state', 'created_at', 'score']) {
    denied(() => parse(envelope({ operation: 'raw.append', payload: { rows: [{ ...sale, [field]: jobId }] } })));
  }
});

test('enforces date, type, finite numeric and row limits before database access', () => {
  for (const changes of [
    { sale_date: '2026-02-30' }, { sale_date: '2026-8-1' }, { sale_date: '0000-01-01' },
    { sale_price: -1 }, { sale_price: '120000' }, { buyer_name: 12 },
    { buyer_name: 'x'.repeat(513) }, { parcel_id: {} }, { buyer_name: 'bad\u0000name' },
  ]) denied(() => parse(envelope({ operation: 'raw.append', payload: { rows: [{ ...sale, ...changes }] } })));
  const missing = { ...sale };
  delete missing.parcel_id;
  denied(() => parse(envelope({ operation: 'raw.append', payload: { rows: [missing] } })));
  const nonfinite = JSON.stringify(envelope({ operation: 'raw.append', payload: { rows: [sale] } })).replace('120000', '1e400');
  denied(() => parseWriterOperation({ jobId, body: Buffer.from(nonfinite) }));
  for (const rows of [[], Array(101).fill(sale)]) {
    denied(() => parse(envelope({ operation: 'raw.append', payload: { rows } })));
  }
  assert.equal(parse(envelope({ operation: 'raw.append', payload: { rows: Array(100).fill(sale) } })).payload.rows.length, 100);
});

test('rejects malformed transport and noncanonical identifiers or chunk coordinates', () => {
  denied(() => parseWriterOperation({ jobId, body: Buffer.from('{') }));
  denied(() => parseWriterOperation({ jobId, body: Buffer.from([0xc0, 0xaf]) }));
  denied(() => parseWriterOperation({ jobId, body: Buffer.alloc(262145) }), 413);
  denied(() => parseWriterOperation({ jobId: `${jobId}&user_id=neq.x`, body: Buffer.from('{}') }));
  for (const changes of [
    { generation: 0 }, { generation: 1.5 }, { generation: Number.MAX_SAFE_INTEGER + 1 },
    { chunkCount: 501 }, { chunkIndex: -1 }, { chunkIndex: 1 },
    { dispatchId: 'untrusted' }, { version: 2 }, { payload: null },
  ]) denied(() => parse(envelope(changes)));
  denied(() => parse(envelope({ chunkCount: 2 })));
});

test('receipt digest is canonical but changes when any semantic input changes', () => {
  const first = envelope({ operation: 'raw.append', payload: { rows: [sale] } });
  const reordered = Object.fromEntries(Object.entries(first).reverse());
  reordered.payload = { rows: [Object.fromEntries(Object.entries(sale).reverse())] };
  assert.equal(parse(first).payloadDigest, parse(reordered).payloadDigest);
  for (const changes of [
    { generation: 2 }, { dispatchId: jobId }, { operation: 'clean.append' },
    { chunkCount: 2 }, { chunkCount: 2, chunkIndex: 1 },
    { payload: { rows: [{ ...sale, sale_price: 1 }] } },
  ]) {
    assert.notEqual(parse(first).payloadDigest, parse({ ...first, ...changes }).payloadDigest);
  }
  assert.notEqual(parse(first).payloadDigest, parseWriterOperation({ jobId: dispatchId, body: Buffer.from(JSON.stringify(first)) }).payloadDigest);
});
