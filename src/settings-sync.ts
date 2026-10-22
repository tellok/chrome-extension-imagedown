import type { Storage, SyncStorage, AlarmAPI, SyncStatus, SyncMeta, SyncPayload, SyncVersion } from "./models.js";
import type { createSubscriptionManager } from "./remote-subscriptions.js";
import { object, isVector, isSyncMeta } from "./guards.js";
import { SYNC_PREFIX, SYNC_ENABLED_KEY, SYNC_STATE_KEY, SYNC_IMPORT_KEY, canonical, digest, exportPayload, payloadWrites, encodePayload, readVersions, joinVectors, dominates, budget, configKey } from './settings-sync-codec.js';
import { withConfigLock } from './config-lock.js';
export const SYNC_META_KEY = 'config-sync:meta';
export const SYNC_ALARM = 'imagetaken-config-sync';
const stopped = () => new Error('Sync operation stopped');
export function createSettingsSync({ local, sync, alarms, subscriptions, validateSelectors = async () => {}, now = Date.now, timer = setTimeout, cancelTimer = clearTimeout, lock = withConfigLock }: { local: Storage; sync: SyncStorage; alarms: AlarmAPI; subscriptions?: Pick<ReturnType<typeof createSubscriptionManager>, "applyConfiguration" | "afterConfiguration">; validateSelectors?: (payload: SyncPayload) => Promise<unknown>; now?: () => number; timer?: typeof setTimeout; cancelTimer?: typeof clearTimeout; lock?: typeof withConfigLock }) {
  let remoteVersion = 0;
  let enabled = false, epoch = 0, initialized = false, queued = Promise.resolve(), timeout: number|undefined, lastPublish = -Infinity;
  let status: SyncStatus = { state: 'checking', ready: false, candidates: [] }, meta: SyncMeta, scheduled = false;
  const guard = (generation: number) => { if (!enabled || generation !== epoch) throw stopped(); };
  async function api(generation: number, method: 'get', value: null): Promise<Record<string, unknown>>;
  async function api(generation: number, method: 'getBytesInUse', value: null): Promise<number>;
  async function api(generation: number, method: 'set', value: Record<string, unknown>): Promise<void>;
  async function api(generation: number, method: 'remove', value: string[]): Promise<void>;
  async function api(generation: number, method: string, value: Record<string, unknown> | string[] | null): Promise<unknown> {
    guard(generation); let result: unknown;
    if (method === 'get') result = await sync.get(null);
    else if (method === 'getBytesInUse') result = await sync.getBytesInUse(null);
    else if (method === 'set' && object(value)) result = await sync.set(value);
    else if (method === 'remove' && Array.isArray(value)) result = await sync.remove(value);
    else throw new Error('Invalid sync operation');
    guard(generation); return result;
  }
  async function report(state: string, extra: Partial<SyncStatus> = {}) {
    status = { state, enabled, ready: initialized, candidates: [], ...extra };
    await local.set({ [SYNC_STATE_KEY]: status });
    return status;
  }
  async function loadMeta() {
    if (meta) return;
    const stored = (await local.get(SYNC_META_KEY))[SYNC_META_KEY];
    if (isSyncMeta(stored)) meta = stored;
    if (meta?.deviceId) lastPublish = meta.publishedAt ?? -Infinity;
    if (!meta?.deviceId) { meta = { deviceId: crypto.randomUUID(), counter: 0, baseline: null, backups: [], pending: [] }; await local.set({ [SYNC_META_KEY]: meta }); }
  }
  async function payload() { return exportPayload(await local.get(null)); }
  async function read(generation: number) {
    let data = await api(generation, 'get', null);
    // Only remove this device's interrupted writes known from its local ledger.
    const pending = meta.pending || [];
    const committed = pending.some((key) => key.endsWith(':head') && data[key]);
    const abandoned = committed ? [] : pending.filter((key) => data[key] !== undefined);
    if (committed) { meta.pending = []; await local.set({ [SYNC_META_KEY]: meta }); }
    if (abandoned.length) {
      await api(generation, 'remove', abandoned);
      meta.pending = []; await local.set({ [SYNC_META_KEY]: meta });
      data = await api(generation, 'get', null);
    }
    const versions = await readVersions(data, validateSelectors); guard(generation);
    return { data, versions };
  }
  const tokenFor = (hash: string, versions: SyncVersion[]) => canonical({ hash, revisions: versions.map((v) => v.head.key).sort() });
  async function publish(value: SyncPayload, observed: SyncVersion[], data: Record<string, unknown>, generation: number) {
    guard(generation);
    const vector = joinVectors(observed.map((v) => v.head.vector));
    const counter = Math.max(meta.counter || 0, vector[meta.deviceId] || 0) + 1;
    if (!Number.isSafeInteger(counter)) throw new Error('Invalid sync data: counter exhausted');
    vector[meta.deviceId] = counter;
    const encoded = await encodePayload(value, meta.deviceId, vector, now()); guard(generation);
    budget(data, encoded.entries, sync);
    const actualBytes = await api(generation, 'getBytesInUse', null);
    const newBytes = budget({}, encoded.entries, sync);
    if (actualBytes + newBytes > (sync.QUOTA_BYTES ?? 102400)) throw new Error('Invalid sync data: total quota');
    meta.counter = counter; meta.pending = Object.keys(encoded.entries);
    await local.set({ [SYNC_META_KEY]: meta }); guard(generation);
    // A crash after publishing a head must not cause the next start to delete it.
    await api(generation, 'set', encoded.chunks);
    await api(generation, 'set', { [encoded.key]: encoded.head });
    meta.pending = []; await local.set({ [SYNC_META_KEY]: meta }); guard(generation);
    lastPublish = now(); meta.publishedAt = lastPublish;
    const reread = await api(generation, 'get', null);
    await readVersions({ ...encoded.chunks, [encoded.key]: reread[encoded.key], ...Object.fromEntries(encoded.head.chunks.map(k => [k, reread[k]])) }, validateSelectors);
    guard(generation);
    meta.baseline = encoded.head.payloadHash; meta.lastGood = value;
    await local.set({ [SYNC_META_KEY]: meta }); guard(generation);
    const old = [];
    for (const [key, head] of Object.entries(reread)) {
      if (key.startsWith(`${SYNC_PREFIX}${meta.deviceId}:`) && key.endsWith(':head') && object(head) && head.deviceId === meta.deviceId && key !== encoded.key && head.version === 1 && isVector(head.vector) && dominates(vector, head.vector)) {
        old.push(key, ...(Array.isArray(head.chunks) ? head.chunks.filter((k: unknown): k is string => typeof k === 'string' && k.startsWith(`${SYNC_PREFIX}${meta.deviceId}:`)) : []));
      }
    }
    if (old.length) await api(generation, 'remove', old);
    return encoded.head;
  }
  async function compare() {
    if (!enabled) return status;
    const generation = epoch;
    try {
      await loadMeta(); guard(generation);
      await report('checking'); guard(generation);
      const value = await payload(), hash = await digest(canonical(value)); guard(generation);
      await validateSelectors(value); guard(generation);
      const { data, versions } = await read(generation);
      const hashes = new Set(versions.map(v => v.head.payloadHash));
      if (versions.length && hashes.size === 1 && hashes.has(hash)) {
        meta.baseline = hash; meta.lastGood = value;
        await local.set({ [SYNC_META_KEY]: meta }); guard(generation);
        return await report('equal', { writtenAt: now() });
      }
      if (!versions.length || (hashes.size === 1 && hashes.has(meta.baseline || ""))) {
        const wait = 10000 - (now() - lastPublish);
        if (wait > 0) { schedule(wait); return await report('pending'); }
        await publish(value, versions, data, generation);
        // Re-read to discover concurrently published, previously unseen branches.
        schedule(2000);
        return await report('equal', { writtenAt: now() });
      }
      const token = tokenFor(hash, versions);
      return await report('conflict', { token, local: value, candidates: versions.map(v => ({ revision: v.head.key || "", deviceId: v.head.deviceId, updatedAt: v.head.updatedAt, payload: v.payload })) });
    } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
      if (!enabled || generation !== epoch) return status;
      return report(/missing|unreferenced/.test(error.message) ? 'waiting-data' : 'error', { error: error.message });
    }
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> { const result = queued.then(operation); queued = result.then(() => {}, () => {}); return result; }
  function schedule(delay = 2000) {
    if (!enabled) return;
    if (scheduled) return; // First-change debounce bounds latency during continuous input.
    scheduled = true;
    timeout = timer(() => { scheduled = false; void enqueue(compare).catch(() => {}); }, delay);
  }
  async function start() {
    try {
      const saved = await local.get(SYNC_ENABLED_KEY);
      return await setEnabled(saved[SYNC_ENABLED_KEY] !== false, false);
    } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
      initialized = false; enabled = false;
      return report('error', { error: error.message });
    }
  }
  async function setEnabled(value: boolean, persist = true) {
    const previous = enabled;
    enabled = value === true; epoch++; cancelTimer(timeout); scheduled = false;
    try { if (persist) await lock(() => local.set({ [SYNC_ENABLED_KEY]: enabled })); }
    catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); enabled = previous; epoch++; if (enabled) schedule(); throw error; }
    initialized = true;
    if (!enabled) { await alarms.clear(SYNC_ALARM); return report('disabled'); }
    await alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
    return enqueue(compare);
  }
  async function choose(token: string, revision: string | null = null) {
    return enqueue(async () => {
      if (!enabled) throw stopped();
      const generation = epoch;
      await loadMeta();
      const { data, versions } = await read(generation);
      const remoteAtChoice = remoteVersion;
      const before = await payload(), hash = await digest(canonical(before)); guard(generation);
      if (token !== tokenFor(hash, versions)) { await compare(); throw new Error('Sync choice expired'); }
      const chosen = revision === null ? before : versions.find(v => v.head.key === revision)?.payload;
      if (!chosen) throw new Error('Sync choice expired');
      await validateSelectors(chosen); guard(generation);
      const apply = async (subscriptionValues = {}) => {
        guard(generation);
        const current = await local.get(null);
        if (await digest(canonical(exportPayload(current))) !== hash || status.token !== token || remoteAtChoice !== remoteVersion) throw new Error('Sync choice expired');
        guard(generation);
        const nextMeta = { ...meta, backups: [...(meta.backups || []), { savedAt: now(), payload: before }].slice(-3) };
        const writes = revision === null ? {} : { ...payloadWrites(chosen, current), ...subscriptionValues, [SYNC_IMPORT_KEY]: crypto.randomUUID() };
        await local.set({ ...writes, [SYNC_META_KEY]: nextMeta });
        meta = nextMeta; guard(generation);
      };
      try {
        if (revision !== null && subscriptions) await subscriptions.applyConfiguration(chosen.subscriptions, apply);
        else await lock(() => apply());
      } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); await compare(); throw error; }
      // Applied configuration is retained even if publication fails. Its baseline
      // remains the old common content until a complete new head is read back.
      try {
        await publish(chosen, versions, data, generation);
        await report('equal', { writtenAt: now() }); schedule(2000);
      } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); if (enabled && generation === epoch) await report('error', { error: error.message }); }
      if (revision !== null && subscriptions) void subscriptions.afterConfiguration().catch(() => {});
      return status;
    });
  }
  function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area === 'local' && changes[SYNC_ENABLED_KEY]) {
      const next = changes[SYNC_ENABLED_KEY].newValue !== false;
      if (!initialized || next !== enabled) void setEnabled(next, false).catch(() => {});
      return;
    }
    if (!enabled) return;
    if (area === 'sync') { remoteVersion++; if (Object.keys(changes).some(k => k.startsWith(SYNC_PREFIX))) schedule(); }
    else if (area === 'local' && Object.keys(changes).some(configKey)) schedule();
  }
  return { start, setEnabled, changed, choose, retry: () => initialized ? enqueue(compare) : start(), getStatus: () => structuredClone(status) };
}
