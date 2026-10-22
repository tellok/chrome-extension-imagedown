// Keep the latest complete selection, including cards hidden by filters.
export function createSelectionHighlights() {
  let port, scheduled = false, renewal, retry, closed = false, sequence = 0, fingerprint = '', latest = null;
  function disconnect() {
    const previous = port; port = null; fingerprint = '';
    try { previous?.disconnect(); } catch { /* The extension context may have ended. */ }
  }
  function send() {
    scheduled = false;
    if (closed || !latest) return;
    const next = JSON.stringify(latest);
    if (next === fingerprint) return;
    try {
      if (!port) {
        if (!latest.origins.length) { fingerprint = next; return; }
        const connected = chrome.runtime.connect({ name: 'selected-source-images' }); port = connected;
        connected.onMessage.addListener(message => {
          if (message?.operation === 'resync' && port === connected) { disconnect(); schedule(); }
        });
        connected.onDisconnect.addListener(() => {
          if (port !== connected) return;
          port = null; fingerprint = '';
          if (!closed && latest?.origins.length) retry = setTimeout(schedule, 500);
        });
      }
      port.postMessage({ ...latest, operation: 'update', sequence: ++sequence });
      if (!latest.origins.length) disconnect();
      fingerprint = next;
    } catch { disconnect(); if (!closed) retry = setTimeout(schedule, 500); }
  }
  function schedule() {
    if (closed || scheduled) return;
    scheduled = true;
    // Selection changes must reach the worker even when this view is hidden.
    queueMicrotask(send);
  }
  function renew() {
    if (closed || !port || !latest?.origins.length) return;
    try { port.postMessage({ operation: 'renew', sequence }); } catch { disconnect(); schedule(); }
  }
  function update(tabId, items) {
    if (closed) return;
    if (!Number.isInteger(tabId)) { clear(); return; }
    const origins = items.flatMap(item => item.origins || []).map(({ documentId, id }) => ({ documentId, id }));
    origins.sort((a, b) => a.documentId.localeCompare(b.documentId) || a.id.localeCompare(b.id));
    if (origins.length && !renewal) renewal = setInterval(renew, 5000);
    if (!origins.length) { clearInterval(renewal); renewal = null; }
    latest = { tabId, origins }; schedule();
  }
  function clear() { latest = null; scheduled = false; clearInterval(renewal); renewal = null; clearTimeout(retry); disconnect(); }
  function dispose() { closed = true; clear(); clearInterval(renewal); clearTimeout(retry); }
  return { update, clear, dispose };
}
