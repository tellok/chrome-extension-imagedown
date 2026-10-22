import type { DiscoveredImage, DiscoveredReference, EffectiveState, ImageData, Origin, ResourceItem, RuleDocument, RuleMatch, RuleOptions, RuleSource, Subscription, SubscriptionState, SyncMeta, SyncPayload, SyncStatus, Thresholds, Vector } from './models.js';

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
export function element<T extends Element>(value: Element | null, ctor: { new (...args: never[]): T }): T {
  if (!(value instanceof ctor)) throw new Error('Missing or unexpected element');
  return value;
}
const string = (value: unknown): value is string => typeof value === 'string';
const number = (value: unknown): value is number => typeof value === 'number';
const boolean = (value: unknown): value is boolean => typeof value === 'boolean';
function optional(value: Record<string, unknown>, keys: string[], guard: (item: unknown) => boolean) {
  return keys.every(key => value[key] === undefined || guard(value[key]));
}
export function isVector(value: unknown): value is Vector { return object(value) && Object.values(value).every(number); }
function isPayload(value: unknown): value is SyncPayload {
  return object(value) && number(value.version) && object(value.settings) && object(value.sites) && Object.values(value.sites).every(object) && Array.isArray(value.subscriptions) && value.subscriptions.every(string);
}
export function isSyncMeta(value: unknown): value is SyncMeta {
  return object(value) && string(value.deviceId) && number(value.counter) && (value.baseline === null || string(value.baseline)) &&
    Array.isArray(value.pending) && value.pending.every(string) && Array.isArray(value.backups) &&
    value.backups.every((item: unknown) => object(item) && number(item.savedAt) && isPayload(item.payload)) &&
    optional(value, ['publishedAt'], number) && optional(value, ['lastGood'], isPayload);
}
export function isSyncStatus(value: unknown): value is SyncStatus {
  return object(value) && string(value.state) && boolean(value.ready) && Array.isArray(value.candidates) &&
    value.candidates.every((item: unknown) => object(item) && string(item.revision) && string(item.deviceId) && number(item.updatedAt) && isPayload(item.payload)) &&
    optional(value, ['enabled'], boolean) && optional(value, ['token', 'error'], string) && optional(value, ['writtenAt'], number) && optional(value, ['local'], isPayload);
}
export function isImageData(value: unknown): value is ImageData {
  return object(value) && string(value.dataUrl) && string(value.method) && optional(value, ['bytes'], number) &&
    optional(value, ['mime', 'url', 'key'], string) && optional(value, ['origin'], isOrigin);
}
export function isOrigin(value: unknown): value is Origin {
  return object(value) && string(value.id) && string(value.documentId) && optional(value, ['frameId'], number);
}
export function isDiscoveredReference(value: unknown): value is DiscoveredReference {
  return object(value) && string(value.id) && string(value.url) && Array.isArray(value.origins) && value.origins.every(isOrigin);
}
export function isDiscoveredImage(value: unknown): value is DiscoveredImage {
  return object(value) && string(value.id) && string(value.url) && string(value.kind) && Array.isArray(value.sources) && value.sources.every(string) &&
    number(value.width) && number(value.height) && boolean(value.loaded) && string(value.preview) && Array.isArray(value.origins) && value.origins.every(isOrigin) &&
    optional(value, ['bytes'], item => item === null || number(item)) &&
    optional(value, ['position', 'resourceSignature', 'previewGeneration'], number) && optional(value, ['ignored', 'previewPending'], boolean) &&
    optional(value, ['sizeSource', 'alt', 'sourcePageUrl', 'originalTitle', 'collectedAt', 'sourceReference', 'mime', 'previewIssue', 'ignoreHash', 'previewStatus', 'previewError', 'retryPreview', 'previewMethod', 'previewOrigin', 'browserMethod', 'browserData', 'browserDataURL'], string) &&
    optional(value, ['browserOrigin'], isOrigin);
}
export function isRuleOptions(value: unknown): value is RuleOptions {
  return object(value) && optional(value, ['width', 'height', 'minBytes'], number) && optional(value, ['loaded', 'showIgnored'], boolean) &&
    optional(value, ['query', 'type', 'source', 'xpath', 'excludedSelectors'], string);
}
export function isRuleSource(value: unknown): value is RuleSource { return object(value) && ['id', 'url', 'domain', 'rule'].every(key => string(value[key])); }
export function isRuleMatch(value: unknown): value is RuleMatch { return object(value) && isRuleOptions(value.options) && (value.source === null || isRuleSource(value.source)); }
function isThresholds(value: unknown): value is Thresholds { return object(value) && ['width', 'height', 'minBytes'].every(key => number(value[key])); }
export function isEffectiveState(value: unknown): value is EffectiveState {
  if (!object(value) || !object(value.values)) return false;
  const values = value.values;
  return isThresholds(values) && ['query', 'type', 'source', 'xpath', 'excludedSelectors'].every(key => string(values[key])) &&
    boolean(values.loaded) && boolean(values.showIgnored) && optional(values, ['sort'], string) && optional(values, ['readyFirst'], boolean) &&
    isThresholds(value.defaults) && isRuleOptions(value.overrides) && object(value.origins) && Object.values(value.origins).every(string) &&
    isRuleOptions(value.remoteOptions) && (value.remote === null || isRuleSource(value.remote)) && optional(value, ['revision'], number) && optional(value, ['error'], string);
}
function isRuleDocument(value: unknown): value is RuleDocument {
  return object(value) && number(value.version) && Array.isArray(value.rules) && value.rules.every((rule: unknown) =>
    object(rule) && string(rule.pattern) && optional(rule, ['id', 'flags'], string) && isRuleOptions(rule.options));
}
export function isSubscriptionState(value: unknown): value is SubscriptionState & { entries: (Subscription & { refreshing?: boolean })[] } {
  return object(value) && number(value.revision) && Array.isArray(value.entries) && value.entries.every((entry: unknown) =>
    object(entry) && string(entry.id) && string(entry.url) && string(entry.domain) && optional(entry, ['document'], isRuleDocument) &&
    optional(entry, ['error'], string) && optional(entry, ['lastSuccess', 'lastAttempt'], item => item === null || number(item)) &&
    optional(entry, ['updatedAt'], number) && optional(entry, ['refreshing'], boolean));
}
export function reply(value: unknown): Record<string, unknown> { if (!object(value)) throw new Error('Invalid extension response'); return value; }
export function isResourceItem(value: unknown): value is ResourceItem {
  return object(value) && string(value.key) && string(value.url) && Array.isArray(value.origins) && value.origins.every(isOrigin);
}
