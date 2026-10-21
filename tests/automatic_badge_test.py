"""Real extension badge updates without ever opening its UI first."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread, Event
import tempfile
import time
from playwright.sync_api import sync_playwright, expect
from browser_test import PNG, SMALL

ROOT = Path(__file__).resolve().parents[1]
counts = {}
release_slow = Event()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/slow-script.js':
            release_slow.wait(30)
            self.send_response(200); self.send_header('Content-Type', 'text/javascript'); self.end_headers(); return
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
        elif path == '/slow-page': html = '<link rel="icon" href="data:,"><img src="/slow-image.png"><script async src="/slow-script.js"></script>'
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
        # Every configured exclusion applies before a panel is opened.
        worker.evaluate("chrome.storage.local.set({'excluded-selectors:v1:127.0.0.1':'img[src=\"/one.png\"]'})")
        badge('3')
        worker.evaluate("chrome.storage.local.set({'image-query:v1:127.0.0.1':'shadow.png'})")
        badge('1')
        worker.evaluate("chrome.storage.local.remove(['excluded-selectors:v1:127.0.0.1','image-query:v1:127.0.0.1'])")
        badge('4')
        one_hash=worker.evaluate('''async tabId=>{
          const [{result}] = await chrome.scripting.executeScript({target:{tabId},func:()=>__imageTaken.scan('','',true).items.find(i=>i.url.endsWith('/one.png'))});
          const metadata=JSON.stringify({v:1,kind:'url',resource:new URL(result.url).href});
          const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(metadata));
          return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
        }''',tab_id)
        worker.evaluate("hash=>chrome.storage.local.set({'ignored:v1:127.0.0.1':[hash]})",one_hash)
        badge('3')
        worker.evaluate("chrome.storage.local.set({'filters:width':1000})"); badge('0')
        worker.evaluate("chrome.storage.local.set({'filters:width':50})"); badge('3')
        second = context.new_page(); second.goto(origin.replace('127.0.0.1','localhost')+'/new')
        second_id = worker.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', second.url)
        badge('1',second_id)
        threshold_requests = dict(counts)
        worker.evaluate("chrome.storage.local.set({'filters:site:v1:127.0.0.1:width':1000})"); badge('0'); badge('1',second_id)
        worker.evaluate("chrome.storage.local.set({'filters:width':1000})"); badge('0'); badge('0',second_id)
        worker.evaluate("chrome.storage.local.set({'filters:width':50})"); badge('0'); badge('1',second_id)
        worker.evaluate("chrome.storage.local.remove('filters:site:v1:127.0.0.1:width')"); badge('3')
        assert counts == threshold_requests, 'threshold changes requested images'
        second.close()

        worker.evaluate("chrome.storage.local.remove('ignored:v1:127.0.0.1')"); badge('4')
        source.wait_for_timeout(1000)
        worker.evaluate('''async tabId=>{
          globalThis.badgeWrites=[];
          const original=chrome.action.setBadgeText;
          chrome.action.setBadgeText=function(options){badgeWrites.push(options);return original.call(this,options)};
          await chrome.scripting.executeScript({target:{tabId},func:()=>{
            globalThis.passiveBadgeScans=0;const original=__imageTaken.scan;
            __imageTaken.scan=function(...args){if(args[2]) passiveBadgeScans++;return original.apply(this,args)};
          }});
        }''',tab_id)
        # Opening/reloading the view cannot reset or recount the source badge.
        extension_id = worker.url.split('/')[2]
        panel = context.new_page(); panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
        expect(panel.locator('.page-context')).to_have_attribute('data-frames','2')
        panel.wait_for_timeout(1000); badge('4')
        panel_id=panel.evaluate('async ()=>(await chrome.tabs.getCurrent()).id')
        badge('4',panel_id)
        assert worker.evaluate('id=>badgeWrites.filter(write=>write.tabId===id).every(write=>write.text==="4")',tab_id), 'opening a view reset the badge'
        assert worker.evaluate('''async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:()=>passiveBadgeScans}))[0].result''',tab_id)==0, 'opening a view rescanned the page badge'
        # Filter-only changes reuse the existing page snapshot.
        panel.locator('#type').select_option('gif', force=True); badge('0')
        assert worker.evaluate('''async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:()=>passiveBadgeScans}))[0].result''',tab_id)==0
        panel.close(); badge('0')
        panel=context.new_page();panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
        expect(panel.locator('#type')).to_have_value('gif');badge('0')
        panel.locator('#type').select_option('',force=True);badge('4')
        panel.locator('#source').select_option('lazy',force=True);badge('1')
        panel.locator('#source').select_option('',force=True);badge('4')
        source.evaluate("document.querySelector('#main').insertAdjacentHTML('beforeend','<img src=\"/extra.png\">')")
        badge('5');panel.close();badge('5')
        source.goto(origin+'/slow-page',wait_until='domcontentloaded'); badge('1')
        assert worker.evaluate('id=>chrome.tabs.get(id).then(t=>t.status)',tab_id)=='loading', 'count must appear before the slow subresource finishes'
        assert worker.evaluate('id=>__imageTakenBadgeDiagnostics.get(id).state',tab_id)=='counted'
        release_slow.set()
        source.goto(origin+'/new'); badge('1')
        print('Automatic pre-open badge, loaded-only counts, URL deduplication, lazy images, removal, shadow DOM, cross-origin iframe, XPath/CSS/search/ignore/size/type/source filters, stable open/reopen counts, cached filtering, navigation and zero extra image requests: OK')
        context.close()
finally:
    release_slow.set()
    server.shutdown()
