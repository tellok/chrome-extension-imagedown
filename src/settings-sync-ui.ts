import { reply } from './guards.js';
import type { SyncStatus } from "./models.js";
import { object, isSyncStatus } from "./guards.js";
import { element } from "./guards.js";
import { t } from './i18n.js';
import { SYNC_STATE_KEY, SYNC_ENABLED_KEY } from './settings-sync-codec.js';
export async function syncRequest(operation: string, values: Record<string, unknown> = {}) {
  const result = reply(await chrome.runtime.sendMessage({ type: 'settings-sync', operation, ...values }));
  if (!result?.ok) throw new Error(String(result?.error || 'Sync unavailable'));
  if (!isSyncStatus(result.result)) throw new Error('Invalid sync status'); return result.result;
}
export function bindSettingsSync() {
  const $ = (id: string) => { const node = document.getElementById(id); if (!(node instanceof HTMLInputElement || node instanceof HTMLButtonElement || node instanceof HTMLSelectElement)) throw new Error('Missing control: ' + id); return node; };
  const toggle = element(document.getElementById("chrome-sync"), HTMLInputElement), status = element(document.getElementById("sync-status"), HTMLElement), conflict = element(document.getElementById("sync-conflict"), HTMLElement), differences = element(document.getElementById("sync-differences"), HTMLElement);
  let current: SyncStatus = { state: 'checking', candidates: [], ready: false }, busy = false, ready = false, feedback = false, conflictSeen = false;
  const fieldLabels: Record<string, string> = { 'settings:language': '界面语言', 'settings:theme': '主题', 'settings:auto-clean-title': '自动清洗标题', 'settings:ready-first': '优先展示成功加载的图片', 'settings:download-manifest': '同时下载图片清单', 'filters:width': '全局默认最低宽度', 'filters:height': '全局默认最低高度', 'filters:view:v1': '图片筛选', width: '最小宽度', height: '最小高度', minBytes: '最小体积', xpath: 'XPath 范围', excludedSelectors: 'CSS 排除', query: '搜索图片地址或描述', ignored: '忽略', type: '图片格式', source: '发现来源', loaded: '只看页面已解码的图片 / 已渲染的画布', showIgnored: '显示已忽略的图片', subscriptions: '远程规则订阅' };
  const expandedRows = new Set<string | undefined>();
  const textValue = (v: unknown) => v === undefined ? t('未设置') : JSON.stringify(v);
  function diffRows(local: Record<string, unknown>, remote: Record<string, unknown>, container: HTMLElement, prefix = "", identity = "") {
    for (const key of new Set([...Object.keys(local || {}), ...Object.keys(remote || {})])) {
      const a = local?.[key], b = remote?.[key], name = t(fieldLabels[key] || key), path = prefix ? `${prefix} / ${name}` : name;
      const id = identity ? `${identity}/${key}` : key;
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      if (object(a) && object(b)) { diffRows(a, b, container, path, id); continue; }
      const row = document.createElement('details'), summary = document.createElement('summary'), values = document.createElement('pre');
      row.dataset.path = id; summary.textContent = path; values.textContent = `${t('本机设置')}\n${textValue(a)}\n\n${t('同步设置')}\n${textValue(b)}`;
      row.append(summary, values); container.append(row);
    }
  }
  function render() {
    if (!busy && typeof current.enabled === 'boolean') toggle.checked = current.enabled;
    toggle.disabled = !ready || busy;
    element(document.getElementById("sync-feedback"), HTMLElement).hidden = !feedback;
    element(document.getElementById("sync-retry"), HTMLButtonElement).disabled = busy || !feedback;
    status.textContent = feedback ? t('操作未完成，请重试。') : '';
    conflict.hidden = current.state !== 'conflict';
    if (current.state === 'conflict') {
      if (!conflictSeen) element(document.getElementById("sync-diff"), HTMLDetailsElement).open = false;
      conflictSeen = true;
    } else if (['equal', 'disabled'].includes(current.state)) { conflictSeen = false; expandedRows.clear(); }
    element(document.getElementById("sync-use-local"), HTMLButtonElement).disabled = busy || !ready;
    if (conflictSeen) for (const row of differences.querySelectorAll('details')) {
      if (row.open) expandedRows.add(row.dataset.path); else expandedRows.delete(row.dataset.path);
    }
    const candidates = element(document.getElementById("sync-candidates"), HTMLElement); candidates.replaceChildren(); differences.replaceChildren();
    const multiple = (current.candidates || []).length > 1;
    for (const [index, candidate] of (current.candidates || []).entries()) {
      const section = document.createElement('section'), title = document.createElement('p'), choose = document.createElement('button');
      title.textContent = multiple ? `${t('同步版本 {0}', index + 1)} · ${new Date(candidate.updatedAt).toLocaleString(document.documentElement.lang)}` : '';
      choose.textContent = t('使用同步设置'); choose.type = 'button'; choose.disabled = busy || !ready;
      choose.addEventListener('click', () => void run('choose', { token: current.token, revision: candidate.revision }));
      if (multiple) { title.id = `sync-version-${index}`; choose.setAttribute('aria-describedby', title.id); section.append(title); }
      section.append(choose); candidates.append(section);
      const group = document.createElement('section'), heading = document.createElement('h4'); heading.textContent = title.textContent; if (multiple) group.append(heading);
      for (const [key, label] of [['settings','基础设置'], ['sites','网站设置'], ['subscriptions','远程规则订阅']]) {
        const name = document.createElement('strong'); name.textContent = t(label); group.append(name);
        if (key === 'subscriptions') diffRows({ subscriptions: (current.local ? { ...current.local } : {})[key] }, { subscriptions: ({ ...candidate.payload })[key] }, group);
        else if (key === "settings" || key === "sites") diffRows(current.local?.[key] || {}, candidate.payload[key], group);
      }
      for (const row of group.querySelectorAll('details')) row.dataset.path = `${candidate.deviceId}/${row.dataset.path}`;
      differences.append(group);
    }
    for (const row of differences.querySelectorAll('details')) row.open = expandedRows.has(row.dataset.path);
  }
  function receive(value: unknown) {
    if (!isSyncStatus(value)) throw new Error("Invalid sync status"); current = value; ready = current.ready === true;
    if (!ready && current.state === 'error') feedback = true;
    else if (!busy && ready && ['equal', 'disabled'].includes(current.state)) feedback = false;
  }
  async function run(operation: string, values = {}) {
    busy = true; render();
    try {
      receive(await syncRequest(operation, values));
      feedback = current.state === 'error' && (operation !== 'status' || !ready);
    } catch {
      // Keep the latest canonical candidates and switch state; a failed request
      // must not replace them with a display-only error or replay an old choice.
      feedback = true;
    } finally { busy = false; render(); }
  }
  toggle.addEventListener('change', () => void run('enabled', { enabled: toggle.checked }));
  element(document.getElementById("sync-retry"), HTMLButtonElement).addEventListener('click', () => void run('retry'));
  element(document.getElementById("sync-use-local"), HTMLButtonElement).addEventListener('click', () => void run('choose', { token: current.token }));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SYNC_STATE_KEY]) { receive(changes[SYNC_STATE_KEY].newValue); render(); }
    if (area === 'local' && changes[SYNC_ENABLED_KEY]) toggle.checked = changes[SYNC_ENABLED_KEY].newValue !== false;
  });
  window.addEventListener('imagetaken-languagechange', render);
  void run('status');
}
