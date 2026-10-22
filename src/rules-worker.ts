import { matchRemoteRules, validateRuleDocument } from './remote-rules.js';
import { object } from './guards.js';
import type { Subscription } from './models.js';
self.onmessage = (event: MessageEvent<unknown>) => {
  try {
    const data = event.data;
    if (!object(data) || typeof data.url !== 'string' || !Array.isArray(data.entries)) throw new Error('Invalid rule worker request');
    const entries: Subscription[] = data.entries.map((entry: unknown) => {
      if (!object(entry) || typeof entry.id !== 'string' || typeof entry.url !== 'string' || typeof entry.domain !== 'string') throw new Error('Invalid rule worker entry');
      return { id: entry.id, url: entry.url, domain: entry.domain, document: entry.document === undefined ? undefined : validateRuleDocument(entry.document) };
    });
    self.postMessage({ result: matchRemoteRules(entries, data.url) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
