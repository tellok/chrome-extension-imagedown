"""Real MV3 extension integration tests; no mocked Chrome APIs.

Custom-directory tests substitute the OS picker only, using real filesystem
handles, IndexedDB persistence and writes in the origin's private filesystem.
Manually verify the native directory picker and OS permission prompts.

Run: .venv/bin/python tests/browser_test.py
Set CHROMIUM_PATH to use an existing Chrome for Testing executable.
"""
import base64
import io
import json
import os
import re
from pathlib import Path
import tempfile
from threading import Thread
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'test-results'
OUTPUT.mkdir(exist_ok=True)


def image_bytes(name, width=640, height=420):
    image = Image.new('RGB', (width, height), '#c4ddcf')
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, height * .65, width, height), fill='#3a665a')
    draw.polygon([(0, height*.65), (width*.35, height*.18), (width*.7, height*.65)], fill='#72988a')
    draw.ellipse((width*.7, height*.15, width*.85, height*.15+width*.15), fill='#f4e5ad')
    draw.text((20, height-32), name, fill='white')
    output = io.BytesIO()
    image.save(output, 'PNG')
    return output.getvalue()


PNG = image_bytes('Page image')
SMALL = image_bytes('Small image', 160, 100)
def padded_png(width, height, size):
    data = image_bytes('Threshold image', width, height)
    assert len(data) <= size
    return data + b'\0' * (size - len(data))


THRESHOLD_IMAGES = {
    '/narrow.png': padded_png(49, 100, 3000),
    '/short.png': padded_png(100, 49, 3000),
    '/under2k.png': padded_png(100, 100, 2047),
    '/boundary.png': padded_png(50, 50, 2048),
}
DATA = 'data:image/png;base64,' + base64.b64encode(SMALL).decode()
COUNTS = {}
RETRY_READY = set()
RETRY_PATHS = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = urlparse(self.path).path
        origin = f'http://127.0.0.1:{self.server.server_port}'
        other = f'http://127.0.0.1:{self.server.other_port}'
        if path == '/retry-fixture':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'''<!doctype html><title>Preview retry fixture</title>
            <link rel="icon" href="data:,">
            <img src="/retry-one.png?signature=demo%2Bvalue">
            <img src="/retry-batch-a.png"><img src="/retry-batch-b.png">
            <img src="/retry-never.png"><img src="/retry-ignored.png">''')
            return
        if path.startswith('/retry-'):
            RETRY_PATHS.append(self.path)
            COUNTS[path] = COUNTS.get(path, 0) + 1
            ok = path in RETRY_READY
            self.send_response(200 if ok else 403)
            self.send_header('Content-Type', 'image/png' if ok else 'text/plain')
            # A retry must escape the cached failure without changing signed URLs.
            self.send_header('Cache-Control', 'public, max-age=3600')
            self.end_headers()
            self.wfile.write(PNG if ok else b'Temporarily unavailable')
            return
        if path in ('/fixture', '/other-page'):
            html = f'''<!doctype html><title>ImageTaken 测试图片集</title>
            <style>body{{font-family:system-ui}}img,canvas{{max-width:200px}} .bg{{height:80px;background:url('/background.png')}}
            .pseudo::before{{content:url('/pseudo.png')}}</style>
            <h1>Page resources</h1>
            <img src="/cached.png" alt="cached landscape"><img src="/once.png" alt="expired source">
            <img src="{other}/cross.png" alt="cross origin"><img src="{other}/denied.png" alt="protected image">
            <img src="/auth.png" alt="session image"><img src="/missing.png" alt="broken candidate">
            <img src="/narrow.png"><img src="/short.png"><img src="/under2k.png"><img src="/boundary.png">
            <img src="/small.png" srcset="/small.png 1x, /large.png 2x" alt="responsive">
            <img data-src="/lazy.png"><img src="{DATA}" alt="embedded"><img srcset="{DATA} 1x, /twox.png 2x">
            <div class="bg"></div><div class="pseudo"></div><div id="shadow"></div>
            <canvas id="art" width="320" height="180"></canvas><canvas id="tainted" width="320" height="180"></canvas>
            <svg width="60" height="60"><rect width="60" height="60" fill="#167563"/></svg>
            <iframe src="{other}/frame"></iframe>
            <a href="/linked.webp">linked image</a><video poster="/poster.png"></video>
            <script>
            window.ready = (async () => {{
              document.querySelector('#shadow').attachShadow({{mode:'open'}}).innerHTML='<img src="/shadow.png">';
              const ctx=document.querySelector('#art').getContext('2d');ctx.fillStyle='#167563';ctx.fillRect(0,0,320,180);
              const blob=await (await fetch('/blob-source.png')).blob();
              const image=new Image(); image.id='blob-image'; image.src=URL.createObjectURL(blob); document.body.append(image); await image.decode();
              const revoked=new Image(); revoked.id='revoked-image';revoked.src=URL.createObjectURL(blob);document.body.append(revoked);await revoked.decode(); URL.revokeObjectURL(revoked.src);
              const cross=document.querySelector('img[alt="cross origin"]'); await cross.decode();
              document.querySelector('#tainted').getContext('2d').drawImage(cross,0,0);
            }})();
            </script>'''
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Set-Cookie', 'session=ok; Path=/; SameSite=Lax')
            self.end_headers()
            self.wfile.write(html.encode())
            return
        if path == '/frame':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<img src="/frame-only.png" alt="iframe image">')
            return
        count_key = (self.server.server_port, path)
        COUNTS[count_key] = COUNTS.get(count_key, 0) + 1
        denied = path == '/once.png' and COUNTS[count_key] > 1
        denied |= path == '/denied.png' and not self.headers.get('Referer', '').startswith(other)
        denied |= path == '/auth.png' and 'session=ok' not in self.headers.get('Cookie', '')
        if denied or path in ('/missing.png', '/favicon.ico'):
            self.send_error(403 if denied else 404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'image/png')
        self.send_header('Cache-Control', 'no-store' if path in ('/once.png', '/cross.png', '/denied.png') else 'public, max-age=3600')
        self.end_headers()
        self.wfile.write(THRESHOLD_IMAGES.get(path, SMALL if path in ('/small.png', '/pseudo.png') else PNG))


def test_threshold_controls_distinguish_inherited_values_from_overrides_and_reset_each_dimension_independently(context, worker, extension_id, origin):
    saved = worker.evaluate('async () => await chrome.storage.local.get(null)')
    prefixes = ('filters:', 'image-query:', 'xpath:', 'excluded-selectors:', 'ignored:')
    keys = [key for key in saved if key.startswith(prefixes)]
    worker.evaluate('keys=>chrome.storage.local.remove(keys)', keys)
    worker.evaluate("chrome.storage.local.set({'filters:width':50,'filters:height':80})")
    source = context.new_page()
    panel = context.new_page()
    try:
        source.goto(origin + '/frame')
        tab_id = worker.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', source.url)
        panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
        expect(panel.locator('.page-context')).to_have_attribute('data-frames','1')
        panel.locator('#filters').evaluate('(el)=>el.open=true')
        width, height = panel.locator('#min-width'), panel.locator('#min-height')
        reset_width, reset_height = panel.locator('#reset-min-width'), panel.locator('#reset-min-height')
        expect(width).to_have_value(''); expect(width).to_have_attribute('placeholder','全局默认(50)')
        expect(height).to_have_value(''); expect(height).to_have_attribute('placeholder','全局默认(80)')
        expect(reset_width).to_be_disabled(); expect(reset_height).to_be_disabled()
        width.fill('50'); height.fill('0'); panel.locator('#min-size').fill('0')
        expect(width).to_have_value('50'); expect(height).to_have_value('0')
        expect(reset_width).to_be_enabled(); expect(reset_height).to_be_enabled()
        reset_width.click()
        expect(width).to_have_value(''); expect(width).to_have_attribute('placeholder','全局默认(50)')
        expect(height).to_have_value('0'); expect(panel.locator('#min-size')).to_have_value('0')
        worker.evaluate("chrome.storage.local.set({'filters:width':1000})")
        expect(width).to_have_attribute('placeholder','全局默认(1000)')
        expect(panel.locator('.card .image-url').filter(has_text='frame-only.png')).to_have_count(0)
        panel.wait_for_function('async id => await chrome.action.getBadgeText({tabId:id}) === "0"', arg=tab_id)
        worker.evaluate("chrome.storage.local.set({'filters:width':100})")
        expect(width).to_have_attribute('placeholder','全局默认(100)')
        expect(panel.locator('.card .image-url').filter(has_text='frame-only.png')).to_have_count(1)
        reset_height.click()
        expect(height).to_have_value(''); expect(height).to_have_attribute('placeholder','全局默认(80)')
        width.fill('300'); height.fill('120'); panel.locator('#query').focus()
        panel.wait_for_function("async () => (await chrome.storage.local.get('filters:site:v1:127.0.0.1:width'))['filters:site:v1:127.0.0.1:width'] === 300")
        panel.evaluate("() => {window.originalControlRemove=chrome.storage.local.remove;chrome.storage.local.remove=async()=>{throw new Error('reset denied')};}")
        reset_width.click()
        expect(panel.locator('#notice')).to_have_text('筛选设置保存失败：reset denied')
        expect(width).to_have_value('300'); expect(height).to_have_value('120')
        panel.evaluate('() => {chrome.storage.local.remove=window.originalControlRemove;}')
        width.focus(); width.select_text()
        width.press('a'); width.press('-'); width.press('+'); width.press('e'); width.press('.')
        expect(width).to_have_value('300')
        panel.evaluate('''() => {
          const input=document.querySelector('#min-width');
          input.value='1e3';input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste',data:'1e3'}));
        }''')
        expect(width).to_have_value('300')
        panel.evaluate('''() => {
          const input=document.querySelector('#min-width');
          input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
          input.value='汉字';input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
          input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'汉字'}));
        }''')
        expect(width).to_have_value('300')
        width.fill(''); expect(width).to_have_value('')
        panel.locator('#query').focus(); expect(width).to_have_value('300')
        assert panel.evaluate("async ()=>(await (await import('./preferences.js')).loadThresholds('127.0.0.1')).width") == 300
        width.fill('100001'); expect(width).to_have_value('300')
        width.focus(); width.press('ControlOrMeta+A'); width.press('8'); width.press('0')
        expect(width).to_have_value('80')
        panel.locator('#query').focus()
        reset_width.click(); expect(width).to_have_value(''); expect(width).to_have_attribute('placeholder','全局默认(100)')
        expect(height).to_have_value('120')
        panel.reload(); expect(panel.locator('.page-context')).to_have_attribute('data-frames','1')
        panel.locator('#filters').evaluate('(el)=>el.open=true')
        expect(width).to_have_value(''); expect(width).to_have_attribute('placeholder','全局默认(100)')
        expect(height).to_have_value('120'); expect(reset_width).to_be_disabled(); expect(reset_height).to_be_enabled()
        # Long labels, keyboard focus and the actual input/button geometry in both themes.
        panel.evaluate("chrome.storage.local.set({'settings:language':'de','filters:width':100000})")
        for theme in ('light','dark'):
            panel.evaluate('(value)=>chrome.storage.local.set({"settings:theme":value})', theme)
            for viewport in (320,900):
                panel.set_viewport_size({'width':viewport,'height':1000})
                assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth')
                assert panel.evaluate('''() => {
                  const fields=['min-width','min-height','min-size','type'].map(id=>document.getElementById(id).getBoundingClientRect());
                  const widths=fields.map(rect=>rect.width);
                  return Math.max(...widths)-Math.min(...widths)<=1 &&
                    [...document.querySelectorAll('.dimension-control')].every(group => {
                      const input=group.querySelector('input').getBoundingClientRect();
                      const button=group.querySelector('button').getBoundingClientRect();
                      const unit=group.querySelector('.dimension-value>span').getBoundingClientRect();
                      return button.left>=input.left && button.right<=input.right &&
                        button.top>=input.top && button.bottom<=input.bottom &&
                        unit.right<=button.left && unit.left>=input.left && button.right<=innerWidth;
                    });
                }''')
                if viewport == 320: panel.screenshot(path=str(OUTPUT/f'threshold-controls-{theme}-narrow.png'))
            reset_height.focus(); assert reset_height.evaluate('(el)=>document.activeElement===el')
            panel.screenshot(path=str(OUTPUT/f'threshold-controls-{theme}.png'))
        print('Threshold controls: inherited values, single resets, numeric edits, failures and layouts OK')
    finally:
        panel.close(); source.close()
        current = worker.evaluate('async () => Object.keys(await chrome.storage.local.get(null))')
        worker.evaluate('keys=>chrome.storage.local.remove(keys)', [key for key in current if key.startswith(prefixes)])
        worker.evaluate('values=>chrome.storage.local.set(values)', {key:saved[key] for key in keys})
        worker.evaluate('values=>chrome.storage.local.set(values)', {key:saved[key] for key in ('settings:language','settings:theme') if key in saved})
        worker.evaluate('keys=>chrome.storage.local.remove(keys)', [key for key in ('settings:language','settings:theme') if key not in saved])


def test_global_threshold_settings_update_inherited_site_values_while_preserving_overrides_and_gallery_state(context, worker, extension_id, origin):
    saved = worker.evaluate('async () => await chrome.storage.local.get(null)')
    keys = [key for key in saved if key.startswith(('filters:', 'image-query:', 'xpath:', 'excluded-selectors:', 'ignored:'))]
    worker.evaluate('keys => chrome.storage.local.remove(keys)', keys)
    pages = []
    try:
        panels = []
        sources = []
        for host_origin in (origin, origin.replace('127.0.0.1', 'localhost')):
            source = context.new_page(); pages.append(source); sources.append(source)
            source.goto(host_origin + '/frame')
            tab_id = worker.evaluate('async url => (await chrome.tabs.query({})).find(t=>t.url===url).id', source.url)
            panel = context.new_page(); pages.append(panel); panels.append(panel)
            panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
            expect(panel.locator('.page-context')).to_have_attribute('data-frames', '1')
            panel.locator('#filters').evaluate('(el)=>el.open=true')
            expect(panel.locator('#min-width')).to_be_enabled()
        a, b = panels
        settings = context.new_page(); pages.append(settings)
        settings.goto(f'chrome-extension://{extension_id}/settings.html')
        width, height = settings.locator('#default-min-width'), settings.locator('#default-min-height')
        expect(width).to_be_enabled(); expect(width).to_have_value('50')
        expect(height).to_have_value('50')
        expect(a.locator('.card input').first).to_be_enabled()
        a.locator('.card input').first.check()
        a.evaluate("window.thresholdImage=document.querySelector('#gallery img')")
        a.locator('#site-rules').evaluate('(el)=>el.open=true')
        a.locator('#xpath').fill('//img[@data-unsaved]')
        width.fill('200'); expect(width).to_be_enabled()
        height.fill('100'); expect(height).to_be_enabled()
        expect(a.locator('#min-width')).to_have_value(''); expect(a.locator('#min-width')).to_have_attribute('placeholder', '全局默认(200)'); expect(b.locator('#min-height')).to_have_value(''); expect(b.locator('#min-height')).to_have_attribute('placeholder', '全局默认(100)')
        assert a.evaluate("thresholdImage===document.querySelector('#gallery img')"), 'default changes recreated previews'
        expect(a.locator('.card input').first).to_be_checked()
        expect(a.locator('#xpath')).to_have_value('//img[@data-unsaved]')
        assert a.evaluate("async () => (await (await import('./preferences.js')).loadThresholds('127.0.0.1')).width") == 200
        settings.reload(); expect(width).to_have_value('200'); expect(height).to_have_value('100')
        a.locator('#min-width').fill('0'); a.locator('#min-height').fill('20'); a.locator('#min-size').fill('0')
        a.locator('#query').focus()
        expect(b.locator('#min-width')).to_have_value(''); expect(b.locator('#min-width')).to_have_attribute('placeholder', '全局默认(200)')
        width.fill('300'); expect(width).to_be_enabled(); height.fill('120'); expect(height).to_be_enabled()
        expect(a.locator('#min-width')).to_have_value('0'); expect(a.locator('#min-height')).to_have_value('20')
        expect(b.locator('#min-width')).to_have_value(''); expect(b.locator('#min-width')).to_have_attribute('placeholder', '全局默认(300)'); expect(b.locator('#min-height')).to_have_value(''); expect(b.locator('#min-height')).to_have_attribute('placeholder', '全局默认(120)')
        a.reload(); expect(a.locator('.page-context')).to_have_attribute('data-frames','1')
        expect(a.locator('#min-width')).to_have_value('0'); expect(a.locator('#min-size')).to_have_value('0')
        a.locator('#filters').evaluate('(el)=>el.open=true')
        a.locator('#defaults').click()
        expect(a.locator('#min-width')).to_have_value(''); expect(a.locator('#min-width')).to_have_attribute('placeholder', '全局默认(300)'); expect(a.locator('#min-height')).to_have_value(''); expect(a.locator('#min-height')).to_have_attribute('placeholder', '全局默认(120)'); expect(a.locator('#min-size')).to_have_value('2')
        width.fill('200'); expect(width).to_be_enabled()
        expect(a.locator('#min-width')).to_have_value(''); expect(a.locator('#min-width')).to_have_attribute('placeholder', '全局默认(200)')
        a.locator('#reset').click()
        expect(a.locator('#min-width')).to_have_value('0'); expect(b.locator('#min-width')).to_have_value(''); expect(b.locator('#min-width')).to_have_attribute('placeholder', '全局默认(200)')
        a.reload(); expect(a.locator('.page-context')).to_have_attribute('data-frames','1')
        expect(a.locator('#min-width')).to_have_value('0'); expect(a.locator('#min-height')).to_have_value('0'); expect(a.locator('#min-size')).to_have_value('0')
        # Navigation must load the new source hostname, without copying the previous site's zero values.
        sources[0].goto(origin.replace('127.0.0.1','localhost') + '/frame?navigation=1')
        a.get_by_role('button', name='重新扫描页面', exact=True).click()
        expect(a.locator('.page-context')).to_have_attribute('data-frames','1')
        expect(a.locator('#min-width')).to_have_value(''); expect(a.locator('#min-width')).to_have_attribute('placeholder', '全局默认(200)'); expect(a.locator('#min-height')).to_have_value(''); expect(a.locator('#min-height')).to_have_attribute('placeholder', '全局默认(120)')
        # Invalid entries never overwrite a valid persisted default.
        for invalid in ('', '-1', '1.5', '100001'):
            width.fill(invalid)
            expect(settings.locator('#settings-status')).to_have_text('请输入 0 至 100000 的整数。')
            assert worker.evaluate("async ()=>(await chrome.storage.local.get('filters:width'))['filters:width']") == 200
        width.fill('200'); expect(width).to_be_enabled()
        settings.evaluate("() => {window.originalThresholdSet=chrome.storage.local.set;chrome.storage.local.set=async()=>{throw new Error('threshold write denied')};}")
        width.fill('333')
        expect(settings.locator('#settings-status')).to_have_text('保存失败：threshold write denied')
        assert worker.evaluate("async ()=>(await chrome.storage.local.get('filters:width'))['filters:width']") == 200
        settings.evaluate('() => {chrome.storage.local.set=window.originalThresholdSet;}')
        width.fill('200'); expect(width).to_be_enabled()
        for page in (settings, a, b):
            page.set_viewport_size({'width':320,'height':900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        settings.screenshot(path=str(OUTPUT/'threshold-settings.png'))
        print('Site thresholds: global defaults, per-site overrides, reset, navigation, invalid inputs and save errors OK')
    finally:
        for page in reversed(pages): page.close()
        current = worker.evaluate('async () => Object.keys(await chrome.storage.local.get(null))')
        changed = [key for key in current if key.startswith(('filters:', 'image-query:', 'xpath:', 'excluded-selectors:', 'ignored:'))]
        worker.evaluate('keys=>chrome.storage.local.remove(keys)', changed)
        worker.evaluate('values=>chrome.storage.local.set(values)', {key:saved[key] for key in keys})


def test_shared_settings_persist_across_reloads_and_update_galleries_without_overwriting_edited_titles(context, worker, extension_id, origin):
    source = context.new_page()
    source.goto(origin + '/frame')
    original = '📷 旅行相册 (≧▽≦)（上海）'
    source.evaluate('(value) => document.title=value', original)
    tab_id = worker.evaluate('async url => (await chrome.tabs.query({})).find(t => t.url===url).id', source.url)
    panel = context.new_page()
    panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
    expect(panel.locator('#page-title')).to_have_text(original)
    with context.expect_page() as opened:
        panel.get_by_role('button', name='设置', exact=True).click()
    settings = opened.value
    settings.wait_for_load_state()
    toggle = settings.get_by_role('switch', name='自动清洗标题')
    expect(toggle).to_be_enabled()
    expect(toggle).not_to_be_checked()
    toggle.check()
    expect(settings.locator('#settings-status')).to_have_text('已保存')
    expect(panel.locator('#page-title')).to_have_text('旅行相册 （上海）')
    settings.reload()
    expect(toggle).to_be_checked()
    ready_first = settings.get_by_role('switch', name='优先展示成功加载的图片')
    expect(ready_first).not_to_be_checked()
    ready_first.check()
    settings.reload()
    expect(ready_first).to_be_checked()
    ready_first.uncheck()
    panel.reload()
    expect(panel.locator('#page-title')).to_have_text('旅行相册 （上海）')
    panel.locator('#title-display').click()
    expect(panel.locator('#title-input')).to_have_value('旅行相册 （上海）')
    panel.locator('#title-input').fill('手动标题 😀')
    panel.locator('#confirm-title').click()
    toggle.uncheck()
    expect(panel.locator('#page-title')).to_have_text('手动标题 😀')
    panel.reload()
    expect(panel.locator('#page-title')).to_have_text(original)
    for width in (320, 900):
        settings.set_viewport_size({'width': width, 'height': 800})
        assert settings.evaluate('document.documentElement.scrollWidth <= innerWidth')
    settings.screenshot(path=str(OUTPUT / 'settings.png'))
    settings.close()
    panel.close()
    source.close()


def test_preview_retries_recover_eligible_failures_while_preserving_signed_urls_filters_and_download_state(context, worker, extension_id, origin, output):
    source = context.new_page()
    source.goto(origin + '/retry-fixture')
    source.wait_for_load_state('networkidle')
    tab_id = worker.evaluate('''async () => (await chrome.tabs.query({})).find(t => t.url?.endsWith('/retry-fixture')).id''')
    panel = context.new_page()
    errors = []
    panel.on('pageerror', lambda error: errors.append(str(error)))
    panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '1')
    expect(panel.locator('.retry-preview:visible')).to_have_count(5)
    expect(panel.locator('#retry-failed')).to_have_text('↻ 重试所有失败图片 (5)')
    panel.evaluate("chrome.storage.local.set({'settings:ready-first':true})")
    expect(panel.locator('#select-all')).to_be_disabled()
    panel.wait_for_function('async id => await chrome.action.getBadgeText({tabId:id}) === "0"', arg=tab_id)
    panel.wait_for_function('async () => await chrome.action.getBadgeText({tabId:(await chrome.tabs.getCurrent()).id}) === "0"')

    def card(name):
        return panel.locator('.card').filter(has=panel.locator('.image-url', has_text=name))

    single = card('retry-one.png')
    expect(single.locator('input')).to_be_disabled()
    single.locator('.dimensions').click()
    expect(single.locator('input')).not_to_be_checked()
    expect(panel.locator('#selection-count')).to_be_hidden()
    expect(panel.locator('.library-toolbar #selection-count')).to_have_count(1)
    expect(panel.locator('footer #selection-count')).to_have_count(0)
    before = COUNTS.get('/retry-one.png', 0)
    RETRY_READY.add('/retry-one.png')
    single.locator('.retry-preview').click()
    expect(single.locator('.retry-preview')).to_be_hidden(timeout=20000)
    expect(single.locator('img')).not_to_have_class('failed')
    expect(single.locator('.preview-fallback')).to_be_hidden()
    expect(single.locator('.preview-origin')).to_be_visible()
    expect(single.locator('.preview-origin')).to_have_text('URL 加载')
    expect(single.locator('.dimensions')).to_have_text('640 × 420')
    expect(single.locator('.image-size')).to_have_text(f'{len(PNG) / 1024:.1f} KiB')
    expect(single.locator('input')).to_be_enabled()
    single.locator('input').check()
    expect(single.locator('input')).to_be_checked()
    expect(panel.locator('#selection-count')).to_be_visible()
    # A real failed image request clears an existing selection immediately.
    single.locator('img').evaluate('(img, url) => img.src = url', origin + '/missing.png')
    expect(single.locator('input')).to_be_disabled()
    expect(single.locator('input')).not_to_be_checked()
    expect(panel.locator('#selection-count')).to_be_hidden()
    single.locator('.retry-preview').click()
    expect(single.locator('.retry-preview')).to_be_hidden(timeout=20000)
    expect(single.locator('input')).to_be_enabled()
    single.locator('input').check()
    assert COUNTS['/retry-one.png'] > before
    assert all(path == '/retry-one.png?signature=demo%2Bvalue' for path in RETRY_PATHS if path.startswith('/retry-one.png'))
    expect(panel.locator('#retry-failed')).to_have_text('↻ 重试所有失败图片 (4)')
    panel.wait_for_function('async id => await chrome.action.getBadgeText({tabId:id}) === "0"', arg=tab_id)
    panel.wait_for_function('''async id => {
      const title = await chrome.action.getTitle({tabId:id});
      return title.includes('成功加载 0 张');
    }''', arg=tab_id)
    expect(panel.locator('#select-all')).to_be_checked()
    expect(panel.locator('#select-all')).to_be_enabled()
    # Failed previews cannot be selected individually or through select-all.
    single.locator('input').uncheck()
    expect(card('retry-never.png').locator('input')).to_be_disabled()
    card('retry-never.png').locator('.dimensions').click()
    panel.locator('#select-all').check()
    expect(single.locator('input')).to_be_checked()
    expect(card('retry-never.png').locator('input')).not_to_be_checked()
    expect(panel.locator('#selection-count')).to_have_text('已选择 1 张')
    expect(panel.locator('#select-all')).to_be_checked()
    panel.locator('#select-all').uncheck()
    expect(panel.locator('.card.selected')).to_have_count(0)
    expect(panel.locator('#selection-count')).to_be_hidden()
    single.locator('input').check()

    never = card('retry-never.png')
    never.locator('.retry-preview').click()
    expect(never.locator('.retry-preview')).to_be_enabled(timeout=20000)
    assert 'HTTP 403' in never.locator('.retry-preview').get_attribute('title')
    assert 'Fetch' in never.locator('.retry-preview').get_attribute('title')
    assert 'Referer' in never.locator('.retry-preview').get_attribute('title')
    expect(never.locator('img')).to_have_class('failed')
    expect(never.locator('.preview-fallback')).to_be_visible()
    expect(never.locator('.preview-origin')).to_be_hidden()

    card('retry-ignored.png').locator('.ignore-image').click()
    expect(card('retry-ignored.png')).to_have_count(0)
    expect(panel.locator('#retry-failed')).to_have_text('↻ 重试所有失败图片 (3)')
    ignored_requests = COUNTS.get('/retry-ignored.png', 0)
    RETRY_READY.update(['/retry-batch-a.png', '/retry-batch-b.png', '/retry-ignored.png'])
    panel.locator('#query').fill('retry-batch-a.png')
    expect(panel.locator('.card')).to_have_count(1)
    expect(panel.locator('.image-url')).to_contain_text('retry-batch-a.png')
    before_downloads = panel.evaluate('async () => (await chrome.downloads.search({})).length')
    panel.locator('#retry-failed').click()
    expect(panel.locator('#retry-summary')).to_have_text('成功 2 · 失败 1 · 共 3 张', timeout=30000)
    expect(panel.locator('#retry-failed')).to_have_text('↻ 重试所有失败图片 (1)')
    expect(panel.locator('#query')).to_have_value('retry-batch-a.png')
    expect(panel.locator('#selection-count')).to_contain_text('已选择 1 张')
    expect(panel.locator('#min-width')).to_have_value(''); expect(panel.locator('#min-width')).to_have_attribute('placeholder', '全局默认(50)')
    expect(panel.locator('#min-height')).to_have_value(''); expect(panel.locator('#min-height')).to_have_attribute('placeholder', '全局默认(50)')
    assert panel.evaluate("async () => (await (await import('./preferences.js')).loadThresholds('127.0.0.1')).width") == 50
    expect(panel.locator('#min-size')).to_have_value('2')
    assert COUNTS.get('/retry-ignored.png', 0) == ignored_requests
    assert panel.evaluate('async () => (await chrome.downloads.search({})).length') == before_downloads

    # Successful retries survive ordinary rerenders without repeating HTTP requests.
    counts = {name: COUNTS.get(name, 0) for name in ('/retry-one.png', '/retry-batch-a.png', '/retry-batch-b.png')}
    panel.locator('#query').fill('')
    expect(panel.locator('.card')).to_have_count(4)
    for name in ('retry-one.png', 'retry-batch-a.png', 'retry-batch-b.png'):
        expect(card(name).locator('.retry-preview')).to_be_hidden()
        expect(card(name).locator('img')).not_to_have_class('failed')
    panel.locator('#layout').click()
    panel.locator('#layout').click()
    panel.wait_for_load_state('networkidle')
    assert all(COUNTS.get(name, 0) == count for name, count in counts.items())
    expect(panel.locator('#selection-count')).to_have_text('已选择 1 张')
    panel.set_viewport_size({'width': 420, 'height': 1100})
    panel.wait_for_function('async id => await chrome.action.getBadgeText({tabId:id}) === "0"', arg=tab_id)
    assert worker.evaluate('id => chrome.action.getBadgeBackgroundColor({tabId:id})', tab_id) == [220, 38, 38, 255]
    panel.evaluate('scrollTo(0, 0)')
    panel.screenshot(path=str(output / 'preview-retries.png'))
    assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'retry controls overflow'
    # Successful previews form a prefix without recreating their image nodes.
    panel.wait_for_function('''() => {
      const markers=[...document.querySelectorAll('#gallery .preview-origin')];
      const ready=markers.filter(marker=>!marker.hidden).length;
      return ready===3 && markers.slice(0, ready).every(marker=>!marker.hidden);
    }''')
    panel.evaluate("chrome.storage.local.set({'settings:ready-first':false})")
    assert not errors, errors
    panel.close()
    # Closed views release badge ownership; other tabs and new documents
    # count loaded page images without opening another panel.
    assert worker.evaluate('id => chrome.action.getBadgeText({tabId:id})', tab_id) == '0'
    separate = context.new_page()
    separate.goto(origin + '/frame?badge')
    separate_id = worker.evaluate("async () => (await chrome.tabs.query({})).find(tab => tab.url?.endsWith('/frame?badge')).id")
    assert worker.evaluate('''async id => { for(let i=0;i<100;i++){if(await chrome.action.getBadgeText({tabId:id})==='1') return true;await new Promise(r=>setTimeout(r,100));} return false; }''', separate_id)
    # Source DOM images are still broken; only the closed panel retried them.
    assert worker.evaluate('''async id => { for(let i=0;i<100;i++){if(await chrome.action.getBadgeText({tabId:id})==='0') return true;await new Promise(r=>setTimeout(r,100));} return false; }''', tab_id)
    separate.close()
    source.goto(origin + '/frame')
    source.wait_for_load_state('networkidle')
    assert worker.evaluate('''async id => { for(let i=0;i<100;i++){if(await chrome.action.getBadgeText({tabId:id})==='1') return true;await new Promise(r=>setTimeout(r,100));} return false; }''', tab_id)
    source.close()


def test_site_scopes_persist_xpath_and_css_exclusions_and_isolate_them_by_hostname(context, worker, extension_id, origin, output):
    source = context.new_page()
    source.goto(origin + '/fixture')
    source.evaluate('window.ready')
    source.evaluate("""() => {
      const scope=document.createElement('section'); scope.id='scope';
      scope.innerHTML='<img src="/boundary.png" class="img-xxx"><div class="ad"><img src="/cached.png"></div><img src="/narrow.png"><div class="bg"></div><picture><source srcset="/boundary.png"><img src="/boundary.png" class="img-xxx"></picture>';
      document.body.append(scope);
    }""")
    tab_id = worker.evaluate('''async url => (await chrome.tabs.query({})).filter(t => t.url===url).at(-1).id''', source.url)
    panel = context.new_page()
    panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    panel.locator('#site-rules').evaluate('(el) => el.open = true')
    panel.locator('#xpath').fill('//*[@id="scope"]')
    panel.locator('#excluded-selectors').fill('.img-xxx\n.ad')
    panel.locator('#apply-xpath').click()
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '1')
    expect(panel.locator('#xpath-status')).to_contain_text('提取 2 张图片')
    expect(panel.locator('#active-xpath')).to_have_text('//*[@id="scope"]')
    expect(panel.locator('#active-css')).to_have_text('.img-xxx\n.ad')
    for width in (320, 1100):
        panel.set_viewport_size({'width': width, 'height': 900})
        panel.evaluate('scrollTo(0, document.documentElement.scrollHeight)')
        summary = panel.locator('#active-site-rules').bounding_box()
        footer = panel.locator('footer').bounding_box()
        assert summary['y'] + summary['height'] <= footer['y'], 'rule summary must sit above the footer at the bottom'
        assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth')
        panel.screenshot(path=str(output / f'active-site-rules-{width}.png'))
    expect(panel.locator('.card .image-url').filter(has_text='background.png')).to_have_count(1)
    expect(panel.locator('.card .image-url').filter(has_text='narrow.png')).to_have_count(0)
    panel.locator('#filters').evaluate('(el) => el.open = true')
    panel.locator('#reset').click()
    expect(panel.locator('.card .image-url').filter(has_text='narrow.png')).to_have_count(1)
    panel.reload()
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '1')
    expect(panel.locator('#xpath')).to_have_value('//*[@id="scope"]')
    expect(panel.locator('#excluded-selectors')).to_have_value('.img-xxx\n.ad')
    panel.locator('#site-rules').evaluate('(el) => el.open = true')
    # An XPath selecting the image itself includes that node, not only descendants.
    panel.locator('#xpath').fill('/html/body/section[@id="scope"]/img[2]')
    expect(panel.locator('#active-xpath')).to_have_text('//*[@id="scope"]')
    panel.locator('#apply-xpath').click()
    expect(panel.locator('#xpath-status')).to_contain_text('提取 1 张图片')
    panel.locator('#xpath').fill('//*[@id="no-match"]')
    panel.locator('#apply-xpath').click()
    expect(panel.locator('#xpath-status')).to_contain_text('提取 0 张图片')
    expect(panel.locator('#notice')).to_contain_text('XPath 未匹配')
    panel.locator('#xpath').fill('//*[')
    panel.locator('#apply-xpath').click()
    expect(panel.locator('#xpath-status')).to_contain_text('未保存')
    expect(panel.locator('#active-xpath')).to_have_text('//*[@id="no-match"]')
    panel.locator('#xpath').fill('')
    panel.locator('#excluded-selectors').fill('[broken=')
    panel.locator('#apply-xpath').click()
    expect(panel.locator('#xpath-status')).to_contain_text('未保存')
    # CSS-only rules must not be undone by the resource timeline.
    panel.locator('#excluded-selectors').fill('.img-xxx, .ad')
    source.evaluate("""() => document.querySelectorAll('img[src="/boundary.png"], img[src="/cached.png"]').forEach(el=>el.classList.add('img-xxx'))""")
    panel.locator('#apply-xpath').click()
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    expect(panel.locator('#active-xpath')).to_have_text('未配置')
    expect(panel.locator('#active-css')).to_have_text('.img-xxx, .ad')
    urls=panel.evaluate('''async tabId => (await (await import('./api.js')).scanTab(tabId, '', '.img-xxx, .ad')).items.map(i=>i.url)''', tab_id)
    assert origin + '/boundary.png' not in urls
    assert origin + '/cached.png' not in urls
    settings=worker.evaluate('async () => await chrome.storage.local.get(null)')
    assert settings['excluded-selectors:v1:127.0.0.1'] == '.img-xxx, .ad'
    assert panel.evaluate("async () => (await import('./preferences.js')).loadExclusions('localhost')") == ''
    source.goto(origin + '/other-page')
    source.evaluate('window.ready')
    expect(panel.locator('#excluded-selectors')).to_have_value('.img-xxx, .ad')
    panel.locator('#clear-xpath').click()
    expect(panel.locator('#xpath')).to_have_value('')
    expect(panel.locator('#excluded-selectors')).to_have_value('')
    expect(panel.locator('#active-xpath')).to_have_text('未配置')
    expect(panel.locator('#active-css')).to_have_text('未配置')
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    # API callers also reject invalid selectors or scalar XPath results.
    for xpath, selectors in [('count(//img)', ''), ('', '[broken=')]:
        result=panel.evaluate('''async args => { try { await (await import('./api.js')).scanTab(...args); return ''; } catch(e) { return e.message; } }''', [tab_id, xpath, selectors])
        assert result
    panel.screenshot(path=str(output / 'imagetaken-site-rules.png'), full_page=True)
    panel.close()
    source.close()


def test_image_queries_persist_across_reloads_and_navigation_while_remaining_isolated_by_hostname(context, worker, extension_id, source, tab_id, origin):
    keys = ['image-query:v1:127.0.0.1', 'image-query:v1:localhost']
    worker.evaluate('keys => chrome.storage.local.remove(keys)', keys)
    original_url = source.url
    panel = context.new_page()
    panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    expect(panel.locator('#query')).to_have_value('')
    panel.locator('#query').fill('cached.png')
    panel.wait_for_function("async () => (await chrome.storage.local.get('image-query:v1:127.0.0.1'))['image-query:v1:127.0.0.1'] === 'cached.png'")
    panel.reload()
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    expect(panel.locator('#query')).to_have_value('cached.png')
    expect(panel.locator('.card')).to_have_count(1)

    # Navigating the source across hostnames must restore each hostname's own
    # search, including an empty default for a hostname without a stored query.
    source.goto(origin.replace('127.0.0.1', 'localhost') + '/fixture')
    source.evaluate('window.ready')
    expect(panel.locator('#page-host')).to_contain_text('localhost:')
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    expect(panel.locator('#query')).to_have_value('')
    panel.locator('#query').fill('missing.png')
    panel.wait_for_function("async () => (await chrome.storage.local.get('image-query:v1:localhost'))['image-query:v1:localhost'] === 'missing.png'")
    source.goto(origin + '/other-page')
    source.evaluate('window.ready')
    expect(panel.locator('#page-host')).to_contain_text('127.0.0.1:')
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    expect(panel.locator('#query')).to_have_value('cached.png')
    panel.locator('#refresh').click()
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    expect(panel.locator('#query')).to_have_value('cached.png')
    panel.close()
    panel = context.new_page()
    panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    expect(panel.locator('#query')).to_have_value('cached.png')
    panel.locator('#filters').evaluate('(el) => el.open = true')
    panel.locator('#reset').click()
    panel.wait_for_function("async () => !Object.hasOwn(await chrome.storage.local.get('image-query:v1:127.0.0.1'), 'image-query:v1:127.0.0.1')")
    assert worker.evaluate("async () => (await chrome.storage.local.get('image-query:v1:localhost'))['image-query:v1:localhost']") == 'missing.png'
    panel.reload()
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    expect(panel.locator('#query')).to_have_value('')
    panel.close()
    worker.evaluate('keys => chrome.storage.local.remove(keys)', keys)
    source.goto(original_url)
    source.evaluate('window.ready')


def test_gallery_layouts_keep_context_controls_and_rule_summaries_usable_at_narrow_widths(panel, output):
    panel.bring_to_front()
    panel.locator('#query').fill('')
    expect(panel.locator('.card')).not_to_have_count(0)
    panel.locator('#filters').evaluate('(el) => el.open = false')
    expect(panel.locator('.intro, #total, .hero-illustration')).to_have_count(0)
    expect(panel.locator('header #page-host.breadcrumb-page')).to_contain_text('127.0.0.1')
    expect(panel.locator('.page-context #page-host')).to_have_count(0)
    assert panel.locator('.brand .logo').evaluate('(img) => img.complete && img.naturalWidth > 0')
    for width in (320, 360, 420, 1100):
        panel.set_viewport_size({'width': width, 'height': 1000})
        panel.evaluate('scrollTo(0, 0)')
        panel.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        expect(panel.locator('header')).to_have_count(1)
        expect(panel.locator('footer')).to_have_count(1)
        assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Notion UI overflows at {width}px'
        expect(panel.locator('#download')).to_be_visible()
        panel.screenshot(path=str(output / f'notion-library-{width}.png'))
    panel.locator('#layout').click()
    expect(panel.locator('#layout')).to_have_attribute('data-view', 'list')
    expect(panel.locator('#layout svg')).to_have_count(2)
    panel.set_viewport_size({'width': 320, 'height': 1000})
    panel.evaluate('scrollTo(0, 0)')
    panel.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'List layout overflows at 320px'
    panel.screenshot(path=str(output / 'notion-list-320.png'))
    panel.locator('#layout').click()
    expect(panel.locator('#layout')).to_have_attribute('data-view', 'grid')
    panel.locator('#query').fill('__no_images_match_this_query__')
    expect(panel.locator('.card')).to_have_count(0)
    expect(panel.locator('#empty')).to_be_visible()
    assert panel.locator('.empty-illustration').evaluate('(img) => img.complete && img.naturalWidth > 0')
    panel.set_viewport_size({'width': 420, 'height': 1000})
    panel.evaluate('scrollTo(0, 0)')
    panel.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    panel.screenshot(path=str(output / 'notion-empty-420.png'))
    panel.locator('#query').fill('')
    expect(panel.locator('.card')).not_to_have_count(0)


def test_title_editing_supports_saving_and_cancellation_while_retaining_long_titles(panel):
    original = panel.locator('#page-title').inner_text()
    panel.locator('#title-display svg').click()
    expect(panel.locator('#title-input')).to_have_value(original)
    assert panel.locator('#title-input').evaluate('(el) => el.selectionStart === el.value.length && el.selectionEnd === el.value.length')
    panel.locator('#title-input').fill('放弃这次修改')
    panel.locator('#cancel-title').click()
    expect(panel.locator('#page-title')).to_have_text(original)
    panel.locator('#page-title').click()
    panel.locator('#title-input').fill('编辑后的标题')
    panel.locator('#confirm-title').click()
    expect(panel.locator('#page-title')).to_have_text('编辑后的标题')
    panel.locator('#title-display').click()
    expect(panel.locator('#title-input')).to_have_value('编辑后的标题')
    panel.locator('#title-input').fill('点击外部确认')
    panel.locator('.strategy').click()
    expect(panel.locator('#page-title')).to_have_text('点击外部确认')
    panel.locator('#refresh').click()
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    expect(panel.locator('#page-title')).to_have_text('点击外部确认')
    panel.locator('#title-display').click()
    panel.locator('#title-input').fill('撤销编辑')
    panel.locator('#title-input').press('Escape')
    expect(panel.locator('#page-title')).to_have_text('点击外部确认')
    long_title = '这是很长的网页标题😀' * 60
    panel.locator('#title-display').click()
    panel.locator('#title-input').fill(long_title)
    panel.locator('#confirm-title').click()
    for width in (320, 1100):
        panel.set_viewport_size({'width': width, 'height': 900})
        assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert panel.locator('#page-title').evaluate('(el) => el.scrollWidth > el.clientWidth')
        panel.locator('#title-display').click()
        expect(panel.locator('#title-input')).to_have_value(long_title)
        assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth')
        panel.screenshot(path=str(OUTPUT / f'title-edit-{width}.png'))
        panel.locator('#cancel-title').click()
    panel.locator('#title-display').click()
    panel.locator('#title-input').fill(original)
    panel.locator('#title-input').press('Enter')
    expect(panel.locator('#page-title')).to_have_text(original)


def test_default_downloads_reuse_identical_content_and_preserve_files_with_different_content(panel):
    def save(data):
        return panel.evaluate('''async bytes => {
          const {saveBrowserDownload} = await import('./browser-downloads.js');
          const {contentHash} = await import('./file-content.js');
          const blob = new Blob([new Uint8Array(bytes)], {type:'image/png'});
          const url = URL.createObjectURL(blob);
          try {
            const result = await saveBrowserDownload(url, '哈希去重/duplicate.png', await contentHash(blob));
            return {path:result.filename, skipped:result.skipped};
          } finally { URL.revokeObjectURL(url); }
        }''', list(data))
    first = save(PNG)
    assert not first['skipped']
    original = Path(first['path'])
    duplicate = save(PNG)
    assert duplicate['skipped'] and duplicate['path'] == first['path']
    assert len(list(original.parent.iterdir())) == 1
    changed = PNG[:-1] + bytes([PNG[-1] ^ 1])
    different = save(changed)
    assert not different['skipped']
    assert re.fullmatch(r'duplicate_[a-f0-9]{16}\.png', Path(different['path']).name)
    assert original.read_bytes() == PNG
    assert Path(different['path']).read_bytes() == changed
    panel.reload()
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    repeated = save(changed)
    assert repeated['skipped'] and repeated['path'] == different['path']
    assert len(list(original.parent.iterdir())) == 2


def test_download_destinations_persist_and_handle_permissions_cancellation_and_filename_collisions(panel):
    # Only the OS picker is substituted; handles, IndexedDB and file writes are real.
    panel.evaluate('''() => {
      window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('chosen-disk', {create:true});
    }''')
    panel.locator('#choose-location').click()
    expect(panel.locator('#download-location')).to_have_text('chosen-disk')
    expect(panel.locator('#reset-location')).to_be_visible()
    panel.reload()
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    expect(panel.locator('#download-location')).to_have_text('chosen-disk')
    panel.locator('#query').fill('cached.png')
    expect(panel.locator('.card')).to_have_count(1)
    panel.locator('#title-display').click()
    panel.locator('#title-input').fill('自定义/相册')
    panel.locator('#confirm-title').click()
    expect(panel.locator('#download-location')).to_have_text('chosen-disk')
    expect(panel.locator('#destination-preview')).to_have_count(0)
    before = panel.evaluate('async () => (await chrome.downloads.search({})).length')
    panel.locator('.single-download').click()
    expect(panel.locator('#notice')).to_have_text('1 张图片已下载到「自定义_相册」文件夹。', timeout=20000)
    panel.locator('.card input').check()
    panel.locator('#download').click()
    expect(panel.locator('#notice')).to_have_text('0 张图片已下载到「自定义_相册」文件夹，跳过 1 张内容相同的图片。', timeout=20000)
    expect(panel.locator('.item-status')).to_contain_text('内容相同 · 已跳过')
    # Edit the existing file in place: identical length must not be treated as
    # identical content. Native-directory writes rehash the actual disk file.
    panel.evaluate('''async () => {
      const folder = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('chosen-disk')).getDirectoryHandle('自定义_相册');
      for await (const handle of folder.values()) {
        const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer()); bytes[bytes.length-1] ^= 1;
        const writable = await handle.createWritable(); await writable.write(bytes); await writable.close();
      }
    }''')
    panel.locator('#download').click()
    expect(panel.locator('#notice')).to_have_text('1 张图片已下载到「自定义_相册」文件夹。', timeout=20000)
    panel.locator('#download').click()
    expect(panel.locator('#notice')).to_contain_text('跳过 1 张内容相同的图片')
    saved = panel.evaluate('''async () => {
      const root = await navigator.storage.getDirectory();
      const chosen = await root.getDirectoryHandle('chosen-disk');
      const folder = await chosen.getDirectoryHandle('自定义_相册');
      const files = [];
      for await (const [name, handle] of folder.entries()) files.push({name, data: Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()))});
      return files;
    }''')
    assert len(saved) == 2, saved
    assert len({f['name'] for f in saved}) == 2
    assert any(re.search(r'_[a-f0-9]{16}\.png$', f['name']) for f in saved)
    assert sum(bytes(f['data']) == PNG for f in saved) == 1
    assert all(len(f['data']) == len(PNG) for f in saved)
    assert panel.evaluate('async () => (await chrome.downloads.search({})).length') == before
    # Cancelling the native chooser retains the previous directory.
    panel.evaluate("() => { window.showDirectoryPicker = async () => { throw new DOMException('cancel', 'AbortError'); }; }")
    panel.locator('#choose-location').click()
    expect(panel.locator('#choose-location')).to_be_enabled()
    expect(panel.locator('#download-location')).to_have_text('chosen-disk')
    panel.locator('#reset-location').click()
    expect(panel.locator('#download-location')).to_have_text('浏览器默认下载位置')
    expect(panel.locator('#reset-location')).to_be_hidden()
    panel.reload()
    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
    expect(panel.locator('#download-location')).to_have_text('浏览器默认下载位置')
    expect(panel.locator('#page-title')).to_have_text('ImageTaken 测试图片集')
    panel.locator('#query').fill('cached.png')
    expect(panel.locator('.card')).to_have_count(1)
    panel.locator('#select-all').check()


def test_gallery_selection_supports_clicks_drag_toggling_cancellation_and_scrolling_while_excluding_failed_previews(panel):
    cards = panel.locator('.card')
    first = cards.nth(0)
    first.locator('img').click()
    expect(first.locator('input')).to_be_checked()
    first.locator('.dimensions').click()
    expect(first.locator('input')).not_to_be_checked()
    # Clicking label padding must toggle only once through the native checkbox.
    first.locator('.card-check').click(position={'x': 1, 'y': 1})
    expect(first.locator('input')).to_be_checked()
    first.locator('input').focus()
    panel.keyboard.press('Space')
    expect(first.locator('input')).not_to_be_checked()

    def positions():
        first.evaluate('(el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 180)')
        return [cards.nth(i).bounding_box() for i in range(3)]

    def drag(start, end, release=True):
        panel.mouse.move(*start)
        panel.mouse.down()
        panel.mouse.move(*end, steps=8)
        if release:
            panel.mouse.up()

    a, b, c = positions()
    start = (a['x'] + 35, a['y'] + 55)
    end = (c['x'] + c['width'] / 2, c['y'] + 95)
    drag(start, end, release=False)
    expect(panel.locator('.card.selected')).to_have_count(3)
    expect(panel.locator('.selection-box')).to_be_visible()
    panel.screenshot(path=str(OUTPUT / 'selection-drag.png'))
    panel.mouse.move(start[0] + 30, start[1] + 30, steps=4)
    expect(panel.locator('.card.selected')).to_have_count(1)
    panel.keyboard.press('Escape')
    panel.mouse.up()
    expect(panel.locator('.card.selected')).to_have_count(0)
    expect(panel.locator('.selection-box')).to_be_hidden()

    # Starting in a grid gap and dragging backwards includes intersected cards.
    drag((b['x'] - 5, a['y'] + 100), (a['x'] + 35, a['y'] + 55))
    expect(panel.locator('.card.selected')).to_have_count(1)
    drag(start, end)
    expect(panel.locator('.card.selected')).to_have_count(3)
    expect(panel.locator('#selection-count')).to_have_text('已选择 3 张')
    # The click generated after a drag must not deselect the final card.
    expect(cards.nth(2).locator('input')).to_be_checked()
    panel.keyboard.down('Control')
    drag((b['x'] + 40, b['y'] + 50), (b['x'] + 90, b['y'] + 100))
    panel.keyboard.up('Control')
    expect(panel.locator('.card.selected')).to_have_count(2)
    expect(cards.nth(1).locator('input')).not_to_be_checked()

    # A filter render during a drag cleans up the gesture and preserves hidden selections.
    drag(start, end, release=False)
    panel.locator('#query').fill('missing.png')
    expect(cards).to_have_count(1)
    expect(panel.locator('.selection-box')).to_be_hidden()
    panel.mouse.up()
    expect(panel.locator('#selection-count')).to_contain_text('被筛选隐藏')
    expect(cards.first.locator('input')).to_be_disabled()
    hidden_selection = panel.locator('#selection-count').inner_text()
    cards.first.locator('.dimensions').click()
    expect(cards.first.locator('input')).not_to_be_checked()
    cards.first.scroll_into_view_if_needed()
    failed_box = cards.first.bounding_box()
    drag((failed_box['x'] + 40, failed_box['y'] + 45), (failed_box['x'] + 95, failed_box['y'] + 95))
    expect(cards.first.locator('input')).not_to_be_checked()
    expect(panel.locator('#selection-count')).to_have_text(hidden_selection)
    panel.locator('#query').fill('')
    expect(cards).not_to_have_count(1)
    panel.locator('#select-all').check()
    panel.locator('#select-all').uncheck()

    # The same gestures work in a narrow extension side panel.
    panel.set_viewport_size({'width': 360, 'height': 900})
    a, b, c = positions()
    drag((a['x'] + 35, a['y'] + 55), (b['x'] + 60, b['y'] + 100))
    expect(panel.locator('.card.selected')).to_have_count(2)
    panel.locator('#select-all').check()
    panel.locator('#select-all').uncheck()
    panel.set_viewport_size({'width': 1100, 'height': 900})

    panel.locator('#layout').click()
    a, b, c = positions()
    drag((a['x'] + 45, a['y'] + 45), (b['x'] + 80, b['y'] + 65))
    expect(panel.locator('.card.selected')).to_have_count(2)
    panel.locator('#select-all').check()
    panel.locator('#select-all').uncheck()
    panel.locator('#layout').click()

    # At the bottom edge a held drag scrolls, then releasing outside the gallery cleans up.
    a, b, c = positions()
    before = panel.evaluate('scrollY')
    footer = panel.locator('footer').bounding_box()
    drag((a['x'] + 45, a['y'] + 45), (a['x'] + 70, footer['y'] - 2), release=False)
    panel.wait_for_function('(before) => scrollY > before + 40', arg=before)
    panel.mouse.move(5, 200)
    panel.mouse.up()
    expect(panel.locator('.selection-box')).to_be_hidden()
    panel.locator('#select-all').check()
    panel.locator('#select-all').uncheck()


def main():
    servers = [ThreadingHTTPServer(('127.0.0.1', 0), Handler) for _ in range(2)]
    for index, server in enumerate(servers):
        server.other_port = servers[1-index].server_port
        Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{servers[0].server_port}'
    other = f'http://127.0.0.1:{servers[1].server_port}'
    executable = os.environ.get('CHROMIUM_PATH')
    if not executable:
        candidates = sorted((Path.home() / 'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        executable = str(candidates[-1]) if candidates else None
    with tempfile.TemporaryDirectory(prefix='imagetaken-browser-') as profile, sync_playwright() as p:
        default_profile = Path(profile) / 'Default'
        default_profile.mkdir()
        (default_profile / 'Preferences').write_text(json.dumps({
            'download': {'default_directory': str(OUTPUT / 'downloads' / Path(profile).name), 'prompt_for_download': False},
        }))
        # A neutral listener in another extension used to strip our Blob
        # filenames, leaving UUID files directly in the Downloads directory.
        companion = Path(profile) / 'download-listener-extension'
        companion.mkdir()
        (companion / 'manifest.json').write_text(json.dumps({
            'manifest_version': 3, 'name': 'Download filename regression fixture',
            'version': '1.0', 'permissions': ['downloads'],
            'background': {'service_worker': 'listener.js'},
        }))
        (companion / 'listener.js').write_text('chrome.downloads.onDeterminingFilename.addListener((item, suggest) => suggest());')
        # Install the fixture first, matching previously installed download
        # extensions when ImageTaken is subsequently loaded or reloaded.
        extension_paths = f'{companion},{ROOT / "extension"}'
        context = p.chromium.launch_persistent_context(
            profile, executable_path=executable, channel='chromium', headless=True,
            accept_downloads=True, locale='zh-CN', viewport={'width': 1100, 'height': 900},
            args=[f'--disable-extensions-except={extension_paths}', f'--load-extension={extension_paths}'],
        )
        try:
            worker = next((w for w in context.service_workers if w.url.endswith('/background.js')), None)
            if worker is None:
                worker = context.wait_for_event('serviceworker', predicate=lambda w: w.url.endswith('/background.js'))
            listener = next((w for w in context.service_workers if w.url.endswith('/listener.js')), None)
            if listener is None:
                listener = context.wait_for_event('serviceworker', predicate=lambda w: w.url.endswith('/listener.js'))
            listener.evaluate('() => true')
            extension_id = worker.url.split('/')[2]
            source = context.new_page()
            source.goto(origin + '/fixture')
            source.evaluate('window.ready')
            source.wait_for_load_state('networkidle')
            tab_id = worker.evaluate('''async () => (await chrome.tabs.query({})).find(t => t.url?.endsWith('/fixture')).id''')
            panel = context.new_page()
            errors = []
            panel.on('pageerror', lambda error: errors.append(str(error)))
            panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
            expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
            panel.wait_for_load_state('networkidle')
            expect(panel.locator('#min-width')).to_have_value(''); expect(panel.locator('#min-width')).to_have_attribute('placeholder', '全局默认(50)')
            expect(panel.locator('#min-height')).to_have_value(''); expect(panel.locator('#min-height')).to_have_attribute('placeholder', '全局默认(50)')
            expect(panel.locator('#min-size')).to_have_value('2')
            for hidden in ('narrow.png', 'short.png', 'under2k.png'):
                expect(panel.locator('.card .image-url').filter(has_text=hidden)).to_have_count(0)
            expect(panel.locator('.card .image-url').filter(has_text='boundary.png')).to_have_count(1)
            boundary = panel.locator('.card').filter(has=panel.locator('.image-url', has_text='boundary.png'))
            expect(boundary.locator('.image-size')).to_have_text('2.0 KiB')
            expect(boundary.locator('.preview-origin')).to_be_visible()
            expect(boundary.locator('.preview-origin')).to_have_text('归档资源')
            expect(panel.locator('.card .image-url').filter(has_text='missing.png')).to_have_count(1)
            panel.locator('#filters').evaluate('(el) => el.open = true')
            panel.locator('#min-width').fill('321')
            panel.locator('#min-height').fill('123')
            panel.locator('#min-size').fill('2.5')
            panel.wait_for_function('''async () => {
              const prefix='filters:site:v1:127.0.0.1:';
              const s=await chrome.storage.local.get([prefix+'width',prefix+'height',prefix+'minBytes']);
              return s[prefix+'width']===321 && s[prefix+'height']===123 && s[prefix+'minBytes']===2560;
            }''')
            assert panel.evaluate("async () => (await (await import('./preferences.js')).loadThresholds('localhost')).width") == 50
            panel.reload()
            expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
            expect(panel.locator('#min-width')).to_have_value('321')
            expect(panel.locator('#min-height')).to_have_value('123')
            expect(panel.locator('#min-size')).to_have_value('2.5')
            panel.locator('#filters').evaluate('(el) => el.open = true')
            panel.locator('#defaults').click()
            expect(panel.locator('#min-width')).to_have_value(''); expect(panel.locator('#min-width')).to_have_attribute('placeholder', '全局默认(50)')
            expect(panel.locator('.card .image-url').filter(has_text='boundary.png')).to_have_count(1)
            panel.locator('#filters').evaluate('(el) => el.open = false')
            items = panel.evaluate('''async tabId => (await (await import('./api.js')).scanTab(tabId)).items''', tab_id)
            # Re-scan invalidates IDs; refresh the UI before testing the UI itself later.
            urls = {item['url']: item for item in items}
            assert origin + '/missing.png' in urls, 'failed image must remain listed'
            assert other + '/frame-only.png' in urls, 'cross-origin iframe missing'
            assert origin + '/shadow.png' in urls, 'open shadow DOM missing'
            assert origin + '/large.png' in urls, 'srcset candidate missing'
            assert origin + '/twox.png' in urls, 'data URL srcset parsing failed'
            for path in ('background.png', 'pseudo.png', 'lazy.png', 'linked.webp', 'poster.png'):
                assert origin + '/' + path in urls, path
            assert any(item['sources'] == ['svg'] for item in items), 'inline SVG missing'
            assert len([i for i in items if i['kind'] == 'canvas']) == 2
            assert urls[origin + '/boundary.png']['bytes'] == 2048
            assert urls[origin + '/under2k.png']['bytes'] == 2047
            assert urls[origin + '/missing.png']['bytes'] is None
            assert all(len(item['ignoreHash']) == 64 for item in items if item['url'].startswith('https:') or item['url'].startswith('http:') and item['kind'] != 'canvas')

            assert urls[other + '/cross.png']['loaded'] is True
            assert urls[other + '/cross.png']['previewIssue'] == 'cross-origin'
            assert not urls[other + '/cross.png']['preview']
            # Preview retries reuse original browser bytes even when the URL is now
            # expired. They must not make a fresh request to the image server.
            before_preview = COUNTS.get('/once.png', 0)
            preview = panel.evaluate("""async ({tabId,item}) => {
              const preview=await (await import('./previews.js')).loadPreview(tabId,item);
              URL.revokeObjectURL(preview.url);
              return preview;
            }""", {'tabId':tab_id,'item':urls[origin + '/once.png']})
            assert preview['method'] == 'mhtml-resource' and preview['bytes'] > 0, preview
            assert (preview['width'], preview['height']) == (640, 420), preview
            assert COUNTS.get('/once.png', 0) == before_preview, 'preview retry requested an already displayed image'

            def read(item):
                return panel.evaluate('''async ({tabId,item}) => {
                  try {
                    const {blob,method}=await (await import('./api.js')).readImage(tabId,item);
                    return {method,mime:blob.type,bytes:blob.size,data:Array.from(new Uint8Array(await blob.arrayBuffer()))};
                  } catch(e) { return {error:e.message}; }
                }''', {'tabId': tab_id, 'item': item})

            normal = read(urls[origin + '/cached.png'])
            assert normal['method'] == 'mhtml-resource', {k:v for k,v in normal.items() if k != 'data'}
            assert bytes(normal['data']) == PNG, 'cache bytes must exactly match original'
            expired = read(urls[origin + '/once.png'])
            assert expired['method'] == 'mhtml-resource', expired
            assert Image.open(io.BytesIO(bytes(expired['data']))).size == (640, 420)
            auth = read(urls[origin + '/auth.png'])
            assert bytes(auth['data']) == PNG, 'authenticated image failed'
            cross = read(urls[other + '/cross.png'])
            assert cross['method'] == 'mhtml-resource', cross
            assert bytes(cross['data']) == PNG
            blob_items = [item for item in items if item['url'].startswith('blob:')]
            assert len(blob_items) == 2
            assert {read(item).get('method') for item in blob_items} == {'page-blob', None}
            assert any('error' in read(item) for item in blob_items)
            canvases = [item for item in items if item['kind'] == 'canvas']
            assert read(canvases[0])['method'] == 'canvas'
            assert 'error' in read(canvases[1]), 'tainted canvas must fail explicitly'
            denied = read(urls[other + '/denied.png'])
            assert denied['method'] == 'mhtml-resource' and bytes(denied['data']) == PNG, 'retained protected image must reuse original browser bytes'
            assert 'error' in read(urls[origin + '/missing.png'])
            assert read(urls[other + '/frame-only.png'])['method'] == 'mhtml-resource'
            # A second open view must not invalidate the first view's Blob reads.
            panel.evaluate('''async tabId => (await import('./api.js')).scanTab(tabId)''', tab_id)
            assert {read(item).get('method') for item in blob_items} == {'page-blob', None}
            assert any('error' in read(item) for item in blob_items)

            # Conversions use real browser decoders/encoders and retain dimensions.
            for fmt, mime in [('png', 'image/png'), ('jpg', 'image/jpeg'), ('webp', 'image/webp')]:
                output = panel.evaluate('''async ({tabId,item,fmt}) => {
                  const api=await import('./api.js');const {blob}=await api.readImage(tabId,item);
                  const out=await api.convert(blob,fmt);return {mime:out.type,data:Array.from(new Uint8Array(await out.arrayBuffer()))};
                }''', {'tabId': tab_id, 'item': urls[origin+'/cached.png'], 'fmt': fmt})
                assert output['mime'] == mime
                assert Image.open(io.BytesIO(bytes(output['data']))).size == (640, 420)

            panel.get_by_role('button', name='重新扫描页面', exact=True).click()
            expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
            panel.wait_for_load_state('networkidle')
            test_title_editing_supports_saving_and_cancellation_while_retaining_long_titles(panel)
            test_gallery_selection_supports_clicks_drag_toggling_cancellation_and_scrolling_while_excluding_failed_previews(panel)
            # Playwright normally renames downloads to UUIDs. Use Chrome's native
            # filenames here so the actual title subdirectory can be verified.
            context.new_cdp_session(panel).send('Browser.setDownloadBehavior', {
                'behavior': 'default',
            })
            panel.locator('#query').fill('cached.png')
            expect(panel.locator('.card')).to_have_count(1)
            panel.locator('#select-all').check()
            expect(panel.locator('#selection-count')).to_have_text('已选择 1 张')
            panel.locator('#download').click()
            expect(panel.locator('#notice')).to_have_text('1 张图片已下载到「ImageTaken 测试图片集」文件夹。', timeout=20000)
            expect(panel.locator('.item-status')).to_contain_text('浏览器资源 · 原文件')
            expect(panel.locator('#show-download')).to_be_visible()
            panel.locator('#select-all').uncheck()
            panel.locator('#query').fill('blob:')
            expect(panel.locator('.card')).to_have_count(2)
            panel.locator('#select-all').check()
            panel.locator('#format').select_option('jpg')
            panel.locator('#download').click()
            expect(panel.locator('#notice')).to_have_text('2 张图片已下载到「ImageTaken 测试图片集」文件夹。', timeout=20000)
            for status in panel.locator('.item-status').all():
                expect(status).to_contain_text('→ JPG')
            completed = panel.evaluate('''async () => (await chrome.downloads.search({})).filter(d => d.state === 'complete').map(d => ({filename:d.filename,mime:d.mime}))''')
            assert len(completed) == 3, completed
            assert sum(d['mime'] == 'image/jpeg' for d in completed) == 2, completed
            for download in completed:
                file = Path(download['filename'])
                assert file.parent.name == 'ImageTaken 测试图片集', file
                assert file.name.split('-')[0].isdigit(), file
                assert file.exists(), 'completed download must exist on disk'
                assert Image.open(file).size == (640, 420)
                if download['mime'] == 'image/png':
                    assert file.read_bytes() == PNG, 'saved cached image must retain original bytes'
            panel.locator('#select-all').uncheck()
            panel.locator('#format').select_option('original')
            test_default_downloads_reuse_identical_content_and_preserve_files_with_different_content(panel)
            panel.locator('#query').fill('cached.png')
            expect(panel.locator('.card')).to_have_count(1)
            panel.locator('#select-all').check()
            test_download_destinations_persist_and_handle_permissions_cancellation_and_filename_collisions(panel)
            panel.locator('#query').fill('missing.png')
            expect(panel.locator('.card')).to_have_count(1)
            expect(panel.locator('.image-url')).to_contain_text('missing.png')
            expect(panel.locator('#selection-count')).to_contain_text('含 1 张被筛选隐藏')
            panel.locator('.single-download').click()
            expect(panel.locator('.item-status')).to_have_text('下载失败 · 可重试', timeout=20000)
            expect(panel.locator('.card')).to_have_count(1)
            panel.locator('#query').fill('')
            panel.locator('#layout').click()
            expect(panel.locator('#gallery')).to_have_class('gallery list')
            panel.locator('#layout').click()
            panel.locator('#filters').evaluate('(el) => el.open = true')
            panel.locator('#min-width').fill('1000')
            panel.locator('#loaded').check()
            expect(panel.locator('.card')).to_have_count(0)
            panel.locator('#reset').click()
            expect(panel.locator('.card')).not_to_have_count(0)
            panel.get_by_role('button', name='重新扫描页面', exact=True).click()
            expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
            panel.locator('#filters').evaluate('(el) => el.open = false')
            panel.set_viewport_size({'width': 420, 'height': 1000})
            panel.screenshot(path=str(OUTPUT / 'panel.png'))
            assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'narrow panel overflows'
            panel.set_viewport_size({'width': 1100, 'height': 900})
            panel.screenshot(path=str(OUTPUT / 'expanded.png'), full_page=True)

            # URL ignore survives re-scan, panel reload and another page path.
            panel.locator('#query').fill('cached.png')
            expect(panel.locator('.card .image-url').filter(has_text='cached.png')).to_have_count(1)
            panel.locator('#select-all').check()
            panel.locator('.ignore-image').click()
            expect(panel.locator('.card')).to_have_count(0)
            expect(panel.locator('#selection-count')).to_have_text('已选择 0 张')
            panel.reload()
            expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
            expect(panel.locator('.card .image-url').filter(has_text='cached.png')).to_have_count(0)
            source.goto(origin + '/other-page')
            source.evaluate('window.ready')
            source.wait_for_load_state('networkidle')
            panel.get_by_role('button', name='重新扫描页面', exact=True).click()
            expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
            expect(panel.locator('.card .image-url').filter(has_text='cached.png')).to_have_count(0)
            panel.locator('#filters').evaluate('(el) => el.open = true')
            panel.locator('#show-ignored').check()
            cached = panel.locator('.card').filter(has=panel.locator('.image-url', has_text='cached.png'))
            expect(cached.locator('.ignored-badge')).to_be_visible()

            # The exact same image URL must be visible on a different page hostname.
            second_source = context.new_page()
            second_source.goto(f'http://localhost:{servers[0].server_port}/other-page')
            second_source.evaluate('window.ready')
            second_source.evaluate('''async url => { const img=new Image();img.src=url;document.body.append(img);await img.decode(); }''', origin + '/cached.png')
            second_source.wait_for_load_state('networkidle')
            second_id = worker.evaluate('''async () => (await chrome.tabs.query({})).find(t => t.url?.startsWith('http://localhost:')).id''')
            second_panel = context.new_page()
            second_panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={second_id}')
            expect(second_panel.locator('.page-context')).to_have_attribute('data-frames', '2')
            second_panel.locator('#query').fill(origin + '/cached.png')
            expect(second_panel.locator('.card')).to_have_count(1)
            expect(second_panel.locator('.card .image-url').filter(has_text=origin + '/cached.png')).to_have_count(1)
            expect(second_panel.locator('.ignored-badge')).to_be_hidden()
            second_panel.close()
            second_source.close()
            cached.locator('.ignore-image').click()
            expect(cached.locator('.ignored-badge')).to_be_hidden()
            panel.locator('#show-ignored').uncheck()

            # Equivalent Base64 spellings persist as the same ignore fingerprint.
            panel.locator('#query').fill('data:image/png')
            expect(panel.locator('.card')).to_have_count(1)
            expect(panel.locator('.image-url')).to_contain_text('data: 页面内嵌资源')
            panel.locator('.ignore-image').click()
            expect(panel.locator('.card')).to_have_count(0)
            source.evaluate('''() => {
              for(const img of document.images) {
                if(img.src.startsWith('data:image/png')) {
                  const [header,payload]=img.src.split(',');
                  img.src=header+',%'+payload.charCodeAt(0).toString(16)+payload.slice(1).replace(/=+$/, '');
                }
              }
            }''')
            panel.get_by_role('button', name='重新扫描页面', exact=True).click()
            expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
            expect(panel.locator('.card')).to_have_count(0)
            panel.locator('#show-ignored').check()
            expect(panel.locator('.card')).to_have_count(2)
            panel.locator('.ignore-image').first.click()
            panel.locator('#show-ignored').uncheck()
            expect(panel.locator('.card')).to_have_count(2)

            # New Blob UUIDs after reloading the page still match the pixel fingerprint.
            panel.locator('#query').fill('blob:')
            expect(panel.locator('.card')).to_have_count(2)
            expect(panel.locator('.image-url')).to_have_text(['blob: 页面内嵌资源', 'blob: 页面内嵌资源'])
            panel.locator('.ignore-image').first.click()
            expect(panel.locator('.card')).to_have_count(0)
            source.reload()
            source.evaluate('window.ready')
            panel.get_by_role('button', name='重新扫描页面', exact=True).click()
            expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
            expect(panel.locator('.card')).to_have_count(0)
            panel.locator('#show-ignored').check()
            expect(panel.locator('.card')).to_have_count(2)
            panel.locator('.ignore-image').first.click()
            expect(panel.locator('.ignored-badge:visible')).to_have_count(0)
            panel.locator('#show-ignored').uncheck()

            # Concurrent ignore writes must be merged in the background worker.
            panel.evaluate('''async () => {
              const {setIgnored}=await import('./preferences.js');
              await Promise.all([setIgnored('127.0.0.1','a'.repeat(64),true),setIgnored('127.0.0.1','b'.repeat(64),true)]);
              const hashes=(await chrome.storage.local.get('ignored:v1:127.0.0.1'))['ignored:v1:127.0.0.1'];
              if(!hashes.includes('a'.repeat(64)) || !hashes.includes('b'.repeat(64))) throw new Error('Lost concurrent ignore update');
            }''')
            panel.locator('#query').fill('')
            panel.locator('#defaults').click()
            panel.set_viewport_size({'width': 420, 'height': 1100})
            panel.screenshot(path=str(OUTPUT / 'filters-and-ignore.png'))
            assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'filter panel overflows'
            assert not errors, errors
            test_preview_retries_recover_eligible_failures_while_preserving_signed_urls_filters_and_download_state(context, worker, extension_id, origin, OUTPUT)
            test_site_scopes_persist_xpath_and_css_exclusions_and_isolate_them_by_hostname(context, worker, extension_id, origin, OUTPUT)
            test_gallery_layouts_keep_context_controls_and_rule_summaries_usable_at_narrow_widths(panel, OUTPUT)
            test_image_queries_persist_across_reloads_and_navigation_while_remaining_isolated_by_hostname(context, worker, extension_id, source, tab_id, origin)
            test_shared_settings_persist_across_reloads_and_update_galleries_without_overwriting_edited_titles(context, worker, extension_id, origin)
            test_global_threshold_settings_update_inherited_site_values_while_preserving_overrides_and_gallery_state(context, worker, extension_id, origin)
            test_threshold_controls_distinguish_inherited_values_from_overrides_and_reset_each_dimension_independently(context, worker, extension_id, origin)
            assert not errors, errors

            # A navigated frame must never service an obsolete read by recycled frame ID.
            navigation_items = panel.evaluate('''async tabId => (await (await import('./api.js')).scanTab(tabId)).items''', tab_id)
            before_navigation = next(item for item in navigation_items if item['url'] == origin + '/cached.png')
            source.goto(origin + '/frame')
            stale = read(before_navigation)
            assert stale.get('method') != 'page-cache', stale
            print(json.dumps({'detected': len(items), 'cache': normal['method'], 'expired': expired['method'],
                              'crossOrigin': cross['method'], 'blob': 'original + revoked fallback',
                              'ui': 'editable titles, long titles, title folders, directory persistence, real filesystem writes, duplicate filenames, picker cancellation, card clicks, marquee selection, cancellation, auto-scroll, side panel, filters, hidden selection, download complete, retry, layouts',
                              'screenshots': str(OUTPUT), 'pageErrors': errors}, ensure_ascii=False, indent=2))
        finally:
            context.close()
            for server in servers:
                server.shutdown()


if __name__ == '__main__':
    main()
