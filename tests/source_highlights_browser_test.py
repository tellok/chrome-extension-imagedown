"""HB01–HB12: actual MV3 selection and source-page rendering in disposable profiles.

Run with .venv/bin/python; CHROMIUM_PATH selects an approved development browser.
No personal browser profile, external server or account is used.
"""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse
import io
import os
import tempfile
import time

from PIL import Image
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'test-results' / 'source-highlights'
OUTPUT.mkdir(parents=True, exist_ok=True)
COUNTS = {}
buffer = io.BytesIO()
Image.new('RGB', (180, 120), '#739d85').save(buffer, 'PNG')
PNG = buffer.getvalue() + b'\0' * 4096


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        path = urlparse(self.path).path
        COUNTS[path] = COUNTS.get(path, 0) + 1
        mime = 'text/html; charset=utf-8'
        if path.endswith('.png'):
            body, mime = PNG, 'image/png'
        elif path == '/frame':
            body = b'<title>Frame</title><img id="frame-image" src="/a.png" width="180" height="120">'
        else:
            other = f'http://localhost:{self.server.other_port}'
            body = f'''<!doctype html><meta charset="utf-8"><title>Source highlights</title>
            <link rel="icon" href="data:,">
            <style>
              body{{margin:24px;font-family:sans-serif}} img,canvas,svg,video{{width:180px;height:120px}}
              .row{{display:flex;gap:24px;margin-bottom:24px}} #alpha{{border:3px solid blue;outline:1px dashed green}}
              #background,#pseudo,#image-link{{display:block;width:180px;height:120px}}
              #background{{background-image:url('/background.png')}} #pseudo::before{{content:url('/pseudo.png')}}
              iframe{{width:260px;height:170px}} #spacer{{height:1100px}}
            </style>
            <div class="row"><a id="alpha-link" href="#clicked"><img id="alpha" src="/a.png" alt="alpha original"></a>
              <img id="bravo" src="/b.png"><img id="charlie" src="/c.png"></div>
            <div class="row"><img id="twin" src="/a.png"><div id="shadow"></div>
              <picture><source id="picture-source" srcset="/responsive.png 1x, /alternate.png 2x"><img id="responsive" src="/responsive.png"></picture></div>
            <div class="row"><div id="background"></div><div id="pseudo"></div><canvas id="canvas" width="180" height="120"></canvas></div>
            <div class="row"><svg id="inline-svg" width="180" height="120"><rect width="180" height="120" fill="orange"/></svg>
              <video id="poster" poster="/poster.png"></video><a id="image-link" href="/linked.png">Image link</a></div>
            <iframe src="{other}/frame"></iframe><div id="spacer"></div>
            <script>
              document.querySelector('#shadow').attachShadow({{mode:'open'}}).innerHTML='<img id="shadow-image" src="/a.png" width="180" height="120">';
              const canvas=document.querySelector('canvas');canvas.getContext('2d').fillRect(0,0,180,120);
              document.querySelector('#alpha-link').addEventListener('click',e=>{{e.preventDefault();window.clicks=(window.clicks||0)+1}});
              window.ready=fetch('/resource.png').then(r=>r.arrayBuffer());
            </script>'''.encode()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


class Session:
    def __init__(self, context, worker, origin, errors):
        self.context, self.worker, self.origin, self.errors = context, worker, origin, errors
        self.extension_id = worker.url.split('/')[2]
        worker.evaluate("()=>{globalThis.__highlightErrors=[];addEventListener('unhandledrejection',e=>__highlightErrors.push(String(e.reason)))}")
        worker.evaluate("()=>chrome.storage.local.set({'settings:chrome-sync':false,'filters:site:v1:127.0.0.1:width':0,'filters:site:v1:127.0.0.1:height':0,'filters:site:v1:127.0.0.1:minBytes':0})")
        self.source = context.new_page()
        self.source.goto(origin + '/fixture')
        self.source.evaluate('window.ready')
        self.source.wait_for_load_state('networkidle')
        self.tab_id = worker.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', self.source.url)
        self.panel = self.open_panel()

    def open_panel(self):
        page = self.context.new_page()
        page.goto(f'chrome-extension://{self.extension_id}/panel.html?tab={self.tab_id}')
        expect(page.locator('#refresh')).to_be_enabled()
        expect(page.locator('.card').first).to_be_visible()
        page.locator('#gallery img').evaluate_all("images=>images.forEach(image=>image.loading='eager')")
        page.wait_for_function("()=>[...document.querySelectorAll('.card')].every(c=>c.querySelector('img').complete&&(c.querySelector('img').naturalWidth>0||c.dataset.previewFailed==='true'))")
        return page

    def card(self, name, page=None):
        page = page or self.panel
        return page.locator('.card').filter(has=page.locator('.image-url', has_text=name)).first

    def script(self, func, args=None, document_id=None):
        # The function literal is trusted local test code, serialized by Chrome's
        # scripting API; no eval is injected into the page or extension.
        expression = """async ({tabId,args,documentId})=>{
          const target=documentId?{tabId,documentIds:[documentId]}:{tabId,frameIds:[0]};
          const result=await chrome.scripting.executeScript({target,func:""" + func + """,args:[args]});
          return result[0]?.result;
        }"""
        return self.worker.evaluate(expression, {'tabId':self.tab_id,'documentId':document_id,'args':args})

    def snapshot(self, document_id=None):
        return self.script("()=>globalThis.__imageTakenHighlights?.snapshot()||{sessions:0,active:false,host:false,rectangles:[]}", document_id=document_id)

    def wait_boxes(self, count, document_id=None, timeout=1):
        self.source.bring_to_front()
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            last = self.snapshot(document_id)
            if len(last['rectangles']) == count:
                return last
            self.source.wait_for_timeout(30)
        raise AssertionError({'expected': count, 'actual': last})

    def scan(self):
        return self.panel.evaluate('async id=>(await import("./api.js")).scanTab(id)', self.tab_id)['items']

    def select(self, name, selected=True, page=None):
        card = self.card(name, page)
        expect(card.locator('input')).to_be_enabled()
        card.locator('input').set_checked(selected)


@contextmanager
def session(playwright, origin):
    extension = str(ROOT / 'extension')
    with tempfile.TemporaryDirectory(prefix='imagetaken-source-highlights-') as profile:
        context = playwright.chromium.launch_persistent_context(
            profile, executable_path=os.environ.get('CHROMIUM_PATH') or None,
            channel='chromium', headless=True, locale='zh-CN', viewport={'width':1100,'height':900},
            args=[f'--disable-extensions-except={extension}', f'--load-extension={extension}'])
        errors = []
        context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
        try:
            worker = next((w for w in context.service_workers if w.url.endswith('/background.js')), None)
            if worker is None:
                worker = context.wait_for_event('serviceworker', predicate=lambda w:w.url.endswith('/background.js'))
            s = Session(context, worker, origin, errors)
            yield s
            assert errors == [], errors
            assert worker.evaluate('globalThis.__highlightErrors') == []
        finally:
            context.close()


def test_HB01_click_checkbox_and_keyboard_red_border(p, origin):
    with session(p, origin) as s:
        card = s.card('/a.png')
        card.locator('img').click()
        state = s.wait_boxes(3)
        assert all(r['border']=='2px' and r['color']=='rgb(255, 0, 0)' for r in state['rectangles'])
        s.source.screenshot(path=str(OUTPUT / 'HB01-red-border.png'))
        s.select('/a.png', False); s.wait_boxes(0)
        s.select('/a.png'); s.wait_boxes(3)
        card.locator('input').focus(); s.panel.keyboard.press('Space'); s.wait_boxes(0)


def test_HB02_multiple_select_all_and_deselect(p, origin):
    with session(p, origin) as s:
        s.select('/a.png'); s.select('/b.png'); s.wait_boxes(4)
        s.select('/b.png', False); s.wait_boxes(3)
        s.panel.locator('#select-all').check()
        s.source.bring_to_front()
        deadline = time.monotonic()+1
        while len(s.snapshot()['rectangles']) <= 4 and time.monotonic()<deadline:
            s.source.wait_for_timeout(30)
        assert len(s.snapshot()['rectangles']) > 4
        s.panel.locator('#select-all').uncheck(); state=s.wait_boxes(0)
        assert not state['active'] and not state['host']


def test_HB03_drag_toggle_and_escape_restore(p, origin):
    with session(p, origin) as s:
        s.panel.locator('#query').fill('.png')
        cards=s.panel.locator('.card'); expect(cards.nth(2)).to_be_visible()
        boxes=[cards.nth(i).bounding_box() for i in range(3)]
        a,b,c=boxes
        start=(a['x']+35,a['y']+55); end=(c['x']+c['width']/2,c['y']+95)
        s.panel.mouse.move(*start);s.panel.mouse.down();s.panel.mouse.move(*end,steps=8)
        expect(s.panel.locator('.card.selected')).to_have_count(3)
        s.panel.keyboard.press('Escape');s.panel.mouse.up();s.wait_boxes(0)
        s.panel.mouse.move(*start);s.panel.mouse.down();s.panel.mouse.move(*end,steps=8);s.panel.mouse.up()
        expect(s.panel.locator('.card.selected')).to_have_count(3)
        s.source.bring_to_front(); assert s.snapshot()['rectangles']
        s.panel.bring_to_front();s.panel.keyboard.down('Control')
        s.panel.mouse.move(b['x']+35,b['y']+50);s.panel.mouse.down();s.panel.mouse.move(b['x']+90,b['y']+95,steps=6);s.panel.mouse.up();s.panel.keyboard.up('Control')
        expect(s.panel.locator('.card.selected')).to_have_count(2)
        s.panel.locator('#select-all').check();s.panel.locator('#select-all').uncheck();s.wait_boxes(0)


def test_HB04_hidden_selection_and_automatic_deselection(p, origin):
    with session(p, origin) as s:
        s.select('/a.png');s.select('/b.png');s.wait_boxes(4)
        s.panel.locator('#query').fill('/b.png')
        expect(s.panel.locator('.card')).to_have_count(1)
        s.wait_boxes(4)
        s.panel.locator('#select-all').uncheck();s.wait_boxes(3)
        s.panel.locator('#query').fill('');s.select('/b.png')
        s.card('/b.png').locator('img').evaluate("e=>e.src='data:image/png;base64,AAAA'")
        expect(s.card('/b.png').locator('input')).to_be_disabled();s.wait_boxes(3)
        s.card('/a.png').locator('.ignore-image').click();s.wait_boxes(0)


def test_HB05_duplicate_urls_and_shared_elements(p, origin):
    with session(p, origin) as s:
        before=next(item for item in s.scan() if item['url'].endswith('/a.png'))
        s.select('/a.png');s.wait_boxes(3)
        assert before['originalTitle']=='alpha original'
        s.select('/responsive.png');s.select('/alternate.png');s.wait_boxes(4)
        s.select('/responsive.png',False);s.wait_boxes(4)
        s.select('/alternate.png',False);s.wait_boxes(3)
        assert len([item for item in s.scan() if item['url'].endswith('/a.png')])==1
        assert before['sourceReference']=='img#alpha'


def test_HB06_open_shadow_and_cross_origin_iframe(p, origin):
    with session(p, origin) as s:
        items=s.scan();item=next(item for item in items if item['url'].endswith('/a.png'))
        top=s.worker.evaluate('''async id=>(await chrome.scripting.executeScript({target:{tabId:id,frameIds:[0]},func:()=>true}))[0].documentId''',s.tab_id)
        frame=next(o['documentId'] for o in item['origins'] if o['documentId']!=top)
        s.select('/a.png');s.wait_boxes(3);s.wait_boxes(1,frame)
        s.source.screenshot(path=str(OUTPUT/'HB06-shadow-and-frame.png'),full_page=True)
        # Reject one exact document through the browser API, keeping other frames untouched.
        s.worker.evaluate('''documentId=>{globalThis.__originalHighlightExecute=chrome.scripting.executeScript;chrome.scripting.executeScript=options=>options.target.documentIds?.includes(documentId)?Promise.reject(new Error('Test fixture: document access denied')):__originalHighlightExecute.call(chrome.scripting,options)}''',frame)
        try:
            s.select('/a.png',False);s.select('/b.png');s.wait_boxes(1)
            expect(s.card('/b.png').locator('input')).to_be_checked()
        finally:
            s.worker.evaluate('()=>{chrome.scripting.executeScript=__originalHighlightExecute}')


def test_HB07_picture_and_non_img_source_mapping(p, origin):
    with session(p, origin) as s:
        for name in ['/responsive.png','/alternate.png','/background.png','/pseudo.png','/poster.png','/linked.png']:
            s.select(name)
        canvas=s.panel.locator('.card').filter(has=s.panel.locator('.image-url',has_text='__imagetaken_canvas_')).first
        canvas.locator('input').check()
        svg=s.panel.locator('.card').filter(has=s.panel.locator('.image-url',has_text='data:')).first
        svg.locator('input').check()
        s.wait_boxes(7)
        s.select('/resource.png');s.wait_boxes(7)
        s.panel.locator('#select-all').check();s.panel.locator('#select-all').uncheck();s.wait_boxes(0)


def test_HB08_geometry_style_and_pointer_preservation(p, origin):
    with session(p, origin) as s:
        before=s.source.locator('#alpha').evaluate("e=>({style:e.getAttribute('style'),border:getComputedStyle(e).border,outline:getComputedStyle(e).outline,html:e.parentElement.innerHTML,rect:e.getBoundingClientRect().toJSON(),next:document.querySelector('#bravo').getBoundingClientRect().toJSON()})")
        s.select('/a.png');state=s.wait_boxes(3)
        for rectangle in state['rectangles']:
            assert rectangle['pointerEvents']=='none'
        assert s.source.locator('#alpha').bounding_box()=={k:before['rect'][k] for k in ['x','y','width','height']}
        assert s.source.locator('#bravo').bounding_box()=={k:before['next'][k] for k in ['x','y','width','height']}
        s.source.locator('#alpha').click();assert s.source.evaluate('window.clicks')==1
        s.source.locator('#alpha-link').focus();s.source.keyboard.press('Enter');assert s.source.evaluate('window.clicks')==2
        s.source.set_viewport_size({'width':900,'height':700})
        s.source.evaluate("()=>{document.querySelector('#alpha').style.transform='translate(15px, 30px)';scrollTo(0,60)}")
        s.source.wait_for_timeout(100)
        rect=s.source.locator('#alpha').bounding_box();state=s.snapshot()
        assert any(all(abs(r[k]-rect[k])<1 for k in ['x','y','width','height']) for r in state['rectangles'])
        s.source.screenshot(path=str(OUTPUT/'HB08-scrolled.png'))
        s.source.locator('#alpha').evaluate("e=>e.removeAttribute('style')")
        s.select('/a.png',False);s.wait_boxes(0)
        after=s.source.locator('#alpha').evaluate("e=>({style:e.getAttribute('style'),border:getComputedStyle(e).border,outline:getComputedStyle(e).outline,html:e.parentElement.innerHTML})")
        assert after=={key:before[key] for key in after}


def test_HB09_hidden_removed_and_replaced_targets(p, origin):
    with session(p, origin) as s:
        s.select('/a.png');s.wait_boxes(3)
        s.source.locator('#alpha').evaluate("e=>e.style.display='none'");s.wait_boxes(2)
        s.source.locator('#twin').evaluate('e=>e.remove()');s.wait_boxes(1)
        s.source.locator('#shadow').evaluate("e=>e.shadowRoot.querySelector('img').src='/replacement.png'");s.wait_boxes(0)
        s.source.locator('#alpha').evaluate("e=>{e.style.display='';e.src='/replacement.png'}");s.wait_boxes(0)
        s.panel.locator('#refresh').click();expect(s.panel.locator('#refresh')).to_be_enabled()
        s.select('/replacement.png');s.wait_boxes(2)


def test_HB10_refresh_navigation_and_stale_updates(p, origin):
    with session(p, origin) as s:
        s.select('/a.png');s.wait_boxes(3)
        old=s.scan()[0]['origins'][0]['documentId']
        s.panel.locator('#refresh').click();expect(s.panel.locator('#refresh')).to_be_enabled();s.wait_boxes(0)
        s.select('/a.png');s.wait_boxes(3)
        s.source.goto(origin+'/next');expect(s.panel.locator('.card.selected')).to_have_count(0)
        expect(s.panel.locator('#refresh')).to_be_enabled();s.wait_boxes(0)
        result=s.worker.evaluate('''async ({tabId,documentId})=>{try{await chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},func:()=>globalThis.__imageTakenHighlights?.receive({session:'stale',sequence:999,operation:'update',ids:['1:0']})});return true}catch{return false}}''',{'tabId':s.tab_id,'documentId':old})
        assert not result
        s.select('/b.png');s.wait_boxes(1)
        # A structural rules update must rebind origins rather than dropping a valid selection.
        s.worker.evaluate("()=>chrome.storage.local.set({'excluded-selectors:v1:127.0.0.1':'#twin'})")
        expect(s.panel.locator('#excluded-selectors')).to_have_value('#twin');s.wait_boxes(1)


def test_HB11_multiple_views_close_and_connection_expiry(p, origin):
    with session(p, origin) as s:
        s.select('/a.png');s.wait_boxes(3)
        second=s.open_panel();s.select('/a.png',page=second);s.wait_boxes(3)
        for _ in range(4):
            second.locator('#refresh').click();expect(second.locator('#refresh')).to_be_enabled()
        s.wait_boxes(3)
        s.select('/a.png',page=second);s.wait_boxes(3)
        s.panel.close();s.wait_boxes(3)
        second.close();state=s.wait_boxes(0);assert not state['host'] and not state['active']
        s.panel=s.open_panel();s.select('/b.png');s.wait_boxes(1)
        s.worker.evaluate('''()=>{globalThis.__originalHighlightExecute=chrome.scripting.executeScript;chrome.scripting.executeScript=options=>options.args?.[0]?.operation==='renew'?Promise.resolve([{result:true}]):__originalHighlightExecute.call(chrome.scripting,options)}''')
        try:
            state=s.wait_boxes(0,timeout=17)
            assert not state['host'] and not state['active']
        finally:
            s.worker.evaluate('()=>{chrome.scripting.executeScript=__originalHighlightExecute}')


def test_HB12_badge_observer_requests_and_runtime_errors(p, origin):
    with session(p, origin) as s:
        s.source.wait_for_timeout(1200)
        s.script("()=>{globalThis.__highlightProbe={scans:0,pixels:0};const scan=__imageTaken.scan;__imageTaken.scan=(...args)=>{__highlightProbe.scans++;return scan(...args)};const pixels=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(...args){__highlightProbe.pixels++;return pixels.apply(this,args)}}")
        s.worker.evaluate("()=>{globalThis.__highlightAttaches=0;const attach=chrome.debugger.attach;chrome.debugger.attach=(...args)=>{__highlightAttaches++;return attach.apply(chrome.debugger,args)}}")
        requests=dict(COUNTS)
        for _ in range(3):
            s.select('/a.png');s.wait_boxes(3);s.select('/a.png',False);s.wait_boxes(0)
        s.select('/a.png');s.wait_boxes(3);s.source.wait_for_timeout(1200)
        assert s.script('()=>__highlightProbe')=={'scans':0,'pixels':0}
        assert s.worker.evaluate('__highlightAttaches')==0
        assert COUNTS==requests
        before=s.worker.evaluate('id=>chrome.action.getBadgeText({tabId:id})',s.tab_id)
        s.source.evaluate("()=>{const img=new Image();img.id='new-badge-image';img.src='/new-badge.png';document.body.append(img)}")
        deadline=time.monotonic()+8
        while time.monotonic()<deadline and s.worker.evaluate('id=>chrome.action.getBadgeText({tabId:id})',s.tab_id)==before:
            s.source.wait_for_timeout(100)
        assert s.worker.evaluate('id=>chrome.action.getBadgeText({tabId:id})',s.tab_id)!=before
        assert s.script('()=>__highlightProbe.scans')>0
        s.source.locator('#new-badge-image').evaluate('e=>e.remove()')


def main():
    servers=[ThreadingHTTPServer(('127.0.0.1',0),Handler) for _ in range(2)]
    for i,server in enumerate(servers):
        server.other_port=servers[1-i].server_port
        Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{servers[0].server_port}'
    try:
        with sync_playwright() as p:
            cases=[(name,case) for name,case in globals().items() if name.startswith('test_HB')]
            assert len(cases)==12
            for name,case in cases:
                COUNTS.clear();case(p,origin);print('PASS '+name,flush=True)
            print('12 source highlight browser scenarios passed',flush=True)
    finally:
        for server in servers:
            server.shutdown();server.server_close()


if __name__=='__main__':
    main()
