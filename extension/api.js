import { filename } from './lib.js';
import { prepareMetadata } from './metadata.js';

export async function scanTab(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['collector.js'] });
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true }, func: () => globalThis.__imageDown?.scan(),
  });
  const unique = new Map();
  let truncated = false;
  for (const { frameId, documentId, result } of frames) {
    if (!result) continue;
    truncated ||= result.truncated;
    for (const item of result.items) {
      const origin = { id: item.id, documentId, frameId };
      const key = item.kind === 'canvas' ? `${documentId}:${item.id}` : item.url;
      const existing = unique.get(key);
      if (existing) {
        existing.origins.push(origin);
        existing.sources = [...new Set([...existing.sources, ...item.sources])];
        if (item.bytes > 0 && !(existing.bytes > 0)) Object.assign(existing, { bytes: item.bytes, sizeSource: item.sizeSource });
        if (item.loaded && !existing.loaded) Object.assign(existing, {
          loaded: true, width: item.width, height: item.height, preview: item.preview,
        });
      } else unique.set(key, { ...item, key, origins: [origin], order: unique.size });
    }
  }
  return { items: await prepareMetadata([...unique.values()]), frames: frames.filter(f => f.result).length, truncated };
}

async function pageData(tabId, item, refresh) {
  const errors = [];
  for (const origin of item.origins) {
    try {
      const [response] = await chrome.scripting.executeScript({
        target: { tabId, documentIds: [origin.documentId] },
        func: (id, refresh) => globalThis.__imageDown?.read(id, { refresh }), args: [origin.id, refresh],
      });
      if (response?.result?.dataUrl) return response.result;
      errors.push(response?.result?.error || '页面已改变');
    } catch (error) { errors.push(error.message); }
  }
  throw new Error(errors.join('；'));
}

async function extensionBlob(url, refresh) {
  if (!/^https?:/.test(url)) throw new Error('此资源只能从原页面读取');
  const response = await fetch(url, { cache: refresh ? 'reload' : 'force-cache', credentials: 'include', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const mime = response.headers.get('content-type')?.split(';')[0] || '';
  if (!mime.startsWith('image/')) throw new Error('服务器没有返回图片');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 20 * 1024 * 1024) throw new Error('图片超过 20 MiB 数据读取上限，请使用原格式直接下载');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!bytes) throw new Error('图片数据为空');
  return new Blob(chunks, { type: mime });
}

export async function readImage(tabId, item, { refresh = false } = {}) {
  let pageError;
  try {
    const result = await pageData(tabId, item, refresh);
    // Data URLs have already been bounded in the owning document.
    const blob = await (await fetch(result.dataUrl)).blob();
    if (!blob.type.startsWith('image/')) throw new Error('页面返回的数据不是图片');
    return { blob, method: result.method };
  } catch (error) { pageError = error; }
  try { return { blob: await extensionBlob(item.url, refresh), method: 'extension-fetch' }; }
  catch (error) { throw new Error(`页面：${pageError.message}；扩展：${error.message}`); }
}

export async function convert(blob, format) {
  if (format === 'original') return blob;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 24_000_000) throw new Error('转换最多支持 2400 万像素');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (format === 'jpg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(image, 0, 0);
    const output = await new Promise(resolve => canvas.toBlob(resolve, `image/${format === 'jpg' ? 'jpeg' : format}`, 0.94));
    if (!output) throw new Error('浏览器无法转换这张图片');
    return output;
  } finally { URL.revokeObjectURL(url); }
}

// Resolve only on Chrome's completed event, not merely when a download is queued.
async function save(url, name) {
  const id = await chrome.downloads.download({ url, filename: name, conflictAction: 'uniquify', saveAs: false });
  return new Promise((resolve, reject) => {
    let poll, timeout;
    const cleanup = () => {
      clearInterval(poll); clearTimeout(timeout); chrome.downloads.onChanged.removeListener(listener);
    };
    const check = async () => {
      try {
        const [download] = await chrome.downloads.search({ id });
        if (download?.state === 'complete') { cleanup(); resolve(download); }
        else if (download?.state === 'interrupted') { cleanup(); reject(new Error(download.error || '下载中断')); }
      } catch (error) { cleanup(); reject(error); }
    };
    const listener = delta => { if (delta.id === id && (delta.state || delta.error)) void check(); };
    chrome.downloads.onChanged.addListener(listener);
    poll = setInterval(check, 1000);
    timeout = setTimeout(() => {
      cleanup();
      // A pending download is not success. Cancel before releasing its Blob URL.
      void chrome.downloads.cancel(id).catch(() => {});
      reject(new Error('下载超时（120 秒），已取消，请重试'));
    }, 120_000);
    void check();
  });
}

export async function downloadImage(tabId, item, index, format) {
  let result;
  try { result = await readImage(tabId, item); }
  catch (error) {
    if (format !== 'original' || !/^https?:/.test(item.url) || item.kind === 'canvas') throw error;
    // Useful for large files or servers that treat fetch and downloads differently.
    const downloaded = await save(item.url, filename(item, index));
    if (downloaded.mime && !downloaded.mime.startsWith('image/')) throw new Error('直接下载的响应不是图片，请检查下载目录');
    return { method: 'browser-download', bytes: downloaded.fileSize };
  }
  const blob = await convert(result.blob, format);
  const url = URL.createObjectURL(blob);
  try {
    await save(url, filename(item, index, blob.type, format));
    return { method: result.method, bytes: blob.size, sourceBytes: result.blob.size, sourceMime: result.blob.type, mime: blob.type, format };
  } finally { URL.revokeObjectURL(url); }
}
