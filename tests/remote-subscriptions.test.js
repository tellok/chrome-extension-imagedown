import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriptionManager, RULES_ALARM, REFRESH_INTERVAL } from '../extension/remote-subscriptions.js';
import { REMOTE_RULES_KEY, validateRuleDocument, matchRemoteRules } from '../extension/remote-rules.js';
const document = { version: 1, rules: [{ pattern: '.*', options: { width: 100 } }] };
const response = value => new Response(JSON.stringify(value));
function fixture() {
  const data = {}, scheduled = new Map();
  let tick = 1000;
  const state = { fetcher: async () => response(document), timers: [], calls: [] };
  const storage = {
    async get(key) { if (state.readError) throw new Error('read denied'); return { [key]: structuredClone(data[key]) }; },
    async set(value) { if (state.writeError) throw new Error('write denied'); Object.assign(data, structuredClone(value)); },
  };
  const alarms = { async get(name) { return scheduled.get(name); }, async clear(name) { scheduled.delete(name); }, async create(name, value) { scheduled.set(name, value); } };
  const manager = createSubscriptionManager({ storage, alarms, fetcher: async (...args) => { state.calls.push(args); return state.fetcher(...args); }, validateSelectors: async doc => validateRuleDocument(doc), match: async (...args) => matchRemoteRules(...args), now: () => tick,
    timer: (callback, ms) => { const item = { callback, ms }; state.timers.push(item); return item; }, cancelTimer: () => {} });
  return { ...manager, data, state, scheduled, advance: () => { tick += REFRESH_INTERVAL; } };
}
const url = 'https://rules.test/example.com.json';
test('Network failures preserve the last successful subscription document.', async () => {
  const f = fixture(); const first = (await f.add(url)).entries[0];
  assert.equal(f.state.calls[0][1].credentials, 'omit'); assert.equal(f.state.calls[0][1].referrerPolicy, 'no-referrer');
  f.state.fetcher = async () => { throw new Error('offline'); }; f.advance(); await f.refresh(first.id);
  const last = (await f.list()).entries[0]; assert.deepEqual(last.document, first.document); assert.equal(last.lastSuccess, first.lastSuccess); assert.equal(last.error, 'offline'); assert.ok(last.lastAttempt > first.lastAttempt);
});
test('Malformed JSON cannot replace a valid cached rule document.', async () => {
  const f = fixture(); const first = (await f.add(url)).entries[0]; f.state.fetcher = async () => new Response('broken JSON'); await f.refresh(first.id);
  const last = (await f.list()).entries[0]; assert.deepEqual(last.document, document); assert.ok(last.error); assert.equal(last.lastSuccess, first.lastSuccess);
});
test('Subscriptions enforce document, cache, rule, and entry limits.', async () => {
  const f = fixture(); const first = (await f.add(url)).entries[0];
  f.state.fetcher = async () => new Response(new Uint8Array(256 * 1024 + 1)); await f.refresh(first.id);
  assert.match((await f.list()).entries[0].error, /256 KiB/); assert.deepEqual((await f.list()).entries[0].document, document);
  const big = { version: 1, rules: Array.from({ length: 58 }, () => ({ pattern: '.*', options: { xpath: 'x'.repeat(4096) } })) };
  f.state.fetcher = async () => response(big);
  for (let i = 0; i < 19; i++) await f.add(`https://rules.test/${i}/example.com.json`);
  const state = await f.list(); assert.equal(state.entries.length, 20); assert.ok(state.entries.some(entry => /4 MiB/.test(entry.error)));
  await assert.rejects(f.add('https://rules.test/extra/example.com.json'), /limit/);
  assert.throws(() => validateRuleDocument({ version: 1, rules: Array(101).fill(document.rules[0]) }), /rules/);
});
test('Timed out subscription requests are cancelled without reporting success.', async () => {
  const f = fixture(); const first = (await f.add(url)).entries[0];
  f.state.fetcher = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const task = f.refresh(first.id); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.timers.at(-1).ms, 10000); f.state.timers.at(-1).callback(); await task;
  const last = (await f.list()).entries[0]; assert.match(last.error, /timeout/); assert.equal(last.lastSuccess, first.lastSuccess); assert.deepEqual(last.document, document);
});
test('Late responses cannot restore a subscription removed during a request.', async () => {
  const f = fixture(); const first = (await f.add(url)).entries[0]; let finish;
  f.state.fetcher = () => new Promise(resolve => { finish = resolve; }); const task = f.refresh(first.id); await new Promise(resolve => setImmediate(resolve));
  await f.remove(first.id); finish(response(document)); await task; assert.equal((await f.list()).entries.length, 0);
});
test('Overlapping subscription refreshes share work and isolate failures by source.', async () => {
  const f = fixture(); await f.add(url); await f.add('https://rules.test/b/example.com.json'); await f.add('https://rules.test/c/example.com.json');
  let active = 0, max = 0, calls = 0;
  f.state.fetcher = async source => { calls++; active++; max = Math.max(max, active); await new Promise(resolve => setImmediate(resolve)); active--; if (source.includes('/b/')) throw new Error('offline'); return response({ version: 1, rules: [] }); };
  const first = (await f.list()).entries[0]; const a = f.refresh(first.id), b = f.refresh(first.id); assert.equal(a, b);
  await Promise.all([a, f.refreshAll()]); assert.equal(calls, 3); assert.ok(max <= 2);
  const entries = (await f.list()).entries; assert.equal(entries[0].document.rules.length, 0); assert.equal(entries[1].error, 'offline'); assert.equal(entries[2].document.rules.length, 0);
});
test('Background startup restores refresh scheduling and updates overdue subscriptions.', async () => {
  const f = fixture(); await f.start(); assert.equal(f.scheduled.size, 0); assert.equal(f.state.calls.length, 0);
  const first = (await f.add(url)).entries[0]; assert.equal(f.scheduled.get(RULES_ALARM).periodInMinutes, 360);
  f.scheduled.clear(); f.advance(); await f.start(); assert.equal(f.state.calls.length, 2); assert.ok(f.scheduled.has(RULES_ALARM));
  await f.remove(first.id); assert.equal(f.scheduled.size, 0);
});
test('Local storage failures prevent subscription changes from reporting success.', async () => {
  const f = fixture(); const first = (await f.add(url)).entries[0]; const before = structuredClone(f.data[REMOTE_RULES_KEY]);
  f.state.readError = true; await assert.rejects(f.list(), /read denied/); await assert.rejects(f.add('https://rules.test/b/example.com.json'), /read denied/);
  f.state.readError = false; f.state.writeError = true; await assert.rejects(f.refresh(first.id), /write denied/); await assert.rejects(f.remove(first.id), /write denied/);
  assert.deepEqual(f.data[REMOTE_RULES_KEY], before);
});
