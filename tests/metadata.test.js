import test from 'node:test';
import assert from 'node:assert/strict';
import { filterImages } from '../extension/lib.js';
import { DEFAULT_THRESHOLDS, normalizeThreshold, siteDomain, dataURLBytes, imageSize, formatBytes, imageMetadataHash } from '../extension/metadata.js';

test('default thresholds include exact boundaries and preserve unknown metadata', () => {
  const base = { url: 'https://cdn.test/a.png', alt: '', width: 50, height: 50, bytes: 2048, order: 0 };
  const items = [base, { ...base, width: 49 }, { ...base, height: 49 }, { ...base, bytes: 2047 }, { ...base, width: 0, height: 0, bytes: null }];
  const defaults = { ...DEFAULT_THRESHOLDS, query: '', sort: 'position' };
  assert.deepEqual(filterImages(items, defaults, imageSize), [items[0], items[4]]);
  assert.equal(filterImages(items, { ...defaults, width: 0, height: 0, minBytes: 0 }, imageSize).length, 5);
  const ignored = { ...base, ignored: true };
  assert.equal(filterImages([ignored], defaults, imageSize).length, 0);
  assert.equal(filterImages([ignored], { ...defaults, showIgnored: true }, imageSize).length, 1);
  assert.equal(normalizeThreshold(-5, 50), 50);
  assert.equal(normalizeThreshold('0', 50), 0);
});

test('size counts bytes after Base64 or percent decoding and marks heuristic estimates', () => {
  assert.equal(dataURLBytes('data:image/png;base64,AP8B'), 3);
  assert.equal(dataURLBytes('data:image/png;base64,AP8%3D'), 2);
  assert.equal(dataURLBytes('data:image/png;base64,AP8'), 2);
  assert.equal(dataURLBytes('data:image/png,%00%FF%01'), 3);
  assert.equal(dataURLBytes('data:image/svg+xml,<svg>图</svg>'), 14);
  assert.equal(dataURLBytes('data:image/png;base64,?bad'), null);
  assert.deepEqual(imageSize({ url: 'https://cdn.test/a.png', width: 100, height: 100, bytes: 2048 }).bytes, 2048);
  assert.equal(imageSize({ url: 'https://cdn.test/a.png', width: 100, height: 100 }).estimated, true);
  assert.equal(imageSize({ url: 'https://cdn.test/a.png', width: 0, height: 0 }).bytes, null);
  assert.equal(formatBytes(2048), '2.0 KiB');
  assert.equal(formatBytes(1536, true), '≈ 1.5 KiB');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(null), '体积未知');
});

test('website scope ignores page paths, protocols and ports but separates hostnames', () => {
  assert.equal(siteDomain('https://EXAMPLE.com/a'), 'example.com');
  assert.equal(siteDomain('http://example.com:8080/b?q=1'), 'example.com');
  assert.notEqual(siteDomain('https://www.example.com/a'), siteDomain('https://example.com/a'));
  assert.equal(siteDomain('chrome://extensions/'), '');
});

test('ignore fingerprints normalize embedded encodings and remain stable as metadata improves', async () => {
  const a = await imageMetadataHash({ url: 'data:image/png;base64,AP8=' });
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, await imageMetadataHash({ url: 'data:image/png;base64,AP8' }));
  assert.equal(a, await imageMetadataHash({ url: 'data:image/png,%00%FF' }));
  assert.notEqual(a, await imageMetadataHash({ url: 'data:image/png;base64,AAAA' }));
  const url = { url: 'https://cdn.test/photo.png?variant=one' };
  assert.equal(await imageMetadataHash(url), await imageMetadataHash({ ...url, width: 100, height: 100, bytes: 9999, mime: 'image/webp' }));
  assert.notEqual(await imageMetadataHash(url), await imageMetadataHash({ url: 'https://cdn.test/photo.png?variant=two' }));
  const blob = { url: 'blob:https://example.com/old', preview: 'data:image/png;base64,AP8B', width: 100, height: 100 };
  assert.equal(await imageMetadataHash(blob), await imageMetadataHash({ ...blob, url: 'blob:https://example.com/new' }));
  assert.notEqual(await imageMetadataHash(blob), await imageMetadataHash({ ...blob, width: 1000 }));
  assert.equal(await imageMetadataHash({ url: blob.url }), '');
});
