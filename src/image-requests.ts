
import { responseImage } from './image-bytes.js';
import { refererOrigins, firstImage } from './extraction-tasks.js';
export const RULE_START = 710000;
export const RULE_END = 719999;
export function createRequestManager({ dnr, extensionId, fetcher = (...args: Parameters<typeof fetch>) => fetch(...args) }: { dnr: Pick<typeof chrome.declarativeNetRequest, "getSessionRules" | "updateSessionRules" | "isRegexSupported">; extensionId: string; fetcher?: typeof fetch }) {
  const queues = new Map<string, Promise<unknown>>(); let nextRule = RULE_START, active = 0;
  const waiting: (() => void)[] = [];
  let poisoned = false;
  // A modified-header request is exclusive across URLs: otherwise an ordinary
  // request redirecting to its URL could inherit its temporary Referer rule.
  let readers = 0, writer = false;
  const networkQueue: { exclusive: boolean; resolve: (release: () => void) => void }[] = [];
  function pump() {
    if (writer || !networkQueue.length) return;
    if (networkQueue[0].exclusive) {
      if (readers) return;
      writer = true; const next = networkQueue.shift();
      next?.resolve(() => { writer = false; pump(); });
    } else {
      while (networkQueue.length && !networkQueue[0].exclusive) {
        readers++; const next = networkQueue.shift();
        next?.resolve(() => { readers--; pump(); });
      }
    }
  }
  function networkLease(exclusive: boolean) {
    return new Promise<() => void>(resolve => { networkQueue.push({ exclusive, resolve }); pump(); });
  }
  async function clean() {
    const rules = await dnr.getSessionRules();
    const ids = rules.filter((rule) => rule.id >= RULE_START && rule.id <= RULE_END).map((rule) => rule.id);
    if (ids.length) await dnr.updateSessionRules({ removeRuleIds: ids });
    poisoned = false;
  }
  const ready = clean(); ready.catch(() => { poisoned = true; });
  async function lock<T>(url: string, operation: () => Promise<T>, exclusive = false) {
    const task = (queues.get(url) || Promise.resolve()).catch(() => {}).then(async () => {
      await ready;
      if (poisoned) throw new Error('Temporary request rules could not be cleared');
      if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve)); else active++;
      const releaseNetwork = await networkLease(exclusive);
      try { return await operation(); }
      finally { releaseNetwork(); const next = waiting.shift(); if (next) next(); else active--; }
    });
    queues.set(url, task);
    task.finally(() => { if (queues.get(url) === task) queues.delete(url); }).catch(() => {});
    return task;
  }
  async function attempt(url: string, referer: string, refresh: boolean, signal?: AbortSignal) {
    let id;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
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
      catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); Object.assign(error, { responseURL: response.url }); throw error; }
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (id !== undefined) {
        try { await dnr.updateSessionRules({ removeRuleIds: [id] }); }
        catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); poisoned = true; throw error; }
      }
    }
  }
  return {
    ready, clean,
    subscription(url: string, options?: RequestInit) { return lock(url, () => fetcher(url, options)); },
    image(url: string, pageURL: string, { refresh = false, signal }: { refresh?: boolean; signal?: AbortSignal } = {}) {
      let finalURL = url;
      const pageOrigin = refererOrigins(pageURL, pageURL)[0];
      const run = (target: string, referer: string, method: string) => lock(target, async () => {
        try { return { ...await attempt(target, referer, refresh, signal), method }; }
        catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
          try { if (/^https?:$/.test(new URL("responseURL" in error && typeof error.responseURL === "string" ? error.responseURL : "").protocol)) finalURL = "responseURL" in error && typeof error.responseURL === "string" ? error.responseURL : finalURL; } catch { /* No confirmed redirect. */ }
          throw error;
        }
      }, !!referer);
      const tried = new Set<string>();
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
