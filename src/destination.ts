
import { t } from './i18n.js';
import { folderName } from './lib.js';
import { contentHash, randomFilename, isRandomVariant } from './file-content.js';

const REVISION_KEY = 'download-location:revision';

async function storedDirectory(mode: string, value?: FileSystemDirectoryHandle | null) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('imagetaken-downloads', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const transaction = db.transaction('settings', mode === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('settings');
      const request = mode === 'get' ? store.get('directory') :
        mode === 'delete' ? store.delete('directory') : store.put(value, 'directory');
      transaction.oncomplete = () => resolve(request.result instanceof FileSystemDirectoryHandle ? request.result : null);
      transaction.onabort = () => reject(transaction.error || new Error(t('下载目录设置保存失败')));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function loadDirectory() { return storedDirectory('get'); }
export async function saveDirectory(directory: FileSystemDirectoryHandle | null) {
  await storedDirectory(directory ? 'put' : 'delete', directory);
  await chrome.storage.local.set({ [REVISION_KEY]: crypto.randomUUID() });
}
export function directoryChanged(changes: Record<string, unknown>) { return !!changes[REVISION_KEY]; }

export async function chooseDirectory() {
  if (!window.showDirectoryPicker) throw new Error(t('此浏览器不支持选择本地目录，请使用浏览器默认位置'));
  // Invoke the picker directly in the click handler to retain user activation.
  return window.showDirectoryPicker({ id: 'imagetaken-downloads', mode: 'readwrite', startIn: 'downloads' });
}

export async function prepareDestination(root: FileSystemDirectoryHandle | null, title: string) {
  const folder = folderName(title);
  if (!root) return { folder, directory: null };
  const permission = await root.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error(t('未获得下载目录的写入权限，请重新授权或选择其他目录'));
  const directory = await root.getDirectoryHandle(folder, { create: true });
  return { folder, directory };
}

export async function writeImage(directory: FileSystemDirectoryHandle, name: string, blob: Blob) {
  const hash = await contentHash(blob);
  // Serialize collision detection and writing across panels.
  return navigator.locks.request('imagetaken-file-write', async () => {
    let candidate = name;
    let original;
    try { original = await directory.getFileHandle(name); }
    catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); if (error.name !== 'NotFoundError') throw error; }
    if (original) {
      if (await contentHash(await original.getFile()) === hash) return { name, skipped: true };
      // Also recognize a previously saved different image with a random suffix.
      for await (const [entryName, handle] of directory.entries()) {
        if (handle.kind === 'file' && isRandomVariant(entryName, name) &&
            await contentHash(await handle.getFile()) === hash) return { name: entryName, skipped: true };
      }
      candidate = randomFilename(name);
      for (;;) {
        try {
          const existing = await directory.getFileHandle(candidate);
          if (await contentHash(await existing.getFile()) === hash) return { name: candidate, skipped: true };
          candidate = randomFilename(name);
        } catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); if (error.name === 'NotFoundError') break; throw error; }
      }
    }
    const file = await directory.getFileHandle(candidate, { create: true });
    const writable = await file.createWritable();
    try { await writable.write(blob); await writable.close(); }
    catch (caughtError) { const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError)); await writable.abort().catch(() => {}); throw error; }
    return { name: candidate, skipped: false };
  });
}
