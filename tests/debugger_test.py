"""Exercise the actual chrome.debugger extension API, not a Playwright CDP substitute."""
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
from pathlib import Path
import random
import tempfile
from threading import Thread
from PIL import Image
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'test-results'
OUTPUT.mkdir(exist_ok=True)
rng = random.Random(17)
frames = [Image.frombytes('RGB', (96, 80), rng.randbytes(96*80*3)).convert('P') for _ in range(2)]
buffer = io.BytesIO()
frames[0].save(buffer, format='GIF', save_all=True, append_images=frames[1:], duration=120, loop=0)
GIF = buffer.getvalue()
counts = {}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        path = self.path.split('?')[0]
        counts[path] = counts.get(path, 0) + 1
        if path in ('/animated.gif','/frame.gif','/url-only.gif'):
            # Loaded resources become inaccessible over HTTP immediately.
            ok = counts[path] == 1 or path == '/url-only.gif'
            self.send_response(200 if ok else 403)
            self.send_header('Content-Type','image/gif' if ok else 'text/plain')
            self.send_header('Cache-Control','no-store')
            self.end_headers()
            self.wfile.write(GIF if ok else b'Expired')
            return
        if path == '/page':
            html = f'''<link rel="icon" href="data:,"><title>Debugger image test</title><img src="http://localhost:{self.server.other_port}/animated.gif"><iframe src="http://localhost:{self.server.other_port}/child"></iframe><script>window.ready=document.querySelector('img').decode()</script>'''
        elif path == '/child':
            html = '<img src="/frame.gif">'
        else:
            self.send_response(404);self.end_headers();return
        self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(html.encode())

servers = [ThreadingHTTPServer(('127.0.0.1',0),Handler) for _ in range(2)]
for index, server in enumerate(servers):
    server.other_port = servers[1-index].server_port
    Thread(target=server.serve_forever,daemon=True).start()
chrome = sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
try:
    with tempfile.TemporaryDirectory(prefix='imagetaken-debugger-') as profile,sync_playwright() as p:
        extension = str(ROOT/'extension')
        context = p.chromium.launch_persistent_context(profile,executable_path=str(chrome),channel='chromium',headless=True,locale='zh-CN',viewport={'width':1000,'height':1000},args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
        errors=[]
        context.on('page',lambda page: page.on('pageerror',lambda error:errors.append(str(error))))
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        extension_id = worker.url.split('/')[2]
        source=context.new_page();source.goto(f'http://127.0.0.1:{servers[0].server_port}/page');source.evaluate('window.ready');source.wait_for_load_state('networkidle')
        assert counts['/animated.gif']==1 and counts['/frame.gif']==1,counts
        tab_id=worker.evaluate('async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id',source.url)
        panel=context.new_page();panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
        expect(panel.locator('.page-context')).to_have_attribute('data-frames','2')
        expect(panel.locator('.preview-origin')).to_have_text(['浏览器资源','浏览器资源'])
        expect(panel.locator('.preview-origin:visible')).to_have_count(2)
        assert counts['/animated.gif']==1 and counts['/frame.gif']==1,counts
        originals=panel.evaluate('''async tabId=>{
          const api=await import('./api.js');
          const scan=await api.scanTab(tabId);
          const root=await navigator.storage.getDirectory();
          const output=[];
          for(const item of scan.items){
            const {blob,method}=await api.readImage(tabId,item);
            const result=await api.downloadImage(tabId,item,item.order,'original',{directory:root,folder:'test'});
            const saved=await(await root.getFileHandle(result.savedName)).getFile();
            output.push({url:item.url,method,downloadMethod:result.method,mime:blob.type,data:Array.from(new Uint8Array(await saved.arrayBuffer()))});
          }
          return output;
        }''',tab_id)
        assert len(originals)==2,originals
        for image in originals:
            assert image['method']==image['downloadMethod']=='debugger-resource',image
            assert bytes(image['data'])==GIF
            assert Image.open(io.BytesIO(bytes(image['data']))).n_frames==2
        assert counts['/animated.gif']==1 and counts['/frame.gif']==1,counts
        # Session ownership was released after the batch.
        worker.evaluate('''async tabId=>{await chrome.debugger.attach({tabId},'1.3');await chrome.debugger.detach({tabId});}''',tab_id)
        panel.locator('#select-all').check()
        panel.screenshot(path=str(OUTPUT/'debugger-resources.png'))
        # A URL absent from the page resource tree follows the ordinary reader.
        source.evaluate("""url=>{const a=document.createElement('a');a.href=url;document.body.append(a)}""",f'http://localhost:{servers[1].server_port}/url-only.gif')
        fallback=panel.evaluate('''async tabId=>{
          const api=await import('./api.js');const scan=await api.scanTab(tabId);
          const item=scan.items.find(item=>item.url.endsWith('/url-only.gif'));
          const {blob,method}=await api.readImage(tabId,item);return {method,size:blob.size};
        }''',tab_id)
        assert fallback['method']=='extension-fetch' and fallback['size']==len(GIF),fallback
        loaded_counts = {"animated":counts["/animated.gif"],"iframe":counts["/frame.gif"]}
        # An already attached debugger must remain attached after our attach fails.
        retained=panel.evaluate('async tabId=>(await(await import("./api.js")).scanTab(tabId)).items[0]',tab_id)
        worker.evaluate("async tabId=>chrome.debugger.attach({tabId},'1.3')",tab_id)
        busy=panel.evaluate("async ({tabId,item})=>(await(await import('./browser-resources.js')).browserResources(tabId,[item])).length",{'tabId':tab_id,'item':retained})
        assert busy==0,busy
        worker.evaluate("async tabId=>{await chrome.debugger.sendCommand({tabId},'Page.getResourceTree');await chrome.debugger.detach({tabId});}",tab_id)
        # Obsolete document IDs must not read a resource in a navigated document.
        stale=panel.evaluate('async tabId=>(await(await import("./api.js")).scanTab(tabId)).items[0]',tab_id)
        source.goto(f'http://127.0.0.1:{servers[0].server_port}/child')
        result=panel.evaluate('''async ({tabId,item})=>(await(await import('./browser-resources.js')).browserResources(tabId,[item])).length''',{'tabId':tab_id,'item':stale})
        assert result==0,result
        assert not errors,errors
        context.close()
        print({'cross_origin_originals':2,'animated_gif_bytes':len(GIF),'requests_for_loaded_images':loaded_counts,'fallback':fallback['method'],'session_released':True,'stale_documents_rejected':True})
finally:
    for server in servers:server.shutdown()
