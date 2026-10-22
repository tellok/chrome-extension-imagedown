import { sourceContext, checkContext, loadEnhanced, saveEnhanced, enhancedKey } from './enhanced-mode.js';
import { t } from './i18n.js';
export function bindEnhancedSettings() {
  const toggle = document.getElementById('enhanced-mode'), host = document.getElementById('enhanced-host'), status = document.getElementById('enhanced-feedback');
  const params = new URLSearchParams(location.search);
  let context = null, saving = false, available = false;
  function unavailable() { available = false; toggle.disabled = true; status.textContent = t('请从目标网页的图片库进入此设置。'); }
  async function initialize() {
    toggle.disabled = true;
    try {
      const tabId = Number(params.get('tab'));
      if (!params.has('tab') || !Number.isInteger(tabId)) { unavailable(); return; }
      context = await sourceContext(tabId);
      if (params.get('document') !== context.documentId || params.get('hostname') !== context.hostname) throw new Error('Source changed');
      host.textContent = context.hostname; host.title = context.hostname;
      try { toggle.checked = await loadEnhanced(context.hostname); }
      catch (error) { status.textContent = t('无法读取设置：{0}', error.message); return; }
      available = true; toggle.disabled = false; status.textContent = '';
      if (location.hash === '#enhanced-settings') { toggle.scrollIntoView({ block: 'center' }); toggle.focus(); }
    } catch { unavailable(); }
  }
  toggle.addEventListener('change', async () => {
    if (!context || saving) return;
    const value = toggle.checked; toggle.disabled = true; saving = true;
    try {
      await checkContext(context); await saveEnhanced(context.hostname, value);
      status.textContent = t('已保存');
    } catch {
      await checkContext(context).catch(() => { available = false; });
      toggle.checked = !value; status.textContent = t('保存未完成，请重试或从目标图片库重新进入。');
    } finally { saving = false; toggle.disabled = !available; }
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => { if (context?.tabId === tabId && (change.status === 'loading' || change.url)) unavailable(); });
  chrome.tabs.onRemoved.addListener(tabId => { if (context?.tabId === tabId) unavailable(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && context && !saving && changes[enhancedKey(context.hostname)]) toggle.checked = changes[enhancedKey(context.hostname)].newValue === true;
  });
  window.addEventListener('imagetaken-languagechange', () => { if (toggle.disabled && !saving) unavailable(); });
  void initialize();
}
