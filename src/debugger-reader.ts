import type { ImageData, ResourceItem } from "./models.js";
import type { SourceContext } from "./enhanced-mode.js";
import { isResourceItem } from "./guards.js";
import { object } from "./guards.js";
interface CDPResource { type: string; mimeType: string; url: string; failed?: boolean; canceled?: boolean }
interface FrameTree { frame: { id: string; url: string }; resources?: CDPResource[]; childFrames?: FrameTree[] }
interface DebuggerResource extends CDPResource { frameId: string; documentURL: string; target: chrome.debugger.DebuggerSession }
interface DebuggerSession { context: SourceContext; resources: DebuggerResource[]; pending: Promise<void>[]; closing: boolean; detached: boolean; owned: boolean; release?: Promise<void> }
interface Approved { key: string; url: string; id: string; documentId: string; documentURL: string }
interface BatchResult { items: ImageData[]; resources?: { url: string; documentURL: string; mime: string }[]; unavailable?: string }
function isFrameTree(value: unknown): value is FrameTree { return object(value) && object(value.frame) && typeof value.frame.id === 'string' && typeof value.frame.url === 'string' && (value.resources === undefined || Array.isArray(value.resources) && value.resources.every((v: unknown) => object(v) && typeof v.type === 'string' && typeof v.mimeType === 'string' && typeof v.url === 'string')) && (value.childFrames === undefined || Array.isArray(value.childFrames) && value.childFrames.every(isFrameTree)); }

import { sourceContext, checkContext, loadEnhanced, ENHANCED_PREFIX } from './enhanced-mode.js';
// Runs in the extension worker. Each batch owns a short-lived debugger session;
// it never navigates, reloads, disables cache, or issues resource URL requests.
const MAX_FILE = 20 * 1024 * 1024;
const MAX_BATCH = 8 * 1024 * 1024;
const queues = new Map<number, Promise<void>>();
const sessions = new Map<number, DebuggerSession>();
const cancelled = new Set<number>();
const revisions = new Map<number, number>();
const permissionRevisions = new Map<string, number>();
const withoutHash = (value: string) => { const url = new URL(value); url.hash = ''; return url.href; };

async function validate(tabId: number, items: ResourceItem[]) {
  const documents = new Map<string, { key: string; url: string; id: string }[]>();
  for (const item of items) for (const origin of item.origins || []) {
    if (typeof origin.documentId !== 'string' || typeof origin.id !== 'string') continue;
    if (!documents.has(origin.documentId)) documents.set(origin.documentId, []);
    documents.get(origin.documentId)?.push({ key: item.key, url: item.url, id: origin.id });
  }
  const approved = new Map<string, Approved[]>();
  for (const [documentId, candidates] of documents) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId, documentIds: [documentId] },
        func: candidates => candidates.flatMap((candidate) => {
          const resource = globalThis.__imageTaken?.resource(candidate.id);
          return resource?.url === candidate.url ? [{ ...candidate, documentURL: location.href }] : [];
        }), args: [candidates],
      });
      if (result?.documentId !== documentId) continue;
      for (const candidate of result.result || []) {
        if (!approved.has(candidate.key)) approved.set(candidate.key, []);
        approved.get(candidate.key)?.push({ ...candidate, documentId });
      }
    } catch { /* Navigated or inaccessible source documents are not eligible. */ }
  }
  return approved;
}

function utf8Base64(text: string|undefined) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

async function collect(session: DebuggerSession, target: chrome.debugger.DebuggerSession) {
  await chrome.debugger.sendCommand(target, 'Page.enable');
  const response: unknown = await chrome.debugger.sendCommand(target, 'Page.getResourceTree'); if (!object(response) || !isFrameTree(response.frameTree)) throw new Error('Invalid resource tree'); const frameTree = response.frameTree;
  const walk = (node: FrameTree) => {
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

async function readBatch(tabId: number, items: ResourceItem[], retry = false, discover = false, revision = 0, permissions: Map<string, number> = new Map()): Promise<BatchResult> {
  if ((revisions.get(tabId) || 0) !== revision) return { items: [], unavailable: 'cancelled' };
  let context;
  try { context = await sourceContext(tabId); if (!await loadEnhanced(context.hostname)) return { items: [], resources: [], unavailable: 'disabled' }; }
  catch { return { items: [], resources: [], unavailable: 'permission-unavailable' }; }
  if ((permissions.get(context.hostname) || 0) !== (permissionRevisions.get(context.hostname) || 0)) return { items: [], unavailable: 'cancelled' };
  if (retry) cancelled.delete(tabId);
  if (cancelled.has(tabId)) return { items: [], unavailable: 'cancelled' };
  const approved = await validate(tabId, items);
  if (!approved.size && !discover) return { items: [] };
  const session: DebuggerSession = { context, resources: [], pending: [], closing: false, detached: false, owned: false };
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
        origins.some((origin) => withoutHash(origin.documentURL) === withoutHash(resource.documentURL)));
      for (const resource of candidates) {
        try {
          const body: unknown = await chrome.debugger.sendCommand(resource.target, 'Page.getResourceContent', { frameId: resource.frameId, url: resource.url }); if (!object(body) || typeof body.content !== 'string') continue;
          if (!body.content || body.content.length > Math.ceil(MAX_FILE * 4 / 3) + 4) continue;
          const encoded = body.base64Encoded ? body.content : utf8Base64(body.content);
          const bytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
          if (!bytes || bytes > MAX_FILE || total + bytes > budget) continue;
          // Recheck document identity after reading, guarding navigation races.
          const stillValid = await validate(tabId, [item]);
          const origin = (stillValid.get(item.key) || []).find((entry) => withoutHash(entry.documentURL) === withoutHash(resource.documentURL));
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
  } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
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

function broadcast(tabId: number|undefined, status: string) {
  void chrome.runtime.sendMessage({ type: 'enhanced-status', tabId, status }).catch(() => {});
}
export async function cancelBrowserTab(tabId: number) {
  revisions.set(tabId, (revisions.get(tabId) || 0) + 1);
  const session = sessions.get(tabId);
  if (!session) return;
  session.detached = true;
  session.closing = true;
  session.release = session.owned ? chrome.debugger.detach({ tabId }).catch(() => {}) : Promise.resolve();
  await session.release;
  broadcast(tabId, 'idle');
}
export function readBrowserBatch(tabId: number, items: ResourceItem[], retry = false, discover = false) {
  const revision = revisions.get(tabId) || 0, permissions = new Map(permissionRevisions);
  const operation = (queues.get(tabId) || Promise.resolve()).then(() => readBatch(tabId, items, retry, discover, revision, permissions));
  const settled = operation.then(() => {}, () => {}); queues.set(tabId, settled);
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
    if (typeof source.tabId !== "number") return; const session = sessions.get(source.tabId);
    if (!session || session.closing || method !== 'Target.attachedToTarget' || !object(params) || !object(params.targetInfo) || params.targetInfo.type !== 'iframe' || typeof params.sessionId !== 'string') return;
    const target = { tabId: source.tabId, sessionId: params.sessionId };
    session.pending.push(collect(session, target).catch(() => {}));
  });
  chrome.debugger.onDetach.addListener(source => {
    if (typeof source.tabId !== "number") return; const session = sessions.get(source.tabId);
    if (!session || session.closing) return;
    session.detached = true;
    cancelled.add(source.tabId);
    broadcast(source.tabId, 'stopped');
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'loading') { cancelled.delete(tabId); void cancelBrowserTab(tabId); } });
  chrome.tabs.onRemoved.addListener(tabId => { cancelled.delete(tabId); void cancelBrowserTab(tabId); });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => { if (!object(message)) return;
    if (message?.type !== 'read-browser-resources') return;
    if (sender.id !== chrome.runtime.id || !sender.url || new URL(sender.url).origin !== new URL(chrome.runtime.getURL('')).origin || new URL(sender.url).pathname !== '/panel.html') return;
    const { tabId, items } = message;
    if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0 || !Array.isArray(items) || !items.every(isResourceItem) || items.length > 4000 || items.some((item: ResourceItem) =>
      typeof item.key !== 'string' || typeof item.url !== 'string' || !/^https?:\/\//.test(item.url) || !Array.isArray(item.origins) || item.origins.length > 1000)) {
      respond({ items: [], unavailable: 'invalid-request' }); return;
    }
    readBrowserBatch(tabId, items, message.retry === true).then(respond, (error) => respond({ items: [], unavailable: error.message }));
    return true;
  });
}
