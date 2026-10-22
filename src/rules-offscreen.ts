
import { object } from "./guards.js";

import { RULE_LIMITS } from './remote-rules.js';
let running = 0;
const waiting: (() => void)[] = [];
async function match(data: unknown) {
  if (running >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  else running++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(chrome.runtime.getURL('rules-worker.js'), { type: 'module' });
      const finish = (error: string|undefined, result: unknown = undefined) => { clearTimeout(timer); worker.terminate(); error ? reject(new Error(error)) : resolve(result); };
      const timer = setTimeout(() => finish('Remote regex timeout'), RULE_LIMITS.matchTimeout);
      worker.onmessage = (event: MessageEvent<unknown>) => { if (!object(event.data)) { finish("Invalid worker result"); return; } finish(typeof event.data.error === "string" ? event.data.error : undefined, event.data.result); };
      worker.onerror = event => { event.preventDefault(); finish(event.message); };
      worker.postMessage(data);
    });
  } finally { const next = waiting.shift(); if (next) next(); else running--; }
}
function validateSelectors(document: unknown) {
  const dom = window.document.implementation.createHTMLDocument('');
  if (!object(document) || !Array.isArray(document.rules)) throw new Error('Invalid rule selectors');
  for (const rule of document.rules) { if (!object(rule) || !object(rule.options)) throw new Error('Invalid rule selectors'); const options = rule.options;
    if (typeof options.xpath === "string" && options.xpath.trim()) dom.evaluate(options.xpath, dom, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    if (typeof options.excludedSelectors === "string" && options.excludedSelectors.trim()) {
      for (const line of options.excludedSelectors.split('\n').map((value) => value.trim()).filter(Boolean)) dom.querySelectorAll(line);
    }
  }
  return true;
}
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => { if (!object(message)) return;
  if (sender.id !== chrome.runtime.id || message?.receiver !== 'rules-offscreen') return;
  const operation = message.operation === 'match' ? match(message) : Promise.resolve().then(() => validateSelectors(message.document));
  operation.then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message }));
  return true;
});
