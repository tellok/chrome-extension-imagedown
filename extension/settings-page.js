import { bindRemoteSubscriptions } from './remote-rules-settings.js';
import { GLOBAL_DIMENSION_KEYS, loadGlobalDimensions, saveGlobalDimensions } from './preferences.js';
import { t } from './i18n.js';
import { initI18n, bindDocument, localizeDocument, LANGUAGE_KEY, languagePreference, translateRendered } from './i18n.js';
import { TITLE_CLEANUP_KEY, loadTitleCleanup, READY_FIRST_KEY, loadReadyFirst, DOWNLOAD_MANIFEST_KEY, loadDownloadManifest } from './settings.js';
import { THEME_KEY, themeReady, themePreference } from './theme.js';

const status = document.getElementById('settings-status');
try { await initI18n(); }
catch (error) { status.textContent = t('无法读取设置：{0}', error.message); }
bindDocument();
bindRemoteSubscriptions();
const themeSelect = document.getElementById('theme');
try { await themeReady; }
catch (error) { status.textContent = t('无法读取设置：{0}', error.message); }
themeSelect.value = themePreference();
themeSelect.disabled = false;
window.addEventListener('imagetaken-themechange', () => { themeSelect.value = themePreference(); });
themeSelect.addEventListener('change', async () => {
  themeSelect.disabled = true;
  try {
    await chrome.storage.local.set({ [THEME_KEY]: themeSelect.value });
    status.textContent = t('已保存');
  } catch (error) {
    themeSelect.value = themePreference();
    status.textContent = t('保存失败：{0}', error.message);
  } finally { themeSelect.disabled = false; }
});
const languageSelect = document.getElementById('language');
languageSelect.value = languagePreference();
languageSelect.disabled = false;
window.addEventListener('imagetaken-languagechange', event => {
  localizeDocument();
  languageSelect.value = languagePreference();
  status.textContent = translateRendered(status.textContent, event.previousLanguage);
});
languageSelect.addEventListener('change', async () => {
  languageSelect.disabled = true;
  try {
    await chrome.storage.local.set({ [LANGUAGE_KEY]: languageSelect.value });
    status.textContent = t('已保存');
  } catch (error) {
    languageSelect.value = languagePreference();
    status.textContent = t('语言设置保存失败：{0}', error.message);
  } finally { languageSelect.disabled = false; }
});
const controls = [
  { toggle: document.getElementById('auto-clean-title'), key: TITLE_CLEANUP_KEY, load: loadTitleCleanup },
  { toggle: document.getElementById('ready-first'), key: READY_FIRST_KEY, load: loadReadyFirst },
  { toggle: document.getElementById('download-manifest'), key: DOWNLOAD_MANIFEST_KEY, load: loadDownloadManifest },
];
await Promise.all(controls.map(async ({ toggle, key, load }) => {
  try {
    toggle.checked = await load();
    toggle.disabled = false;
  } catch (error) { status.textContent = t(`无法读取设置：{0}`, error.message); }
  toggle.addEventListener('change', async () => {
    const value = toggle.checked;
    toggle.disabled = true;
    try {
      await chrome.storage.local.set({ [key]: value });
      status.textContent = t('已保存');
    } catch (error) {
      toggle.checked = !value;
      status.textContent = t(`保存失败：{0}`, error.message);
    } finally { toggle.disabled = false; }
  });
}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const { toggle, key } of controls) if (changes[key]) toggle.checked = key === READY_FIRST_KEY ? changes[key].newValue !== false : changes[key].newValue === true;
});

const dimensions = { width: document.getElementById('default-min-width'), height: document.getElementById('default-min-height') };
let dimensionsReady = false, dimensionRevision = 0;
let dimensionWrites = Promise.resolve();
async function syncDimensions() {
  const revision = ++dimensionRevision;
  try {
    const values = await loadGlobalDimensions();
    if (revision !== dimensionRevision) return;
    for (const [field, input] of Object.entries(dimensions)) {
      if (!dimensionsReady || document.activeElement !== input) { input.value = values[field]; input.removeAttribute('aria-invalid'); }
      input.disabled = false;
    }
    dimensionsReady = true;
  } catch (error) {
    if (revision !== dimensionRevision) return;
    dimensionsReady = false;
    for (const input of Object.values(dimensions)) input.disabled = true;
    status.textContent = t('无法读取设置：{0}', error.message);
  }
}
for (const [field, input] of Object.entries(dimensions)) {
  input.addEventListener('blur', () => { if (dimensionsReady) void dimensionWrites.then(() => syncDimensions()); });
  input.addEventListener('input', async () => {
    if (!dimensionsReady) return;
    const value = input.valueAsNumber;
    if (!input.value || !input.validity.valid || !Number.isInteger(value)) {
      input.setAttribute('aria-invalid', 'true');
      status.textContent = t('请输入 0 至 100000 的整数。');
      return;
    }
    input.removeAttribute('aria-invalid');
    dimensionRevision++;
    const operation = dimensionWrites.then(() => saveGlobalDimensions({ [field]: value }));
    dimensionWrites = operation.catch(() => {});
    try { await operation; if (input.valueAsNumber === value) status.textContent = t('已保存'); }
    catch (error) { if (input.valueAsNumber === value) status.textContent = t('保存失败：{0}', error.message); }
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.values(GLOBAL_DIMENSION_KEYS).some(key => changes[key])) void syncDimensions();
});
await syncDimensions();
