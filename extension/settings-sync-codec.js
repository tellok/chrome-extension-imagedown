import { parseSubscription, REMOTE_RULES_KEY } from './remote-rules.js';

export const SYNC_PREFIX = 'config-sync:v1:';
export const SYNC_ENABLED_KEY = 'settings:chrome-sync';
export const SYNC_STATE_KEY = 'config-sync:state';
export const SYNC_IMPORT_KEY = 'config-sync:import';
export const SETTING_KEYS = ['settings:language', 'settings:theme', 'settings:auto-clean-title', 'settings:ready-first', 'settings:download-manifest', 'filters:width', 'filters:height', 'filters:view:v1'];
const sitePrefixes = { width: 'filters:site:v1:', height: 'filters:site:v1:', minBytes: 'filters:site:v1:', xpath: 'xpath:v1:', excludedSelectors: 'excluded-selectors:v1:', query: 'image-query:v1:', ignored: 'ignored:v1:' };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function requireValue(ok, field) { if (!ok) throw new Error(`Invalid sync data: ${field}`); }
function keys(v, allowed, field) { requireValue(object(v) && Object.keys(v).every(k => allowed.includes(k)), field); }
export const canonical = value => JSON.stringify(value, (_k, v) => object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const bytes = text => new TextEncoder().encode(text).length;
export async function digest(text) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n => n.toString(16).padStart(2, '0')).join(''); }
function domainValid(host) {
  try { return typeof host === 'string' && host.length <= 253 && new URL(`https://${host}`).hostname === host && !/[\s/?#@\\%]/.test(host); } catch { return false; }
}
function number(value, dimension) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!dimension || (Number.isInteger(value) && value <= 100000)); }
function view(value) {
  keys(value, ['type', 'source', 'loaded', 'showIgnored'], 'view');
  for (const [key, v] of Object.entries(value)) {
    if (key === 'type') requireValue(['', 'jpg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico', 'unknown'].includes(v), key);
    else if (key === 'source') requireValue(['', 'img', 'css', 'pseudo', 'canvas', 'svg', 'lazy', 'srcset', 'resource', 'poster', 'link'].includes(v), key);
    else requireValue(typeof v === 'boolean', key);
  }
}
export function validatePayload(value) {
  keys(value, ['version', 'settings', 'sites', 'subscriptions'], 'payload');
  requireValue(value.version === 1 && object(value.settings) && object(value.sites) && Array.isArray(value.subscriptions), 'version/sections');
  keys(value.settings, SETTING_KEYS, 'settings');
  for (const [key, v] of Object.entries(value.settings)) {
    if (key === 'settings:language') requireValue(['auto', 'ja', 'de', 'en', 'zh-CN', 'zh-TW', 'ko', 'fr'].includes(v), key);
    else if (key === 'settings:theme') requireValue(['system', 'light', 'dark'].includes(v), key);
    else if (key.startsWith('settings:')) requireValue(typeof v === 'boolean', key);
    else if (key === 'filters:view:v1') view(v);
    else requireValue(number(v, true), key);
  }
  for (const [host, fields] of Object.entries(value.sites)) {
    requireValue(domainValid(host), 'hostname'); keys(fields, Object.keys(sitePrefixes), 'site fields');
    requireValue(Object.keys(fields).length > 0, 'empty site fields');
    for (const [key, v] of Object.entries(fields)) {
      if (['width', 'height', 'minBytes'].includes(key)) requireValue(number(v, key !== 'minBytes'), key);
      else if (key === 'ignored') requireValue(Array.isArray(v) && v.every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)), key);
      else requireValue(typeof v === 'string', key);
    }
  }
  requireValue(value.subscriptions.length <= 20 && new Set(value.subscriptions).size === value.subscriptions.length, 'subscriptions');
  for (const url of value.subscriptions) requireValue(typeof url === 'string' && parseSubscription(url).url === url, 'subscription URL');
  const result = structuredClone(value);
  for (const site of Object.values(result.sites)) if (site.ignored) site.ignored = [...new Set(site.ignored)].sort();
  return result;
}
export function siteKey(host, field) { return `${sitePrefixes[field]}${host}${['width', 'height', 'minBytes'].includes(field) ? `:${field}` : ''}`; }
export function configKey(key) { return SETTING_KEYS.includes(key) || key === REMOTE_RULES_KEY || Object.values(sitePrefixes).some(prefix => key.startsWith(prefix)); }
export function exportPayload(local) {
  const payload = { version: 1, settings: {}, sites: {}, subscriptions: [] };
  for (const key of SETTING_KEYS) if (local[key] != null) payload.settings[key] = local[key];
  for (const [key, value] of Object.entries(local)) {
    if (value == null) continue;
    for (const [field, prefix] of Object.entries(sitePrefixes)) {
      if (!key.startsWith(prefix)) continue;
      let host = key.slice(prefix.length);
      if (['width', 'height', 'minBytes'].includes(field)) { if (!host.endsWith(`:${field}`)) continue; host = host.slice(0, -field.length - 1); }
      if (!Object.hasOwn(payload.sites, host)) Object.defineProperty(payload.sites, host, { value: {}, enumerable: true });
      payload.sites[host][field] = value;
    }
  }
  if (local[REMOTE_RULES_KEY] != null) {
    requireValue(Array.isArray(local[REMOTE_RULES_KEY].entries), 'local subscriptions');
    payload.subscriptions = local[REMOTE_RULES_KEY].entries.map(entry => parseSubscription(entry.url).url);
  }
  return validatePayload(payload);
}
export function payloadWrites(payload, local) {
  const valid = validatePayload(payload), values = {};
  for (const key of Object.keys(local)) if (configKey(key) && key !== REMOTE_RULES_KEY) values[key] = null;
  Object.assign(values, valid.settings);
  for (const [host, fields] of Object.entries(valid.sites)) for (const [field, v] of Object.entries(fields)) values[siteKey(host, field)] = v;
  return values;
}
export function joinVectors(vectors) {
  const joined = {};
  for (const vector of vectors) for (const [id, n] of Object.entries(vector)) Object.defineProperty(joined, id, { value: Math.max(joined[id] || 0, n), enumerable: true, configurable: true, writable: true });
  return joined;
}
export function dominates(a, b) { return Object.keys({ ...a, ...b }).every(k => (a[k] || 0) >= (b[k] || 0)) && Object.keys(a).some(k => a[k] > (b[k] || 0)); }
export function frontier(heads) { return heads.filter(h => !heads.some(other => dominates(other.vector, h.vector))); }
function validHead(head, key) {
  keys(head, ['version', 'deviceId', 'revision', 'vector', 'updatedAt', 'payloadHash', 'chunks', 'length'], 'head');
  requireValue(head.version === 1 && /^[a-f0-9-]{36}$/.test(head.deviceId) && /^[a-f0-9-]{36}$/.test(head.revision) && key === `${SYNC_PREFIX}${head.deviceId}:${head.revision}:head`, 'head identity');
  requireValue(object(head.vector) && Object.keys(head.vector).length > 0 && Object.entries(head.vector).every(([id,n]) => /^[a-f0-9-]{36}$/.test(id) && Number.isSafeInteger(n) && n >= 0) && head.vector[head.deviceId] > 0, 'vector');
  requireValue(Number.isFinite(head.updatedAt) && Number.isSafeInteger(head.length) && head.length >= 0 && /^[a-f0-9]{64}$/.test(head.payloadHash), 'head metadata');
  requireValue(Array.isArray(head.chunks) && head.chunks.length > 0 && head.chunks.every((k,i) => k === `${SYNC_PREFIX}${head.deviceId}:${head.revision}:${i}`), 'chunk refs');
}
export async function encodePayload(payload, deviceId, vector, updatedAt = Date.now(), revision = crypto.randomUUID()) {
  const text = canonical(validatePayload(payload)), raw = new TextEncoder().encode(text);
  let binary = ''; for (const byte of raw) binary += String.fromCharCode(byte);
  const base64 = btoa(binary), chunks = {}, names = [];
  for (let i = 0; i < base64.length; i += 6000) { const key = `${SYNC_PREFIX}${deviceId}:${revision}:${names.length}`; names.push(key); chunks[key] = base64.slice(i, i + 6000); }
  const head = { version: 1, deviceId, revision, vector, updatedAt, payloadHash: await digest(text), chunks: names, length: raw.length };
  const key = `${SYNC_PREFIX}${deviceId}:${revision}:head`; validHead(head, key);
  const entries = { ...chunks, [key]: head }; budget({}, entries);
  return { key, head, chunks, entries };
}
export async function readVersions(data, validateSelectors = async () => {}) {
  const names = Object.keys(data).filter(k => k.startsWith(SYNC_PREFIX));
  const heads = names.filter(k => k.endsWith(':head')).map(key => { validHead(data[key], key); return { ...data[key], key }; });
  const active = frontier(heads), versions = [];
  for (const head of active) {
    const encoded = head.chunks.map(k => { requireValue(typeof data[k] === 'string', 'missing chunk'); return data[k]; }).join('');
    let raw; try { raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); } catch { throw new Error('Invalid sync data: base64'); }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    requireValue(raw.length === head.length && await digest(text) === head.payloadHash, 'hash/length');
    const payload = validatePayload(JSON.parse(text)); requireValue(canonical(payload) === text, 'canonical payload'); await validateSelectors(payload);
    versions.push({ head, payload });
  }
  // Headless fragments are not an empty cloud. Known older fragments may await cleanup.
  if (!heads.length && names.length) throw new Error('Invalid sync data: missing head');
  const referenced = new Set(heads.flatMap(h => [h.key, ...h.chunks]));
  if (names.some(k => !referenced.has(k))) throw new Error('Invalid sync data: unreferenced data');
  return versions;
}
export function budget(existing, additions, limits = {}) {
  const all = { ...existing, ...additions }, sizes = Object.entries(all).map(([key, value]) => bytes(key) + bytes(JSON.stringify(value)));
  requireValue(Object.entries(additions).every(([key,v]) => bytes(key) + bytes(JSON.stringify(v)) <= 7 * 1024), 'item quota');
  requireValue(sizes.reduce((a,b) => a+b, 0) <= (limits.QUOTA_BYTES ?? 102400) && sizes.length <= (limits.MAX_ITEMS ?? 512), 'total quota');
  return sizes.reduce((a,b) => a+b, 0);
}
