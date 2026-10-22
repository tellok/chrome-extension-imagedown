import test from 'node:test';
import assert from 'node:assert/strict';
import { createHighlightCoordinator, HIGHLIGHT_PORT } from '../extension/source-highlights-background.js';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function event() {
  const listeners = [];
  return { addListener: listener => listeners.push(listener), fire: value => listeners.forEach(listener => listener(value)) };
}
function fixture(execute = async () => [{ result: true }]) {
  const calls = [], errors = [];
  let next = 0;
  const runtime = { id: 'extension', getURL: path => `chrome-extension://extension/${path}` };
  const connect = createHighlightCoordinator({ runtime, uuid: () => `session-${++next}`, log: error => errors.push(error.message),
    executeScript: async options => { calls.push(options); return execute(options); } });
  function port(sender = { id: runtime.id, url: runtime.getURL('panel.html') + '?tab=7' }) {
    const p = { name: HIGHLIGHT_PORT, sender, onMessage: event(), onDisconnect: event(), replies: [], postMessage: value => p.replies.push(value) };
    p.accepted = connect(p);
    return p;
  }
  const update = (p, sequence, origins, tabId = 7) => p.onMessage.fire({ operation: 'update', sequence, origins, tabId });
  const messages = () => calls.filter(call => call.args).map(call => ({ ...call.args[0], documentId: call.target.documentIds[0], tabId: call.target.tabId }));
  return { calls, errors, port, update, messages };
}

test('Only the latest selection sequence can update an active highlight session.', async () => {
  let unblock;
  const f = fixture(options => options.files ? new Promise(resolve => { unblock = resolve; }) : Promise.resolve([{ result: true }]));
  const p = f.port();
  f.update(p, 1, [{ documentId: 'doc', id: '1:0' }]); await settle();
  f.update(p, 3, []); f.update(p, 2, [{ documentId: 'doc', id: '1:1' }]);
  unblock([]); await settle();
  assert.deepEqual(f.messages().map(m => m.operation), ['release']);
  assert.equal(f.messages()[0].sequence, 3);
  p.onDisconnect.fire();
  f.update(p, 4, [{ documentId: 'doc', id: '1:1' }]); await settle();
  assert.equal(f.messages().length, 1);
});

test('Highlight updates target exact documents and isolate failures between documents.', async () => {
  const f = fixture(async options => {
    if (options.target.documentIds[0] === 'denied') throw new Error('Document inaccessible');
    return [{ result: true }];
  });
  const p = f.port();
  f.update(p, 1, [{ documentId: 'denied', id: '1:0' }, { documentId: 'allowed', id: '2:0' }, { documentId: 'allowed', id: '2:0' }, { documentId: 'allowed', id: '2:1' }]);
  await settle();
  assert.deepEqual(f.messages()[0].ids, ['2:0', '2:1']);
  assert.equal(f.messages()[0].documentId, 'allowed');
  assert.equal(f.messages()[0].tabId, 7);
  assert.equal(f.errors.length, 1);
  assert.ok(f.calls.every(call => !('frameIds' in call.target) && call.target.documentIds.length === 1));
  p.onDisconnect.fire(); await settle();
});

test('Releasing one highlight view preserves other sessions and rejects forged messages.', async () => {
  const f = fixture(), a = f.port(), b = f.port();
  const forged = f.port({ id: 'site', url: 'https://example.com/' });
  assert.equal(forged.accepted, false);
  f.update(a, 1, [{ documentId: 'doc', id: '1:0' }]);
  f.update(b, 1, [{ documentId: 'doc', id: '1:0' }]); await settle();
  const [first, second] = f.messages(); assert.notEqual(first.session, second.session);
  a.onDisconnect.fire(); await settle();
  const released = f.messages().filter(m => m.operation === 'release');
  assert.deepEqual(released.map(m => m.session), [first.session]);
  b.onMessage.fire({ operation: 'renew', sequence: 1 }); await settle();
  assert.equal(f.messages().at(-1).session, second.session);
  const count = f.calls.length;
  f.update(a, 100, [{ documentId: 'doc', id: '1:1' }]);
  f.update(b, 2, [{ documentId: '', id: '1:1' }]); await settle();
  assert.equal(f.calls.length, count);
  b.onDisconnect.fire(); await settle();
});

test('Switching source tabs releases old highlights and rejects stale renewals.', async () => {
  const f = fixture(), p = f.port();
  f.update(p, 1, [{ documentId: 'old', id: '1:0' }], 7); await settle();
  f.update(p, 2, [{ documentId: 'new', id: '1:0' }], 8); await settle();
  assert.deepEqual(f.messages().map(m => [m.operation, m.tabId, m.documentId]), [['update', 7, 'old'], ['release', 7, 'old'], ['update', 8, 'new']]);
  const count = f.calls.length;
  p.onMessage.fire({ operation: 'renew', sequence: 1 }); await settle(); assert.equal(f.calls.length, count);
  p.onMessage.fire({ operation: 'renew', sequence: 2 }); await settle(); assert.equal(f.messages().at(-1).documentId, 'new');
  p.onDisconnect.fire(); await settle();
  assert.equal(f.messages().at(-1).operation, 'release');
  assert.equal(f.messages().at(-1).tabId, 8);
});
