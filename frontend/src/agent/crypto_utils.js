function bufferToHex(buffer) {
  const view = new Uint8Array(buffer);
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isArrayBuffer(value) {
  return value instanceof ArrayBuffer
    || Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

export async function hashBytes(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Crypto.subtle unavailable');
  }
  let buffer = null;
  if (isArrayBuffer(bytes)) {
    buffer = bytes;
  } else if (ArrayBuffer.isView(bytes)) {
    buffer = bytes.buffer;
  } else if (isArrayBuffer(bytes?.buffer)) {
    buffer = bytes.buffer;
  }
  if (!buffer) {
    throw new Error('Invalid bytes payload');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return bufferToHex(digest);
}

export async function hashText(text) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text || '');
  return hashBytes(bytes);
}

export default {
  hashBytes,
  hashText,
};
