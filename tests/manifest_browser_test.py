"""Approved manifest integration cases; isolated profile, local server and real disk/OPFS."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import random
import re
import tempfile
from threading import Thread

from PIL import Image
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'test-results' / 'manifest'
OUTPUT.mkdir(parents=True, exist_ok=True)
KEY = 'settings:download-manifest'
rng = random.Random(9)
image = Image.frombytes('RGB', (100, 80), rng.randbytes(100 * 80 * 3))
stream = io.BytesIO()
image.save(stream, 'PNG')
PNG = stream.getvalue()
COUNTS = {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        path = self.path.split('?')[0]
        COUNTS[path] = COUNTS.get(path, 0) + 1
        if path.endswith('.png'):
            body, mime = PNG, 'image/png'
        elif path == '/frame':
            body = b'<img id="frame-img" title="Frame original" src="/c.png"><img title="Later duplicate" src="/a.png">'
            mime = 'text/html;charset=utf-8'
        elif path == '/meta':
            body = ('''<!doctype html><title>Metadata page</title>
<img id="first" title="Original title" alt="Ignored alt" src="/a.png">
<img id="alt" alt="Alt original" src="/b.png">
<iframe src="/frame"></iframe>
<svg id="vector" width="100" height="80"><title>Vector original</title><rect width="100" height="80" fill="orange"/></svg>
<canvas id="drawing" width="100" height="80"></canvas>
<script>window.ready=(async()=>{
 const blob=await (await fetch('/a.png')).blob();const i=new Image();i.id='blob-image';i.alt='Blob original';i.src=URL.createObjectURL(blob);document.body.append(i);await i.decode();
 await fetch('/resource.png');document.querySelector('canvas').getContext('2d').fillRect(0,0,100,80);
})();</script>''').encode()
            mime = 'text/html;charset=utf-8'
        else:
            body = b'<!doctype html><title>Manifest album</title><img id="a" title="First original" src="/a.png"><img id="b" alt="Second original" src="/b.png">'
            mime = 'text/html;charset=utf-8'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'public, max-age=3600')
        self.end_headers()
        self.wfile.write(body)


class Session:
    def __init__(self, context, worker, source, panel, folder):
        self.context, self.worker, self.source, self.panel, self.folder = context, worker, source, panel, folder
        self.extension_id = worker.url.split('/')[2]

    def settings(self):
        page = self.context.new_page()
        page.goto(f'chrome-extension://{self.extension_id}/settings.html')
        expect(page.locator('#download-manifest')).to_be_enabled()
        return page

    def title(self, title):
        self.panel.locator('#title-display').click()
        self.panel.locator('#title-input').fill(title)
        self.panel.locator('#confirm-title').click()

    def download(self):
        self.panel.locator('#select-all').check()
        self.panel.locator('#download').click()
        self.wait_done()

    def wait_done(self):
        expect(self.panel.locator('#notice')).to_be_visible(timeout=30000)
        expect(self.panel.locator('#refresh')).to_be_enabled(timeout=30000)

    def files(self):
        return sorted(self.folder.rglob('*'))

    def manifests(self):
        return sorted(self.folder.rglob('*.txt'))

    def custom(self):
        self.panel.evaluate("window.showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle('chosen',{create:true})")
        self.panel.locator('#choose-location').click()
        expect(self.panel.locator('#download-location')).to_have_text('chosen')

    def custom_files(self, title='Manifest album'):
        return self.panel.evaluate('''async title=>{
          const root=await navigator.storage.getDirectory(); const chosen=await root.getDirectoryHandle('chosen');
          const folder=await chosen.getDirectoryHandle(title);const result=[];
          for await(const [name,handle] of folder.entries()){const file=await handle.getFile();result.push({name,text:name.endsWith('.txt')?await file.text():'',bytes:Array.from(new Uint8Array(await file.arrayBuffer()))});}
          return result;
        }''', title)

    def fail_files(self, suffix):
        self.panel.evaluate('''suffix=>{
          const proto=FileSystemDirectoryHandle.prototype, native=proto.getFileHandle;
          window.restoreFileHandles=()=>{proto.getFileHandle=native};
          proto.getFileHandle=function(name,options){if(name.endsWith(suffix))throw new DOMException('controlled write failure','NotAllowedError');return native.call(this,name,options)};
        }''', suffix)


@contextmanager
def session(playwright, origin, enabled=False, path='/simple'):
    with tempfile.TemporaryDirectory(prefix='imagetaken-manifest-') as profile:
        folder = Path(profile) / 'downloads'
        default = Path(profile) / 'Default'
        default.mkdir()
        (default / 'Preferences').write_text(json.dumps({'download': {'default_directory': str(folder), 'prompt_for_download': False}}))
        candidates = sorted((Path.home() / 'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        executable = os.environ.get('CHROMIUM_PATH') or (str(candidates[-1]) if candidates else None)
        ext = str(ROOT / 'extension')
        context = playwright.chromium.launch_persistent_context(profile, executable_path=executable, channel='chromium', headless=True, locale='zh-CN', accept_downloads=True, viewport={'width':800,'height':900}, args=[f'--disable-extensions-except={ext}',f'--load-extension={ext}'])
        errors = []
        context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            if enabled:
                worker.evaluate('async key=>chrome.storage.local.set({[key]:true})', KEY)
            source = context.new_page()
            source.goto(origin + path, wait_until='networkidle')
            if path == '/meta':
                source.evaluate('window.ready')
                worker.evaluate("async()=>chrome.storage.local.set({'filters:site:v1:127.0.0.1:minBytes':0})")
            tab_id = worker.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', source.url)
            panel = context.new_page()
            panel.goto(f'chrome-extension://{worker.url.split("/")[2]}/panel.html?tab={tab_id}')
            expect(panel.locator('.card')).not_to_have_count(0)
            panel.locator('#gallery img').evaluate_all("images=>images.forEach(image=>image.loading='eager')")
            panel.wait_for_function("() => [...document.querySelectorAll('#gallery img')].every(i=>i.complete)")
            expect(panel.locator('#choose-location')).to_be_enabled()
            context.new_cdp_session(panel).send('Browser.setDownloadBehavior', {'behavior':'default'})
            yield Session(context, worker, source, panel, folder)
            assert not errors, errors
        finally:
            context.close()


def test_manifest_off_preserves_existing_downloads(p, origin):
    with session(p, origin) as s:
        settings = s.settings()
        expect(settings.locator('#download-manifest')).not_to_be_checked()
        before = dict(COUNTS)
        s.download()
        assert not s.manifests()
        assert len(list(s.folder.rglob('*.png'))) == 2
        assert COUNTS.get('/a.png') == before.get('/a.png') and COUNTS.get('/b.png') == before.get('/b.png')
        expect(s.panel.locator('#notice')).to_have_text('2 张图片已下载到「Manifest album」文件夹。')
        s.worker.evaluate('async key=>chrome.storage.local.set({[key]:false})', KEY)
        s.download()
        assert not s.manifests()


def test_manifest_setting_persistence_and_sync(p, origin):
    with session(p, origin) as s:
        a, b = s.settings(), s.settings()
        a.locator('#download-manifest').check()
        expect(a.locator('#settings-status')).to_have_text('已保存')
        expect(b.locator('#download-manifest')).to_be_checked()
        a.reload()
        expect(a.locator('#download-manifest')).to_be_checked()
        s.download()
        assert len(s.manifests()) == 1
        s.worker.evaluate('async key=>chrome.storage.local.remove(key)', KEY)
        expect(b.locator('#download-manifest')).not_to_be_checked()
        s.worker.evaluate('async key=>chrome.storage.local.set({[key]:"true"})', KEY)
        a.reload()
        expect(a.locator('#download-manifest')).not_to_be_checked()
        a.set_viewport_size({'width':320,'height':1000})
        assert a.evaluate('document.documentElement.scrollWidth<=innerWidth')
        a.screenshot(path=str(OUTPUT / 'settings-default-off.png'), full_page=True)
        # Errors are isolated to this new setting; existing controls keep their native paths.
        a.evaluate('''() => {const native=chrome.storage.local.set;chrome.storage.local.set=async values=>{if(Object.hasOwn(values,'settings:download-manifest'))throw new Error('controlled storage failure');return native.call(chrome.storage.local,values)};}''')
        a.locator('#download-manifest').click()
        expect(a.locator('#settings-status')).to_contain_text('保存失败')
        expect(a.locator('#download-manifest')).not_to_be_checked()
        a.add_init_script("const native=chrome.storage.local.get;chrome.storage.local.get=async key=>{if(key==='settings:download-manifest')throw new Error('controlled read failure');return native.call(chrome.storage.local,key)}")
        a.reload()
        expect(a.locator('#settings-status')).to_contain_text('无法读取设置')
        expect(a.locator('#download-manifest')).to_be_disabled()
        s.panel.add_init_script("const native=chrome.storage.local.get;chrome.storage.local.get=async key=>{if(key==='settings:download-manifest')throw new Error('controlled read failure');return native.call(chrome.storage.local,key)}")
        s.panel.reload()
        expect(s.panel.locator('#notice')).to_contain_text('无法读取设置')
        expect(s.panel.locator('.single-download').first).to_be_disabled()


def test_default_directory_manifest_uses_actual_paths(p, origin):
    with session(p, origin, True) as s:
        s.title('旅行/精选')
        s.panel.locator('#format').select_option('jpg')
        s.download()
        texts = s.manifests()
        assert len(texts) == 1 and texts[0].name == '旅行_精选.txt'
        text = texts[0].read_text()
        files = list(s.folder.rglob('*.jpg'))
        assert len(files) == 2 and all(f.parent == texts[0].parent for f in files)
        assert all('local filename: '+f.name in text for f in files)
        assert 'original title: First original' in text and 'source page URL: '+origin+'/simple' in text
        assert re.search(r'collected at: \d{4}-\d\d-\d\dT.*Z', text)
        expect(s.panel.locator('#progress')).to_contain_text('新保存 2')


def test_custom_directory_manifest_tracks_duplicates(p, origin):
    with session(p, origin, True) as s:
        s.custom()
        s.download()
        s.download()
        texts = [f['text'] for f in s.custom_files() if f['name'].endswith('.txt')]
        assert len(texts) == 2 and any('status: Reused existing file' in text for text in texts)
        s.panel.evaluate('''async()=>{
          const folder=await (await (await navigator.storage.getDirectory()).getDirectoryHandle('chosen')).getDirectoryHandle('Manifest album');
          for await (const [name,handle] of folder.entries()) if(name.endsWith('.png')){const w=await handle.createWritable();await w.write('external changed image');await w.close();}
        }''')
        s.download()
        files = s.custom_files()
        variants = [f for f in files if re.search(r'_[a-f0-9]{16}\.png$',f['name'])]
        assert len(variants) == 2
        text = next(f['text'] for f in files if f['name'].endswith('.txt') and all(v['name'] in f['text'] for v in variants))
        assert 'status: Saved' in text
        assert not s.manifests()


def test_partial_failure_manifest_and_image_counts(p, origin):
    with session(p, origin, True) as s:
        s.custom()
        s.fail_files('-b.png')
        s.download()
        files = s.custom_files()
        text = next(f['text'] for f in files if f['name'].endswith('.txt'))
        assert 'Saved / reused images: 1' in text and 'Failed images: 1' in text
        assert 'local filename: 001-a.png' in text and 'local filename: 002-b.png' not in text
        expect(s.panel.locator('#progress')).to_contain_text('新保存 1 · 失败 1')
        expect(s.panel.locator('#notice')).to_contain_text('图片清单已保存')
        # An unexpected actual path is a failed archive, never a successful local mapping.
        misplaced = s.panel.evaluate('''async()=>{
          const {createManifestBatch,manifestText}=await import('./download-manifest.js');
          const b=createManifestBatch([{url:'https://example/a.png'}],'Title');b.entries[0].result={error:'directory changed',misplaced:true,actualPath:'/other/a.png'};return manifestText(b);
        }''')
        assert 'Failed images: 1' in misplaced and 'local filename: a.png' not in misplaced


def test_all_failed_images_still_create_manifest(p, origin):
    with session(p, origin, True) as s:
        s.custom()
        s.fail_files('.png')
        s.download()
        files = s.custom_files()
        assert len(files) == 1 and files[0]['name'].endswith('.txt')
        assert 'Saved / reused images: 0' in files[0]['text'] and 'Failed images: 2' in files[0]['text']
        expect(s.panel.locator('#progress')).to_contain_text('新保存 0 · 失败 2')


def test_manifest_failure_preserves_images_and_reports_error(p, origin):
    with session(p, origin, True) as s:
        s.custom()
        s.fail_files('.txt')
        s.download()
        files = s.custom_files()
        assert len(files) == 2 and all(f['name'].endswith('.png') for f in files)
        expect(s.panel.locator('#notice')).to_contain_text('图片清单保存失败')
        expect(s.panel.locator('#notice')).to_contain_text('已保存的图片保留')
        assert not s.manifests()
        s.panel.evaluate("window.restoreFileHandles();FileSystemDirectoryHandle.prototype.requestPermission=async()=>'denied'")
        s.title('Denied destination')
        s.download()
        expect(s.panel.locator('#notice')).to_contain_text('无法准备下载目录')
        assert s.panel.evaluate("async()=>{try{await(await(await navigator.storage.getDirectory()).getDirectoryHandle('chosen')).getDirectoryHandle('Denied destination');return false}catch(e){return e.name==='NotFoundError'}}")
        assert not s.manifests()


def test_collected_metadata_survives_frames_and_navigation(p, origin):
    with session(p, origin, True, '/meta') as s:
        items = s.panel.evaluate('''async()=>{const {scanTab}=await import('./api.js');const tab=Number(new URLSearchParams(location.search).get('tab'));window.captured=(await scanTab(tab)).items;return window.captured}''')
        a = next(i for i in items if i['url'] == origin+'/a.png')
        c = next(i for i in items if i['url'] == origin+'/c.png')
        resource = next(i for i in items if i['url'] == origin+'/resource.png')
        alt = next(i for i in items if i['url'] == origin+'/b.png')
        assert a['originalTitle'] == 'Original title' and a['sourcePageUrl'] == origin+'/meta' and len(a['origins']) == 2
        assert alt['originalTitle'] == 'Alt original'
        assert c['sourcePageUrl'] == origin+'/frame' and c['originalTitle'] == 'Frame original'
        assert resource['sourcePageUrl'] == origin+'/meta' and not resource['originalTitle']
        assert any(i['sources'] == ['svg'] and i['originalTitle'] == 'Vector original' for i in items)
        assert all(re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', i['collectedAt']) for i in items)
        s.custom()
        s.download()
        text = next(f['text'] for f in s.custom_files('Metadata page') if f['name'].endswith('.txt'))
        assert 'blob:' in text and 'svg#vector' in text and 'No valid remote URL' in text
        s.source.evaluate("document.querySelector('#first').title='Changed DOM title'")
        s.source.goto(origin+'/navigated')
        retained = s.panel.evaluate("window.captured.find(i=>i.url.endsWith('/a.png'))")
        assert retained['originalTitle'] == a['originalTitle'] and retained['collectedAt'] == a['collectedAt']
        assert retained['sourcePageUrl'] == origin+'/meta'


def test_download_batch_freezes_manifest_preferences(p, origin):
    with session(p, origin, True) as s:
        s.custom()
        settings = s.settings()
        s.panel.evaluate('''()=>{
          const proto=FileSystemDirectoryHandle.prototype,native=proto.getFileHandle;
          const gate=new Promise(resolve=>window.releaseImages=resolve);window.blockedImages=0;
          proto.getFileHandle=async function(name,options){if(name.endsWith('.png')){window.blockedImages++;await gate}return native.call(this,name,options)};
        }''')
        s.panel.locator('#select-all').check()
        s.panel.locator('#download').click()
        s.panel.wait_for_function('() => window.blockedImages>0')
        settings.locator('#download-manifest').uncheck()
        expect(settings.locator('#settings-status')).to_have_text('已保存')
        s.source.evaluate("document.querySelector('#a').title='New DOM title'")
        s.panel.evaluate("document.querySelector('#title-display').dispatchEvent(new MouseEvent('click'));document.querySelector('#title-input').value='Later title';document.querySelector('#title-edit-form').dispatchEvent(new Event('submit',{cancelable:true}));window.releaseImages()")
        s.wait_done()
        text = next(f['text'] for f in s.custom_files() if f['name'].endswith('.txt'))
        assert 'download title: Manifest album' in text and 'original title: First original' in text
        assert 'New DOM title' not in text
        s.download()
        assert all(not f['name'].endswith('.txt') for f in s.custom_files('Later title'))


def test_manifest_collision_preserves_every_batch(p, origin):
    with session(p, origin, True) as s:
        s.download()
        first = s.manifests()[0]
        content = first.read_bytes()
        s.download()
        texts = s.manifests()
        assert len(texts) == 2 and first.read_bytes() == content
        assert any(re.fullmatch(r'Manifest album_[a-f0-9]{16}\.txt', f.name) for f in texts)
        second = next(f for f in texts if f != first)
        assert 'status: Reused existing file' in second.read_text()
        assert len(list(s.folder.rglob('*.png'))) == 2


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            origin = f'http://127.0.0.1:{server.server_port}'
            for name, case in list(globals().items()):
                if name.startswith('test_'):
                    case(p, origin)
                    print(name+': OK', flush=True)
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
