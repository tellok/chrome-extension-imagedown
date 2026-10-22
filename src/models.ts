/** Shared contracts. Page element references never cross the message boundary. */
export interface Origin { id: string; documentId: string; frameId?: number }
export interface ImageItem {
  id: string; url: string; kind: string; sources: string[]; width: number; height: number;
  loaded: boolean; preview: string; bytes?: number | null; sizeSource?: string; alt?: string;
  sourcePageUrl?: string; originalTitle?: string; collectedAt?: string; sourceReference?: string;
  key: string; origins: Origin[]; order: number; position?: number;
  mime?: string; resourceSignature?: number; previewIssue?: string; ignoreHash?: string;
  ignored?: boolean; previewStatus?: string; previewPending?: boolean; previewError?: string;
  retryPreview?: string; previewMethod?: string; previewGeneration?: number; previewOrigin?: string;
  browserMethod?: string; browserData?: string; browserDataURL?: string; browserOrigin?: Origin;
}
export type ResourceItem = Pick<ImageItem, 'key' | 'url' | 'origins'>;
export type DiscoveredReference = Pick<ImageItem, 'id' | 'url' | 'origins'>;
export type DiscoveredImage = Omit<ImageItem, 'key' | 'order'>;
export interface ImageData { dataUrl: string; method: string; bytes?: number; mime?: string; origin?: Origin; url?: string; key?: string }
export interface ReadOptions { refresh?: boolean; preview?: boolean | 'full' }
export interface Filters {
  query: string; width: number; height: number; minBytes: number; showIgnored: boolean;
  type: string; source: string; loaded: boolean; sort?: string; readyFirst?: boolean;
}
export interface Thresholds { width: number; height: number; minBytes: number }
export type ThresholdField = keyof Thresholds;
export type RuleOptions = Partial<Omit<Filters, 'sort' | 'readyFirst'> & { xpath: string; excludedSelectors: string }>;
export interface Rule { id?: string; pattern: string; flags?: string; options: RuleOptions }
export interface RuleDocument { version: number; rules: Rule[] }
export interface Subscription { id: string; url: string; domain: string; document?: RuleDocument; error?: string; lastSuccess?: number | null; lastAttempt?: number | null; updatedAt?: number }
export interface RuleSource { id: string; url: string; domain: string; rule: string }
export interface RuleMatch { options: RuleOptions; source: RuleSource | null }
export interface ThresholdState { values: Thresholds; defaults: Thresholds; overrides: Partial<Thresholds> }
export interface LocalPreferences { defaults?: Partial<Thresholds>; overrides?: RuleOptions }
export interface DownloadResult { savedName?: string; actualPath?: string; id?: number; downloadId?: number; skipped?: boolean; error?: string; method?: string; mime?: string; bytes?: number; status?: string; misplaced?: boolean; pending?: boolean; format?: string }
export interface HashRecord { hash: string; downloadId?: number; actualPath: string; bytes: number }
export type Vector = Record<string, number>;
export interface SyncPayload { version: number; settings: Record<string, unknown>; sites: Record<string, Record<string, unknown>>; subscriptions: string[] }
export interface SyncHead { version: number; deviceId: string; revision: string; vector: Vector; updatedAt: number; payloadHash: string; chunks: string[]; length: number; key?: string }
export interface SyncVersion { head: SyncHead; payload: SyncPayload }
export interface PageTarget { element: Element; valid: () => boolean; node?: Element; source?: string }
export interface HighlightMessage { session?: string; sequence?: number; operation?: string; ids?: string[] }
export interface SourceRecord extends Partial<ImageItem> { id: string; url: string; sources: string[]; loaded: boolean; width: number; height: number; preview: string; kind: string; element?: Element; snapshot?: string; occurrences?: PageTarget[] }
export interface ScanResult { items?: Omit<ImageItem, 'key' | 'origins' | 'order'>[]; error?: string; title?: string; url?: string; truncated?: boolean; matchedRoots?: number }
export interface Storage {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
export interface SyncStorage extends Storage { getBytesInUse(keys: null): Promise<number>; QUOTA_BYTES?: number; MAX_ITEMS?: number }
export interface AlarmAPI { clear(name: string): Promise<boolean>; get(name: string): Promise<chrome.alarms.Alarm | undefined>; create(name: string, options: chrome.alarms.AlarmCreateInfo): Promise<void> | void }
export interface SubscriptionState { revision: number; entries: Subscription[] }
export type RuleValues = Filters & { xpath: string; excludedSelectors: string };
export interface EffectiveState extends ThresholdState { values: RuleValues; origins: Record<string, string>; remote: RuleSource | null; remoteOptions: RuleOptions; revision?: number; error?: string }
export interface SyncCandidate { revision: string; deviceId: string; updatedAt: number; payload: SyncPayload }
export interface SyncStatus { state: string; ready: boolean; enabled?: boolean; candidates: SyncCandidate[]; token?: string; local?: SyncPayload; error?: string; writtenAt?: number }
export interface SyncMeta { deviceId: string; counter: number; baseline: string | null; pending: string[]; backups: { savedAt: number; payload: SyncPayload }[]; publishedAt?: number; lastGood?: SyncPayload }
