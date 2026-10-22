import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseSubscription, validateRuleDocument, matchRemoteRules, mergeRulePreferences } from '../extension/remote-rules.js';
const doc = (options = {}, pattern = '.*', flags) => ({ version: 1, rules: [{ pattern, options, ...(flags === undefined ? {} : { flags }) }] });
const entry = (document, domain = 'example.com', id = 'a') => ({ id, domain, url: `https://rules.test/${id}/${domain}.json`, document });
test('Subscription URLs decode filenames and normalize domain names.', () => {
  assert.deepEqual(parseSubscription('https://rules.test/EXAMPLE%2Ecom.json?q=1#frag'), { domain: 'example.com', url: 'https://rules.test/EXAMPLE%2Ecom.json?q=1' });
  assert.equal(parseSubscription('https://rules.test/例子.测试.json').domain, 'xn--fsqu00a.xn--0zwm56d');
});
test('Invalid subscription URLs are rejected before an identity is created.', () => {
  for (const source of ['file:///example.com.json', 'https://user:secret@rules.test/example.com.json', 'https://rules.test/example.com', 'https://rules.test/a%2Fb.json', 'https://rules.test/a%3A80.json', 'https://rules.test/.json']) assert.throws(() => parseSubscription(source), /source URL/);
});
test('Version one rule documents accept supported fields and bundled examples.', async () => {
  const document = doc({ width: 0, height: 100000, minBytes: 0, xpath: '//main', excludedSelectors: '.ad', query: '', type: 'png', source: 'img', loaded: false, showIgnored: true });
  assert.deepEqual(validateRuleDocument(document), document);
  assert.deepEqual(validateRuleDocument({ version: 1, rules: [] }).rules, []);
  let demo = new URL('../openspec/changes/remote-rule-subscriptions/demo/', import.meta.url);
  try { await readdir(demo); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const archive = new URL('../openspec/changes/archive/', import.meta.url);
    const name = (await readdir(archive)).find(name => name.endsWith('-remote-rule-subscriptions'));
    assert.ok(name, 'archived demo exists'); demo = new URL(`${name}/demo/`, archive);
  }
  for (const file of ['github.com', 'example.com']) validateRuleDocument(JSON.parse(await readFile(new URL(`${file}.json`, demo), 'utf8')));
});
test('Rule documents reject unsupported versions and unknown structural fields.', () => {
  assert.throws(() => validateRuleDocument({ ...doc(), version: 2 }), /version/);
  assert.throws(() => validateRuleDocument({ ...doc(), extra: true }), /document/);
  assert.throws(() => validateRuleDocument({ version: 1, rules: [{ ...doc().rules[0], extra: true }] }), /rule fields/);
});
test('Invalid regular expressions and duplicate rule identifiers are rejected.', () => {
  for (const pattern of ['[', '', 'a'.repeat(257), undefined]) assert.throws(() => validateRuleDocument(doc({}, pattern === undefined ? null : pattern)), /pattern/);
  const document = doc(); document.rules[0].id = 'same'; document.rules.push({ ...document.rules[0] });
  assert.throws(() => validateRuleDocument(document), /id/);
});
test('Rule matching accepts only supported regular expression flags.', () => {
  for (const flags of ['', 'i', 'u', 'iu']) validateRuleDocument(doc({}, 'A', flags));
  for (const flags of ['g', 'y', 'm', 'ui', false]) assert.throws(() => validateRuleDocument(doc({}, 'a', flags)), /flags/);
  const entries = [entry(validateRuleDocument(doc({ width: 9 }, 'EXAMPLE', 'i')))];
  assert.deepEqual(matchRemoteRules(entries, 'https://example.com/'), matchRemoteRules(entries, 'https://example.com/'));
});
test('Remote rules cannot configure settings outside image filtering.', () => {
  for (const field of ['script', 'directory', 'downloadManifest', 'language', 'ignored']) assert.throws(() => validateRuleDocument(doc({ [field]: true })), /options/);
});
test('Rule options enforce numeric, boolean, and enumerated value types.', () => {
  for (const value of [-1, 1.2, 100001, '2', NaN]) assert.throws(() => validateRuleDocument(doc({ width: value })), /width/);
  for (const value of [-1, Infinity, '0']) assert.throws(() => validateRuleDocument(doc({ minBytes: value })), /minBytes/);
  assert.throws(() => validateRuleDocument(doc({ loaded: 'true' })), /loaded/);
  assert.throws(() => validateRuleDocument(doc({ type: 'pdf' })), /type/);
  assert.throws(() => validateRuleDocument(doc({ source: 'network' })), /source/);
});
test('Explicit local zero, false, and empty values override remote defaults.', () => {
  const local = { defaults: { width: 50, height: 80 }, overrides: { width: 0, query: '', loaded: false, xpath: '' } };
  const before = structuredClone(local);
  const result = mergeRulePreferences(local, { options: { width: 400, height: 200, minBytes: 4096, query: 'remote', loaded: true, xpath: '//main' }, source: { rule: 'r' } });
  assert.equal(result.values.width, 0); assert.equal(result.values.height, 200); assert.equal(result.values.minBytes, 4096);
  assert.equal(result.values.query, ''); assert.equal(result.values.loaded, false); assert.equal(result.values.xpath, '');
  assert.deepEqual(local, before); assert.deepEqual(result.overrides, { width: 0 });
});
test('Remote matching uses the first matching file and rule without merging later matches.', () => {
  const first = doc({ width: 1 }); first.rules.push(doc({ height: 99 }).rules[0]);
  const result = matchRemoteRules([entry(first), entry(doc({ width: 2, height: 88 }), 'example.com', 'b')], 'https://example.com/a');
  assert.deepEqual(result.options, { width: 1 }); assert.equal(result.source.id, 'a');
});
test('Remote matching requires the exact source hostname and evaluates the full page URL.', () => {
  const document = doc({ width: 1 }, '/one$'); document.rules.push(doc({ width: 2 }, '/two$').rules[0]);
  assert.equal(matchRemoteRules([entry(document)], 'https://example.com/one').options.width, 1);
  assert.equal(matchRemoteRules([entry(document)], 'https://example.com/two').options.width, 2);
  assert.equal(matchRemoteRules([entry(document)], 'https://sub.example.com/one').source, null);
});
test('Missing subscriptions and unmatched rules preserve existing filter defaults.', () => {
  for (const entries of [[], [entry(doc({}, '/absent$'))]]) {
    const result = mergeRulePreferences({ overrides: {} }, matchRemoteRules(entries, 'https://example.com/'));
    assert.deepEqual([result.values.width, result.values.height, result.values.minBytes], [50, 50, 2048]);
  }
  assert.equal(mergeRulePreferences({ defaults: { width: 120 }, overrides: { height: 0 } }).values.width, 120);
});
