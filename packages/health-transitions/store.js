export class MemoryHealthTransitionStore {
  #latest = new Map(); #events = [];
  constructor(snapshot = null) {
    if (!snapshot) return;
    if (snapshot.version !== 1 || !Array.isArray(snapshot.latest) || !Array.isArray(snapshot.events)) throw new Error('invalid health transition snapshot');
    for (const [key, value] of snapshot.latest) this.#latest.set(key, Object.freeze(structuredClone(value)));
    this.#events = snapshot.events.map((event) => Object.freeze(structuredClone(event)));
  }
  static key(environment, workspaceId, component) { return `${environment}\u0000${workspaceId}\u0000${component}`; }
  latest(environment, workspaceId, component) { return this.#latest.get(MemoryHealthTransitionStore.key(environment, workspaceId, component)) || null; }
  setLatest(observation) { this.#latest.set(MemoryHealthTransitionStore.key(observation.environment, observation.workspaceId, observation.component), Object.freeze(structuredClone(observation))); }
  append(event) { const immutable = Object.freeze(structuredClone(event)); this.#events.push(immutable); return immutable; }
  current(environment, workspaceId) { return [...this.#latest.values()].filter((item) => item.environment === environment && item.workspaceId === workspaceId).sort((a,b) => a.component.localeCompare(b.component)); }
  events(environment, workspaceId) { return this.#events.filter((item) => item.environment === environment && item.workspaceId === workspaceId); }
  snapshot() { return { version: 1, latest: [...this.#latest.entries()].map(([key,value]) => [key, structuredClone(value)]), events: this.#events.map((event) => structuredClone(event)) }; }
}
