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
DATA = 'data:image/png;base64,' + base64.b64encode(SMALL).decode()
COUNTS = {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = urlparse(self.path).path
        origin = f'http://127.0.0.1:{self.server.server_port}'
        other = f'http://127.0.0.1:{self.server.other_port}'
        if path == '/fixture':
            html = f'''<!doctype html><title>ImageDown 测试图片集</title>
            <style>body{{font-family:system-ui}}img,canvas{{max-width:200px}} .bg{{height:80px;background:url('/background.png')}}
            .pseudo::before{{content:url('/pseudo.png')}}</style>
            <h1>Page resources</h1>
            <img src="/cached.png" alt="cached landscape"><img src="/once.png" alt="expired source">
            <img src="{other}/cross.png" alt="cross origin"><img src="{other}/denied.png" alt="protected image">
            <img src="/auth.png" alt="session image"><img src="/missing.png" alt="broken candidate">
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
        self.wfile.write(SMALL if path in ('/small.png', '/pseudo.png') else PNG)


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
