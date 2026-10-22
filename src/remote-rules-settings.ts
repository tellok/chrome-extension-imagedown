import { reply, isSubscriptionState } from './guards.js';
import { element } from "./guards.js";
import { t } from './i18n.js';
import { REMOTE_RULES_KEY } from './remote-rules.js';
export function bindRemoteSubscriptions() {
  const $ = (id: string) => { const node = document.getElementById(id); if (!(node instanceof HTMLInputElement || node instanceof HTMLButtonElement || node instanceof HTMLSelectElement)) throw new Error('Missing control: ' + id); return node; };
  const list = element(document.getElementById("subscriptions-list"), HTMLElement), status = element(document.getElementById("subscriptions-status"), HTMLElement);
  let revision = 0, busy = false;
  async function request(operation: string, extra = {}) {
    const response = reply(await chrome.runtime.sendMessage({ type: 'remote-rules', operation, ...extra }));
    if (!response?.ok) throw new Error(String(response?.error || 'Remote rules unavailable'));
    if (!isSubscriptionState(response.result)) throw new Error('Invalid subscription state'); return response.result;
  }
  async function render() {
    const current = ++revision;
    try {
      const state = await request('list');
      if (revision !== current) return;
      list.replaceChildren();
      element(document.getElementById("subscriptions-empty"), HTMLElement).hidden = !!state.entries.length;
      element(document.getElementById("subscriptions-refresh-all"), HTMLButtonElement).disabled = busy || !state.entries.length;
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
          button.disabled = operation === 'refresh' && !!entry.refreshing;
          button.addEventListener('click', () => void act(operation, { id: entry.id })); buttons.append(button);
        }
        row.append(heading, url, info, buttons); list.append(row);
      }
    } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); status.textContent = t('无法读取设置：{0}', error.message); }
  }
  async function act(operation: string, extra: Record<string, unknown> = {}) {
    busy = true; element(document.getElementById("subscriptions-add"), HTMLButtonElement).disabled = true; element(document.getElementById("subscriptions-refresh-all"), HTMLButtonElement).disabled = true;
    status.textContent = t('正在刷新…');
    try {
      const result = await request(operation, extra);
      if (operation === 'add') element(document.getElementById("subscription-url"), HTMLInputElement).value = '';
      const errors = result.entries.filter((entry: import("./models.js").Subscription) => entry.error).length;
      status.textContent = errors ? t('部分订阅更新失败，请查看下方详情。') : t('已保存');
    } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); status.textContent = t('保存失败：{0}', error.message); }
    finally { busy = false; element(document.getElementById("subscriptions-add"), HTMLButtonElement).disabled = false; await render(); }
  }
  element(document.getElementById("subscriptions-form"), HTMLFormElement).addEventListener('submit', event => { event.preventDefault(); if (!busy) void act('add', { url: element(document.getElementById("subscription-url"), HTMLInputElement).value.trim() }); });
  element(document.getElementById("subscriptions-refresh-all"), HTMLButtonElement).addEventListener('click', () => void act('refresh-all'));
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[REMOTE_RULES_KEY]) void render(); });
  window.addEventListener('imagetaken-languagechange', () => { status.textContent = ''; void render(); });
  element(document.getElementById("subscriptions-add"), HTMLButtonElement).disabled = false;
  void render();
}
