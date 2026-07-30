// Canonical serialization and content digests.
//
// This is the single implementation used by every Blackspire evidence digest. Milestone 3A pinned
// its provenance digests with exactly this algorithm, so the bodies of `canonicalJson` and `digest`
// here are byte-for-byte the ones that produced every stored
// `hermes_outcome_evaluations.provenance_digest`. Changing either retroactively invalidates
// persisted evidence and must never be done casually. `canonicalTimestamp` below is the one
// exception to the byte-for-byte claim: it is a validator that no digest is computed over, and it
// was deliberately tightened with a four-digit-year anchor when 3A's and 3B's copies were merged.
//
// Object keys are sorted so key insertion order cannot change a digest. Array order is deliberately
// preserved and therefore load-bearing: any caller that hashes a collection must sort it explicitly
// into a total order first.
import crypto from 'node:crypto';

export function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`; return JSON.stringify(value); }

export function digest(value) { return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex'); }

// `canonicalJson` inherits JSON.stringify's lossy cases: `undefined` and functions serialize to the
// bare token `undefined`, NaN/Infinity collapse to `null`, and -0 becomes 0. Evidence packets must
// therefore be proven to contain only exactly-representable values before they are hashed, so a
// malformed packet fails closed instead of hashing to a stable but meaningless digest.
export function digestibleValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.every(digestibleValue);
  return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every(digestibleValue);
}

// A canonical timestamp is a fixed-width ISO-8601 UTC string that round-trips exactly through
// `toISOString()`. The four-digit-year anchor is load-bearing and not redundant: `toISOString()`
// round-trips the *extended* form for years outside 1000-9999 (`-000001-01-01T00:00:00.000Z`), which
// would otherwise validate and then sort outside every real range - selecting nothing instead of
// refusing. Shared so Milestone 3A and 3B cannot drift into two different notions of canonical.
export function canonicalTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
