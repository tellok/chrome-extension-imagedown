import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPayload, validatePayload, payloadWrites, encodePayload, readVersions, dominates, frontier, joinVectors, budget, canonical, SYNC_PREFIX } from '../extension/settings-sync-codec.js';
const a = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const blank = () => ({ version: 1, settings: {}, sites: {}, subscriptions: [] });
test('SC01 同步允许表完整且排除本机运行数据', () => {
  const p = exportPayload({ 'settings:language':'ja', 'settings:theme':'dark', 'settings:auto-clean-title':true, 'settings:ready-first':false, 'settings:download-manifest':true, 'filters:width':80, 'filters:height':90, 'filters:view:v1':{loaded:false}, 'image-query:v1:one.test':'cat', 'ignored:v1:one.test':['a'.repeat(64)], 'settings:chrome-sync':false, 'download-location:revision':7, 'filters:minBytes':99, blob:'data:abc', title:'draft', 'config-sync:state':{} });
  assert.equal(Object.keys(p.settings).length,8); assert.equal(p.sites['one.test'].query,'cat'); assert.deepEqual(p.sites['one.test'].ignored,['a'.repeat(64)]); assert.doesNotMatch(canonical(p),/chrome-sync|download-location|data:abc|draft|minBytes/);
});
test('SC02 缺省与显式零假空值稳定往返', () => {
  const local = { 'settings:ready-first':false, 'filters:site:v1:one.test:width':0, 'xpath:v1:one.test':'', 'image-query:v1:one.test':null };
  const p = exportPayload(local); assert.equal(p.sites['one.test'].width,0); assert.equal(p.sites['one.test'].xpath,''); assert.ok(!Object.hasOwn(p.sites['one.test'],'query'));
  const writes = payloadWrites(p, {...local,'filters:site:v1:one.test:height':200,'download-location:revision':1});
  assert.equal(writes['filters:site:v1:one.test:height'],null); assert.equal(writes['settings:ready-first'],false); assert.ok(!Object.hasOwn(writes,'download-location:revision')); assert.deepEqual(exportPayload(writes),p);
});
test('SC03 网站字段及选择器严格校验', async () => {
  for (const p of [{...blank(),sites:{'One.test':{}}},{...blank(),sites:{'one.test':{width:-1}}},{...blank(),settings:{'settings:theme':'evil'}},{...blank(),sites:{'one.test':{ignored:['oops']}}},{...blank(),sites:{'one.test':{query:false}}},{...blank(),sites:{'one.test':{script:'x'}}}]) assert.throws(()=>validatePayload(p));
  const p = {...blank(),sites:{'one.test':{xpath:'[',excludedSelectors:'['}}};
  const e = await encodePayload(p,a,{[a]:1}); let seen;
  await assert.rejects(readVersions(e.entries, async value=>{ seen=value; throw new Error('Invalid selectors'); }),/selectors/); assert.deepEqual(seen,p);
  assert.equal(validatePayload({...blank(),sites:{'one.test':{xpath:'x'.repeat(5000)}}}).sites['one.test'].xpath.length,5000);
});
test('SC04 订阅只同步有序地址', () => {
  const p = exportPayload({'remote-rules:v1':{revision:9,entries:[{id:'private',url:'https://RULES.test/a/one.test.json#fragment',document:{rules:[]},error:'oops',lastSuccess:50},{url:'https://rules.test/b/one.test.json'}]}});
  assert.deepEqual(p.subscriptions,['https://rules.test/a/one.test.json','https://rules.test/b/one.test.json']); assert.doesNotMatch(canonical(p),/private|oops|lastSuccess|document/);
  assert.throws(()=>validatePayload({...p,subscriptions:[p.subscriptions[0],p.subscriptions[0]]})); assert.throws(()=>validatePayload({...p,subscriptions:['file:///one.test.json']}));
});
test('SC05 Unicode分片完整性与单项字节预算', async () => {
  const p = {...blank(),sites:{'one.test':{query:'中文🌈'.repeat(1000)}}}; const e = await encodePayload(p,a,{[a]:1});
  assert.ok(e.head.chunks.length>1); for(const [key,value] of Object.entries(e.entries)) assert.ok(new TextEncoder().encode(key+JSON.stringify(value)).length<=7168);
  assert.deepEqual((await readVersions(e.entries))[0].payload,p);
});
test('SC06 缺片损坏未知版本不产生有效快照', async () => {
  assert.throws(()=>validatePayload({version:1,settings:{},sites:{}})); const e=await encodePayload(blank(),a,{[a]:1});
  const missing={...e.entries}; delete missing[e.head.chunks[0]]; await assert.rejects(readVersions(missing),/missing/);
  await assert.rejects(readVersions({...e.entries,[e.head.chunks[0]]:'AAAA'}),/hash/);
  await assert.rejects(readVersions({...e.entries,[e.key]:{...e.head,version:2}}),/identity/);
  await assert.rejects(readVersions({[`${SYNC_PREFIX}orphan`]:'x'}),/missing head/);
  const reversed=Object.fromEntries(Object.entries(e.entries).reverse()); assert.equal((await readVersions(reversed)).length,1);
});
test('SC07 版本向量识别先后与并发', () => {
  assert.ok(dominates({[a]:2,[b]:1},{[a]:1})); assert.ok(!dominates({[a]:2},{[a]:1,[b]:1}));
  const heads=[{vector:{[a]:1},updatedAt:999},{vector:{[a]:2},updatedAt:1},{vector:{[b]:1},updatedAt:0}]; assert.equal(frontier(heads).length,2); assert.deepEqual(joinVectors(heads.map(h=>h.vector)),{[a]:2,[b]:1});
});
test('SC08 总量项数和临时空间预检不截断', async () => {
  const e=await encodePayload(blank(),a,{[a]:1}); const old={old:'x'.repeat(95000)}; assert.throws(()=>budget(old,e.entries,{QUOTA_BYTES:95001}),/quota/); assert.equal(old.old.length,95000);
  assert.throws(()=>budget(Object.fromEntries(Array.from({length:512},(_,i)=>['k'+i,0])),e.entries),/quota/);
  assert.throws(()=>budget({}, {huge:'x'.repeat(8000)}),/item quota/); assert.ok(budget({},e.entries)>0);
});
