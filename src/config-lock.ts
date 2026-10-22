// Shared by extension windows and its service worker. Never hold while fetching.
export async function withConfigLock<T>(operation: () => T | Promise<T>): Promise<T> {
  if (globalThis.navigator?.locks) return await navigator.locks.request('imagetaken-config-write', operation);
  return await operation();
}
export const saveConfig = (values: Record<string, unknown>) => withConfigLock(() => chrome.storage.local.set(values));
export const removeConfig = (keys: string | string[]) => withConfigLock(() => chrome.storage.local.remove(keys));
