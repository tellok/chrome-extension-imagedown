import type { ImageItem, DownloadResult } from "./models.js";
interface ManifestEntry { url: string; kind: string; sources: string[]; sourcePageUrl: string; originalTitle: string; collectedAt: string; sourceReference: string; result: DownloadResult | null }
export interface ManifestBatch { id: string; createdAt: string; folder: string; entries: ManifestEntry[] }
import { folderName } from './lib.js';
import { writeImage } from './destination.js';
import { saveBrowserDownload } from './browser-downloads.js';

// Capture provenance before asynchronous downloads or page mutations can change it.
export function createManifestBatch(items: ImageItem[], title: string): ManifestBatch {
  return {
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), folder: folderName(title),
    entries: items.map((item) => ({
      url: item.url || '', kind: item.kind || '', sources: [...(item.sources || [])],
      sourcePageUrl: item.sourcePageUrl || '', originalTitle: item.originalTitle || '',
      collectedAt: item.collectedAt || '', sourceReference: item.sourceReference || '', result: null,
    })),
  };
}

export function manifestFilename(batch: ManifestBatch) { return `${batch.folder}.txt`; }
const value = (input: unknown) => JSON.stringify(String(input || 'Not provided')).slice(1, -1);
const basename = (path: unknown) => String(path || '').replace(/\\/g, '/').split('/').at(-1);

function provenance(entry: ManifestEntry) {
  const remote = entry.kind !== 'canvas' && /^https?:\/\//i.test(entry.url) ? entry.url : '';
  let reference = entry.sourceReference;
  if (/^blob:/i.test(entry.url)) reference = [reference, entry.url].filter(Boolean).join(' · ');
  else if (/^data:/i.test(entry.url)) reference = [reference, entry.url.split(/[;,]/, 1)[0]].filter(Boolean).join(' · ');
  return [
    `remote URL: ${remote ? value(remote) : 'No valid remote URL'}`,
    `source reference: ${value(reference || entry.kind || entry.sources.join(', '))}`,
    `source page URL: ${value(entry.sourcePageUrl)}`,
    `original title: ${value(entry.originalTitle)}`,
    `collected at: ${value(entry.collectedAt)}`,
  ];
}

export function manifestText(batch: ManifestBatch) {
  const success: string[] = [], failures: string[] = [];
  batch.entries.forEach((entry, index) => {
    const result = entry.result;
    const name = basename(result?.savedName || result?.actualPath);
    const failed = !result || result.error || result.misplaced || !name;
    const lines = [`[${index + 1}]`, `status: ${failed ? 'Failed' : result.skipped ? 'Reused existing file' : 'Saved'}`];
    if (!failed) lines.push(`local filename: ${value(name)}`);
    else {
      lines.push(`error: ${value(result?.error || 'No confirmed local file')}`);
      if (result?.actualPath) lines.push(`actual path (not correctly archived): ${value(result.actualPath)}`);
    }
    lines.push(...provenance(entry));
    (failed ? failures : success).push(lines.join('\n'));
  });
  return [
    'ImageTaken image manifest', `batch ID: ${batch.id}`, `created at: ${batch.createdAt}`,
    `download title: ${value(batch.folder)}`, '', `Saved / reused images: ${success.length}`,
    ...success.map(entry => `\n${entry}`), '', `Failed images: ${failures.length}`,
    ...failures.map(entry => `\n${entry}`), '',
  ].join('\n');
}

export function manifestBlob(batch: ManifestBatch) { return new Blob([manifestText(batch)], { type: 'text/plain;charset=utf-8' }); }

export async function saveManifest(batch: ManifestBatch, destination: { folder: string; directory: FileSystemDirectoryHandle | null }) {
  const blob = manifestBlob(batch), name = manifestFilename(batch);
  if (destination.directory) return writeImage(destination.directory, name, blob);
  const url = URL.createObjectURL(blob);
  try {
    const result = await saveBrowserDownload(url, `${destination.folder}/${name}`);
    return { ...result, downloadId: result.id };
  } finally { URL.revokeObjectURL(url); }
}
