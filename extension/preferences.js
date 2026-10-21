import { t } from './i18n.js';
import { DEFAULT_THRESHOLDS, THRESHOLD_KEYS, normalizeThreshold, ignoreStorageKey, siteDomain } from './metadata.js';

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

export const GLOBAL_DIMENSION_KEYS = { width: THRESHOLD_KEYS.width, height: THRESHOLD_KEYS.height };
const thresholdFields = Object.keys(DEFAULT_THRESHOLDS);
function validDomain(domain) {
  return typeof domain === 'string' && !!domain && siteDomain(`https://${domain}`) === domain;
}
export function thresholdStorageKey(domain, field) {
  if (!validDomain(domain) || !thresholdFields.includes(field)) throw new Error(t('无法确定当前网站，未保存筛选设置。'));
  return `filters:site:v1:${domain}:${field}`;
}
function storedThreshold(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
export function thresholdChanges(changes, domain) {
  return Object.keys(GLOBAL_DIMENSION_KEYS).some(field => changes[GLOBAL_DIMENSION_KEYS[field]]) ||
    (validDomain(domain) && thresholdFields.some(field => changes[thresholdStorageKey(domain, field)]));
}
export async function loadGlobalDimensions() {
  const values = await chrome.storage.local.get(Object.values(GLOBAL_DIMENSION_KEYS));
  return Object.fromEntries(Object.entries(GLOBAL_DIMENSION_KEYS).map(([field, key]) =>
    [field, storedThreshold(values[key], DEFAULT_THRESHOLDS[field])]));
}
export function saveGlobalDimensions(values) {
  const entries = Object.entries(values);
  if (!entries.length || entries.some(([field, value]) => !Object.hasOwn(GLOBAL_DIMENSION_KEYS, field) ||
      typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100000)) {
    throw new Error(t('请输入 0 至 100000 的整数。'));
  }
  return chrome.storage.local.set(Object.fromEntries(entries.map(([field, value]) => [GLOBAL_DIMENSION_KEYS[field], value])));
}
export async function loadThresholds(domain) {
  const siteKeys = validDomain(domain) ? thresholdFields.map(field => thresholdStorageKey(domain, field)) : [];
  const values = await chrome.storage.local.get([...Object.values(GLOBAL_DIMENSION_KEYS), ...siteKeys]);
  return Object.fromEntries(thresholdFields.map(field => {
    const fallback = field === 'minBytes' ? DEFAULT_THRESHOLDS.minBytes : storedThreshold(values[GLOBAL_DIMENSION_KEYS[field]], DEFAULT_THRESHOLDS[field]);
    return [field, storedThreshold(validDomain(domain) ? values[thresholdStorageKey(domain, field)] : undefined, fallback)];
  }));
}
export async function saveThresholds(domain, values) {
  const entries = Object.entries(values).map(([field, value]) =>
    [thresholdStorageKey(domain, field), normalizeThreshold(value, DEFAULT_THRESHOLDS[field])]);
  if (entries.length) await chrome.storage.local.set(Object.fromEntries(entries));
}
export async function resetThresholds(domain) {
  await chrome.storage.local.remove(thresholdFields.map(field => thresholdStorageKey(domain, field)));
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
