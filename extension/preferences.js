import { DEFAULT_THRESHOLDS, THRESHOLD_KEYS, normalizeThreshold, ignoreStorageKey } from './metadata.js';

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
  if (!response?.ok) throw new Error(response?.error || '无法保存忽略规则');
}
