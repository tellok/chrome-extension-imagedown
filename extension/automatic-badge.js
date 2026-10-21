import { imageBadge } from './badge.js';
import { filterImages } from './lib.js';
import { prepareMetadata, siteDomain, imageSize } from './metadata.js';
import { loadThresholds, loadXPath, loadExclusions, loadQuery, loadIgnored } from './preferences.js';
import { t } from './i18n.js';

export function registerAutomaticBadge() {
  const timers = new Map(), running = new Set(), dirty = new Set(), versions = new Map();
  const panels = new Map();
  const diagnostics = new Map();
  globalThis.__imageTakenBadgeDiagnostics = diagnostics;
  const owned = tabId => [...panels.values()].some(ids => ids.includes(tabId));
  const clear = tabId => Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: '' }),
    chrome.action.setTitle({ tabId, title: t('打开 ImageTaken') }),
  ]);
  async function paint(tabId, badge) {
    await Promise.allSettled([
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#DC2626' }),
      chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' }),
      chrome.action.setBadgeText({ tabId, text: badge.text }),
      chrome.action.setTitle({ tabId, title: badge.title }),
    ]);
  }
  function schedule(tabId) {
    if (owned(tabId)) return;
    if (running.has(tabId)) { dirty.add(tabId); return; }
    if (timers.has(tabId)) return;
    timers.set(tabId, setTimeout(() => {
      timers.delete(tabId);
      void update(tabId);
    }, 250));
  }
  async function update(tabId) {
    if (owned(tabId)) return;
    running.add(tabId);
    const version = versions.get(tabId);
    try {
      const tab = await chrome.tabs.get(tabId);
      const domain = siteDomain(tab.url);
      if (!domain) { await clear(tabId); return; }
      if (tab.discarded || tab.status === 'unloaded') return;
      const [thresholds, xpath, exclusions, query, ignored] = await Promise.all([
        loadThresholds(), loadXPath(domain), loadExclusions(domain), loadQuery(domain), loadIgnored(domain),
      ]);
      const target = { tabId, allFrames: !xpath };
      await chrome.scripting.executeScript({ target, files: ['collector.js'] });
      const frames = await chrome.scripting.executeScript({ target,
        func: (xpath, exclusions) => globalThis.__imageTaken.scan(xpath, exclusions, true), args: [xpath, exclusions] });
      const root = frames.find(frame => frame.frameId === 0);
      if (!root?.result || root.result.url !== tab.url) return;
      const unique = new Map();
      for (const { result } of frames) {
        if (result?.error) throw new Error(result.error);
        for (const item of result?.items || []) {
          const key = item.kind === 'canvas' ? `${unique.size}:${item.url}` : item.url;
          const previous = unique.get(key);
          if (!previous || item.loaded && !previous.loaded) unique.set(key, { ...item, order: unique.size });
          else if (previous.bytes == null && item.bytes != null) previous.bytes = item.bytes;
        }
      }
      const items = await prepareMetadata([...unique.values()]);
      for (const item of items) {
        item.ignored = ignored.has(item.ignoreHash);
        item.previewStatus = item.loaded ? 'ready' : '';
      }
      const visible = filterImages(items, { ...thresholds, query }, imageSize);
      const [current] = await chrome.scripting.executeScript({
        target: { tabId, documentIds: [root.documentId] }, func: () => location.href,
      });
      if (current?.documentId !== root.documentId || current.result !== root.result.url) return;
      if (versions.get(tabId) === version && !owned(tabId)) {
        const badge = imageBadge(visible, items.length);
        await paint(tabId, badge);
        diagnostics.set(tabId, { state: 'counted', ready: badge.text, total: items.length, documentId: root.documentId, updatedAt: Date.now() });
      }
    } catch (error) {
      if (diagnostics.get(tabId)?.error !== error.message) console.warn('ImageTaken automatic badge:', tabId, error.message);
      diagnostics.set(tabId, { state: 'error', error: error.message, updatedAt: Date.now() });
    } finally {
      running.delete(tabId);
      if (dirty.delete(tabId)) schedule(tabId);
    }
  }
  async function watch(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!siteDomain(tab.url) || tab.discarded || tab.status === 'unloaded') return;
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['badge-observer.js'] });
      schedule(tabId);
    } catch (error) {
      diagnostics.set(tabId, { state: 'unavailable', error: error.message, updatedAt: Date.now() });
    }
  }
  const watchExisting = () => void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.map(tab => watch(tab.id))));
  chrome.runtime.onInstalled.addListener(watchExisting);
  chrome.runtime.onStartup.addListener(watchExisting);
  chrome.tabs.onActivated.addListener(({ tabId }) => { void watch(tabId); });
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
    diagnostics.delete(tabId);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some(key => /^(filters:|xpath:|excluded-selectors:|ignored:|image-query:)/.test(key))) watchExisting();
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === 'page-images-changed' && sender.id === chrome.runtime.id &&
        Number.isInteger(sender.tab?.id) && /^https?:/.test(sender.url || '')) schedule(sender.tab.id);
  });
  // Open panels own their filtered counts. Release ownership automatically when
  // the view closes so passive updates cannot overwrite its preview results.
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'panel-image-badge' || port.sender?.id !== chrome.runtime.id ||
        port.sender?.url?.split('?')[0] !== chrome.runtime.getURL('panel.html')) return;
    panels.set(port, []);
    let queue = Promise.resolve();
    port.onMessage.addListener(message => {
      if (!Array.isArray(message.tabIds) || message.tabIds.some(id => !Number.isInteger(id)) ||
          typeof message.text !== 'string' || typeof message.title !== 'string') return;
      const previous = panels.get(port) || [];
      panels.set(port, message.tabIds);
      for (const tabId of previous) if (!message.tabIds.includes(tabId)) schedule(tabId);
      queue = queue.then(() => panels.has(port) && Promise.allSettled(message.tabIds.map(tabId => paint(tabId, message))));
    });
    port.onDisconnect.addListener(() => {
      const previous = panels.get(port) || [];
      panels.delete(port);
      for (const tabId of previous) schedule(tabId);
    });
  });
}
