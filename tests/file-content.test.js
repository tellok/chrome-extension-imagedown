import test from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, randomFilename, isRandomVariant } from '../extension/file-content.js';

test('content hashes compare exact bytes rather than MIME or size alone', async () => {
  const hash = await contentHash(new Blob(['abc']));
  assert.equal(hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await contentHash(new Blob(['abc'], { type: 'image/png' })), hash);
  assert.notEqual(await contentHash(new Blob(['abd'])), hash);
});

test('collision names retain the stem and extension and use fresh random suffixes', () => {
  for (const original of ['001-图片.jpg', 'photo.part.png', 'image']) {
    const variants = Array.from({ length: 20 }, () => randomFilename(original));
    assert.equal(new Set(variants).size, 20);
    for (const name of variants) assert.equal(isRandomVariant(name, original), true);
    assert.equal(isRandomVariant(original, original), false);
    assert.equal(isRandomVariant('unrelated_0123456789abcdef.jpg', original), false);
  }
});
