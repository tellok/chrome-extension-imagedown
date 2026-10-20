import { t } from './i18n.js';
// Browser downloads cannot be read back without directory authorization.
// Retain the hashes of bytes we actually saved, scoped to their absolute target.
async function records(path, update) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('imagetaken-download-hashes', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('downloads');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('downloads', update ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('downloads');
      const request = store.get(path.normalize('NFC'));
      let value = [];
      request.onsuccess = () => {
        value = request.result || [];
        if (update) { value = update(value); store.put(value, path.normalize('NFC')); }
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error || new Error(t('下载哈希记录保存失败')));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function loadDownloadHashes(path) { return records(path); }
export function recordDownloadHash(path, entry) {
  return records(path, previous => [...previous.filter(item => item.actualPath !== entry.actualPath), entry]);
}
