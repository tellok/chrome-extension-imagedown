import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../extension/locales/catalogs.js';
import { resolveLanguage, SUPPORTED_LANGUAGES, setLanguage, t, translateRendered } from '../extension/i18n.js';

test('automatic language detection handles regional tags and unsupported languages', () => {
  for (const [tag, expected] of [['ja-JP','ja'],['de-AT','de'],['en-GB','en'],['zh-Hans-SG','zh-CN'],['zh-HK','zh-TW'],['zh-Hant','zh-TW'],['ko-KR','ko'],['fr-CA','fr'],['es-ES','en']]) {
    assert.equal(resolveLanguage('auto', [tag]), expected);
  }
  assert.equal(resolveLanguage('de', ['ja-JP']), 'de');
  assert.equal(resolveLanguage('invalid', ['fr-FR']), 'fr');
});

test('all seven bundled languages have complete catalogs and matching placeholders', () => {
  const keys = Object.keys(catalogs['zh-CN']).sort();
  for (const language of SUPPORTED_LANGUAGES) {
    assert.deepEqual(Object.keys(catalogs[language]).sort(), keys, language);
    for (const key of keys) {
      assert.ok(catalogs[language][key], `${language}: ${key}`);
      assert.deepEqual([...catalogs[language][key].matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(), [...key.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(), `${language}: ${key}`);
    }
  }
});

test('dynamic messages use localized templates while preserving user content', () => {
  setLanguage('en');
  assert.equal(t('{0} 张图片', 3), '3 images');
  assert.equal(t('{0} 张图片已下载到「{1}」文件夹。', 2, '我的相册'), '2 images downloaded to “我的相册”.');
  setLanguage('de');
  assert.equal(translateRendered('3 images', 'en'), '3 Bilder');
  assert.equal(translateRendered('我的相册', 'en'), '我的相册');
  setLanguage('zh-CN');
});
