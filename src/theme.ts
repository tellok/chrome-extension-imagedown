export const THEME_KEY = 'settings:theme';
export const THEME_OPTIONS = ['system', 'light', 'dark'];
export function normalizeTheme(value: unknown) { return typeof value === 'string' && THEME_OPTIONS.includes(value) ? value : 'system'; }
export function resolveTheme(value: unknown, systemDark: boolean) {
  const preference = normalizeTheme(value);
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

let preference = 'system';
export function themePreference() { return preference; }
function startTheme() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const apply = (value: unknown) => {
    preference = normalizeTheme(value);
    document.documentElement.dataset.theme = resolveTheme(preference, media.matches);
    document.documentElement.dataset.themePreference = preference;
    window.dispatchEvent(new Event('imagetaken-themechange'));
  };
  apply('system');
  media.addEventListener('change', () => { if (preference === 'system') apply('system'); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[THEME_KEY]) apply(changes[THEME_KEY].newValue);
  });
  return chrome.storage.local.get(THEME_KEY).then(values => apply(values[THEME_KEY]));
}
export const themeReady = typeof document === 'undefined' ? Promise.resolve() : startTheme();
// Keep system mode usable if stored preferences cannot be read. Settings can
// still report the storage error through its normal save/read controls.
themeReady.catch(console.error);
