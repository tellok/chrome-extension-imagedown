import { reply, isEffectiveState } from './guards.js';
import type { Thresholds, RuleOptions, RuleMatch, EffectiveState } from "./models.js";
import { DEFAULT_THRESHOLDS, siteDomain } from './metadata.js';
import { GLOBAL_DIMENSION_KEYS, thresholdStorageKey, xpathStorageKey, exclusionsStorageKey, queryStorageKey, VIEW_FILTERS_KEY, normalizeViewFilters } from './preferences.js';
import { mergeRulePreferences } from './remote-rules.js';
export async function readLocalRulePreferences(url: string) {
  const domain = siteDomain(url);
  const keys = [...Object.values(GLOBAL_DIMENSION_KEYS), VIEW_FILTERS_KEY];
  if (domain) keys.push(...Object.keys(DEFAULT_THRESHOLDS).map(field => thresholdStorageKey(domain, field)), xpathStorageKey(domain), exclusionsStorageKey(domain), queryStorageKey(domain));
  const stored = await chrome.storage.local.get(keys), defaults: Record<string, number> = { ...DEFAULT_THRESHOLDS }, overrides: Record<string, unknown> = {};
  const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  for (const field of Object.keys(DEFAULT_THRESHOLDS)) {
    if (field !== 'minBytes' && validNumber(stored[GLOBAL_DIMENSION_KEYS[field]])) defaults[field] = Number(stored[GLOBAL_DIMENSION_KEYS[field]]);
    if (domain && validNumber(stored[thresholdStorageKey(domain, field)])) overrides[field] = stored[thresholdStorageKey(domain, field)];
  }
  for (const [field, key] of [['xpath', xpathStorageKey(domain)], ['excludedSelectors', exclusionsStorageKey(domain)], ['query', queryStorageKey(domain)]]) {
    if (domain && typeof stored[key] === 'string') overrides[field] = stored[key];
  }
  const view = stored[VIEW_FILTERS_KEY];
  if (view && typeof view === 'object' && !Array.isArray(view)) {
    const normalized: Record<string, string | boolean> = normalizeViewFilters(view);
    for (const field of Object.keys(normalized)) if (Object.hasOwn(view, field) && Reflect.get(view, field) === normalized[field]) overrides[field] = normalized[field];
  }
  return { defaults, overrides };
}
export async function effectivePreferences(url: string, resolve: (url: string) => Promise<RuleMatch & { revision?: number; error?: string }>) {
  const remote = await resolve(url);
  const local = await readLocalRulePreferences(url);
  return { ...mergeRulePreferences(local, remote), revision: remote.revision, error: remote.error || '' };
}
export async function loadEffectivePreferences(url: string) {
  const result = reply(await chrome.runtime.sendMessage({ type: 'remote-rules', operation: 'effective', url }));
  if (!result?.ok) throw new Error(String(result?.error || 'Cannot read effective image rules'));
  if (!isEffectiveState(result.result)) throw new Error('Invalid effective preferences'); return result.result;
}
