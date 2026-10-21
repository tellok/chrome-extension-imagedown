import { t } from './i18n.js';
import { SYNC_STATE_KEY, SYNC_ENABLED_KEY } from './settings-sync-codec.js';
export async function syncRequest(operation, values = {}) {
  const result = await chrome.runtime.sendMessage({ type: 'settings-sync', operation, ...values });
  if (!result?.ok) throw new Error(result?.error || 'Sync unavailable');
  return result.result;
}
export function bindSettingsSync() {
  const $ = id => document.getElementById(id);
  const toggle = $('chrome-sync'), status = $('sync-status'), conflict = $('sync-conflict'), differences = $('sync-differences');
  const labels = { checking: '正在检查同步设置…', disabled: '此机器已关闭同步', equal: '已写入 Chrome 同步存储', pending: '等待写入同步存储', conflict: '发现不同配置，请选择使用的版本。', 'waiting-data': '等待完整同步数据', error: '配置同步失败：{0}' };
  let current, busy = false, ready = false;
  const fieldLabels = { 'settings:language': '界面语言', 'settings:theme': '主题', 'settings:auto-clean-title': '自动清洗标题', 'settings:ready-first': '优先展示成功加载的图片', 'settings:download-manifest': '同时下载图片清单', 'filters:width': '全局默认最低宽度', 'filters:height': '全局默认最低高度', 'filters:view:v1': '图片筛选', width: '最小宽度', height: '最小高度', minBytes: '最小体积', xpath: 'XPath 范围', excludedSelectors: 'CSS 排除', query: '搜索图片地址或描述', ignored: '忽略', type: '图片格式', source: '发现来源', loaded: '只看页面已解码的图片 / 已渲染的画布', showIgnored: '显示已忽略的图片', subscriptions: '远程规则订阅' };
  const textValue = v => v === undefined ? t('未设置') : JSON.stringify(v);
  function diffRows(local, remote, container, prefix = '', identity = '') {
    for (const key of new Set([...Object.keys(local || {}), ...Object.keys(remote || {})])) {
      const a = local?.[key], b = remote?.[key], name = t(fieldLabels[key] || key), path = prefix ? `${prefix} / ${name}` : name;
      const id = identity ? `${identity}/${key}` : key;
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      if (a && b && !Array.isArray(a) && !Array.isArray(b) && typeof a === 'object' && typeof b === 'object') { diffRows(a, b, container, path, id); continue; }
      const row = document.createElement('details'), summary = document.createElement('summary'), values = document.createElement('pre');
      row.dataset.path = id; summary.textContent = path; values.textContent = `${t('本机设置')}\n${textValue(a)}\n\n${t('Chrome 同步设置')}\n${textValue(b)}`;
      row.append(summary, values); container.append(row);
    }
  }
  function render() {
    if (!current) return;
    if (!busy) toggle.checked = current.enabled !== false;
    toggle.disabled = !ready || busy;
    $('sync-retry').disabled = busy || (!ready ? current.state !== 'error' : !toggle.checked);
    status.textContent = t(labels[current.state] || labels.checking, current.error || '');
    conflict.hidden = current.state !== 'conflict';
    $('sync-use-local').disabled = busy || !ready;
    const expanded = new Set([...differences.querySelectorAll('details[open]')].map(row => row.dataset.path));
    const candidates = $('sync-candidates'); candidates.replaceChildren(); differences.replaceChildren();
    for (const candidate of current.candidates || []) {
      const section = document.createElement('section'), title = document.createElement('p'), choose = document.createElement('button');
      title.textContent = `${candidate.deviceId.slice(0,8)} · ${new Date(candidate.updatedAt).toLocaleString(document.documentElement.lang)}`;
      choose.textContent = t('使用 Chrome 同步设置'); choose.type = 'button'; choose.disabled = busy || !ready;
      choose.addEventListener('click', () => void run('choose', { token: current.token, revision: candidate.revision }));
      section.append(title, choose); candidates.append(section);
      const group = document.createElement('section'), heading = document.createElement('h4'); heading.textContent = title.textContent; group.append(heading);
      for (const [key, label] of [['settings','基础设置'], ['sites','网站设置'], ['subscriptions','远程规则订阅']]) {
        const name = document.createElement('strong'); name.textContent = t(label); group.append(name);
        if (key === 'subscriptions') diffRows({ subscriptions: current.local[key] }, { subscriptions: candidate.payload[key] }, group);
        else diffRows(current.local[key], candidate.payload[key], group);
      }
      differences.append(group);
    }
    for (const row of differences.querySelectorAll('details')) row.open = expanded.has(row.dataset.path);
  }
  async function run(operation, values = {}) {
    busy = true; render();
    try { current = await syncRequest(operation, values); ready = current.ready === true; }
    catch (error) { current = { ...current, state: 'error', error: error.message }; }
    finally { busy = false; render(); }
  }
  toggle.addEventListener('change', () => void run('enabled', { enabled: toggle.checked }));
  $('sync-retry').addEventListener('click', () => void run('retry'));
  $('sync-use-local').addEventListener('click', () => void run('choose', { token: current.token }));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SYNC_STATE_KEY]) { current = changes[SYNC_STATE_KEY].newValue; ready = current?.ready === true; render(); }
    if (area === 'local' && changes[SYNC_ENABLED_KEY]) toggle.checked = changes[SYNC_ENABLED_KEY].newValue !== false;
  });
  window.addEventListener('imagetaken-languagechange', render);
  void run('status');
}
