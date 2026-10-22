import { extractionCall, onExtractionEvent } from './extraction-client.js';
import { loadEnhanced, saveEnhanced, sourceContext } from './enhanced-mode.js';
import { saveConfig } from './config-lock.js';
import { SYNC_IMPORT_KEY, SYNC_STATE_KEY } from './settings-sync-codec.js';
import { loadEffectivePreferences } from './effective-preferences.js';
import { REMOTE_RULES_KEY, rulesChanged } from './remote-rules.js';
import { t } from './i18n.js';
import { initI18n, bindDocument, localizeDocument, translateRendered } from './i18n.js';
import { THEME_KEY } from './theme.js';
import { scanTab, downloadImage } from './api.js';
import { filterImages, imageType, METHOD_LABELS } from './lib.js';
import { DEFAULT_THRESHOLDS, normalizeThreshold, siteDomain, ignoreStorageKey, imageSize, formatBytes } from './metadata.js';
import { saveThresholds, resetThresholds, thresholdChanges, loadIgnored, setIgnored, xpathStorageKey, exclusionsStorageKey, saveQuery, VIEW_FILTERS_KEY, loadViewFilters, saveViewFilters, normalizeViewFilters } from './preferences.js';
import { loadPreview, previewOrigin } from './previews.js';
import { bindGallerySelection } from './selection.js';
import { createSelectionHighlights } from './selection-highlights.js';
import { bindTitleEditor } from './title-editor.js';
import { loadDirectory, saveDirectory, chooseDirectory, prepareDestination, directoryChanged } from './destination.js';
import { createBadgeBinding } from './badge.js';
import { TITLE_CLEANUP_KEY, loadTitleCleanup, READY_FIRST_KEY, loadReadyFirst, DOWNLOAD_MANIFEST_KEY, loadDownloadManifest } from './settings.js';
import { createManifestBatch, saveManifest } from './download-manifest.js';

const $ = id => document.getElementById(id);
const pinnedId = Number(new URLSearchParams(location.search).get('tab')) || null;
const state = { tab: null, domain: '', xpath: '', exclusions: '', ignored: new Set(), items: [], selected: new Set(), results: new Map(), scanning: false, busy: false, generation: 0, pendingTab: null, retryBatch: null };
const sourceHighlights = createSelectionHighlights();
let enhancedEnabled = false, enhancedStatus = 'idle', incrementalTimer, incrementalRequested = false;
async function updateEnhanced() {
  const domain = state.domain;
  $('enhanced-prompt').hidden = !domain;
  if (!domain) { enhancedEnabled = false; paintEnhanced(); return; }
  try { const enabled = await loadEnhanced(domain); if (domain !== state.domain) return; enhancedEnabled = enabled; }
  catch (error) { enhancedEnabled = false; notice(t('无法读取设置：{0}', error.message), true); }
  paintEnhanced();
}
function paintEnhanced() {
  $('enhanced-badge').hidden = !enhancedEnabled;
  const label = enhancedStatus === 'active' ? t('正在增强提取…') : enhancedStatus === 'stopped' ? t('增强提取已停止') : t('增强模式');
  $('enhanced-badge').textContent = '✦ ' + label;
  $('enhanced-description').textContent = t(enhancedEnabled ? '增强模式已开启' : '没有找到需要下载的图片？试试');
  $('enhanced-site').textContent = enhancedEnabled ? state.domain : '';
  $('enhanced-disable').hidden = !enhancedEnabled;
  $('enhanced-settings-link').hidden = enhancedEnabled;
  $('enhanced-note').hidden = enhancedEnabled;
}
$('enhanced-settings-link').addEventListener('click', async event => {
  event.preventDefault();
  if (!state.tab) return;
  try {
    const context = await sourceContext(state.tab.id);
    const params = new URLSearchParams({ tab: String(context.tabId), document: context.documentId, hostname: context.hostname });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`settings.html?${params}#enhanced-settings`) });
  } catch (error) { notice(error.message, true); }
});
$('enhanced-disable').addEventListener('click', async () => {
  if (!state.domain) return;
  $('enhanced-disable').disabled = true;
  try { await saveEnhanced(state.domain, false); await updateEnhanced(); }
  catch (error) { notice(t('保存失败：{0}', error.message), true); }
  finally { $('enhanced-disable').disabled = false; }
});
function requestIncremental() {
  incrementalRequested = true;
  if (incrementalTimer) return;
  incrementalTimer = setTimeout(() => { incrementalTimer = null; void incrementalScan(); }, 500);
}
async function incrementalScan() {
  if (!incrementalRequested || !state.tab || sourceLoading) return;
  if (state.busy || state.scanning || state.retryBatch) { requestIncremental(); return; }
  incrementalRequested = false;
  const generation = state.generation, tabId = state.tab.id;
  state.scanning = true; selectionUI();
  try {
    const result = await scanTab(tabId, state.xpath, state.exclusions);
    if (generation !== state.generation || sourceLoading) return;
    const previous = new Map(state.items.map(item => [item.key, item]));
    for (const item of result.items) {
      const old = previous.get(item.key);
      const changed = old && Number.isFinite(old.resourceSignature) && Number.isFinite(item.resourceSignature) && old.resourceSignature !== item.resourceSignature;
      if (old && !changed && item.origins.some(origin => old.origins.some(before => origin.documentId === before.documentId))) {
        const keep = { previewStatus: old.previewStatus, preview: old.preview, retryPreview: old.retryPreview, previewMethod: old.previewMethod };
        Object.assign(old, item, keep);
        if (item.browserData && old.previewStatus === 'error') { old.previewStatus = ''; old.previewError = ''; }
      } else if (old) {
        if (old.retryPreview) URL.revokeObjectURL(old.retryPreview);
        state.items[state.items.indexOf(old)] = item; thresholdCards.delete(item.key);
      } else state.items.push(item);
    }
    applyIgnored(); render(true);
  } catch (error) { if (generation === state.generation) notice(error.message, true); }
  finally { if (generation === state.generation) {
    state.scanning = false; render(true);
    if (pendingEffective) void syncEffective(); else if (thresholdsReady) void syncThresholds(true);
  } }
}
onExtractionEvent(event => {
  if (event.tabId !== state.tab?.id) return;
  if (event.kind === 'permission') {
    const wasEnabled = enhancedEnabled;
    void updateEnhanced().then(() => { if (enhancedEnabled && !wasEnabled) requestIncremental(); });
  } else if (event.kind === 'changed') requestIncremental();
});
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'enhanced-status' && message.tabId === state.tab?.id) { enhancedStatus = message.status; paintEnhanced(); }
});

const sourceLabels = { img: '页面图片', src: '图片地址', css: 'CSS', pseudo: '伪元素', canvas: 'Canvas', svg: 'SVG', 'svg-image': 'SVG 图片', lazy: '懒加载', srcset: '响应式', poster: '视频封面', resource: '资源', link: '图片链接' };
let directory = null, directoryReady = false, locationBusy = false;
let lastDownloadId = null;
let queryRevision = 0;
let effectiveState = null, pendingEffective = false, effectiveRequest = 0;
let thresholdRevision = 0, thresholdsReady = false;
let thresholdWrites = Promise.resolve();
const thresholdState = { values: { ...DEFAULT_THRESHOLDS }, defaults: { ...DEFAULT_THRESHOLDS }, overrides: {} };
const dimensionDrafts = { width: '', height: '' }, resettingDimensions = new Set();
const thresholdCards = new Map();
let panelTabId = null, sourceLoading = false;
let readyFirst = false, previewOrderTimer;
let manifestEnabled = false, manifestReady = false, manifestError = '', manifestRevision = 0;
async function reloadManifestPreference() {
  const revision = ++manifestRevision;
  try {
    const enabled = await loadDownloadManifest();
    if (revision !== manifestRevision) return;
    manifestEnabled = enabled; manifestReady = true; manifestError = '';
  } catch (error) {
    if (revision !== manifestRevision) return;
    manifestReady = false; manifestError = t('无法读取设置：{0}', error.message);
  }
}
const reportBadge = createBadgeBinding(() => ({
  sourceTabId: state.tab?.id, panelTabId,
}));
const titleEditor = bindTitleEditor($('title-editor'), { onChange: updateDestinationUI });
const cancelSelectionGesture = bindGallerySelection($('gallery'), {
  selected: state.selected, disabled: () => state.busy || state.scanning, onChange: selectionUI,
});

function updateDestinationUI() {
  const location = directory ? directory.name : t('浏览器默认下载位置');
  $('download-location').textContent = location;
  $('download-location').title = directory ? t(`已授权目录：{0}（浏览器不提供完整磁盘路径）`, location) : location;
  $('reset-location').hidden = !directory;
}
async function reloadDirectory() {
  try { directory = await loadDirectory(); directoryReady = true; updateDestinationUI(); selectionUI(); }
  catch (error) { directoryReady = false; notice(t(`无法读取下载目录设置：{0}`, error.message), true); }
}
async function changeDirectory(reset = false) {
  if (state.busy || locationBusy || !directoryReady) return;
  locationBusy = true;
  selectionUI();
  try {
    const chosen = reset ? null : await chooseDirectory();
    await saveDirectory(chosen);
    directory = chosen;
    updateDestinationUI();
    notice('');
  } catch (error) {
    if (error.name !== 'AbortError') notice(t(`下载位置未更改：{0}。可在独立标签页中重新选择。`, error.message), true);
  } finally { locationBusy = false; selectionUI(); }
}
$('choose-location').addEventListener('click', () => void changeDirectory());
$('reset-location').addEventListener('click', () => void changeDirectory(true));

function filters() {
  return { query: $('query').value, width: thresholdState.values.width, height: thresholdState.values.height,
    minBytes: normalizeThreshold($('min-size').value) * 1024, showIgnored: $('show-ignored').checked,
    type: $('type').value, source: $('source').value, loaded: $('loaded').checked, sort: $('sort').value, readyFirst };
}
function visible() { return filterImages(state.items, filters(), imageSize); }
function schedulePreviewOrder() {
  if (!readyFirst) return;
  clearTimeout(previewOrderTimer);
  previewOrderTimer = setTimeout(() => {
    if (!readyFirst) return;
    const gallery = $('gallery');
    const cards = new Map([...gallery.children].map(card => [card.dataset.key, card]));
    const ordered = visible().map(item => cards.get(item.key)).filter(Boolean);
    if (ordered.some((card, index) => gallery.children[index] !== card)) {
      cancelSelectionGesture();
      // Move existing nodes so completed previews are not requested again.
      gallery.append(...ordered);
    }
  }, 120);
}
function failedPreviews() { return state.items.filter(item => item.previewStatus === 'error' && (!item.ignored || $('show-ignored').checked)); }
function previewUI(card, item) {
  const failed = item.previewStatus === 'error';
  card.dataset.previewFailed = String(failed);
  card.querySelector('input[type=checkbox]').disabled = state.busy || state.scanning || failed;
  if (failed) {
    state.selected.delete(item.key);
    card.querySelector('input[type=checkbox]').checked = false;
    card.classList.remove('selected');
  }
  card.querySelector('.preview-fallback').hidden = item.previewStatus === 'ready' && !item.previewPending;
  card.querySelector('.preview-fallback use').setAttribute('href', failed && !item.previewPending ? '#icon-image-broken' : '#icon-image');
  const marker = card.querySelector('.preview-origin');
  const origin = previewOrigin(item);
  marker.hidden = item.previewStatus !== 'ready' || !!item.previewPending;
  marker.textContent = origin.label;
  marker.dataset.origin = origin.kind;
  marker.title = origin.detail + t(' 已取得的原文件数据会直接复用于下载；只有缩略图时才继续读取原文件。');
  card.querySelector('img').classList.toggle('failed', failed || !!item.previewPending);
  const retry = card.querySelector('.retry-preview');
  retry.hidden = !failed && !item.previewPending;
  retry.textContent = item.previewPending ? t('正在重试…') : t('↻ 重试加载');
  retry.dataset.pending = String(!!item.previewPending);
  retry.disabled = state.busy || state.scanning || !!item.previewPending || !!state.retryBatch;
  retry.title = item.previewError || t('重新读取并加载这张图片的预览');
  card.querySelector('.preview-fallback small').textContent = item.previewPending ? t('正在重新读取图片…') : failed ? t('预览加载失败，仍可尝试下载') : t('正在加载预览…');
}
function retryUI() {
  const failed = failedPreviews().length;
  const available = failedPreviews().some(item => !item.previewPending);
  const pending = state.items.some(item => item.previewPending);
  $('retry-toolbar').hidden = !failed && !pending && !state.retryBatch && !$('retry-summary').textContent;
  $('retry-failed').disabled = state.busy || state.scanning || !!state.retryBatch || !available;
  $('retry-failed').textContent = state.retryBatch ? t('正在重试失败图片…') : t(`↻ 重试所有失败图片 ({0})`, failed);
}
function releasePreviews() {
  for (const item of state.items) if (item.retryPreview) URL.revokeObjectURL(item.retryPreview);
}
async function retryPreview(item) {
  if (!state.tab || state.busy || state.scanning || item.previewPending) return null;
  const generation = state.generation;
  const tabId = state.tab.id;
  item.previewPending = true;
  render();
  let preview;
  try {
    preview = await loadPreview(tabId, item);
    if (generation !== state.generation) { URL.revokeObjectURL(preview.url); return null; }
    if (item.retryPreview) URL.revokeObjectURL(item.retryPreview);
    Object.assign(item, {
      retryPreview: preview.url, previewMethod: preview.method, previewStatus: 'ready', previewError: '',
      width: preview.width, height: preview.height,
    });
    // A thumbnail describes the preview, not the source file's format or size.
    if (preview.method !== 'decoded-pixels') Object.assign(item, {
      bytes: preview.bytes, mime: preview.mime,
      sizeSource: '重试读取的图片数据大小（像素兜底时为 PNG）',
    });
    return true;
  } catch (error) {
    if (generation !== state.generation) return null;
    item.previewStatus = 'error';
    item.previewError = error.message;
    return false;
  } finally {
    item.previewPending = false;
    if (generation === state.generation) { render(); retryUI(); }
  }
}
async function retryAllPreviews() {
  if (state.retryBatch || state.busy || state.scanning) return;
  const items = failedPreviews().filter(item => !item.previewPending);
  if (!items.length) return;
  const batch = Symbol('preview-retry');
  state.retryBatch = batch;
  let cursor = 0, done = 0, failed = 0;
  const progress = () => { $('retry-summary').textContent = t(`成功 {0} · 失败 {1} · 共 {2} 张`, done, failed, items.length); };
  progress(); render();
  const worker = async () => {
    while (state.retryBatch === batch && cursor < items.length) {
      const result = await retryPreview(items[cursor++]);
      if (state.retryBatch !== batch) return;
      if (result === true) done++; else if (result === false) failed++;
      progress();
    }
  };
  await Promise.all([worker(), worker()]);
  if (state.retryBatch === batch) { state.retryBatch = null; render(); }
}
const thresholdInputs = { width: 'min-width', height: 'min-height', minBytes: 'min-size' };
function updateDimensionInputs(skipFocused = false) {
  for (const field of ['width', 'height']) {
    const input = $(thresholdInputs[field]);
    const inherited = !Object.hasOwn(thresholdState.overrides, field);
    const remote = Object.hasOwn(effectiveState?.remoteOptions || {}, field);
    const label = remote ? '远程默认({0})' : '全局默认({0})';
    input.placeholder = inherited ? t(label, thresholdState.defaults[field]) : '';
    input.title = t(label, thresholdState.defaults[field]);
    const resetLabel = remote ? (field === 'width' ? '还原宽度远程默认' : '还原高度远程默认') : (field === 'width' ? '还原宽度全局默认' : '还原高度全局默认');
    $(`reset-min-${field}`).title = t(resetLabel);
    $(`reset-min-${field}`).setAttribute('aria-label', t(resetLabel));
    if (!(skipFocused && document.activeElement === input)) {
      input.value = inherited ? '' : String(thresholdState.overrides[field]);
      dimensionDrafts[field] = input.value;
    }
  }
}
function applyThresholdState(snapshot, skipFocused = false) {
  Object.assign(thresholdState, snapshot);
  updateDimensionInputs(skipFocused);
  if (!skipFocused || document.activeElement !== $('min-size')) $('min-size').value = snapshot.values.minBytes / 1024;
}
function queueThresholdSave(domain, values) {
  const operation = thresholdWrites.then(() => saveThresholds(domain, values));
  thresholdWrites = operation.catch(() => {});
  return operation;
}
function applyIgnored() {
  for (const item of state.items) {
    const wasIgnored = item.ignored;
    item.ignored = !!item.ignoreHash && state.ignored.has(item.ignoreHash);
    if (item.ignored && !wasIgnored) state.selected.delete(item.key);
  }
  $('ignored-count').textContent = `(${state.items.filter(item => item.ignored).length})`;
}
async function toggleIgnored(item) {
  if (!state.domain || !item.ignoreHash || state.busy) return;
  try {
    await setIgnored(state.domain, item.ignoreHash, !item.ignored);
    // storage.onChanged also synchronizes other open panels.
    state.ignored = await loadIgnored(state.domain);
    applyIgnored(); render();
  } catch (error) { notice(t(`忽略规则保存失败：{0}`, error.message), true); }
}
function notice(message, error = false, suffix = '') {
  $('notice').textContent = message;
  if (suffix) $('notice').append(' ', suffix);
  $('notice').hidden = !message;
  $('notice').classList.toggle('error', error);
}
function selectAllUI(shown = visible()) {
  const selectedShown = shown.filter(item => state.selected.has(item.key)).length;
  const selectable = shown.filter(item => item.previewStatus === 'ready' && !item.previewPending);
  const allSelected = selectable.length > 0 && selectable.every(item => state.selected.has(item.key));
  $('select-all').checked = allSelected;
  $('select-all').indeterminate = selectedShown > 0 && !allSelected;
  $('select-all').disabled = state.busy || state.scanning || (!selectable.length && !selectedShown);
  $('select-all').title = t('全选已成功加载预览的图片；取消时清除当前列表的选择');
  return selectedShown;
}
function selectionUI() {
  for (const item of state.items) if (item.previewStatus === 'error') state.selected.delete(item.key);
  if (!sourceLoading) sourceHighlights.update(state.tab?.id, state.items.filter(item => state.selected.has(item.key)));
  const shown = visible();
  const previewWork = !!state.retryBatch || state.items.some(item => item.previewPending);
  const selectedShown = selectAllUI(shown);
  const hiddenSelected = state.selected.size - selectedShown;
  $('selection-count').textContent = t(`已选择 {0} 张{1}`, state.selected.size, hiddenSelected ? t(`（含 {0} 张被筛选隐藏）`, hiddenSelected) : '');
  $('selection-count').hidden = state.selected.size === 0;
  $('download').disabled = state.busy || state.scanning || previewWork || locationBusy || !directoryReady || !manifestReady || !state.selected.size;
  $('refresh').disabled = state.busy || state.scanning;
  $('format').disabled = state.busy || previewWork;
  $('expand').disabled = !state.tab || state.busy;
  titleEditor.setDisabled(state.busy || state.scanning || !state.tab);
  for (const id of ['choose-location', 'reset-location']) $(id).disabled = state.busy || locationBusy || !directoryReady;
  for (const id of ['apply-xpath', 'clear-xpath', 'xpath', 'excluded-selectors']) $(id).disabled = state.busy || state.scanning || !state.domain;
  for (const input of $('gallery').querySelectorAll('input,button')) input.disabled = state.busy;
  for (const card of $('gallery').children) card.querySelector('input[type=checkbox]').disabled = state.busy || state.scanning || card.dataset.previewFailed === 'true';
  for (const button of $('gallery').querySelectorAll('.ignore-image[data-unavailable]')) button.disabled = true;
  for (const button of $('gallery').querySelectorAll('.single-download')) button.disabled = state.busy || previewWork || locationBusy || !directoryReady || !manifestReady;
  for (const button of $('gallery').querySelectorAll('.retry-preview')) button.disabled = state.busy || state.scanning || !!state.retryBatch || button.dataset.pending === 'true';
  for (const id of [...Object.values(thresholdInputs), 'defaults', 'reset']) $(id).disabled = state.scanning || !state.domain || !thresholdsReady;
  for (const field of ['width', 'height']) $(`reset-min-${field}`).disabled = state.scanning || state.busy || !state.domain || !thresholdsReady || resettingDimensions.has(field) || !Object.hasOwn(thresholdState.overrides, field);
  retryUI();
}

function updateCard(card, item) {
  const result = state.results.get(item.key);
  const status = card.querySelector('.item-status');
  const text = result?.misplaced ? t('已下载 · 目录异常') : result?.error ? t('下载失败 · 可重试') : result?.pending ? t('正在读取 / 下载…') : result?.skipped ? t('内容相同 · 已跳过') : result?.method ? t(METHOD_LABELS[result.method]) : item.loaded ? t('页面已加载') : t('候选资源');
  const size = result?.bytes ? formatBytes(result.bytes) : '';
  const conversion = result?.format && result.format !== 'original' ? ` → ${result.format.toUpperCase()}` : '';
  status.textContent = `${text}${conversion}${size ? ` · ${size}` : ''}`;
  status.title = result?.error || status.textContent;
  status.className = `item-status${result?.error ? ' error' : result?.method ? ' success' : ''}`;
  card.classList.toggle('selected', state.selected.has(item.key));
  card.querySelector('input').checked = state.selected.has(item.key);
  card.classList.toggle('ignored', item.ignored);
  card.querySelector('.ignored-badge').hidden = !item.ignored;
  const ignore = card.querySelector('.ignore-image');
  ignore.textContent = item.ignored ? t('取消忽略') : t('忽略');
  ignore.setAttribute('aria-label', item.ignored ? t('取消忽略这张图片') : t('忽略这张图片'));
  ignore.title = item.ignoreHash ? t(`{0} {1} 下的图片忽略规则`, item.ignored ? t('取消') : t('保存'), state.domain) : t('无法取得稳定的图片元数据，暂不能忽略');
  if (!item.ignoreHash) ignore.dataset.unavailable = '';
  const fileSize = imageSize(item);
  card.querySelector('.image-size').textContent = formatBytes(fileSize.bytes, fileSize.estimated);
  card.querySelector('.image-size').title = `${t(fileSize.source)}${fileSize.bytes != null ? ` · ${fileSize.estimated ? t('约 ') : ''}${fileSize.bytes} B` : ''}`;
  previewUI(card, item);
}

function render(preservePreviews = false) {
  cancelSelectionGesture();
  reportBadge();
  $('site-rules-count').textContent = [state.xpath && t('XPath 范围'), state.exclusions && t('CSS 排除')].filter(Boolean).join(' · ') || t('未启用');
  $('ignore-scope').textContent = state.domain ? t(`忽略规则仅应用于 {0} 的所有路径（不区分协议和端口）。`, state.domain) : '';
  const layoutLabel = $('gallery').classList.contains('list') ? t('切换为网格布局') : t('切换为列表布局');
  $('layout').setAttribute('aria-label', layoutLabel);
  $('layout').title = layoutLabel;
  const source = effectiveState?.remote;
  const sourceText = source ? t('远程来源：{0} · 规则 {1}', `${source.domain}.json`, source.rule) : '';
  for (const id of ['effective-rules-source', 'active-remote-rule']) {
    $(id).textContent = effectiveState?.error ? t('远程规则读取失败：{0}', effectiveState.error) : sourceText;
    $(id).title = source ? `${source.url} · ${source.rule}` : '';
    $(id).hidden = !$(id).textContent;
  }
  $('active-rule-domain').textContent = state.domain ? t(`{0} · 已保存的规则；可在页面上方修改。`, state.domain) : t('当前页面未配置网站过滤规则。');
  for (const [id, value] of [['active-xpath', state.xpath], ['active-css', state.exclusions]]) {
    $(id).textContent = value || t('未配置');
    $(id).classList.toggle('unconfigured', !value);
    const field = id === 'active-xpath' ? 'xpath' : 'excludedSelectors';
    $(id).title = effectiveState?.origins[field] === 'remote' && source ? `${source.url} · ${source.rule}` : value;
  }
  const items = visible();
  $('visible-count').textContent = t(`{0} 张图片`, items.length);
  const f = filters();
  const count = [f.width, f.height, f.minBytes, f.type, f.source, f.loaded, f.showIgnored].filter(Boolean).length;
  $('filter-count').textContent = count ? t(`{0} 项`, count) : '';
  $('empty').hidden = items.length > 0;
  $('empty').querySelector('h3').textContent = state.scanning ? t('正在扫描页面…') : state.items.length ? t('没有符合条件的图片') : t('还没有图片');
  $('empty').querySelector('p').textContent = state.items.length ? t('调整筛选条件，或清除筛选后查看。') : t('滚动页面让懒加载图片出现，再点击右上角重新扫描。');
  const fragment = document.createDocumentFragment();
  if (preservePreviews !== true) thresholdCards.clear();
  for (const item of items) {
    const existing = item.previewStatus === 'ready' && !item.previewPending ? thresholdCards.get(item.key) : null;
    if (existing) { updateCard(existing, item); fragment.append(existing); continue; }
    const card = $('card-template').content.firstElementChild.cloneNode(true);
    card.dataset.key = item.key;
    thresholdCards.set(item.key, card);
    const image = card.querySelector('img');
    const generation = state.generation;
    if (item.kind === 'canvas' && !item.preview && !item.retryPreview) item.previewStatus = 'error';
    image.alt = item.alt || t('页面图片预览');
    image.addEventListener('error', () => {
      if (generation !== state.generation || !card.isConnected || item.previewPending) return;
      item.previewStatus = 'error';
      schedulePreviewOrder();
      item.previewError ||= t('图片预览加载失败；点击重试会重新读取页面资源并尝试扩展请求。');
      previewUI(card, item); selectionUI(); reportBadge();
    });
    image.addEventListener('load', () => {
      if (generation !== state.generation || !card.isConnected || item.previewPending) return;
      item.previewStatus = 'ready';
      schedulePreviewOrder();
      item.previewError = '';
      previewUI(card, item); selectionUI(); reportBadge();
      if (!item.width && !item.preview) {
        item.width = image.naturalWidth; item.height = image.naturalHeight;
        card.querySelector('.dimensions').textContent = `${item.width} × ${item.height}`;
        // Keep filtering and sorting consistent when previously unknown metadata arrives.
        updateCard(card, item);
        if (filters().width || filters().height || filters().minBytes || filters().sort !== 'position') scheduleRender();
      }
    });
    if (item.previewStatus !== 'error' && !item.previewPending) image.src = item.retryPreview || item.browserData || item.preview || item.url;
    card.querySelector('.dimensions').textContent = item.width && item.height ? `${Math.round(item.width)} × ${Math.round(item.height)}` : t('尺寸未知');
    card.querySelector('.type-badge').textContent = imageType(item) === 'unknown' ? '?' : imageType(item);
    card.querySelector('.source-badge').textContent = t(sourceLabels[item.sources[0]] || item.sources[0]);
    card.querySelector('.source-badge').title = item.sources.map(s => t(sourceLabels[s] || s)).join(' / ');
    card.querySelector('.image-url').textContent = /^(data:|blob:)/.test(item.url) ? t(`{0}: 页面内嵌资源`, item.url.split(':')[0]) : item.url;
    card.querySelector('.image-url').title = item.url.slice(0, 2000);
    card.querySelector('input').addEventListener('change', event => {
      if (event.target.checked && item.previewStatus !== 'error') state.selected.add(item.key); else state.selected.delete(item.key);
      updateCard(card, item); selectionUI();
    });
    card.querySelector('.single-download').addEventListener('click', () => void runDownloads([item]));
    card.querySelector('.ignore-image').addEventListener('click', () => void toggleIgnored(item));
    card.querySelector('.retry-preview').addEventListener('click', () => {
      if (state.retryBatch) return;
      $('retry-summary').textContent = '';
      void retryPreview(item);
    });
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
  sourceHighlights.clear();
  thresholdRevision++; thresholdsReady = false; thresholdCards.clear();
  releasePreviews();
  state.retryBatch = null;
  $('retry-summary').textContent = '';
  state.tab = tab;
  sourceLoading = false;
  const domain = siteDomain(tab.url);
  if (domain !== state.domain) { state.xpath = ''; state.exclusions = ''; $('query').value = ''; queryRevision++; }
  state.domain = domain;
  enhancedStatus = 'idle'; void updateEnhanced();
  const queryVersion = queryRevision;
  state.ignored = new Set();
  state.scanning = true;
  state.items = []; state.selected.clear(); state.results.clear();
  $('ignored-count').textContent = '(0)';
  $('ignore-scope').textContent = state.domain ? t(`忽略规则仅应用于 {0} 的所有路径（不区分协议和端口）。`, state.domain) : '';
  $('progress').textContent = t('下载时自动创建标题文件夹');
  titleEditor.setPage(tab);
  try { $('page-host').textContent = new URL(tab.url).host; } catch { $('page-host').textContent = tab.url || ''; }
  $('page-host').title = $('page-host').textContent;
  delete document.querySelector('.page-context').dataset.frames;
  notice(''); render();
  try {
    if (!/^https?:/.test(tab.url || '')) throw new Error(t('请切换到普通 HTTP / HTTPS 网页。浏览器内部页、商店页及 PDF 阅读器可能不允许扩展访问。'));
    if (!manifestReady) await reloadManifestPreference();
    await thresholdWrites;
    const thresholds = await loadEffectivePreferences(tab.url);
    const { xpath, excludedSelectors: exclusions, query } = thresholds.values;
    if (generation !== state.generation) return;
    effectiveState = thresholds; applyViewFilters(thresholds.values);
    applyThresholdState(thresholds); thresholdsReady = true;
    if (queryRevision === queryVersion) $('query').value = query;
    state.xpath = xpath; state.exclusions = exclusions;
    $('site-rules-count').textContent = [xpath && t('XPath 范围'), exclusions && t('CSS 排除')].filter(Boolean).join(' · ') || t('未启用');
    $('xpath').value = xpath; $('excluded-selectors').value = exclusions;
    $('xpath-status').classList.remove('error');
    $('xpath-status').textContent = t(`规则应用于 {0} 的所有路径（不区分协议和端口）。`, state.domain);
    const result = await scanTab(tab.id, xpath, exclusions);
    const ignored = await loadIgnored(siteDomain(tab.url));
    if (generation !== state.generation) return;
    state.items = result.items;
    state.ignored = ignored;
    applyIgnored();
    document.querySelector('.page-context').dataset.frames = String(result.frames);
    if (xpath) $('xpath-status').textContent = t(`{0} · XPath 匹配 {1} 个节点 · 提取 {2} 张图片`, state.domain, result.matchedRoots, result.items.length);
    if (xpath && !result.matchedRoots) notice(t('XPath 未匹配任何节点。请检查路径或等待页面内容加载后重新扫描。'));
    else if (result.truncated) notice(t('图片过多：已达到单个框架 4000 个地址或 12 MiB 地址数据的上限，部分图片未列出。'));
    else if (!result.items.length) notice(t('尚未发现图片。请先滚动或展开页面内容，然后重新扫描；部分受保护的框架可能无法访问。'));
  } catch (error) {
    if (generation !== state.generation) return;
    $('xpath-status').textContent = error.message;
    $('xpath-status').classList.add('error');
    notice(t(`扫描失败：{0}`, error.message), true);
  } finally {
    if (generation === state.generation) {
      state.scanning = false; render(); if (thresholdsReady) void syncThresholds();
      if (pendingEffective) void syncEffective();
      if (!manifestReady) notice(manifestError, true);
    }
  }
}

async function runDownloads(items) {
  if (state.busy || state.scanning || locationBusy || !directoryReady || !manifestReady || state.retryBatch || state.items.some(item => item.previewPending) || !state.tab || !items.length) return;
  titleEditor.commit();
  const tabId = state.tab.id;
  const format = $('format').value;
  const root = directory;
  const title = titleEditor.value;
  const manifest = manifestEnabled ? createManifestBatch(items, title) : null;
  lastDownloadId = null;
  $('show-download').hidden = true;
  state.busy = true;
  let done = 0, skipped = 0, failed = 0, misplaced = 0, cursor = 0;
  notice(''); selectionUI();
  let destination;
  try { destination = await prepareDestination(root, title); }
  catch (error) {
    state.busy = false; selectionUI();
    notice(t(`无法准备下载目录：{0}。请重新选择目录或恢复默认位置。`, error.message), true);
    if (state.pendingTab) { const tab = state.pendingTab; state.pendingTab = null; await refresh(tab); }
    else if (pendingEffective) await syncEffective();
    return;
  }
  // Two concurrent images bound memory and avoid flooding sites with requests.
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++, item = items[index];
      state.results.set(item.key, { pending: true });
      render();
      try {
        const result = await downloadImage(tabId, item, item.order, format, destination);
        if (Number.isInteger(result.downloadId)) lastDownloadId = result.downloadId;
        const bytes = result.sourceBytes ?? (format === 'original' ? result.bytes : null);
        if (bytes >= 0 && bytes != null) { item.bytes = bytes; item.sizeSource = '实际读取的源图片数据大小（像素兜底时为 PNG）'; }
        if (result.sourceMime) item.mime = result.sourceMime;
        else if (result.mime && format === 'original') item.mime = result.mime;
        state.results.set(item.key, result);
        if (manifest) manifest.entries[index].result = { ...result };
        if (result.skipped) skipped++; else done++;
      } catch (error) {
        if (Number.isInteger(error.downloadId)) lastDownloadId = error.downloadId;
        if (error.actualPath) misplaced++;
        const result = { error: error.message, misplaced: !!error.actualPath, actualPath: error.actualPath };
        state.results.set(item.key, result);
        if (manifest) manifest.entries[index].result = result;
        failed++;
      }
      $('progress').textContent = t(`已处理 {0} / {1} · 新保存 {2}{3}{4} · 下载期间请保持此面板打开`, done + skipped + failed, items.length, done, skipped ? t(` · 跳过 {0}`, skipped) : '', failed ? t(` · 失败 {0}`, failed) : '');
      render();
      $('show-download').hidden = !Number.isInteger(lastDownloadId);
    }
  };
  $('progress').textContent = t(`正在下载 {0} 张图片，请保持面板打开…`, items.length);
  await Promise.all([worker(), worker()]);
  let manifestFailure = '';
  if (manifest) {
    $('progress').textContent = t('正在保存图片清单…');
    try {
      const result = await saveManifest(manifest, destination);
      if (Number.isInteger(result.downloadId)) lastDownloadId = result.downloadId;
    } catch (error) { manifestFailure = error.message; }
    $('progress').textContent = t(`已处理 {0} / {1} · 新保存 {2}{3}{4} · 下载期间请保持此面板打开`, done + skipped + failed, items.length, done, skipped ? t(` · 跳过 {0}`, skipped) : '', failed ? t(` · 失败 {0}`, failed) : '');
    $('show-download').hidden = !Number.isInteger(lastDownloadId);
  }
  state.busy = false;
  selectionUI();
  if (misplaced) notice(t(`{0} 张按配置保存，{1} 张已下载但目录被改写{2}。点击「打开下载位置」查看实际文件；可选择本地目录后重试。`, done, misplaced, failed > misplaced ? t(`，另有 {0} 张下载失败`, failed - misplaced) : ''), true);
  else if (failed) notice(t(`{0} 张下载完成，{1} 张失败。悬停失败标记可查看原因；可单独重试。`, done, failed), true);
  else if (skipped) notice(t(`{0} 张图片已下载到「{1}」文件夹，跳过 {2} 张内容相同的图片。`, done, destination.folder, skipped));
  else notice(t(`{0} 张图片已下载到「{1}」文件夹。`, done, destination.folder));
  if (manifest) notice($('notice').textContent, !!manifestFailure || failed > 0, manifestFailure ? t('图片清单保存失败：{0}。已保存的图片保留。', manifestFailure) : t('图片清单已保存。'));
  if (state.pendingTab) { const tab = state.pendingTab; state.pendingTab = null; await refresh(tab); }
  else if (pendingEffective) await syncEffective();
}

async function applySiteRules(clear = false) {
  if (!state.tab || state.busy || state.scanning) return;
  const domain = state.domain;
  const tab = state.tab;
  try {
    // Persist the pair atomically; other panels must never scan half an update.
    const xpath = clear ? '' : $('xpath').value.trim();
    const exclusions = clear ? '' : $('excluded-selectors').value.trim();
    if (xpath) document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (const selector of exclusions.split('\n').map(s => s.trim()).filter(Boolean)) document.querySelector(selector);
    state.xpath = xpath; state.exclusions = exclusions;
    await saveConfig({ [xpathStorageKey(domain)]: xpath, [exclusionsStorageKey(domain)]: exclusions });
    if (state.domain === domain) await refresh(tab);
  } catch (error) {
    $('xpath-status').textContent = t(`网站规则未保存：{0}`, error.message);
    $('xpath-status').classList.add('error');
  }
}
$('apply-xpath').addEventListener('click', () => void applySiteRules());
$('clear-xpath').addEventListener('click', () => void applySiteRules(true));

// Apply remote revisions without rebuilding successful preview nodes or saving defaults.
async function syncEffective(preserveQuery = false) {
  if (!state.tab) return;
  if (state.busy || state.scanning) { pendingEffective = true; return; }
  pendingEffective = false;
  const request = ++effectiveRequest, generation = state.generation, url = state.tab.url, queryVersion = queryRevision;
  try {
    const next = await loadEffectivePreferences(url);
    if (request !== effectiveRequest || generation !== state.generation || state.tab?.url !== url || sourceLoading) return;
    if (state.busy) { pendingEffective = true; return; }
    const structural = state.xpath !== next.values.xpath || state.exclusions !== next.values.excludedSelectors;
    if (structural) {
      state.scanning = true; selectionUI();
      const result = await scanTab(state.tab.id, next.values.xpath, next.values.excludedSelectors);
      if (request !== effectiveRequest || generation !== state.generation || sourceLoading) return;
      const old = new Map(state.items.map(item => [item.key, item]));
      state.items = result.items.map(item => {
        const previous = old.get(item.key);
        if (previous && !(Number.isFinite(previous.resourceSignature) && Number.isFinite(item.resourceSignature) && previous.resourceSignature !== item.resourceSignature) && item.origins.some(origin => previous.origins.some(oldOrigin => oldOrigin.documentId === origin.documentId))) {
          old.delete(item.key);
          // Preserve original blobs held by WeakMaps keyed on this object, and its ready preview.
          const preview = { previewStatus: previous.previewStatus, preview: previous.preview, retryPreview: previous.retryPreview, previewOrigin: previous.previewOrigin };
          Object.assign(previous, item, preview); return previous;
        }
        return item;
      });
      for (const item of old.values()) if (item.retryPreview) URL.revokeObjectURL(item.retryPreview);
      const keys = new Set(state.items.map(item => item.key));
      for (const key of state.selected) if (!keys.has(key)) state.selected.delete(key);
      applyIgnored();
    }
    for (const [id, oldValue, value] of [['xpath', state.xpath, next.values.xpath], ['excluded-selectors', state.exclusions, next.values.excludedSelectors]]) {
      if ($(id).value === oldValue && document.activeElement !== $(id)) $(id).value = value;
    }
    state.xpath = next.values.xpath; state.exclusions = next.values.excludedSelectors;
    effectiveState = next; applyThresholdState(next, true); thresholdsReady = true; applyViewFilters(next.values);
    if (!preserveQuery && queryVersion === queryRevision && document.activeElement !== $('query')) $('query').value = next.values.query;
    render(true);
  } catch (error) { notice(t('远程规则读取失败：{0}', error.message), true); }
  finally {
    if (generation === state.generation && request === effectiveRequest) { state.scanning = false; selectionUI(); if (pendingEffective) void syncEffective(); }
  }
}

async function syncThresholds(skipFocused = false) {
  if (!state.domain || state.scanning) return;
  const domain = state.domain, revision = ++thresholdRevision;
  try {
    await thresholdWrites;
    const values = await loadEffectivePreferences(state.tab.url);
    if (domain !== state.domain || revision !== thresholdRevision) return;
    effectiveState = values; applyThresholdState(values, skipFocused); thresholdsReady = true; render(true);
  } catch (error) {
    if (domain === state.domain && revision === thresholdRevision) {
      thresholdsReady = false; selectionUI(); notice(t('筛选设置保存失败：{0}', error.message), true);
    }
  }
}
$('query').addEventListener('input', () => {
  queryRevision++;
  void saveQuery(state.domain, $('query').value, Object.hasOwn(effectiveState?.remoteOptions || {}, 'query')).catch(error => notice(t(`搜索内容保存失败：{0}`, error.message), true));
  scheduleRender();
});
for (const [field, id] of Object.entries(thresholdInputs)) {
  const input = $(id);
  const dimension = field !== 'minBytes';
  let composing = false;
  function acceptInput() {
    if (!thresholdsReady || !state.domain || state.scanning || composing) return;
    if (dimension) {
      if (input.value === '') { dimensionDrafts[field] = ''; return; }
      if (!/^[0-9]+$/.test(input.value) || Number(input.value) > 100000) {
        input.value = dimensionDrafts[field];
        notice(t('请输入 0 至 100000 的整数。'), true);
        return;
      }
      dimensionDrafts[field] = input.value;
    }
    const domain = state.domain;
    thresholdRevision++;
    const value = normalizeThreshold(input.value) * (dimension ? 1 : 1024);
    thresholdState.values[field] = value; thresholdState.overrides[field] = value;
    if (dimension) { input.placeholder = ''; }
    render(true);
    void queueThresholdSave(domain, { [field]: value }).catch(async error => {
      if (domain !== state.domain) return;
      await syncThresholds();
      if (domain === state.domain) notice(t('筛选设置保存失败：{0}', error.message), true);
    });
  }
  if (dimension) {
    input.addEventListener('beforeinput', event => {
      if (event.isComposing || event.inputType?.startsWith('delete') || event.data == null) return;
      const candidate = input.value.slice(0, input.selectionStart) + event.data + input.value.slice(input.selectionEnd);
      if (!/^[0-9]*$/.test(candidate) || Number(candidate) > 100000) event.preventDefault();
    });
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; acceptInput(); });
    $(`reset-min-${field}`).addEventListener('click', async () => {
      if (!thresholdsReady || !state.domain || state.scanning || state.busy || resettingDimensions.has(field)) return;
      const domain = state.domain;
      thresholdRevision++; resettingDimensions.add(field); selectionUI();
      try {
        await thresholdWrites;
        await resetThresholds(domain, [field]);
        if (domain === state.domain) await syncThresholds();
      } catch (error) { if (domain === state.domain) notice(t('筛选设置保存失败：{0}', error.message), true); }
      finally { resettingDimensions.delete(field); selectionUI(); }
    });
  }
  input.addEventListener('input', acceptInput);
  input.addEventListener('blur', () => { if (thresholdsReady) void syncThresholds(); });
}
function applyViewFilters(value) {
  const view = normalizeViewFilters(value);
  $('type').value = view.type; $('source').value = view.source;
  $('loaded').checked = view.loaded; $('show-ignored').checked = view.showIgnored;
}
for (const id of ['type', 'source', 'loaded', 'show-ignored']) $(id).addEventListener('change', () => {
  render();
  void saveViewFilters(filters()).catch(error => notice(error.message, true));
});
$('sort').addEventListener('change', render);
$('reset').addEventListener('click', async () => {
  if (!thresholdsReady || !state.domain || state.scanning) return;
  const domain = state.domain;
  thresholdRevision++; queryRevision++;
  $('query').value = ''; $('type').value = ''; $('source').value = '';
  $('loaded').checked = false; $('show-ignored').checked = false;
  try {
    // Queue all reset writes immediately, before any later user edits. Read the
    // committed thresholds before displaying zeros so a reload cannot lose them.
    await Promise.all([
      saveQuery(domain, '', Object.hasOwn(effectiveState?.remoteOptions || {}, 'query')),
      saveViewFilters({ type: '', source: '', loaded: false, showIgnored: false }),
      queueThresholdSave(domain, { width: 0, height: 0, minBytes: 0 }),
    ]);
    if (domain === state.domain) await syncThresholds(true);
  } catch (error) { notice(error.message, true); }
});
$('defaults').addEventListener('click', async () => {
  if (!thresholdsReady || !state.domain || state.scanning) return;
  const domain = state.domain;
  thresholdRevision++;
  try { await thresholdWrites; await resetThresholds(domain); if (domain === state.domain) await syncThresholds(); }
  catch (error) { if (domain === state.domain) notice(error.message, true); }
});
async function syncPrompt() {
  const values = await chrome.storage.local.get(SYNC_STATE_KEY);
  $('sync-prompt').hidden = values[SYNC_STATE_KEY]?.state !== 'conflict';
}
void syncPrompt().catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[SYNC_STATE_KEY]) void syncPrompt().catch(() => {});
  if (changes[SYNC_IMPORT_KEY]) {
    if (changes[DOWNLOAD_MANIFEST_KEY]) { manifestRevision++; manifestEnabled = changes[DOWNLOAD_MANIFEST_KEY].newValue === true; manifestReady = true; manifestError = ''; }
    if (changes[TITLE_CLEANUP_KEY]) titleEditor.setCleanup(changes[TITLE_CLEANUP_KEY].newValue === true);
    if (changes[READY_FIRST_KEY]) readyFirst = changes[READY_FIRST_KEY].newValue !== false;
    const domain = state.domain, generation = state.generation;
    void loadIgnored(domain).then(values => {
      if (domain !== state.domain || generation !== state.generation) return;
      state.ignored = values; applyIgnored(); return syncEffective();
    }).catch(error => notice(error.message, true));
    return;
  }
  if (Object.keys(changes).every(key => key.startsWith('config-sync:') || key === 'settings:chrome-sync')) return;

  if (changes[REMOTE_RULES_KEY]) {
    if (rulesChanged(changes[REMOTE_RULES_KEY])) void syncEffective();
    if (Object.keys(changes).length === 1) return;
  }
  if (changes[DOWNLOAD_MANIFEST_KEY]) {
    manifestRevision++;
    manifestEnabled = changes[DOWNLOAD_MANIFEST_KEY].newValue === true;
    manifestReady = true; manifestError = ''; selectionUI();
    if (Object.keys(changes).length === 1) return;
  }
  if (changes[TITLE_CLEANUP_KEY]) titleEditor.setCleanup(changes[TITLE_CLEANUP_KEY].newValue === true);
  if (changes[VIEW_FILTERS_KEY]) void syncEffective(true);
  if (changes[READY_FIRST_KEY]) readyFirst = changes[READY_FIRST_KEY].newValue !== false;
  // Search history is restored on scan/open. Saving it must not interrupt a
  // gesture or replace another panel's current, possibly unfinished search.
  if (Object.keys(changes).every(key => key.startsWith('image-query:v1:') || key === THEME_KEY)) return;
  if (directoryChanged(changes)) { void reloadDirectory(); return; }
  if (thresholdChanges(changes, state.domain)) { void syncThresholds(true); }
  // Threshold-only events must not rebuild previews or affect another site.
  if (Object.keys(changes).every(key => key.startsWith('filters:site:') || key === 'filters:width' || key === 'filters:height' || key === 'filters:minBytes')) return;
  const xpathChange = changes[xpathStorageKey(state.domain)];
  const exclusionsChange = changes[exclusionsStorageKey(state.domain)];
  if (state.tab && ((xpathChange && (xpathChange.newValue || '') !== state.xpath) ||
      (exclusionsChange && (exclusionsChange.newValue || '') !== state.exclusions))) void refresh();
  const change = changes[ignoreStorageKey(state.domain)];
  if (change) {
    state.ignored = new Set(Array.isArray(change.newValue) ? change.newValue : []);
    applyIgnored();
  }
  render();
});
$('select-all').addEventListener('change', event => {
  for (const item of visible()) {
    if (event.target.checked && item.previewStatus === 'ready' && !item.previewPending) state.selected.add(item.key);
    else state.selected.delete(item.key);
  }
  render();
});
$('layout').addEventListener('click', () => {
  const list = $('gallery').classList.toggle('list');
  $('layout').dataset.view = list ? 'list' : 'grid';
  $('layout').setAttribute('aria-label', list ? t('切换为网格布局') : t('切换为列表布局'));
});
$('refresh').addEventListener('click', async () => {
  if (state.tab) { try { await refresh(await chrome.tabs.get(state.tab.id)); } catch (error) { notice(error.message, true); } }
});
$('format').addEventListener('change', () => { $('conversion-note').hidden = $('format').value === 'original'; });
$('retry-failed').addEventListener('click', () => void retryAllPreviews());
$('download').addEventListener('click', () => void runDownloads(state.items.filter(item => state.selected.has(item.key))));
$('show-download').addEventListener('click', () => {
  if (Number.isInteger(lastDownloadId)) chrome.downloads.show(lastDownloadId);
});
$('expand').addEventListener('click', () => {
  if (state.tab) void chrome.tabs.create({ url: chrome.runtime.getURL(`panel.html?tab=${state.tab.id}`) });
});
$('settings').addEventListener('click', () => void chrome.runtime.openOptionsPage());
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
  if (tabId !== state.tab?.id) return;
  if (change.status === 'loading') { sourceLoading = true; sourceHighlights.clear(); reportBadge(); }
  if (change.status === 'complete') void refresh(tab);
});
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId !== state.tab?.id) return;
  sourceHighlights.clear();
  releasePreviews();
  state.retryBatch = null;
  thresholdRevision++; thresholdsReady = false; thresholdCards.clear();
  state.generation++; state.tab = null; state.domain = ''; state.xpath = ''; state.exclusions = ''; state.items = []; state.selected.clear(); state.scanning = false;
  sourceLoading = false;
  $('query').value = ''; queryRevision++;
  notice(t('原页面已关闭。请切换到另一个网页。')); render();
});
window.addEventListener('pagehide', releasePreviews);
window.addEventListener('pagehide', () => sourceHighlights.clear());
window.addEventListener('pageshow', () => selectionUI());

let localizationReady = false;
window.addEventListener('imagetaken-languagechange', event => {
  if (!localizationReady) return;
  localizeDocument();
  // Keep independently translated image and manifest messages as separate text nodes.
  for (const node of $('notice').childNodes) node.textContent = translateRendered(node.textContent, event.previousLanguage);
  for (const id of ['progress', 'retry-summary', 'xpath-status']) {
    $(id).textContent = translateRendered($(id).textContent, event.previousLanguage);
  }
  for (const item of state.items) if (item.previewError) item.previewError = translateRendered(item.previewError, event.previousLanguage);
  for (const result of state.results.values()) if (result.error) result.error = translateRendered(result.error, event.previousLanguage);
  titleEditor.localize();
  updateDimensionInputs(true);
  updateDestinationUI(); paintEnhanced(); render();
});

try {
  await initI18n();
  bindDocument(); localizationReady = true;
  titleEditor.setCleanup(await loadTitleCleanup());
  readyFirst = await loadReadyFirst();
  await reloadManifestPreference();
  if (pinnedId) panelTabId = (await chrome.tabs.getCurrent())?.id ?? null;
  await reloadDirectory();
  applyViewFilters(await loadViewFilters());
  const tab = pinnedId ? await chrome.tabs.get(pinnedId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  await refresh(tab);
} catch (error) { notice(error.message, true); }
