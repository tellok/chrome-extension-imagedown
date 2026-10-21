import test from 'node:test';
import assert from 'node:assert/strict';
import { imageBadge } from '../extension/badge.js';

test('badge formats only ready items in the canonical filtered snapshot', () => {
  const badge = imageBadge([
    { previewStatus: 'ready' }, { previewStatus: 'error' }, {},
    { previewStatus: 'ready', previewPending: true },
  ], 8);
  assert.equal(badge.text, '1');
  assert.match(badge.title, /成功加载 1 张/);
  assert.match(badge.title, /当前筛选识别 4 张 · 预览失败 1 张/);
  assert.match(badge.title, /页面共识别 8 张/);
  assert.equal(imageBadge([], 0).text, '0');
  assert.equal(imageBadge([{ previewStatus: 'ready' }], 1, true).text, '1');
});

test('large badges stay legible while the tooltip retains the exact count', () => {
  const badge = imageBadge(Array.from({ length: 1234 }, () => ({ previewStatus: 'ready' })), 2000);
  assert.equal(badge.text, '999+');
  assert.match(badge.title, /成功加载 1234 张/);
});
