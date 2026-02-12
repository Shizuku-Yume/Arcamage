import { toCodePointsLength, toUtf8Bytes, applyTruncate } from './value_utils.js';
import { hashBytes, hashText } from './crypto_utils.js';

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
]);

const IMAGE_MIME_PREFIX = 'image/';

const MAX_REF_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 200000;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 256;
const DEFAULT_MAX_HITS = 20;
const MAX_HITS = 200;
const DEFAULT_SNIPPET_CHARS = 120;
const EXTRACTION_VERSION = 'text-utf8-v1';

const registry = {
  refs: [],
  index: new Map(),
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeMimeType(mime, name) {
  if (mime) return mime;
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  return '';
}

function normalizeText(text) {
  if (!text) return '';
  let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.charCodeAt(0) === 0xfeff) {
    normalized = normalized.slice(1);
  }
  return normalized;
}

function detectInstructionalText(text) {
  if (!text || typeof text !== 'string') return false;
  const patterns = [
    /(^|[\n\r])\s*(ignore|disregard)\s+(all\s+)?(previous|prior)\s+instructions?\b/i,
    /(^|[\n\r])\s*(do\s*not|don't)\s+follow\s+(the\s+)?(system|developer|previous)\s+instructions?\b/i,
    /(^|[\n\r])\s*(override|bypass)\s+(the\s+)?(system|developer|safety|guardrail)\w*\b/i,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function buildRefId() {
  return `ref_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function storeRef(ref) {
  registry.refs.push(ref);
  registry.index.set(ref.ref_id, ref);
  return ref;
}

function removeRef(refId) {
  registry.refs = registry.refs.filter((item) => item.ref_id !== refId);
  registry.index.delete(refId);
}

export function getRefRegistry() {
  return registry;
}

export function resetRefRegistry() {
  registry.refs = [];
  registry.index.clear();
}

export function listRefs(filters = {}) {
  const mimeFilter = filters?.mime;
  const hasTextFilter = typeof filters?.has_text === 'boolean' ? filters.has_text : null;
  const maxBytes = Number.isFinite(filters?.max_bytes) ? filters.max_bytes : null;
  const createdAfter = filters?.created_after ? new Date(filters.created_after) : null;

  return registry.refs
    .filter((ref) => {
      if (mimeFilter && ref.mime !== mimeFilter) return false;
      if (hasTextFilter !== null && Boolean(ref.has_text) !== hasTextFilter) return false;
      if (maxBytes !== null && ref.bytes > maxBytes) return false;
      if (createdAfter && new Date(ref.created_at) <= createdAfter) return false;
      return true;
    })
    .map((ref) => ({
      ref_id: ref.ref_id,
      name: ref.name,
      mime: ref.mime,
      bytes: ref.bytes,
      text_chars: ref.text_chars ?? null,
      page_count: ref.page_count ?? null,
      has_text: Boolean(ref.has_text),
      sha256: ref.sha256,
      created_at: ref.created_at,
    }));
}

export async function registerRefFile(file) {
  if (!file) {
    return { status: 'error', error_code: 'E_REF_PARSE_FAILED', message: '文件不存在' };
  }
  const mime = normalizeMimeType(file.type, file.name);
  const isImage = mime.startsWith(IMAGE_MIME_PREFIX);
  const isText = TEXT_MIME_TYPES.has(mime);
  const maxBytes = MAX_REF_BYTES;
  if (file.size > maxBytes) {
    return { status: 'error', error_code: 'E_REF_TOO_LARGE', message: '附件过大' };
  }

  if (!isText && !isImage) {
    return { status: 'error', error_code: 'E_REF_PARSE_FAILED', message: '附件类型不支持' };
  }

  let bytesHash = null;
  try {
    const buffer = await file.arrayBuffer();
    bytesHash = await hashBytes(buffer);
  } catch (error) {
    return { status: 'error', error_code: 'E_REF_PARSE_FAILED', message: error?.message || '附件解析失败' };
  }

  let text = '';
  let textChars = null;
  let textBytes = null;
  let currentHash = null;
  let textTruncated = false;
  let hasInstructional = false;

  if (isText) {
    try {
      const raw = await file.text();
      const normalized = normalizeText(raw);
      textChars = toCodePointsLength(normalized);
      textBytes = toUtf8Bytes(normalized);
      if (textChars > MAX_TEXT_CHARS) {
        const truncated = applyTruncate(normalized, MAX_TEXT_CHARS, null);
        text = truncated.value;
        textTruncated = true;
      } else {
        text = normalized;
      }
      currentHash = await hashText(normalized);
      hasInstructional = detectInstructionalText(normalized);
    } catch (error) {
      return { status: 'error', error_code: 'E_REF_PARSE_FAILED', message: error?.message || '附件读取失败' };
    }
  }

  const ref = {
    ref_id: buildRefId(),
    name: file.name || 'attachment',
    mime: mime || file.type || 'application/octet-stream',
    bytes: file.size,
    sha256: bytesHash,
    created_at: nowIso(),
    has_text: isText,
    text_chars: textChars,
    text_bytes: textBytes,
    text_truncated: textTruncated,
    page_count: null,
    current_hash: currentHash,
    extraction_version: isText ? EXTRACTION_VERSION : null,
    text,
    has_instructional: hasInstructional,
    is_image: isImage,
  };

  storeRef(ref);

  const warnings = [];
  if (textTruncated) {
    warnings.push({ code: 'W_REF_TRUNCATED', message: '附件文本已截断', severity: 'warn' });
  }
  if (hasInstructional) {
    warnings.push({
      code: 'W_REF_INSTRUCTIONAL_TEXT',
      message: '附件包含疑似指令文本，请谨慎使用',
      severity: 'warn',
    });
  }
  if (isImage) {
    warnings.push({
      code: 'W_REF_NO_TEXT',
      message: '无可检索文本',
      severity: 'info',
    });
  }

  return { status: 'ok', ref, warnings };
}

export function unregisterRef(refId) {
  removeRef(refId);
}

function getRef(refId) {
  return registry.index.get(refId) || null;
}

export function viewRef({ ref_id, offset = 0, max_chars = null, max_bytes = null }) {
  const ref = getRef(ref_id);
  if (!ref) {
    return { status: 'error', error_code: 'E_REF_NOT_FOUND', message: '附件不存在' };
  }
  if (!ref.has_text) {
    const warnings = [];
    if (ref.is_image) {
      warnings.push({
        code: 'W_REF_OCR_REQUIRED',
        message: '附件无文本层，请提供 OCR 文本',
        severity: 'warn',
      });
    }
    return { status: 'error', error_code: 'E_REF_NOT_TEXT', message: '附件无可用文本', warnings };
  }

  const start = Math.max(0, Number(offset) || 0);
  const text = ref.text || '';
  const slice = Array.from(text).slice(start).join('');
  const truncation = applyTruncate(slice, max_chars ?? MAX_TEXT_CHARS, max_bytes);
  const warnings = [];
  if (truncation.truncated || ref.text_truncated) {
    warnings.push({ code: 'W_REF_TRUNCATED', message: '附件文本已截断', severity: 'warn' });
  }
  if (ref.has_instructional) {
    warnings.push({
      code: 'W_REF_INSTRUCTIONAL_TEXT',
      message: '附件包含疑似指令文本，请谨慎使用',
      severity: 'warn',
    });
  }
  return {
    status: 'ok',
    content: truncation.value,
    offset: start,
    returned_chars: truncation.returnedChars,
    returned_bytes: truncation.returnedBytes,
    total_chars: ref.text_chars ?? toCodePointsLength(text),
    total_bytes: ref.text_bytes ?? toUtf8Bytes(text),
    truncated: truncation.truncated,
    current_hash: ref.current_hash,
    warnings,
  };
}

export function searchRef({
  ref_id,
  query,
  max_hits = DEFAULT_MAX_HITS,
  snippet_chars = DEFAULT_SNIPPET_CHARS,
  mode = 'literal',
  flags = '',
}) {
  const ref = getRef(ref_id);
  if (!ref) {
    return { status: 'error', error_code: 'E_REF_NOT_FOUND', message: '附件不存在' };
  }
  if (!ref.has_text) {
    const warnings = [];
    if (ref.is_image) {
      warnings.push({
        code: 'W_REF_OCR_REQUIRED',
        message: '附件无文本层，请提供 OCR 文本',
        severity: 'warn',
      });
    }
    return { status: 'error', error_code: 'E_REF_NOT_TEXT', message: '附件无可用文本', warnings };
  }
  const trimmed = String(query || '').trim();
  if (trimmed.length < MIN_QUERY_LENGTH || trimmed.length > MAX_QUERY_LENGTH) {
    return { status: 'error', error_code: 'E_CONSTRAINT_VIOLATION', message: 'query 长度不合法' };
  }
  const hitsLimit = Number.isFinite(max_hits) ? Math.min(max_hits, MAX_HITS) : DEFAULT_MAX_HITS;
  if (hitsLimit <= 0) {
    return { status: 'error', error_code: 'E_CONSTRAINT_VIOLATION', message: 'max_hits 不合法' };
  }
  const snippetLimit = Number.isFinite(snippet_chars) ? snippet_chars : DEFAULT_SNIPPET_CHARS;
  if (snippetLimit <= 0) {
    return { status: 'error', error_code: 'E_CONSTRAINT_VIOLATION', message: 'snippet_chars 不合法' };
  }
  if (mode !== 'literal' && mode !== 'regex') {
    return { status: 'error', error_code: 'E_CONSTRAINT_VIOLATION', message: 'mode 不支持' };
  }

  const text = ref.text || '';
  const hits = [];
  let regexGuardHit = false;

  if (mode === 'regex') {
    const rawFlags = typeof flags === 'string' ? flags.trim() : '';
    if (rawFlags && !/^[gimsuy]*$/.test(rawFlags)) {
      return { status: 'error', error_code: 'E_CONSTRAINT_VIOLATION', message: 'flags 不支持' };
    }

    const normalizedFlags = Array.from(new Set(rawFlags.split('').filter(Boolean))).join('');
    const regexFlags = normalizedFlags.includes('g') ? normalizedFlags : `${normalizedFlags}g`;

    let matcher;
    try {
      matcher = new RegExp(trimmed, regexFlags);
    } catch {
      return { status: 'error', error_code: 'E_QUERY_INVALID', message: 'regex 无效' };
    }

    let guard = 0;
    const guardLimit = Math.max(1000, hitsLimit * 20);
    while (hits.length < hitsLimit && guard < guardLimit) {
      guard += 1;
      const match = matcher.exec(text);
      if (!match) break;

      const matchedText = typeof match[0] === 'string' ? match[0] : '';
      const matchLength = Math.max(1, matchedText.length);
      const index = Number.isFinite(match.index) ? match.index : Math.max(0, matcher.lastIndex - matchLength);
      const snippetStart = Math.max(0, index - Math.floor(snippetLimit / 2));
      const snippetEnd = Math.min(text.length, snippetStart + snippetLimit);
      const snippet = text.slice(snippetStart, snippetEnd);
      hits.push({
        offset: index,
        length: matchedText.length,
        snippet,
      });

      if (matchedText.length === 0) {
        matcher.lastIndex += 1;
      }
    }

    if (guard >= guardLimit) {
      regexGuardHit = true;
    }
  } else {
    let start = 0;
    while (hits.length < hitsLimit) {
      const index = text.indexOf(trimmed, start);
      if (index === -1) break;
      const snippetStart = Math.max(0, index - Math.floor(snippetLimit / 2));
      const snippetEnd = Math.min(text.length, snippetStart + snippetLimit);
      const snippet = text.slice(snippetStart, snippetEnd);
      hits.push({
        offset: index,
        length: trimmed.length,
        snippet,
      });
      start = index + trimmed.length;
    }
  }

  const warnings = [];
  if (regexGuardHit) {
    warnings.push({ code: 'W_REGEX_GUARD', message: 'regex 命中次数过多，已提前停止', severity: 'warn' });
  }
  if (ref.text_truncated) {
    warnings.push({ code: 'W_REF_TRUNCATED', message: '附件文本已截断', severity: 'warn' });
  }
  if (ref.has_instructional) {
    warnings.push({
      code: 'W_REF_INSTRUCTIONAL_TEXT',
      message: '附件包含疑似指令文本，请谨慎使用',
      severity: 'warn',
    });
  }

  return { status: 'ok', hits, warnings };
}

export default {
  getRefRegistry,
  resetRefRegistry,
  listRefs,
  registerRefFile,
  unregisterRef,
  viewRef,
  searchRef,
};
