import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTheme, resolveTheme } from '../extension/theme.js';

test('theme defaults to system and explicit choices override the operating system', () => {
  for (const value of [undefined, null, '', 'invalid', 'system']) {
    assert.equal(normalizeTheme(value), 'system');
    assert.equal(resolveTheme(value, false), 'light');
    assert.equal(resolveTheme(value, true), 'dark');
  }
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});
