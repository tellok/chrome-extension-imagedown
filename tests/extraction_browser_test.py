"""Approved EB01–EB15: actual extension APIs in disposable Chrome profiles."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread, Event
import io
import json
import os
import random
import shutil
import tempfile
import time
from PIL import Image
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'test-results' / 'extraction'
OUTPUT.mkdir(parents=True, exist_ok=True)
buf = io.BytesIO()
rng=random.Random(23)
Image.frombytes('RGB', (96,80), rng.randbytes(96*80*3)).save(buf,'GIF',save_all=True,append_images=[Image.frombytes('RGB',(96,80),rng.randbytes(96*80*3))],duration=120,loop=0)
GIF = buf.getvalue()
LOG = []
SLOW = Event()
ORIGIN = ''
IMAGE_ORIGIN = ''

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        LOG.append((self.path, self.headers.get('Referer'), self.headers.get('Cookie')))
        path = self.path.split('?')[0]
        body, mime, status = b'', 'text/html;charset=utf-8', 200
        if path == '/empty': body = b'<title>Empty</title><link rel="icon" href="data:,">'
        elif path == '/page': body = b'<title>Extraction</title><link rel="icon" href="data:,"><img id="keep" src="/keep.gif"><img id="hidden" src="/hidden.gif">'
        elif path == '/links': body = f'<title>Links</title><a href="{IMAGE_ORIGIN}/page-ref.gif?signature=a%2Bb">page</a><a href="{IMAGE_ORIGIN}/image-ref.gif">image</a><img src="{IMAGE_ORIGIN}/127.0.0.1.json">'.encode()
        elif path == '/frames': body = f'<title>Frames</title><img src="/same.gif"><iframe src="{IMAGE_ORIGIN}/frame"></iframe>'.encode()
        elif path == '/frame': body = f'<img src="{ORIGIN}/same.gif"><img src="/frame.gif">'.encode()
        elif path == '/slow-page': body = b'<title>Slow</title><img src="/slow.gif">'
        elif path == '/slow.gif':
            self.send_response(200); self.send_header('Content-Type','image/gif'); self.send_header('Content-Length', str(len(GIF))); self.end_headers()
            try: self.wfile.write(GIF[:24]); self.wfile.flush(); SLOW.wait(8); self.wfile.write(GIF[24:])
            except (BrokenPipeError, ConnectionResetError): pass
            return
        elif path.endswith('.gif'):
            mime, body = 'image/gif', GIF
            if path == '/page-ref.gif' and self.headers.get('Referer') != ORIGIN + '/': status, body = 403, b'denied'
            if path == '/image-ref.gif' and self.headers.get('Referer') != IMAGE_ORIGIN + '/': status, body = 403, b'denied'
        elif path == '/127.0.0.1.json':
            if self.headers.get('Referer') and self.headers.get('Sec-Fetch-Dest') != 'image': mime, body = 'image/gif', GIF
            else: mime, body = 'application/json', json.dumps({'version':1,'rules':[{'match':'.*','options':{}}]}).encode()
        else: status, body = 404, b'missing'
        self.send_response(status); self.send_header('Content-Type', mime); self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control','no-store'); self.end_headers()
        try: self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError): pass

@contextmanager
def session(p, path='/page', origin=None, archive=True, wait='networkidle', detach_fixture=False):
    with tempfile.TemporaryDirectory(prefix='imagetaken-extraction-') as profile:
        candidates = sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        chrome = os.environ.get('CHROMIUM_PATH') or (str(candidates[-1]) if candidates else None)
        extension = str(ROOT/'extension')
        if detach_fixture:
            fixture=Path(profile)/'extension';shutil.copytree(ROOT/'extension',fixture)
            (fixture/'detach-fixture.js').write_text("const add=chrome.debugger.onDetach.addListener.bind(chrome.debugger.onDetach);globalThis.detachListeners=[];chrome.debugger.onDetach.addListener=listener=>{detachListeners.push(listener);add(listener)};")
            background=fixture/'background.js';background.write_text("import './detach-fixture.js';\n"+background.read_text());extension=str(fixture)
        context = p.chromium.launch_persistent_context(profile, executable_path=chrome, channel='chromium', headless=True, locale='zh-CN', viewport={'width':900,'height':950}, args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
        errors=[]; context.on('page',lambda page:page.on('pageerror',lambda error:errors.append(str(error))))
        worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate('''() => {
          globalThis.attachCount=0;globalThis.fetchCount=0;globalThis.archiveCompleted=0;
          const attach=chrome.debugger.attach;chrome.debugger.attach=(...args)=>{attachCount++;return attach(...args)};
          const native=fetch;globalThis.fetch=(...args)=>{fetchCount++;return native(...args)};
          chrome.runtime.onConnect.addListener(port=>{if(port.name==='image-extraction')port.onMessage.addListener(m=>{if(m.type==='captured')archiveCompleted++})});
        }''')
        context.add_init_script('''if(location.protocol==='chrome-extension:'){
          globalThis.captureCount=0;const save=chrome.pageCapture.saveAsMHTML;
          chrome.pageCapture.saveAsMHTML=(...args)=>{captureCount++;return save(...args)};
        }''')
        if not archive: context.add_init_script("if(location.protocol==='chrome-extension:')chrome.pageCapture.saveAsMHTML=()=>Promise.reject(new Error('Controlled archive unavailable'))")
        source=context.new_page(); source.goto((origin or ORIGIN)+path,wait_until=wait)
        tab=worker.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',source.url)
        extension_id=worker.url.split('/')[2]
        panel=context.new_page(); panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab}')
        expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2' if path=='/frames' else '1',timeout=30000)
        s=type('Session',(),{})();s.context=context;s.worker=worker;s.source=source;s.panel=panel;s.tab=tab;s.extension_id=extension_id;s.errors=errors
        s.scan=lambda:panel.evaluate('async id=>(await(await import("./api.js")).scanTab(id)).items',tab)
        s.read=lambda suffix:panel.evaluate('''async({id,suffix})=>{
          const api=await import('./api.js');const item=(await api.scanTab(id)).items.find(i=>i.url.includes(suffix));
          if(!item)throw new Error('Missing candidate '+suffix);
          const {blob,method}=await api.readImage(id,item);return {method,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))};
        }''',{'id':tab,'suffix':suffix})
        try: yield s
        finally:
            context.close()

def enable(s):
    s.worker.evaluate("chrome.storage.local.set({'enhanced-mode:v1:127.0.0.1':true})")
    expect(s.panel.locator('#enhanced-disable')).to_be_visible()

def settings(s):
    with s.context.expect_page() as opened: s.panel.locator('#enhanced-settings-link').click()
    page=opened.value;expect(page.locator('#enhanced-mode')).to_be_enabled();return page

def test_EB01(p):
    with session(p) as s:
        result=s.read('keep.gif'); assert result['method']=='mhtml-resource' and bytes(result['bytes'])==GIF
        assert Image.open(io.BytesIO(bytes(result['bytes']))).n_frames==2
        assert s.worker.evaluate('attachCount')==0
        assert all(item.get('browserMethod')=='mhtml-resource' for item in s.scan())

def test_EB02(p):
    with session(p,'/links',archive=False) as s:
        start=len(LOG); result=s.read('page-ref.gif')
        assert result['method']=='page-referer-fetch' and bytes(result['bytes'])==GIF
        rows=[row for row in LOG[start:] if row[0].startswith('/page-ref.gif')]
        assert [row[1] for row in rows]==[None,ORIGIN+'/'],rows
        assert all(row[0]=='/page-ref.gif?signature=a%2Bb' for row in rows)

def test_EB03(p):
    with session(p,'/links',archive=False) as s:
        start=len(LOG); result=s.read('image-ref.gif')
        assert result['method']=='image-referer-fetch' and bytes(result['bytes'])==GIF
        assert [row[1] for row in LOG[start:] if row[0]=='/image-ref.gif']==[None,ORIGIN+'/',IMAGE_ORIGIN+'/']

def test_EB04(p):
    with session(p,'/links',archive=False) as s:
        other=s.context.new_page(); other.goto(IMAGE_ORIGIN+'/links');tab=s.worker.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',other.url)
        second=s.context.new_page();second.goto(f'chrome-extension://{s.extension_id}/panel.html?tab={tab}');expect(second.locator('.page-context')).to_have_attribute('data-frames','1')
        s.panel.evaluate('''async id=>{const api=await import('./api.js');window.shared=(await api.scanTab(id)).items.find(i=>i.url.endsWith('/127.0.0.1.json'))}''',s.tab)
        second.evaluate('''async id=>{const api=await import('./api.js');window.shared=(await api.scanTab(id)).items.find(i=>i.url.endsWith('/127.0.0.1.json'))}''',tab)
        start=len(LOG)
        s.panel.evaluate('''id=>{window.concurrentRead=import('./api.js').then(api=>api.readImage(id,shared)).then(r=>r.method)}''',s.tab)
        second.evaluate('''id=>{window.concurrentRead=import('./api.js').then(api=>api.readImage(id,shared)).then(r=>r.method)}''',tab)
        subscription=s.panel.evaluate('''url=>chrome.runtime.sendMessage({type:'remote-rules',operation:'add',url})''',IMAGE_ORIGIN+'/127.0.0.1.json')
        assert subscription['ok'],subscription
        assert s.panel.evaluate('concurrentRead')=='page-referer-fetch'
        assert second.evaluate('concurrentRead')=='page-referer-fetch'
        rows=[row for row in LOG[start:] if row[0]=='/127.0.0.1.json']
        assert sorted(row[1] or '' for row in rows)==sorted(['',ORIGIN+'/', '',IMAGE_ORIGIN+'/', '']),rows
        assert s.worker.evaluate('chrome.declarativeNetRequest.getSessionRules()')==[]

def test_EB05(p):
    with session(p,'/links',archive=False) as s:
        s.worker.evaluate('''chrome.declarativeNetRequest.updateSessionRules({addRules:[710000,20].map(id=>({id,priority:1,action:{type:'block'},condition:{urlFilter:'never-match-extraction-fixture'}}))})''')
        cdp=s.context.new_cdp_session(s.source);cdp.send('ServiceWorker.enable');cdp.send('ServiceWorker.stopAllWorkers')
        s.panel.reload();expect(s.panel.locator('.page-context')).to_have_attribute('data-frames','1',timeout=30000)
        assert s.read('page-ref.gif')['method']=='page-referer-fetch'
        ids=s.panel.evaluate('async()=>(await chrome.declarativeNetRequest.getSessionRules()).map(r=>r.id)');assert ids==[20],ids

def test_EB06(p):
    with session(p) as s:
        before=s.panel.evaluate('captureCount')
        second=s.context.new_page();second.goto(f'chrome-extension://{s.extension_id}/panel.html?tab={s.tab}');expect(second.locator('.page-context')).to_have_attribute('data-frames','1')
        assert s.panel.evaluate('captureCount')+second.evaluate('captureCount')==before
        s.source.evaluate("document.body.insertAdjacentHTML('beforeend','<img src=\"/new.gif\">')")
        expect(s.panel.locator('.card')).to_have_count(3,timeout=15000)
        expect(second.locator('.card')).to_have_count(3,timeout=15000)
        assert s.panel.evaluate('captureCount')+second.evaluate('captureCount')<=before+2
        assert s.worker.evaluate('attachCount')==0

def test_EB07(p):
    SLOW.clear()
    try:
        with session(p,'/slow-page',wait='domcontentloaded') as s:
            item=s.scan()[0]; assert not item.get('browserData'),item
            SLOW.set();s.source.wait_for_load_state('networkidle')
            s.panel.wait_for_function("() => document.querySelector('#gallery .preview-origin')?.textContent==='归档资源'",timeout=15000)
            assert bytes(s.read('slow.gif')['bytes'])==GIF
            s.panel.evaluate('''id=>{chrome.pageCapture.saveAsMHTML=async()=>{await new Promise(r=>setTimeout(r,500));throw Error('changed')};window.late=import('./api.js').then(api=>api.scanTab(id)).then(result=>result.items).catch(e=>({error:e.message}));}''',s.tab)
            s.source.goto(ORIGIN+'/empty');value=s.panel.evaluate('late');assert not any(item.get('browserData') for item in value) if isinstance(value,list) else 'error' in value
    finally:SLOW.set()

def test_EB08(p):
    with session(p,'/frames') as s:
        items=s.scan();same=next(item for item in items if item['url'].endswith('/same.gif'))
        assert len(same['origins'])==2 and same.get('browserMethod')!='mhtml-resource'
        frame=next(item for item in items if item['url'].endswith('/frame.gif'));assert frame['browserMethod']=='mhtml-resource'
        s.source.evaluate("document.body.insertAdjacentHTML('beforeend','<div id=\"background\" style=\"width:100px;height:80px;background-image:url(/css.gif)\"></div>')")
        s.source.wait_for_load_state('networkidle');s.source.evaluate('performance.clearResourceTimings()')
        css=next(item for item in s.scan() if item['url'].endswith('/css.gif'));assert not css.get('browserData')

def test_EB09(p):
    with session(p,'/empty') as s:
        expect(s.panel.locator('#enhanced-settings-link')).to_be_visible()
        page=settings(s);group=page.locator('#enhanced-settings');toggle=page.locator('#enhanced-mode')
        expect(group).to_be_focused();expect(toggle).not_to_be_focused();expect(toggle).not_to_be_checked()
        assert 'Chrome' in page.locator('#enhanced-help').inner_text()
        for theme in ['light','dark']:
            s.worker.evaluate('(theme)=>chrome.storage.local.set({"settings:theme":theme})',theme)
            expect(page.locator('html')).to_have_attribute('data-theme',theme)
            page.set_viewport_size({'width':320,'height':850})
            group.focus();group.scroll_into_view_if_needed()
            expect(group).to_be_in_viewport(ratio=1);expect(page.locator('#enhanced-heading')).to_be_in_viewport()
            expect(group).to_have_css('outline-style','solid');expect(group).to_have_css('outline-width','2px')
            assert group.evaluate('(el)=>getComputedStyle(el).borderTopColor===getComputedStyle(el).outlineColor')
            focused_color=group.evaluate('(el)=>getComputedStyle(el).outlineColor')
            focus_hex=page.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--focus").trim()')
            assert focused_color=='rgb('+', '.join(str(channel) for channel in bytes.fromhex(focus_hex.removeprefix('#')))+')'
            before=group.bounding_box()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path=str(OUTPUT/f'settings-block-{theme}.png'))
            page.keyboard.press('Tab');expect(toggle).to_be_focused();expect(group).not_to_be_focused()
            expect(group).to_have_css('outline-style','none');expect(toggle).to_have_css('outline-style','solid')
            assert group.evaluate('(el)=>getComputedStyle(el).borderTopColor')!=focused_color
            assert group.bounding_box()==before
        page.keyboard.press('Space');expect(s.panel.locator('#enhanced-disable')).to_be_visible()
        saved=s.worker.evaluate('chrome.storage.local.get(null)');assert saved['enhanced-mode:v1:127.0.0.1'] is True
        assert 'enhanced-mode:v1:localhost' not in saved
        page.reload();expect(page.locator('#enhanced-mode')).to_be_checked()
        s.panel.locator('#enhanced-disable').click();expect(page.locator('#enhanced-mode')).not_to_be_checked()

def test_EB10(p):
    with session(p,'/empty') as s:
        page=settings(s)
        page.evaluate("() => { chrome.storage.local.set=()=>Promise.reject(Error('controlled storage failure')); }")
        page.locator('#enhanced-mode').check();expect(page.locator('#enhanced-feedback')).to_contain_text('保存未完成');expect(page.locator('#enhanced-mode')).not_to_be_checked()
        failed_read=s.context.new_page()
        failed_read.add_init_script("if(location.protocol==='chrome-extension:'){const get=chrome.storage.local.get.bind(chrome.storage.local);chrome.storage.local.get=key=>String(key).startsWith('enhanced-mode:')?Promise.reject(Error('controlled read failure')):get(key)}")
        failed_read.goto(page.url);expect(failed_read.locator('#enhanced-mode')).to_be_disabled();expect(failed_read.locator('#enhanced-feedback')).to_contain_text('无法读取设置')
        expect(failed_read.locator('#enhanced-settings')).not_to_be_focused()
        expect(failed_read.locator('#enhanced-settings')).to_have_css('outline-style','none')
        assert s.worker.evaluate("chrome.storage.local.get('enhanced-mode:v1:127.0.0.1')")=={}

        s.source.goto(IMAGE_ORIGIN+'/empty');expect(page.locator('#enhanced-mode')).to_be_disabled()
        fresh=s.context.new_page();fresh.goto(f'chrome-extension://{s.extension_id}/settings.html');expect(fresh.locator('#enhanced-mode')).to_be_disabled()
        expect(fresh.locator('#enhanced-settings')).not_to_be_focused()
        expect(fresh.locator('#enhanced-settings')).to_have_css('outline-style','none')
        assert s.worker.evaluate("chrome.storage.local.get('enhanced-mode:v1:localhost')")=={}

def test_EB11(p):
    with session(p) as s:
        s.source.evaluate("document.querySelector('#hidden').remove();performance.clearResourceTimings()")
        s.panel.locator('#refresh').click();expect(s.panel.locator('.card')).to_have_count(1)
        s.panel.locator('#select-all').check();s.panel.locator('#title-display').click();s.panel.locator('#title-input').fill('Kept title');s.panel.locator('#confirm-title').click()
        enable(s);expect(s.panel.locator('.card')).to_have_count(2,timeout=15000)
        expect(s.panel.locator('#page-title')).to_have_text('Kept title');expect(s.panel.locator('.card.selected')).to_have_count(1)
        scoped=s.panel.evaluate('async ({id,xpath})=>(await(await import("./api.js")).scanTab(id,xpath)).items.map(i=>i.url)', {"id":s.tab,"xpath":'//img[@id="keep"]'})
        assert all(url.endswith('/keep.gif') for url in scoped),scoped
        hidden=s.panel.locator('.card').filter(has=s.panel.locator('.image-url',has_text='hidden.gif'));hidden.locator('.ignore-image').click();expect(hidden).to_have_count(0)
        s.source.evaluate("document.querySelector('#keep').alt='changed'");expect(hidden).to_have_count(0)

def test_EB12(p):
    with session(p) as s:
        enable(s);s.panel.wait_for_timeout(300)
        item=s.scan()[0]
        s.worker.evaluate('''()=>{const send=chrome.debugger.sendCommand;globalThis.holding=false;chrome.debugger.sendCommand=async(...args)=>{if(args[1]==='Page.getResourceContent'){holding=true;await new Promise(r=>globalThis.releaseHeld=r)}return send(...args)}}''')
        s.panel.evaluate('''({tabId,item})=>{window.delayed=chrome.runtime.sendMessage({type:'read-browser-resources',tabId,items:[item]})}''',{'tabId':s.tab,'item':item})
        assert s.worker.evaluate('async()=>{for(let i=0;i<100;i++){if(globalThis.holding)return true;await new Promise(r=>setTimeout(r,20))}return false}')
        s.worker.evaluate("chrome.storage.local.set({'enhanced-mode:v1:127.0.0.1':false})");s.worker.evaluate('globalThis.releaseHeld?.()')
        assert s.panel.evaluate('delayed')['items']==[]
        assert s.worker.evaluate('async id=>{await chrome.debugger.attach({tabId:id},"1.3");await chrome.debugger.detach({tabId:id});return true}',s.tab)
        assert bytes(s.read('keep.gif')['bytes'])==GIF
        enable(s);item=s.scan()[0];s.worker.evaluate('() => { holding=false; }')
        s.panel.evaluate("({tabId,item})=>{window.navigationRead=chrome.runtime.sendMessage({type:'read-browser-resources',tabId,items:[item]})}",{'tabId':s.tab,'item':item})
        assert s.worker.evaluate('async()=>{for(let i=0;i<100;i++){if(globalThis.holding)return true;await new Promise(r=>setTimeout(r,20))}return false}')
        s.source.goto(IMAGE_ORIGIN+'/empty');s.worker.evaluate('globalThis.releaseHeld?.()')
        assert s.panel.evaluate('navigationRead')['items']==[]
        expect(s.panel.locator('#enhanced-badge')).to_be_hidden()

def test_EB13(p):
    with session(p,detach_fixture=True) as s:
        enable(s);s.panel.wait_for_timeout(300);item=s.scan()[0]
        s.worker.evaluate('''()=>{const send=chrome.debugger.sendCommand;globalThis.originalSend=send;chrome.debugger.sendCommand=async(...args)=>{if(args[1]==='Page.getResourceContent'){globalThis.holding=true;await new Promise(r=>globalThis.resumeCDP=r)}return send(...args)}}''')
        s.panel.evaluate('''({tabId,item})=>{window.cancelledRead=chrome.runtime.sendMessage({type:'read-browser-resources',tabId,items:[item]})}''',{'tabId':s.tab,'item':item})
        assert s.worker.evaluate('async()=>{for(let i=0;i<100;i++){if(globalThis.holding)return true;await new Promise(r=>setTimeout(r,20))}return false}')
        s.worker.evaluate('async id=>{await chrome.debugger.detach({tabId:id});for(const listener of detachListeners)listener({tabId:id},"canceled_by_user")}',s.tab);s.worker.evaluate('globalThis.resumeCDP?.()');assert s.panel.evaluate('cancelledRead')['items']==[]
        before=s.worker.evaluate('attachCount')
        reply=s.panel.evaluate('''({tabId,item})=>chrome.runtime.sendMessage({type:'read-browser-resources',tabId,items:[item]})''',{'tabId':s.tab,'item':item})
        assert reply['items']==[] and s.worker.evaluate('attachCount')==before
        s.worker.evaluate("() => { chrome.debugger.sendCommand=originalSend; }")
        s.worker.evaluate("chrome.storage.local.set({'enhanced-mode:v1:127.0.0.1':false})")
        denied=s.panel.evaluate("({tabId,item})=>chrome.runtime.sendMessage({type:'read-browser-resources',tabId,items:[item],retry:true})",{'tabId':s.tab,'item':item})
        assert denied['items']==[] and s.worker.evaluate('attachCount')==before
        enable(s)
        retried=s.panel.evaluate("({tabId,item})=>chrome.runtime.sendMessage({type:'read-browser-resources',tabId,items:[item],retry:true})",{'tabId':s.tab,'item':item})
        assert len(retried['items'])==1 and retried['items'][0]['method']=='debugger-resource'


def test_EB14(p):
    with session(p,'/empty') as s:
        page=settings(s);page.locator('#enhanced-mode').check();expect(s.panel.locator('#enhanced-badge')).to_be_visible()
        for language in ['ja','de','en','zh-CN','zh-TW','ko','fr']:
            for theme in ['light','dark']:
                s.worker.evaluate('(v)=>chrome.storage.local.set(v)',{'settings:language':language,'settings:theme':theme})
                for view in [s.panel,page]:
                    view.set_viewport_size({'width':320,'height':850});expect(view.locator('html')).to_have_attribute('lang',language)
                    assert view.evaluate('document.documentElement.scrollWidth<=innerWidth')
                assert page.locator('#enhanced-heading').inner_text()!='高级功能' or language=='zh-CN'
                long_host='very-long-subdomain-for-layout-checks.'*3+'example.test'
                page.locator('#enhanced-host').evaluate('(el,text)=>el.textContent=text',long_host)
                s.panel.locator('#enhanced-site').evaluate('(el,text)=>el.textContent=text',long_host)
                for view in [s.panel,page]:assert view.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.locator('#enhanced-mode').focus();expect(page.locator('#enhanced-mode')).to_be_focused()
                page.locator('#enhanced-settings').scroll_into_view_if_needed()
                s.panel.locator('#enhanced-prompt').scroll_into_view_if_needed()
                s.panel.screenshot(path=str(OUTPUT/f'gallery-{language}-{theme}.png'))
                page.mouse.move(0,0)
                page.locator('#enhanced-settings').screenshot(path=str(OUTPUT/f'settings-{language}-{theme}.png'))
        assert not s.errors,s.errors

def test_EB15(p):
    with session(p,'/empty') as s:
        s.panel.close();before=s.worker.evaluate('({fetch:fetchCount,attach:attachCount,capture:archiveCompleted})')
        s.source.evaluate("document.body.insertAdjacentHTML('beforeend','<img src=\"/passive.gif\">')")
        s.source.wait_for_load_state('networkidle');s.source.wait_for_timeout(800)
        assert s.worker.evaluate('({fetch:fetchCount,attach:attachCount,capture:archiveCompleted})')==before
        first=s.context.new_page();first.goto(f'chrome-extension://{s.extension_id}/panel.html?tab={s.tab}');expect(first.locator('.page-context')).to_have_attribute('data-frames','1')
        second=s.context.new_page();second.goto(first.url);expect(second.locator('.page-context')).to_have_attribute('data-frames','1')
        first.close();s.source.evaluate("document.body.insertAdjacentHTML('beforeend','<img src=\"/passive2.gif\">')");expect(second.locator('.card')).to_have_count(2,timeout=15000)
        assert not s.errors,s.errors

def main():
    global ORIGIN,IMAGE_ORIGIN
    servers=[ThreadingHTTPServer(('127.0.0.1',0),Handler) for _ in range(2)]
    ORIGIN=f'http://127.0.0.1:{servers[0].server_port}';IMAGE_ORIGIN=f'http://localhost:{servers[1].server_port}'
    for server in servers:Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            for case in [test_EB01,test_EB02,test_EB03,test_EB04,test_EB05,test_EB06,test_EB07,test_EB08,test_EB09,test_EB10,test_EB11,test_EB12,test_EB13,test_EB14,test_EB15]:
                if os.environ.get('EXTRACTION_TEST') and os.environ['EXTRACTION_TEST']!=case.__name__[5:]:continue
                case(p);print(case.__name__+' PASS',flush=True)
    finally:
        SLOW.set()
        for server in servers:server.shutdown()
if __name__=='__main__':main()
