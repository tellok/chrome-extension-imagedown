import { reply, isImageData } from './guards.js';
import type { ImageItem } from "./models.js";
export async function browserResources(tabId: number, items: ImageItem[]) {
  const candidates = items.filter((item) => item.kind !== 'canvas' && /^https?:\/\//.test(item.url));
  if (!candidates.length) return [];
  try {
    const result = reply(await chrome.runtime.sendMessage({ type: 'read-browser-resources', tabId,
      items: candidates.map(({ key, url, origins }) => ({ key, url, origins })),
    }));
    return Array.isArray(result.items) ? result.items.filter(isImageData) : [];
  } catch { return []; }
}

// These bytes already belong to the extension. Source-document validation is
// required when acquiring them, not when saving them after navigation/closure.
export function cachedBrowserResource(item: ImageItem) {
  return item.browserDataURL === item.url ? item.browserData || null : null;
}
