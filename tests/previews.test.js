import test from 'node:test';
import assert from 'node:assert/strict';
import { previewOrigin } from '../extension/previews.js';

test('preview markers reflect the actual preview source instead of page loaded status', () => {
  assert.equal(previewOrigin({ url: 'https://example.com/a.jpg', loaded: true }).kind, 'url');
  assert.equal(previewOrigin({ url: 'https://example.com/a.jpg', preview: 'data:image/png;base64,x' }).kind, 'page');
  assert.equal(previewOrigin({ url: 'data:image/svg+xml,x' }).kind, 'page');
  assert.equal(previewOrigin({ url: 'blob:example' }).kind, 'page');
  for (const method of ['page-cache', 'decoded-pixels', 'canvas', 'embedded', 'page-blob']) {
    assert.equal(previewOrigin({ retryPreview: 'blob:retry', previewMethod: method }).kind, 'page');
  }
  for (const method of ['page-fetch', 'extension-fetch']) {
    assert.equal(previewOrigin({ preview: 'data:old', retryPreview: 'blob:retry', previewMethod: method }).kind, 'url');
  }
});


test('URL previews explain why an already displayed image could not be extracted', () => {
  const item = { url: 'https://example.com/image.gif', loaded: true, previewIssue: 'cross-origin' };
  assert.equal(previewOrigin(item).kind, 'url');
  assert.match(previewOrigin(item).detail, /跨域/);
  assert.match(previewOrigin(item).detail, /不代表重新下载/);
  assert.equal(previewOrigin({ ...item, preview: 'data:image/png;base64,x' }).kind, 'page');
});

 test('browser resource markers distinguish original browser bytes', () => {
  const source = previewOrigin({ browserData: 'data:image/gif;base64,x' });
  assert.equal(source.kind, 'page');
  assert.equal(source.label, '浏览器资源');
  assert.match(source.detail, /原始图片数据/);
  assert.equal(previewOrigin({ retryPreview: 'blob:retry', previewMethod: 'debugger-resource' }).label, '浏览器资源');
});
