export const HTTP_REQUEST_TIMEOUT_MS = 30_000;
export const HTTP_HEADERS_TIMEOUT_MS = 10_000;
export const HTTP_SOCKET_IDLE_TIMEOUT_MS = 30_000;
export const HTTP_KEEP_ALIVE_TIMEOUT_MS = 5_000;
export const HTTP_CONNECTION_CHECK_INTERVAL_MS = 1_000;
export const HTTP_MAX_HEADER_BYTES = 16 * 1024;
export const HTTP_MAX_HEADERS = 100;
export const HTTP_MAX_REQUESTS_PER_SOCKET = 100;

export const HTTP_SERVER_OPTIONS = Object.freeze({
  requestTimeout: HTTP_REQUEST_TIMEOUT_MS,
  headersTimeout: HTTP_HEADERS_TIMEOUT_MS,
  keepAliveTimeout: HTTP_KEEP_ALIVE_TIMEOUT_MS,
  connectionsCheckingInterval: HTTP_CONNECTION_CHECK_INTERVAL_MS,
  maxHeaderSize: HTTP_MAX_HEADER_BYTES,
});

export function enforceHttpServerBoundary(server, { socketIdleTimeoutMs = HTTP_SOCKET_IDLE_TIMEOUT_MS } = {}) {
  server.maxHeadersCount = HTTP_MAX_HEADERS;
  server.maxRequestsPerSocket = HTTP_MAX_REQUESTS_PER_SOCKET;
  server.setTimeout(socketIdleTimeoutMs, (socket) => socket.destroy());
  return server;
}
