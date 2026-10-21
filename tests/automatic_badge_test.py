"""Real extension badge updates without ever opening its UI first."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import tempfile
import time
from playwright.sync_api import sync_playwright, expect
from browser_test import PNG, SMALL

ROOT = Path(__file__).resolve().parents[1]
counts = {}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        path = self.path.split('?')[0]
        if path.endswith('.png'):
            counts[path] = counts.get(path, 0) + 1
            self.send_response(404 if path == '/broken.png' else 200)
            self.send_header('Content-Type', 'text/plain' if path == '/broken.png' else 'image/png')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(SMALL if path == '/small.png' else b'broken' if path == '/broken.png' else PNG)
            return
        self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers()
        if path == '/page':
            html = f'''<link rel="icon" href="data:,"><title>Automatic badge</title>
            <div id="main"><img src="/one.png"><img src="/one.png"><img src="/two.png">
            <img src="/broken.png"><img src="/small.png"><img data-src="/lazy.png"></div>
            <iframe src="http://localhost:{self.server.server_port}/frame"></iframe>'''
        elif path == '/frame': html = '<img src="/frame.png">'
        else: html = '<link rel="icon" href="data:,"><img src="/new.png">'
        self.wfile.write(html.encode())

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
chrome = sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
try:
    with tempfile.TemporaryDirectory(prefix='imagetaken-auto-badge-') as profile, sync_playwright() as p:
        extension = str(ROOT/'extension')
        context = p.chromium.launch_persistent_context(profile, executable_path=str(chrome), channel='chromium', headless=True,
            locale='zh-CN', args=[f'--disable-extensions-except={extension}', f'--load-extension={extension}'])
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate('''() => { globalThis.debuggerReads=0; chrome.runtime.onMessage.addListener(m=>{if(m.type==='read-browser-resources') globalThis.debuggerReads++;}); }''')
        source = context.new_page(); source.goto(origin+'/page'); source.wait_for_load_state('networkidle')
        tab_id = worker.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', source.url)
        def badge(value, tab=tab_id):
            deadline = time.monotonic()+15
            while time.monotonic()<deadline:
                if worker.evaluate('id=>chrome.action.getBadgeText({tabId:id})',tab)==value: return
                source.wait_for_timeout(100)
            raise AssertionError({'expected':value,'actual':worker.evaluate('id=>chrome.action.getBadgeText({tabId:id})',tab)})
        badge('3')  # Deduplicated, loaded, threshold-matching images, including iframe.
        before = dict(counts)
        source.wait_for_timeout(1200)
        assert counts == before, (before,counts)
        assert worker.evaluate('globalThis.debuggerReads') == 0
        source.evaluate("""() => {const img=new Image(); img.src='/lazy.png';document.querySelector('#main').append(img)}""")
        badge('4')
        source.evaluate("document.querySelector('img[src=\"/two.png\"]').remove()")
        badge('3')
        # Passive scans must preserve a view's existing collector read references.
        source.evaluate("""() => {const host=document.createElement('div');host.id='shadow';host.attachShadow({mode:'open'}).innerHTML='<img src="/shadow.png">';document.body.append(host)}""")
        badge('4')
        worker.evaluate("chrome.storage.local.set({'xpath:v1:127.0.0.1':'//*[@id=\"main\"]'})")
        badge('2')
        worker.evaluate("chrome.storage.local.remove('xpath:v1:127.0.0.1')")
        badge('4')
        assert worker.evaluate('''async tabId => {
          const [result] = await chrome.scripting.executeScript({target:{tabId},func:()=>{
            const item=__imageTaken.scan().items.find(item=>item.loaded);
            const original=HTMLCanvasElement.prototype.toDataURL;
            let exports=0;
            HTMLCanvasElement.prototype.toDataURL=function(...args){exports++;return original.apply(this,args)};
            try {for(let i=0;i<7;i++) __imageTaken.scan('','',true);}
            finally {HTMLCanvasElement.prototype.toDataURL=original;}
            return exports===0 && __imageTaken.resource(item.id)?.url===item.url;
          }});return result.result;
        }''',tab_id), 'passive scans exported pixels or invalidated existing read references'
        # Panel owns transient filtered counts; closed panels release ownership.
        extension_id = worker.url.split('/')[2]
        panel = context.new_page(); panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
        expect(panel.locator('.card')).not_to_have_count(0)
        panel.locator('#type').select_option('gif', force=True); badge('0')
        source.evaluate("document.querySelector('#main').insertAdjacentHTML('beforeend','<img src=\"/extra.png\">')")
        source.wait_for_timeout(1600); badge('0')
        panel.close(); badge('5')
        source.goto(origin+'/new'); badge('1')
        print('Automatic pre-open badge, loaded-only counts, URL deduplication, lazy images, removal, shadow DOM, cross-origin iframe, XPath, panel ownership, navigation and zero extra image requests: OK')
        context.close()
finally:
    server.shutdown()
