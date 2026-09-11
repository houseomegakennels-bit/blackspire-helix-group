// Metadata stays outside the strict public capability result schema. The worker
// persists it only with the same successful authority-fenced finalization.
const observations = new WeakMap();
const keys = ['version','releaseSha','transport','requests','responseBytes','forbiddenAttempts','latencyMs','scope'];
export function decodeObservedResponse(text, response, route, expectedAuthorityBinding = null) {
  const result = JSON.parse(text);
  const authorityBinding = response.headers.get('x-blackspire-authority-binding');
  if (expectedAuthorityBinding && authorityBinding !== expectedAuthorityBinding) throw new Error('Capability receiver authority binding rejected');
  const header = response.headers.get('x-zola-read-observation');
  if (header === null) return result; // Older receiver: acceptance cannot infer observation.
  try {
    if (header.length > 1024 || !result || typeof result !== 'object') throw new Error();
    const value = JSON.parse(header);
    if (!value || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value,k)) ||
        value.version !== 1 || !(value.releaseSha === null || (typeof value.releaseSha === 'string' && /^[a-f0-9]{40}$/.test(value.releaseSha))) ||
        value.transport !== 'bounded PostgREST GET/HEAD' || value.scope !== 'supplied read client only' || value.forbiddenAttempts !== 0 ||
        !Number.isSafeInteger(value.requests) || value.requests < 1 || value.requests > 12 ||
        !Number.isSafeInteger(value.responseBytes) || value.responseBytes < 0 || value.responseBytes > 2*1024*1024 ||
        !Number.isSafeInteger(value.latencyMs) || value.latencyMs < 0 || value.latencyMs > 11000 ||
        !/^\/api\/internal\/capabilities\/(seller-opportunities|buyer-profiles|deal-records|deal-analysis|nexus-enrichment)$/.test(route)) throw new Error();
    observations.set(result, Object.freeze({ ...value, route, ...(authorityBinding ? { receiverAuthorityDigest: authorityBinding } : {}) }));
    return result;
  } catch { throw new Error('Capability read observation rejected'); }
}
export function observationForResult(result) { return observations.get(result) ?? null; }
