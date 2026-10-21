import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseSubscription, validateRuleDocument, matchRemoteRules, mergeRulePreferences } from '../extension/remote-rules.js';
const doc = (options = {}, pattern = '.*', flags) => ({ version: 1, rules: [{ pattern, options, ...(flags === undefined ? {} : { flags }) }] });
const entry = (document, domain = 'example.com', id = 'a') => ({ id, domain, url: `https://rules.test/${id}/${domain}.json`, document });
test('RR01 文件名解码与域名规范化', () => {
  assert.deepEqual(parseSubscription('https://rules.test/EXAMPLE%2Ecom.json?q=1#frag'), { domain: 'example.com', url: 'https://rules.test/EXAMPLE%2Ecom.json?q=1' });
  assert.equal(parseSubscription('https://rules.test/例子.测试.json').domain, 'xn--fsqu00a.xn--0zwm56d');
});
test('RR02 非法来源地址不产生订阅标识', () => {
  for (const source of ['file:///example.com.json', 'https://user:secret@rules.test/example.com.json', 'https://rules.test/example.com', 'https://rules.test/a%2Fb.json', 'https://rules.test/a%3A80.json', 'https://rules.test/.json']) assert.throws(() => parseSubscription(source), /source URL/);
});
test('RR03 版本1允许字段及演示文档可解析', async () => {
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
test('RR04 不支持的版本与未知结构字段拒绝', () => {
  assert.throws(() => validateRuleDocument({ ...doc(), version: 2 }), /version/);
  assert.throws(() => validateRuleDocument({ ...doc(), extra: true }), /document/);
  assert.throws(() => validateRuleDocument({ version: 1, rules: [{ ...doc().rules[0], extra: true }] }), /rule fields/);
});
test('RR05 非法正则不能进入有效缓存', () => {
  for (const pattern of ['[', '', 'a'.repeat(257), undefined]) assert.throws(() => validateRuleDocument(doc({}, pattern === undefined ? null : pattern)), /pattern/);
  const document = doc(); document.rules[0].id = 'same'; document.rules.push({ ...document.rules[0] });
  assert.throws(() => validateRuleDocument(document), /id/);
});
test('RR06 正则标志只接受声明集合', () => {
  for (const flags of ['', 'i', 'u', 'iu']) validateRuleDocument(doc({}, 'A', flags));
  for (const flags of ['g', 'y', 'm', 'ui', false]) assert.throws(() => validateRuleDocument(doc({}, 'a', flags)), /flags/);
  const entries = [entry(validateRuleDocument(doc({ width: 9 }, 'EXAMPLE', 'i')))];
  assert.deepEqual(matchRemoteRules(entries, 'https://example.com/'), matchRemoteRules(entries, 'https://example.com/'));
});
test('RR07 非筛选控制项不可远程配置', () => {
  for (const field of ['script', 'directory', 'downloadManifest', 'language', 'ignored']) assert.throws(() => validateRuleDocument(doc({ [field]: true })), /options/);
});
test('RR08 数值布尔与枚举严格校验', () => {
  for (const value of [-1, 1.2, 100001, '2', NaN]) assert.throws(() => validateRuleDocument(doc({ width: value })), /width/);
  for (const value of [-1, Infinity, '0']) assert.throws(() => validateRuleDocument(doc({ minBytes: value })), /minBytes/);
  assert.throws(() => validateRuleDocument(doc({ loaded: 'true' })), /loaded/);
  assert.throws(() => validateRuleDocument(doc({ type: 'pdf' })), /type/);
  assert.throws(() => validateRuleDocument(doc({ source: 'network' })), /source/);
});
test('RR09 本地显式零假空值覆盖远程', () => {
  const local = { defaults: { width: 50, height: 80 }, overrides: { width: 0, query: '', loaded: false, xpath: '' } };
  const before = structuredClone(local);
  const result = mergeRulePreferences(local, { options: { width: 400, height: 200, minBytes: 4096, query: 'remote', loaded: true, xpath: '//main' }, source: { rule: 'r' } });
  assert.equal(result.values.width, 0); assert.equal(result.values.height, 200); assert.equal(result.values.minBytes, 4096);
  assert.equal(result.values.query, ''); assert.equal(result.values.loaded, false); assert.equal(result.values.xpath, '');
  assert.deepEqual(local, before); assert.deepEqual(result.overrides, { width: 0 });
});
test('RR10 文件与规则首个命中且不合并后续', () => {
  const first = doc({ width: 1 }); first.rules.push(doc({ height: 99 }).rules[0]);
  const result = matchRemoteRules([entry(first), entry(doc({ width: 2, height: 88 }), 'example.com', 'b')], 'https://example.com/a');
  assert.deepEqual(result.options, { width: 1 }); assert.equal(result.source.id, 'a');
});
test('RR11 精确顶层域名与完整页面路径匹配', () => {
  const document = doc({ width: 1 }, '/one$'); document.rules.push(doc({ width: 2 }, '/two$').rules[0]);
  assert.equal(matchRemoteRules([entry(document)], 'https://example.com/one').options.width, 1);
  assert.equal(matchRemoteRules([entry(document)], 'https://example.com/two').options.width, 2);
  assert.equal(matchRemoteRules([entry(document)], 'https://sub.example.com/one').source, null);
});
test('RR12 无订阅或无命中回退原有默认', () => {
  for (const entries of [[], [entry(doc({}, '/absent$'))]]) {
    const result = mergeRulePreferences({ overrides: {} }, matchRemoteRules(entries, 'https://example.com/'));
    assert.deepEqual([result.values.width, result.values.height, result.values.minBytes], [50, 50, 2048]);
  }
  assert.equal(mergeRulePreferences({ defaults: { width: 120 }, overrides: { height: 0 } }).values.width, 120);
});
