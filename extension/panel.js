import { scanTab, downloadImage } from './api.js';
import { filterImages, imageType, METHOD_LABELS } from './lib.js';

const $ = id => document.getElementById(id);
const pinnedId = Number(new URLSearchParams(location.search).get('tab')) || null;
const state = { tab: null, items: [], selected: new Set(), results: new Map(), scanning: false, busy: false, generation: 0, pendingTab: null };
const sourceLabels = { img: '页面图片', src: '图片地址', css: 'CSS', pseudo: '伪元素', canvas: 'Canvas', svg: 'SVG', 'svg-image': 'SVG 图片', lazy: '懒加载', srcset: '响应式', poster: '视频封面', resource: '资源', link: '图片链接' };

function filters() {
  return { query: $('query').value, width: Math.max(0, +$('min-width').value), height: Math.max(0, +$('min-height').value),
    type: $('type').value, source: $('source').value, loaded: $('loaded').checked, sort: $('sort').value };
}
function visible() { return filterImages(state.items, filters()); }
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
  $('notice').classList.toggle('error', error);
}
function selectionUI() {
  const shown = visible();
  const selectedShown = shown.filter(item => state.selected.has(item.key)).length;
  $('select-all').checked = shown.length > 0 && selectedShown === shown.length;
  $('select-all').indeterminate = selectedShown > 0 && selectedShown < shown.length;
  $('select-all').disabled = state.busy || state.scanning || !shown.length;
  const hiddenSelected = state.selected.size - selectedShown;
  $('selection-count').textContent = `已选择 ${state.selected.size} 张${hiddenSelected ? `（含 ${hiddenSelected} 张被筛选隐藏）` : ''}`;
  $('download').disabled = state.busy || state.scanning || !state.selected.size;
  $('copy').disabled = state.busy || !state.selected.size;
  $('refresh').disabled = state.busy || state.scanning;
  $('format').disabled = state.busy;
  $('expand').disabled = !state.tab || state.busy;
  for (const input of $('gallery').querySelectorAll('input,button')) input.disabled = state.busy;
}

function updateCard(card, item) {
  const result = state.results.get(item.key);
  const status = card.querySelector('.item-status');
  const text = result?.error ? '下载失败 · 可重试' : result?.pending ? '正在读取 / 下载…' : result?.method ? METHOD_LABELS[result.method] : item.loaded ? '页面已加载' : '候选资源';
  const size = result?.bytes ? (result.bytes >= 1048576 ? `${(result.bytes / 1048576).toFixed(1)} MiB` : `${Math.ceil(result.bytes / 1024)} KiB`) : '';
  const conversion = result?.format && result.format !== 'original' ? ` → ${result.format.toUpperCase()}` : '';
  status.textContent = `${text}${conversion}${size ? ` · ${size}` : ''}`;
  status.title = result?.error || status.textContent;
  status.className = `item-status${result?.error ? ' error' : result?.method ? ' success' : ''}`;
  card.classList.toggle('selected', state.selected.has(item.key));
  card.querySelector('input').checked = state.selected.has(item.key);
}

function render() {
  const items = visible();
  $('total').textContent = state.items.length;
  $('visible-count').textContent = `${items.length} 张图片`;
  const f = filters();
  const count = [f.width, f.height, f.type, f.source, f.loaded].filter(Boolean).length;
  $('filter-count').textContent = count ? `${count} 项` : '';
  $('empty').hidden = items.length > 0;
  $('empty').querySelector('h3').textContent = state.scanning ? '正在扫描页面…' : state.items.length ? '没有符合条件的图片' : '还没有图片';
  $('empty').querySelector('p').textContent = state.items.length ? '调整筛选条件，或清除筛选后查看。' : '滚动页面让懒加载图片出现，再点击右上角重新扫描。';
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = $('card-template').content.firstElementChild.cloneNode(true);
    const image = card.querySelector('img');
    image.src = item.preview || (item.kind === 'canvas' ? '' : item.url);
    if (item.kind === 'canvas' && !item.preview) image.classList.add('failed');
    image.alt = item.alt || '页面图片预览';
    image.addEventListener('error', () => image.classList.add('failed'));
    image.addEventListener('load', () => {
      if (!item.width && !item.preview) {
        item.width = image.naturalWidth; item.height = image.naturalHeight;
        card.querySelector('.dimensions').textContent = `${item.width} × ${item.height}`;
        // Keep filtering and sorting consistent when previously unknown metadata arrives.
        if (filters().width || filters().height || filters().sort !== 'position') scheduleRender();
      }
    });
    card.querySelector('.dimensions').textContent = item.width && item.height ? `${Math.round(item.width)} × ${Math.round(item.height)}` : '尺寸未知';
    card.querySelector('.type-badge').textContent = imageType(item) === 'unknown' ? '?' : imageType(item);
    card.querySelector('.source-badge').textContent = sourceLabels[item.sources[0]] || item.sources[0];
    card.querySelector('.source-badge').title = item.sources.map(s => sourceLabels[s] || s).join(' / ');
    card.querySelector('.image-url').textContent = /^(data:|blob:)/.test(item.url) ? `${item.url.split(':')[0]}: 页面内嵌资源` : item.url;
    card.querySelector('.image-url').title = item.url.slice(0, 2000);
    card.querySelector('input').addEventListener('change', event => {
      if (event.target.checked) state.selected.add(item.key); else state.selected.delete(item.key);
      updateCard(card, item); selectionUI();
    });
    card.querySelector('.single-download').addEventListener('click', () => void runDownloads([item]));
    updateCard(card, item);
    fragment.append(card);
  }
  $('gallery').replaceChildren(fragment);
  selectionUI();
}
let renderTimer;
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 120); }

async function refresh(tab = state.tab) {
  if (!tab) return;
  if (state.busy) { state.pendingTab = tab; return; }
  const generation = ++state.generation;
  state.tab = tab;
  state.scanning = true;
  state.items = []; state.selected.clear(); state.results.clear();
  $('progress').textContent = '文件将保存到下载目录的 ImageDown 文件夹';
  $('page-title').textContent = tab.title || '未命名页面';
  try { $('page-host').textContent = new URL(tab.url).host; } catch { $('page-host').textContent = tab.url || ''; }
  $('frame-count').textContent = '扫描中';
  notice(''); render();
  try {
    if (!/^https?:/.test(tab.url || '')) throw new Error('请切换到普通 HTTP / HTTPS 网页。浏览器内部页、商店页及 PDF 阅读器可能不允许扩展访问。');
    const result = await scanTab(tab.id);
    if (generation !== state.generation) return;
    state.items = result.items;
    $('frame-count').textContent = `${result.frames} 个框架`;
    if (result.truncated) notice('图片过多：已达到单个框架 4000 个地址或 12 MiB 地址数据的上限，部分图片未列出。');
    else if (!result.items.length) notice('尚未发现图片。请先滚动或展开页面内容，然后重新扫描；部分受保护的框架可能无法访问。');
  } catch (error) {
    if (generation !== state.generation) return;
    $('frame-count').textContent = '无法扫描';
    notice(`扫描失败：${error.message}`, true);
  } finally {
    if (generation === state.generation) { state.scanning = false; render(); }
  }
}

async function runDownloads(items) {
  if (state.busy || !state.tab || !items.length) return;
  const tabId = state.tab.id;
  const format = $('format').value;
  state.busy = true;
  let done = 0, failed = 0, cursor = 0;
  notice(''); selectionUI();
  // Two concurrent images bound memory and avoid flooding sites with requests.
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      state.results.set(item.key, { pending: true });
      render();
      try {
        const result = await downloadImage(tabId, item, item.order, format);
        if (result.mime && format === 'original') item.mime = result.mime;
        state.results.set(item.key, result); done++;
      } catch (error) {
        state.results.set(item.key, { error: error.message }); failed++;
      }
      $('progress').textContent = `已完成 ${done} / ${items.length}${failed ? ` · 失败 ${failed}` : ''} · 下载期间请保持此面板打开`;
      render();
    }
  };
  $('progress').textContent = `正在下载 ${items.length} 张图片，请保持面板打开…`;
  await Promise.all([worker(), worker()]);
  state.busy = false;
  selectionUI();
  if (failed) notice(`${done} 张下载完成，${failed} 张失败。悬停失败标记可查看原因；可单独重试。`, true);
  else notice(`${done} 张图片已下载到 ImageDown 文件夹。`);
  if (state.pendingTab) { const tab = state.pendingTab; state.pendingTab = null; await refresh(tab); }
}

for (const id of ['query', 'min-width', 'min-height']) $(id).addEventListener('input', scheduleRender);
for (const id of ['type', 'source', 'loaded', 'sort']) $(id).addEventListener('change', render);
$('reset').addEventListener('click', () => {
  for (const id of ['query', 'min-width', 'min-height', 'type', 'source']) $(id).value = '';
  $('loaded').checked = false; render();
});
$('select-all').addEventListener('change', event => {
  for (const item of visible()) {
    if (event.target.checked) state.selected.add(item.key); else state.selected.delete(item.key);
  }
  render();
});
$('layout').addEventListener('click', () => {
  const list = $('gallery').classList.toggle('list');
  $('layout').textContent = list ? '▦' : '☷';
  $('layout').setAttribute('aria-label', list ? '切换为网格布局' : '切换为列表布局');
});
$('refresh').addEventListener('click', async () => {
  if (state.tab) { try { await refresh(await chrome.tabs.get(state.tab.id)); } catch (error) { notice(error.message, true); } }
});
$('format').addEventListener('change', () => { $('conversion-note').hidden = $('format').value === 'original'; });
$('download').addEventListener('click', () => void runDownloads(state.items.filter(item => state.selected.has(item.key))));
$('copy').addEventListener('click', async () => {
  const urls = state.items.filter(item => state.selected.has(item.key) && item.kind !== 'canvas').map(item => item.url);
  try {
    if (!urls.length) throw new Error('Canvas 是页面快照，没有可复制的原始链接');
    await navigator.clipboard.writeText(urls.join('\n'));
    notice(`已复制 ${urls.length} 个链接${urls.length < state.selected.size ? '（Canvas 快照无链接，已跳过）' : ''}。`);
  } catch (error) { notice(error.message, true); }
});
$('expand').addEventListener('click', () => {
  if (state.tab) void chrome.tabs.create({ url: chrome.runtime.getURL(`panel.html?tab=${state.tab.id}`) });
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('query').focus(); }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (pinnedId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    // Opening our expanded view should not replace the source in the side panel.
    if (tab.url?.startsWith(chrome.runtime.getURL(''))) return;
    await refresh(tab);
  } catch (error) { notice(error.message, true); }
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tabId === state.tab?.id && change.status === 'complete') void refresh(tab);
});
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId !== state.tab?.id) return;
  state.generation++; state.tab = null; state.items = []; state.selected.clear(); state.scanning = false;
  notice('原页面已关闭。请切换到另一个网页。'); render();
});

try {
  const tab = pinnedId ? await chrome.tabs.get(pinnedId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  await refresh(tab);
} catch (error) { notice(error.message, true); }
