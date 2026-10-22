import type { Storage, AlarmAPI, RuleDocument, Subscription, SubscriptionState, RuleMatch } from "./models.js";
import { object } from "./guards.js";
import { withConfigLock } from './config-lock.js';
import { REMOTE_RULES_KEY, RULE_LIMITS, parseSubscription, validateRuleDocument } from './remote-rules.js';
export const RULES_ALARM = 'imagetaken-remote-rules';
export const REFRESH_INTERVAL = 6 * 60 * 60 * 1000;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const canonical = (value: unknown) => JSON.stringify(value, (_key: string, item: unknown) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export function createSubscriptionManager({ storage, alarms, fetcher = fetch, validateSelectors, match, now = Date.now, timer = setTimeout, cancelTimer = clearTimeout }: { storage: Storage; alarms: AlarmAPI; fetcher?: typeof fetch; validateSelectors: (document: RuleDocument) => Promise<unknown>; match: (entries: Subscription[], url: string) => Promise<RuleMatch>; now?: () => number; timer?: typeof setTimeout; cancelTimer?: typeof clearTimeout }) {
  let mutations = Promise.resolve(), active = 0;
  const pending: (() => void)[] = [], inFlight = new Map<string, Promise<void>>(), matches = new Map<string, Promise<RuleMatch & { revision: number; error?: string }>>();
  async function read(): Promise<SubscriptionState> {
    const saved = (await storage.get(REMOTE_RULES_KEY))[REMOTE_RULES_KEY];
    if (saved === undefined) return { revision: 0, entries: [] };
    if (!object(saved) || !Array.isArray(saved.entries) || !Number.isInteger(saved.revision)) throw new Error('Invalid remote rule cache');
    const entries: Subscription[] = [];
    for (const entry of saved.entries) { if (!object(entry) || typeof entry.id !== 'string' || typeof entry.url !== 'string' || typeof entry.domain !== 'string') throw new Error('Invalid remote rule cache'); entries.push({ ...entry, id: entry.id, url: entry.url, domain: entry.domain, document: entry.document === undefined ? undefined : validateRuleDocument(entry.document), lastAttempt: typeof entry.lastAttempt === 'number' ? entry.lastAttempt : null, lastSuccess: typeof entry.lastSuccess === 'number' ? entry.lastSuccess : null, error: typeof entry.error === 'string' ? entry.error : '' }); }
    return { revision: Number(saved.revision), entries };
  }
  function mutate(operation: (state: SubscriptionState) => void | false | Promise<void | false>) {
    const result = mutations.then(() => withConfigLock(async () => {
      const state = await read();
      const result = await operation(state);
      if (result === false) return state;
      await storage.set({ [REMOTE_RULES_KEY]: state });
      return state;
    }));
    mutations = result.then(() => {}, () => {});
    return result;
  }
  async function schedule() {
    const state = await read();
    if (!state.entries.length) { await alarms.clear(RULES_ALARM); return; }
    if (!(await alarms.get(RULES_ALARM))) await alarms.create(RULES_ALARM, { periodInMinutes: 360 });
  }
  async function list() {
    const state = await read();
    return { ...state, entries: state.entries.map((entry) => ({ ...entry, refreshing: inFlight.has(entry.id) })) };
  }
  async function add(input: string) {
    const source = parseSubscription(input);
    const id = crypto.randomUUID();
    await mutate((state) => {
      if (state.entries.some((entry) => entry.url === source.url)) throw new Error('Duplicate subscription');
      if (state.entries.length >= RULE_LIMITS.entries) throw new Error('Subscription limit: 20');
      state.entries.push({ id, ...source, lastAttempt: null, lastSuccess: null, error: '' });
      state.revision++;
    });
    await schedule();
    await refresh(id);
    return list();
  }
  async function remove(id: string) {
    await mutate((state) => {
      if (!state.entries.some((entry) => entry.id === id)) return false;
      state.entries = state.entries.filter((entry) => entry.id !== id); state.revision++;
    });
    await schedule();
    return list();
  }
  async function acquire() {
    if (active >= 2) await new Promise<void>(resolve => pending.push(resolve));
    else active++;
  }
  function release() { const next = pending.shift(); if (next) next(); else active--; }
  async function fetchDocument(url: RequestInfo|URL) {
    const controller = new AbortController();
    let expired = false;
    const timeout = timer(() => { expired = true; controller.abort(); }, RULE_LIMITS.timeout);
    try {
      const response = await fetcher(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = response.body; if (!body) throw new Error('Empty response');
      const reader = body.getReader(), chunks = [];
      let total = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > RULE_LIMITS.fileBytes) throw new Error('Remote rule file exceeds 256 KiB');
          chunks.push(value);
        }
      } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); await reader.cancel().catch(() => {}); throw error; }
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
      const document = validateRuleDocument(JSON.parse(new TextDecoder().decode(joined)));
      await validateSelectors(document);
      return document;
    } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); if (expired) throw new Error('Remote rule fetch timeout'); throw error; }
    finally { cancelTimer(timeout); }
  }
  function refresh(id: string) {
    if (inFlight.has(id)) return inFlight.get(id);
    const operation = (async () => {
      await acquire();
      try {
        const before = await read(), entry = before.entries.find((entry) => entry.id === id);
        if (!entry) return;
        await mutate((state) => {
          const current = state.entries.find((value) => value.id === id && value.url === entry.url);
          if (!current) return false;
          current.lastAttempt = now(); current.error = '';
        });
        try {
          const document = await fetchDocument(entry.url);
          await mutate((state) => {
            const current = state.entries.find((value) => value.id === id && value.url === entry.url);
            if (!current) return false;
            const total = state.entries.reduce((sum, value) => sum + (value.id === id ? bytes(document) : value.document ? bytes(value.document) : 0), 0);
            if (total > RULE_LIMITS.cacheBytes) throw new Error('Remote rule cache exceeds 4 MiB');
            if (canonical(current.document) !== canonical(document)) { state.revision++; matches.clear(); }
            current.document = document; current.lastSuccess = now(); current.error = '';
          });
        } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
          await mutate((state) => {
            const current = state.entries.find((value) => value.id === id && value.url === entry.url);
            if (!current) return false;
            current.error = error.message;
          });
        }
      } finally { release(); }
    })().finally(() => inFlight.delete(id));
    inFlight.set(id, operation);
    return operation;
  }
  async function refreshAll({ dueOnly = false } = {}) {
    const state = await read();
    const results = await Promise.allSettled(state.entries.filter((entry) => !dueOnly || entry.lastAttempt === null || now() - (entry.lastAttempt ?? 0) >= REFRESH_INTERVAL).map((entry) => refresh(entry.id)));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    return list();
  }
  async function resolve(url: string): Promise<RuleMatch & { revision: number; error?: string }> {
    const state = await read(), domain = new URL(url).hostname;
    const entries = state.entries.filter((entry) => entry.domain === domain && entry.document);
    if (!entries.length) return { options: {}, source: null, revision: state.revision };
    const key = `${state.revision}:${url}`;
    if (!matches.has(key)) {
      if (matches.size >= 200) matches.delete(matches.keys().next().value || '');
      matches.set(key, match(entries, url).then((result) => ({ ...result, revision: state.revision }), (error) => ({ options: {}, source: null, revision: state.revision, error: error.message })));
    }
    const result = await matches.get(key);
    // Removed/updated sources must not publish a result from an earlier match.
    if ((await read()).revision !== state.revision) return resolve(url);
    if (!result) throw new Error("Missing rule result"); return result;
  }
  function applyConfiguration(urls: string[], operation: (values: Record<string, unknown>) => Promise<unknown>) {
    const result = mutations.then(() => withConfigLock(async () => {
      const state = await read();
      const entries = urls.map((url) => state.entries.find((entry) => entry.url === url) || {
        id: crypto.randomUUID(), ...parseSubscription(url), lastAttempt: null, lastSuccess: null, error: '',
      });
      const changed = canonical(entries.map((e) => e.url)) !== canonical(state.entries.map((e) => e.url));
      const next = { revision: state.revision + (changed ? 1 : 0), entries };
      await operation({ [REMOTE_RULES_KEY]: next });
      matches.clear();
    }));
    mutations = result.then(() => {}, () => {});
    return result;
  }
  async function afterConfiguration() { await schedule(); await refreshAll({ dueOnly: true }); }
  async function start() { await schedule(); await refreshAll({ dueOnly: true }); }
  return { list, add, remove, refresh, refreshAll, resolve, start, schedule, applyConfiguration, afterConfiguration };
}
