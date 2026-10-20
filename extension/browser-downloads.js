import { t } from './i18n.js';
import { randomFilename } from './file-content.js';
import { loadDownloadHashes, recordDownloadHash } from './download-hashes.js';

export function downloadTargetKey(url) { return `download-target:${url}`; }

export function matchesDownloadFolder(actualPath, requestedPath) {
  const actual = String(actualPath || '').replace(/\\/g, '/').normalize('NFC').split('/');
  const requested = requestedPath.normalize('NFC').split('/');
  return actual.length >= requested.length && actual.at(-2) === requested.at(-2);
}

// Chrome can discard a Blob download's filename option when another extension
// listens to onDeterminingFilename, even if that listener calls suggest().
// Persist the intended name before starting, so our background listener can
// explicitly suggest it in that event. Serialize writes across panels.
export async function saveBrowserDownload(url, name, hash = null) {
  return navigator.locks.request('imagetaken-browser-file-write', async () => {
    let download = await saveAttempt(url, name);
    const normalized = download.filename.replace(/\\/g, '/');
    const base = name.slice(name.lastIndexOf('/') + 1);
    const folder = normalized.slice(0, normalized.lastIndexOf('/') + 1);
    const target = `${folder}${base}`;
    if (normalized.slice(normalized.lastIndexOf('/') + 1) !== base) {
      // Determine the actual default directory from this completed download,
      // rather than assuming that Chrome's default location never changes.
      if (hash) {
        const previous = await loadDownloadHashes(target);
        for (const entry of previous.filter(entry => entry.hash === hash)) {
          const [existing] = await chrome.downloads.search({ id: entry.downloadId });
          if (existing?.state === 'complete' && existing.exists && existing.filename === entry.actualPath && existing.fileSize === entry.bytes) {
            // Remove only the duplicate just created by this attempt.
            await chrome.downloads.removeFile(download.id);
            return { ...existing, skipped: true };
          }
        }
      }
      // Chrome cannot rename an existing download. Save with a random suffix
      // before removing our provisional copy, so a failed retry loses no data.
      for (let attempt = 0; attempt < 5; attempt++) {
        const randomName = `${name.slice(0, name.lastIndexOf('/') + 1)}${randomFilename(base)}`;
        const previous = download;
        download = await saveAttempt(url, randomName);
        await chrome.downloads.removeFile(previous.id);
        if (download.filename.replace(/\\/g, '/').split('/').at(-1) === randomName.split('/').at(-1)) break;
        if (attempt === 4) throw new Error(t('下载文件名持续被改写，无法保存随机后缀；请改用自定义目录'));
      }
    }
    if (hash) await recordDownloadHash(target, {
      hash, downloadId: download.id, actualPath: download.filename, bytes: download.fileSize,
    });
    return { ...download, skipped: false };
  });
}

async function saveAttempt(url, name) {
  const key = downloadTargetKey(url);
  await chrome.storage.session.set({ [key]: name });
  try {
    const download = await trackedDownload(url, name);
    if (!matchesDownloadFolder(download.filename, name)) {
      const error = new Error(t(`图片已下载，但未进入标题文件夹「{0}」。实际保存位置：{1}。下载路径可能被其他扩展改写；可选择本地目录后重试。`, name.split('/')[0], download.filename));
      error.downloadId = download.id;
      error.actualPath = download.filename;
      throw error;
    }
    return download;
  } finally { await chrome.storage.session.remove(key); }
}

// Resolve only on actual completion, keeping the Blob alive until then.
async function trackedDownload(url, name) {
  const response = await chrome.runtime.sendMessage({ type: 'start-browser-download', url, filename: name });
  if (response?.error || !Number.isInteger(response?.id)) throw new Error(response?.error || t('无法启动下载'));
  const id = response.id;
  return new Promise((resolve, reject) => {
    let poll, timeout;
    const cleanup = () => {
      clearInterval(poll); clearTimeout(timeout); chrome.downloads.onChanged.removeListener(listener);
    };
    const check = async () => {
      try {
        const [download] = await chrome.downloads.search({ id });
        if (download?.state === 'complete') { cleanup(); resolve(download); }
        else if (download?.state === 'interrupted') { cleanup(); reject(new Error(download.error || t('下载中断'))); }
      } catch (error) { cleanup(); reject(error); }
    };
    const listener = delta => { if (delta.id === id && (delta.state || delta.error)) void check(); };
    chrome.downloads.onChanged.addListener(listener);
    poll = setInterval(check, 1000);
    timeout = setTimeout(() => {
      cleanup();
      void chrome.downloads.cancel(id).catch(() => {});
      reject(new Error(t('下载超时（120 秒），已取消，请重试')));
    }, 120_000);
    void check();
  });
}

