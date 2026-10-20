import { catalogs } from './locales/catalogs.js';

export const LANGUAGE_KEY = 'settings:language';
export const SUPPORTED_LANGUAGES = ['ja', 'de', 'en', 'zh-CN', 'zh-TW', 'ko', 'fr'];
export function resolveLanguage(preference = 'auto', languages = []) {
  if (SUPPORTED_LANGUAGES.includes(preference)) return preference;
  for (const candidate of languages) {
    const tag = candidate.toLowerCase().replaceAll('_', '-');
    if (tag.startsWith('zh')) return /(?:tw|hk|mo|hant)/.test(tag) ? 'zh-TW' : 'zh-CN';
    const base = tag.split('-')[0];
    if (SUPPORTED_LANGUAGES.includes(base)) return base;
  }
  return 'en';
}
const browserLanguages = () => globalThis.navigator?.languages?.length ? navigator.languages : [globalThis.chrome?.i18n?.getUILanguage?.() || 'en'];
let preference = 'auto';
let language = typeof window === 'undefined' && !globalThis.chrome?.i18n ? 'zh-CN' : resolveLanguage('auto', browserLanguages());
export function currentLanguage() { return language; }
export function languagePreference() { return preference; }
export function setLanguage(value) {
  const previousLanguage = language;
  preference = SUPPORTED_LANGUAGES.includes(value) ? value : 'auto';
  language = resolveLanguage(preference, browserLanguages());
  if (typeof document !== 'undefined') document.documentElement.lang = language;
  globalThis.dispatchEvent?.(Object.assign(new Event('imagetaken-languagechange'), { previousLanguage }));
}
export async function initI18n() {
  const values = await chrome.storage.local.get(LANGUAGE_KEY);
  setLanguage(values[LANGUAGE_KEY]);
}
export function t(source, ...values) {
  const translated = catalogs[language]?.[source] ?? catalogs.en?.[source] ?? source;
  return translated.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match);
}
// Collector scripts execute in the web page, without module imports. Translate
// their structured error/metadata strings only when they enter extension UI.
export function translatedSource(source) { return typeof source === 'string' ? source.split('；').map(part => t(part)).join('; ') : source; }

export function translateRendered(text, fromLanguage) {
  for (const [source, previous] of Object.entries(catalogs[fromLanguage] || {})) {
    if (previous === text) return t(source);
    if (!previous.includes('{')) continue;
    const indices = [];
    const pattern = previous.split(/(\{\d+\})/).map(part => {
      if (/^\{\d+\}$/.test(part)) { indices.push(Number(part.slice(1, -1))); return '([\\s\\S]*?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    const match = new RegExp(`^${pattern}$`).exec(text);
    if (match) {
      const values = [];
      indices.forEach((index, offset) => { values[index] = match[offset + 1]; });
      return t(source, ...values);
    }
  }
  return text;
}

const bindings = [];
export function bindDocument(root = document) {
  function walk(node) {
    if (node.nodeType === 3 && /[\u3400-\u9fff]/.test(node.data)) {
      const original = node.data;
      let last = original;
      bindings.push(() => {
        if (node.data !== last) return;
        last = original.replace(/\S[\s\S]*\S|\S/, text => t(text));
        node.data = last;
      });
    } else if (node.nodeType === 1 || node.nodeType === 9 || node.nodeType === 11) {
      if (node.nodeType === 1) {
        for (const attr of ['title', 'placeholder', 'aria-label', 'alt']) {
          const original = node.getAttribute(attr);
          if (original && /[\u3400-\u9fff]/.test(original)) {
            let last = original;
            bindings.push(() => {
              if (node.getAttribute(attr) !== last) return;
              last = t(original); node.setAttribute(attr, last);
            });
          }
        }
        if (node.tagName === 'TEMPLATE') walk(node.content);
      }
      for (const child of node.childNodes) walk(child);
    }
  }
  walk(root);
  localizeDocument();
}
export function localizeDocument() {
  for (const update of bindings) update();
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}
if (globalThis.chrome?.storage?.onChanged) chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[LANGUAGE_KEY]) setLanguage(changes[LANGUAGE_KEY].newValue);
});
globalThis.addEventListener?.('languagechange', () => {
  if (preference === 'auto') setLanguage('auto');
});
