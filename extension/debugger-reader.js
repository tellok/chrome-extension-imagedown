import { sourceContext, checkContext, loadEnhanced, ENHANCED_PREFIX } from './enhanced-mode.js';
// Runs in the extension worker. Each batch owns a short-lived debugger session;
// it never navigates, reloads, disables cache, or issues resource URL requests.
const MAX_FILE = 20 * 1024 * 1024;
const MAX_BATCH = 8 * 1024 * 1024;
const queues = new Map();
const sessions = new Map();
const cancelled = new Set();
const revisions = new Map();
const permissionRevisions = new Map();
const withoutHash = value => { const url = new URL(value); url.hash = ''; return url.href; };

async function validate(tabId, items) {
  const documents = new Map();
  for (const item of items) for (const origin of item.origins || []) {
    if (typeof origin.documentId !== 'string' || typeof origin.id !== 'string') continue;
    if (!documents.has(origin.documentId)) documents.set(origin.documentId, []);
    documents.get(origin.documentId).push({ key: item.key, url: item.url, id: origin.id });
  }
  const approved = new Map();
  for (const [documentId, candidates] of documents) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId, documentIds: [documentId] },
        func: candidates => candidates.flatMap(candidate => {
          const resource = globalThis.__imageTaken?.resource(candidate.id);
          return resource?.url === candidate.url ? [{ ...candidate, documentURL: location.href }] : [];
        }), args: [candidates],
      });
      if (result?.documentId !== documentId) continue;
      for (const candidate of result.result || []) {
        if (!approved.has(candidate.key)) approved.set(candidate.key, []);
        approved.get(candidate.key).push({ ...candidate, documentId });
      }
    } catch { /* Navigated or inaccessible source documents are not eligible. */ }
  }
  return approved;
}

function utf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

async function collect(session, target) {
  await chrome.debugger.sendCommand(target, 'Page.enable');
  const { frameTree } = await chrome.debugger.sendCommand(target, 'Page.getResourceTree');
  const walk = node => {
    for (const resource of node.resources || []) {
      if (resource.type === 'Image' && resource.mimeType?.startsWith('image/') && !resource.failed && !resource.canceled) {
        session.resources.push({ ...resource, frameId: node.frame.id, documentURL: node.frame.url, target });
      }
    }
    for (const child of node.childFrames || []) walk(child);
  };
  walk(frameTree);
  // Flat child sessions are supported on Chrome 125+. Older versions retain
  // main/same-process frame support and use the existing fallback elsewhere.
  try {
    await chrome.debugger.sendCommand(target, 'Target.setAutoAttach', {
      autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
      filter: [{ type: 'iframe', exclude: false }],
    });
  } catch { /* Unsupported protocol version or target. */ }
}

async function readBatch(tabId, items, retry = false, discover = false, revision = 0, permissions = new Map()) {
  if ((revisions.get(tabId) || 0) !== revision) return { items: [], unavailable: 'cancelled' };
  let context;
  try { context = await sourceContext(tabId); if (!await loadEnhanced(context.hostname)) return { items: [], resources: [], unavailable: 'disabled' }; }
  catch { return { items: [], resources: [], unavailable: 'permission-unavailable' }; }
  if ((permissions.get(context.hostname) || 0) !== (permissionRevisions.get(context.hostname) || 0)) return { items: [], unavailable: 'cancelled' };
  if (retry) cancelled.delete(tabId);
  if (cancelled.has(tabId)) return { items: [], unavailable: 'cancelled' };
  const approved = await validate(tabId, items);
  if (!approved.size && !discover) return { items: [] };
  const session = { context, resources: [], pending: [], closing: false, detached: false, owned: false };
  sessions.set(tabId, session);
  const timer = setTimeout(() => { void cancelBrowserTab(tabId); }, 20000);
  const target = { tabId };
  try {
    await checkContext(context);
    if (!await loadEnhanced(context.hostname) || session.detached || (revisions.get(tabId) || 0) !== revision) return { items: [] };
    await chrome.debugger.attach(target, '1.3');
    session.owned = true;
    if (session.detached || !await loadEnhanced(context.hostname) || (revisions.get(tabId) || 0) !== revision) {
      await chrome.debugger.detach(target).catch(() => {}); session.owned = false; return { items: [] };
    }
    await checkContext(context);
    broadcast(tabId, 'active');
    await collect(session, target);
    await new Promise(resolve => setTimeout(resolve, 0));
    for (let cursor = 0; cursor < session.pending.length; cursor++) await session.pending[cursor];
    const output = [];
    let total = 0;
    const budget = items.length === 1 ? MAX_FILE : MAX_BATCH;
    for (const item of items) {
      if (session.detached) break;
      const origins = approved.get(item.key) || [];
      const candidates = session.resources.filter(resource => withoutHash(resource.url) === withoutHash(item.url) &&
        origins.some(origin => withoutHash(origin.documentURL) === withoutHash(resource.documentURL)));
      for (const resource of candidates) {
        try {
          const body = await chrome.debugger.sendCommand(resource.target, 'Page.getResourceContent', { frameId: resource.frameId, url: resource.url });
          if (!body.content || body.content.length > Math.ceil(MAX_FILE * 4 / 3) + 4) continue;
          const encoded = body.base64Encoded ? body.content : utf8Base64(body.content);
          const bytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
          if (!bytes || bytes > MAX_FILE || total + bytes > budget) continue;
          // Recheck document identity after reading, guarding navigation races.
          const stillValid = await validate(tabId, [item]);
          const origin = (stillValid.get(item.key) || []).find(entry => withoutHash(entry.documentURL) === withoutHash(resource.documentURL));
          await checkContext(context);
          if (!origin || session.detached || !await loadEnhanced(context.hostname)) continue;
          output.push({ key: item.key, url: item.url, dataUrl: `data:${resource.mimeType};base64,${encoded}`, mime: resource.mimeType, bytes,
            origin: { id: origin.id, documentId: origin.documentId }, method: 'debugger-resource' });
          total += bytes;
          break;
        } catch { /* Resource may have been released; do not request its URL. */ }
      }
    }
    await checkContext(context);
    if (session.detached || !await loadEnhanced(context.hostname)) return { items: [] };
    return { items: output, resources: discover ? session.resources.slice(0, 4000).map(({ url, documentURL, mimeType }) => ({ url, documentURL, mime: mimeType })) : [] };
  } catch (error) {
    return { items: [], unavailable: error.message };
  } finally {
    clearTimeout(timer);
    broadcast(tabId, cancelled.has(tabId) ? 'stopped' : 'idle');
    session.closing = true;
    if (session.release) await session.release;
    else if (session.owned && !session.detached) await chrome.debugger.detach(target).catch(() => {});
    if (sessions.get(tabId) === session) sessions.delete(tabId);
  }
}

function broadcast(tabId, status) {
  void chrome.runtime.sendMessage({ type: 'enhanced-status', tabId, status }).catch(() => {});
}
export async function cancelBrowserTab(tabId) {
  revisions.set(tabId, (revisions.get(tabId) || 0) + 1);
  const session = sessions.get(tabId);
  if (!session) return;
  session.detached = true;
  session.closing = true;
  session.release = session.owned ? chrome.debugger.detach({ tabId }).catch(() => {}) : Promise.resolve();
  await session.release;
  broadcast(tabId, 'idle');
}
export function readBrowserBatch(tabId, items, retry = false, discover = false) {
  const revision = revisions.get(tabId) || 0, permissions = new Map(permissionRevisions);
  const operation = (queues.get(tabId) || Promise.resolve()).then(() => readBatch(tabId, items, retry, discover, revision, permissions));
  const settled = operation.catch(() => {}); queues.set(tabId, settled);
  operation.finally(() => { if (queues.get(tabId) === settled) queues.delete(tabId); }).catch(() => {});
  return operation;
}
export function registerDebuggerReader() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(changes)) if (key.startsWith(ENHANCED_PREFIX)) { const host = key.slice(ENHANCED_PREFIX.length); permissionRevisions.set(host, (permissionRevisions.get(host) || 0) + 1); }
    for (const [tabId, session] of sessions) if (changes[ENHANCED_PREFIX + session.context.hostname]?.newValue !== true && Object.hasOwn(changes, ENHANCED_PREFIX + session.context.hostname)) void cancelBrowserTab(tabId);
  });
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const session = sessions.get(source.tabId);
    if (!session || session.closing || method !== 'Target.attachedToTarget' || params.targetInfo?.type !== 'iframe') return;
    const target = { tabId: source.tabId, sessionId: params.sessionId };
    session.pending.push(collect(session, target).catch(() => {}));
  });
  chrome.debugger.onDetach.addListener(source => {
    const session = sessions.get(source.tabId);
    if (!session || session.closing) return;
    session.detached = true;
    cancelled.add(source.tabId);
    broadcast(source.tabId, 'stopped');
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'loading') { cancelled.delete(tabId); void cancelBrowserTab(tabId); } });
  chrome.tabs.onRemoved.addListener(tabId => { cancelled.delete(tabId); void cancelBrowserTab(tabId); });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'read-browser-resources') return;
    if (sender.id !== chrome.runtime.id || !sender.url || new URL(sender.url).origin !== new URL(chrome.runtime.getURL('')).origin || new URL(sender.url).pathname !== '/panel.html') return;
    const { tabId, items } = message;
    if (!Number.isInteger(tabId) || tabId < 0 || !Array.isArray(items) || items.length > 4000 || items.some(item =>
      typeof item.key !== 'string' || typeof item.url !== 'string' || !/^https?:\/\//.test(item.url) || !Array.isArray(item.origins) || item.origins.length > 1000)) {
      respond({ items: [], unavailable: 'invalid-request' }); return;
    }
    readBrowserBatch(tabId, items, message.retry === true).then(respond, error => respond({ items: [], unavailable: error.message }));
    return true;
  });
}
