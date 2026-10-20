"""Real extension localization checks. Run with uv + playwright + pillow."""
import json
from pathlib import Path
import runpy
import tempfile
from threading import Thread
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
fixtures = runpy.run_path(str(ROOT / 'tests/browser_test.py'))
catalog_text = (ROOT / 'extension/locales/catalogs.js').read_text()
catalogs = json.loads(catalog_text.split('export const catalogs = ', 1)[1].rstrip(';\n'))
servers = [ThreadingHTTPServer(('127.0.0.1', 0), fixtures['Handler']) for _ in range(2)]
for i, server in enumerate(servers):
    server.other_port = servers[1-i].server_port
    Thread(target=server.serve_forever, daemon=True).start()
chrome = sorted((Path.home() / 'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
try:
    with sync_playwright() as p:
        for locale, detected in [('fr-FR','fr'),('zh-HK','zh-TW'),('es-ES','en')]:
            with tempfile.TemporaryDirectory(prefix='imagetaken-languages-') as profile:
                ext = str(ROOT / 'extension')
                context = p.chromium.launch_persistent_context(profile, executable_path=str(chrome), channel='chromium', headless=True, locale=locale, args=[f'--disable-extensions-except={ext}',f'--load-extension={ext}'])
                errors = []
                context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
                worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
                extension_id = worker.url.split('/')[2]
                settings = context.new_page()
                settings.goto(f'chrome-extension://{extension_id}/settings.html')
                expect(settings.locator('#language')).to_be_enabled()
                expect(settings.locator('html')).to_have_attribute('lang', detected)
                expect(settings.locator('#language')).to_have_value('auto')
                expect(settings.locator('h2')).to_have_text(catalogs[detected]['设置'])
                expect(settings.locator('#language option')).to_have_count(8)
                if locale == 'fr-FR':
                    source = context.new_page()
                    source.goto(f'http://127.0.0.1:{servers[0].server_port}/fixture')
                    source.evaluate('window.ready')
                    user_title = '我的相册 日本語タイトル'
                    source.evaluate('(value)=>document.title=value', user_title)
                    tab_id = worker.evaluate('async url => (await chrome.tabs.query({})).find(tab=>tab.url===url).id', source.url)
                    panel = context.new_page()
                    panel.goto(f'chrome-extension://{extension_id}/panel.html?tab={tab_id}')
                    expect(panel.locator('.page-context')).to_have_attribute('data-frames', '2')
                    panel.locator('#query').fill('cached.png')
                    expect(panel.locator('.card')).to_have_count(1)
                    panel.locator('.card input').check()
                    key = panel.locator('.card').get_attribute('data-key')
                    panel.locator('#site-rules').evaluate('(el)=>el.open=true')
                    panel.locator('#xpath').fill('//*[@id="自定义"]')
                    for language in ['ja','de','en','zh-CN','zh-TW','ko','fr']:
                        settings.locator('#language').select_option(language)
                        expect(settings.locator('html')).to_have_attribute('lang', language)
                        expect(settings.locator('h2')).to_have_text(catalogs[language]['设置'])
                        expect(panel.locator('html')).to_have_attribute('lang', language)
                        expect(panel.locator('.breadcrumb-page')).to_have_text(catalogs[language]['图片库'])
                        expect(panel.locator('#site-rules-count')).to_have_text(catalogs[language]['未启用'])
                        expect(panel.locator('#download')).to_have_text(catalogs[language]['下载所选图片'])
                        expect(panel.locator('#page-title')).to_have_text(user_title)
                        expect(panel.locator('#query')).to_have_value('cached.png')
                        expect(panel.locator('#xpath')).to_have_value('//*[@id="自定义"]')
                        expect(panel.locator('.card.selected')).to_have_attribute('data-key', key)
                        panel.locator('#filters').evaluate('(el)=>el.open=true')
                        for width in [320, 900]:
                            panel.set_viewport_size({'width':width,'height':1000})
                            settings.set_viewport_size({'width':width,'height':900})
                            assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth'), ('panel',language,width)
                            assert panel.evaluate('''() => document.querySelector('.brand').getBoundingClientRect().right <= document.querySelector('.header-actions').getBoundingClientRect().left'''), ('header overlap',language,width)
                            assert settings.evaluate('document.documentElement.scrollWidth <= innerWidth'), ('settings',language,width)
                            if width == 320 and language == 'de':
                                panel.screenshot(path=str(ROOT/'test-results/language-de-narrow.png'))
                        panel.screenshot(path=str(ROOT/f'test-results/language-{language}.png'))
                    settings.reload()
                    expect(settings.locator('#language')).to_have_value('fr')
                    panel.reload()
                    expect(panel.locator('html')).to_have_attribute('lang','fr')
                    settings.locator('#language').select_option('auto')
                    expect(settings.locator('#language')).to_have_value('auto')
                    expect(settings.locator('html')).to_have_attribute('lang','fr')
                    settings.reload()
                    expect(settings.locator('#language')).to_have_value('auto')
                assert not errors, errors
                context.close()
                print(locale, 'automatic', detected, 'OK')
finally:
    for server in servers: server.shutdown()
print('Seven languages, live switching, persistence, state preservation and layouts: OK')
