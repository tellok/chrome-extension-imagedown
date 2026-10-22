
import { object } from "./guards.js";
interface HighlightEntry { session: string; tabId: number; documentId: string }
export const HIGHLIGHT_PORT = 'selected-source-images';

// The queue serializes teardown with in-flight injections. Revision checks also
// discard work superseded while renderer initialization was awaiting Chrome.
export function createHighlightCoordinator({ runtime, executeScript, uuid = () => crypto.randomUUID(), log = (error: unknown) => console.debug("ImageTaken source highlight:", error instanceof Error ? error.message : String(error)) }: { runtime: Pick<typeof chrome.runtime, "id" | "getURL">; executeScript: typeof chrome.scripting.executeScript; uuid?: () => string; log?: (error: unknown) => void }) {
  return function connect(port: chrome.runtime.Port) {
    if (port.name !== HIGHLIGHT_PORT || port.sender?.id !== runtime.id || port.sender?.url?.split('?')[0] !== runtime.getURL('panel.html')) return false;
    let closed = false, sequence = -1, tabId: number | null = null, queue = Promise.resolve();
    const documents = new Map<string, HighlightEntry>();
    const enqueue = (operation: () => Promise<void>) => { queue = queue.then(operation).catch(log); return queue; };
    async function send(entry: HighlightEntry, operation: string, revision: number, ids: string[] = []) {
      const message = { session: entry.session, sequence: revision, operation, ids };
      const [response] = await executeScript({ target: { tabId: entry.tabId, documentIds: [entry.documentId] },
        func: (value) => globalThis.__imageTakenHighlights?.receive(value), args: [message] });
      return response?.result === true;
    }
    async function release(entry: HighlightEntry) {
      try { await send(entry, 'release', Math.max(sequence, 0)); }
      catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); log(error); } // Navigation may already have destroyed it.
    }
    function groups(message: Record<string, unknown>) {
      if (typeof message.tabId !== 'number' || !Number.isInteger(message.tabId) || message.tabId < 0 || !Array.isArray(message.origins)) return null;
      const result = new Map<string, Set<string>>();
      for (const origin of message.origins) {
        if (!origin || typeof origin.documentId !== 'string' || !origin.documentId || typeof origin.id !== 'string' || !/^\d+:\d+$/.test(origin.id)) return null;
        if (!result.has(origin.documentId)) result.set(origin.documentId, new Set());
        result.get(origin.documentId)?.add(origin.id);
      }
      return result;
    }
    port.onMessage.addListener((message: unknown) => { if (!object(message)) return;
      if (closed || !message || typeof message.sequence !== 'number' || !Number.isSafeInteger(message.sequence) || message.sequence < 0) return;
      if (message.operation === 'renew') {
        if (message.sequence !== sequence) return;
        const revision = sequence;
        void enqueue(async () => {
          if (closed || revision !== sequence) return;
          for (const entry of documents.values()) {
            if (closed || revision !== sequence) return;
            try {
              if (!await send(entry, 'renew', revision) && !closed && revision === sequence) port.postMessage({ operation: 'resync' });
            } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); log(error); }
          }
        });
        return;
      }
      if (message.operation !== 'update' || message.sequence <= sequence) return;
      const desired = groups(message);
      if (!desired) return;
      sequence = message.sequence;
      const revision = sequence, nextTab = message.tabId; if (typeof nextTab !== 'number') return;
      void enqueue(async () => {
        if (closed || revision !== sequence) return;
        for (const [id, entry] of documents) if (tabId !== nextTab || !desired.has(id)) { documents.delete(id); await release(entry); }
        tabId = nextTab;
        for (const [documentId, ids] of desired) {
          if (closed || revision !== sequence) return;
          let entry = documents.get(documentId);
          try {
            if (!entry) {
              entry = { documentId, tabId: nextTab, session: uuid() }; documents.set(documentId, entry);
              await executeScript({ target: { tabId: nextTab, documentIds: [documentId] }, files: ['source-highlights.js'] });
            }
            if (closed || revision !== sequence) return;
            if (!entry) continue; const accepted = await send(entry, 'update', revision, [...ids]);
            if (!accepted && !closed && revision === sequence) port.postMessage({ operation: 'resync' });
          } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); log(error); }
        }
      });
    });
    port.onDisconnect.addListener(() => {
      closed = true;
      void enqueue(async () => { await Promise.allSettled([...documents.values()].map(release)); documents.clear(); });
    });
    return true;
  };
}

export function registerSourceHighlights() {
  const connect = createHighlightCoordinator({ runtime: chrome.runtime, executeScript: (options) => chrome.scripting.executeScript(options) });
  chrome.runtime.onConnect.addListener(connect);
}
