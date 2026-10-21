// Data-only schema shared by the background, offscreen host and validation tools.
export const REMOTE_RULES_KEY = 'remote-rules:v1';
export const RULE_LIMITS = { entries: 20, rules: 100, fileBytes: 256 * 1024, cacheBytes: 4 * 1024 * 1024, timeout: 10000, matchTimeout: 1000 };
const types = ['', 'jpg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico', 'unknown'];
const sources = ['', 'img', 'css', 'pseudo', 'canvas', 'svg', 'lazy', 'srcset', 'resource', 'poster', 'link'];
const optionKeys = ['width', 'height', 'minBytes', 'xpath', 'excludedSelectors', 'query', 'type', 'source', 'loaded', 'showIgnored'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValue(valid, field) { if (!valid) throw new Error(`Invalid remote rule: ${field}`); }
function onlyKeys(value, keys, field) {
  requireValue(object(value) && Object.keys(value).every(key => keys.includes(key)), field);
}
export function parseSubscription(input) {
  let url, filename, domain;
  try {
    url = new URL(input);
    filename = decodeURIComponent(url.pathname.split('/').at(-1));
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
export function validateRuleDocument(document) {
  onlyKeys(document, ['version', 'rules'], 'document');
  requireValue(document.version === 1, 'version');
  requireValue(Array.isArray(document.rules) && document.rules.length <= RULE_LIMITS.rules, 'rules');
  const ids = new Set();
  for (const rule of document.rules) {
    onlyKeys(rule, ['id', 'pattern', 'flags', 'options'], 'rule fields');
    if (Object.hasOwn(rule, 'id')) {
      requireValue(typeof rule.id === 'string' && rule.id.length > 0 && rule.id.length <= 80 && !ids.has(rule.id), 'id');
      ids.add(rule.id);
    }
    requireValue(typeof rule.pattern === 'string' && rule.pattern.length > 0 && rule.pattern.length <= 256, 'pattern');
    requireValue(!Object.hasOwn(rule, 'flags') || ['', 'i', 'u', 'iu'].includes(rule.flags), 'flags');
    // Compiling does not execute the expression. Tests run only in a terminable worker.
    try { new RegExp(rule.pattern, rule.flags || ''); } catch { throw new Error('Invalid remote rule: pattern'); }
    onlyKeys(rule.options, optionKeys, 'options');
    for (const [key, value] of Object.entries(rule.options)) {
      if (key === 'width' || key === 'height') requireValue(Number.isInteger(value) && value >= 0 && value <= 100000, key);
      else if (key === 'minBytes') requireValue(typeof value === 'number' && Number.isFinite(value) && value >= 0, key);
      else if (['xpath', 'excludedSelectors', 'query'].includes(key)) requireValue(typeof value === 'string' && value.length <= (key === 'query' ? 512 : 4096), key);
      else if (key === 'type') requireValue(types.includes(value), key);
      else if (key === 'source') requireValue(sources.includes(value), key);
      else requireValue(typeof value === 'boolean', key);
    }
  }
  return structuredClone(document);
}
export function matchRemoteRules(entries, pageURL) {
  const domain = new URL(pageURL).hostname;
  for (const entry of entries) {
    if (entry.domain !== domain || !entry.document) continue;
    const index = entry.document.rules.findIndex(rule => new RegExp(rule.pattern, rule.flags || '').test(pageURL));
    if (index >= 0) {
      const rule = entry.document.rules[index];
      return { options: rule.options, source: { id: entry.id, url: entry.url, domain, rule: rule.id || String(index + 1) } };
    }
  }
  return { options: {}, source: null };
}
export function mergeRulePreferences(local, remote = { options: {}, source: null }) {
  const defaults = { width: 50, height: 50, minBytes: 2048, xpath: '', excludedSelectors: '', query: '', type: '', source: '', loaded: false, showIgnored: false, ...local.defaults };
  const values = {}, origins = {};
  for (const key of optionKeys) {
    const localValue = local.overrides?.[key];
    const valid = localValue !== undefined;
    values[key] = valid ? localValue : Object.hasOwn(remote.options, key) ? remote.options[key] : defaults[key];
    origins[key] = valid ? 'local' : Object.hasOwn(remote.options, key) ? 'remote' : 'default';
  }
  const thresholdDefaults = Object.fromEntries(['width', 'height', 'minBytes'].map(key => [key, Object.hasOwn(remote.options, key) ? remote.options[key] : defaults[key]]));
  return { values, origins, remote: remote.source, remoteOptions: remote.options, defaults: thresholdDefaults,
    overrides: Object.fromEntries(['width', 'height', 'minBytes'].filter(key => origins[key] === 'local').map(key => [key, values[key]])) };
}
export function rulesChanged(change) { return !!change && (change.oldValue?.revision || 0) !== (change.newValue?.revision || 0); }
