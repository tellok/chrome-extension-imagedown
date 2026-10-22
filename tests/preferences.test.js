import test from 'node:test';
import assert from 'node:assert/strict';
import { siteDomain } from '../extension/metadata.js';
import { loadThresholds, saveThresholds, resetThresholds, thresholdStorageKey, saveGlobalDimensions, loadGlobalDimensions } from '../extension/preferences.js';

function storage(initial = {}) {
  const data = { ...initial };
  globalThis.chrome = { storage: { local: {
    async get(keys) { return Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])); },
    async set(values) { Object.assign(data, values); },
    async remove(keys) { for (const key of [].concat(keys)) delete data[key]; },
  } } };
  return data;
}
test('Unconfigured sites use factory threshold defaults.', async () => {
  const data = storage();
  assert.deepEqual(await loadThresholds('one.test'), { width: 50, height: 50, minBytes: 2048 });
  assert.deepEqual(data, {});
});
test('Threshold overrides are isolated by top-level hostname.', async () => {
  const data = storage();
  await saveThresholds(siteDomain('https://ONE.test/a'), { width: 300, height: 120, minBytes: 5000 });
  assert.deepEqual(await loadThresholds(siteDomain('http://one.test:8080/b')), { width: 300, height: 120, minBytes: 5000 });
  assert.deepEqual(await loadThresholds('sub.one.test'), { width: 50, height: 50, minBytes: 2048 });
  assert.deepEqual(await loadThresholds('two.test'), { width: 50, height: 50, minBytes: 2048 });
  await assert.rejects(saveThresholds('', { width: 999 }));
  assert.equal(Object.keys(data).length, 3);
});
test('Partial site overrides preserve explicit zero and inherit other fields.', async () => {
  const data = storage({ 'filters:width': 100, 'filters:height': 80 });
  await saveThresholds('one.test', { width: 0 });
  assert.deepEqual(await loadThresholds('one.test'), { width: 0, height: 80, minBytes: 2048 });
  assert.equal(data[thresholdStorageKey('one.test', 'height')], undefined);
  await saveThresholds('one.test', { height: 20 });
  await saveThresholds('one.test', { minBytes: 0 });
  assert.deepEqual(await loadThresholds('one.test'), { width: 0, height: 20, minBytes: 0 });
});
test('Concurrent threshold writes preserve separate fields and sites.', async () => {
  storage();
  await Promise.all([saveThresholds('one.test', { width: 99 }), saveThresholds('one.test', { height: 88 }), saveThresholds('two.test', { width: 77 })]);
  assert.deepEqual(await loadThresholds('one.test'), { width: 99, height: 88, minBytes: 2048 });
  assert.deepEqual(await loadThresholds('two.test'), { width: 77, height: 50, minBytes: 2048 });
});
test('Global dimensions affect only inherited site fields.', async () => {
  storage();
  await saveThresholds('one.test', { width: 0 });
  await saveGlobalDimensions({ width: 200, height: 100 });
  assert.deepEqual(await loadGlobalDimensions(), { width: 200, height: 100 });
  assert.deepEqual(await loadThresholds('one.test'), { width: 0, height: 100, minBytes: 2048 });
  assert.deepEqual(await loadThresholds('two.test'), { width: 200, height: 100, minBytes: 2048 });
});
test('Clearing site thresholds stores zeros and reset restores inheritance.', async () => {
  const data = storage({ 'filters:width': 120, 'filters:height': 90, 'image-query:v1:one.test': 'photo', 'xpath:v1:one.test': '//img', 'ignored:v1:one.test': ['hash'] });
  await saveThresholds('two.test', { width: 700 });
  await saveThresholds('one.test', { width: 0, height: 0, minBytes: 0 });
  assert.deepEqual(await loadThresholds('one.test'), { width: 0, height: 0, minBytes: 0 });
  await resetThresholds('one.test');
  assert.deepEqual(await loadThresholds('one.test'), { width: 120, height: 90, minBytes: 2048 });
  assert.equal(data[thresholdStorageKey('one.test', 'width')], undefined);
  assert.equal((await loadThresholds('two.test')).width, 700);
  assert.deepEqual(await loadGlobalDimensions(), { width: 120, height: 90 });
  assert.equal(data['image-query:v1:one.test'], 'photo');
  assert.equal(data['xpath:v1:one.test'], '//img');
  assert.deepEqual(data['ignored:v1:one.test'], ['hash']);
});
test('Legacy global dimensions survive while legacy size is not inherited.', async () => {
  const data = storage({ 'filters:width': 320, 'filters:height': 180, 'filters:minBytes': 8192 });
  assert.deepEqual(await loadThresholds('one.test'), { width: 320, height: 180, minBytes: 2048 });
  assert.equal(data['filters:minBytes'], 8192);
  data['filters:width'] = 0;
  assert.equal((await loadThresholds('one.test')).width, 0);
  data['filters:height'] = -1;
  assert.equal((await loadThresholds('one.test')).height, 50);
});
test('Threshold storage failures propagate without persisting fallback values.', async () => {
  const data = storage({ 'filters:width': 300 });
  chrome.storage.local.get = async () => { throw new Error('read denied'); };
  await assert.rejects(loadThresholds('one.test'), /read denied/);
  assert.deepEqual(data, { 'filters:width': 300 });
  chrome.storage.local.set = async () => { throw new Error('write denied'); };
  await assert.rejects(saveThresholds('one.test', { width: 200 }), /write denied/);
  assert.deepEqual(data, { 'filters:width': 300 });
});

test('Single dimension reset preserves the other site thresholds.', async () => {
  const data = storage({ 'filters:width': 50, 'filters:height': 80 });
  await saveThresholds('one.test', { width: 50, height: 0, minBytes: 4096 });
  await saveThresholds('two.test', { width: 700 });
  await resetThresholds('one.test', ['width']);
  assert.equal(data[thresholdStorageKey('one.test', 'width')], undefined);
  assert.deepEqual(await loadThresholds('one.test'), { width: 50, height: 0, minBytes: 4096 });
  await resetThresholds('one.test', ['height']);
  assert.deepEqual(await loadThresholds('one.test'), { width: 50, height: 80, minBytes: 4096 });
  assert.equal((await loadThresholds('two.test')).width, 700);
  assert.deepEqual(await loadGlobalDimensions(), { width: 50, height: 80 });
  chrome.storage.local.remove = async () => { throw new Error('remove denied'); };
  await saveThresholds('one.test', { height: 120 });
  await assert.rejects(resetThresholds('one.test', ['height']), /remove denied/);
  assert.equal((await loadThresholds('one.test')).height, 120);
});
