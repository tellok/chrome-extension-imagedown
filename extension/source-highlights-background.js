export const HIGHLIGHT_PORT = 'selected-source-images';

// The queue serializes teardown with in-flight injections. Revision checks also
// discard work superseded while renderer initialization was awaiting Chrome.
export function createHighlightCoordinator({ runtime, executeScript, uuid = () => crypto.randomUUID(), log = error => console.debug('ImageTaken source highlight:', error.message) }) {
  return function connect(port) {
    if (port.name !== HIGHLIGHT_PORT || port.sender?.id !== runtime.id || port.sender?.url?.split('?')[0] !== runtime.getURL('panel.html')) return false;
    let closed = false, sequence = -1, tabId = null, queue = Promise.resolve();
    const documents = new Map();
    const enqueue = operation => { queue = queue.then(operation).catch(log); return queue; };
    async function send(entry, operation, revision, ids = []) {
      const message = { session: entry.session, sequence: revision, operation, ids };
      const [response] = await executeScript({ target: { tabId: entry.tabId, documentIds: [entry.documentId] },
        func: value => globalThis.__imageTakenHighlights?.receive(value), args: [message] });
      return response?.result === true;
    }
    async function release(entry) {
      try { await send(entry, 'release', Math.max(sequence, 0)); }
      catch (error) { log(error); } // Navigation may already have destroyed it.
    }
    function groups(message) {
      if (!Number.isInteger(message.tabId) || message.tabId < 0 || !Array.isArray(message.origins)) return null;
      const result = new Map();
      for (const origin of message.origins) {
        if (!origin || typeof origin.documentId !== 'string' || !origin.documentId || typeof origin.id !== 'string' || !/^\d+:\d+$/.test(origin.id)) return null;
        if (!result.has(origin.documentId)) result.set(origin.documentId, new Set());
        result.get(origin.documentId).add(origin.id);
      }
      return result;
    }
    port.onMessage.addListener(message => {
      if (closed || !message || !Number.isSafeInteger(message.sequence) || message.sequence < 0) return;
      if (message.operation === 'renew') {
        if (message.sequence !== sequence) return;
        const revision = sequence;
        void enqueue(async () => {
          if (closed || revision !== sequence) return;
          for (const entry of documents.values()) {
            if (closed || revision !== sequence) return;
            try {
              if (!await send(entry, 'renew', revision) && !closed && revision === sequence) port.postMessage({ operation: 'resync' });
            } catch (error) { log(error); }
          }
        });
        return;
      }
      if (message.operation !== 'update' || message.sequence <= sequence) return;
      const desired = groups(message);
      if (!desired) return;
      sequence = message.sequence;
      const revision = sequence, nextTab = message.tabId;
      void enqueue(async () => {
        if (closed || revision !== sequence) return;
        for (const [id, entry] of documents) if (tabId !== nextTab || !desired.has(id)) { documents.delete(id); await release(entry); }
        tabId = nextTab;
        for (const [documentId, ids] of desired) {
          if (closed || revision !== sequence) return;
          let entry = documents.get(documentId);
          try {
            if (!entry) {
              entry = { documentId, tabId, session: uuid() }; documents.set(documentId, entry);
              await executeScript({ target: { tabId, documentIds: [documentId] }, files: ['source-highlights.js'] });
            }
            if (closed || revision !== sequence) return;
            const accepted = await send(entry, 'update', revision, [...ids]);
            if (!accepted && !closed && revision === sequence) port.postMessage({ operation: 'resync' });
          } catch (error) { log(error); }
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
  const connect = createHighlightCoordinator({ runtime: chrome.runtime, executeScript: options => chrome.scripting.executeScript(options) });
  chrome.runtime.onConnect.addListener(connect);
}
