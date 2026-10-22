"""32-case approval: RB01-RB12. Real extension, disposable profiles and local rules only."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import random
import re
import tempfile
from threading import Thread, Event
import time
from urllib.parse import urlsplit
from PIL import Image
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'test-results' / 'remote-rules'
OUTPUT.mkdir(parents=True, exist_ok=True)
RULES, COUNTS, HEADERS = {}, {}, {}
GATE = Event()
GATE.set()
rng = random.Random(10)

def image(width, height):
    out = io.BytesIO()
    Image.frombytes('RGB', (width, height), rng.randbytes(width * height * 3)).save(out, 'PNG')
    return out.getvalue()

SMALL, LARGE = image(100, 80), image(300, 200)

def document(options=None, pattern='.*'):
    return {'version': 1, 'rules': [{'id': 'demo', 'pattern': pattern, 'options': options or {}}]}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        COUNTS[path] = COUNTS.get(path, 0) + 1
        HEADERS[path] = dict(self.headers)
        if path.endswith('.json'):
            value = RULES.get(path, 'offline')
            if value == 'offline':
                self.send_response(503)
                self.end_headers()
                return
            if path.startswith('/slow/'):
                GATE.wait(10)
            body = value.encode() if isinstance(value, str) else json.dumps(value).encode()
            mime = 'application/json'
        elif path.endswith('.png'):
            body = SMALL if 'small' in path else LARGE
            mime = 'image/png'
        elif path == '/frame':
            body = b'<img src="/frame.png">'
            mime = 'text/html'
        else:
            extra = f'<iframe src="http://localhost:{self.server.server_port}/frame"></iframe>' if path == '/scope' else ''
            body = f'''<!doctype html><link rel="icon" href="data:,"><title>Remote album</title>
<main><img alt="small" src="/small.png"><div class="ad"><img alt="ad" src="/ad.png"></div></main>
<img alt="large" src="/large.png">{extra}'''.encode()
            mime = 'text/html'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store' if path.endswith('.json') else 'public,max-age=3600')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


class Session:
    def __init__(self, context, worker, origin, folder):
        self.context, self.worker, self.origin, self.folder = context, worker, origin, folder
        self.extension_id = worker.url.split('/')[2]
        self.settings = context.new_page()
        self.settings.goto(f'chrome-extension://{self.extension_id}/settings.html')
        expect(self.settings.locator('#subscriptions-add')).to_be_enabled()
        self.source = None
        self.panel = None

    def restart(self, playwright):
        profile, options, errors = self.profile, self.launch_options, self.errors
        self.context.close()
        context = playwright.chromium.launch_persistent_context(profile, **options)
        context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        restarted = Session(context, worker, self.origin, self.folder)
        self.__dict__.update(restarted.__dict__)
        self.profile, self.launch_options, self.errors = profile, options, errors

    def rpc(self, operation, **extra):
        result = self.settings.evaluate('async message=>chrome.runtime.sendMessage({type:"remote-rules",...message})', {'operation': operation, **extra})
        assert result['ok'], result
        return result['result']

    def add(self, options=None, pattern='.*', name='/rules/127.0.0.1.json'):
        RULES[name] = document(options, pattern)
        self.settings.locator('#subscription-url').fill(self.origin + name)
        self.settings.locator('#subscriptions-add').click()
        expect(self.settings.locator('#subscriptions-add')).to_be_enabled()
        expect(self.settings.locator('.subscription')).to_have_count(len(self.rpc('list')['entries']))
        entries = self.rpc('list')['entries']
        assert entries[-1].get('document'), entries
        return entries[-1]

    def page(self, path='/one'):
        if not self.source:
            self.source = self.context.new_page()
        self.source.goto(self.origin + path, wait_until='networkidle')
        self.tab_id = self.worker.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', self.source.url)
        return self.source

    def open_panel(self):
        self.panel = self.context.new_page()
        self.panel.goto(f'chrome-extension://{self.extension_id}/panel.html?tab={self.tab_id}')
        expect(self.panel.locator('#refresh')).to_be_enabled(timeout=15000)
        expect(self.panel.locator('#min-width')).to_be_enabled()
        self.panel.locator('#gallery img').evaluate_all("images=>images.forEach(i=>i.loading='eager')")
        self.panel.wait_for_function("()=>[...document.querySelectorAll('#gallery img')].every(i=>i.complete)")
        return self.panel

    def badge(self, value, tab=None):
        tab = self.tab_id if tab is None else tab
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if self.worker.evaluate('id=>chrome.action.getBadgeText({tabId:id})', tab) == value:
                return
            self.settings.wait_for_timeout(80)
        raise AssertionError({'expected': value, 'actual': self.worker.evaluate('id=>chrome.action.getBadgeText({tabId:id})', tab), 'diagnostic': self.worker.evaluate('id=>globalThis.__imageTakenBadgeDiagnostics.get(id)', tab)})

    def refresh(self, entry, options, pattern='.*'):
        RULES[urlsplit(entry['url']).path] = document(options, pattern)
        return self.rpc('refresh', id=entry['id'])


@contextmanager
def session(p, origin):
    with tempfile.TemporaryDirectory(prefix='imagetaken-remote-rules-') as profile:
        folder = Path(profile) / 'downloads'
        default = Path(profile) / 'Default'
        default.mkdir()
        (default / 'Preferences').write_text(json.dumps({'download': {'default_directory': str(folder), 'prompt_for_download': False}}))
        candidates = sorted((Path.home() / 'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        executable = os.environ.get('CHROMIUM_PATH') or (str(candidates[-1]) if candidates else None)
        extension = str(ROOT / 'extension')
        options = dict(executable_path=executable, channel='chromium', headless=True, locale='zh-CN', accept_downloads=True, viewport={'width': 800, 'height': 900}, args=[f'--disable-extensions-except={extension}', f'--load-extension={extension}'])
        context = p.chromium.launch_persistent_context(profile, **options)
        errors = []
        context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            s = Session(context, worker, origin, folder)
            s.profile, s.launch_options, s.errors = profile, options, errors
            yield s
            assert not errors, errors
        finally:
            GATE.set()
            s.context.close()


def test_subscription_settings_support_adding_refreshing_reordering_and_removing_sources(p, origin):
    with session(p, origin) as s:
        first = s.add({'width': 80})
        second = s.add({'height': 60}, name='/b/localhost.json')
        before = COUNTS.get('/rules/127.0.0.1.json', 0)
        s.settings.locator('.subscription').first.locator('[data-operation=refresh]').click()
        expect(s.settings.locator('#subscriptions-add')).to_be_enabled()
        assert COUNTS['/rules/127.0.0.1.json'] == before + 1
        s.settings.locator('#subscriptions-refresh-all').click()
        expect(s.settings.locator('#subscriptions-add')).to_be_enabled()
        assert COUNTS['/rules/127.0.0.1.json'] == before + 2
        s.settings.reload()
        expect(s.settings.locator('.subscription')).to_have_count(2)
        s.settings.locator('.subscription').first.locator('[data-operation=remove]').click()
        expect(s.settings.locator('.subscription')).to_have_count(1)
        assert s.rpc('list')['entries'][0]['id'] == second['id']
        assert not s.rpc('list')['entries'][0].get('error')
        assert 'Cookie' not in HEADERS['/b/localhost.json'] and 'Referer' not in HEADERS['/b/localhost.json']


def test_subscription_settings_reject_invalid_and_duplicate_urls_and_expose_initial_fetch_failures(p, origin):
    with session(p, origin) as s:
        s.settings.locator('#subscription-url').fill('https://rules.test/not-a-rule')
        s.settings.locator('#subscriptions-add').click()
        expect(s.settings.locator('#subscriptions-status')).to_contain_text('source URL')
        expect(s.settings.locator('.subscription')).to_have_count(0)
        first = s.add()
        s.settings.locator('#subscription-url').fill(first['url'])
        s.settings.locator('#subscriptions-add').click()
        expect(s.settings.locator('#subscriptions-status')).to_contain_text('Duplicate')
        expect(s.settings.locator('.subscription')).to_have_count(1)
        bad = '/missing/127.0.0.1.json'
        RULES[bad] = 'offline'
        s.settings.locator('#subscription-url').fill(origin + bad)
        s.settings.locator('#subscriptions-add').click()
        expect(s.settings.locator('.subscription')).to_have_count(2)
        expect(s.settings.locator('.subscription').last.locator('.error')).to_contain_text('503')
        assert not s.rpc('list')['entries'][-1].get('document')


def test_subscriptions_preserve_cached_rules_offline_and_resume_scheduled_refreshes_after_worker_restart(p, origin):
    with session(p, origin) as s:
        first = s.add({'width': 200})
        s.page()
        s.badge('2')
        RULES['/rules/127.0.0.1.json'] = 'offline'
        # Restart only the disposable browser profile; the valid cache must survive.
        s.restart(p)
        s.page('/two')
        assert s.rpc('effective', url=s.source.url)['values']['width'] == 200
        s.badge('2')
        s.worker.evaluate("async()=>chrome.alarms.create('imagetaken-remote-rules',{when:Date.now()+100})")
        expect(s.settings.locator('.subscription .error')).to_contain_text('503', timeout=15000)
        s.badge('2')
        assert s.rpc('list')['entries'][0]['lastSuccess'] == first['lastSuccess']
        RULES['/rules/127.0.0.1.json'] = document({'width': 500})
        s.worker.evaluate("async()=>chrome.alarms.create('imagetaken-remote-rules',{when:Date.now()+100})")
        s.badge('0')


def test_remote_rules_affect_badges_before_a_gallery_opens_and_respect_page_paths_without_extra_image_requests(p, origin):
    with session(p, origin) as s:
        entry = s.add({'width': 200}, '/one$')
        s.page('/one')
        s.worker.evaluate('globalThis.remoteTestDebuggerReads=0; chrome.runtime.onMessage.addListener(m=>{if(m.type==="read-browser-resources")globalThis.remoteTestDebuggerReads++})')
        s.badge('2')
        before = {k: v for k, v in COUNTS.items() if k.endswith('.png')}
        s.page('/two')
        s.badge('3')
        assert s.worker.evaluate('globalThis.remoteTestDebuggerReads') == 0
        s.open_panel()
        s.badge('3')
        expect(s.panel.locator('.card')).to_have_count(3)
        assert {k: v for k, v in COUNTS.items() if k.endswith('.png')} == before
        s.panel.close()
        s.badge('3')


def test_local_overrides_take_precedence_over_remote_defaults_and_reset_controls_restore_inheritance(p, origin):
    with session(p, origin) as s:
        entry = s.add({'width': 200, 'query': 'large'})
        s.page()
        s.badge('1')
        panel = s.open_panel()
        expect(panel.locator('#min-width')).to_have_attribute('placeholder', '远程默认(200)')
        expect(panel.locator('#active-remote-rule')).to_contain_text('127.0.0.1.json')
        panel.locator('#query').fill('')
        s.badge('2')
        assert s.worker.evaluate("async()=> (await chrome.storage.local.get('image-query:v1:127.0.0.1'))['image-query:v1:127.0.0.1']") == ''
        panel.locator('#filters').evaluate('e=>e.open=true')
        panel.locator('#min-width').fill('0')
        panel.locator('#min-width').blur()
        s.badge('3')
        expect(panel.locator('#min-width')).to_have_value('0')
        panel.locator('#reset-min-width').click()
        expect(panel.locator('#min-width')).to_have_attribute('placeholder', '远程默认(200)')
        s.badge('2')
        s.rpc('remove', id=entry['id'])
        expect(panel.locator('#min-width')).to_have_attribute('placeholder', '全局默认(50)')
        s.badge('3')


def test_remote_xpath_scopes_and_css_exclusions_restrict_the_discovered_image_set(p, origin):
    with session(p, origin) as s:
        entry = s.add({'xpath': '//main', 'excludedSelectors': '.ad'})
        s.page('/scope')
        s.badge('1')
        panel = s.open_panel()
        expect(panel.locator('.card')).to_have_count(1)
        expect(panel.locator('#active-xpath')).to_have_text('//main')
        s.refresh(entry, {'xpath': '//main', 'excludedSelectors': ''})
        s.badge('2')
        expect(panel.locator('.card')).to_have_count(2)
        s.refresh(entry, {'xpath': '', 'excludedSelectors': '.ad'})
        s.badge('3')  # Small + outside + iframe; resource records cannot resurrect the ad.
        expect(panel.locator('.card')).to_have_count(3)


def test_remote_rule_updates_reuse_previews_and_preserve_selections_and_unsaved_drafts(p, origin):
    with session(p, origin) as s:
        entry = s.add({'width': 50})
        s.page()
        panel = s.open_panel()
        expect(panel.locator('.card')).to_have_count(3)
        panel.locator('#select-all').check()
        panel.locator('#site-rules').evaluate('e=>e.open=true')
        panel.locator('#xpath').fill('//main[@id="draft"]')
        panel.evaluate("window.originalCards=[...document.querySelectorAll('.card')]; window.imageReads=0; const send=chrome.runtime.sendMessage; chrome.runtime.sendMessage=function(m,...rest){if(m?.type==='read-browser-resources')window.imageReads++;return send.call(this,m,...rest)}")
        before = dict(COUNTS)
        s.refresh(entry, {'width': 80})
        expect(panel.locator('#min-width')).to_have_attribute('placeholder', '远程默认(80)')
        expect(panel.locator('#xpath')).to_have_value('//main[@id="draft"]')
        assert panel.evaluate("window.originalCards.every(c=>c.isConnected) && window.imageReads===0")
        expect(panel.locator('#select-all')).to_be_checked()
        s.rpc('refresh', id=entry['id'])
        panel.wait_for_timeout(400)
        assert panel.evaluate('window.originalCards.every(c=>c.isConnected) && window.imageReads===0')
        assert {k:v for k,v in COUNTS.items() if k.endswith('.png')} == {k:v for k,v in before.items() if k.endswith('.png')}


def test_regular_expression_timeouts_preserve_usable_rules_and_concurrent_requests_share_one_offscreen_host(p, origin):
    with session(p, origin) as s:
        entry = s.add()
        source = s.page('/' + 'a' * 100 + '!')
        s.refresh(entry, {'width': 999}, '^https?://[^/]+/(a+)+$')
        result = s.rpc('effective', url=source.url)
        assert result['values']['width'] == 50 and 'timeout' in result['error']
        assert s.rpc('list')['entries'][0]['document']
        s.open_panel()
        expect(s.panel.locator('#active-remote-rule')).to_contain_text('timeout')
        s.worker.evaluate("async()=>{if((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)await chrome.offscreen.closeDocument()}")
        results = s.settings.evaluate("async origin=>Promise.all(Array.from({length:6},(_,i)=>chrome.runtime.sendMessage({type:'remote-rules',operation:'effective',url:origin+'/safe-'+i})))", origin)
        assert all(result['ok'] for result in results)
        assert s.worker.evaluate("async()=> (await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length") == 1
        s.settings.locator('#subscription-url').fill(origin + '/another/localhost.json')
        assert s.settings.locator('#subscription-url').input_value().endswith('.json')


def test_navigation_and_subscription_removal_invalidate_late_rule_evaluation_and_refresh_results(p, origin):
    with session(p, origin) as s:
        entry = s.add({'width': 200}, '/one$', name='/slow/127.0.0.1.json')
        s.page()
        panel = s.open_panel()
        s.badge('2')
        other = s.context.new_page()
        other.goto(origin.replace('127.0.0.1', 'localhost') + '/two')
        other_id = s.worker.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', other.url)
        s.badge('3', other_id)
        GATE.clear()
        RULES['/slow/127.0.0.1.json'] = document({'width': 500}, '/one$')
        before = COUNTS['/slow/127.0.0.1.json']
        s.settings.evaluate("id=>{window.delayedRefresh=chrome.runtime.sendMessage({type:'remote-rules',operation:'refresh',id})}", entry['id'])
        deadline = time.monotonic() + 5
        while COUNTS['/slow/127.0.0.1.json'] == before and time.monotonic() < deadline:
            s.settings.wait_for_timeout(50)
        assert COUNTS['/slow/127.0.0.1.json'] > before
        s.page('/two')
        s.rpc('remove', id=entry['id'])
        GATE.set()
        assert s.settings.evaluate('window.delayedRefresh')['ok']
        s.badge('3')
        s.badge('3', other_id)
        expect(panel.locator('#min-width')).to_have_attribute('placeholder', '全局默认(50)')
        assert s.rpc('effective', url=s.source.url)['remote'] is None
        assert not s.rpc('list')['entries']


def test_subscription_controls_remain_usable_across_languages_themes_and_narrow_layouts(p, origin):
    with session(p, origin) as s:
        s.add(name='/' + 'long-' * 35 + '/127.0.0.1.json')
        s.settings.set_viewport_size({'width': 320, 'height': 900})
        for language in ['ja', 'de', 'en', 'zh-CN', 'zh-TW', 'ko', 'fr']:
            s.settings.locator('#language').select_option(language)
            s.settings.wait_for_function('lang=>document.documentElement.lang===lang', arg=language)
            for theme in ['light', 'dark']:
                s.settings.locator('#theme').select_option(theme)
                assert s.settings.evaluate('document.documentElement.scrollWidth<=innerWidth')
                expect(s.settings.locator('#subscriptions-add')).to_be_visible()
                assert s.settings.locator('.subscription-url').get_attribute('title').startswith(origin)
                assert s.settings.locator('#subscriptions-heading').inner_text()
        s.settings.screenshot(path=str(OUTPUT / 'settings-dark-320.png'), full_page=True)
        s.page()
        panel = s.open_panel()
        panel.set_viewport_size({'width': 320, 'height': 900})
        panel.locator('#filters').evaluate('e=>e.open=true')
        assert panel.evaluate('document.documentElement.scrollWidth<=innerWidth')
        widths = panel.locator('.dimension-control, #min-size, #type').evaluate_all('els=>els.map(e=>e.getBoundingClientRect().width)')
        assert max(widths) - min(widths) < 2, widths
        panel.screenshot(path=str(OUTPUT / 'panel-dark-320.png'))


def test_invalid_remote_selectors_preserve_the_last_valid_cached_rule_document(p, origin):
    with session(p, origin) as s:
        entry = s.add({'width': 200})
        s.page()
        s.badge('2')
        for options in [{'xpath': 'count(//img)'}, {'excludedSelectors': '['}]:
            state = s.refresh(entry, options)
            assert state['entries'][0]['document'] == entry['document'], {'options': options, 'state': state, 'before': entry}
            assert state['entries'][0]['error']
            assert state['entries'][0]['lastSuccess'] == entry['lastSuccess']
            s.badge('2')
        expect(s.settings.locator('.subscription .error')).to_be_visible()


def test_active_download_batches_retain_their_filters_until_remote_rule_updates_can_be_applied(p, origin):
    with session(p, origin) as s:
        entry = s.add({'width': 50})
        s.page()
        panel = s.open_panel()
        # Real filesystem writes pause in this disposable profile, preserving original download code.
        panel.evaluate('''()=>{
          window.showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle('chosen',{create:true});
          const original=FileSystemFileHandle.prototype.createWritable;
          window.writesStarted=0;window.releaseWrites=null;
          const gate=new Promise(resolve=>window.releaseWrites=resolve);
          FileSystemFileHandle.prototype.createWritable=async function(...args){window.writesStarted++;await gate;return original.apply(this,args)};
        }''')
        panel.locator('#choose-location').click()
        expect(panel.locator('#download-location')).to_have_text('chosen')
        panel.locator('#select-all').check()
        panel.locator('#download').click()
        panel.wait_for_function('()=>window.writesStarted>0')
        s.refresh(entry, {'width': 500})
        expect(panel.locator('#min-width')).to_have_attribute('placeholder', '远程默认(50)')
        panel.evaluate('window.releaseWrites()')
        expect(panel.locator('#refresh')).to_be_enabled(timeout=30000)
        expect(panel.locator('#min-width')).to_have_attribute('placeholder', '远程默认(500)')
        files = panel.evaluate('''async()=>{
          const root=await navigator.storage.getDirectory(); const chosen=await root.getDirectoryHandle('chosen');const folder=await chosen.getDirectoryHandle('Remote album');
          const names=[];for await(const name of folder.keys())names.push(name);return names;
        }''')
        assert len(files) == 3 and all(name.endswith('.png') for name in files), files
        expect(s.settings.locator('#download-manifest')).not_to_be_checked()



# Preserve all legacy substring selectors without displaying numbered names.
TEST_CASES = {
    'test_subscription_settings_support_adding_refreshing_reordering_and_removing_sources': ('test_RB01_settings_management', 'Subscription settings support adding, refreshing, reordering, and removing sources.'),
    'test_subscription_settings_reject_invalid_and_duplicate_urls_and_expose_initial_fetch_failures': ('test_RB02_invalid_duplicate_and_initial_failure', 'Subscription settings reject invalid and duplicate URLs and expose initial fetch failures.'),
    'test_subscriptions_preserve_cached_rules_offline_and_resume_scheduled_refreshes_after_worker_restart': ('test_RB03_offline_alarm_and_restart', 'Subscriptions preserve cached rules offline and resume scheduled refreshes after worker restart.'),
    'test_remote_rules_affect_badges_before_a_gallery_opens_and_respect_page_paths_without_extra_image_requests': ('test_RB04_badge_before_panel_and_paths', 'Remote rules affect badges before a gallery opens and respect page paths without extra image requests.'),
    'test_local_overrides_take_precedence_over_remote_defaults_and_reset_controls_restore_inheritance': ('test_RB05_overrides_reset_and_provenance', 'Local overrides take precedence over remote defaults and reset controls restore inheritance.'),
    'test_remote_xpath_scopes_and_css_exclusions_restrict_the_discovered_image_set': ('test_RB06_remote_scope_and_exclusions', 'Remote XPath scopes and CSS exclusions restrict the discovered image set.'),
    'test_remote_rule_updates_reuse_previews_and_preserve_selections_and_unsaved_drafts': ('test_RB07_updates_reuse_previews_and_drafts', 'Remote rule updates reuse previews and preserve selections and unsaved drafts.'),
    'test_regular_expression_timeouts_preserve_usable_rules_and_concurrent_requests_share_one_offscreen_host': ('test_RB08_regex_timeout_and_offscreen_singleton', 'Regular expression timeouts preserve usable rules and concurrent requests share one offscreen host.'),
    'test_navigation_and_subscription_removal_invalidate_late_rule_evaluation_and_refresh_results': ('test_RB09_navigation_and_removal_invalidate_results', 'Navigation and subscription removal invalidate late rule evaluation and refresh results.'),
    'test_subscription_controls_remain_usable_across_languages_themes_and_narrow_layouts': ('test_RB10_languages_themes_and_narrow_layout', 'Subscription controls remain usable across languages, themes, and narrow layouts.'),
    'test_invalid_remote_selectors_preserve_the_last_valid_cached_rule_document': ('test_RB11_invalid_selectors_preserve_cache', 'Invalid remote selectors preserve the last valid cached rule document.'),
    'test_active_download_batches_retain_their_filters_until_remote_rule_updates_can_be_applied': ('test_RB12_download_batch_defers_remote_update', 'Active download batches retain their filters until remote rule updates can be applied.'),
}

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    selected = os.environ.get('REMOTE_TEST')
    try:
        with sync_playwright() as p:
            for name, case in list(globals().items()):
                if name.startswith('test_') and (not selected or selected in TEST_CASES[name][0]):
                    RULES.clear()
                    case(p, origin)
                    print('PASS '+TEST_CASES[name][1], flush=True)
    finally:
        server.shutdown()
