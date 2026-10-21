import { t } from './i18n.js';
import { REMOTE_RULES_KEY } from './remote-rules.js';
export function bindRemoteSubscriptions() {
  const $ = id => document.getElementById(id);
  const list = $('subscriptions-list'), status = $('subscriptions-status');
  let revision = 0, busy = false;
  async function request(operation, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type: 'remote-rules', operation, ...extra });
    if (!response?.ok) throw new Error(response?.error || 'Remote rules unavailable');
    return response.result;
  }
  async function render() {
    const current = ++revision;
    try {
      const state = await request('list');
      if (revision !== current) return;
      list.replaceChildren();
      $('subscriptions-empty').hidden = !!state.entries.length;
      $('subscriptions-refresh-all').disabled = busy || !state.entries.length;
      for (const entry of state.entries) {
        const row = document.createElement('li'); row.className = 'subscription'; row.dataset.id = entry.id;
        const heading = document.createElement('strong'); heading.textContent = entry.domain;
        const url = document.createElement('p'); url.className = 'subscription-url'; url.textContent = entry.url; url.title = entry.url;
        const info = document.createElement('p'); info.className = 'subscription-state';
        const updated = t('最后更新：{0}', entry.lastSuccess ? new Date(entry.lastSuccess).toLocaleString(document.documentElement.lang) : t('尚未成功更新'));
        info.textContent = `${updated}${entry.refreshing ? ` · ${t('正在刷新…')}` : entry.error ? ` · ${t('刷新失败：{0}', entry.error)}` : ''}`;
        if (entry.error) info.classList.add('error');
        const buttons = document.createElement('div'); buttons.className = 'subscription-actions';
        for (const [operation, text] of [['refresh', '刷新'], ['remove', '删除']]) {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = t(text); button.dataset.operation = operation;
          button.disabled = operation === 'refresh' && entry.refreshing;
          button.addEventListener('click', () => void act(operation, { id: entry.id })); buttons.append(button);
        }
        row.append(heading, url, info, buttons); list.append(row);
      }
    } catch (error) { status.textContent = t('无法读取设置：{0}', error.message); }
  }
  async function act(operation, extra) {
    busy = true; $('subscriptions-add').disabled = true; $('subscriptions-refresh-all').disabled = true;
    status.textContent = t('正在刷新…');
    try {
      const result = await request(operation, extra);
      if (operation === 'add') $('subscription-url').value = '';
      const errors = result.entries.filter(entry => entry.error).length;
      status.textContent = errors ? t('部分订阅更新失败，请查看下方详情。') : t('已保存');
    } catch (error) { status.textContent = t('保存失败：{0}', error.message); }
    finally { busy = false; $('subscriptions-add').disabled = false; await render(); }
  }
  $('subscriptions-form').addEventListener('submit', event => { event.preventDefault(); if (!busy) void act('add', { url: $('subscription-url').value.trim() }); });
  $('subscriptions-refresh-all').addEventListener('click', () => void act('refresh-all'));
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[REMOTE_RULES_KEY]) void render(); });
  window.addEventListener('imagetaken-languagechange', () => { status.textContent = ''; void render(); });
  $('subscriptions-add').disabled = false;
  void render();
}
