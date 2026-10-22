import { t } from './i18n.js';
import { readImage } from './api.js';

export function previewOrigin(item) {
  const method = item.retryPreview ? item.previewMethod : item.browserData ? (item.browserMethod || 'debugger-resource') : item.preview ? (item.kind === 'canvas' ? 'canvas' : 'decoded-pixels') :
    /^(data:|blob:)/.test(item.url) ? 'embedded' : 'url';
  if (method === 'mhtml-resource') return { kind: 'page', label: t('归档资源'), detail: t('从网页归档提取完整原始图片数据，没有重新请求图片地址。') };
  if (method === 'debugger-resource') return { kind: 'page', label: t('浏览器资源'), detail: t('直接读取浏览器保留的原始图片数据，没有通过图片 URL 重新请求。') };
  if (method === 'page-cache') return { kind: 'page', label: t('页面提取'), detail: t('预览读取自页面已有缓存中的原文件。') };
  if (['canvas', 'decoded-pixels', 'embedded', 'page-blob'].includes(method)) {
    const detail = method === 'canvas' ? t('预览提取自页面画布。') : method === 'decoded-pixels' ? t('预览直接提取自页面已显示图片的像素，可能是静态缩略图。') : t('预览读取自页面内嵌数据或 Blob。');
    return { kind: 'page', label: t('页面提取'), detail };
  }
  const reasons = {
    'cross-origin': '网页已显示图片，但跨域限制阻止读取页面像素，因此使用图片 URL 加载；可能命中缓存，并不代表重新下载。',
    budget: '批量页面预览数据已达上限，因此使用图片 URL 加载；可能命中缓存。',
    unavailable: '无法提取页面图片像素，因此使用图片 URL 加载；可能命中缓存。',
  };
  return { kind: 'url', label: t('URL 加载'), detail: t(!item.retryPreview && reasons[item.previewIssue] || '预览通过图片 URL 加载，可能使用浏览器缓存；并非直接提取页面已显示图片的像素。') };
}

// Reuse page pixels/cache first. Only bypass the cache if reuse itself failed,
// so a cached HTTP failure can still be recovered without changing signed URLs.
export async function loadPreview(tabId, item) {
  const result = await readImage(tabId, item, { refresh: true, preview: true });
  const { blob, method } = result;
  const url = URL.createObjectURL(blob);
  const image = new Image();
  let timeout;
  try {
    image.src = url;
    await Promise.race([
      image.decode(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(t('图片预览解码超时'))), 10000); }),
    ]);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error(t('无法解码图片预览'));
    return {
      url, method, bytes: blob.size, mime: blob.type,
      width: method === 'decoded-pixels' && item.width ? item.width : image.naturalWidth,
      height: method === 'decoded-pixels' && item.height ? item.height : image.naturalHeight,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    clearTimeout(timeout);
    image.removeAttribute('src');
  }
}
