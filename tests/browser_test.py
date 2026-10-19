"""Real MV3 extension integration tests; no mocked Chrome APIs.

Run: .venv/bin/python tests/browser_test.py
Set CHROMIUM_PATH to use an existing Chrome for Testing executable.
"""
import base64
import io
import json
import os
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
            html = f'''<!doctype html><title>ImageDown 测试图片集</title>
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


def test_preview_retries(context, worker, extension_id, origin, output):
    source = context.new_page()
    source.goto(origin + '/retry-fixture')
    source.wait_for_load_state('networkidle')
    tab_id = worker.evaluate('''async () => (await chrome.tabs.query({})).find(t => t.url?.endsWith('/retry-fixture')).id''')
    panel = context.new_page()
    errors = []
    panel.on('pageerror', lambda error: errors.append(str(error)))
    panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
    expect(panel.locator('#frame-count')).to_have_text('1 个框架')
    expect(panel.locator('.retry-preview:visible')).to_have_count(5)
    expect(panel.locator('#retry-failed')).to_have_text('↻ 重试所有失败图片 (5)')

    def card(name):
        return panel.locator('.card').filter(has=panel.locator('.image-url', has_text=name))

    single = card('retry-one.png')
    single.locator('input').check()
    expect(panel.locator('#selection-count')).to_have_text('已选择 1 张')
    before = COUNTS.get('/retry-one.png', 0)
    RETRY_READY.add('/retry-one.png')
    single.locator('.retry-preview').click()
    expect(single.locator('.retry-preview')).to_be_hidden(timeout=20000)
    expect(single.locator('img')).not_to_have_class('failed')
    expect(single.locator('.dimensions')).to_have_text('640 × 420')
    expect(single.locator('.image-size')).to_have_text(f'{len(PNG) / 1024:.1f} KiB')
    expect(single.locator('input')).to_be_checked()
    assert COUNTS['/retry-one.png'] > before
    assert all(path == '/retry-one.png?signature=demo%2Bvalue' for path in RETRY_PATHS if path.startswith('/retry-one.png'))
    expect(panel.locator('#retry-failed')).to_have_text('↻ 重试所有失败图片 (4)')

    never = card('retry-never.png')
    never.locator('.retry-preview').click()
    expect(never.locator('.retry-preview')).to_be_enabled(timeout=20000)
    expect(never.locator('.retry-preview')).to_have_attribute('title', '页面：HTTP 403；扩展：HTTP 403')
    expect(never.locator('img')).to_have_class('failed')

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
    expect(panel.locator('#min-width')).to_have_value('50')
    expect(panel.locator('#min-height')).to_have_value('50')
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
    panel.evaluate('scrollTo(0, 0)')
    panel.screenshot(path=str(output / 'preview-retries.png'))
    assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'retry controls overflow'
    assert not errors, errors
    panel.close()
    source.close()


def test_notion_layout(panel, output):
    panel.bring_to_front()
    panel.locator('#query').fill('')
    expect(panel.locator('.card')).not_to_have_count(0)
    panel.locator('#filters').evaluate('(el) => el.open = false')
    assert panel.locator('.hero-illustration').evaluate('(img) => img.complete && img.naturalWidth > 0')
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
    with tempfile.TemporaryDirectory(prefix='imagedown-browser-') as profile, sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            profile, executable_path=executable, channel='chromium', headless=True,
            accept_downloads=True, viewport={'width': 1100, 'height': 900},
            args=[f'--disable-extensions-except={ROOT / "extension"}', f'--load-extension={ROOT / "extension"}'],
        )
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
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
            expect(panel.locator('#frame-count')).to_have_text('2 个框架')
            panel.wait_for_load_state('networkidle')
            expect(panel.locator('#min-width')).to_have_value('50')
            expect(panel.locator('#min-height')).to_have_value('50')
            expect(panel.locator('#min-size')).to_have_value('2')
            for hidden in ('narrow.png', 'short.png', 'under2k.png'):
                expect(panel.locator('.card .image-url').filter(has_text=hidden)).to_have_count(0)
            expect(panel.locator('.card .image-url').filter(has_text='boundary.png')).to_have_count(1)
            boundary = panel.locator('.card').filter(has=panel.locator('.image-url', has_text='boundary.png'))
            expect(boundary.locator('.image-size')).to_have_text('2.0 KiB')
            expect(panel.locator('.card .image-url').filter(has_text='missing.png')).to_have_count(1)
            panel.locator('#filters').evaluate('(el) => el.open = true')
            panel.locator('#min-width').fill('321')
            panel.locator('#min-height').fill('123')
            panel.locator('#min-size').fill('2.5')
            panel.wait_for_function('''async () => {
              const s=await chrome.storage.local.get(['filters:width','filters:height','filters:minBytes']);
              return s['filters:width']===321 && s['filters:height']===123 && s['filters:minBytes']===2560;
            }''')
            panel.reload()
            expect(panel.locator('#frame-count')).to_have_text('2 个框架')
            expect(panel.locator('#min-width')).to_have_value('321')
            expect(panel.locator('#min-height')).to_have_value('123')
            expect(panel.locator('#min-size')).to_have_value('2.5')
            panel.locator('#filters').evaluate('(el) => el.open = true')
            panel.locator('#defaults').click()
            expect(panel.locator('#min-width')).to_have_value('50')
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

            def read(item):
                return panel.evaluate('''async ({tabId,item}) => {
                  try {
                    const {blob,method}=await (await import('./api.js')).readImage(tabId,item);
                    return {method,mime:blob.type,bytes:blob.size,data:Array.from(new Uint8Array(await blob.arrayBuffer()))};
                  } catch(e) { return {error:e.message}; }
                }''', {'tabId': tab_id, 'item': item})

            normal = read(urls[origin + '/cached.png'])
            assert normal['method'] == 'page-cache', {k:v for k,v in normal.items() if k != 'data'}
            assert bytes(normal['data']) == PNG, 'cache bytes must exactly match original'
            expired = read(urls[origin + '/once.png'])
            assert expired['method'] == 'decoded-pixels', expired
            assert Image.open(io.BytesIO(bytes(expired['data']))).size == (640, 420)
            auth = read(urls[origin + '/auth.png'])
            assert bytes(auth['data']) == PNG, 'authenticated image failed'
            cross = read(urls[other + '/cross.png'])
            assert cross['method'] == 'extension-fetch', cross
            assert bytes(cross['data']) == PNG
            blob_items = [item for item in items if item['url'].startswith('blob:')]
            assert len(blob_items) == 2
            assert {read(item)['method'] for item in blob_items} == {'page-blob', 'decoded-pixels'}
            canvases = [item for item in items if item['kind'] == 'canvas']
            assert read(canvases[0])['method'] == 'canvas'
            assert 'error' in read(canvases[1]), 'tainted canvas must fail explicitly'
            denied = read(urls[other + '/denied.png'])
            assert 'error' in denied, 'protected cross-origin image must not pretend to be readable'
            assert 'error' in read(urls[origin + '/missing.png'])
            assert read(urls[other + '/frame-only.png'])['method'] == 'page-cache'
            # A second open view must not invalidate the first view's Blob reads.
            panel.evaluate('''async tabId => (await import('./api.js')).scanTab(tabId)''', tab_id)
            assert {read(item)['method'] for item in blob_items} == {'page-blob', 'decoded-pixels'}

            # Conversions use real browser decoders/encoders and retain dimensions.
            for fmt, mime in [('png', 'image/png'), ('jpg', 'image/jpeg'), ('webp', 'image/webp')]:
                output = panel.evaluate('''async ({tabId,item,fmt}) => {
                  const api=await import('./api.js');const {blob}=await api.readImage(tabId,item);
                  const out=await api.convert(blob,fmt);return {mime:out.type,data:Array.from(new Uint8Array(await out.arrayBuffer()))};
                }''', {'tabId': tab_id, 'item': urls[origin+'/cached.png'], 'fmt': fmt})
                assert output['mime'] == mime
                assert Image.open(io.BytesIO(bytes(output['data']))).size == (640, 420)

            panel.get_by_role('button', name='重新扫描页面', exact=True).click()
            expect(panel.locator('#frame-count')).to_have_text('2 个框架')
            panel.locator('#query').fill('cached.png')
            expect(panel.locator('.card')).to_have_count(1)
            panel.locator('#select-all').check()
            expect(panel.locator('#selection-count')).to_have_text('已选择 1 张')
            panel.locator('#download').click()
            expect(panel.locator('#notice')).to_have_text('1 张图片已下载到 ImageDown 文件夹。', timeout=20000)
            expect(panel.locator('.item-status')).to_contain_text('页面缓存')
            panel.locator('#select-all').uncheck()
            panel.locator('#query').fill('blob:')
            expect(panel.locator('.card')).to_have_count(2)
            panel.locator('#select-all').check()
            panel.locator('#format').select_option('jpg')
            panel.locator('#download').click()
            expect(panel.locator('#notice')).to_have_text('2 张图片已下载到 ImageDown 文件夹。', timeout=20000)
            for status in panel.locator('.item-status').all():
                expect(status).to_contain_text('→ JPG')
            completed = panel.evaluate('''async () => (await chrome.downloads.search({})).filter(d => d.state === 'complete').map(d => ({filename:d.filename,mime:d.mime}))''')
            assert len(completed) == 3, completed
            assert sum(d['mime'] == 'image/jpeg' for d in completed) == 2, completed
            for download in completed:
                file = Path(download['filename'])
                assert file.exists(), 'completed download must exist on disk'
                assert Image.open(file).size == (640, 420)
                if download['mime'] == 'image/png':
                    assert file.read_bytes() == PNG, 'saved cached image must retain original bytes'
            panel.locator('#select-all').uncheck()
            panel.locator('#format').select_option('original')
            panel.locator('#query').fill('cached.png')
            expect(panel.locator('.card')).to_have_count(1)
            panel.locator('#select-all').check()
            panel.locator('#query').fill('missing.png')
            expect(panel.locator('.card')).to_have_count(1)
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
            expect(panel.locator('#frame-count')).to_have_text('2 个框架')
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
            expect(panel.locator('#frame-count')).to_have_text('2 个框架')
            expect(panel.locator('.card .image-url').filter(has_text='cached.png')).to_have_count(0)
            source.goto(origin + '/other-page')
            source.evaluate('window.ready')
            source.wait_for_load_state('networkidle')
            panel.get_by_role('button', name='重新扫描页面', exact=True).click()
            expect(panel.locator('#frame-count')).to_have_text('2 个框架')
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
            expect(second_panel.locator('#frame-count')).to_have_text('2 个框架')
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
            expect(panel.locator('#frame-count')).to_have_text('2 个框架')
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
            expect(panel.locator('#frame-count')).to_have_text('2 个框架')
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
            test_preview_retries(context, worker, extension_id, origin, OUTPUT)
            test_notion_layout(panel, OUTPUT)
            assert not errors, errors

            # A navigated frame must never service an obsolete read by recycled frame ID.
            navigation_items = panel.evaluate('''async tabId => (await (await import('./api.js')).scanTab(tabId)).items''', tab_id)
            before_navigation = next(item for item in navigation_items if item['url'] == origin + '/cached.png')
            source.goto(origin + '/frame')
            stale = read(before_navigation)
            assert stale.get('method') != 'page-cache', stale
            print(json.dumps({'detected': len(items), 'cache': normal['method'], 'expired': expired['method'],
                              'crossOrigin': cross['method'], 'blob': 'original + revoked fallback',
                              'ui': 'filters, hidden selection, download complete, retry, layouts',
                              'screenshots': str(OUTPUT), 'pageErrors': errors}, ensure_ascii=False, indent=2))
        finally:
            context.close()
            for server in servers:
                server.shutdown()


if __name__ == '__main__':
    main()
