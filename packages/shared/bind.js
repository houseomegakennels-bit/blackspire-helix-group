import net from 'node:net';

// Canonical bind/port contract for every Blackspire Command listener.
//
// One module decides the host and port so the supervisor, the API server, environment
// verification, the systemd preflight, monitoring, and the proxy template can never disagree.
// The durable VPS runtime is loopback-only and must never fall back to a default port: the
// existing Docker API owns 8787 and restricted staging owns 127.0.0.1:8788, so a silent
// default would collide with a healthy listener.

export const PRODUCTION_BIND_HOST = '127.0.0.1';

// The state owner names which environment owns the persisted state. It is the authoritative
// profile marker: the restricted staging profile deliberately runs with NODE_ENV=production and
// BLACKSPIRE_RUNTIME_MODE=production for hardened behavior, while owning staging state on 8788.
export const PRODUCTION_STATE_OWNER = 'vps-production';
export const STAGING_STATE_OWNER = 'vps-staging';

// Restricted staging is loopback-only by design, so it resolves the same private host as
// production rather than depending on its launcher passing one.
export const STAGING_BIND_HOST = '127.0.0.1';

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
 * Read the declared state owner, trimmed. Returns '' when it is absent or blank.
 */
export function stateOwner(env = process.env) {
  return typeof env.BLACKSPIRE_STATE_OWNER === 'string' ? env.BLACKSPIRE_STATE_OWNER.trim() : '';
}

/**
 * The durable VPS production profile.
 *
 * An explicit state owner is authoritative and outranks the runtime mode. Restricted staging runs
 * with NODE_ENV=production and BLACKSPIRE_RUNTIME_MODE=production on purpose while declaring
 * BLACKSPIRE_STATE_OWNER=vps-staging, so treating the runtime mode as decisive misclassified
 * staging as production and rejected both its absent BIND_HOST and its own port 8788.
 *
 * Only an absent or blank owner lets BLACKSPIRE_RUNTIME_MODE=production decide, which keeps a
 * partially-populated production environment fail-closed.
 *
 * An unrecognized owner is not production here, and it is never silently authorized either: the
 * production runtime independently requires the owner to be exactly vps-production, in
 * scripts/verify-environment.sh (the systemd ExecStartPre) and in verifyVpsRuntime (the
 * supervisor's own precondition), so an unknown owner fails closed before any listener is created.
 */
export function isProductionProfile(env = process.env) {
  const owner = stateOwner(env);
  if (owner !== '') return owner === PRODUCTION_STATE_OWNER;
  return env.BLACKSPIRE_RUNTIME_MODE === 'production';
}

/**
 * The restricted staging profile: loopback-only on its own reserved port, never production.
 */
export function isStagingProfile(env = process.env) {
  return stateOwner(env) === STAGING_STATE_OWNER;
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
    const explicitHost = env.BIND_HOST === undefined || env.BIND_HOST === '' ? undefined : String(env.BIND_HOST);
    // Restricted staging resolves the private loopback host itself when none is given, so its
    // boundary no longer depends on the launcher remembering to pass one. Development keeps its
    // historical undefined host. Neither profile is subject to the production reserved-port rule:
    // 8788 belongs to staging.
    const host = explicitHost === undefined && isStagingProfile(env) ? STAGING_BIND_HOST : explicitHost;
    return { ok: true, production: false, staging: isStagingProfile(env), host, port: Number(env.PORT || DEVELOPMENT_DEFAULT_PORT), errors: [] };
  }
  const hostResult = validateProductionHost(env.BIND_HOST);
  const portResult = validateProductionPort(env.PORT);
  const errors = [...hostResult.errors, ...portResult.errors];
  return { ok: errors.length === 0, production: true, staging: false, host: hostResult.host, port: portResult.port, errors };
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
