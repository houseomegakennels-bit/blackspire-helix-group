import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';

import {
  HTTP_SERVER_OPTIONS,
  HTTP_MAX_HEADERS,
  HTTP_MAX_REQUESTS_PER_SOCKET,
  enforceHttpServerBoundary,
} from '../packages/shared/http-boundary.js';
import { readJson } from '../packages/shared/util.js';

test('HTTP boundary pins bounded headers, request, keep-alive, and connection scanning', () => {
  assert.deepEqual(HTTP_SERVER_OPTIONS, {
    requestTimeout: 30_000,
    headersTimeout: 10_000,
    keepAliveTimeout: 5_000,
    connectionsCheckingInterval: 1_000,
    maxHeaderSize: 16 * 1024,
  });
  assert.ok(HTTP_SERVER_OPTIONS.headersTimeout < HTTP_SERVER_OPTIONS.requestTimeout);
});

test('server boundary caps header and request reuse and destroys an idle socket', () => {
  const server = http.createServer(HTTP_SERVER_OPTIONS);
  enforceHttpServerBoundary(server, { socketIdleTimeoutMs: 5 });
  assert.equal(server.maxHeadersCount, HTTP_MAX_HEADERS);
  assert.equal(server.maxRequestsPerSocket, HTTP_MAX_REQUESTS_PER_SOCKET);
  assert.equal(server.timeout, 5);
  const socket = { destroyed: false, destroy() { this.destroyed = true; } };
  server.emit('timeout', socket);
  assert.equal(socket.destroyed, true);
});

test('JSON reader counts bytes, stops buffering after the bound, and returns a typed refusal', async () => {
  const request = new EventEmitter();
  request.resume = () => { request.resumed = true; };
  const result = readJson(request, { maxBytes: 4 }).then(() => null, (error) => error);
  request.emit('data', Buffer.from('1234'));
  request.emit('data', Buffer.from('5'));
  request.emit('data', Buffer.alloc(1024 * 1024));
  request.emit('end');
  const error = await result;
  assert.equal(error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(request.resumed, true);
});
