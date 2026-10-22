"""SB01–SB13: native Chrome storage in disposable profiles, test-only replication.
No real Google account or Google-cloud delivery is tested.
"""
from contextlib import contextmanager
from pathlib import Path
from http.server import ThreadingHTTPServer
from threading import Thread
import os
import time
from playwright.sync_api import sync_playwright, expect
from remote_rules_browser_test import session as browser_session, Handler, RULES, COUNTS, document, GATE

OUTPUT = Path(__file__).resolve().parents[1] / 'test-results' / 'settings-sync'
OUTPUT.mkdir(parents=True, exist_ok=True)
PREFIX = 'config-sync:v1:'
STATE = 'config-sync:state'


@contextmanager
def session(p, origin):
    with browser_session(p, origin) as s:
        s.worker.evaluate("globalThis.__settingsSyncUnhandled=[];globalThis.addEventListener('unhandledrejection',e=>globalThis.__settingsSyncUnhandled.push(String(e.reason)))")
        yield s
        assert s.worker.evaluate('globalThis.__settingsSyncUnhandled || []') == []


def rpc(s, operation, **values):
    response = s.settings.evaluate('m=>chrome.runtime.sendMessage({type:"settings-sync",...m})', {'operation': operation, **values})
    assert response['ok'], response
    return response['result']


def get(s, area='local'):
    return s.settings.evaluate('area=>chrome.storage[area].get(null)', area)


def put(s, values, area='local'):
    s.settings.evaluate('({area,values})=>chrome.storage[area].set(values)', {'area': area, 'values': values})


def wait_state(s, state):
    deadline = time.monotonic() + 22
    while time.monotonic() < deadline:
        value = get(s).get(STATE, {})
        if value.get('state') == state:
            # A successful seed must have a committed native head, not just UI text.
            if state != 'equal' or any(k.endswith(':head') for k in get(s, 'sync')):
                return value
        s.settings.wait_for_timeout(80)
    raise AssertionError({'expected':state, 'actual':get(s).get(STATE), 'cloud':get(s,'sync')})


def bridge(source, target, values=None):
    """Test-only transport: copies native sync records, preserving other device branches."""
    target.incoming_device = get(source).get('config-sync:meta', {}).get('deviceId')
    put(target, values if values is not None else get(source, 'sync'), 'sync')


def choose_cloud(s):
    state = wait_state(s, 'conflict')
    index = next((i for i,c in enumerate(state['candidates']) if c['deviceId'] == getattr(s, 'incoming_device', None)), 0)
    expect(s.settings.locator('#sync-conflict')).to_be_visible()
    s.settings.locator('#sync-candidates button').nth(index).click()
    wait_state(s, 'equal')


def clear_cloud(s):
    s.settings.evaluate('()=>chrome.storage.sync.clear()')


@contextmanager
def pair(p, origin):
    with session(p, origin) as a, session(p, origin) as b:
        wait_state(a, 'equal'); wait_state(b, 'equal')
        # Equal payload acknowledges a common starting point without a conflict.
        bridge(a, b); rpc(b, 'retry'); bridge(b, a); rpc(a, 'retry')
        yield a, b


def publish(s, values):
    put(s, values)
    expected = s.settings.evaluate("async()=>{const c=await import('./settings-sync-codec.js');return c.digest(c.canonical(c.exportPayload(await chrome.storage.local.get(null))))}")
    # Exercise automatic debounce and the native 10-second minimum, no forced timer.
    deadline = time.monotonic() + 22
    while time.monotonic() < deadline:
        s.settings.wait_for_timeout(150)
        saved = get(s)
        if saved.get(STATE, {}).get('state') == 'equal' and saved.get('config-sync:meta', {}).get('baseline') == expected:
            return
    raise AssertionError(get(s).get(STATE))


def test_the_sync_switch_is_local_to_each_device_and_persists_across_browser_restarts(p, origin):
    with pair(p, origin) as (a, b):
        a.settings.locator('#chrome-sync').uncheck()
        wait_state(a, 'disabled'); a.restart(p); wait_state(a, 'disabled')
        expect(a.settings.locator('#chrome-sync')).not_to_be_checked()
        expect(b.settings.locator('#chrome-sync')).to_be_checked()
        assert all('settings:chrome-sync' not in str(value) for value in get(b, 'sync').values())


def test_initial_sync_publishes_native_storage_data_without_exposing_routine_technical_status(p, origin):
    with session(p, origin) as s:
        wait_state(s, 'equal')
        assert any(k.endswith(':head') for k in get(s, 'sync')), {'local':get(s), 'cloud':get(s,'sync')}
        group = s.settings.locator('section.settings-group:has(#chrome-sync)')
        expect(group.locator('.setting-description, .settings-note')).to_have_count(0)
        expect(s.settings.locator('#chrome-sync')).to_be_checked()
        original = get(s)[STATE]
        for state in ['checking', 'equal', 'pending', 'waiting-data', 'error']:
            put(s, {STATE: {'state':state, 'enabled':True, 'ready':True, 'candidates':[], 'error':'QUOTA_BYTES_PER_ITEM'}})
            expect(s.settings.locator('#sync-feedback')).to_be_hidden()
            expect(s.settings.locator('#sync-conflict')).to_be_hidden()
            expect(s.settings.locator('#sync-retry')).to_be_hidden()
            expect(s.settings.locator('#chrome-sync')).to_be_checked()
            assert 'QUOTA_BYTES_PER_ITEM' not in group.inner_text()
        put(s, {STATE:original})
        s.settings.locator('#default-min-width').fill('75')
        expect(s.settings.locator('#settings-status')).to_have_text('已保存')
        assert get(s)['filters:width'] == 75


def test_sync_publishes_local_changes_and_resolves_conflicts_while_updating_the_gallery_badge(p, origin):
    with pair(p, origin) as (a, b):
        b.page(); b.open_panel(); b.badge('3')
        a.settings.locator('#default-min-width').fill('200')
        # UI local save triggers the automatic publication path.
        a.settings.wait_for_timeout(11000)
        bridge(a, b); wait_state(b, 'conflict')
        expect(b.settings.locator('#sync-conflict-message')).to_have_text('本机与同步的配置不一致，请选择要使用的设置。')
        expect(b.settings.locator('#sync-use-local')).to_be_visible()
        expect(b.settings.locator('#sync-candidates button')).to_have_text('使用同步设置')
        expect(b.settings.locator('#sync-candidates p')).to_have_count(0)
        assert not b.settings.locator('#sync-diff').evaluate('e=>e.open')
        assert get(b).get('filters:width') is None
        b.badge('3')
        choose_cloud(b)
        expect(b.settings.locator('#sync-conflict')).to_be_hidden()
        expect(b.settings.locator('#sync-feedback')).to_be_hidden()
        expect(b.panel.locator('#min-width')).to_have_attribute('placeholder', '全局默认(200)')
        b.badge('2')


def test_concurrent_sync_versions_remain_available_for_explicit_conflict_resolution(p, origin):
    with pair(p, origin) as (a, b):
        put(a, {'settings:theme':'dark'}); put(b, {'settings:theme':'light'})
        a.settings.wait_for_timeout(11000)
        bridge(a, b); state = wait_state(b, 'conflict')
        assert len(state['candidates']) == 2
        assert get(b)['settings:theme'] == 'light'
        b.settings.locator('#sync-use-local').click(); wait_state(b, 'equal')
        bridge(b, a); wait_state(a, 'conflict')
        assert get(a)['settings:theme'] == 'dark'


def test_sync_differences_remain_readable_across_languages_themes_and_narrow_layouts(p, origin):
    with pair(p, origin) as (a, b):
        publish(b, {'settings:theme':'light'})
        publish(a, {'image-query:v1:one.test':'<script>alert(1)</script>'+'长'*1200})
        bridge(a, b); state=wait_state(b, 'conflict')
        assert len(state['candidates']) == 2
        b.settings.locator('#sync-diff').evaluate('e=>e.open=true')
        b.settings.locator('#sync-differences details').filter(has_text='<script>').first.evaluate('e=>e.open=true')
        for lang in ['zh-CN','zh-TW','en','ja','de','ko','fr']:
            put(a, {'settings:language':lang})
            put(b, {'settings:language':lang})
            b.settings.wait_for_function('lang=>document.documentElement.lang===lang', arg=lang)
            for theme in ['light','dark']:
                put(a, {'settings:theme':theme})
                put(b, {'settings:theme':theme}); b.settings.set_viewport_size({'width':320,'height':900})
                a.settings.set_viewport_size({'width':320,'height':900})
                labels = {'zh-CN':'使用同步设置','zh-TW':'使用同步設定','en':'Use synced settings','ja':'同期先の設定を使用','de':'Synchronisierte Einstellungen verwenden','ko':'동기화된 설정 사용','fr':'Utiliser les paramètres synchronisés'}
                expect(b.settings.locator('#sync-candidates button').first).to_have_text(labels[lang])
                titles=b.settings.locator('#sync-candidates p').all_text_contents()
                assert len(titles)==2 and all('·' in title for title in titles)
                assert all(c['deviceId'][:8] not in b.settings.locator('#sync-conflict').inner_text() for c in state['candidates'])
                expect(a.settings.locator('#sync-conflict')).to_be_hidden()
                expect(a.settings.locator('#sync-feedback')).to_be_hidden()
                assert a.settings.evaluate('document.documentElement.scrollWidth<=innerWidth'), lang
                a.settings.locator('section.settings-group:has(#chrome-sync)').screenshot(path=str(OUTPUT / f'compact-{lang}-{theme}.png'))
                assert b.settings.evaluate('document.documentElement.scrollWidth<=innerWidth'), lang
                b.settings.screenshot(path=str(OUTPUT / f'{lang}-{theme}.png'), full_page=True)
        assert b.settings.locator('#sync-differences').inner_text().find('<script>') >= 0
        assert b.settings.locator('#sync-differences script').count() == 0


def test_partial_reordered_or_corrupt_sync_chunks_never_apply_incomplete_settings(p, origin):
    with pair(p, origin) as (a, b):
        publish(a, {'settings:theme':'dark'})
        data = get(a, 'sync'); own = get(a)['config-sync:meta']['deviceId']
        heads = {k:v for k,v in data.items() if k.endswith(':head') and v['deviceId']==own}
        head_key, head = max(heads.items(), key=lambda item:item[1]['updatedAt'])
        bridge(a, b, {head_key:head}); wait_state(b, 'waiting-data')
        assert get(b).get('settings:theme') is None
        chunks = {k:data[k] for k in head['chunks']}
        bad = dict(chunks); bad[head['chunks'][0]] = 'AAAA'
        bridge(a, b, bad); wait_state(b, 'error')
        assert get(b).get('settings:theme') is None
        bridge(a, b, chunks); wait_state(b, 'conflict')
        assert get(b).get('settings:theme') is None


def test_disabled_devices_neither_publish_nor_consume_synchronized_changes(p, origin):
    with pair(p, origin) as (a, b):
        rpc(b, 'enabled', enabled=False); before = get(b, 'sync')
        b.worker.evaluate("()=>{globalThis.syncCalls=[];for(const method of ['get','set','remove','getBytesInUse']){const original=chrome.storage.sync[method];chrome.storage.sync[method]=(...args)=>{syncCalls.push(method);return original.apply(chrome.storage.sync,args)}}}")
        publish(a, {'filters:width':200}); bridge(a, b)
        put(b, {'filters:width':123}); b.settings.wait_for_timeout(2500)
        assert get(b)[STATE]['state'] == 'disabled'
        assert b.worker.evaluate('globalThis.syncCalls') == []
        own = get(b)['config-sync:meta']['deviceId']
        assert {k:v for k,v in get(b,'sync').items() if own in k} == {k:v for k,v in before.items() if own in k}
        b.restart(p); wait_state(b,'disabled'); assert get(b)['filters:width']==123


def test_reenabling_sync_compares_local_and_cloud_versions_before_applying_changes(p, origin):
    with pair(p, origin) as (a, b):
        rpc(b,'enabled',enabled=False)
        publish(a,{'filters:width':200}); bridge(a,b); put(b,{'filters:width':300})
        b.settings.locator('#chrome-sync').check(); wait_state(b,'conflict')
        assert get(b)['filters:width']==300
        b.settings.reload(); wait_state(b,'conflict'); assert get(b)['filters:width']==300


def test_applying_a_sync_snapshot_preserves_value_presence_gallery_selections_and_unsaved_drafts(p, origin):
    with pair(p, origin) as (a, b):
        b.page(); panel=b.open_panel(); b.badge('3')
        put(b,{'filters:site:v1:127.0.0.1:height':5})
        # Preserve genuine decoded DOM nodes and an unsaved rule draft.
        panel.locator('#site-rules').evaluate('e=>e.open=true')
        panel.locator('#xpath').fill('//main')
        panel.locator('#select-all').check()
        panel.evaluate("window.readyImage=document.querySelector('#gallery img');window.readySource=readyImage.src")
        snapshot=COUNTS.get('/small.png',0)
        values={'filters:site:v1:127.0.0.1:width':0,'image-query:v1:127.0.0.1':'','settings:ready-first':False,'ignored:v1:other.test':['a'*64]}
        publish(a,values); bridge(a,b); choose_cloud(b)
        local=get(b); assert local['filters:site:v1:127.0.0.1:height'] is None
        assert local['filters:site:v1:127.0.0.1:width']==0 and local['settings:ready-first'] is False
        assert local['image-query:v1:127.0.0.1']=='' and local['ignored:v1:other.test']==['a'*64]
        expect(panel.locator('#xpath')).to_have_value('//main')
        assert panel.evaluate("[...document.querySelectorAll('#gallery img')].includes(window.readyImage) && window.readyImage.src===window.readySource")
        assert COUNTS.get('/small.png',0)==snapshot
        assert panel.locator('#gallery input:checked').count()==3
        assert get(b)['config-sync:meta']['backups']
        # Real Web Lock blocks ordinary writer until a competing view releases it.
        panel.evaluate("window.lockGate=new Promise(r=>window.unlockConfig=r);window.lockHeld=false;void navigator.locks.request('imagetaken-config-write',async()=>{window.lockHeld=true;await window.lockGate})")
        panel.wait_for_function('()=>window.lockHeld')
        b.settings.locator('#default-min-height').fill('99'); b.settings.wait_for_timeout(100)
        assert get(b).get('filters:height') != 99
        panel.evaluate('window.unlockConfig()'); b.settings.wait_for_function("async()=>(await chrome.storage.local.get('filters:height'))['filters:height']===99")


def test_synced_subscriptions_reuse_valid_caches_and_discard_responses_for_removed_sources(p, origin):
    with pair(p, origin) as (a, b):
        first=a.add({'width':100}); same=b.add({'height':70})
        second=a.add({'width':250},name='/other/127.0.0.1.json')
        # Wait for automatic publication of the URL list; cache content is excluded.
        a.settings.wait_for_timeout(11000); bridge(a,b); wait_state(b,'conflict'); choose_cloud(b)
        entries=b.rpc('list')['entries']; assert [e['url'] for e in entries]==[first['url'],second['url']]
        assert entries[0]['id']==same['id'] and entries[0]['document']['rules'][0]['options']=={'height':70}
        assert entries[1]['id'] != second['id']
        b.settings.wait_for_function("async()=>{let r=await chrome.runtime.sendMessage({type:'remote-rules',operation:'list'});return r.result.entries.every(e=>e.document)}")
        # A delayed native HTTP refresh must not resurrect an imported deletion.
        slow='/slow/127.0.0.1.json'; slow_entry=b.add({},name=slow)
        publish(a, {'settings:theme':'dark'})
        GATE.clear()
        b.settings.evaluate("id=>{window.slowRefresh=chrome.runtime.sendMessage({type:'remote-rules',operation:'refresh',id});}",slow_entry['id'])
        b.settings.wait_for_timeout(200)
        # Reuse A's latest immutable settings as the explicit candidate.
        bridge(a,b); wait_state(b,'conflict'); choose_cloud(b)
        GATE.set(); b.settings.evaluate('()=>window.slowRefresh')
        assert slow_entry['id'] not in [e['id'] for e in b.rpc('list')['entries']]


def test_active_download_batches_retain_their_settings_while_later_batches_use_synchronized_values(p, origin):
    with pair(p, origin) as (a,b):
        b.page(); panel=b.open_panel()
        panel.evaluate('''()=>{
          window.showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle('chosen',{create:true});
          const original=FileSystemFileHandle.prototype.createWritable;
          window.writesStarted=0;const gate=new Promise(resolve=>window.releaseWrites=resolve);
          FileSystemFileHandle.prototype.createWritable=async function(...args){window.writesStarted++;await gate;return original.apply(this,args)};
        }''')
        panel.locator('#choose-location').click(); expect(panel.locator('#download-location')).to_have_text('chosen')
        panel.locator('#select-all').check(); panel.locator('#download').click(); panel.wait_for_function('()=>window.writesStarted>0')
        publish(a,{'filters:width':500,'settings:download-manifest':True,'xpath:v1:127.0.0.1':'//main'})
        bridge(a,b); choose_cloud(b)
        expect(panel.locator('#min-width')).to_have_attribute('placeholder','全局默认(50)')
        panel.evaluate('window.releaseWrites()'); expect(panel.locator('#refresh')).to_be_enabled(timeout=30000)
        expect(panel.locator('#min-width')).to_have_attribute('placeholder','全局默认(500)')
        files=panel.evaluate("async()=>{const root=await navigator.storage.getDirectory();const chosen=await root.getDirectoryHandle('chosen');const folder=await chosen.getDirectoryHandle('Remote album');const out=[];for await(const name of folder.keys())out.push(name);return out}")
        assert len(files)==3 and all(n.endswith('.png') for n in files),files
        expect(b.settings.locator('#download-manifest')).to_be_checked()


def test_sync_quota_failures_preserve_local_settings_and_recover_after_the_payload_becomes_small_enough(p, origin):
    with session(p,origin) as s:
        wait_state(s,'equal'); old=get(s,'sync')
        # Native Chrome rejects an actual over-limit item independently of preflight.
        result=s.settings.evaluate("async()=>{try{await chrome.storage.sync.set({nativeQuotaProbe:'x'.repeat(9000)});return 'unexpected'}catch(e){return e.message}}")
        assert 'quotabytesperitem' in result.replace('_','').lower(),result
        huge='猫'*40000; put(s,{'image-query:v1:one.test':huge})
        rpc(s,'retry'); result=wait_state(s,'error'); assert 'quota' in result['error']
        assert get(s)['image-query:v1:one.test']==huge and get(s,'sync')==old
        expect(s.settings.locator('#sync-feedback')).to_be_hidden()
        expect(s.settings.locator('#sync-retry')).to_be_hidden()
        put(s,{'image-query:v1:one.test':'small','filters:width':88});s.settings.wait_for_timeout(11000)
        wait_state(s,'equal');assert get(s)['filters:width']==88
        expect(s.settings.locator('#sync-feedback')).to_be_hidden()


def test_failed_sync_actions_provide_concise_feedback_and_support_retrying_the_same_operation(p, origin):
    with pair(p, origin) as (a,b):
        publish(a, {'filters:width':200}); bridge(a,b); wait_state(b,'conflict')
        b.settings.evaluate("""()=>{
          const original=chrome.runtime.sendMessage.bind(chrome.runtime);
          window.syncOperations=[];
          chrome.runtime.sendMessage=async message=>{
            if(message.type==='settings-sync')syncOperations.push(message.operation);
            const response=await original(message);
            return message.operation==='choose' && !response.ok ? {...response,error:response.error+' QUOTA_BYTES_PER_ITEM'} : response;
          };
        }""")
        # Make the displayed token stale; use the real engine's rejection path.
        put(b, {'filters:width':300})
        b.settings.locator('#sync-candidates button').first.click()
        expect(b.settings.locator('#sync-status')).to_have_text('操作未完成，请重试。')
        expect(b.settings.locator('#sync-feedback')).to_be_visible()
        assert 'QUOTA_BYTES_PER_ITEM' not in b.settings.locator('main').inner_text()
        assert get(b)['filters:width']==300
        b.settings.locator('#sync-retry').click()
        expect(b.settings.locator('#sync-feedback')).to_be_hidden()
        expect(b.settings.locator('#sync-conflict')).to_be_visible()
        assert b.settings.evaluate('window.syncOperations')==['choose','retry']
        assert get(b)['filters:width']==300
        choose_cloud(b)
        expect(b.settings.locator('#sync-conflict')).to_be_hidden()
        expect(b.settings.locator('#sync-feedback')).to_be_hidden()
        assert get(b)['filters:width']==200
        # Initial UI read failure gets the same concise, recoverable feedback.
        fresh=b.context.new_page()
        fresh.add_init_script("""(()=>{
          const original=chrome.runtime.sendMessage.bind(chrome.runtime);
          let first=true;
          chrome.runtime.sendMessage=async message=>{
            if(first && message.type==='settings-sync' && message.operation==='status'){
              first=false;return {ok:false,error:'QUOTA_BYTES_PER_ITEM'};
            }
            return original(message);
          };
        })()""")
        fresh.goto(f'chrome-extension://{b.extension_id}/settings.html')
        expect(fresh.locator('#sync-status')).to_have_text('操作未完成，请重试。')
        expect(fresh.locator('#chrome-sync')).to_be_disabled()
        assert 'QUOTA_BYTES_PER_ITEM' not in fresh.locator('main').inner_text()
        fresh.locator('#sync-retry').click()
        expect(fresh.locator('#sync-feedback')).to_be_hidden()
        expect(fresh.locator('#chrome-sync')).to_be_enabled()
        expect(fresh.locator('#chrome-sync')).to_be_checked()
        fresh.close()



# Preserve all legacy substring selectors without displaying numbered names.
TEST_CASES = {
    'test_the_sync_switch_is_local_to_each_device_and_persists_across_browser_restarts': ('test_SB01_device_switch', 'The sync switch is local to each device and persists across browser restarts.'),
    'test_initial_sync_publishes_native_storage_data_without_exposing_routine_technical_status': ('test_SB02_initial_native_storage', 'Initial sync publishes native storage data without exposing routine technical status.'),
    'test_sync_publishes_local_changes_and_resolves_conflicts_while_updating_the_gallery_badge': ('test_SB03_auto_publish_choose_and_badge', 'Sync publishes local changes and resolves conflicts while updating the gallery badge.'),
    'test_concurrent_sync_versions_remain_available_for_explicit_conflict_resolution': ('test_SB04_concurrent_candidates', 'Concurrent sync versions remain available for explicit conflict resolution.'),
    'test_sync_differences_remain_readable_across_languages_themes_and_narrow_layouts': ('test_SB05_diff_languages_and_layout', 'Sync differences remain readable across languages, themes, and narrow layouts.'),
    'test_partial_reordered_or_corrupt_sync_chunks_never_apply_incomplete_settings': ('test_SB06_partial_out_of_order_corrupt', 'Partial, reordered, or corrupt sync chunks never apply incomplete settings.'),
    'test_disabled_devices_neither_publish_nor_consume_synchronized_changes': ('test_SB07_disabled_no_participation', 'Disabled devices neither publish nor consume synchronized changes.'),
    'test_reenabling_sync_compares_local_and_cloud_versions_before_applying_changes': ('test_SB08_reenable_compares', 'Reenabling sync compares local and cloud versions before applying changes.'),
    'test_applying_a_sync_snapshot_preserves_value_presence_gallery_selections_and_unsaved_drafts': ('test_SB09_atomic_presence_views_and_drafts', 'Applying a sync snapshot preserves value presence, gallery selections, and unsaved drafts.'),
    'test_synced_subscriptions_reuse_valid_caches_and_discard_responses_for_removed_sources': ('test_SB10_subscriptions_cache_and_removed_request', 'Synced subscriptions reuse valid caches and discard responses for removed sources.'),
    'test_active_download_batches_retain_their_settings_while_later_batches_use_synchronized_values': ('test_SB11_download_frozen_batch', 'Active download batches retain their settings while later batches use synchronized values.'),
    'test_sync_quota_failures_preserve_local_settings_and_recover_after_the_payload_becomes_small_enough': ('test_SB12_native_quota_recovery', 'Sync quota failures preserve local settings and recover after the payload becomes small enough.'),
    'test_failed_sync_actions_provide_concise_feedback_and_support_retrying_the_same_operation': ('test_SB13_sync_action_failure_feedback', 'Failed sync actions provide concise feedback and support retrying the same operation.'),
}

if __name__=='__main__':
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            for name,case in list(globals().items()):
                if name.startswith('test_') and (not os.environ.get('SYNC_TEST') or os.environ['SYNC_TEST'] in TEST_CASES[name][0]):
                    RULES.clear();GATE.set();case(p,origin);print('PASS '+TEST_CASES[name][1],flush=True)
    finally:
        GATE.set();server.shutdown()
