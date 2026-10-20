import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle } from '../extension/settings.js';

test('title cleanup removes emoji sequences and faces while retaining normal title text', () => {
  assert.equal(cleanTitle('📷 相册 🏳️‍🌈 👨‍👩‍👧‍👦 👍🏽 🇨🇳 1️⃣'), '相册');
  assert.equal(cleanTitle('相册 (≧▽≦) (＾ω＾) (^_^) (╥﹏╥) :)'), '相册');
  assert.equal(cleanTitle('旅行记录（上海） [高清] (2026) (Tokyo) 第1集'), '旅行记录（上海） [高清] (2026) (Tokyo) 第1集');
  assert.equal(cleanTitle('普通标题：春日照片 2026-10-21'), '普通标题：春日照片 2026-10-21');
  assert.equal(cleanTitle('😀 ⛳'), '');
});
