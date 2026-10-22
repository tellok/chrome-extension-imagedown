import { object } from "./guards.js";
import { createSettingsSync, SYNC_ALARM } from './settings-sync.js';
import { subscriptions } from './remote-rules-background.js';
import { callRulesHost } from './rules-host.js';
export function registerSettingsSync() {
  const engine = createSettingsSync({ local: chrome.storage.local, sync: chrome.storage.sync, alarms: chrome.alarms, subscriptions,
    validateSelectors: (payload) => callRulesHost({ operation: 'validate', document: { rules: Object.values(payload.sites).map(options => ({ options })) } }),
  });
  const start = () => void engine.start().catch(error => console.warn('ImageTaken settings sync:', error.message));
  chrome.storage.onChanged.addListener(engine.changed);
  chrome.runtime.onStartup.addListener(start);
  chrome.runtime.onInstalled.addListener(start);
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === SYNC_ALARM) void engine.retry().catch(error => console.warn('ImageTaken settings sync:', error.message)); });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => { if (!object(message)) return;
    if (message?.type !== 'settings-sync' || sender.id !== chrome.runtime.id || sender.url?.split('?')[0] !== chrome.runtime.getURL('settings.html')) return;
    const actions: Record<string, () => unknown> = { status: () => engine.getStatus(), retry: () => engine.retry(), enabled: () => engine.setEnabled(message.enabled === true), choose: () => engine.choose(typeof message.token === "string" ? message.token : "", typeof message.revision === "string" ? message.revision : null) };
    if (typeof message.operation !== "string" || !Object.hasOwn(actions, message.operation)) { respond({ ok: false, error: 'Unknown sync operation' }); return; }
    Promise.resolve().then(actions[message.operation]).then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message }));
    return true;
  });
  start();
}
