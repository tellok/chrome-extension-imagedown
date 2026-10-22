import { object, isImageData, isDiscoveredReference } from './guards.js';

import { captureArchive } from './mhtml.js';
let port: chrome.runtime.Port|null, sequence = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
const listeners = new Set<(event: { tabId: number; kind: string }) => void>();
function connection() {
  if (port) return port;
  const current = chrome.runtime.connect({ name: 'image-extraction' });
  port = current;
  current.onMessage.addListener((message: unknown) => { if (!object(message)) return;
    if (message.type === 'capture') { if (typeof message.tabId !== 'number') return;
      void captureArchive(message.tabId).then(parts => current.postMessage({ type: 'captured', id: message.id, parts }),
        error => current.postMessage({ type: 'captured', id: message.id, error: error.message })).catch(() => {});
    } else if (message.type === 'event') {
      if (typeof message.tabId === 'number' && typeof message.kind === 'string') for (const listener of listeners) listener({ tabId: message.tabId, kind: message.kind });
    } else {
      if (typeof message.id !== 'number') return; const request = pending.get(message.id);
      if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(String(message.error))) : request.resolve(message.result); }
    }
  });
  current.onDisconnect.addListener(() => {
    if (port === current) port = null;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Extraction disconnected')); }
    pending.clear();
  });
  return current;
}
export function extractionCall(operation: 'archive', values: Record<string, unknown>): Promise<import('./models.js').ImageData[]>;
export function extractionCall(operation: 'discover', values: Record<string, unknown>): Promise<import('./models.js').DiscoveredReference[]>;
export function extractionCall(operation: 'read', values: Record<string, unknown>): Promise<import('./models.js').ImageData>;
export function extractionCall(operation: 'subscribe', values: Record<string, unknown>): Promise<unknown>;
export function extractionCall(operation: string, values: Record<string, unknown> = {}): Promise<unknown> {
  const current = connection(), id = ++sequence;
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Extraction timed out')); }, 65000);
    pending.set(id, { resolve, reject, timer });
    current.postMessage({ type: 'request', id, operation, ...values });
  }).then(value => { if (operation === 'read' && !isImageData(value) || operation === 'archive' && !(Array.isArray(value) && value.every(isImageData)) || operation === 'discover' && !(Array.isArray(value) && value.every(isDiscoveredReference))) throw new Error('Invalid extraction result'); return value; });
}
export function onExtractionEvent(listener: (event: { tabId: number; kind: string }) => void) { listeners.add(listener); return () => listeners.delete(listener); }
export function disconnectExtraction() { port?.disconnect(); port = null; }
if (typeof window !== 'undefined') window.addEventListener('pagehide', disconnectExtraction);
