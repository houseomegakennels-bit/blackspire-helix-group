import crypto from 'node:crypto';

export const PASSWORD_MIN_LENGTH = 13;
export const PASSWORD_MAX_LENGTH = 128;
const PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64 });
export const PASSWORD_DERIVATION_CONCURRENCY = 4;

export function createPasswordDerivationLimiter(limit = PASSWORD_DERIVATION_CONCURRENCY) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Password derivation limit must be a positive integer.');
  let active = 0;
  let poisoned = false;
  const stateIsValid = () => Number.isSafeInteger(active) && active >= 0 && active <= limit;
  return Object.freeze({
    get active() { return active; },
    get limit() { return limit; },
    tryAcquire() {
      // An impossible counter state must never create more expensive work. Once observed,
      // keep this process-local boundary closed instead of attempting to repair capacity.
      if (poisoned || !stateIsValid()) {
        poisoned = true;
        return null;
      }
      if (active >= limit) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (poisoned || !stateIsValid() || active < 1) {
          poisoned = true;
          return;
        }
        active -= 1;
        if (!stateIsValid()) poisoned = true;
      };
    },
  });
}

// One module instance owns capacity for the whole API process. Admission is immediate:
// excess work is never queued in JavaScript or handed to libuv's worker pool.
const passwordDerivationLimiter = createPasswordDerivationLimiter();

export function validPasswordInput(value) {
  return typeof value === 'string' && value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;
}

export function hashAdminPassword(password, salt = crypto.randomBytes(16)) {
  if (!validPasswordInput(password)) throw new Error(`Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters.`);
  const derived = crypto.scryptSync(password, salt, PARAMS.keyLength, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 32 * 1024 * 1024 });
  return `v1$scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64url')}$${derived.toString('base64url')}$p13-128`;
}

export function parseAdminPasswordHash(encoded) {
  if (typeof encoded !== 'string') return null;
  const parts = encoded.split('$');
  if (parts.length !== 8 || parts[0] !== 'v1' || parts[1] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(2, 5).map(Number);
  if (N !== PARAMS.N || r !== PARAMS.r || p !== PARAMS.p || parts[7] !== 'p13-128') return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(parts[5]) || !/^[A-Za-z0-9_-]+$/.test(parts[6])) return null;
    const salt = Buffer.from(parts[5], 'base64url');
    const derived = Buffer.from(parts[6], 'base64url');
    if (salt.length !== 16 || derived.length !== PARAMS.keyLength) return null;
    return { salt, derived, N, r, p };
  } catch { return null; }
}

export function verifyAdminPassword(password, encoded) {
  if (!validPasswordInput(password)) return false;
  const parsed = parseAdminPasswordHash(encoded);
  if (!parsed) return false;
  const candidate = crypto.scryptSync(password, parsed.salt, parsed.derived.length, { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: 32 * 1024 * 1024 });
  return crypto.timingSafeEqual(candidate, parsed.derived);
}

export async function verifyAdminPasswordAsyncResult(password, encoded, options = {}) {
  if (!validPasswordInput(password)) return { status: 'invalid' };
  const parsed = parseAdminPasswordHash(encoded);
  if (!parsed) return { status: 'invalid' };
  const scrypt = options.scrypt ?? crypto.scrypt;
  const limiter = options.limiter ?? passwordDerivationLimiter;
  const release = limiter.tryAcquire();
  if (!release) return { status: 'overloaded' };
  try {
    const candidate = await new Promise((resolve, reject) => {
      scrypt(password, parsed.salt, parsed.derived.length, { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: 32 * 1024 * 1024 }, (error, value) => {
        if (error) reject(error);
        else resolve(value);
      });
    });
    const verified = Buffer.isBuffer(candidate)
      && candidate.length === parsed.derived.length
      && crypto.timingSafeEqual(candidate, parsed.derived);
    return { status: verified ? 'verified' : 'invalid' };
  } catch {
    return { status: 'invalid' };
  } finally {
    release();
  }
}

export async function verifyAdminPasswordAsync(password, encoded, scrypt = crypto.scrypt) {
  const result = await verifyAdminPasswordAsyncResult(password, encoded, { scrypt });
  return result.status === 'verified';
}
