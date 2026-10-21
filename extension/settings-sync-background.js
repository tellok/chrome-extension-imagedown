import { createSettingsSync, SYNC_ALARM } from './settings-sync.js';
import { subscriptions } from './remote-rules-background.js';
import { callRulesHost } from './rules-host.js';
export function registerSettingsSync() {
  const engine = createSettingsSync({ local: chrome.storage.local, sync: chrome.storage.sync, alarms: chrome.alarms, subscriptions,
    validateSelectors: payload => callRulesHost({ operation: 'validate', document: { rules: Object.values(payload.sites).map(options => ({ options })) } }),
  });
  const start = () => void engine.start().catch(error => console.warn('ImageTaken settings sync:', error.message));
  chrome.storage.onChanged.addListener(engine.changed);
  chrome.runtime.onStartup.addListener(start);
  chrome.runtime.onInstalled.addListener(start);
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === SYNC_ALARM) void engine.retry().catch(error => console.warn('ImageTaken settings sync:', error.message)); });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'settings-sync' || sender.id !== chrome.runtime.id || sender.url?.split('?')[0] !== chrome.runtime.getURL('settings.html')) return;
    const actions = { status: () => engine.getStatus(), retry: () => engine.retry(), enabled: () => engine.setEnabled(message.enabled), choose: () => engine.choose(message.token, message.revision ?? null) };
    if (!Object.hasOwn(actions, message.operation)) { respond({ ok: false, error: 'Unknown sync operation' }); return; }
    Promise.resolve().then(actions[message.operation]).then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message }));
    return true;
  });
  start();
}
