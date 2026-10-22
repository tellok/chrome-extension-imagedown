import type { ImageItem } from "./models.js";
import { t } from './i18n.js';
import { imageType } from './lib.js';

export const DEFAULT_THRESHOLDS = Object.freeze({ width: 50, height: 50, minBytes: 2048 });
// Width/height remain global defaults; minBytes is retained only for legacy rollback.
export const THRESHOLD_KEYS = Object.freeze({ width: 'filters:width', height: 'filters:height', minBytes: 'filters:minBytes' });

export function normalizeThreshold(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function siteDomain(url: string|URL|undefined) {
  try {
    const parsed = new URL(url || '');
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase() : '';
  } catch { return ''; }
}

export function ignoreStorageKey(domain: string) { return `ignored:v1:${domain}`; }

export function dataURLBytes(url: string) {
  if (!url?.startsWith('data:')) return null;
  const separator = url.indexOf(',');
  if (separator < 0) return null;
  const header = url.slice(0, separator);
  const payload = url.slice(separator + 1);
  if (/;base64$/i.test(header)) {
    try {
      const base64 = decodeURIComponent(payload).replace(/\s/g, '');
      // Decode rather than count characters: unpadded and escaped Base64 are valid.
      return atob(base64).length;
    } catch { return null; }
  }
  let size = 0;
  for (const token of payload.matchAll(/%[\da-f]{2}|[^%]+|%/gi)) {
    size += /^%[\da-f]{2}$/i.test(token[0]) ? 1 : new TextEncoder().encode(token[0]).length;
  }
  return size;
}

export function imageSize(item: ImageItem) {
  if (typeof item.bytes === 'number' && Number.isFinite(item.bytes) && item.bytes >= 0) {
    return { bytes: item.bytes, estimated: false, source: item.sizeSource || t('已知文件大小') };
  }
  if (item.width > 0 && item.height > 0) {
    // Only a heuristic for compressed file size, never decoded RGBA memory size.
    const ratios: Record<string, number> = { jpg: 0.25, webp: 0.18, avif: 0.12, gif: 0.5, png: 0.75, bmp: 3 }; const ratio = ratios[imageType(item)] || 0.5;
    return { bytes: Math.max(1, Math.round(item.width * item.height * ratio)), estimated: true, source: t('根据像素尺寸和格式估算，实际压缩文件可能有较大差异') };
  }
  return { bytes: null, estimated: false, source: t('无法确定文件大小') };
}

export function formatBytes(bytes: number | null | undefined, estimated = false) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return t('体积未知');
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = bytes ? Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  const value = bytes / 1024 ** index;
  return `${estimated ? '≈ ' : ''}${index ? value.toFixed(value < 10 ? 1 : 0) : value} ${units[index]}`;
}

async function sha256(bytes: BufferSource) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export async function imageMetadataHash(item: ImageItem) {
  let metadata;
  if (item.url.startsWith('data:')) {
    // Hash decoded bytes, not Base64 spelling, whitespace, padding or URL escaping.
    const response = await fetch(item.url);
    const blob = await response.blob();
    metadata = { v: 1, kind: 'embedded', mime: blob.type.split(';')[0].toLowerCase(), bytes: blob.size, digest: await sha256(await blob.arrayBuffer()) };
  } else if (item.kind === 'canvas' || item.url.startsWith('blob:')) {
    // Blob UUIDs and canvas position in a document are not persistent identities.
    if (!item.preview) return '';
    const blob = await (await fetch(item.preview)).blob();
    metadata = { v: 1, kind: 'pixels', width: item.width, height: item.height, digest: await sha256(await blob.arrayBuffer()) };
  } else {
    // Preserve the full resource path/query/fragment: they may select different images.
    // Exclude mutable dimensions, estimated size and download MIME so later metadata
    // enrichment cannot invalidate an ignore rule. Store only the resulting hash.
    metadata = { v: 1, kind: 'url', resource: new URL(item.url).href };
  }
  return sha256(new TextEncoder().encode(JSON.stringify(metadata)));
}

export async function prepareMetadata(items: ImageItem[]) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item.url.startsWith('data:')) {
        item.bytes = dataURLBytes(item.url);
        item.sizeSource = '内嵌图片解码后的文件大小';
      }
      try { item.ignoreHash = await imageMetadataHash(item); }
      catch { item.ignoreHash = ''; }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return items;
}
