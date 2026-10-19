chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(console.error);

// Serialize read/modify/write across all panels so simultaneous ignores are not lost.
let mutations = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('panel.html')) || message?.type !== 'set-ignored') return;
  const { domain, hash, ignored } = message;
  let validDomain = false;
  try { validDomain = new URL(`https://${domain}`).hostname === domain && !/[\s/?#@\\]/.test(domain); } catch { /* Invalid hostname. */ }
  if (typeof domain !== 'string' || !domain || domain.length > 253 || !validDomain || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || typeof ignored !== 'boolean') {
    respond({ ok: false, error: '无效的忽略规则' });
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
