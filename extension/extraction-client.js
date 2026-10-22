import { captureArchive } from './mhtml.js';
let port, sequence = 0;
const pending = new Map();
const listeners = new Set();
function connection() {
  if (port) return port;
  const current = chrome.runtime.connect({ name: 'image-extraction' });
  port = current;
  current.onMessage.addListener(message => {
    if (message.type === 'capture') {
      void captureArchive(message.tabId).then(parts => current.postMessage({ type: 'captured', id: message.id, parts }),
        error => current.postMessage({ type: 'captured', id: message.id, error: error.message })).catch(() => {});
    } else if (message.type === 'event') {
      for (const listener of listeners) listener(message);
    } else {
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(message.error)) : request.resolve(message.result); }
    }
  });
  current.onDisconnect.addListener(() => {
    if (port === current) port = null;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Extraction disconnected')); }
    pending.clear();
  });
  return current;
}
export function extractionCall(operation, values = {}) {
  const current = connection(), id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Extraction timed out')); }, 65000);
    pending.set(id, { resolve, reject, timer });
    current.postMessage({ type: 'request', id, operation, ...values });
  });
}
export function onExtractionEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function disconnectExtraction() { port?.disconnect(); port = null; }
if (typeof window !== 'undefined') window.addEventListener('pagehide', disconnectExtraction);
