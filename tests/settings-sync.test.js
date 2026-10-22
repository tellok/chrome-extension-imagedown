import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsSync, SYNC_META_KEY } from '../extension/settings-sync.js';
import { SYNC_ENABLED_KEY, SYNC_STATE_KEY, SYNC_IMPORT_KEY, encodePayload, readVersions, exportPayload, dominates } from '../extension/settings-sync-codec.js';
const device='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
function fixture(initial={}, cloud={}) {
  let time=100000, calls=[], timers=[], fail='', hook;
  const data=structuredClone(initial), remote=structuredClone(cloud), writes=[];
  const store=(target,isSync=false)=>({
    async get(keys){ if(isSync){calls.push('get');if(fail==='get')throw new Error('offline'); if(hook)await hook();} return structuredClone(keys===null?target:Object.fromEntries([].concat(keys).filter(k=>Object.hasOwn(target,k)).map(k=>[k,target[k]]))); },
    async set(values){if(isSync){calls.push('set');if(fail==='set')throw new Error('quota');}else writes.push(structuredClone(values)); Object.assign(target,structuredClone(values));},
    async remove(keys){if(isSync)calls.push('remove');for(const k of [].concat(keys))delete target[k];},
    async getBytesInUse(){calls.push('bytes');return new TextEncoder().encode(JSON.stringify(target)).length;},
  });
  const local=store(data), sync=store(remote,true), alarms={async create(){},async clear(){}};
  const engine=createSettingsSync({local,sync,alarms,lock:f=>f(),now:()=>time,timer:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},cancelTimer:t=>{timers=timers.filter(x=>x!==t);}});
  return {engine,data,remote,calls,writes,local,sync, timers:()=>timers, advance:()=>{time+=10001;},fail:value=>{fail=value;},hook:value=>{hook=value;}};
}
async function seed(settings={'settings:theme':'dark'}, vector={[device]:1}){return (await encodePayload(exportPayload(settings),device,vector)).entries;}
test('Settings sync starts enabled while each device can disable participation locally.',async()=>{
  const a=fixture({[SYNC_ENABLED_KEY]:false}),b=fixture();await a.engine.start();await b.engine.start();assert.equal(a.calls.length,0);assert.equal(a.engine.getStatus().state,'disabled');assert.equal(b.engine.getStatus().enabled,true);assert.ok(b.calls.length);assert.equal(exportPayload(a.data).settings[SYNC_ENABLED_KEY],undefined);
});
test('An empty cloud receives the first local snapshot and establishes a shared baseline.',async()=>{
  const f=fixture({'settings:theme':'dark'});await f.engine.start();assert.equal((await readVersions(f.remote))[0].payload.settings['settings:theme'],'dark');assert.ok(f.data[SYNC_META_KEY].baseline);assert.equal(f.engine.getStatus().state,'equal');
  const partial=fixture({}, {'config-sync:v1:orphan':'x'});await partial.engine.start();assert.equal(partial.engine.getStatus().state,'waiting-data');assert.ok(!partial.calls.includes('set'));
});
test('Local setting changes publish after debouncing without creating a feedback loop.',async()=>{
  const f=fixture();await f.engine.start();f.advance();f.data['filters:width']=12;f.engine.changed({'filters:width':{}},'local');f.engine.changed({'filters:width':{}},'local');assert.equal(f.timers().length,1);assert.equal(f.timers()[0].ms,2000);await f.engine.retry();const n=f.calls.filter(c=>c==='set').length;await f.engine.retry();f.engine.changed({[SYNC_STATE_KEY]:{}},'local');assert.equal(f.calls.filter(c=>c==='set').length,n);assert.equal((await readVersions(f.remote))[0].payload.settings['filters:width'],12);
});
test('Startup conflicts preserve both versions and pause uploads.',async()=>{
  const cloud=await seed();const f=fixture({'settings:theme':'light'},cloud);await f.engine.start();assert.equal(f.engine.getStatus().state,'conflict');assert.equal(f.data['settings:theme'],'light');assert.deepEqual(f.remote,cloud);await f.engine.retry();assert.ok(!f.calls.includes('set'));
});
test('Cloud comparison acknowledges matching settings and reports differing settings as conflicts.',async()=>{
  const f=fixture({'settings:theme':'dark'},await seed());await f.engine.start();assert.equal(f.engine.getStatus().state,'equal');Object.assign(f.remote,await seed({'settings:theme':'light'},{[device]:2}));await f.engine.retry();assert.equal(f.engine.getStatus().state,'conflict');assert.equal(f.data['settings:theme'],'dark');
});
test('Choosing local settings supersedes observed versions while preserving unseen concurrent branches.',async()=>{
  const f=fixture({'settings:theme':'light'},await seed());await f.engine.start();const seen=(await readVersions(f.remote))[0].head;await f.engine.choose(f.engine.getStatus().token);const versions=await readVersions(f.remote);assert.equal(versions.length,1);assert.ok(dominates(versions[0].head.vector,seen.vector));assert.equal(f.data['settings:theme'],'light');
  const unseen='cccccccc-cccc-4ccc-cccc-cccccccccccc';Object.assign(f.remote,(await encodePayload(exportPayload({'settings:theme':'system'}),unseen,{[unseen]:1})).entries);await f.engine.retry();assert.equal(f.engine.getStatus().candidates.length,2);
});
test('Choosing cloud settings applies one atomic snapshot and preserves local only data.',async()=>{
  const f=fixture({'settings:theme':'light','filters:site:v1:one.test:width':80,'download-location:revision':7,[SYNC_ENABLED_KEY]:true},await seed());await f.engine.start();const s=f.engine.getStatus();await f.engine.choose(s.token,s.candidates[0].revision);const writes=f.writes.filter(v=>v[SYNC_IMPORT_KEY]);assert.equal(writes.length,1);assert.equal(writes[0]['filters:site:v1:one.test:width'],null);assert.ok(writes[0][SYNC_META_KEY].backups.length);assert.equal(f.data['settings:theme'],'dark');assert.equal(f.data['download-location:revision'],7);assert.equal(f.data[SYNC_ENABLED_KEY],true);
});
test('Stale conflict decisions are rejected and trigger a fresh comparison.',async()=>{
  const f=fixture({},await seed());await f.engine.start();const token=f.engine.getStatus().token;f.data['filters:width']=123;await assert.rejects(f.engine.choose(token),/expired/);assert.equal(f.data['filters:width'],123);const token2=f.engine.getStatus().token;Object.assign(f.remote,await seed({'settings:theme':'light'},{[device]:2}));await assert.rejects(f.engine.choose(token2),/expired/);assert.notEqual(f.engine.getStatus().token,token2);
});
test('Sync failures preserve pending local changes until a retry succeeds.',async()=>{
  const f=fixture();f.fail('get');await f.engine.start();assert.equal(f.engine.getStatus().state,'error');f.fail('');await f.engine.retry();const previous=structuredClone(f.remote);f.advance();f.data['filters:width']=7;f.fail('set');await f.engine.retry();assert.equal(f.engine.getStatus().state,'error');assert.deepEqual(f.remote,previous);f.data['filters:width']=9;f.fail('');await f.engine.retry();assert.equal((await readVersions(f.remote))[0].payload.settings['filters:width'],9);
});
test('Disabling sync invalidates in flight requests and reenabling it compares versions again.',async()=>{
  const f=fixture();let release;f.hook(()=>new Promise(resolve=>{release=resolve;}));const pending=f.engine.start();while(!release)await new Promise(r=>setImmediate(r));await f.engine.setEnabled(false);release();await pending;assert.ok(!f.calls.includes('set'));const count=f.calls.length;f.engine.changed({x:{}},'sync');await f.engine.retry();assert.equal(f.calls.length,count);f.hook(null);Object.assign(f.remote,await seed());await f.engine.setEnabled(true);assert.equal(f.engine.getStatus().state,'conflict');
});
