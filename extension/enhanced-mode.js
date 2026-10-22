import { siteDomain } from './metadata.js';
import { saveConfig } from './config-lock.js';
export const ENHANCED_PREFIX = 'enhanced-mode:v1:';
export function enhancedKey(host) {
  const normalized = siteDomain(`https://${host}`);
  if (!normalized || normalized !== host || /[\s/?#@\\]/.test(host)) throw new Error('Invalid source website');
  return ENHANCED_PREFIX + host;
}
export async function loadEnhanced(host) {
  const key = enhancedKey(host);
  return (await chrome.storage.local.get(key))[key] === true;
}
export async function saveEnhanced(host, value) {
  if (typeof value !== 'boolean') throw new Error('Invalid website permission');
  await saveConfig({ [enhancedKey(host)]: value });
}
export async function sourceContext(tabId) {
  const tab = await chrome.tabs.get(tabId), hostname = siteDomain(tab.url);
  if (!hostname) throw new Error('Source page unavailable');
  const [result] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: () => location.href });
  if (!result?.documentId) throw new Error('Source page unavailable');
  return { tabId, hostname, documentId: result.documentId, url: tab.url };
}
export async function checkContext(expected) {
  const current = await sourceContext(expected.tabId);
  if (current.hostname !== expected.hostname || current.documentId !== expected.documentId) throw new Error('Source page changed');
  return current;
}
