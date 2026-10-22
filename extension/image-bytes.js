export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
export function imageComplete(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start, end) => new TextDecoder().decode(bytes.subarray(start, end));
  if (mime === 'image/png') {
    if (bytes.length < 33 || ascii(1, 4) !== 'PNG' || bytes[0] !== 137) return false;
    for (let at = 8; at + 12 <= bytes.length;) {
      const size = view.getUint32(at), kind = ascii(at + 4, at + 8);
      if (at + size + 12 > bytes.length) return false;
      if (kind === 'IEND') return size === 0;
      at += size + 12;
    }
    return false;
  }
  if (mime === 'image/gif') return /^GIF8[79]a$/.test(ascii(0, 6)) && bytes.length > 13 && bytes[bytes.length - 1] === 59;
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  if (mime === 'image/webp') return bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' && view.getUint32(4, true) + 8 === bytes.length;
  if (mime === 'image/bmp') return bytes.length >= 26 && ascii(0, 2) === 'BM' && view.getUint32(2, true) === bytes.length;
  if (mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon') {
    if (bytes.length < 6 || view.getUint16(0, true) !== 0 || ![1, 2].includes(view.getUint16(2, true))) return false;
    const count = view.getUint16(4, true);
    if (!count || 6 + count * 16 > bytes.length) return false;
    for (let at = 6; at < 6 + count * 16; at += 16) if (view.getUint32(at + 12, true) + view.getUint32(at + 8, true) > bytes.length) return false;
    return true;
  }
  if (mime === 'image/avif') {
    if (bytes.length < 16 || ascii(4, 8) !== 'ftyp' || !/avif|avis/.test(ascii(8, Math.min(bytes.length, view.getUint32(0))))) return false;
    let at = 0;
    while (at + 8 <= bytes.length) { const size = view.getUint32(at); if (size < 8 || at + size > bytes.length) return false; at += size; }
    return at === bytes.length;
  }
  if (mime === 'image/svg+xml') {
    const text = ascii(0, bytes.length).trim();
    return /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|\/?>)/i.test(text) && (/<\/svg\s*>\s*$/i.test(text) || /<svg\b[^>]*\/\s*>\s*$/i.test(text));
  }
  return false; // Archive completeness cannot be established for unknown formats.
}
export async function responseImage(response, signal) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('image/')) throw new Error('Response is not an image');
  const chunks = []; let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty image response');
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) throw new Error('Image exceeds 20 MiB');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw new Error('Empty image response');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!imageComplete(bytes, mime)) throw new Error('Incomplete image');
  // Unsupported encodings are rejected rather than caching arbitrary image/* bodies.
  return { dataUrl: `data:${mime};base64,${base64(bytes)}`, bytes: size, mime };
}
