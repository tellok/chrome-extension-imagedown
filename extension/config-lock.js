// Shared by extension windows and its service worker. Never hold while fetching.
export function withConfigLock(operation) {
  return globalThis.navigator?.locks ? navigator.locks.request('imagetaken-config-write', operation) : operation();
}
export const saveConfig = values => withConfigLock(() => chrome.storage.local.set(values));
export const removeConfig = keys => withConfigLock(() => chrome.storage.local.remove(keys));
