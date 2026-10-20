"""Real extension tests for system/light/dark theme preferences."""
from pathlib import Path
import runpy
import tempfile
from threading import Thread
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
fixtures = runpy.run_path(str(ROOT / 'tests/browser_test.py'))
servers = [ThreadingHTTPServer(('127.0.0.1', 0), fixtures['Handler']) for _ in range(2)]
for i, server in enumerate(servers):
    server.other_port = servers[1-i].server_port
    Thread(target=server.serve_forever, daemon=True).start()
chrome = sorted((Path.home() / 'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
try:
    with tempfile.TemporaryDirectory(prefix='imagetaken-themes-') as profile, sync_playwright() as p:
        ext = str(ROOT / 'extension')
        context = p.chromium.launch_persistent_context(profile, executable_path=str(chrome), channel='chromium', headless=True, locale='zh-CN', color_scheme='dark', args=[f'--disable-extensions-except={ext}',f'--load-extension={ext}'])
        errors = []
        context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        extension_id = worker.url.split('/')[2]
        source = context.new_page()
        source.goto(f'http://127.0.0.1:{servers[0].server_port}/fixture')
        source.evaluate('window.ready')
        tab_id = worker.evaluate('async url => (await chrome.tabs.query({})).find(tab=>tab.url===url).id', source.url)
        panel = context.new_page()
        panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
        expect(panel.locator('.page-context')).to_have_attribute('data-frames','2')
        settings = context.new_page()
        settings.goto(f'chrome-extension://{extension_id}/settings.html')
        select = settings.locator('#theme')
        expect(select).to_be_enabled()
        expect(select).to_have_value('system')
        expect(select.locator('option')).to_have_count(3)
        for page in (settings, panel):
            expect(page.locator('html')).to_have_attribute('data-theme','dark')
        panel.locator('#query').fill('cached.png')
        expect(panel.locator('.card')).to_have_count(1)
        panel.locator('.card input').check()
        panel.evaluate("window.themeTestImage=document.querySelector('#gallery img')")
        title = panel.locator('#page-title').inner_text()
        for choice in ['light','dark']:
            select.select_option(choice)
            for page in (settings,panel):
                expect(page.locator('html')).to_have_attribute('data-theme',choice)
                expect(page.locator('html')).to_have_attribute('data-theme-preference',choice)
            assert panel.evaluate("window.themeTestImage===document.querySelector('#gallery img')"), 'theme recreated image previews'
            expect(panel.locator('.card input')).to_be_checked()
            expect(panel.locator('#page-title')).to_have_text(title)
            expect(panel.locator('#query')).to_have_value('cached.png')
            assert panel.locator('.image-area img').evaluate('(img)=>getComputedStyle(img).filter')=='none'
            assert panel.locator('.logo').evaluate('(img)=>getComputedStyle(img).filter')=='none'
            if choice=='dark':
                assert settings.locator('#auto-clean-title').evaluate("(el)=>getComputedStyle(el,'::after').backgroundColor")=='rgb(250, 248, 244)'
            expected_bg='rgb(255, 255, 255)' if choice=='light' else 'rgb(24, 26, 31)'
            assert panel.locator('html').evaluate('(el)=>getComputedStyle(el).backgroundColor')==expected_bg
            for width in [320,900]:
                for page in (settings,panel):
                    page.set_viewport_size({'width':width,'height':1000})
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            panel.locator('#filters').evaluate('(el)=>el.open=true')
            panel.screenshot(path=str(ROOT/f'test-results/theme-panel-{choice}.png'))
            settings.screenshot(path=str(ROOT/f'test-results/theme-settings-{choice}.png'))
        # Explicit dark persists across reload and ignores a light system setting.
        for page in (settings,panel):
            page.emulate_media(color_scheme='light')
            page.reload()
            expect(page.locator('html')).to_have_attribute('data-theme','dark')
        expect(select).to_have_value('dark')
        select.select_option('system')
        for page in (settings,panel):
            expect(page.locator('html')).to_have_attribute('data-theme','light')
            page.emulate_media(color_scheme='dark')
            expect(page.locator('html')).to_have_attribute('data-theme','dark')
            page.emulate_media(color_scheme='light')
            expect(page.locator('html')).to_have_attribute('data-theme','light')
        settings.reload()
        expect(select).to_have_value('system')
        assert not errors, errors
        context.close()
finally:
    for server in servers: server.shutdown()
print('Theme defaults, live system changes, manual override, persistence, cross-page sync, image/state preservation and layouts: OK')
