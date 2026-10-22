import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPool, firstImage, refererOrigins } from '../extension/extraction-tasks.js';
import { parseMHTML, archiveResource } from '../extension/mhtml.js';
import { base64, responseImage, MAX_FILE_BYTES } from '../extension/image-bytes.js';
import { enhancedKey, loadEnhanced } from '../extension/enhanced-mode.js';
import { exportPayload, payloadWrites } from '../extension/settings-sync-codec.js';
import { validateRuleDocument } from '../extension/remote-rules.js';
import { previewOrigin } from '../extension/previews.js';
import { readImage } from '../extension/api.js';
import { createRequestManager, RULE_START } from '../extension/image-requests.js';
const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='), c => c.charCodeAt(0));
const DATA = `data:image/gif;base64,${base64(GIF)}`;
const result = { dataUrl: DATA, method: 'extension-fetch' };
const owner = {};
function archive(body = base64(GIF), encoding = 'base64', ending = true) {
  return new TextEncoder().encode('MIME-Version: 1.0\r\nContent-Type: multipart/related;\r\n boundary="abc"\r\n\r\n--abc\r\nContent-Type: image/gif\r\nContent-Location: https://images.test/a.gif\r\nContent-Transfer-Encoding: '+encoding+'\r\n\r\n'+body+'\r\n--abc'+(ending ? '--' : '')+'\r\n');
}
function dnrFixture(failRemoval = false) {
  const rules = new Map([[RULE_START, { id: RULE_START }], [20, { id: 20 }]]);
  let calls = 0;
  return { rules, get calls() { return calls; }, api: {
    getSessionRules: async () => [...rules.values()], isRegexSupported: async () => ({ isSupported: true }),
    updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
      calls++; if (failRemoval && calls > 2 && removeRuleIds.length) throw new Error('cannot clear');
      for (const id of removeRuleIds) rules.delete(id);
      for (const rule of addRules) rules.set(rule.id, rule);
    },
  } };
}
test('Concurrent original image reads share one task while pixel previews remain separate.', async () => {
  const pool = createTaskPool(); let count = 0;
  const operation = async () => { count++; return result; };
  const [a, b] = await Promise.all([pool.run('file', owner, operation), pool.run('file', {}, operation)]);
  assert.strictEqual(a, b); assert.equal(count, 1);
  const pixels = await pool.run('pixels', owner, async () => ({ method: 'decoded-pixels' }));
  assert.notStrictEqual(pixels, a);
});
test('Image extraction stops after the first successful source.', async () => {
  const visited = [];
  for (const winner of [0, 1, 2]) {
    visited.length = 0;
    const value = await firstImage(['MHTML', 'Fetch', 'CDP'].map((name, index) => [name, async () => { visited.push(name); if (index < winner) throw new Error('unavailable'); return result; }]));
    assert.strictEqual(value, result); assert.equal(visited.length, winner + 1);
  }
});
test('Referer fallbacks deduplicate origins and preserve signed image URLs.', async () => {
  const url = 'https://a.test:8443/a.gif?signature=a%2Bb&x=1';
  assert.deepEqual(refererOrigins('https://a.test:8443/page', url), ['https://a.test:8443/']);
  const dnr = dnrFixture(); const requests = [];
  const manager = createRequestManager({ dnr: dnr.api, extensionId: 'extension', fetcher: async input => { requests.push(input); return new Response('denied', { status: 403 }); } });
  await assert.rejects(manager.image(url, 'https://a.test:8443/page'), /HTTP 403/);
  assert.deepEqual(requests, [url, url]); assert.equal(dnr.rules.size, 1);
});
test('Image responses reject invalid content, empty or oversized bodies, and interrupted transfers.', async () => {
  await assert.rejects(responseImage(new Response('<html/>', { headers: { 'content-type': 'text/html' } })), /not an image/);
  await assert.rejects(responseImage(new Response('', { headers: { 'content-type': 'image/png' } })), /Empty/);
  await assert.rejects(responseImage(new Response(new Uint8Array(MAX_FILE_BYTES + 1), { headers: { 'content-type': 'image/png' } })), /20 MiB/);
  const stream = new ReadableStream({ start(controller) { controller.error(new Error('interrupted')); } });
  await assert.rejects(responseImage(new Response(stream, { headers: { 'content-type': 'image/png' } })), /interrupted/);
});
test('Failed image tasks remain cached until an explicit retry starts a new generation.', async () => {
  const pool = createTaskPool(); let requests = 0;
  const fail = async () => { requests++; throw new Error('failed'); };
  await assert.rejects(pool.run('image:0', owner, fail)); await assert.rejects(pool.run('image:0', owner, fail));
  assert.equal(requests, 1); await assert.rejects(pool.run('image:1', owner, fail)); assert.equal(requests, 2);
});
test('Cancelling one image reader preserves tasks still owned by another view.', async () => {
  const pool = createTaskPool(), a = {}, b = {}; let signal;
  const operation = input => { signal = input; return result; };
  await pool.run('shared', a, operation); await pool.run('shared', b, operation);
  pool.release(a); assert.equal(signal.aborted, false); assert.equal(pool.size, 1);
  pool.release(b); assert.equal(signal.aborted, true); assert.equal(pool.size, 0);
});
test('MHTML parsing preserves image bytes across supported transfer encodings.', () => {
  assert.equal(parseMHTML(archive())[0].dataUrl, DATA);
  const quoted = [...GIF].map(value => '='+value.toString(16).padStart(2, '0')).join('');
  assert.equal(parseMHTML(archive(quoted.slice(0, 12)+'=\r\n'+quoted.slice(12), 'quoted-printable'))[0].dataUrl, DATA);
});
test('MHTML parsing rejects malformed or oversized archives and excludes ambiguous or unready resources.', () => {
  assert.throws(() => parseMHTML(archive('???')), /Base64/);
  assert.throws(() => parseMHTML(archive(base64(GIF), 'base64', false)), /boundary/);
  assert.throws(() => parseMHTML(new Uint8Array(64 * 1024 * 1024 + 1)), /64 MiB/);
  const parts = parseMHTML(archive()), item = { key: 'a', url: parts[0].url };
  const state = { id: '1', documentId: 'a', documentURL: 'https://a.test/', url: item.url, ready: true };
  assert.ok(archiveResource(parts, item, [state], [state]));
  assert.equal(archiveResource(parts, item, [state, { ...state, documentId: 'b' }], [state]), null);
  assert.equal(archiveResource(parts, item, [state], [{ ...state, ready: false }]), null);
});
test('Enhanced mode requires explicit permission for each source hostname.', async () => {
  const previous = globalThis.chrome;
  try {
    assert.notEqual(enhancedKey('a.test'), enhancedKey('www.a.test'));
    assert.throws(() => enhancedKey('a.test/path'));
    for (const value of [undefined, false, 'true', 1, true]) {
      globalThis.chrome = { storage: { local: { get: async key => ({ [key]: value }) } } };
      assert.equal(await loadEnhanced('a.test'), value === true);
    }
    globalThis.chrome.storage.local.get = async () => { throw new Error('unavailable'); };
    await assert.rejects(loadEnhanced('a.test'), /unavailable/);
  } finally { globalThis.chrome = previous; }
});
test('Enhanced mode permissions remain local and cannot be granted by sync or remote rules.', () => {
  const local = { [enhancedKey('a.test')]: true, 'settings:theme': 'dark' };
  const payload = exportPayload(local); assert.equal(JSON.stringify(payload).includes('enhanced'), false);
  assert.equal(Object.hasOwn(payloadWrites(payload, local), enhancedKey('a.test')), false);
  assert.throws(() => validateRuleDocument({ version: 1, rules: [{ match: '.*', options: { enhancedMode: true } }] }));
});
test('Preview labels distinguish archived images, fetched images, and debugger resources.', () => {
  assert.equal(previewOrigin({ browserData: DATA, browserMethod: 'mhtml-resource' }).label, '归档资源');
  for (const method of ['extension-fetch', 'page-referer-fetch', 'image-referer-fetch']) assert.equal(previewOrigin({ retryPreview: 'blob:x', previewMethod: method }).kind, 'url');
  assert.equal(previewOrigin({ browserData: DATA, browserMethod: 'debugger-resource' }).label, '浏览器资源');
});
test('Original image reads reject static pixel substitutes while previews and canvas snapshots remain valid.', async () => {
  const previous = globalThis.chrome;
  try {
    globalThis.chrome = { scripting: { executeScript: async () => [{ result: { dataUrl: DATA, method: 'decoded-pixels' } }] } };
    const item = { url: 'blob:https://a.test/revoked', origins: [{ documentId: 'doc', id: '1' }] };
    await assert.rejects(readImage(1, item), /Static pixels/);
    assert.equal((await readImage(1, item, { preview: true })).method, 'decoded-pixels');
    globalThis.chrome.scripting.executeScript = async () => [{ result: { dataUrl: DATA, method: 'canvas' } }];
    assert.equal((await readImage(1, { ...item, kind: 'canvas' })).method, 'canvas');
  } finally { globalThis.chrome = previous; }
});
test('Image requests stop when temporary referer rules cannot be removed.', async () => {
  const fixture = dnrFixture(true); let count = 0;
  const manager = createRequestManager({ dnr: fixture.api, extensionId: 'extension', fetcher: async () => { count++; return new Response('denied', { status: 403 }); } });
  await assert.rejects(manager.image('https://a.test/a.gif', 'https://page.test/'), /cannot clear/);
  const before = count;
  await assert.rejects(manager.image('https://a.test/b.gif', 'https://page.test/'), /could not be cleared/);
  assert.equal(count, before); assert.ok(fixture.rules.has(20));
});
