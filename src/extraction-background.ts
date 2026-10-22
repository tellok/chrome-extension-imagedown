import { isResourceItem } from "./guards.js";
import { object } from "./guards.js";
import type { SourceContext } from './enhanced-mode.js';
import type { ResourceItem } from './models.js';
import type { ArchivePart, ResourceState } from './mhtml.js';
interface ExtractionView { port: chrome.runtime.Port; context: SourceContext | null; generation: number }
interface ArchiveEntry { documentId: string; states: ResourceState[]; promise: Promise<ArchivePart[]>; timer?: number; pending: boolean; stale: boolean }
interface CaptureRequest { view: ExtractionView; context: SourceContext; resolve: (parts: ArchivePart[]) => void; reject: (error: Error) => void; timer: number }

import { readBrowserBatch, cancelBrowserTab } from './debugger-reader.js';
import { createRequestManager } from './image-requests.js';
import { createTaskPool, firstImage } from './extraction-tasks.js';
import { resourceStates, archiveResource } from './mhtml.js';
import { sourceContext, checkContext, loadEnhanced, ENHANCED_PREFIX } from './enhanced-mode.js';
export const imageRequests = createRequestManager({ dnr: chrome.declarativeNetRequest, extensionId: chrome.runtime.id });
const views = new Set<ExtractionView>(), archives = new Map<number, ArchiveEntry>(), captures = new Map<number, CaptureRequest>(), pool = createTaskPool();
let captureId = 0;
function trusted(port: chrome.runtime.Port) { return port.sender?.id === chrome.runtime.id && port.sender.url?.split('?')[0] === chrome.runtime.getURL('panel.html'); }
function send(view: ExtractionView, message: Record<string, unknown>) { try { view.port.postMessage(message); } catch { /* Closed view. */ } }
function event(tabId: number, values: { kind: string; }) { for (const view of views) if (view.context?.tabId === tabId) send(view, { type: 'event', tabId, ...values }); }
function releaseArchive(tabId: number) {
  const entry = archives.get(tabId);
  if (entry) {
    clearTimeout(entry.timer);
    if (entry.pending) entry.stale = true; else archives.delete(tabId);
  }
}
function cancelCapture(view: ExtractionView) {
  for (const [id, request] of captures) if (request.view === view) { request.reject(new Error('Archive host closed')); clearTimeout(request.timer); captures.delete(id); }
}
async function archive(context: SourceContext, view: ExtractionView | undefined, states: ResourceState[]): Promise<{ parts: ArchivePart[]; states: ResourceState[] }> {
  if (!view || !views.has(view)) {
    view = [...views].find(candidate => candidate.context?.tabId === context.tabId && candidate.context.documentId === context.documentId);
    if (!view) throw new Error('Archive host unavailable');
  }
  let entry = archives.get(context.tabId);
  if (entry && (entry.documentId !== context.documentId || entry.stale)) {
    await entry.promise.catch(() => {});
    if (archives.get(context.tabId) === entry) archives.delete(context.tabId);
    return archive(context, view, states);
  }
  if (!entry) {
    const id = ++captureId;
    const promise = new Promise<ArchivePart[]>((resolve, reject) => {
      const timer = setTimeout(() => { captures.delete(id); reject(new Error('Archive timed out')); }, 20000);
      captures.set(id, { view, context, resolve, reject, timer });
      send(view, { type: 'capture', id, tabId: context.tabId });
    }).then(async parts => { await checkContext(context); return parts; });
    entry = { documentId: context.documentId, states, promise, timer: undefined, pending: true, stale: false };
    archives.set(context.tabId, entry);
    const captured = entry;
    promise.then(() => { captured.pending = false; }, () => {
      captured.pending = false; if (archives.get(context.tabId) === captured) releaseArchive(context.tabId);
    });
  }
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => releaseArchive(context.tabId), 30000);
  try { return { parts: await entry.promise, states: entry.states }; }
  catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
    const replacement = [...views].find(candidate => candidate !== view && candidate.context?.tabId === context.tabId && candidate.context.documentId === context.documentId);
    if ((!view || !views.has(view)) && replacement) return archive(context, replacement, states);
    throw error;
  }
}
async function archived(context: SourceContext, view: ExtractionView, items: ResourceItem[]) {
  const before = await resourceStates(context.tabId, items);
  const snapshot = await archive(context, view, before);
  const after = await resourceStates(context.tabId, items);
  return items.flatMap((item) => {
    const resource = archiveResource(snapshot.parts, item, snapshot.states.filter((state) => state.key === item.key), after.filter(state => state.key === item.key));
    return resource ? [resource] : [];
  });
}
async function resolveContext(view: ExtractionView, tabId: number) {
  const context = await sourceContext(tabId);
  if (view.context?.documentId !== context.documentId || view.context?.tabId !== tabId) { pool.release(view); view.generation++; }
  view.context = context;
  return context;
}
export function registerExtraction() {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'image-extraction' || !trusted(port)) return;
    const view: ExtractionView = { port, context: null, generation: 0 }; views.add(view);
    port.onDisconnect.addListener(() => {
      views.delete(view); pool.release(view); cancelCapture(view);
      const tabId = view.context?.tabId;
      if (![...views].some(other => other.context?.tabId === tabId)) { if (typeof tabId === "number") { releaseArchive(tabId); void cancelBrowserTab(tabId); } }
    });
    port.onMessage.addListener((message: unknown) => { if (!object(message)) return;
      if (message.type === 'captured') { if (typeof message.id !== 'number') return;
        const request = captures.get(message.id);
        if (!request || request.view !== view) return;
        captures.delete(message.id); clearTimeout(request.timer);
        if (message.error || !Array.isArray(message.parts)) request.reject(new Error(String(message.error || 'Invalid archive')));
        else { const parts: ArchivePart[] = []; for (const part of message.parts) { if (!object(part) || typeof part.url !== 'string' || typeof part.contentId !== 'string' || typeof part.mime !== 'string' || typeof part.bytes !== 'number' || typeof part.dataUrl !== 'string') { request.reject(new Error('Invalid archive')); return; } parts.push({ url: part.url, contentId: part.contentId, mime: part.mime, bytes: part.bytes, dataUrl: part.dataUrl }); } request.resolve(parts); }
        return;
      }
      if (message.type !== 'request') return;
      void (async () => {
        const { tabId, operation } = message;
        if (typeof tabId !== "number" || !Number.isInteger(tabId)) throw new Error('Invalid source tab');
        const context = await resolveContext(view, tabId), generation = view.generation;
        const valid = () => views.has(view) && view.generation === generation;
        if (operation === 'subscribe') {
          let enhanced = false; try { enhanced = await loadEnhanced(context.hostname); } catch { /* Deny on read error. */ }
          return { ...context, enhanced };
        }
        if (operation === 'discover') {
          if (message.scoped || !await loadEnhanced(context.hostname)) return [];
          const batch = await readBrowserBatch(tabId, [], false, true);
          const frames = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => location.href });
          const output = [];
          for (const frame of frames) {
            const urls = [...new Set((batch.resources || []).filter((resource) => resource.documentURL === frame.result).map((resource) => resource.url))];
            if (!urls.length) continue;
            const [result] = await chrome.scripting.executeScript({ target: { tabId, documentIds: [frame.documentId] },
              func: urls => globalThis.__imageTaken?.registerResources(urls) || [], args: [urls] });
            if (result?.documentId !== frame.documentId) continue;
            output.push(...(result.result || []).map((record) => ({ ...record, origins: [{ id: record.id, documentId: frame.documentId, frameId: frame.frameId }] })));
          }
          await checkContext(context);
          return valid() && await loadEnhanced(context.hostname) ? output : [];
        }
        if (operation === 'archive') {
          pool.retryFailed(JSON.stringify([tabId, context.documentId]).slice(0, -1) + ',');
          const items = message.items;
          if (!Array.isArray(items) || !items.every(isResourceItem) || items.length > 4000) throw new Error('Invalid image batch');
          return await archived(context, view, items);
        }
        if (operation !== 'read') throw new Error('Unknown extraction operation');
        const item = message.item;
        if (!isResourceItem(item) || typeof item.url !== 'string' || !/^https?:\/\//.test(item.url) || !Array.isArray(item.origins)) throw new Error('Invalid image');
        const states = await resourceStates(tabId, [item]);
        if (!states.length) throw new Error('Source image changed');
        const identity = JSON.stringify([tabId, context.documentId, item.url, states.map(state => [state.documentId, state.signature]), message.retry || 0]);
        const result = await pool.run(identity, view, (signal) => firstImage([
          ['MHTML', async () => (await archived(context, view, [item]))[0]],
          ['Fetch', () => imageRequests.image(item.url, states[0].documentURL, { refresh: !!message.retry, signal })],
          ['CDP', async () => {
            if (!await loadEnhanced(context.hostname)) throw new Error('Enhanced mode is off');
            await checkContext(context); signal.throwIfAborted();
            // The debugger module validates ownership and permission again.
            return (await readBrowserBatch(tabId, [item], !!message.retry)).items[0];
          }]], signal));
        await checkContext(context);
        if (!valid()) throw new Error('Extraction cancelled');
        return result;
      })().then(result => send(view, { id: message.id, result }), error => send(view, { id: message.id, error: error.message }));
    });
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender) => { if (!object(message)) return;
    if (message?.type !== 'page-images-changed' || !sender.tab?.id || sender.id !== chrome.runtime.id) return;
    releaseArchive(sender.tab.id);
    event(sender.tab.id, { kind: 'changed' });
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== 'loading') return;
    releaseArchive(tabId);
    for (const view of views) if (view.context?.tabId === tabId) { view.generation++; pool.release(view); cancelCapture(view); }
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    releaseArchive(tabId);
    for (const view of views) if (view.context?.tabId === tabId) { view.generation++; pool.release(view); cancelCapture(view); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const view of views) if (view.context && changes[ENHANCED_PREFIX + view.context.hostname]) send(view, { type: 'event', tabId: view.context.tabId, kind: 'permission' });
  });
}
