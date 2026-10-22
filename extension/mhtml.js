import { base64, imageComplete, MAX_FILE_BYTES } from './image-bytes.js';
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_INDEX_BYTES = 32 * 1024 * 1024;
function headers(text) {
  return Object.fromEntries(text.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).flatMap(line => {
    const colon = line.indexOf(':'); return colon > 0 ? [[line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]] : [];
  }));
}
function binary(bytes) {
  let result = '';
  for (let at = 0; at < bytes.length; at += 8192) result += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return result;
}
function decodeBody(text, encoding) {
  if (encoding === 'base64') {
    const compact = text.replace(/\s/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) throw new Error('Invalid MIME Base64');
    return Uint8Array.from(atob(compact), c => c.charCodeAt(0));
  }
  if (encoding === 'quoted-printable') {
    text = text.replace(/=\r?\n/g, '');
    if (/=(?![0-9a-f]{2})/i.test(text)) throw new Error('Invalid MIME quoted-printable');
    text = text.replace(/=([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  } else if (!['', 'binary', '8bit', '7bit'].includes(encoding)) throw new Error('Unsupported MIME encoding');
  return Uint8Array.from(text, c => c.charCodeAt(0));
}
export function parseMHTML(bytes) {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds 64 MiB');
  const text = binary(bytes), headerEnd = text.search(/\r?\n\r?\n/);
  if (headerEnd < 0) throw new Error('Invalid MIME headers');
  const main = headers(text.slice(0, headerEnd));
  const boundary = /\bboundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(main['content-type'] || '');
  const token = boundary?.[1] || boundary?.[2];
  if (!token || token.length > 200) throw new Error('Missing MIME boundary');
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markers = [...text.matchAll(new RegExp('(?:^|\\r?\\n)--' + escaped + '(--)?[ \\t]*(?:\\r?\\n|$)', 'g'))];
  if (markers.length < 2 || !markers.at(-1)[1]) throw new Error('Incomplete MIME boundary');
  const parts = []; let total = 0;
  for (let i = 0; i < markers.length - 1; i++) {
    const start = markers[i].index + markers[i][0].length, end = markers[i + 1].index;
    const part = text.slice(start, end), separator = /\r?\n\r?\n/.exec(part);
    if (!separator) throw new Error('Invalid MIME part');
    const fields = headers(part.slice(0, separator.index));
    const mime = (fields['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('image/')) continue;
    const data = decodeBody(part.slice(separator.index + separator[0].length), (fields['content-transfer-encoding'] || '').toLowerCase());
    if (!data.length || data.length > MAX_FILE_BYTES || !imageComplete(data, mime)) continue;
    total += data.length;
    if (total > MAX_INDEX_BYTES) throw new Error('Archive image index exceeds 32 MiB');
    parts.push({ url: fields['content-location'] || '', contentId: fields['content-id'] || '', mime, bytes: data.length, dataUrl: `data:${mime};base64,${base64(data)}` });
  }
  return parts;
}
export function archiveResource(parts, item, before, after) {
  const documents = new Set(before.map(state => state.documentId));
  if (documents.size !== 1 || !before.length) return null;
  const eligible = before.some(state => state.url === item.url && state.ready && after.some(current =>
    current.documentId === state.documentId && current.signature === state.signature && current.ready && current.url === state.url && current.documentURL === state.documentURL));
  const matches = parts.filter(part => part.url === item.url);
  return eligible && matches.length === 1 ? { ...matches[0], key: item.key, method: 'mhtml-resource' } : null;
}
export async function resourceStates(tabId, items) {
  const groups = new Map();
  for (const item of items) for (const origin of item.origins || []) {
    if (!groups.has(origin.documentId)) groups.set(origin.documentId, []);
    groups.get(origin.documentId).push({ key: item.key, id: origin.id, url: item.url });
  }
  const states = [];
  for (const [documentId, candidates] of groups) {
    try {
      const [response] = await chrome.scripting.executeScript({ target: { tabId, documentIds: [documentId] },
        func: candidates => candidates.flatMap(candidate => {
          const record = globalThis.__imageTaken?.resource(candidate.id);
          return record?.url === candidate.url ? [{ ...record, ...candidate, documentURL: location.href }] : [];
        }), args: [candidates] });
      if (response?.documentId === documentId) states.push(...(response.result || []).map(state => ({ ...state, documentId })));
    } catch { /* Navigated or inaccessible frames are ineligible. */ }
  }
  return states;
}
export async function captureArchive(tabId) {
  const blob = await chrome.pageCapture.saveAsMHTML({ tabId });
  if (!blob || blob.size > MAX_ARCHIVE_BYTES) throw new Error('Archive unavailable or exceeds 64 MiB');
  return parseMHTML(new Uint8Array(await blob.arrayBuffer()));
}
