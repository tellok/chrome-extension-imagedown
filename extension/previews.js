import { readImage } from './api.js';

// Retrying goes through the page/extension reader rather than repeating an <img>
// request with the same failed cache entry. The source URL/signature stays intact.
export async function loadPreview(tabId, item) {
  const { blob, method } = await readImage(tabId, item, { refresh: true });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  let timeout;
  try {
    image.src = url;
    await Promise.race([
      image.decode(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('图片预览解码超时')), 10000); }),
    ]);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('无法解码图片预览');
    return { url, width: image.naturalWidth, height: image.naturalHeight, bytes: blob.size, mime: blob.type, method };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    clearTimeout(timeout);
    image.removeAttribute('src');
  }
}
