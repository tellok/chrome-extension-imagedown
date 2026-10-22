import test from 'node:test';
import assert from 'node:assert/strict';
import { createManifestBatch, manifestFilename, manifestText, manifestBlob } from '../extension/download-manifest.js';

const metadata = { url: 'https://images.example/photo.svg?token=abc', sources: ['img'], sourcePageUrl: 'https://example/page#section', originalTitle: '落日 · Sunset', collectedAt: '2026-10-21T14:30:00.000Z', sourceReference: 'img#photo' };
function batch(item = metadata) {
  const result = createManifestBatch([item], '旅行/精选');
  result.entries[0].result = { savedName: '001-image.png' };
  return result;
}

test('Manifest uses sanitized edited title and UTF-8 text output.', async () => {
  const result = batch(), blob = manifestBlob(result);
  assert.equal(manifestFilename(result), '旅行_精选.txt');
  assert.equal(blob.type, 'text/plain;charset=utf-8');
  assert.match(await blob.text(), /落日 · Sunset/);
  assert.match(await blob.text(), /download title: 旅行_精选/);
});

test('HTTP image entries preserve remote URL and original metadata.', () => {
  const text = manifestText(batch());
  for (const line of ['remote URL: '+metadata.url, 'original title: '+metadata.originalTitle, 'source page URL: '+metadata.sourcePageUrl, 'collected at: '+metadata.collectedAt]) assert.ok(text.includes(line), line);
});

test('Inline SVG entries have no remote URL and retain source reference.', () => {
  const text = manifestText(batch({ ...metadata, url: 'data:image/svg+xml,%3Csvg%3ESECRET%3C/svg%3E', sources: ['svg'], sourceReference: 'svg#mark' }));
  assert.match(text, /remote URL: No valid remote URL/);
  assert.match(text, /source reference: svg#mark · data:image\/svg\+xml/);
  assert.ok(!text.includes('SECRET'));
});

test('Blob entries retain an explicit non-remote source reference.', () => {
  const text = manifestText(batch({ ...metadata, url: 'blob:https://example/1234' }));
  assert.match(text, /remote URL: No valid remote URL/);
  assert.match(text, /source reference: img#photo · blob:https:\/\/example\/1234/);
});

test('Data URL entries omit encoded image payload.', () => {
  const text = manifestText(batch({ ...metadata, url: 'data:image/png;base64,SECRET' }));
  assert.match(text, /remote URL: No valid remote URL/);
  assert.match(text, /data:image\/png/);
  assert.ok(!text.includes('SECRET'));
});

test('Canvas synthetic URLs are not remote image URLs.', () => {
  const text = manifestText(batch({ ...metadata, kind: 'canvas', url: 'https://example/page#__imagetaken_canvas_1', sourceReference: 'canvas#drawing' }));
  assert.match(text, /remote URL: No valid remote URL/);
  assert.match(text, /source reference: canvas#drawing/);
});

test('Manifest values escape line breaks without losing Unicode.', () => {
  const text = manifestText(batch({ ...metadata, originalTitle: '相册\n[2]\r\u0000' }));
  assert.ok(text.includes('original title: 相册\\n[2]\\r\\u0000'));
  assert.ok(!text.includes('\n[2]\n'));
  assert.match(manifestText(batch({ ...metadata, originalTitle: '' })), /original title: Not provided/);
});

test('Manifest maps actual converted and reused filenames in input order.', () => {
  const items = [metadata, { ...metadata, url: 'https://example/b.png' }, { ...metadata, url: 'https://example/bad.png' }];
  const result = createManifestBatch(items, 'Batch');
  result.entries[1].result = { skipped: true, savedName: '002-b_0123456789abcdef.png' };
  result.entries[0].result = { actualPath: 'C:\\Downloads\\Batch\\001-a.jpg' };
  result.entries[2].result = { error: 'wrong directory', misplaced: true, actualPath: '/elsewhere/unexpected.png' };
  items[0].originalTitle = 'changed after download started';
  const text = manifestText(result);
  assert.match(text, /Saved \/ reused images: 2/);
  assert.match(text, /local filename: 001-a.jpg/);
  assert.match(text, /status: Reused existing file\nlocal filename: 002-b_0123456789abcdef.png/);
  assert.ok(text.indexOf('001-a.jpg') < text.indexOf('002-b_'));
  assert.match(text, /Failed images: 1/);
  assert.ok(!text.includes('local filename: unexpected.png'));
  assert.ok(!text.includes('changed after download started'));
});
