import { object } from './guards.js';
import type { HashRecord } from "./models.js";
import { t } from './i18n.js';
// Browser downloads cannot be read back without directory authorization.
// Retain the hashes of bytes we actually saved, scoped to their absolute target.
async function records(path: string, update?: (previous: HashRecord[]) => HashRecord[]) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('imagetaken-download-hashes', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('downloads');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<HashRecord[]>((resolve, reject) => {
      const transaction = db.transaction('downloads', update ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('downloads');
      const request = store.get(path.normalize('NFC'));
      let value: HashRecord[] = [];
      request.onsuccess = () => {
        const saved: unknown = request.result;
        value = Array.isArray(saved) ? saved.filter((item: unknown): item is HashRecord => object(item) && typeof item.hash === 'string' && typeof item.actualPath === 'string' && typeof item.bytes === 'number' && (item.downloadId === undefined || typeof item.downloadId === 'number')) : [];
        if (update) { value = update(value); store.put(value, path.normalize('NFC')); }
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error || new Error(t('下载哈希记录保存失败')));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function loadDownloadHashes(path: string) { return records(path); }
export function recordDownloadHash(path: string, entry: HashRecord) {
  return records(path, (previous) => [...previous.filter((item) => item.actualPath !== entry.actualPath), entry]);
}
