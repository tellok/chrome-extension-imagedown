import { t, translatedSource } from './i18n.js';
import { filename } from './lib.js';
import { prepareMetadata } from './metadata.js';
import { writeImage } from './destination.js';
import { saveBrowserDownload as save } from './browser-downloads.js';
import { contentHash } from './file-content.js';
import { browserResources, cachedBrowserResource } from './browser-resources.js';

export async function scanTab(tabId, xpath = '', excludedSelectors = '') {
  // DevTools XPath is relative to the top document. Never leak unscoped iframe images.
  const target = { tabId, allFrames: !xpath };
  await chrome.scripting.executeScript({ target, files: ['collector.js'] });
  const frames = await chrome.scripting.executeScript({
    target, func: (expression, selectors) => globalThis.__imageTaken?.scan(expression, selectors), args: [xpath, excludedSelectors],
  });
  const unique = new Map();
  let truncated = false;
  for (const { frameId, documentId, result } of frames) {
    if (!result) continue;
    if (result.error) throw new Error(translatedSource(result.error));
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
          loaded: true, width: item.width, height: item.height, preview: item.preview, previewIssue: item.previewIssue,
        });
        if (!existing.preview && item.preview) Object.assign(existing, { preview: item.preview, previewIssue: '' });
      } else unique.set(key, { ...item, key, origins: [origin], order: unique.size });
    }
  }
  const items = await prepareMetadata([...unique.values()]);
  const resources = await browserResources(tabId, items);
  for (const resource of resources) {
    const item = unique.get(resource.key);
    if (!item || item.url !== resource.url) continue;
    Object.assign(item, { browserData: resource.dataUrl, browserDataURL: resource.url, browserOrigin: resource.origin,
      bytes: resource.bytes, mime: resource.mime, sizeSource: '浏览器保留的原始资源大小' });
  }
  return { items, frames: frames.filter(f => f.result).length, matchedRoots: frames.reduce((sum, f) => sum + (f.result?.matchedRoots || 0), 0), truncated };
}

async function pageData(tabId, item, refresh, preview) {
  const errors = [];
  for (const origin of item.origins) {
    try {
      const [response] = await chrome.scripting.executeScript({
        target: { tabId, documentIds: [origin.documentId] },
        func: (id, refresh, preview) => globalThis.__imageTaken?.read(id, { refresh, preview }), args: [origin.id, refresh, preview],
      });
      if (response?.result?.dataUrl) return response.result;
      errors.push(translatedSource(response?.result?.error) || t('页面已改变'));
    } catch (error) { errors.push(error.message); }
  }
  throw new Error(errors.join('；'));
}

async function extensionBlob(url, refresh) {
  if (!/^https?:/.test(url)) throw new Error(t('此资源只能从原页面读取'));
  const response = await fetch(url, { cache: refresh ? 'reload' : 'force-cache', credentials: 'include', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const mime = response.headers.get('content-type')?.split(';')[0] || '';
  if (!mime.startsWith('image/')) throw new Error(t('服务器没有返回图片'));
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 20 * 1024 * 1024) throw new Error(t('图片超过 20 MiB 数据读取上限，请使用原格式直接下载'));
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!bytes) throw new Error(t('图片数据为空'));
  return new Blob(chunks, { type: mime });
}

const originalImages = new WeakMap();
const readingImages = new WeakMap();

export async function readImage(tabId, item, options = {}) {
  const cached = originalImages.get(item);
  if (cached?.url === item.url && !options.refresh) return cached.result;
  const pending = readingImages.get(item);
  if (pending?.url === item.url && pending.preview === !!options.preview && !options.refresh) return pending.promise;
  const url = item.url;
  const promise = readImageData(tabId, item, options).then(result => {
    // Page pixels can be a static/reduced thumbnail. Never pass them off as
    // original bytes, especially for animated GIF/WebP downloads.
    if (result.method !== 'decoded-pixels' && item.url === url) originalImages.set(item, { url, result });
    return result;
  });
  readingImages.set(item, { url, preview: !!options.preview, promise });
  try { return await promise; }
  finally { if (readingImages.get(item)?.promise === promise) readingImages.delete(item); }
}

async function readImageData(tabId, item, { refresh = false, preview = false } = {}) {
  let original = cachedBrowserResource(item);
  if (!original) {
    const [resource] = await browserResources(tabId, [item]);
    original = resource?.dataUrl;
  }
  if (original) return { blob: await (await fetch(original)).blob(), method: 'debugger-resource' };
  let pageError;
  try {
    const result = await pageData(tabId, item, refresh, preview);
    // Data URLs have already been bounded in the owning document.
    const blob = await (await fetch(result.dataUrl)).blob();
    if (!blob.type.startsWith('image/')) throw new Error(t('页面返回的数据不是图片'));
    return { blob, method: result.method };
  } catch (error) { pageError = error; }
  try { return { blob: await extensionBlob(item.url, refresh), method: 'extension-fetch' }; }
  catch (error) { throw new Error(t(`页面：{0}；扩展：{1}`, pageError.message, error.message)); }
}

export async function convert(blob, format) {
  if (format === 'original') return blob;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 24_000_000) throw new Error(t('转换最多支持 2400 万像素'));
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (format === 'jpg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(image, 0, 0);
    const output = await new Promise(resolve => canvas.toBlob(resolve, `image/${format === 'jpg' ? 'jpeg' : format}`, 0.94));
    if (!output) throw new Error(t('浏览器无法转换这张图片'));
    return output;
  } finally { URL.revokeObjectURL(url); }
}

export async function downloadImage(tabId, item, index, format, destination = { folder: t('未命名页面'), directory: null }) {
  let result;
  try { result = await readImage(tabId, item); }
  catch (error) {
    if (destination.directory || format !== 'original' || !/^https?:/.test(item.url) || item.kind === 'canvas') throw error;
    // Useful for large files or servers that treat fetch and downloads differently.
    const downloaded = await save(item.url, filename(item, index, undefined, format, destination.folder));
    if (downloaded.mime && !downloaded.mime.startsWith('image/')) throw new Error(t('直接下载的响应不是图片，请检查下载目录'));
    return { method: 'browser-download', bytes: downloaded.fileSize, downloadId: downloaded.id, actualPath: downloaded.filename };
  }
  const blob = await convert(result.blob, format);
  const name = filename(item, index, blob.type, format, destination.folder);
  if (destination.directory) {
    const saved = await writeImage(destination.directory, name.slice(name.lastIndexOf('/') + 1), blob);
    return { method: result.method, bytes: blob.size, sourceBytes: result.blob.size, sourceMime: result.blob.type, mime: blob.type, format, skipped: saved.skipped, savedName: saved.name };
  }
  const url = URL.createObjectURL(blob);
  try {
    const downloaded = await save(url, name, await contentHash(blob));
    return { method: result.method, bytes: blob.size, sourceBytes: result.blob.size, sourceMime: result.blob.type, mime: blob.type, format, downloadId: downloaded.id, actualPath: downloaded.filename, skipped: downloaded.skipped };
  } finally { URL.revokeObjectURL(url); }
}
