import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDestination } from '../extension/destination.js';
import { matchesDownloadFolder } from '../extension/browser-downloads.js';

test('completed downloads must actually be in the requested title folder', () => {
  assert.equal(matchesDownloadFolder('/Users/test/Downloads/标题/001-image.png', '标题/001-image.png'), true);
  assert.equal(matchesDownloadFolder('C:\\Downloads\\标题\\001-image (1).png', '标题/001-image.png'), true);
  assert.equal(matchesDownloadFolder('/Downloads/cafe\u0301/001-image.png', 'café/001-image.png'), true);
  assert.equal(matchesDownloadFolder('/Downloads/random-uuid.png', '标题/001-image.png'), false);
  assert.equal(matchesDownloadFolder('/Downloads/other-title/001-image.png', '标题/001-image.png'), false);
});

test('default downloads use a sanitized title folder without filesystem permission requests', async () => {
  assert.deepEqual(await prepareDestination(null, '页面/标题'), { folder: '页面_标题', directory: null });
});

test('custom directory permission denial must fail before creating any folder', async () => {
  const root = {
    requestPermission: async options => { assert.equal(options.mode, 'readwrite'); return 'denied'; },
    getDirectoryHandle: () => assert.fail('must not create a folder after denial'),
  };
  await assert.rejects(prepareDestination(root, 'Title'), /未获得.*写入权限/);
});

test('custom download preparation creates a sanitized title folder once per batch', async () => {
  const directory = {};
  const root = {
    requestPermission: async () => 'granted',
    getDirectoryHandle: async (name, options) => {
      assert.equal(name, 'Title_Edited'); assert.equal(options.create, true); return directory;
    },
  };
  assert.deepEqual(await prepareDestination(root, 'Title/Edited'), { folder: 'Title_Edited', directory });
});
