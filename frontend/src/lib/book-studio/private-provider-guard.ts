import { AsyncLocalStorage } from "node:async_hooks";
// Scoped to the private operator run, never derived from browser-supplied metadata.
const guard = new AsyncLocalStorage<() => Promise<unknown>>();
export function withPrivateProviderGuard<T>(check: () => Promise<unknown>, work: () => Promise<T>) {
  return guard.run(check, work);
}
export async function checkPrivateProviderApproval() { await guard.getStore()?.(); }
export function privateProviderRun() { return Boolean(guard.getStore()); }
