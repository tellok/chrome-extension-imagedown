import { RULE_LIMITS } from './remote-rules.js';
let running = 0;
const waiting = [];
async function match(data) {
  if (running >= 2) await new Promise(resolve => waiting.push(resolve));
  else running++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(chrome.runtime.getURL('rules-worker.js'), { type: 'module' });
      const finish = (error, result) => { clearTimeout(timer); worker.terminate(); error ? reject(new Error(error)) : resolve(result); };
      const timer = setTimeout(() => finish('Remote regex timeout'), RULE_LIMITS.matchTimeout);
      worker.onmessage = event => finish(event.data.error, event.data.result);
      worker.onerror = event => { event.preventDefault(); finish(event.message); };
      worker.postMessage(data);
    });
  } finally { const next = waiting.shift(); if (next) next(); else running--; }
}
function validateSelectors(document) {
  const dom = window.document.implementation.createHTMLDocument('');
  for (const { options } of document.rules) {
    if (options.xpath?.trim()) dom.evaluate(options.xpath, dom, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    if (options.excludedSelectors?.trim()) {
      for (const line of options.excludedSelectors.split('\n').map(value => value.trim()).filter(Boolean)) dom.querySelectorAll(line);
    }
  }
  return true;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.receiver !== 'rules-offscreen') return;
  const operation = message.operation === 'match' ? match(message) : Promise.resolve().then(() => validateSelectors(message.document));
  operation.then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message }));
  return true;
});
