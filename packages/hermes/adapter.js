import { mockHermesResponse, validateHermesRequest, validateHermesResponse } from './contract.js';

export async function dispatchHermes(request, { env = process.env, fetchImpl = fetch, allowedProviders = ['mock'] } = {}) {
  validateHermesRequest(request);
  const mode = env.BLACKSPIRE_HERMES_MODE || 'mock';
  let raw;
  if (mode === 'mock') raw = mockHermesResponse(request);
  else if (mode === 'restricted-test') {
    const endpoint = new URL(env.RESTRICTED_HERMES_URL || '');
    if (!['127.0.0.1','localhost','::1'].includes(endpoint.hostname) || endpoint.protocol !== 'http:') throw new Error('restricted Hermes must be credential-free loopback HTTP');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Date.parse(request.deadline) - Date.now()));
    try {
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
      raw = await response.text();
      if (!response.ok) throw new Error(`restricted Hermes failed with HTTP ${response.status}`);
    } finally { clearTimeout(timer); }
  } else throw new Error('Hermes mode is not explicitly allowed');
  return validateHermesResponse(raw, request, { allowedProviders });
}
