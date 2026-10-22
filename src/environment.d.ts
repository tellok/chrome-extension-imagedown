interface FileSystemDirectoryHandle {
  requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
}
interface Window { showDirectoryPicker?: (options: { id: string; mode: 'readwrite'; startIn: 'downloads' }) => Promise<FileSystemDirectoryHandle> }
interface Event { previousLanguage?: string }
declare var __imageTaken: {
  scan: (xpath?: string, selectors?: string, passive?: boolean) => import('./models.js').ScanResult;
  read: (id: string, options?: import('./models.js').ReadOptions) => Promise<Partial<import('./models.js').ImageData> & { error?: string }>;
  resource: (id: string) => { url: string; ready: boolean; signature: number } | null;
  targets: (ids: string[]) => import('./models.js').PageTarget[];
  registerResources: (urls: string[]) => (import("./models.js").SourceRecord | { id: string; url: string })[];
} | undefined;
declare var __imageTakenHighlights: {
  owns: (node: Node | null) => boolean;
  receive: (message: import('./models.js').HighlightMessage) => boolean;
  snapshot: () => { sessions: number; active: boolean; host: boolean; rectangles: { x: number; y: number; width: number; height: number; border: string; color: string; pointerEvents: string }[] };
} | undefined;
declare var __imageTakenBadgeObserver: { notify: () => void } | undefined;
declare var __imageTakenBadgeDiagnostics: Map<number, { state: string; error?: string; ready?: string; total?: number; documentId?: string; updatedAt: number }>;
