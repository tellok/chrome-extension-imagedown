import { t } from './i18n.js';
import { DEFAULT_THRESHOLDS, THRESHOLD_KEYS, normalizeThreshold, ignoreStorageKey } from './metadata.js';

export const VIEW_FILTERS_KEY = 'filters:view:v1';
export function normalizeViewFilters(value = {}) {
  const types = ['', 'jpg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico', 'unknown'];
  const sources = ['', 'img', 'css', 'pseudo', 'canvas', 'svg', 'lazy', 'srcset', 'resource', 'poster', 'link'];
  return {
    type: types.includes(value?.type) ? value.type : '',
    source: sources.includes(value?.source) ? value.source : '',
    loaded: value?.loaded === true, showIgnored: value?.showIgnored === true,
  };
}
export async function loadViewFilters() {
  return normalizeViewFilters((await chrome.storage.local.get(VIEW_FILTERS_KEY))[VIEW_FILTERS_KEY]);
}
export function saveViewFilters(value) {
  return chrome.storage.local.set({ [VIEW_FILTERS_KEY]: normalizeViewFilters(value) });
}

let queryWrites = Promise.resolve();
export function queryStorageKey(domain) { return `image-query:v1:${domain}`; }
export async function loadQuery(domain) {
  if (!domain) return '';
  await queryWrites;
  const key = queryStorageKey(domain);
  const value = (await chrome.storage.local.get(key))[key];
  return typeof value === 'string' ? value : '';
}
export function saveQuery(domain, value) {
  if (!domain) return Promise.resolve();
  const key = queryStorageKey(domain);
  const operation = queryWrites.then(() => value ? chrome.storage.local.set({ [key]: value }) : chrome.storage.local.remove(key));
  queryWrites = operation.catch(() => {});
  return operation;
}

export async function loadThresholds() {
  const values = await chrome.storage.local.get(Object.values(THRESHOLD_KEYS));
  return Object.fromEntries(Object.entries(THRESHOLD_KEYS).map(([field, key]) =>
    [field, normalizeThreshold(values[key] ?? DEFAULT_THRESHOLDS[field], DEFAULT_THRESHOLDS[field])]));
}

export async function saveThresholds(values) {
  await chrome.storage.local.set(Object.fromEntries(Object.entries(values).map(([field, value]) =>
    [THRESHOLD_KEYS[field], normalizeThreshold(value, DEFAULT_THRESHOLDS[field])])));
}

export async function loadIgnored(domain) {
  if (!domain) return new Set();
  const key = ignoreStorageKey(domain);
  const values = (await chrome.storage.local.get(key))[key];
  return new Set(Array.isArray(values) ? values : []);
}

export async function setIgnored(domain, hash, ignored) {
  const response = await chrome.runtime.sendMessage({ type: 'set-ignored', domain, hash, ignored });
  if (!response?.ok) throw new Error(response?.error || t('无法保存忽略规则'));
}

export function xpathStorageKey(domain) { return `xpath:v1:${domain}`; }
export async function loadXPath(domain) {
  if (!domain) return '';
  const key = xpathStorageKey(domain);
  const value = (await chrome.storage.local.get(key))[key];
  return typeof value === 'string' ? value : '';
}
export function exclusionsStorageKey(domain) { return `excluded-selectors:v1:${domain}`; }
export async function loadExclusions(domain) {
  if (!domain) return '';
  const key = exclusionsStorageKey(domain);
  const value = (await chrome.storage.local.get(key))[key];
  return typeof value === 'string' ? value : '';
}
