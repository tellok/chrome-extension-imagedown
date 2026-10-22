import { t } from './i18n.js';
export function imageType(item) {
  if (item.kind === 'canvas') return 'png';
  const mime = item.mime || item.url.match(/^data:([^;,]+)/i)?.[1];
  if (mime?.startsWith('image/')) return mime.split('/')[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg').replace('x-icon', 'ico');
  try { return new URL(item.url).pathname.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase().replace('jpeg', 'jpg') || 'unknown'; }
  catch { return 'unknown'; }
}

export function folderName(title) {
  let name = String(title || '').normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_')
    .trim().replace(/^\.+|[. ]+$/g, '');
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = `_${name}`;
  // Leave room for the image filename; never cut through a Unicode code point.
  let short = '';
  for (const char of name) {
    if (new TextEncoder().encode(short + char).length > 120) break;
    short += char;
  }
  return short.replace(/[. ]+$/g, '') || t('未命名页面');
}

export function filename(item, index, mime, format = 'original', folder = t('未命名页面')) {
  const ext = format === 'original' ? imageType({ ...item, mime }) : format;
  let name = '';
  try { name = decodeURIComponent(new URL(item.url).pathname.split('/').pop()); } catch { /* Use generated name. */ }
  name = name.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_')
    .replace(/^\.+|[. ]+$/g, '').slice(0, 100);
  if (!name || item.kind === 'canvas' || /^(data:|blob:)/.test(item.url)) name = 'image';
  // Always prefix: handles Windows reserved names, collisions and page-controlled paths.
  return `${folderName(folder)}/${String(index + 1).padStart(3, '0')}-${name}.${ext === 'unknown' ? 'img' : ext}`;
}

export function filterImages(items, filters, sizeOf = item => ({ bytes: Number.isFinite(item.bytes) ? item.bytes : null })) {
  const query = filters.query.toLowerCase().trim();
  const filtered = items.filter(item =>
    (!query || `${item.url} ${item.alt}`.toLowerCase().includes(query)) &&
    (!filters.loaded || item.loaded) &&
    (!filters.type || imageType(item) === filters.type) &&
    (!filters.source || item.sources.includes(filters.source)) &&
    (!item.ignored || filters.showIgnored) &&
    (!filters.width || !item.width || item.width >= filters.width) &&
    (!filters.height || !item.height || item.height >= filters.height) &&
    (!filters.minBytes || sizeOf(item).bytes == null || sizeOf(item).bytes >= filters.minBytes));
  return filtered.sort((a, b) => {
    if (filters.readyFirst) {
      const ready = item => item.previewStatus === 'ready' && !item.previewPending;
      const priority = Number(ready(b)) - Number(ready(a));
      if (priority) return priority;
    }
    if (filters.sort === 'area') return b.width * b.height - a.width * a.height;
    if (filters.sort === 'width') return b.width - a.width;
    return a.order - b.order;
  });
}

export const METHOD_LABELS = {
  'mhtml-resource': '浏览器资源 · 原文件',
  'page-referer-fetch': '网页来源请求 · 原文件',
  'image-referer-fetch': '图片来源请求 · 原文件',
  'debugger-resource': '浏览器资源 · 原文件',
  'page-cache': '页面缓存 · 原文件',
  'page-fetch': '页面读取 · 原文件',
  'page-blob': '页面 Blob · 原文件',
  embedded: '内嵌数据',
  canvas: 'Canvas 快照 · PNG',
  'decoded-pixels': '页面像素兜底 · PNG（静态）',
  'extension-fetch': '扩展请求 · 原文件',
  'browser-download': '浏览器直接下载',
};
