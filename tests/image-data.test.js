import test from 'node:test';
import assert from 'node:assert/strict';
import { readImage } from '../extension/api.js';

const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
async function withChrome(chrome, run) {
  const previous = globalThis.chrome;
  globalThis.chrome = chrome;
  try { await run(); } finally { globalThis.chrome = previous; }
}

test('retained original bytes remain local even when the source page is unavailable', async () => {
  const deny = () => { throw new Error('Source page must not be accessed'); };
  await withChrome({ runtime: { sendMessage: deny }, scripting: { executeScript: deny } }, async () => {
    const item = { url: 'https://example.invalid/original.gif', browserDataURL: 'https://example.invalid/original.gif', browserData: GIF, origins: [] };
    const first = await readImage(1, item);
    item.browserData = ''; // The binary copy now owns the bytes.
    const second = await readImage(1, item);
    assert.equal(first.method, 'debugger-resource');
    assert.equal(first.blob.type, 'image/gif');
    assert.strictEqual(second.blob, first.blob);
    assert.deepEqual(await first.blob.arrayBuffer(), await (await fetch(GIF)).arrayBuffer());
  });
});

test('concurrent and subsequent reads reuse the original downloaded blob', async () => {
  const nativeFetch = globalThis.fetch;
  let requests = 0;
  await withChrome({ runtime: { connect: () => {
    const listeners = [];
    return { onMessage: { addListener: listener => listeners.push(listener) }, onDisconnect: { addListener() {} },
      postMessage: message => { requests++; queueMicrotask(() => listeners.forEach(listener => listener({ id: message.id, result: { dataUrl: GIF, method: 'extension-fetch' } }))); }, disconnect() {} };
  } } }, async () => {
    globalThis.fetch = async (url, options) => {
      if (url.startsWith('data:')) return nativeFetch(url, options);
      requests++;
      return nativeFetch(GIF);
    };
    try {
      const item = { url: 'https://example.invalid/original.gif', origins: [] };
      const [first, concurrent] = await Promise.all([readImage(1, item), readImage(1, item)]);
      const again = await readImage(1, item);
      assert.equal(requests, 1);
      assert.equal(first.method, 'extension-fetch');
      assert.strictEqual(concurrent.blob, first.blob);
      assert.strictEqual(again.blob, first.blob);
    } finally { globalThis.fetch = nativeFetch; }
  });
});

test('a simultaneous static thumbnail read cannot replace the original GIF', async () => {
  await withChrome({
    runtime: { sendMessage: async () => ({ items: [] }) },
    scripting: { executeScript: async ({ args }) => {
      const preview = args[2];
      if (preview) await new Promise(resolve => setTimeout(resolve, 10));
      return [{ result: { dataUrl: preview ? PNG : GIF, method: preview ? 'decoded-pixels' : 'page-cache' } }];
    } },
  }, async () => {
    const item = { url: 'https://example.invalid/original.gif', origins: [{ id: '1:0', documentId: 'document' }] };
    const [thumbnail, original] = await Promise.all([readImage(1, item, { preview: true }), readImage(1, item)]);
    assert.equal(thumbnail.method, 'decoded-pixels');
    assert.equal(original.blob.type, 'image/gif');
    assert.equal(original.method, 'page-cache');
    assert.strictEqual((await readImage(1, item)).blob, original.blob);
  });
});
