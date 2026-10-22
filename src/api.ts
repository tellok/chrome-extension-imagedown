import { isDiscoveredImage } from './guards.js';
import type { ImageItem, ImageData, ReadOptions } from "./models.js";
interface ReadResult { blob: Blob; method: string }
import { extractionCall } from './extraction-client.js';
import { t, translatedSource } from './i18n.js';
import { filename } from './lib.js';
import { prepareMetadata } from './metadata.js';
import { writeImage } from './destination.js';
import { saveBrowserDownload as save } from './browser-downloads.js';
import { contentHash } from './file-content.js';
import { cachedBrowserResource } from './browser-resources.js';

export async function scanTab(tabId: number, xpath = "", excludedSelectors = "") {
  // DevTools XPath is relative to the top document. Never leak unscoped iframe images.
  const target = { tabId, allFrames: !xpath };
  await chrome.scripting.executeScript({ target, files: ['collector.js'] });
  const frames = await chrome.scripting.executeScript({
    target, func: (expression, selectors) => globalThis.__imageTaken?.scan(expression, selectors), args: [xpath, excludedSelectors] satisfies [string, string],
  });
  const unique = new Map<string, ImageItem>();
  let truncated = false;
  for (const { frameId, documentId, result } of frames) {
    if (!result) continue;
    if (result.error) throw new Error(translatedSource(result.error));
    truncated ||= !!result.truncated;
    for (const item of result.items || []) {
      const origin = { id: item.id, documentId, frameId };
      const key = item.kind === 'canvas' ? `${documentId}:${item.id}` : item.url;
      const existing = unique.get(key);
      if (existing) {
        existing.origins.push(origin);
        existing.sources = [...new Set([...existing.sources, ...item.sources])];
        if ((item.bytes ?? 0) > 0 && !((existing.bytes ?? 0) > 0)) Object.assign(existing, { bytes: item.bytes, sizeSource: item.sizeSource });
        if (item.loaded && !existing.loaded) Object.assign(existing, {
          loaded: true, width: item.width, height: item.height, preview: item.preview, previewIssue: item.previewIssue,
        });
        if (!existing.preview && item.preview) Object.assign(existing, { preview: item.preview, previewIssue: '' });
      } else unique.set(key, { ...item, key, origins: [origin], order: unique.size });
    }
  }
  const items = await prepareMetadata([...unique.values()]);
  let resources: ImageData[] = [];
  try { resources = await extractionCall('archive', { tabId, items: items.filter((item) => /^https?:/.test(item.url) && item.kind !== 'canvas') }); } catch { /* Continue with per-image fallback. */ }
  try {
    const found = await extractionCall('discover', { tabId, scoped: !!(xpath || excludedSelectors) });
    for (const record of found || []) {
      if (unique.has(record.url) || !isDiscoveredImage(record)) continue;
      const item = { ...record, key: record.url, order: unique.size };
      unique.set(item.key, item); items.push(...await prepareMetadata([item]));
    }
  } catch { /* Enhanced mode is optional and fails closed. */ }
  // Loaded targets share the complete extraction task even when the archive misses.
  try {
    await extractionCall('subscribe', { tabId });
    {
      const resolved = new Set(resources.map(resource => resource.key));
      const pending = items.filter((item) => !resolved.has(item.key) && item.loaded && /^https?:/.test(item.url) && item.kind !== 'canvas');
      let cursor = 0, retainedBytes = resources.reduce((sum, resource) => sum + (resource.bytes || 0), 0), debuggerBytes = 0;
      await Promise.all([0, 1].map(async () => { while (cursor < pending.length) {
        if (retainedBytes >= 32 * 1024 * 1024 || debuggerBytes >= 8 * 1024 * 1024) break;
        const item = pending[cursor++];
        try {
          const result = await readImage(tabId, item);
          if (retainedBytes + result.blob.size > 32 * 1024 * 1024 || (result.method === 'debugger-resource' && debuggerBytes + result.blob.size > 8 * 1024 * 1024)) {
            originalImages.delete(item); readingImages.delete(item); item.previewIssue = 'budget'; continue;
          }
          retainedBytes += result.blob.size;
          if (result.method === 'debugger-resource') debuggerBytes += result.blob.size;
          const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Invalid image data")); reader.onerror = () => reject(reader.error); reader.readAsDataURL(result.blob); });
          resources.push({ dataUrl, method: result.method, bytes: result.blob.size, mime: result.blob.type, key: item.key, url: item.url });
        } catch { /* Candidate remains retryable. */ }
      } }));
    }
  } catch { /* Keep ordinary results. */ }
  for (const resource of resources) {
    const item = unique.get(resource.key || '');
    if (!item || item.url !== resource.url) continue;
    Object.assign(item, { browserData: resource.dataUrl, browserDataURL: resource.url, browserOrigin: resource.origin, browserMethod: resource.method,
      bytes: resource.bytes, mime: resource.mime, sizeSource: '浏览器保留的原始资源大小' });
  }
  return { items, frames: frames.filter(f => f.result).length, matchedRoots: frames.reduce((sum, f) => sum + (f.result?.matchedRoots || 0), 0), truncated };
}

async function pageData(tabId: number, item: ImageItem, refresh: boolean, preview: boolean | "full") {
  const errors = [];
  for (const origin of item.origins) {
    try {
      const [response] = await chrome.scripting.executeScript({
        target: { tabId, documentIds: [origin.documentId] },
        func: (id, refresh, preview) => globalThis.__imageTaken?.read(id, { refresh, preview }), args: [origin.id, refresh, preview] satisfies [string, boolean, boolean | "full"],
      });
      if (response?.result?.dataUrl) return response.result;
      errors.push(translatedSource(response?.result?.error || '') || t('页面已改变'));
    } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); errors.push(error.message); }
  }
  throw new Error(errors.join('；'));
}

const originalImages = new WeakMap<ImageItem, { url: string; result: ReadResult }>();
const readingImages = new WeakMap<ImageItem, { url: string; promise: Promise<ReadResult>; failed: boolean }>();
let retrySequence = 0;

export async function readImage(tabId: number, item: ImageItem, options: ReadOptions = {}) {
  const cached = originalImages.get(item);
  if (cached?.url === item.url) return cached.result;
  if (options.preview && !cachedBrowserResource(item)) {
    try {
      const result = await pageData(tabId, item, false, options.preview);
      if (result.method === 'decoded-pixels') return { blob: await (await fetch(result.dataUrl || '')).blob(), method: result.method || "page-fetch" };
    } catch { /* Continue the shared full-file task. */ }
  }
  const pending = readingImages.get(item);
  if (pending?.url === item.url && !options.refresh && !(pending.failed && cachedBrowserResource(item))) return pending.promise;
  const url = item.url;
  const promise = readImageData(tabId, item, options).then(result => {
    if (result.method !== 'decoded-pixels' && item.url === url && readingImages.get(item)?.promise === promise) originalImages.set(item, { url, result });
    return result;
  });
  const entry = { url, promise, failed: false };
  readingImages.set(item, entry);
  promise.catch(() => { entry.failed = true; });
  return promise;
}

async function readImageData(tabId: number, item: ImageItem, { refresh = false }: ReadOptions = {}) {
  const retained = cachedBrowserResource(item);
  if (retained) return { blob: await (await fetch(retained)).blob(), method: item.browserMethod || 'debugger-resource' };
  let pageError;
  try {
    const result = await pageData(tabId, item, false, false);
    if (result.method === 'decoded-pixels') throw new Error('Static pixels are not an original file');
    const blob = await (await fetch(result.dataUrl || '')).blob();
    if (!blob.type.startsWith('image/')) throw new Error(t('页面返回的数据不是图片'));
    return { blob, method: result.method || "page-fetch" };
  } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); pageError = error; }
  if (!/^https?:/.test(item.url) || item.kind === 'canvas') throw pageError;
  try {
    const result = await extractionCall('read', { tabId, item, retry: refresh ? `${++retrySequence}:${crypto.randomUUID()}` : 0 });
    if (!result?.dataUrl) throw new Error('Image unavailable');
    const blob = await (await fetch(result.dataUrl || '')).blob();
    if (!blob.size || !blob.type.startsWith('image/')) throw new Error('Invalid image data');
    return { blob, method: result.method || "page-fetch" };
  } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); throw new Error(`${(pageError instanceof Error ? pageError.message : String(pageError))}；${error.message}`); }
}

export async function convert(blob: Blob, format: string) {
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
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
    if (format === 'jpg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(image, 0, 0);
    const output = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, `image/${format === 'jpg' ? 'jpeg' : format}`, 0.94));
    if (!output) throw new Error(t('浏览器无法转换这张图片'));
    return output;
  } finally { URL.revokeObjectURL(url); }
}

export async function downloadImage(tabId: number, item: ImageItem, index: number, format: string, destination: { folder: string; directory: FileSystemDirectoryHandle | null } = { folder: t("未命名页面"), directory: null }) {
  let result;
  try { result = await readImage(tabId, item); }
  catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
    if (format !== 'original') {
      try { result = await readImage(tabId, item, { preview: 'full' }); } catch { throw error; }
    } else {
    if (destination.directory || format !== 'original' || !/^https?:/.test(item.url) || item.kind === 'canvas') throw error;
    // Useful for large files or servers that treat fetch and downloads differently.
    const downloaded = await save(item.url, filename(item, index, undefined, format, destination.folder));
    if (downloaded.mime && !downloaded.mime.startsWith('image/')) throw new Error(t('直接下载的响应不是图片，请检查下载目录'));
    return { method: 'browser-download', bytes: downloaded.fileSize, downloadId: downloaded.id, actualPath: downloaded.filename };
    }
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
