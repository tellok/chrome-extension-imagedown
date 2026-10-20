import test from 'node:test';
import assert from 'node:assert/strict';
import { imageType, filename, folderName, filterImages } from '../extension/lib.js';

test('format inference respects returned MIME over misleading URL', () => {
  assert.equal(imageType({ url: 'https://example.com/photo.jpg?token=1', mime: 'image/png' }), 'png');
  assert.equal(imageType({ url: 'data:image/svg+xml;charset=utf-8,<svg/>' }), 'svg');
  assert.equal(imageType({ url: 'blob:https://example.com/id' }), 'unknown');
  assert.equal(imageType({ url: 'https://example.com/a.JPEG?q=1' }), 'jpg');
});

test('download filenames cannot escape folder or use reserved Windows names', () => {
  const name = filename({ url: 'https://example.com/..%2f..%2fCON.jpg' }, 0, 'image/png');
  assert.equal(name, '未命名页面/001-_.._CON.png');
  assert.equal(filename({ url: 'data:image/png;base64,abc' }, 2, 'image/png'), '未命名页面/003-image.png');
  assert.equal(filename({ url: 'https://example.com/a.webp' }, 10, 'image/jpeg', 'jpg', '页面标题'), '页面标题/011-a.jpg');
});

test('page folder names are safe, nonempty and short enough for Unicode filesystem limits', () => {
  assert.equal(folderName('  页面标题  '), '页面标题');
  assert.equal(folderName('../a/b\\c:<x>?*|"'), '_a_b_c__x_____');
  for (const title of ['', '.', '..', '   ', '...   ']) assert.equal(folderName(title), '未命名页面');
  for (const title of ['CON', 'aux.txt', 'LPT1', 'COM¹']) assert.equal(folderName(title), `_${title}`);
  for (const title of ['图片'.repeat(300), '😀'.repeat(100), 'x'.repeat(1000)]) {
    const name = folderName(title);
    assert.ok(new TextEncoder().encode(name).length <= 120);
    assert.ok(!name.includes('\ufffd'));
  }
  assert.equal(filename({ url: 'https://example.com/a.jpg' }, 0, 'image/jpeg', 'original', '../../outside'), '_.._outside/001-a.jpg');
});

test('filters combine and do not silently discard unknown/failed candidates', () => {
  const a = { url: 'https://a/one.png', alt: 'cat', width: 300, height: 200, loaded: true, sources: ['img'], order: 0 };
  const b = { url: 'https://a/two.webp', alt: '', width: 0, height: 0, loaded: false, sources: ['css'], order: 1 };
  const c = { url: 'https://a/three.jpg', alt: '', width: 1200, height: 800, loaded: true, sources: ['img'], order: 2 };
  const base = { query: '', width: 0, height: 0, loaded: false, source: '', type: '', sort: 'position' };
  assert.equal(filterImages([a, b, c], base).length, 3);
  assert.deepEqual(filterImages([a, b, c], { ...base, width: 500 }), [b, c]);
  assert.deepEqual(filterImages([a, b, c], { ...base, source: 'css' }), [b]);
  assert.deepEqual(filterImages([a, b, c], { ...base, query: 'CAT', type: 'png' }), [a]);
  assert.deepEqual(filterImages([a, b, c], { ...base, sort: 'area' }), [c, a, b]);
});

test('ready-first groups successful previews and retains the chosen order inside each group', () => {
  const items = [
    { order: 0, width: 1000, previewStatus: 'error' },
    { order: 1, width: 100, previewStatus: 'ready' },
    { order: 2, width: 800 },
    { order: 3, width: 200, previewStatus: 'ready' },
    { order: 4, width: 900, previewStatus: 'ready', previewPending: true },
  ].map(item => ({ ...item, height: 100, url: `https://example.com/${item.order}.png`, alt: '', sources: ['img'] }));
  const filters = { query: '', readyFirst: true, sort: 'position' };
  assert.deepEqual(filterImages(items, filters).map(item => item.order), [1, 3, 0, 2, 4]);
  assert.deepEqual(filterImages(items, { ...filters, sort: 'width' }).map(item => item.order), [3, 1, 0, 4, 2]);
  assert.deepEqual(filterImages(items, { ...filters, readyFirst: false }).map(item => item.order), [0, 1, 2, 3, 4]);
  items[0].previewStatus = 'ready';
  assert.deepEqual(filterImages(items, filters).map(item => item.order), [0, 1, 3, 2, 4]);
});
