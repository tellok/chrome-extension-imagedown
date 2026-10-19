import test from 'node:test';
import assert from 'node:assert/strict';
import { imageType, filename, filterImages } from '../extension/lib.js';

test('format inference respects returned MIME over misleading URL', () => {
  assert.equal(imageType({ url: 'https://example.com/photo.jpg?token=1', mime: 'image/png' }), 'png');
  assert.equal(imageType({ url: 'data:image/svg+xml;charset=utf-8,<svg/>' }), 'svg');
  assert.equal(imageType({ url: 'blob:https://example.com/id' }), 'unknown');
  assert.equal(imageType({ url: 'https://example.com/a.JPEG?q=1' }), 'jpg');
});

test('download filenames cannot escape folder or use reserved Windows names', () => {
  const name = filename({ url: 'https://example.com/..%2f..%2fCON.jpg' }, 0, 'image/png');
  assert.equal(name, 'ImageTaken/001-_.._CON.png');
  assert.equal(filename({ url: 'data:image/png;base64,abc' }, 2, 'image/png'), 'ImageTaken/003-image.png');
  assert.equal(filename({ url: 'https://example.com/a.webp' }, 10, 'image/jpeg', 'jpg'), 'ImageTaken/011-a.jpg');
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
