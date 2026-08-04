import crypto from 'node:crypto';

// Compare fixed-size digests so configured credentials are never checked with ordinary string
// equality. The caller still owns request-size limits; non-strings and an empty configured secret
// always fail closed.
export function credentialMatches(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  const candidateDigest = crypto.createHash('sha256').update(candidate, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(candidateDigest, expectedDigest);
}
