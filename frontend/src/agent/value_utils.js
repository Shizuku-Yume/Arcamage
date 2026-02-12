export function toCodePointsLength(text) {
  return Array.from(text || '').length;
}

export function toUtf8Bytes(text) {
  return new TextEncoder().encode(text || '').length;
}

export function stableStringify(value) {
  if (value === null) return 'null';
  if (value === undefined) {
    throw new Error('Undefined value cannot be serialized');
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Invalid number value');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    const items = value.map((item) => stableStringify(item));
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function hashValue(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Crypto.subtle unavailable');
  }
  const serialized = stableStringify(value);
  const bytes = new TextEncoder().encode(serialized);
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(buffer);
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function measureValue(value) {
  const serialized = typeof value === 'string' ? value : stableStringify(value);
  return {
    serialized,
    totalChars: toCodePointsLength(serialized),
    totalBytes: toUtf8Bytes(serialized),
  };
}

export function applyTruncate(value, maxChars, maxBytes) {
  const { serialized, totalChars, totalBytes } = measureValue(value);
  const limitChars = Number.isFinite(maxChars) ? maxChars : null;
  const limitBytes = Number.isFinite(maxBytes) ? maxBytes : null;
  let effectiveChars = limitChars;
  if (limitBytes !== null) {
    const bytesToChars = Math.floor((limitBytes / totalBytes) * totalChars);
    effectiveChars = effectiveChars === null ? bytesToChars : Math.min(effectiveChars, bytesToChars);
  }
  if (effectiveChars === null || effectiveChars >= totalChars) {
    return {
      value,
      truncated: false,
      returnedChars: totalChars,
      returnedBytes: totalBytes,
      totalChars,
      totalBytes,
    };
  }
  const truncatedText = Array.from(serialized).slice(0, effectiveChars).join('');
  return {
    value: truncatedText,
    truncated: true,
    returnedChars: toCodePointsLength(truncatedText),
    returnedBytes: toUtf8Bytes(truncatedText),
    totalChars,
    totalBytes,
  };
}

export default {
  toCodePointsLength,
  toUtf8Bytes,
  stableStringify,
  hashValue,
  measureValue,
  applyTruncate,
};
