import { t, initI18n, translateRendered } from './i18n.js';
void initI18n().then(() => chrome.action.setTitle({ title: t('打开 ImageTaken') })).catch(console.error);
globalThis.addEventListener('imagetaken-languagechange', event => {
  void (async () => {
    for (const tab of await chrome.tabs.query({})) {
      const title = await chrome.action.getTitle({ tabId: tab.id });
      const translated = translateRendered(title, event.previousLanguage);
      if (translated !== title) await chrome.action.setTitle({ tabId: tab.id, title: translated });
    }
    await chrome.action.setTitle({ title: t('打开 ImageTaken') });
  })().catch(console.error);
});
import { downloadTargetKey } from './browser-downloads.js';
import { registerDebuggerReader } from './debugger-reader.js';
registerDebuggerReader();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(console.error);
// A retained badge describes the last panel scan, never the next document.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'loading') return;
  void Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: '' }),
    chrome.action.setTitle({ tabId, title: t('打开 ImageTaken') }),
  ]);
});
const downloadTargets = new Map();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'start-browser-download' || sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('panel.html'))) return;
  if (typeof message.filename !== 'string' || message.filename.split('/').length !== 2 ||
      message.filename.split('/').some(part => !part || part === '.' || part === '..' || /[\\\x00-\x1f<>:"|?*]/.test(part)) ||
      typeof message.url !== 'string' || (!message.url.startsWith(`blob:${chrome.runtime.getURL('')}`) && !/^https?:\/\//.test(message.url))) {
    respond({ error: t('无效的下载路径或图片地址') }); return;
  }
  downloadTargets.set(message.url, message.filename);
  chrome.downloads.download({ url: message.url, filename: message.filename, conflictAction: 'uniquify', saveAs: false })
    .then(id => respond({ id }), error => { downloadTargets.delete(message.url); respond({ error: error.message }); });
  return true;
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId !== chrome.runtime.id) { suggest(); return; }
  const cached = downloadTargets.get(item.url);
  if (cached) {
    downloadTargets.delete(item.url);
    suggest({ filename: cached, conflictAction: 'uniquify' });
    void chrome.storage.session.remove(downloadTargetKey(item.url));
    return;
  }
  void (async () => {
    let filename;
    try {
      const key = downloadTargetKey(item.url);
      filename = (await chrome.storage.session.get(key))[key];
      await chrome.storage.session.remove(key);
    } catch (error) { console.error(t('读取下载路径失败'), error); }
    suggest(typeof filename === 'string' ? { filename, conflictAction: 'uniquify' } : undefined);
  })();
  return true;
});

// Serialize read/modify/write across all panels so simultaneous ignores are not lost.
let mutations = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('panel.html')) || message?.type !== 'set-ignored') return;
  const { domain, hash, ignored } = message;
  let validDomain = false;
  try { validDomain = new URL(`https://${domain}`).hostname === domain && !/[\s/?#@\\]/.test(domain); } catch { /* Invalid hostname. */ }
  if (typeof domain !== 'string' || !domain || domain.length > 253 || !validDomain || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || typeof ignored !== 'boolean') {
    respond({ ok: false, error: t('无效的忽略规则') });
    return;
  }
  const operation = mutations.then(async () => {
    const key = `ignored:v1:${domain}`;
    const previous = (await chrome.storage.local.get(key))[key];
    const hashes = new Set(Array.isArray(previous) ? previous : []);
    if (ignored) hashes.add(hash); else hashes.delete(hash);
    if (hashes.size) await chrome.storage.local.set({ [key]: [...hashes] });
    else await chrome.storage.local.remove(key);
  });
  mutations = operation.catch(() => {});
  operation.then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message }));
  return true;
});
