import net from 'node:net';

// Canonical bind/port contract for every Blackspire Command listener.
//
// One module decides the host and port so the supervisor, the API server, environment
// verification, the systemd preflight, monitoring, and the proxy template can never disagree.
// The durable VPS runtime is loopback-only and must never fall back to a default port: the
// existing Docker API owns 8787 and restricted staging owns 127.0.0.1:8788, so a silent
// default would collide with a healthy listener.

export const PRODUCTION_BIND_HOST = '127.0.0.1';

// Ports owned by listeners this repository must never take over or shut down.
export const PROTECTED_PORTS = Object.freeze([8787, 8788]);

// Reviewed production candidates, in preference order. 8789 is preferred; the rest are
// fallbacks selected only after a read-only probe confirms the earlier candidates are busy.
export const PRODUCTION_PORT_CANDIDATES = Object.freeze([8789, 8790, 8791, 8792, 8793, 8794, 8795, 8796, 8797, 8798, 8799]);

export const MIN_UNPRIVILEGED_PORT = 1024;
export const MAX_PORT = 65535;

// Development keeps its historical default so local and disposable test startup is unchanged.
export const DEVELOPMENT_DEFAULT_PORT = 8787;

// Explicit decimal only: no whitespace, sign, leading zero, hex, float, or exponent form.
const EXPLICIT_PORT = /^[1-9][0-9]{0,4}$/;

/**
 * The durable VPS production profile. Either marker is sufficient: the systemd unit sets both,
 * and treating a partially-populated production environment as production keeps it fail-closed.
 */
export function isProductionProfile(env = process.env) {
  return env.BLACKSPIRE_RUNTIME_MODE === 'production' || env.BLACKSPIRE_STATE_OWNER === 'vps-production';
}

/**
 * Validate a production PORT value. Returns { ok, port, errors }; `port` is null unless valid.
 * Rejects missing, malformed, privileged, out-of-range, and protected ports. Never defaults.
 */
export function validateProductionPort(value) {
  const errors = [];
  if (value === undefined || value === null || String(value).trim() === '') {
    errors.push('PORT must be set explicitly for the production runtime; there is no default and no fallback to 8787.');
    return { ok: false, port: null, errors };
  }
  const raw = String(value);
  if (!EXPLICIT_PORT.test(raw)) {
    errors.push('PORT must be an explicit decimal integer with no whitespace, sign, or leading zero.');
    return { ok: false, port: null, errors };
  }
  const port = Number(raw);
  if (port > MAX_PORT) {
    errors.push(`PORT must be no greater than ${MAX_PORT}.`);
    return { ok: false, port: null, errors };
  }
  if (port < MIN_UNPRIVILEGED_PORT) {
    errors.push(`PORT must be an unprivileged port (>= ${MIN_UNPRIVILEGED_PORT}); the production runtime holds no binding capabilities.`);
    return { ok: false, port: null, errors };
  }
  if (PROTECTED_PORTS.includes(port)) {
    errors.push(`PORT ${port} is reserved by an existing healthy listener and must not be used by the production runtime.`);
    return { ok: false, port: null, errors };
  }
  return { ok: true, port, errors };
}

/**
 * Validate a production BIND_HOST value. The production application port is loopback-only and
 * is never opened publicly, so exactly one canonical value is accepted.
 */
export function validateProductionHost(value) {
  const errors = [];
  if (value === undefined || value === null || String(value).trim() === '') {
    errors.push(`BIND_HOST must be set to ${PRODUCTION_BIND_HOST} for the production runtime.`);
    return { ok: false, host: null, errors };
  }
  const host = String(value);
  if (host === PRODUCTION_BIND_HOST) return { ok: true, host, errors };
  if (host === '0.0.0.0' || host === '::' || host === '*') {
    errors.push('BIND_HOST must not be a wildcard address; the production runtime binds loopback only.');
  } else {
    errors.push(`BIND_HOST must be exactly ${PRODUCTION_BIND_HOST}; non-loopback and alternate addresses are rejected.`);
  }
  return { ok: false, host: null, errors };
}

/**
 * The single source of truth consumed by the supervisor and by apps/api/server.js.
 * In production both values are required and validated; outside production the historical
 * development and restricted-staging behavior is preserved unchanged.
 */
export function resolveBindTarget(env = process.env) {
  const production = isProductionProfile(env);
  if (!production) {
    const host = env.BIND_HOST === undefined || env.BIND_HOST === '' ? undefined : String(env.BIND_HOST);
    return { ok: true, production: false, host, port: Number(env.PORT || DEVELOPMENT_DEFAULT_PORT), errors: [] };
  }
  const hostResult = validateProductionHost(env.BIND_HOST);
  const portResult = validateProductionPort(env.PORT);
  const errors = [...hostResult.errors, ...portResult.errors];
  return { ok: errors.length === 0, production: true, host: hostResult.host, port: portResult.port, errors };
}

/**
 * Read-only availability probe. Binds the candidate briefly and releases it; an occupied port
 * reports EADDRINUSE without the existing listener being contacted, signalled, or modified.
 */
export function probePortAvailable(host, port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    const settle = (free, code) => {
      probe.removeAllListeners();
      try { probe.close(); } catch { /* already closed */ }
      resolve({ free, code: code || null });
    };
    probe.once('error', (error) => settle(false, error.code));
    probe.once('listening', () => {
      probe.close(() => resolve({ free: true, code: null }));
    });
    // exclusive prevents SO_REUSEPORT-style sharing so a busy port is always reported busy.
    probe.listen({ host, port, exclusive: true });
  });
}

/**
 * Choose the future production port: 8789 when free, otherwise the first verified free
 * candidate through 8799. Protected ports are never candidates.
 */
export async function selectProductionPort({
  host = PRODUCTION_BIND_HOST,
  candidates = PRODUCTION_PORT_CANDIDATES,
  probe = probePortAvailable,
} = {}) {
  const checked = [];
  for (const port of candidates) {
    if (PROTECTED_PORTS.includes(port)) continue;
    const result = await probe(host, port);
    checked.push({ port, free: result.free, code: result.code });
    if (result.free) return { ok: true, host, port, checked, errors: [] };
  }
  return { ok: false, host, port: null, checked, errors: ['No candidate production port was free in the reviewed range.'] };
}
