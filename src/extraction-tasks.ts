import type { ImageData } from "./models.js";
interface TaskEntry { controller: AbortController; owners: Set<unknown>; promise: Promise<ImageData>; bytes?: number; settled?: boolean; failed?: boolean }
// Shared promises retain failures until an explicit retry changes the generation.
export function createTaskPool(maxBytes = 64 * 1024 * 1024) {
  const entries = new Map<string, TaskEntry>();
  return {
    run(key: string, owner: unknown, operation: (signal: AbortSignal) => Promise<ImageData>) {
      let entry = entries.get(key);
      if (!entry) {
        const controller = new AbortController();
        entry = { controller, owners: new Set(), promise: Promise.resolve().then(() => operation(controller.signal)) };
        entries.set(key, entry);
        const captured = entry;
        entry.promise.then((result) => {
          captured.bytes = result?.dataUrl?.length || 0; captured.settled = true;
          let total = [...entries.values()].reduce((sum, value) => sum + (value.bytes || 0), 0);
          for (const [oldKey, old] of entries) {
            if (total <= maxBytes && entries.size <= 4000) break;
            if (old.settled) { total -= old.bytes || 0; entries.delete(oldKey); }
          }
        }, () => { captured.settled = true; captured.failed = true; });
      }
      entry.owners.add(owner);
      return entry.promise;
    },
    retryFailed(prefix: string) {
      for (const [key, entry] of entries) if (key.startsWith(prefix) && entry.failed) entries.delete(key);
    },
    release(owner: unknown) {
      for (const [key, entry] of entries) {
        entry.owners.delete(owner);
        if (!entry.owners.size) { entry.controller.abort(); entries.delete(key); }
      }
    },
    clear() { for (const entry of entries.values()) entry.controller.abort(); entries.clear(); },
    get size() { return entries.size; },
  };
}
export function refererOrigins(pageURL: string, imageURL: string) {
  return [...new Set([pageURL, imageURL].flatMap(value => {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? [url.origin + '/'] : []; } catch { return []; }
  }))];
}
export async function firstImage(stages: [string, () => Promise<ImageData | null>][], signal?: AbortSignal) {
  const errors = [];
  for (const [name, run] of stages) {
    signal?.throwIfAborted();
    try { const result = await run(); if (result?.dataUrl) return result; throw new Error('Unavailable'); }
    catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); errors.push(`${name}: ${error.message}`); }
  }
  throw new Error(errors.join('；'));
}
