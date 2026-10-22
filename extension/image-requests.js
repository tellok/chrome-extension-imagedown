import { responseImage } from './image-bytes.js';
import { refererOrigins, firstImage } from './extraction-tasks.js';
export const RULE_START = 710000;
export const RULE_END = 719999;
export function createRequestManager({ dnr, extensionId, fetcher = (...args) => fetch(...args) }) {
  const queues = new Map(); let nextRule = RULE_START, active = 0;
  const waiting = [];
  let poisoned = false;
  // A modified-header request is exclusive across URLs: otherwise an ordinary
  // request redirecting to its URL could inherit its temporary Referer rule.
  let readers = 0, writer = false;
  const networkQueue = [];
  function pump() {
    if (writer || !networkQueue.length) return;
    if (networkQueue[0].exclusive) {
      if (readers) return;
      writer = true; const next = networkQueue.shift();
      next.resolve(() => { writer = false; pump(); });
    } else {
      while (networkQueue.length && !networkQueue[0].exclusive) {
        readers++; const next = networkQueue.shift();
        next.resolve(() => { readers--; pump(); });
      }
    }
  }
  function networkLease(exclusive) {
    return new Promise(resolve => { networkQueue.push({ exclusive, resolve }); pump(); });
  }
  async function clean() {
    const rules = await dnr.getSessionRules();
    const ids = rules.filter(rule => rule.id >= RULE_START && rule.id <= RULE_END).map(rule => rule.id);
    if (ids.length) await dnr.updateSessionRules({ removeRuleIds: ids });
    poisoned = false;
  }
  const ready = clean(); ready.catch(() => { poisoned = true; });
  async function lock(url, operation, exclusive = false) {
    const task = (queues.get(url) || Promise.resolve()).catch(() => {}).then(async () => {
      await ready;
      if (poisoned) throw new Error('Temporary request rules could not be cleared');
      if (active >= 2) await new Promise(resolve => waiting.push(resolve)); else active++;
      const releaseNetwork = await networkLease(exclusive);
      try { return await operation(); }
      finally { releaseNetwork(); const next = waiting.shift(); if (next) next(); else active--; }
    });
    queues.set(url, task);
    task.finally(() => { if (queues.get(url) === task) queues.delete(url); }).catch(() => {});
    return task;
  }
  async function attempt(url, referer, refresh, signal) {
    let id;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Image request timed out')), 12000);
    try {
      signal?.throwIfAborted();
      if (referer) {
        const regex = '^' + url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
        const supported = await dnr.isRegexSupported({ regex, isCaseSensitive: true, requireCapturing: false });
        if (!supported.isSupported) throw new Error('Exact URL rule unsupported');
        id = nextRule++; if (nextRule > RULE_END) nextRule = RULE_START;
        await dnr.updateSessionRules({ addRules: [{ id, priority: 1, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: referer }] },
          condition: { regexFilter: regex, isUrlFilterCaseSensitive: true, initiatorDomains: [extensionId], resourceTypes: ['xmlhttprequest'] } }] });
      }
      const combined = controller.signal;
      const response = await fetcher(url, { credentials: 'include', cache: refresh ? 'reload' : 'force-cache', signal: combined });
      try { return await responseImage(response, combined); }
      catch (error) { error.responseURL = response.url; throw error; }
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (id !== undefined) {
        try { await dnr.updateSessionRules({ removeRuleIds: [id] }); }
        catch (error) { poisoned = true; throw error; }
      }
    }
  }
  return {
    ready, clean,
    subscription(url, options) { return lock(url, () => fetcher(url, options)); },
    image(url, pageURL, { refresh = false, signal } = {}) {
      let finalURL = url;
      const pageOrigin = refererOrigins(pageURL, pageURL)[0];
      const run = (target, referer, method) => lock(target, async () => {
        try { return { ...await attempt(target, referer, refresh, signal), method }; }
        catch (error) {
          try { if (/^https?:$/.test(new URL(error.responseURL).protocol)) finalURL = error.responseURL; } catch { /* No confirmed redirect. */ }
          throw error;
        }
      }, !!referer);
      const tried = new Set();
      return firstImage([
        ['Fetch', () => run(url, '', 'extension-fetch')],
        ['Page Referer', () => {
          if (!pageOrigin) throw new Error('Page origin unavailable');
          tried.add(pageOrigin); return run(url, pageOrigin, 'page-referer-fetch');
        }],
        ['Image Referer', () => {
          const origin = refererOrigins(finalURL, finalURL)[0];
          if (!origin || tried.has(origin)) throw new Error('Duplicate origin');
          return run(finalURL, origin, 'image-referer-fetch');
        }],
      ], signal);
    },
  };
}
