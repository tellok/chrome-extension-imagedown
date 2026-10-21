import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, loadDownloadManifest, DOWNLOAD_MANIFEST_KEY } from '../extension/settings.js';

test('title cleanup removes emoji sequences and faces while retaining normal title text', () => {
  assert.equal(cleanTitle('📷 相册 🏳️‍🌈 👨‍👩‍👧‍👦 👍🏽 🇨🇳 1️⃣'), '相册');
  assert.equal(cleanTitle('相册 (≧▽≦) (＾ω＾) (^_^) (╥﹏╥) :)'), '相册');
  assert.equal(cleanTitle('旅行记录（上海） [高清] (2026) (Tokyo) 第1集'), '旅行记录（上海） [高清] (2026) (Tokyo) 第1集');
  assert.equal(cleanTitle('普通标题：春日照片 2026-10-21'), '普通标题：春日照片 2026-10-21');
  assert.equal(cleanTitle('😀 ⛳'), '');
});

test('download manifest defaults off when preference is absent', async () => {
  const previous = globalThis.chrome;
  globalThis.chrome = { storage: { local: { get: async key => { assert.equal(key, DOWNLOAD_MANIFEST_KEY); return {}; } } } };
  try { assert.equal(await loadDownloadManifest(), false); }
  finally { globalThis.chrome = previous; }
});

test('download manifest preference read errors remain visible', async () => {
  const previous = globalThis.chrome;
  globalThis.chrome = { storage: { local: { get: async () => { throw new Error('storage unavailable'); } } } };
  try { await assert.rejects(loadDownloadManifest(), /storage unavailable/); }
  finally { globalThis.chrome = previous; }
});
