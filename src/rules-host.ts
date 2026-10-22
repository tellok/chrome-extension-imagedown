import { reply, isRuleMatch } from './guards.js';
let creating: Promise<void>|null;
export function callRulesHost(message: { operation: 'match'; entries: unknown; url: string }): Promise<import('./models.js').RuleMatch>;
export function callRulesHost(message: { operation: 'validate'; document: unknown }): Promise<unknown>;
export async function callRulesHost(message: { operation: string; document?: unknown; entries?: unknown; url?: string; }) {
  if (!creating) {
    creating = (async () => {
      const url = chrome.runtime.getURL('rules-offscreen.html');
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
      if (!contexts.length) await chrome.offscreen.createDocument({ url: 'rules-offscreen.html', reasons: ['WORKERS'], justification: 'Validate image rule selectors and run time-bounded regular expression workers.' });
    })().finally(() => { creating = null; });
  }
  await creating;
  const response = reply(await chrome.runtime.sendMessage({ ...message, receiver: 'rules-offscreen' }));
  if (!response?.ok) throw new Error(String(response?.error || 'Remote rule worker unavailable'));
  if (message.operation === 'match' && !isRuleMatch(response.result)) throw new Error('Invalid remote match'); return response.result;
}
