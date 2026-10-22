import { object } from "./guards.js";
import { imageRequests } from './extraction-background.js';
import { createSubscriptionManager, RULES_ALARM } from './remote-subscriptions.js';
import { callRulesHost } from './rules-host.js';
import { effectivePreferences } from './effective-preferences.js';
export const subscriptions = createSubscriptionManager({
  storage: chrome.storage.local, alarms: chrome.alarms,
  fetcher: (url, options) => imageRequests.subscription(typeof url === "string" ? url : url instanceof URL ? url.href : url.url, options),
  validateSelectors: (document) => callRulesHost({ operation: 'validate', document }),
  match: (entries, url) => callRulesHost({ operation: 'match', entries, url }),
});
export const getEffectivePreferences = (url: string) => effectivePreferences(url, subscriptions.resolve);
export function registerRemoteRules() {
  const start = () => void subscriptions.start().catch(error => console.warn('ImageTaken remote rules:', error.message));
  chrome.runtime.onStartup.addListener(start);
  chrome.runtime.onInstalled.addListener(start);
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === RULES_ALARM) void subscriptions.refreshAll().catch(error => console.warn('ImageTaken remote rules:', error.message));
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => { if (!object(message)) return;
    if (message?.type !== 'remote-rules' || sender.id !== chrome.runtime.id ||
        !['panel.html', 'settings.html'].some(file => sender.url?.split('?')[0] === chrome.runtime.getURL(file))) return;
    const actions: Record<string, () => unknown> = {
      list: () => subscriptions.list(), add: () => subscriptions.add(typeof message.url === "string" ? message.url : ""),
      remove: () => subscriptions.remove(typeof message.id === "string" ? message.id : ""), refresh: async () => { await subscriptions.refresh(typeof message.id === "string" ? message.id : ""); return subscriptions.list(); },
      'refresh-all': () => subscriptions.refreshAll(), effective: () => getEffectivePreferences(typeof message.url === "string" ? message.url : ""),
    };
    if (typeof message.operation !== "string" || !Object.hasOwn(actions, message.operation)) { respond({ ok: false, error: 'Unknown remote rule operation' }); return; }
    Promise.resolve().then(actions[message.operation]).then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message }));
    return true;
  });
  start();
}
