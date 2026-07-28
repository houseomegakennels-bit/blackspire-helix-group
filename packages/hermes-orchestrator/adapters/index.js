// Adapter resolver (Milestone 2).
//
// Maps a provider id to its adapter instance. Hermes resolves adapters here rather than hardcoding
// provider branches in the executor. Tests inject a fake adapter via `overrides` so the normal
// suite never performs a paid call.
import { createMockAdapter } from './mock.js';
import { createAnthropicDevAdapter } from './anthropic-dev.js';

/**
 * @param {string} providerId
 * @param {Object} [opts]
 * @param {Object} [opts.overrides]  { [providerId]: adapter } — test injection
 * @param {Object} [opts.deps]       forwarded to real adapters (fetchImpl, env)
 * @returns {{id:string, adapterType:string, execute:Function}|null}
 */
export function resolveAdapter(providerId, opts = {}) {
  if (opts.overrides && opts.overrides[providerId]) return opts.overrides[providerId];
  switch (providerId) {
    case 'mock': return createMockAdapter();
    case 'anthropic': return createAnthropicDevAdapter(opts.deps || {});
    default: return null;
  }
}
