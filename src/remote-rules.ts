import type { RuleDocument, RuleMatch, Subscription, LocalPreferences, RuleOptions, Filters, Thresholds, EffectiveState, RuleValues } from "./models.js";
// Data-only schema shared by the background, offscreen host and validation tools.
export const REMOTE_RULES_KEY = 'remote-rules:v1';
export const RULE_LIMITS = { entries: 20, rules: 100, fileBytes: 256 * 1024, cacheBytes: 4 * 1024 * 1024, timeout: 10000, matchTimeout: 1000 };
const types = ['', 'jpg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico', 'unknown'];
const sources = ['', 'img', 'css', 'pseudo', 'canvas', 'svg', 'lazy', 'srcset', 'resource', 'poster', 'link'];
const optionKeys: (keyof RuleOptions)[] = ['width', 'height', 'minBytes', 'xpath', 'excludedSelectors', 'query', 'type', 'source', 'loaded', 'showIgnored'];
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function requireValue(valid: unknown, field: string): asserts valid { if (!valid) throw new Error(`Invalid remote rule: ${field}`); }
function onlyKeys(value: unknown, keys: string[], field: string): asserts value is Record<string, unknown> {
  requireValue(object(value) && Object.keys(value).every(key => keys.includes(key)), field);
}
export function parseSubscription(input: string) {
  let url, filename, domain;
  try {
    url = new URL(input);
    filename = decodeURIComponent(url.pathname.split('/').at(-1) || '');
    requireValue(/^https?:$/.test(url.protocol) && !url.username && !url.password, 'source URL');
    requireValue(filename.endsWith('.json'), 'filename');
    const host = filename.slice(0, -5);
    requireValue(host && !/[\s/:?#@\\\[\]%]/.test(host), 'hostname');
    domain = new URL(`https://${host}`).hostname;
    requireValue(domain.length <= 253 && domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label) && label.length <= 63), 'hostname');
    url.hash = '';
  } catch { throw new Error('Invalid remote rule: source URL / <hostname>.json'); }
  return { url: url.href, domain };
}
function checkRuleDocument(document: unknown): asserts document is RuleDocument {
  onlyKeys(document, ['version', 'rules'], 'document');
  requireValue(document.version === 1, 'version');
  requireValue(Array.isArray(document.rules) && document.rules.length <= RULE_LIMITS.rules, 'rules');
  const ids = new Set<string>();
  for (const rule of document.rules) {
    onlyKeys(rule, ['id', 'pattern', 'flags', 'options'], 'rule fields');
    if (Object.hasOwn(rule, 'id')) {
      requireValue(typeof rule.id === 'string' && rule.id.length > 0 && rule.id.length <= 80 && !ids.has(rule.id), 'id');
      ids.add(rule.id);
    }
    requireValue(typeof rule.pattern === 'string' && rule.pattern.length > 0 && rule.pattern.length <= 256, 'pattern');
    requireValue(!Object.hasOwn(rule, 'flags') || typeof rule.flags === 'string' && ['', 'i', 'u', 'iu'].includes(rule.flags), 'flags');
    // Compiling does not execute the expression. Tests run only in a terminable worker.
    try { new RegExp(rule.pattern, typeof rule.flags === 'string' ? rule.flags : ''); } catch { throw new Error('Invalid remote rule: pattern'); }
    onlyKeys(rule.options, optionKeys, 'options');
    for (const [key, value] of Object.entries(rule.options)) {
      if (key === 'width' || key === 'height') requireValue(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100000, key);
      else if (key === 'minBytes') requireValue(typeof value === 'number' && Number.isFinite(value) && value >= 0, key);
      else if (['xpath', 'excludedSelectors', 'query'].includes(key)) requireValue(typeof value === 'string' && value.length <= (key === 'query' ? 512 : 4096), key);
      else if (key === 'type') requireValue(typeof value === 'string' && types.includes(value), key);
      else if (key === 'source') requireValue(typeof value === 'string' && sources.includes(value), key);
      else requireValue(typeof value === 'boolean', key);
    }
  }

}
export function matchRemoteRules(entries: Subscription[], pageURL: string) {
  const domain = new URL(pageURL).hostname;
  for (const entry of entries) {
    if (entry.domain !== domain || !entry.document) continue;
    const index = entry.document.rules.findIndex((rule) => new RegExp(rule.pattern, rule.flags || '').test(pageURL));
    if (index >= 0) {
      const rule = entry.document.rules[index];
      return { options: rule.options, source: { id: entry.id, url: entry.url, domain, rule: rule.id || String(index + 1) } };
    }
  }
  return { options: {}, source: null };
}
export function mergeRulePreferences(local: LocalPreferences, remote: RuleMatch = { options: {}, source: null }): EffectiveState {
  const defaults: RuleValues = { width: 50, height: 50, minBytes: 2048, xpath: '', excludedSelectors: '', query: '', type: '', source: '', loaded: false, showIgnored: false, ...local.defaults };
  const values: RuleValues = { ...defaults }, origins: Record<string, string> = {};
  function assign<K extends keyof RuleOptions>(key: K) {
    const localValue = local.overrides?.[key], remoteValue = remote.options[key];
    values[key] = localValue !== undefined ? localValue : remoteValue !== undefined ? remoteValue : defaults[key];
    origins[key] = localValue !== undefined ? 'local' : Object.hasOwn(remote.options, key) ? 'remote' : 'default';
  }
  for (const key of optionKeys) assign(key);
  const thresholdDefaults = { width: remote.options.width ?? defaults.width, height: remote.options.height ?? defaults.height, minBytes: remote.options.minBytes ?? defaults.minBytes };
  const overrides: Partial<Thresholds> = {};
  for (const key of ['width', 'height', 'minBytes'] satisfies (keyof Thresholds)[]) if (origins[key] === 'local') overrides[key] = values[key];
  return { values, origins, remote: remote.source, remoteOptions: remote.options, defaults: thresholdDefaults, overrides };
}
export function rulesChanged(change?: chrome.storage.StorageChange) { return !!change && (Number(change.oldValue && typeof change.oldValue === "object" && "revision" in change.oldValue ? change.oldValue.revision : 0) || 0) !== (Number(change.newValue && typeof change.newValue === "object" && "revision" in change.newValue ? change.newValue.revision : 0) || 0); }

export function validateRuleDocument(document: unknown): RuleDocument { checkRuleDocument(document); return structuredClone(document); }
