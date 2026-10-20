import { t } from './i18n.js';
import { initI18n, bindDocument, localizeDocument, LANGUAGE_KEY, languagePreference, translateRendered } from './i18n.js';
import { TITLE_CLEANUP_KEY, loadTitleCleanup, READY_FIRST_KEY, loadReadyFirst } from './settings.js';
import { THEME_KEY, themeReady, themePreference } from './theme.js';

const status = document.getElementById('settings-status');
try { await initI18n(); }
catch (error) { status.textContent = t('无法读取设置：{0}', error.message); }
bindDocument();
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
  for (const { toggle, key } of controls) if (changes[key]) toggle.checked = changes[key].newValue === true;
});
