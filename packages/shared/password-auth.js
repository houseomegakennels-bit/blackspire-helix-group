import crypto from 'node:crypto';

export const PASSWORD_MIN_LENGTH = 13;
export const PASSWORD_MAX_LENGTH = 128;
const PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64 });

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
