import { matchRemoteRules } from './remote-rules.js';
self.onmessage = event => {
  try { self.postMessage({ result: matchRemoteRules(event.data.entries, event.data.url) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
