import { object } from "./guards.js";
import type { ImageItem, ScanResult } from "./models.js";
import { SYNC_IMPORT_KEY } from './settings-sync-codec.js';
import { getEffectivePreferences } from './remote-rules-background.js';
import { REMOTE_RULES_KEY, rulesChanged } from './remote-rules.js';
import { imageBadge } from './badge.js';
import { filterImages } from './lib.js';
import { prepareMetadata, siteDomain, imageSize } from './metadata.js';
import { thresholdChanges, loadIgnored } from './preferences.js';
import { t } from './i18n.js';

export function registerAutomaticBadge() {
  const timers = new Map<number, number>(), running = new Set<number>(), dirty = new Set<number>(), versions = new Map<number, number>();
  const panels = new Map<chrome.runtime.Port, { sourceTabId: number | null; panelTabId: number | null }>(), snapshots = new Map<number, { items: ImageItem[]; root: chrome.scripting.InjectionResult<ScanResult | undefined>; version?: number; url?: string; xpath: string; exclusions: string }>(), badges = new Map<number | null, { text: string; title: string }>(), refreshes = new Map<number, boolean>();
  const diagnostics: typeof globalThis.__imageTakenBadgeDiagnostics = new Map();
  let configurationVersion = 0;
  globalThis.__imageTakenBadgeDiagnostics = diagnostics;
  async function paintOne(tabId: number, badge: { text: string; title: string }) {
    await Promise.allSettled([
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#DC2626' }),
      chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' }),
      chrome.action.setBadgeText({ tabId, text: badge.text }),
      chrome.action.setTitle({ tabId, title: badge.title }),
    ]);
  }
  async function paint(tabId: number, badge: { text: string; title: string }) {
    badges.set(tabId, badge);
    const mirrors = [...panels.values()].filter(panel => panel.sourceTabId === tabId).map(panel => panel.panelTabId).filter((id): id is number => typeof id === "number" && Number.isInteger(id));
    await Promise.allSettled([...new Set([tabId, ...mirrors])].map(id => paintOne(id, badge)));
  }
  function clear(tabId: number) {
    snapshots.delete(tabId); badges.delete(tabId);
    return paint(tabId, { text: '', title: t('打开 ImageTaken') });
  }
  function schedule(tabId: number | undefined, fresh = true) { if (tabId === undefined) return;
    refreshes.set(tabId, !!refreshes.get(tabId) || fresh);
    if (running.has(tabId)) { dirty.add(tabId); return; }
    if (timers.has(tabId)) return;
    timers.set(tabId, setTimeout(() => {
      timers.delete(tabId);
      const fresh = refreshes.get(tabId); refreshes.delete(tabId);
      void update(tabId, fresh);
    }, 250));
  }
  async function update(tabId: number, fresh?: boolean) {
    running.add(tabId);
    const version = versions.get(tabId), configVersion = configurationVersion;
    try {
      const tab = await chrome.tabs.get(tabId);
      const domain = siteDomain(tab.url);
      if (!domain) { await clear(tabId); return; }
      if (tab.discarded || tab.status === 'unloaded') return;
      const [effective, ignored] = await Promise.all([getEffectivePreferences(tab.url || ""), loadIgnored(domain)]);
      const { xpath, excludedSelectors: exclusions, query, ...view } = effective.values;
      const thresholds = effective.values;
      let snapshot = snapshots.get(tabId);
      if (fresh || !snapshot || snapshot.version !== version || snapshot.url !== tab.url || snapshot.xpath !== xpath || snapshot.exclusions !== exclusions) {
        const target = { tabId, allFrames: !xpath };
        await chrome.scripting.executeScript({ target, files: ['collector.js'] });
        const frames = await chrome.scripting.executeScript({ target,
          func: (xpath, exclusions) => globalThis.__imageTaken?.scan(xpath, exclusions, true), args: [xpath, exclusions] });
        const root = frames.find(frame => frame.frameId === 0);
        if (root?.result?.error) throw new Error(root.result.error);
        if (!root?.result || root.result?.url !== tab.url) return;
        const unique = new Map<string, ImageItem>();
        for (const { result } of frames) {
          if (result?.error) throw new Error(result.error);
          for (const item of result?.items || []) {
            const key = item.kind === 'canvas' ? `${unique.size}:${item.url}` : item.url;
            const previous = unique.get(key);
            if (!previous) unique.set(key, { ...item, key, origins: [], order: unique.size });
            else {
              const sources = [...new Set([...previous.sources, ...item.sources])];
              if (item.loaded && !previous.loaded) {
                const { bytes, sizeSource, ...loaded } = item;
                Object.assign(previous, loaded, { order: previous.order });
              }
              previous.sources = sources;
              if (previous.bytes == null && item.bytes != null) Object.assign(previous, { bytes: item.bytes, sizeSource: item.sizeSource });
            }
          }
        }
        const items = await prepareMetadata([...unique.values()]);
        snapshot = { items, root, version, url: tab.url, xpath, exclusions };
      }
      const { items, root } = snapshot;
      for (const item of items) {
        item.ignored = ignored.has(item.ignoreHash || "");
        item.previewStatus = item.loaded ? 'ready' : '';
      }
      const visible = filterImages(items, { ...thresholds, ...view, query }, imageSize);
      const [current] = await chrome.scripting.executeScript({
        target: { tabId, documentIds: [root.documentId] }, func: () => location.href,
      });
      if (current?.documentId !== root.documentId || current.result !== root.result?.url) return;
      if (versions.get(tabId) === version && configurationVersion === configVersion) {
        snapshots.set(tabId, snapshot);
        const badge = imageBadge(visible, items.length);
        await paint(tabId, badge);
        diagnostics.set(tabId, { state: 'counted', ready: badge.text, total: items.length, documentId: root.documentId, updatedAt: Date.now() });
      }
    } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
      if (diagnostics.get(tabId)?.error !== error.message) console.warn('ImageTaken automatic badge:', tabId, error.message);
      diagnostics.set(tabId, { state: 'error', error: error.message, updatedAt: Date.now() });
    } finally {
      running.delete(tabId);
      if (dirty.delete(tabId)) schedule(tabId, !!refreshes.get(tabId));
    }
  }
  async function watch(tabId: number | undefined) { if (tabId === undefined) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!siteDomain(tab.url) || tab.discarded || tab.status === 'unloaded') return;
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['badge-observer.js'] });
      schedule(tabId);
    } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
      diagnostics.set(tabId, { state: 'unavailable', error: error.message, updatedAt: Date.now() });
    }
  }
  const watchExisting = () => void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.map(tab => watch(tab.id))));
  chrome.runtime.onInstalled.addListener(watchExisting);
  chrome.runtime.onStartup.addListener(watchExisting);
  chrome.tabs.onActivated.addListener(({ tabId }) => { if (!snapshots.has(tabId)) void watch(tabId); });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading') {
      versions.set(tabId, (versions.get(tabId) || 0) + 1);
      clearTimeout(timers.get(tabId)); timers.delete(tabId);
      void clear(tabId);
    }
    if (change.status === 'complete') void watch(tabId);
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    clearTimeout(timers.get(tabId)); timers.delete(tabId); dirty.delete(tabId);
    // Invalidate in-flight work even if the tab closes during metadata hashing.
    versions.set(tabId, (versions.get(tabId) || 0) + 1);
    diagnostics.delete(tabId); snapshots.delete(tabId); badges.delete(tabId); refreshes.delete(tabId);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const keys = Object.keys(changes);
    if (keys.length === 1 && keys[0] === REMOTE_RULES_KEY && !rulesChanged(changes[REMOTE_RULES_KEY])) return;
    if (!keys.some(key => key === REMOTE_RULES_KEY || /^(filters:|xpath:|excluded-selectors:|ignored:|image-query:)/.test(key))) return;
    configurationVersion++;
    const structural = !changes[SYNC_IMPORT_KEY] && keys.some(key => /^(xpath:|excluded-selectors:)/.test(key));
    void chrome.tabs.query({}).then(tabs => {
      for (const tab of tabs) {
        const domain = siteDomain(tab.url);
        const thresholdsOnly = keys.every(key => key.startsWith('filters:site:') || key === 'filters:width' || key === 'filters:height' || key === 'filters:minBytes');
        if (domain && !tab.discarded && tab.status !== 'unloaded' && (!thresholdsOnly || thresholdChanges(changes, domain))) schedule(tab.id, structural);
      }
    });
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender) => { if (!object(message)) return;
    if (message?.type === 'page-images-changed' && sender.id === chrome.runtime.id &&
        Number.isInteger(sender.tab?.id) && /^https?:/.test(sender.url || '')) schedule(sender.tab?.id);
  });
  // Views only mirror the canonical page count; preview progress never owns it.
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'panel-image-badge' || port.sender?.id !== chrome.runtime.id ||
        port.sender?.url?.split('?')[0] !== chrome.runtime.getURL('panel.html')) return;
    let revision = 0;
    port.onMessage.addListener(async (message: unknown) => { if (!object(message)) return;
      const { sourceTabId, panelTabId } = message;
      if (!(sourceTabId === null || typeof sourceTabId === "number" && Number.isInteger(sourceTabId)) || !(panelTabId === null || typeof panelTabId === "number" && Number.isInteger(panelTabId))) return;
      const current = ++revision;
      panels.set(port, { sourceTabId, panelTabId });
      if (typeof panelTabId !== "number" || !Number.isInteger(panelTabId) || panelTabId === sourceTabId) return;
      let badge = badges.get(sourceTabId);
      if (!badge && typeof sourceTabId === "number" && Number.isInteger(sourceTabId)) {
        try { badge = { text: await chrome.action.getBadgeText({ tabId: sourceTabId }), title: await chrome.action.getTitle({ tabId: sourceTabId }) }; }
        catch { return; }
      }
      if (revision === current && panels.has(port)) await paintOne(panelTabId, badge || { text: '', title: t('打开 ImageTaken') });
    });
    port.onDisconnect.addListener(() => { revision++; panels.delete(port); });
  });
}
