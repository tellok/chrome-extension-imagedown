import { createSubscriptionManager, RULES_ALARM } from './remote-subscriptions.js';
import { callRulesHost } from './rules-host.js';
import { effectivePreferences } from './effective-preferences.js';
export const subscriptions = createSubscriptionManager({
  storage: chrome.storage.local, alarms: chrome.alarms,
  validateSelectors: document => callRulesHost({ operation: 'validate', document }),
  match: (entries, url) => callRulesHost({ operation: 'match', entries, url }),
});
export const getEffectivePreferences = url => effectivePreferences(url, subscriptions.resolve);
export function registerRemoteRules() {
  const start = () => void subscriptions.start().catch(error => console.warn('ImageTaken remote rules:', error.message));
  chrome.runtime.onStartup.addListener(start);
  chrome.runtime.onInstalled.addListener(start);
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === RULES_ALARM) void subscriptions.refreshAll().catch(error => console.warn('ImageTaken remote rules:', error.message));
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'remote-rules' || sender.id !== chrome.runtime.id ||
        !['panel.html', 'settings.html'].some(file => sender.url?.split('?')[0] === chrome.runtime.getURL(file))) return;
    const actions = {
      list: () => subscriptions.list(), add: () => subscriptions.add(message.url),
      remove: () => subscriptions.remove(message.id), refresh: async () => { await subscriptions.refresh(message.id); return subscriptions.list(); },
      'refresh-all': () => subscriptions.refreshAll(), effective: () => getEffectivePreferences(message.url),
    };
    if (!Object.hasOwn(actions, message.operation)) { respond({ ok: false, error: 'Unknown remote rule operation' }); return; }
    Promise.resolve().then(actions[message.operation]).then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message }));
    return true;
  });
  start();
}
