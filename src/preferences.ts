import { reply } from './guards.js';




import type { Thresholds, ThresholdField } from "./models.js";
import { object } from "./guards.js";
import { saveConfig, removeConfig } from './config-lock.js';
import { t } from './i18n.js';
import { DEFAULT_THRESHOLDS, THRESHOLD_KEYS, normalizeThreshold, ignoreStorageKey, siteDomain } from './metadata.js';

export const VIEW_FILTERS_KEY = 'filters:view:v1';
export function normalizeViewFilters(value: unknown = {}) {
  const candidate = object(value) ? value : {};
  const types = ['', 'jpg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico', 'unknown'];
  const sources = ['', 'img', 'css', 'pseudo', 'canvas', 'svg', 'lazy', 'srcset', 'resource', 'poster', 'link'];
  return {
    type: typeof candidate.type === 'string' && types.includes(candidate.type) ? candidate.type : '',
    source: typeof candidate.source === 'string' && sources.includes(candidate.source) ? candidate.source : '',
    loaded: candidate.loaded === true, showIgnored: candidate.showIgnored === true,
  };
}
export async function loadViewFilters() {
  return normalizeViewFilters((await chrome.storage.local.get(VIEW_FILTERS_KEY))[VIEW_FILTERS_KEY]);
}
export function saveViewFilters(value: unknown) {
  return saveConfig({ [VIEW_FILTERS_KEY]: normalizeViewFilters(value) });
}

let queryWrites = Promise.resolve();
export function queryStorageKey(domain: string) { return `image-query:v1:${domain}`; }
export async function loadQuery(domain: string) {
  if (!domain) return '';
  await queryWrites;
  const key = queryStorageKey(domain);
  const value = (await chrome.storage.local.get(key))[key];
  return typeof value === 'string' ? value : '';
}
export function saveQuery(domain: string, value: string, explicitEmpty = false) {
  if (!domain) return Promise.resolve();
  // A panel can reload while waiting for the configuration lock. Let the
  // worker own queued search writes so closing that view cannot cancel them.
  if (globalThis.location?.protocol === 'chrome-extension:' && location.pathname === '/panel.html') {
    return chrome.runtime.sendMessage({ type: 'save-image-query', domain, value, explicitEmpty }).then((value: unknown) => {
      const result = reply(value);
      if (!result?.ok) throw new Error(String(result?.error || 'Cannot save image query'));
    });
  }
  const key = queryStorageKey(domain);
  const operation = queryWrites.then(() => value || explicitEmpty ? saveConfig({ [key]: value }) : removeConfig(key));
  queryWrites = operation.catch(() => {});
  return operation;
}

export const GLOBAL_DIMENSION_KEYS: Record<string, string> = { width: THRESHOLD_KEYS.width, height: THRESHOLD_KEYS.height };
const thresholdFields: ThresholdField[] = ['width', 'height', 'minBytes'];
function validDomain(domain: unknown) {
  return typeof domain === 'string' && !!domain && siteDomain(`https://${domain}`) === domain;
}
export function thresholdStorageKey(domain: string, field: string) {
  if (!validDomain(domain) || !thresholdFields.some(key => key === field)) throw new Error(t('无法确定当前网站，未保存筛选设置。'));
  return `filters:site:v1:${domain}:${field}`;
}
function storedThreshold(value: unknown, fallback: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
export function thresholdChanges(changes: Record<string, unknown>, domain: string) {
  return Object.keys(GLOBAL_DIMENSION_KEYS).some(field => changes[GLOBAL_DIMENSION_KEYS[field]]) ||
    (validDomain(domain) && thresholdFields.some(field => changes[thresholdStorageKey(domain, field)]));
}
export async function loadGlobalDimensions() {
  const values = await chrome.storage.local.get(Object.values(GLOBAL_DIMENSION_KEYS));
  return Object.fromEntries(Object.entries(GLOBAL_DIMENSION_KEYS).map(([field, key]) =>
    [field, storedThreshold(values[key], ({ ...DEFAULT_THRESHOLDS } satisfies Thresholds)[field])]));
}
export function saveGlobalDimensions(values: Record<string, unknown>) {
  const entries = Object.entries(values);
  if (!entries.length || entries.some(([field, value]) => !Object.hasOwn(GLOBAL_DIMENSION_KEYS, field) ||
      typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100000)) {
    throw new Error(t('请输入 0 至 100000 的整数。'));
  }
  return saveConfig(Object.fromEntries(entries.map(([field, value]) => [GLOBAL_DIMENSION_KEYS[field], value])));
}
export async function loadThresholdState(domain: string) {
  const siteKeys = validDomain(domain) ? thresholdFields.map(field => thresholdStorageKey(domain, field)) : [];
  const saved = await chrome.storage.local.get([...Object.values(GLOBAL_DIMENSION_KEYS), ...siteKeys]);
  const defaults: Thresholds = { ...DEFAULT_THRESHOLDS };
  const overrides: Partial<Thresholds> = {}, values: Thresholds = { ...defaults };
  for (const field of thresholdFields) {
    if (field !== 'minBytes') defaults[field] = storedThreshold(saved[GLOBAL_DIMENSION_KEYS[field]], defaults[field]) ?? defaults[field];
    const override = storedThreshold(validDomain(domain) ? saved[thresholdStorageKey(domain, field)] : undefined, undefined);
    if (override !== undefined) overrides[field] = override;
    values[field] = override ?? defaults[field];
  }
  return { values, defaults, overrides };
}
export async function loadThresholds(domain: string) {
  return (await loadThresholdState(domain)).values;
}

export async function saveThresholds(domain: string, values: Partial<Thresholds>) {
  const entries = Object.entries(values).map(([field, value]) =>
    [thresholdStorageKey(domain, field), normalizeThreshold(value, ({ ...DEFAULT_THRESHOLDS } satisfies Thresholds)[field])]);
  if (entries.length) await saveConfig(Object.fromEntries(entries));
}
export async function resetThresholds(domain: string, fields = thresholdFields) {
  await removeConfig(fields.map(field => thresholdStorageKey(domain, field)));
}

export async function loadIgnored(domain: string) {
  if (!domain) return new Set<string>();
  const key = ignoreStorageKey(domain);
  const values = (await chrome.storage.local.get(key))[key];
  return new Set(Array.isArray(values) ? values.filter((value: unknown): value is string => typeof value === "string") : []);
}

export async function setIgnored(domain: string, hash: string | undefined, ignored: boolean) {
  const response = reply(await chrome.runtime.sendMessage({ type: 'set-ignored', domain, hash, ignored }));
  if (!response?.ok) throw new Error(String(response?.error || t('无法保存忽略规则')));
}

export function xpathStorageKey(domain: string) { return `xpath:v1:${domain}`; }
export async function loadXPath(domain: string) {
  if (!domain) return '';
  const key = xpathStorageKey(domain);
  const value = (await chrome.storage.local.get(key))[key];
  return typeof value === 'string' ? value : '';
}
export function exclusionsStorageKey(domain: string) { return `excluded-selectors:v1:${domain}`; }
export async function loadExclusions(domain: string) {
  if (!domain) return '';
  const key = exclusionsStorageKey(domain);
  const value = (await chrome.storage.local.get(key))[key];
  return typeof value === 'string' ? value : '';
}
