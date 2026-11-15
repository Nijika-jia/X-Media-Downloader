const ALLOWED_TYPES = new Set(['photo', 'video', 'animated_gif']);
const MAX_ITEMS_PER_MESSAGE = 200;

export function isAllowedMediaUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    return false;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' &&
      (hostname === 'twimg.com' || hostname.endsWith('.twimg.com'));
  } catch (e) {
    return false;
  }
}

function normalizeId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value).trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

function normalizePhash(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{16}$/i.test(value)) return null;
  return value.toLowerCase();
}

export function normalizeMediaItem(item) {
  if (!item || typeof item !== 'object') return null;

  const id = normalizeId(item.id);
  const type = typeof item.type === 'string' ? item.type : '';
  const url = item.url;
  const thumb = item.thumb || url;

  if (!id || !ALLOWED_TYPES.has(type) || !isAllowedMediaUrl(url) || !isAllowedMediaUrl(thumb)) {
    return null;
  }

  const variants = Array.isArray(item.variants)
    ? item.variants
      .filter(variant => variant && isAllowedMediaUrl(variant.url))
      .slice(0, 20)
      .map(variant => ({
        url: variant.url,
        content_type: typeof variant.content_type === 'string' ? variant.content_type : 'video/mp4',
        bitrate: Number.isFinite(variant.bitrate) ? variant.bitrate : 0
      }))
    : [];

  return {
    id,
    type,
    url,
    thumb,
    variants,
    phash: normalizePhash(item.phash),
    dhash: normalizePhash(item.dhash),
    timestamp: Number.isFinite(item.timestamp) ? item.timestamp : Date.now()
  };
}

export function normalizeMediaItems(items) {
  if (!Array.isArray(items)) return [];

  const result = [];
  const seenIds = new Set();
  for (const item of items.slice(0, MAX_ITEMS_PER_MESSAGE)) {
    const normalized = normalizeMediaItem(item);
    if (!normalized || seenIds.has(normalized.id)) continue;
    seenIds.add(normalized.id);
    result.push(normalized);
  }
  return result;
}

export function sanitizePathPart(value, fallback = 'X_Downloads') {
  const parts = String(value == null ? '' : value)
    .split(/[\\/]+/)
    .filter(part => part && part !== '.' && part !== '..')
    .map(part => part.replace(/[<>:"|?*\x00-\x1f]/g, '_').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join('/') : fallback;
}
