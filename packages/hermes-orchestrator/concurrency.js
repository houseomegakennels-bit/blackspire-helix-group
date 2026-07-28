// Hermes in-process concurrency limiter (Milestone 2).
//
// A per-provider counting gate so a real provider cannot exceed its configured concurrency limit
// within this process. Fail-closed: when the limit is reached, acquire() returns null and the
// caller must refuse (never queue unboundedly, never silently downgrade). Single-process only —
// cross-host limiting is deferred (the runtime is single-host, documented in known limitations).
const active = new Map();

/** @returns {{release:()=>void}|null} a handle when a slot was acquired, else null (at capacity). */
export function acquire(provider, limit) {
  const current = active.get(provider) || 0;
  if (current >= limit) return null;
  active.set(provider, current + 1);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      active.set(provider, Math.max(0, (active.get(provider) || 1) - 1));
    },
  };
}

export function activeCount(provider) { return active.get(provider) || 0; }
