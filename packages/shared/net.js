// Direct socket address is the only thing we ever trust unless TRUST_PROXY is explicitly enabled.
// This prevents a client from spoofing X-Forwarded-For to evade rate limits or forge audit trails.
// Read live (not a frozen config constant) so an operator flipping TRUST_PROXY takes effect without
// re-importing modules, and so it can be tested per-request.
export function clientIp(req, { trustProxy = process.env.TRUST_PROXY === 'true' } = {}) {
  const socketIp = normalize(req.socket?.remoteAddress) || 'local';
  if (!trustProxy) return socketIp;
  const header = req.headers['x-forwarded-for'];
  if (!header) return socketIp;
  const first = String(header).split(',')[0].trim();
  return normalize(first) || socketIp;
}

function normalize(value) {
  if (!value) return '';
  // Strip IPv4-mapped IPv6 prefix (::ffff:127.0.0.1 -> 127.0.0.1) and reject anything that isn't a plausible address token.
  const stripped = value.replace(/^::ffff:/, '');
  return /^[a-fA-F0-9:.]{1,64}$/.test(stripped) ? stripped : '';
}
