let creating;
export async function callRulesHost(message) {
  if (!creating) {
    creating = (async () => {
      const url = chrome.runtime.getURL('rules-offscreen.html');
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
      if (!contexts.length) await chrome.offscreen.createDocument({ url: 'rules-offscreen.html', reasons: ['WORKERS'], justification: 'Validate image rule selectors and run time-bounded regular expression workers.' });
    })().finally(() => { creating = null; });
  }
  await creating;
  const response = await chrome.runtime.sendMessage({ ...message, receiver: 'rules-offscreen' });
  if (!response?.ok) throw new Error(response?.error || 'Remote rule worker unavailable');
  return response.result;
}
