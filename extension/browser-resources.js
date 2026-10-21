export async function browserResources(tabId, items) {
  const candidates = items.filter(item => item.kind !== 'canvas' && /^https?:\/\//.test(item.url));
  if (!candidates.length) return [];
  try {
    const result = await chrome.runtime.sendMessage({ type: 'read-browser-resources', tabId,
      items: candidates.map(({ key, url, origins }) => ({ key, url, origins })),
    });
    return Array.isArray(result?.items) ? result.items : [];
  } catch { return []; }
}

export async function cachedBrowserResource(tabId, item) {
  if (!item.browserData || !item.browserOrigin) return null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [item.browserOrigin.documentId] },
      func: (id, url) => globalThis.__imageTaken?.resource(id)?.url === url,
      args: [item.browserOrigin.id, item.url],
    });
    return result?.documentId === item.browserOrigin.documentId && result.result ? item.browserData : null;
  } catch { return null; }
}
