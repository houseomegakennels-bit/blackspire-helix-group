import { defineCapability } from './contract.js';

export function createCapabilityRegistry(definitions = []) {
  const entries = new Map();
  for (const definition of definitions) {
    const capability = defineCapability(definition);
    if (entries.has(capability.id)) throw new Error(`duplicate capability id: ${capability.id}`);
    entries.set(capability.id, capability);
  }
  return Object.freeze({
    get(id) {
      if (typeof id !== 'string' || !entries.has(id)) throw new Error('unknown capability');
      return entries.get(id);
    },
    has: (id) => typeof id === 'string' && entries.has(id),
    list: () => [...entries.values()],
    ids: () => [...entries.keys()],
  });
}
