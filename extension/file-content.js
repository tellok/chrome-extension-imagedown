export async function contentHash(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function randomFilename(name) {
  const dot = name.lastIndexOf('.');
  const stem = dot < 0 ? name : name.slice(0, dot);
  const extension = dot < 0 ? '' : name.slice(dot);
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${stem}_${suffix}${extension}`;
}

export function isRandomVariant(name, original) {
  const dot = original.lastIndexOf('.');
  const stem = dot < 0 ? original : original.slice(0, dot);
  const extension = dot < 0 ? '' : original.slice(dot);
  return name.startsWith(`${stem}_`) && name.endsWith(extension) &&
    /^[a-f0-9]{16}$/.test(name.slice(stem.length + 1, extension ? -extension.length : undefined));
}
