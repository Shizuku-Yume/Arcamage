import Alpine from 'alpinejs';
import { deepClone, getByPath } from '../store.js';
import { FIELD_REGISTRY, REGISTRY_VERSION, resolveFieldPath } from './field_registry.js';
import { listRefs, searchRef, viewRef } from './ref_registry.js';
import { SKILL_CATALOG_FILE } from './skill_constants.js';
import {
  buildDefaultSkillMarkdown,
  cloneSkillRepositoryState,
  exportSkillRepositoryState,
} from './skill_manager.js';
import { parseSkillDocument } from './skill_parser.js';
import {
  applyTruncate,
  hashValue,
  measureValue,
  stableStringify,
} from './value_utils.js';
import { getToolDefinitions, TOOL_ARG_WHITELIST } from './tool_contracts.js';

const MAX_VALUE_CHARS = 160000;
const MAX_PATCH_CHARS = 1024 * 1024;
const SIZE_WARNING_RATIO = 0.9;

function getMaxValueChars() {
  return Alpine.store('settings')?.agentMaxValueChars ?? MAX_VALUE_CHARS;
}

const UNSAFE_PATH_TOKENS = ['__proto__', 'prototype', 'constructor'];
const SKILL_IDENTIFIER_PATTERN = /^[\p{L}\p{N}_\-\s]+$/u;

const MACRO_REGEX = /\{\{\s*[^}]+\s*\}\}/g;
const HTML_REGEX = /<[^>]+>/g;

const HIGH_RISK_WRITE_ALLOWLIST = new Set();
const CHARACTER_BOOK_PATH = 'data.character_book';
const DEFAULT_LOREBOOK_PREVIEW_CHARS = 120;
const MAX_LOREBOOK_PREVIEW_CHARS = 500;
const DEFAULT_LOREBOOK_MAX_ENTRIES = 200;
const DEFAULT_LOREBOOK_SEARCH_HITS = 20;
const MAX_LOREBOOK_SEARCH_HITS = 200;
const LOREBOOK_ENTRY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function containsUnsafeToken(path) {
  if (!path || typeof path !== 'string') return false;
  const lowered = path.toLowerCase();
  return UNSAFE_PATH_TOKENS.some((token) => lowered.includes(token));
}

function parsePathTokens(path) {
  const trimmed = String(path || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'E_PATH_INVALID', message: '路径为空' };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, error: 'E_PATH_INVALID', message: '路径包含空白字符' };
  }

  const tokens = [];
  let buffer = '';

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '.') {
      if (!buffer) {
        return { ok: false, error: 'E_PATH_INVALID', message: '路径存在空段' };
      }
      tokens.push({ type: 'key', value: buffer });
      buffer = '';
      continue;
    }
    if (ch === '[') {
      if (!buffer) {
        return { ok: false, error: 'E_PATH_INVALID', message: '数组索引缺少字段名' };
      }
      tokens.push({ type: 'key', value: buffer });
      buffer = '';
      let j = i + 1;
      let indexStr = '';
      while (j < trimmed.length && trimmed[j] !== ']') {
        indexStr += trimmed[j];
        j += 1;
      }
      if (j >= trimmed.length) {
        return { ok: false, error: 'E_PATH_INVALID', message: '数组索引未闭合' };
      }
      if (!/^\d+$/.test(indexStr)) {
        return { ok: false, error: 'E_PATH_INVALID', message: '数组索引必须为非负整数' };
      }
      tokens.push({ type: 'index', value: Number(indexStr) });
      i = j;
      continue;
    }
    if (ch === ']') {
      return { ok: false, error: 'E_PATH_INVALID', message: '路径包含非法 "]"' };
    }
    buffer += ch;
  }

  if (buffer) {
    tokens.push({ type: 'key', value: buffer });
  } else if (trimmed.endsWith('.')) {
    return { ok: false, error: 'E_PATH_INVALID', message: '路径以点号结尾' };
  }

  for (const token of tokens) {
    if (token.type === 'key') {
      if (!token.value) {
        return { ok: false, error: 'E_PATH_INVALID', message: '路径存在空字段' };
      }
      if (containsUnsafeToken(token.value)) {
        return { ok: false, error: 'E_PATH_INVALID', message: '路径包含不安全字段名' };
      }
    }
  }

  return { ok: true, tokens };
}

function normalizePathInput(rawPath, { required = true } = {}) {
  if (typeof rawPath !== 'string') {
    if (!required) {
      return { ok: true, path: '', parsed: null, warnings: [] };
    }
    return { ok: false, error: 'E_CONSTRAINT_VIOLATION', message: 'path 不能为空' };
  }
  const original = rawPath;
  let path = rawPath.trim();
  if (!path) {
    if (!required) {
      return { ok: true, path: '', parsed: null, warnings: [] };
    }
    return { ok: false, error: 'E_CONSTRAINT_VIOLATION', message: 'path 不能为空' };
  }
  path = path.replace(/\s+/g, '');
  path = path.replace(/^\.+/, '').replace(/\.+$/, '');
  path = path.replace(/\.{2,}/g, '.');
  path = path.replace(/\.\[/g, '[');
  if (!path) {
    if (!required) {
      return { ok: true, path: '', parsed: null, warnings: [] };
    }
    return { ok: false, error: 'E_CONSTRAINT_VIOLATION', message: 'path 不能为空' };
  }
  const parsed = parsePathTokens(path);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, message: parsed.message, path };
  }
  const warnings = [];
  if (path !== original.trim()) {
    warnings.push({
      code: 'W_PATH_NORMALIZED',
      message: `路径已规范化: ${path}`,
      severity: 'info',
      path,
    });
  }
  return { ok: true, path, parsed, warnings };
}

function normalizeOptionalPath(rawPath, warnings) {
  const result = normalizePathInput(rawPath, { required: false });
  if (!result.ok) {
    warnings.push({
      code: 'W_PATH_IGNORED',
      message: `路径无效已忽略: ${result.message}`,
      severity: 'warn',
    });
    return '';
  }
  if (result.path && result.warnings?.length) {
    warnings.push(...result.warnings);
  }
  return result.path || '';
}

function tokensToPath(tokens) {
  let result = '';
  for (const token of tokens) {
    if (token.type === 'key') {
      result = result ? `${result}.${token.value}` : token.value;
    } else if (token.type === 'index') {
      result = `${result}[${token.value}]`;
    }
  }
  return result;
}

function findNearestArrayAncestor(tokens) {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (tokens[i].type === 'index') {
      const ancestorTokens = tokens.slice(0, i);
      return {
        arrayTokens: ancestorTokens,
        index: tokens[i].value,
        indexPosition: i,
      };
    }
  }
  return null;
}

function getValueByTokens(obj, tokens) {
  let current = obj;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      return { exists: false };
    }
    if (token.type === 'key') {
      if (!Object.prototype.hasOwnProperty.call(current, token.value)) {
        return { exists: false };
      }
      current = current[token.value];
      continue;
    }
    if (!Array.isArray(current)) {
      return { exists: false };
    }
    if (token.value < 0 || token.value >= current.length) {
      return { exists: false };
    }
    current = current[token.value];
  }
  return { exists: true, value: current };
}

function setValueByTokens(obj, tokens, value) {
  if (tokens.length === 0) {
    return { ok: false, error: 'E_PATH_INVALID', message: '路径为空' };
  }
  let current = obj;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    if (token.type === 'key') {
      if (current === null || current === undefined) {
        return { ok: false, error: 'E_PATH_NOT_FOUND', message: '路径不存在' };
      }
      if (!Object.prototype.hasOwnProperty.call(current, token.value)) {
        return { ok: false, error: 'E_PATH_NOT_FOUND', message: '路径不存在' };
      }
      current = current[token.value];
      continue;
    }
    if (!Array.isArray(current)) {
      return { ok: false, error: 'E_PATH_NOT_FOUND', message: '路径不是数组' };
    }
    if (token.value < 0 || token.value >= current.length) {
      return { ok: false, error: 'E_PATH_NOT_FOUND', message: '数组索引越界' };
    }
    current = current[token.value];
  }

  const last = tokens[tokens.length - 1];
  if (last.type === 'key') {
    if (current === null || current === undefined) {
      return { ok: false, error: 'E_PATH_NOT_FOUND', message: '路径不存在' };
    }
    if (!Object.prototype.hasOwnProperty.call(current, last.value)) {
      return { ok: false, error: 'E_PATH_NOT_FOUND', message: '路径不存在' };
    }
    current[last.value] = value;
    return { ok: true };
  }
  if (!Array.isArray(current)) {
    return { ok: false, error: 'E_PATH_NOT_FOUND', message: '路径不是数组' };
  }
  if (last.value < 0 || last.value >= current.length) {
    return { ok: false, error: 'E_PATH_NOT_FOUND', message: '数组索引越界' };
  }
  current[last.value] = value;
  return { ok: true };
}

function extractMacros(text) {
  if (!text || typeof text !== 'string') return new Set();
  const matches = text.match(MACRO_REGEX) || [];
  return new Set(matches.map((item) => item.trim()));
}

function collectStringLeaves(value, output = []) {
  if (typeof value === 'string') {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringLeaves(item, output);
    }
    return output;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      collectStringLeaves(value[key], output);
    }
  }
  return output;
}

function collectTextContent(value) {
  const leaves = collectStringLeaves(value, []);
  return leaves.length > 0 ? leaves.join('\n') : '';
}

function detectMacroLoss(before, after) {
  const beforeSet = extractMacros(before);
  const afterSet = extractMacros(after);
  const lost = [];
  for (const macro of beforeSet) {
    if (!afterSet.has(macro)) lost.push(macro);
  }
  return lost;
}

function hasHtml(text) {
  if (!text || typeof text !== 'string') return false;
  HTML_REGEX.lastIndex = 0;
  return HTML_REGEX.test(text);
}

function collectContentWarnings(before, after) {
  const warnings = [];
  const beforeText = collectTextContent(before);
  const afterText = collectTextContent(after);

  if (beforeText && afterText) {
    const lostMacros = detectMacroLoss(beforeText, afterText);
    if (lostMacros.length > 0) {
      warnings.push({
        code: 'W_MACRO_REMOVED',
        message: `可能丢失宏：${lostMacros.join(', ')}`,
        severity: 'warn',
      });
    }
    if (hasHtml(beforeText) && !hasHtml(afterText)) {
      warnings.push({
        code: 'W_HTML_REMOVED',
        message: '可能移除了 HTML 标签',
        severity: 'warn',
      });
    }
  }

  return warnings;
}

function normalizeSkillIdentifier(rawValue) {
  return String(rawValue || '').trim().replace(/\s+/g, ' ');
}

function isValidSkillIdentifier(rawValue) {
  const normalized = normalizeSkillIdentifier(rawValue);
  return Boolean(normalized) && SKILL_IDENTIFIER_PATTERN.test(normalized);
}

function quoteFrontmatterValue(value) {
  const text = String(value || '').trim();
  if (!text) return '""';
  if (/[:#[\]{},]|^\s|\s$/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function buildSkillMainPath(skillId) {
  return `${skillId}/SKILL.md`;
}

function buildReferenceRelativePath(referenceName) {
  return `references/${referenceName}.md`;
}

function buildReferenceFilePath(skillId, referenceName) {
  return `${skillId}/${buildReferenceRelativePath(referenceName)}`;
}

function buildSkillDiffPath(relativePath) {
  return `skills/${relativePath}`;
}

function parseReferenceNameFromRelativePath(referencePath) {
  const normalized = String(referencePath || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized)) return '';
  if (normalized.startsWith('/') || normalized.includes('..')) return '';
  const match = normalized.match(/^references\/(.+)\.md$/i);
  if (!match) return '';
  const name = normalizeSkillIdentifier(match[1]);
  if (!isValidSkillIdentifier(name)) return '';
  return name;
}

function normalizeSkillBodyContent(rawContent) {
  return String(rawContent || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function buildDefaultSkillBody({ name, description }) {
  const parsed = parseSkillDocument(buildDefaultSkillMarkdown({ name, description }));
  return normalizeSkillBodyContent(parsed.body || '');
}

function createSkillCatalogEntry({ id, description, tags = [] }) {
  return {
    id,
    description: String(description || '').trim(),
    path: buildSkillMainPath(id),
    tags: Array.isArray(tags)
      ? tags.map((tag) => String(tag || '').trim()).filter(Boolean)
      : [],
  };
}

function serializeSkillCatalogMarkdown(entries) {
  const lines = [
    '---',
    'name: Arcamage Skill Catalog',
    'description: Frontend local markdown skill catalog.',
    '---',
    '',
  ];

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry?.id || !entry?.description || !entry?.path) return;
    const tags = Array.isArray(entry.tags)
      ? entry.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
      : [];
    lines.push(`- id: ${entry.id}`);
    lines.push(`  description: ${quoteFrontmatterValue(entry.description)}`);
    lines.push(`  path: ${entry.path}`);
    lines.push(`  tags: [${tags.map((tag) => quoteFrontmatterValue(tag)).join(', ')}]`);
    lines.push('');
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

function serializeSkillDocumentMarkdown({ name, description, content, references }) {
  const normalizedName = String(name || '').trim();
  const normalizedDescription = String(description || '').trim();
  const normalizedBody = normalizeSkillBodyContent(content || '');
  const normalizedRefs = (Array.isArray(references) ? references : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  const lines = [
    '---',
    `name: ${quoteFrontmatterValue(normalizedName)}`,
    `description: ${quoteFrontmatterValue(normalizedDescription)}`,
  ];

  if (normalizedRefs.length) {
    lines.push('references:');
    normalizedRefs.forEach((refPath) => {
      lines.push(`  - ${quoteFrontmatterValue(refPath)}`);
    });
  } else {
    lines.push('references: []');
  }

  lines.push('---');
  lines.push('');
  if (normalizedBody) {
    lines.push(normalizedBody);
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function buildSkillIdentifierError(label, value) {
  const normalized = normalizeSkillIdentifier(value);
  if (!normalized) {
    return `${label} 不能为空`;
  }
  return `${label} 格式无效，仅支持字母/数字/空格/_/-`;
}

function upsertCatalogEntry(catalog, nextEntry, { sourceId = null } = {}) {
  const list = Array.isArray(catalog)
    ? catalog.map((entry) => ({
      id: String(entry?.id || '').trim(),
      description: String(entry?.description || '').trim(),
      path: String(entry?.path || '').trim(),
      tags: Array.isArray(entry?.tags) ? [...entry.tags] : [],
    }))
    : [];
  const source = String(sourceId || '').trim();
  const target = String(nextEntry?.id || '').trim();
  const anchorId = source || target;
  const anchorIndex = list.findIndex((entry) => entry.id === anchorId);
  const filtered = list.filter((entry) => entry.id !== source && entry.id !== target);
  const insertIndex = anchorIndex === -1 ? filtered.length : Math.min(anchorIndex, filtered.length);
  filtered.splice(insertIndex, 0, nextEntry);
  return filtered;
}

function resolveReferenceDraftsFromExisting(skillId, parsedSkill, repositoryState) {
  const drafts = [];
  const seen = new Set();
  const refs = Array.isArray(parsedSkill?.references) ? parsedSkill.references : [];
  refs.forEach((relativePath) => {
    const name = parseReferenceNameFromRelativePath(relativePath);
    if (!name || seen.has(name)) return;
    seen.add(name);
    const filePath = buildReferenceFilePath(skillId, name);
    drafts.push({
      name,
      content: String(repositoryState?.files?.[filePath] || ''),
    });
  });
  return drafts;
}

async function resolveSkillRepositoryState(skillsRepository) {
  if (skillsRepository && typeof skillsRepository === 'object') {
    return cloneSkillRepositoryState(skillsRepository);
  }
  return exportSkillRepositoryState();
}

function collectRepositoryFilePaths(state) {
  if (!state?.files || typeof state.files !== 'object') return [];
  return Object.keys(state.files)
    .map((path) => String(path || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

async function buildSkillFileDiffSummary({ changeType, path, beforeValue, afterValue }) {
  const hasBefore = typeof beforeValue === 'string';
  const hasAfter = typeof afterValue === 'string';
  const beforeBytes = hasBefore ? measureValue(beforeValue).totalBytes : undefined;
  const afterBytes = hasAfter ? measureValue(afterValue).totalBytes : undefined;
  let beforeHash = null;
  let afterHash = null;
  if (hasBefore) {
    beforeHash = await hashValue(beforeValue);
  }
  if (hasAfter) {
    afterHash = await hashValue(afterValue);
  }

  let deltaBytes = 0;
  if (Number.isFinite(beforeBytes) && Number.isFinite(afterBytes)) {
    deltaBytes = afterBytes - beforeBytes;
  } else if (Number.isFinite(afterBytes)) {
    deltaBytes = afterBytes;
  } else if (Number.isFinite(beforeBytes)) {
    deltaBytes = -beforeBytes;
  }

  return {
    resource: 'skill_file',
    path: buildSkillDiffPath(path),
    change_type: changeType,
    before_hash: beforeHash,
    after_hash: afterHash,
    before_bytes: beforeBytes,
    after_bytes: afterBytes,
    delta_bytes: deltaBytes,
    before_value: hasBefore ? beforeValue : null,
    after_value: hasAfter ? afterValue : null,
  };
}

async function buildSkillRepositoryDiffSummaries(beforeState, afterState) {
  const beforeFiles = beforeState?.files && typeof beforeState.files === 'object'
    ? beforeState.files
    : {};
  const afterFiles = afterState?.files && typeof afterState.files === 'object'
    ? afterState.files
    : {};

  const beforePaths = collectRepositoryFilePaths(beforeState);
  const afterPaths = collectRepositoryFilePaths(afterState);
  const beforeSet = new Set(beforePaths);
  const afterSet = new Set(afterPaths);

  const removedPaths = beforePaths.filter((path) => !afterSet.has(path));
  const addedPaths = afterPaths.filter((path) => !beforeSet.has(path));
  const updatedPaths = beforePaths
    .filter((path) => afterSet.has(path))
    .filter((path) => String(beforeFiles[path] || '') !== String(afterFiles[path] || ''));

  const movePairs = [];
  const usedAdded = new Set();
  const movedRemoved = new Set();
  removedPaths.forEach((removedPath) => {
    const beforeContent = String(beforeFiles[removedPath] || '');
    const matchedAdded = addedPaths.find((candidatePath) => {
      if (usedAdded.has(candidatePath)) return false;
      return String(afterFiles[candidatePath] || '') === beforeContent;
    });
    if (!matchedAdded) return;
    usedAdded.add(matchedAdded);
    movedRemoved.add(removedPath);
    movePairs.push({
      from: removedPath,
      to: matchedAdded,
    });
  });

  const finalRemoved = removedPaths.filter((path) => !movedRemoved.has(path));
  const finalAdded = addedPaths.filter((path) => !usedAdded.has(path));

  const summaries = [];

  for (const pair of movePairs) {
    const beforeValue = String(beforeFiles[pair.from] || '');
    const afterValue = String(afterFiles[pair.to] || '');
    const summary = await buildSkillFileDiffSummary({
      changeType: 'move',
      path: pair.to,
      beforeValue,
      afterValue,
    });
    summary.before_path = buildSkillDiffPath(pair.from);
    summaries.push(summary);
  }

  for (const path of updatedPaths) {
    summaries.push(await buildSkillFileDiffSummary({
      changeType: 'update',
      path,
      beforeValue: String(beforeFiles[path] || ''),
      afterValue: String(afterFiles[path] || ''),
    }));
  }

  for (const path of finalAdded) {
    summaries.push(await buildSkillFileDiffSummary({
      changeType: 'add',
      path,
      beforeValue: null,
      afterValue: String(afterFiles[path] || ''),
    }));
  }

  for (const path of finalRemoved) {
    summaries.push(await buildSkillFileDiffSummary({
      changeType: 'remove',
      path,
      beforeValue: String(beforeFiles[path] || ''),
      afterValue: null,
    }));
  }

  return summaries;
}

// value utils imported from ./value_utils.js

function checkValueSize(value) {
  try {
    const { totalBytes } = measureValue(value);
    const limit = getMaxValueChars();
    if (totalBytes > limit) {
      return { ok: false, code: 'E_SIZE_LIMIT', message: `value 超过上限 (${limit} bytes)` };
    }
    const warnings = [];
    if (totalBytes > limit * SIZE_WARNING_RATIO) {
      warnings.push({
        code: 'W_SIZE_NEAR_LIMIT',
        message: 'value 接近大小上限',
        severity: 'warn',
      });
    }
    return { ok: true, warnings };
  } catch (error) {
    return { ok: false, code: 'E_TYPE_MISMATCH', message: error?.message || '无法计算值大小' };
  }
}

function valuesEqual(a, b) {
  try {
    return stableStringify(a) === stableStringify(b);
  } catch {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

function applyCanonicalPath(rawPath, basePath, canonicalPath) {
  if (!canonicalPath || !basePath || !rawPath) return rawPath;
  if (rawPath === basePath) return canonicalPath;
  if (rawPath.startsWith(`${basePath}[`)) {
    return `${canonicalPath}${rawPath.slice(basePath.length)}`;
  }
  if (rawPath.startsWith(`${basePath}.`)) {
    return `${canonicalPath}${rawPath.slice(basePath.length)}`;
  }
  return rawPath;
}

function applyAliasSummary(diffSummary, canonicalPath, aliasUsed) {
  if (!diffSummary || !aliasUsed || !canonicalPath) return diffSummary;
  return {
    ...diffSummary,
    canonical_path: canonicalPath,
    alias_used: true,
  };
}

function attachPatchErrorDetails(response, patchResult) {
  if (patchResult?.candidate_snippets) {
    response.candidate_snippets = patchResult.candidate_snippets;
  }
  return response;
}

function validateArgs(toolName, args) {
  const allowed = TOOL_ARG_WHITELIST[toolName];
  if (!allowed) return { ok: true, args };
  const payload = args && typeof args === 'object' ? args : {};
  const cleaned = {};
  const warnings = [];
  for (const [key, value] of Object.entries(payload)) {
    if (allowed.includes(key)) {
      cleaned[key] = value;
      continue;
    }
    if (key.startsWith('_')) {
      continue;
    }
    warnings.push({
      code: 'W_ARG_IGNORED',
      message: `未知参数已忽略: ${key}`,
      severity: 'info',
    });
  }
  return { ok: true, args: cleaned, warnings };
}

function buildReturnValue(value, args) {
  if (!args?.return_value) return { value: undefined, truncated: null };
  const maxChars = Number.isFinite(args?.max_chars) ? args.max_chars : getMaxValueChars();
  const maxBytes = Number.isFinite(args?.max_bytes) ? args.max_bytes : null;
  return applyTruncate(value, maxChars, maxBytes);
}

function maybeAttachReturnValue(payload, warnings, value, args) {
  if (!args?.return_value) return { ok: true };
  try {
    const result = buildReturnValue(value, args);
    payload.new_value = result.value;
    payload.truncated = result.truncated;
    payload.returned_chars = result.returnedChars;
    payload.returned_bytes = result.returnedBytes;
    payload.total_chars = result.totalChars;
    payload.total_bytes = result.totalBytes;
    if (result.truncated) {
      warnings.push({
        code: 'W_TRUNCATED',
        message: '返回值已截断',
        severity: 'warn',
      });
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, code: 'E_INTERNAL', message: error?.message || '返回值处理失败' };
  }
}

function ensureContext(context) {
  if (!context?.card_id || !context?.registry_version) {
    return {
      ok: false,
      error: 'E_CONTEXT_MISSING',
      message: '缺少 card_id 或 registry_version',
    };
  }
  if (context.registry_version !== REGISTRY_VERSION) {
    return {
      ok: false,
      error: 'E_CARD_MISMATCH',
      message: 'registry_version 不匹配',
    };
  }
  return { ok: true };
}

function normalizeToolName(toolName) {
  if (!toolName) return '';
  const name = String(toolName).trim();
  if (!name) return '';
  const parts = name.split(':');
  return parts[parts.length - 1] || '';
}

function buildErrorResponse({ context, toolCallId, code, message, path, warnings = [] }) {
  return {
    status: 'error',
    error_code: code,
    message,
    path,
    warnings,
    diff_summary: null,
    diff_summaries: null,
    card_id: context?.card_id || null,
    registry_version: context?.registry_version || null,
    tool_call_id: toolCallId || null,
  };
}

function buildOkResponse({
  context,
  toolCallId,
  payload,
  warnings = [],
  diffSummary = null,
  diffSummaries = null,
}) {
  return {
    status: 'ok',
    warnings,
    diff_summary: diffSummary,
    diff_summaries: Array.isArray(diffSummaries) ? diffSummaries : null,
    card_id: context?.card_id || null,
    registry_version: context?.registry_version || null,
    tool_call_id: toolCallId || null,
    ...payload,
  };
}

function validateValueType(value, field, allowNull = false) {
  if (!field) return { ok: false, code: 'E_PATH_NOT_FOUND', message: '字段未注册' };
  if (value === null) {
    if (!allowNull) {
      return { ok: false, code: 'E_TYPE_MISMATCH', message: '字段不可为 null' };
    }
    return { ok: true };
  }
  if (field.type === 'string') {
    return typeof value === 'string'
      ? { ok: true }
      : { ok: false, code: 'E_TYPE_MISMATCH', message: '字段类型应为 string' };
  }
  if (field.type === 'array') {
    if (!Array.isArray(value)) {
      return { ok: false, code: 'E_TYPE_MISMATCH', message: '字段类型应为 array' };
    }
    if (field.array_item_type === 'string') {
      const invalid = value.find((item) => typeof item !== 'string');
      if (invalid !== undefined) {
        return { ok: false, code: 'E_TYPE_MISMATCH', message: '数组元素应为 string' };
      }
    }
    return { ok: true };
  }
  if (field.type === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, code: 'E_TYPE_MISMATCH', message: '字段类型应为 object' };
    }
    return { ok: true };
  }
  return { ok: false, code: 'E_TYPE_MISMATCH', message: '字段类型不匹配' };
}

function validateConstraints(value, field) {
  const constraints = field?.constraints || {};
  if (!constraints || typeof constraints !== 'object') return { ok: true };

  const maxBytes = Number.isFinite(constraints.max_bytes) ? constraints.max_bytes : null;
  if (maxBytes !== null) {
    try {
      const { totalBytes } = measureValue(value);
      if (totalBytes > maxBytes) {
        return { ok: false, code: 'E_SIZE_LIMIT', message: '字段超过 max_bytes 限制' };
      }
    } catch (error) {
      return { ok: false, code: 'E_TYPE_MISMATCH', message: error?.message || '无法计算字段大小' };
    }
  }

  if (Array.isArray(constraints.enum)) {
    const matches = constraints.enum.some((item) => valuesEqual(item, value));
    if (!matches) {
      return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: '字段值不在枚举范围内' };
    }
  }

  if (typeof value === 'string') {
    const { totalChars } = measureValue(value);
    if (Number.isFinite(constraints.min_length) && totalChars < constraints.min_length) {
      return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: '字段长度小于最小限制' };
    }
    if (Number.isFinite(constraints.max_length) && totalChars > constraints.max_length) {
      return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: '字段长度超过最大限制' };
    }
    if (constraints.regex) {
      try {
        const regex = new RegExp(constraints.regex);
        if (!regex.test(value)) {
          return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: '字段未匹配正则约束' };
        }
      } catch {
        return { ok: false, code: 'E_INTERNAL', message: '字段正则约束无效' };
      }
    }
  }

  if (typeof value === 'number') {
    if (Number.isFinite(constraints.min) && value < constraints.min) {
      return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: '字段值小于最小限制' };
    }
    if (Number.isFinite(constraints.max) && value > constraints.max) {
      return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: '字段值超过最大限制' };
    }
  }

  if (Array.isArray(value)) {
    if (Number.isFinite(constraints.min_items) && value.length < constraints.min_items) {
      return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: '数组元素数量不足' };
    }
    if (Number.isFinite(constraints.max_items) && value.length > constraints.max_items) {
      return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: '数组元素数量超过上限' };
    }
    if (constraints.unique_items) {
      const seen = new Set();
      for (const item of value) {
        const key = typeof item === 'string' ? item : stableStringify(item);
        if (seen.has(key)) {
          return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: '数组元素必须唯一' };
        }
        seen.add(key);
      }
    }
  }

  return { ok: true };
}

function isCharacterBookPath(path) {
  const normalized = String(path || '').trim();
  return normalized === CHARACTER_BOOK_PATH
    || normalized.startsWith(`${CHARACTER_BOOK_PATH}.`)
    || normalized.startsWith(`${CHARACTER_BOOK_PATH}[`);
}

function buildCharacterBookBlockedResponse({ context, toolCallId, path }) {
  return buildErrorResponse({
    context,
    toolCallId,
    code: 'E_PERMISSION_DENIED',
    message: 'data.character_book 请使用 lorebook_* 工具',
    path,
  });
}

function normalizeInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function clampPreviewChars(value) {
  return normalizeInteger(value, DEFAULT_LOREBOOK_PREVIEW_CHARS, {
    min: 0,
    max: MAX_LOREBOOK_PREVIEW_CHARS,
  });
}

function previewText(value, maxChars = DEFAULT_LOREBOOK_PREVIEW_CHARS) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!maxChars || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function buildSearchSnippet(value, ranges, maxChars = DEFAULT_LOREBOOK_PREVIEW_CHARS) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (!Array.isArray(ranges) || !ranges.length) return previewText(text, maxChars);
  const first = ranges[0];
  const center = Math.max(0, Math.floor((first.start + first.end) / 2));
  const half = Math.max(8, Math.floor(maxChars / 2));
  let start = Math.max(0, center - half);
  let end = Math.min(text.length, start + maxChars);
  if (end - start < maxChars) {
    start = Math.max(0, end - maxChars);
  }
  let snippet = text.slice(start, end);
  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;
  return snippet;
}

function ensureLorebook(card) {
  const existing = card?.data?.character_book;
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    if (!Array.isArray(existing.entries)) {
      existing.entries = [];
    }
    return existing;
  }
  if (!card.data || typeof card.data !== 'object') {
    card.data = {};
  }
  card.data.character_book = { entries: [] };
  return card.data.character_book;
}

function getLorebook(card) {
  const book = card?.data?.character_book;
  if (!book || typeof book !== 'object' || Array.isArray(book)) {
    return { entries: [], book: null };
  }
  return {
    book,
    entries: Array.isArray(book.entries) ? book.entries : [],
  };
}

function generateLorebookEntryId(entries) {
  const used = new Set(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => String(entry?.id || '').trim())
      .filter(Boolean),
  );
  for (let i = 0; i < 10000; i += 1) {
    const id = `entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    if (!used.has(id)) return id;
  }
  return `entry_${Date.now().toString(36)}_${used.size + 1}`;
}

function ensureLorebookEntryIds(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const seen = new Set();
  let changed = false;
  list.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const rawId = String(entry.id || '').trim();
    if (rawId && !seen.has(rawId)) {
      entry.id = rawId;
      seen.add(rawId);
      return;
    }
    let id = generateLorebookEntryId(list);
    while (seen.has(id)) {
      id = generateLorebookEntryId(list);
    }
    entry.id = id;
    seen.add(id);
    changed = true;
  });
  return changed;
}

function normalizeKeys(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '')).filter((item) => item.length > 0);
}

function getEntryDisplayName(entry) {
  return String(entry?.name || entry?.comment || entry?.id || '').trim();
}

async function buildLorebookRow(entry, index, maxPreviewChars = DEFAULT_LOREBOOK_PREVIEW_CHARS) {
  return {
    index,
    id: String(entry?.id || ''),
    name: String(entry?.name || ''),
    comment: String(entry?.comment || ''),
    enabled: entry?.enabled !== false,
    constant: entry?.constant === true,
    keys: normalizeKeys(entry?.keys),
    secondary_keys: normalizeKeys(entry?.secondary_keys),
    content_preview: previewText(entry?.content || '', maxPreviewChars),
    content_hash: await hashValue(String(entry?.content || '')),
  };
}

async function buildLorebookRows(entries, maxPreviewChars) {
  const rows = [];
  for (let index = 0; index < entries.length; index += 1) {
    rows.push(await buildLorebookRow(entries[index], index, maxPreviewChars));
  }
  return rows;
}

function normalizeEntryRef(entryRef) {
  if (!entryRef || typeof entryRef !== 'object' || Array.isArray(entryRef)) {
    return {};
  }
  const ref = {};
  if (typeof entryRef.id === 'string' && entryRef.id.trim()) {
    ref.id = entryRef.id.trim();
  }
  if (Number.isFinite(entryRef.index)) {
    ref.index = Math.trunc(entryRef.index);
  }
  if (typeof entryRef.name === 'string' && entryRef.name.trim()) {
    ref.name = entryRef.name.trim();
  }
  return ref;
}

async function resolveLorebookEntryRef(entries, rawRef, { allowMissing = false } = {}) {
  const entryRef = normalizeEntryRef(rawRef);
  if (entryRef.id) {
    const index = entries.findIndex((entry) => String(entry?.id || '') === entryRef.id);
    if (index !== -1) return { ok: true, index, entry: entries[index], entryRef };
    if (allowMissing) return { ok: true, index: -1, entry: null, entryRef };
    return { ok: false, code: 'E_ENTRY_NOT_FOUND', message: `世界书条目不存在: ${entryRef.id}` };
  }

  if (Number.isInteger(entryRef.index)) {
    if (entryRef.index >= 0 && entryRef.index < entries.length) {
      return { ok: true, index: entryRef.index, entry: entries[entryRef.index], entryRef };
    }
    if (allowMissing) return { ok: true, index: -1, entry: null, entryRef };
    return { ok: false, code: 'E_ENTRY_NOT_FOUND', message: '世界书条目索引越界' };
  }

  if (entryRef.name) {
    const matches = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => getEntryDisplayName(entry) === entryRef.name);
    if (matches.length === 1) {
      return { ok: true, index: matches[0].index, entry: matches[0].entry, entryRef };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        code: 'E_AMBIGUOUS_ENTRY',
        message: `世界书条目名称不唯一: ${entryRef.name}`,
        candidates: matches.map(({ entry, index }) => ({
          index,
          id: String(entry?.id || ''),
          name: String(entry?.name || ''),
          comment: String(entry?.comment || ''),
        })),
      };
    }
    if (allowMissing) return { ok: true, index: -1, entry: null, entryRef };
    return { ok: false, code: 'E_ENTRY_NOT_FOUND', message: `世界书条目不存在: ${entryRef.name}` };
  }

  return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: 'entry_ref 需要 id、index 或 name' };
}

function normalizePatchList(patches) {
  if (!Array.isArray(patches) || patches.length === 0) {
    return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: 'patches 必须是非空数组' };
  }
  if (patches.length > 50) {
    return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: 'patches 数量超过上限' };
  }
  return { ok: true, patches };
}

function normalizeMatchMode(value) {
  const mode = String(value || 'exact').trim();
  if (['exact', 'normalized', 'regex'].includes(mode)) return mode;
  return 'exact';
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[，、]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[：]/g, ':')
    .replace(/[；]/g, ';')
    .replace(/[！]/g, '!')
    .replace(/[？]/g, '?')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[【［]/g, '[')
    .replace(/[】］]/g, ']')
    .replace(/[｛]/g, '{')
    .replace(/[｝]/g, '}')
    .replace(/[《]/g, '<')
    .replace(/[》]/g, '>')
    .replace(/\s+/g, ' ');
}

function buildNormalizedIndex(text) {
  const source = String(text ?? '');
  let normalized = '';
  const indexMap = [];
  let previousWhitespace = false;
  for (let index = 0; index < source.length;) {
    const codePoint = source.codePointAt(index);
    const char = String.fromCodePoint(codePoint);
    const nextIndex = index + char.length;
    const normalizedChar = normalizeSearchText(char);
    for (let subIndex = 0; subIndex < normalizedChar.length; subIndex += 1) {
      const outChar = normalizedChar[subIndex];
      if (/\s/u.test(outChar)) {
        if (previousWhitespace) continue;
        previousWhitespace = true;
        normalized += ' ';
        indexMap.push({ start: index, end: nextIndex });
        continue;
      }
      previousWhitespace = false;
      normalized += outChar;
      indexMap.push({ start: index, end: nextIndex });
    }
    index = nextIndex;
  }
  return { normalized, indexMap };
}

function buildMatchWarning(mode) {
  if (mode === 'normalized') {
    return {
      code: 'W_NORMALIZED_MATCH_USED',
      message: '已使用归一化文本匹配',
      severity: 'info',
    };
  }
  if (mode === 'regex') {
    return {
      code: 'W_REGEX_MATCH_USED',
      message: '已使用正则匹配',
      severity: 'info',
    };
  }
  return null;
}

function uniqueWarnings(warnings) {
  const seen = new Set();
  const result = [];
  for (const warning of warnings || []) {
    const key = `${warning?.code || ''}:${warning?.path || ''}:${warning?.index ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(warning);
  }
  return result;
}

function boundedCandidateSnippets(text, needle, { maxSnippets = 5, snippetChars = 96 } = {}) {
  const source = String(text ?? '');
  const query = String(needle ?? '').trim();
  if (!source) return [];
  const candidates = [];
  const normalizedSource = normalizeSearchText(source).toLowerCase();
  const terms = normalizeSearchText(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((item) => item.length >= 2);
  const pushSnippet = (center) => {
    const half = Math.max(8, Math.floor(snippetChars / 2));
    const start = Math.max(0, center - half);
    const end = Math.min(source.length, start + snippetChars);
    const snippet = source.slice(start, end);
    if (snippet && !candidates.includes(snippet)) candidates.push(snippet);
  };
  for (const term of terms) {
    const normalizedIndex = normalizedSource.indexOf(term);
    if (normalizedIndex !== -1) {
      pushSnippet(Math.min(source.length, normalizedIndex));
      if (candidates.length >= maxSnippets) return candidates;
    }
  }
  if (!candidates.length) {
    const chunks = source.split(/\n{2,}|\n/u).map((item) => item.trim()).filter(Boolean);
    for (const chunk of chunks.slice(0, maxSnippets)) {
      candidates.push(chunk.length <= snippetChars ? chunk : `${chunk.slice(0, snippetChars - 3)}...`);
    }
  }
  if (!candidates.length && source) {
    candidates.push(source.length <= snippetChars ? source : `${source.slice(0, snippetChars - 3)}...`);
  }
  return candidates.slice(0, maxSnippets);
}

function buildAnchorNotFound(message, text, needle) {
  return {
    ok: false,
    code: 'E_ANCHOR_NOT_FOUND',
    message,
    candidate_snippets: boundedCandidateSnippets(text, needle),
  };
}

function mapNormalizedRange(indexMap, start, end) {
  if (!indexMap.length || start < 0 || end <= start || start >= indexMap.length) return null;
  const clampedEnd = Math.min(end, indexMap.length);
  return {
    start: indexMap[start].start,
    end: indexMap[clampedEnd - 1].end,
  };
}

function findExactRanges(text, needle, { occurrence = 1, caseSensitive = true } = {}) {
  const source = String(text ?? '');
  const target = String(needle ?? '');
  if (!target) {
    return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: 'find/anchor 不能为空' };
  }
  const haystack = caseSensitive ? source : source.toLowerCase();
  const query = caseSensitive ? target : target.toLowerCase();
  const ranges = [];
  let from = 0;
  while (from <= haystack.length) {
    const index = haystack.indexOf(query, from);
    if (index === -1) break;
    ranges.push({ start: index, end: index + target.length, match: source.slice(index, index + target.length) });
    from = index + Math.max(1, target.length);
  }
  if (!ranges.length) {
    return buildAnchorNotFound(`未找到文本: ${target}`, source, target);
  }
  if (occurrence === 'all') return { ok: true, ranges, warnings: [] };
  const wanted = Math.max(1, Math.trunc(Number(occurrence) || 1));
  const range = ranges[wanted - 1];
  if (!range) {
    return buildAnchorNotFound(`未找到第 ${wanted} 处文本: ${target}`, source, target);
  }
  return { ok: true, ranges: [range], warnings: [] };
}

function findNormalizedRanges(text, needle, { occurrence = 1, caseSensitive = true } = {}) {
  const source = String(text ?? '');
  const target = String(needle ?? '');
  if (!target) {
    return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: 'find/anchor 不能为空' };
  }
  const sourceIndex = buildNormalizedIndex(source);
  const normalizedTarget = normalizeSearchText(target);
  const haystack = caseSensitive ? sourceIndex.normalized : sourceIndex.normalized.toLowerCase();
  const query = caseSensitive ? normalizedTarget : normalizedTarget.toLowerCase();
  if (!query) {
    return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: 'find/anchor 不能为空' };
  }
  const ranges = [];
  let from = 0;
  while (from <= haystack.length) {
    const index = haystack.indexOf(query, from);
    if (index === -1) break;
    const range = mapNormalizedRange(sourceIndex.indexMap, index, index + query.length);
    if (range) {
      ranges.push({ ...range, match: source.slice(range.start, range.end) });
    }
    from = index + Math.max(1, query.length);
  }
  if (!ranges.length) {
    return buildAnchorNotFound(`未找到文本: ${target}`, source, target);
  }
  const warnings = [buildMatchWarning('normalized')];
  if (occurrence === 'all') return { ok: true, ranges, warnings };
  const wanted = Math.max(1, Math.trunc(Number(occurrence) || 1));
  const range = ranges[wanted - 1];
  if (!range) {
    return buildAnchorNotFound(`未找到第 ${wanted} 处文本: ${target}`, source, target);
  }
  return { ok: true, ranges: [range], warnings };
}

function findRegexRanges(text, pattern, { occurrence = 1, caseSensitive = true } = {}) {
  const source = String(text ?? '');
  const rawPattern = String(pattern ?? '');
  if (!rawPattern) {
    return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: 'regex 不能为空' };
  }
  let regex;
  try {
    const flags = `g${caseSensitive ? '' : 'i'}u`;
    regex = new RegExp(rawPattern, flags);
  } catch (error) {
    return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: error?.message || '正则无效' };
  }
  const ranges = [];
  let match = regex.exec(source);
  while (match) {
    ranges.push({ start: match.index, end: match.index + match[0].length, match: match[0] });
    if (match[0].length === 0) regex.lastIndex += 1;
    match = regex.exec(source);
  }
  if (!ranges.length) {
    return buildAnchorNotFound(`未找到正则: ${rawPattern}`, source, rawPattern);
  }
  const warnings = [buildMatchWarning('regex')];
  if (occurrence === 'all') return { ok: true, ranges, warnings };
  const wanted = Math.max(1, Math.trunc(Number(occurrence) || 1));
  const range = ranges[wanted - 1];
  if (!range) {
    return buildAnchorNotFound(`未找到第 ${wanted} 处正则: ${rawPattern}`, source, rawPattern);
  }
  return { ok: true, ranges: [range], warnings };
}

function findTextRanges(text, needle, spec = {}) {
  const mode = normalizeMatchMode(spec.match_mode);
  const options = {
    occurrence: spec.occurrence ?? 1,
    caseSensitive: spec.case_sensitive !== false,
  };
  if (mode === 'normalized') return findNormalizedRanges(text, needle, options);
  if (mode === 'regex') return findRegexRanges(text, needle, options);
  return findExactRanges(text, needle, options);
}

function replaceRanges(text, ranges, replacement) {
  const source = String(text ?? '');
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  let nextText = source;
  for (const range of sorted) {
    nextText = `${nextText.slice(0, range.start)}${String(replacement ?? '')}${nextText.slice(range.end)}`;
  }
  return nextText;
}

function findBetweenRange(text, spec) {
  const source = String(text ?? '');
  const startResult = findTextRanges(source, spec.start_anchor, {
    ...spec,
    occurrence: spec.occurrence ?? 1,
  });
  if (!startResult.ok) {
    return {
      ...startResult,
      message: startResult.code === 'E_ANCHOR_NOT_FOUND'
        ? `未找到起始锚点: ${String(spec.start_anchor || '')}`
        : startResult.message,
    };
  }
  const startRange = startResult.ranges[0];
  const endSearchText = source.slice(startRange.end);
  const endResult = findTextRanges(endSearchText, spec.end_anchor, {
    ...spec,
    occurrence: 1,
  });
  if (!endResult.ok) {
    return {
      ...endResult,
      message: endResult.code === 'E_ANCHOR_NOT_FOUND'
        ? `未找到结束锚点: ${String(spec.end_anchor || '')}`
        : endResult.message,
    };
  }
  const relativeEndRange = endResult.ranges[0];
  const endRange = {
    start: startRange.end + relativeEndRange.start,
    end: startRange.end + relativeEndRange.end,
  };
  const includeAnchors = spec.include_anchors === true;
  const range = includeAnchors
    ? { start: startRange.start, end: endRange.end }
    : { start: startRange.end, end: endRange.start };
  return {
    ok: true,
    range,
    warnings: uniqueWarnings([
      ...(startResult.warnings || []),
      ...(endResult.warnings || []),
    ]),
  };
}

function applyOneTextPatch(text, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, code: 'E_CONSTRAINT_VIOLATION', message: 'patch 项必须为对象' };
  }

  if (patch.replace && typeof patch.replace === 'object') {
    const spec = patch.replace;
    const result = findTextRanges(text, spec.find, spec);
    if (!result.ok) return result;
    return {
      ok: true,
      text: replaceRanges(text, result.ranges, spec.replace),
      warnings: result.warnings || [],
    };
  }

  if (patch.delete && typeof patch.delete === 'object') {
    const spec = patch.delete;
    const result = findTextRanges(text, spec.find, spec);
    if (!result.ok) return result;
    return {
      ok: true,
      text: replaceRanges(text, result.ranges, ''),
      warnings: result.warnings || [],
    };
  }

  const insertSpec = patch.insert_before || patch.insert_after || null;
  if (insertSpec && typeof insertSpec === 'object') {
    const isAfter = Boolean(patch.insert_after);
    const result = findTextRanges(text, insertSpec.anchor, insertSpec);
    if (!result.ok) {
      return result.code === 'E_ANCHOR_NOT_FOUND'
        ? { ...result, message: `未找到锚点: ${String(insertSpec.anchor || '')}` }
        : result;
    }
    const range = result.ranges[0];
    const at = isAfter ? range.end : range.start;
    return {
      ok: true,
      text: `${text.slice(0, at)}${String(insertSpec.text ?? '')}${text.slice(at)}`,
      warnings: result.warnings || [],
    };
  }

  if (patch.delete_between && typeof patch.delete_between === 'object') {
    const result = findBetweenRange(text, patch.delete_between);
    if (!result.ok) return result;
    return {
      ok: true,
      text: replaceRanges(text, [result.range], ''),
      warnings: result.warnings || [],
    };
  }

  if (patch.replace_between && typeof patch.replace_between === 'object') {
    const result = findBetweenRange(text, patch.replace_between);
    if (!result.ok) return result;
    return {
      ok: true,
      text: replaceRanges(text, [result.range], patch.replace_between.text),
      warnings: result.warnings || [],
    };
  }

  return {
    ok: false,
    code: 'E_CONSTRAINT_VIOLATION',
    message: 'patch 必须包含 replace、insert_before、insert_after、delete、delete_between 或 replace_between',
  };
}

function applyTextPatches(text, patches) {
  const normalized = normalizePatchList(patches);
  if (!normalized.ok) return normalized;
  let nextText = String(text ?? '');
  const warnings = [];
  for (const patch of normalized.patches) {
    const result = applyOneTextPatch(nextText, patch);
    if (!result.ok) return result;
    nextText = result.text;
    warnings.push(...(result.warnings || []));
    if (measureValue(nextText).totalBytes > MAX_PATCH_CHARS) {
      return { ok: false, code: 'E_SIZE_LIMIT', message: '补丁结果超过大小上限' };
    }
  }
  return { ok: true, text: nextText, warnings: uniqueWarnings(warnings) };
}

async function buildCardFieldDiff({ path, beforeValue, afterValue, changeType = 'update' }) {
  const beforeBytes = measureValue(beforeValue).totalBytes;
  const afterBytes = measureValue(afterValue).totalBytes;
  return {
    resource: 'card_field',
    path,
    change_type: valuesEqual(beforeValue, afterValue) ? 'noop' : changeType,
    before_hash: await hashValue(beforeValue),
    after_hash: await hashValue(afterValue),
    before_bytes: beforeBytes,
    after_bytes: afterBytes,
    delta_bytes: afterBytes - beforeBytes,
    before_value: beforeValue,
    after_value: afterValue,
  };
}

function isDeprecated(field) {
  return Boolean(field?.deprecated);
}

function canWriteField(field) {
  if (!field) return false;
  return field.mutability === 'write';
}

function canAppendField(field) {
  if (!field) return false;
  return field.mutability === 'append';
}

function requireOldHash(field) {
  return field?.risk === 'medium' || field?.risk === 'high';
}

function isHighRisk(field) {
  return field?.risk === 'high';
}

function normalizeListFieldsArgs(args) {
  const path = typeof args?.path === 'string' ? args.path.trim() : '';
  const filters = typeof args?.filters === 'object' && args.filters ? args.filters : {};
  return { path, filters };
}

const LIST_FIELDS_FILTER_KEYS = new Set([
  'path',
  'path_prefix',
  'risk',
  'include_deprecated',
  'include_readonly',
  'max_depth',
  'max_items',
]);

async function listFields({ context, toolCallId, args, card }) {
  const { path, filters } = normalizeListFieldsArgs(args);
  const warnings = [];
  const normalizedPath = normalizeOptionalPath(path, warnings);
  const filterKeys = Object.keys(filters || {});
  const sanitizedFilters = {};
  for (const key of filterKeys) {
    if (LIST_FIELDS_FILTER_KEYS.has(key)) {
      sanitizedFilters[key] = filters[key];
      continue;
    }
    warnings.push({
      code: 'W_FILTER_IGNORED',
      message: `未知过滤参数已忽略: ${key}`,
      severity: 'info',
    });
  }
  let filterPath = '';
  if (Object.prototype.hasOwnProperty.call(sanitizedFilters, 'path')) {
    filterPath = normalizeOptionalPath(sanitizedFilters.path, warnings);
  }

  let pathPrefixFilter = '';
  if (Object.prototype.hasOwnProperty.call(sanitizedFilters, 'path_prefix')) {
    pathPrefixFilter = normalizeOptionalPath(sanitizedFilters.path_prefix, warnings);
  }

  if (normalizedPath && filterPath && normalizedPath !== filterPath) {
    warnings.push({
      code: 'W_FILTER_IGNORED',
      message: 'path 与 filters.path 冲突，已优先使用 path',
      severity: 'info',
    });
    filterPath = '';
  }

  if ((normalizedPath || filterPath) && pathPrefixFilter) {
    warnings.push({
      code: 'W_FILTER_IGNORED',
      message: 'path 与 filters.path_prefix 冲突，已忽略 path_prefix',
      severity: 'info',
    });
    pathPrefixFilter = '';
  }
  const pathPrefix = normalizedPath || filterPath || pathPrefixFilter || '';
  let includeIndices = Boolean(args?.include_indices);
  if (includeIndices && !pathPrefix) {
    includeIndices = false;
    warnings.push({
      code: 'W_INCLUDE_INDICES_IGNORED',
      message: 'include_indices 需要 path 或 filters.path_prefix，已忽略',
      severity: 'warn',
    });
  }

  let list = FIELD_REGISTRY.slice();
  if (pathPrefix) {
    list = list.filter((field) => field.field_path.startsWith(pathPrefix));
  }
  if (sanitizedFilters?.risk) {
    list = list.filter((field) => field.risk === sanitizedFilters.risk);
  }
  if (!sanitizedFilters?.include_deprecated) {
    list = list.filter((field) => !field.deprecated);
  }
  if (!sanitizedFilters?.include_readonly) {
    list = list.filter((field) => field.mutability !== 'read');
  }

  if (Number.isFinite(sanitizedFilters?.max_depth)) {
    list = list.filter((field) => field.field_path.split('.').length <= sanitizedFilters.max_depth);
  }

  if (Number.isFinite(sanitizedFilters?.max_items)) {
    list = list.slice(0, sanitizedFilters.max_items);
  }

  const items = [];
  for (const field of list) {
    const entry = {
      path: field.field_path,
      type: field.type,
      nullable: field.nullable,
      mutability: field.mutability,
      risk: field.risk,
      deprecated: Boolean(field.deprecated),
      aliases: field.aliases || [],
      constraints: field.constraints || {},
      notes: field.notes || '',
      default: field.default,
    };

    if (includeIndices && field.type === 'array') {
      const value = getByPath(card, field.field_path);
      if (Array.isArray(value)) {
        entry.indices = value.map((_, index) => index);
        try {
          entry.array_hash = await hashValue(value);
        } catch {
          entry.array_hash = null;
        }
      }
    }

    items.push(entry);
  }

  return buildOkResponse({
    context,
    toolCallId,
    payload: { fields: items },
    warnings,
    diffSummary: null,
  });
}

async function viewField({ context, toolCallId, args, card }) {
  const pathResult = normalizePathInput(args?.path);
  if (!pathResult.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: pathResult.error,
      message: pathResult.message,
      path: pathResult.path,
    });
  }
  const rawPath = pathResult.path;
  if (containsUnsafeToken(rawPath)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_INVALID',
      message: '路径包含不安全字段',
      path: rawPath,
    });
  }

  const parsed = pathResult.parsed;

  const arrayAncestor = findNearestArrayAncestor(parsed.tokens);
  const basePath = arrayAncestor ? tokensToPath(arrayAncestor.arrayTokens) : rawPath;
  const resolved = resolveFieldPath(basePath);

  if (resolved?.aliasAmbiguous) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: '字段别名存在歧义',
      path: rawPath,
    });
  }
  if (!resolved?.field) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_NOT_FOUND',
      message: '字段未注册',
      path: rawPath,
    });
  }

  if (arrayAncestor && arrayAncestor.indexPosition !== parsed.tokens.length - 1) {
    if (resolved.field.type !== 'array' || resolved.field.array_item_type !== 'object') {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_PATH_INVALID',
        message: '数组子路径不受支持',
        path: rawPath,
      });
    }
  }

  const effectivePath = resolved?.aliasUsed
    ? applyCanonicalPath(rawPath, basePath, resolved.canonicalPath)
    : rawPath;
  const effectiveParsed = resolved?.aliasUsed ? parsePathTokens(effectivePath) : parsed;
  if (resolved?.aliasUsed && !effectiveParsed.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: effectiveParsed.error,
      message: effectiveParsed.message,
      path: effectivePath,
    });
  }

  const valueResult = getValueByTokens(card, effectiveParsed.tokens);
  if (!valueResult.exists) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_NOT_FOUND',
      message: '路径不存在',
      path: effectivePath,
    });
  }

  let warnings = [...(pathResult.warnings || [])];
  if (resolved.aliasUsed) {
    warnings.push({
      code: 'W_ALIAS_USED',
      message: `使用别名，规范路径为 ${resolved.canonicalPath}`,
      severity: 'info',
      path: resolved.canonicalPath,
    });
  }
  if (isDeprecated(resolved.field)) {
    warnings.push({
      code: 'W_DEPRECATED_READ',
      message: '读取已弃用字段',
      severity: 'warn',
      path: resolved.canonicalPath,
    });
  }

  const maxChars = Number.isFinite(args?.max_chars) ? args.max_chars : null;
  const maxBytes = Number.isFinite(args?.max_bytes) ? args.max_bytes : null;
  const limitChars = maxChars ?? getMaxValueChars();
  const offset = normalizeInteger(args?.offset, 0, { min: 0 });
  const isStringRead = typeof valueResult.value === 'string';
  const readableValue = typeof valueResult.value === 'string'
    ? valueResult.value.slice(offset)
    : valueResult.value;
  const fullMeasure = isStringRead ? measureValue(valueResult.value) : null;
  let truncation;
  try {
    truncation = applyTruncate(readableValue, limitChars, maxBytes);
  } catch (error) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: error?.message || '截断处理失败',
      path: effectivePath,
    });
  }

  if (truncation.truncated) {
    warnings.push({
      code: 'W_TRUNCATED',
      message: '返回值已截断',
      severity: 'warn',
      path: rawPath,
    });
  }

  let arrayPath = null;
  let arrayHash = null;
  if (arrayAncestor) {
    arrayPath = resolved?.aliasUsed ? resolved.canonicalPath : basePath;
    const arrayValue = getByPath(card, arrayPath);
    if (Array.isArray(arrayValue)) {
      arrayHash = await hashValue(arrayValue);
    }
  }

  let currentHash;
  try {
    currentHash = await hashValue(valueResult.value);
  } catch (error) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: error?.message || '哈希计算失败',
      path: rawPath,
    });
  }

  return buildOkResponse({
    context,
    toolCallId,
    payload: {
      value: truncation.value,
      current_hash: currentHash,
      offset,
      truncated: truncation.truncated,
      returned_chars: truncation.returnedChars,
      returned_bytes: truncation.returnedBytes,
      total_chars: fullMeasure?.totalChars ?? truncation.totalChars,
      total_bytes: fullMeasure?.totalBytes ?? truncation.totalBytes,
      array_path: arrayPath,
      array_hash: arrayHash,
      canonical_path: effectivePath,
      alias_used: resolved?.aliasUsed || undefined,
    },
    warnings,
    diffSummary: null,
  });
}

async function setField({ context, toolCallId, args, card }) {
  const pathResult = normalizePathInput(args?.path);
  if (!pathResult.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: pathResult.error,
      message: pathResult.message,
      path: pathResult.path,
    });
  }
  const rawPath = pathResult.path;
  const warnings = [...(pathResult.warnings || [])];
  if (!Object.prototype.hasOwnProperty.call(args || {}, 'value')) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: 'value 必填',
      path: rawPath,
    });
  }

  const parsed = pathResult.parsed;

  const arrayAncestor = findNearestArrayAncestor(parsed.tokens);
  const basePath = arrayAncestor ? tokensToPath(arrayAncestor.arrayTokens) : rawPath;
  const resolved = resolveFieldPath(basePath);
  if (resolved?.aliasAmbiguous) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: '字段别名存在歧义',
      path: rawPath,
    });
  }
  if (!resolved?.field) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_NOT_FOUND',
      message: '字段未注册',
      path: rawPath,
    });
  }
  if (arrayAncestor) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: 'card_set_field 不支持数组项路径',
      path: rawPath,
    });
  }
  if (!canWriteField(resolved.field) || isDeprecated(resolved.field)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: '字段不可写',
      path: rawPath,
    });
  }
  if (isHighRisk(resolved.field) && !HIGH_RISK_WRITE_ALLOWLIST.has(resolved.canonicalPath)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: '高风险字段未授权写入',
      path: rawPath,
    });
  }

  const effectivePath = resolved?.aliasUsed
    ? applyCanonicalPath(rawPath, basePath, resolved.canonicalPath)
    : rawPath;
  const effectiveParsed = resolved?.aliasUsed ? parsePathTokens(effectivePath) : parsed;
  if (resolved?.aliasUsed && !effectiveParsed.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: effectiveParsed.error,
      message: effectiveParsed.message,
      path: effectivePath,
    });
  }

  const current = getValueByTokens(card, effectiveParsed.tokens);
  if (!current.exists) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_NOT_FOUND',
      message: '路径不存在',
      path: rawPath,
    });
  }

  const allowNull = Boolean(resolved.field.nullable);
  const sizeCheck = checkValueSize(args.value);
  if (!sizeCheck.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: sizeCheck.code,
      message: sizeCheck.message,
      path: rawPath,
    });
  }
  const typeCheck = validateValueType(args.value, resolved.field, allowNull);
  if (!typeCheck.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: typeCheck.code,
      message: typeCheck.message,
      path: rawPath,
    });
  }
  const constraintsCheck = validateConstraints(args.value, resolved.field);
  if (!constraintsCheck.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: constraintsCheck.code,
      message: constraintsCheck.message,
      path: rawPath,
    });
  }

  const requireHash = requireOldHash(resolved.field);
  if (requireHash && !args?.old_hash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PRECONDITION_FAILED',
      message: 'risk>=medium 需要 old_hash',
      path: rawPath,
    });
  }

  let currentHash = null;
  try {
    currentHash = await hashValue(current.value);
  } catch (error) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: error?.message || '哈希计算失败',
      path: rawPath,
    });
  }
  if (args?.old_hash && args.old_hash !== currentHash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CAS_MISMATCH',
      message: 'old_hash 与当前值不匹配',
      path: rawPath,
    });
  }

  const cloned = deepClone(card);
  const setResult = setValueByTokens(cloned, effectiveParsed.tokens, args.value);
  if (!setResult.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: setResult.error,
      message: setResult.message,
      path: rawPath,
    });
  }

  const newHash = await hashValue(args.value);
  warnings.push(...collectContentWarnings(current.value, args.value));
  if (sizeCheck.warnings?.length) {
    warnings.push(...sizeCheck.warnings);
  }
  if (resolved.aliasUsed) {
    warnings.push({
      code: 'W_ALIAS_USED',
      message: `使用别名，规范路径为 ${resolved.canonicalPath}`,
      severity: 'info',
      path: resolved.canonicalPath,
    });
  }
  if (!args?.old_hash && !requireHash) {
    warnings.push({
      code: 'W_NON_CAS_WRITE',
      message: '未提供 old_hash，写入未使用 CAS',
      severity: 'info',
      path: rawPath,
    });
  }

  const diffSummary = applyAliasSummary(
    {
      path: effectivePath,
      change_type: 'update',
      before_hash: currentHash,
      after_hash: newHash,
      before_bytes: measureValue(current.value).totalBytes,
      after_bytes: measureValue(args.value).totalBytes,
      delta_bytes: measureValue(args.value).totalBytes - measureValue(current.value).totalBytes,
    },
    resolved?.aliasUsed ? effectivePath : null,
    resolved?.aliasUsed
  );

  const payload = {
    new_hash: newHash,
    new_card: cloned,
  };
  const attach = maybeAttachReturnValue(payload, warnings, args.value, args);
  if (!attach.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: attach.code,
      message: attach.message,
      path: effectivePath,
    });
  }

  return buildOkResponse({
    context,
    toolCallId,
    payload,
    warnings,
    diffSummary,
  });
}

async function appendEntry({ context, toolCallId, args, card }) {
  const pathResult = normalizePathInput(args?.path);
  if (!pathResult.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: pathResult.error,
      message: pathResult.message,
      path: pathResult.path,
    });
  }
  const rawPath = pathResult.path;
  const warnings = [...(pathResult.warnings || [])];
  if (!Object.prototype.hasOwnProperty.call(args || {}, 'value')) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: 'value 必填',
      path: rawPath,
    });
  }
  const parsed = pathResult.parsed;
  if (parsed.tokens.some((token) => token.type === 'index')) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_INVALID',
      message: 'card_edit_items append 需要数组本体路径',
      path: rawPath,
    });
  }
  const resolved = resolveFieldPath(rawPath);
  if (!resolved?.field) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_NOT_FOUND',
      message: '字段未注册',
      path: rawPath,
    });
  }
  if (!canAppendField(resolved.field) || isDeprecated(resolved.field)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: '字段不可追加',
      path: rawPath,
    });
  }
  if (isHighRisk(resolved.field) && !HIGH_RISK_WRITE_ALLOWLIST.has(resolved.canonicalPath)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: '高风险字段未授权写入',
      path: rawPath,
    });
  }

  const effectivePath = resolved?.aliasUsed
    ? applyCanonicalPath(rawPath, rawPath, resolved.canonicalPath)
    : rawPath;
  const list = getByPath(card, effectivePath);
  if (!Array.isArray(list)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_TYPE_MISMATCH',
      message: '目标不是数组',
      path: rawPath,
    });
  }

  const sizeCheck = checkValueSize(args.value);
  if (!sizeCheck.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: sizeCheck.code,
      message: sizeCheck.message,
      path: rawPath,
    });
  }
  if (resolved.field.array_item_type === 'string' && typeof args.value !== 'string') {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_TYPE_MISMATCH',
      message: '数组元素应为 string',
      path: rawPath,
    });
  }
  const currentConstraints = validateConstraints(list, resolved.field);
  if (!currentConstraints.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: currentConstraints.code,
      message: currentConstraints.message,
      path: rawPath,
    });
  }

  const appendIndex = list.length;

  const requireHash = requireOldHash(resolved.field);
  let listHash = null;
  try {
    listHash = await hashValue(list);
  } catch (error) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: error?.message || '哈希计算失败',
      path: rawPath,
    });
  }
  if (requireHash && !args?.old_hash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PRECONDITION_FAILED',
      message: 'risk>=medium 需要 old_hash',
      path: rawPath,
    });
  }
  if (args?.old_hash && args.old_hash !== listHash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CAS_MISMATCH',
      message: 'old_hash 与当前数组不匹配',
      path: rawPath,
    });
  }

  const cloned = deepClone(card);
  const nextList = getByPath(cloned, effectivePath);
  nextList.push(args.value);

  const listSizeCheck = checkValueSize(nextList);
  if (!listSizeCheck.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: listSizeCheck.code,
      message: listSizeCheck.message,
      path: rawPath,
    });
  }
  const nextConstraints = validateConstraints(nextList, resolved.field);
  if (!nextConstraints.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: nextConstraints.code,
      message: nextConstraints.message,
      path: rawPath,
    });
  }

  const newHash = await hashValue(nextList);
  warnings.push(...collectContentWarnings(list, nextList));
  if (sizeCheck.warnings?.length) {
    warnings.push(...sizeCheck.warnings);
  }
  if (listSizeCheck.warnings?.length) {
    warnings.push(...listSizeCheck.warnings);
  }
  if (resolved.aliasUsed) {
    warnings.push({
      code: 'W_ALIAS_USED',
      message: `使用别名，规范路径为 ${resolved.canonicalPath}`,
      severity: 'info',
      path: resolved.canonicalPath,
    });
  }
  if (!args?.old_hash && !requireHash) {
    warnings.push({
      code: 'W_NON_CAS_WRITE',
      message: '未提供 old_hash，写入未使用 CAS',
      severity: 'info',
      path: rawPath,
    });
  }

  const payload = {
    new_hash: newHash,
    new_card: cloned,
  };
  const attach = maybeAttachReturnValue(payload, warnings, nextList, args);
  if (!attach.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: attach.code,
      message: attach.message,
      path: effectivePath,
    });
  }

  return buildOkResponse({
    context,
    toolCallId,
    payload,
    warnings,
    diffSummary: applyAliasSummary(
      {
        path: `${effectivePath}[${appendIndex}]`,
        change_type: 'add',
        before_hash: listHash,
        after_hash: newHash,
        before_bytes: 0,
        after_bytes: measureValue(args.value).totalBytes,
        delta_bytes: measureValue(args.value).totalBytes,
        before_value: null,
        after_value: args.value,
      },
      resolved?.aliasUsed ? `${effectivePath}[${appendIndex}]` : null,
      resolved?.aliasUsed
    ),
  });
}

async function removeEntry({ context, toolCallId, args, card }) {
  const pathResult = normalizePathInput(args?.path);
  if (!pathResult.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: pathResult.error,
      message: pathResult.message,
      path: pathResult.path,
    });
  }
  const rawPath = pathResult.path;
  const parsed = pathResult.parsed;
  const warnings = [...(pathResult.warnings || [])];
  const arrayAncestor = findNearestArrayAncestor(parsed.tokens);
  if (!arrayAncestor || arrayAncestor.indexPosition !== parsed.tokens.length - 1) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_INVALID',
      message: 'card_edit_items remove 需要数组项路径',
      path: rawPath,
    });
  }
  const arrayPath = tokensToPath(arrayAncestor.arrayTokens);
  const resolved = resolveFieldPath(arrayPath);
  if (!resolved?.field) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_NOT_FOUND',
      message: '字段未注册',
      path: rawPath,
    });
  }
  if (!canAppendField(resolved.field) || isDeprecated(resolved.field)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: '字段不可移除',
      path: rawPath,
    });
  }
  if (isHighRisk(resolved.field) && !HIGH_RISK_WRITE_ALLOWLIST.has(resolved.canonicalPath)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: '高风险字段未授权写入',
      path: rawPath,
    });
  }

  const effectiveArrayPath = resolved?.aliasUsed
    ? applyCanonicalPath(arrayPath, arrayPath, resolved.canonicalPath)
    : arrayPath;
  const list = getByPath(card, effectiveArrayPath);
  if (!Array.isArray(list)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_TYPE_MISMATCH',
      message: '目标不是数组',
      path: rawPath,
    });
  }

  let listHash = null;
  try {
    listHash = await hashValue(list);
  } catch (error) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: error?.message || '哈希计算失败',
      path: rawPath,
    });
  }
  const requireHash = requireOldHash(resolved.field);
  if (requireHash && !args?.old_hash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PRECONDITION_FAILED',
      message: 'risk>=medium 需要 old_hash',
      path: rawPath,
    });
  }
  if (args?.old_hash && args.old_hash !== listHash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CAS_MISMATCH',
      message: 'old_hash 与当前数组不匹配',
      path: rawPath,
    });
  }

  const cloned = deepClone(card);
  const nextList = getByPath(cloned, effectiveArrayPath);
  nextList.splice(arrayAncestor.index, 1);
  const nextConstraints = validateConstraints(nextList, resolved.field);
  if (!nextConstraints.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: nextConstraints.code,
      message: nextConstraints.message,
      path: rawPath,
    });
  }
  const newHash = await hashValue(nextList);
  warnings.push(...collectContentWarnings(list, nextList));
  if (resolved.aliasUsed) {
    warnings.push({
      code: 'W_ALIAS_USED',
      message: `使用别名，规范路径为 ${resolved.canonicalPath}`,
      severity: 'info',
      path: resolved.canonicalPath,
    });
  }
  if (!args?.old_hash && !requireHash) {
    warnings.push({
      code: 'W_NON_CAS_WRITE',
      message: '未提供 old_hash，写入未使用 CAS',
      severity: 'info',
      path: rawPath,
    });
  }

  const payload = {
    new_hash: newHash,
    new_card: cloned,
  };
  const attach = maybeAttachReturnValue(payload, warnings, nextList, args);
  if (!attach.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: attach.code,
      message: attach.message,
      path: rawPath,
    });
  }

  const diffPath = resolved?.aliasUsed
    ? applyCanonicalPath(rawPath, arrayPath, resolved.canonicalPath)
    : rawPath;
  return buildOkResponse({
    context,
    toolCallId,
    payload,
    warnings,
    diffSummary: applyAliasSummary(
      {
        path: diffPath,
        change_type: 'remove',
        before_hash: listHash,
        after_hash: newHash,
        before_bytes: measureValue(list).totalBytes,
        after_bytes: measureValue(nextList).totalBytes,
        delta_bytes: measureValue(nextList).totalBytes - measureValue(list).totalBytes,
      },
      resolved?.aliasUsed ? diffPath : null,
      resolved?.aliasUsed
    ),
  });
}

async function moveEntry({ context, toolCallId, args, card }) {
  const pathResult = normalizePathInput(args?.from_path);
  const rawPath = pathResult.ok ? pathResult.path : '';
  const toIndex = Number.isFinite(args?.to_index) ? Number(args.to_index) : null;
  if (!pathResult.ok || !rawPath || toIndex === null) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: 'from_path 与 to_index 必填',
      path: rawPath,
    });
  }
  const parsed = pathResult.parsed;
  const warnings = [...(pathResult.warnings || [])];
  const arrayAncestor = findNearestArrayAncestor(parsed.tokens);
  if (!arrayAncestor || arrayAncestor.indexPosition !== parsed.tokens.length - 1) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_INVALID',
      message: 'card_edit_items move 需要数组项路径',
      path: rawPath,
    });
  }
  const arrayPath = tokensToPath(arrayAncestor.arrayTokens);
  const resolved = resolveFieldPath(arrayPath);
  if (!resolved?.field) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_NOT_FOUND',
      message: '字段未注册',
      path: rawPath,
    });
  }
  if (!canAppendField(resolved.field) || isDeprecated(resolved.field)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: '字段不可移动',
      path: rawPath,
    });
  }
  if (isHighRisk(resolved.field) && !HIGH_RISK_WRITE_ALLOWLIST.has(resolved.canonicalPath)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: '高风险字段未授权写入',
      path: rawPath,
    });
  }

  const effectiveArrayPath = resolved?.aliasUsed
    ? applyCanonicalPath(arrayPath, arrayPath, resolved.canonicalPath)
    : arrayPath;
  const list = getByPath(card, effectiveArrayPath);
  if (!Array.isArray(list)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_TYPE_MISMATCH',
      message: '目标不是数组',
      path: rawPath,
    });
  }
  if (toIndex < 0 || toIndex > list.length) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_NOT_FOUND',
      message: 'to_index 超出范围',
      path: rawPath,
    });
  }

  let listHash = null;
  try {
    listHash = await hashValue(list);
  } catch (error) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: error?.message || '哈希计算失败',
      path: rawPath,
    });
  }
  const requireHash = requireOldHash(resolved.field);
  if (requireHash && !args?.old_hash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PRECONDITION_FAILED',
      message: 'risk>=medium 需要 old_hash',
      path: rawPath,
    });
  }
  if (args?.old_hash && args.old_hash !== listHash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CAS_MISMATCH',
      message: 'old_hash 与当前数组不匹配',
      path: rawPath,
    });
  }

  const cloned = deepClone(card);
  const nextList = getByPath(cloned, effectiveArrayPath);
  const [item] = nextList.splice(arrayAncestor.index, 1);
  if (toIndex === nextList.length) {
    nextList.push(item);
  } else {
    nextList.splice(toIndex, 0, item);
  }
  const newHash = await hashValue(nextList);
  warnings.push(...collectContentWarnings(list, nextList));
  if (resolved.aliasUsed) {
    warnings.push({
      code: 'W_ALIAS_USED',
      message: `使用别名，规范路径为 ${resolved.canonicalPath}`,
      severity: 'info',
      path: resolved.canonicalPath,
    });
  }
  if (!args?.old_hash && !requireHash) {
    warnings.push({
      code: 'W_NON_CAS_WRITE',
      message: '未提供 old_hash，写入未使用 CAS',
      severity: 'info',
      path: rawPath,
    });
  }

  const changeType = arrayAncestor.index === toIndex ? 'noop' : 'move';
  const payload = {
    new_hash: newHash,
    new_card: cloned,
  };
  const attach = maybeAttachReturnValue(payload, warnings, nextList, args);
  if (!attach.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: attach.code,
      message: attach.message,
      path: rawPath,
    });
  }

  const diffPath = resolved?.aliasUsed
    ? applyCanonicalPath(rawPath, arrayPath, resolved.canonicalPath)
    : rawPath;
  return buildOkResponse({
    context,
    toolCallId,
    payload,
    warnings,
    diffSummary: applyAliasSummary(
      {
        path: diffPath,
        change_type: changeType,
        before_hash: listHash,
        after_hash: newHash,
        before_bytes: measureValue(list).totalBytes,
        after_bytes: measureValue(nextList).totalBytes,
        delta_bytes: measureValue(nextList).totalBytes - measureValue(list).totalBytes,
      },
      resolved?.aliasUsed ? diffPath : null,
      resolved?.aliasUsed
    ),
  });
}

async function listRefsTool({ context, toolCallId, args }) {
  const filters = typeof args?.filters === 'object' && args.filters ? args.filters : {};
  const refs = listRefs(filters);
  return buildOkResponse({
    context,
    toolCallId,
    payload: { refs },
    warnings: [],
    diffSummary: null,
  });
}

async function viewRefTool({ context, toolCallId, args }) {
  const result = viewRef({
    ref_id: args?.ref_id,
    offset: args?.offset,
    max_chars: args?.max_chars,
    max_bytes: args?.max_bytes,
  });
  if (result.status !== 'ok') {
    if (result.error_code === 'E_REF_NOT_FOUND') {
      const refs = listRefs();
      if (!refs.length) {
        return buildOkResponse({
          context,
          toolCallId,
          payload: {
            content: '',
            offset: 0,
            returned_chars: 0,
            returned_bytes: 0,
            total_chars: 0,
            total_bytes: 0,
            truncated: false,
            current_hash: null,
          },
          warnings: [{
            code: 'W_REF_MISSING',
            message: '未提供附件，已跳过附件读取',
            severity: 'info',
          }],
          diffSummary: null,
        });
      }
    }
    return buildErrorResponse({
      context,
      toolCallId,
      code: result.error_code,
      message: result.message,
      warnings: result.warnings || [],
    });
  }
  return buildOkResponse({
    context,
    toolCallId,
    payload: {
      content: result.content,
      offset: result.offset,
      returned_chars: result.returned_chars,
      returned_bytes: result.returned_bytes,
      total_chars: result.total_chars,
      total_bytes: result.total_bytes,
      truncated: result.truncated,
      current_hash: result.current_hash,
    },
    warnings: result.warnings || [],
    diffSummary: null,
  });
}

async function searchRefTool({ context, toolCallId, args }) {
  const result = searchRef({
    ref_id: args?.ref_id,
    query: args?.query,
    max_hits: args?.max_hits,
    snippet_chars: args?.snippet_chars,
    mode: args?.mode,
    flags: args?.flags,
  });
  if (result.status !== 'ok') {
    if (result.error_code === 'E_REF_NOT_FOUND') {
      const refs = listRefs();
      if (!refs.length) {
        return buildOkResponse({
          context,
          toolCallId,
          payload: { hits: [] },
          warnings: [{
            code: 'W_REF_MISSING',
            message: '未提供附件，已跳过附件检索',
            severity: 'info',
          }],
          diffSummary: null,
        });
      }
    }
    return buildErrorResponse({
      context,
      toolCallId,
      code: result.error_code,
      message: result.message,
      warnings: result.warnings || [],
    });
  }
  return buildOkResponse({
    context,
    toolCallId,
    payload: { hits: result.hits || [] },
    warnings: result.warnings || [],
    diffSummary: null,
  });
}

async function listSkillsTool({ context, toolCallId, skillsRepository }) {
  try {
    const repositoryState = await resolveSkillRepositoryState(skillsRepository);
    const skills = Array.isArray(repositoryState?.catalog)
      ? repositoryState.catalog.map((entry) => ({
        id: String(entry?.id || ''),
        description: String(entry?.description || ''),
        path: String(entry?.path || ''),
        tags: Array.isArray(entry?.tags) ? [...entry.tags] : [],
      }))
      : [];
    return buildOkResponse({
      context,
      toolCallId,
      payload: {
        skills,
        total: skills.length,
      },
      warnings: [],
      diffSummary: null,
    });
  } catch (error) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: error?.message || '读取技能目录失败',
    });
  }
}

async function viewSkillTool({ context, toolCallId, args, skillsRepository }) {
  const skillId = normalizeSkillIdentifier(args?.skill_id);
  if (!isValidSkillIdentifier(skillId)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: buildSkillIdentifierError('skill_id', args?.skill_id),
    });
  }

  try {
    const repositoryState = await resolveSkillRepositoryState(skillsRepository);
    const target = (repositoryState.catalog || []).find((entry) => entry.id === skillId);
    if (!target) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_PATH_NOT_FOUND',
        message: `技能不存在: ${skillId}`,
      });
    }

    const skillPath = String(target.path || buildSkillMainPath(skillId));
    const rawContent = repositoryState.files?.[skillPath];
    if (typeof rawContent !== 'string') {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_PATH_NOT_FOUND',
        message: `技能文件不存在: ${skillPath}`,
      });
    }

    const parsed = parseSkillDocument(rawContent);
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.map((item) => ({
        code: item?.code || 'W_SKILL_PARSE',
        message: item?.message || '技能文档解析告警',
        severity: 'warn',
      }))
      : [];

    const references = [];
    const seen = new Set();
    (Array.isArray(parsed.references) ? parsed.references : []).forEach((relativePath) => {
      const referenceName = parseReferenceNameFromRelativePath(relativePath);
      if (!referenceName) {
        warnings.push({
          code: 'W_REF_INVALID',
          message: `忽略非法引用路径: ${relativePath}`,
          severity: 'warn',
        });
        return;
      }
      if (seen.has(referenceName)) {
        return;
      }
      seen.add(referenceName);
      const referencePath = buildReferenceFilePath(skillId, referenceName);
      const referenceContent = repositoryState.files?.[referencePath];
      if (typeof referenceContent !== 'string') {
        warnings.push({
          code: 'W_REF_MISSING',
          message: `引用文件不存在: ${referencePath}`,
          severity: 'warn',
        });
      }
      references.push({
        name: referenceName,
        content: typeof referenceContent === 'string' ? referenceContent : '',
      });
    });

    return buildOkResponse({
      context,
      toolCallId,
      payload: {
        skill: {
          id: skillId,
          name: parsed.name || target.id || skillId,
          description: parsed.description || target.description || '',
          content: normalizeSkillBodyContent(parsed.body || ''),
          references,
        },
      },
      warnings,
      diffSummary: null,
    });
  } catch (error) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: error?.message || '读取技能失败',
    });
  }
}

async function saveSkillTool({ context, toolCallId, args, skillsRepository }) {
  const payload = args && typeof args === 'object' ? args : {};
  const targetId = normalizeSkillIdentifier(payload.skill_id);
  if (!isValidSkillIdentifier(targetId)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: buildSkillIdentifierError('skill_id', payload.skill_id),
    });
  }

  const sourceIdRaw = Object.prototype.hasOwnProperty.call(payload, 'previous_skill_id')
    ? payload.previous_skill_id
    : payload.skill_id;
  const sourceId = normalizeSkillIdentifier(sourceIdRaw);
  if (!isValidSkillIdentifier(sourceId)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: buildSkillIdentifierError('previous_skill_id', sourceIdRaw),
    });
  }

  try {
    const repositoryState = await resolveSkillRepositoryState(skillsRepository);
    const beforeState = cloneSkillRepositoryState(repositoryState);
    const sourceEntry = (repositoryState.catalog || []).find((entry) => entry.id === sourceId) || null;
    const targetEntry = (repositoryState.catalog || []).find((entry) => entry.id === targetId) || null;

    const hasPreviousId = Object.prototype.hasOwnProperty.call(payload, 'previous_skill_id');
    if (hasPreviousId && sourceId !== targetId && !sourceEntry) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_PATH_NOT_FOUND',
        message: `待重命名技能不存在: ${sourceId}`,
      });
    }
    if (sourceId !== targetId && targetEntry) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_CONSTRAINT_VIOLATION',
        message: `技能 ID 已存在: ${targetId}`,
      });
    }

    const activeEntry = sourceEntry || targetEntry || null;

    const description = String(
      Object.prototype.hasOwnProperty.call(payload, 'description')
        ? payload.description
        : activeEntry?.description || '',
    ).trim();

    const existingSkillPath = activeEntry?.path || buildSkillMainPath(sourceId);
    const existingMarkdown = typeof repositoryState.files?.[existingSkillPath] === 'string'
      ? repositoryState.files[existingSkillPath]
      : '';
    const parsedExisting = parseSkillDocument(existingMarkdown);

    const hasExplicitContent = Object.prototype.hasOwnProperty.call(payload, 'content');
    let bodyContent = hasExplicitContent
      ? normalizeSkillBodyContent(payload.content)
      : normalizeSkillBodyContent(parsedExisting.body || '');
    if (!bodyContent && !activeEntry && !hasExplicitContent) {
      bodyContent = buildDefaultSkillBody({
        name: targetId,
        description,
      });
    }

    const hasExplicitReferences = Object.prototype.hasOwnProperty.call(payload, 'references');
    let referenceDrafts = [];
    if (hasExplicitReferences) {
      if (!Array.isArray(payload.references)) {
        return buildErrorResponse({
          context,
          toolCallId,
          code: 'E_CONSTRAINT_VIOLATION',
          message: 'references 必须为数组',
        });
      }
      const seen = new Set();
      for (const rawRef of payload.references) {
        if (!rawRef || typeof rawRef !== 'object') {
          return buildErrorResponse({
            context,
            toolCallId,
            code: 'E_CONSTRAINT_VIOLATION',
            message: 'references 项必须为对象',
          });
        }
        const referenceName = normalizeSkillIdentifier(rawRef.name);
        if (!isValidSkillIdentifier(referenceName)) {
          return buildErrorResponse({
            context,
            toolCallId,
            code: 'E_CONSTRAINT_VIOLATION',
            message: buildSkillIdentifierError('reference_name', rawRef.name),
          });
        }
        if (seen.has(referenceName)) {
          return buildErrorResponse({
            context,
            toolCallId,
            code: 'E_CONSTRAINT_VIOLATION',
            message: `reference 名称重复: ${referenceName}`,
          });
        }
        seen.add(referenceName);
        referenceDrafts.push({
          name: referenceName,
          content: String(rawRef.content || ''),
        });
      }
    } else {
      referenceDrafts = resolveReferenceDraftsFromExisting(sourceId, parsedExisting, repositoryState);
    }

    const nextState = cloneSkillRepositoryState(repositoryState);
    const nextCatalogEntry = createSkillCatalogEntry({
      id: targetId,
      description,
      tags: activeEntry?.tags || [],
    });
    nextState.catalog = upsertCatalogEntry(nextState.catalog, nextCatalogEntry, { sourceId });

    if (sourceId !== targetId) {
      const sourcePrefix = `${sourceId}/`;
      Object.keys(nextState.files || {}).forEach((path) => {
        if (!path.startsWith(sourcePrefix)) return;
        const renamedPath = `${targetId}/${path.slice(sourcePrefix.length)}`;
        nextState.files[renamedPath] = String(nextState.files[path] || '');
        delete nextState.files[path];
      });
    }

    const nextSkillPath = buildSkillMainPath(targetId);
    const referenceRelativePaths = referenceDrafts.map((item) => buildReferenceRelativePath(item.name));
    nextState.files[nextSkillPath] = serializeSkillDocumentMarkdown({
      name: targetId,
      description,
      content: bodyContent,
      references: referenceRelativePaths,
    });

    const expectedReferencePaths = new Set();
    referenceDrafts.forEach((reference) => {
      const fullPath = buildReferenceFilePath(targetId, reference.name);
      expectedReferencePaths.add(fullPath);
      nextState.files[fullPath] = String(reference.content || '');
    });

    Object.keys(nextState.files || {}).forEach((path) => {
      if (!path.startsWith(`${targetId}/references/`)) return;
      if (expectedReferencePaths.has(path)) return;
      delete nextState.files[path];
    });

    nextState.files[SKILL_CATALOG_FILE] = serializeSkillCatalogMarkdown(nextState.catalog);
    const diffSummaries = await buildSkillRepositoryDiffSummaries(beforeState, nextState);

    return buildOkResponse({
      context,
      toolCallId,
      payload: {
        skill: {
          id: targetId,
          description,
          content: bodyContent,
          references: referenceDrafts.map((item) => ({
            name: item.name,
            content: item.content,
          })),
        },
        new_skill_repository: nextState,
      },
      warnings: [],
      diffSummary: diffSummaries[0] || null,
      diffSummaries,
    });
  } catch (error) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: error?.message || '保存技能失败',
    });
  }
}

async function deleteSkillTool({ context, toolCallId, args, skillsRepository }) {
  const skillId = normalizeSkillIdentifier(args?.skill_id);
  if (!isValidSkillIdentifier(skillId)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: buildSkillIdentifierError('skill_id', args?.skill_id),
    });
  }

  try {
    const repositoryState = await resolveSkillRepositoryState(skillsRepository);
    const beforeState = cloneSkillRepositoryState(repositoryState);
    const existing = (repositoryState.catalog || []).find((entry) => entry.id === skillId);
    if (!existing) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_PATH_NOT_FOUND',
        message: `技能不存在: ${skillId}`,
      });
    }

    const deleteFiles = args?.delete_files !== false;
    const nextState = cloneSkillRepositoryState(repositoryState);
    nextState.catalog = (nextState.catalog || []).filter((entry) => entry.id !== skillId);

    if (deleteFiles) {
      Object.keys(nextState.files || {}).forEach((path) => {
        if (path.startsWith(`${skillId}/`)) {
          delete nextState.files[path];
        }
      });
    }

    nextState.files[SKILL_CATALOG_FILE] = serializeSkillCatalogMarkdown(nextState.catalog);
    const diffSummaries = await buildSkillRepositoryDiffSummaries(beforeState, nextState);

    return buildOkResponse({
      context,
      toolCallId,
      payload: {
        deleted_skill_id: skillId,
        removed_files: deleteFiles,
        new_skill_repository: nextState,
      },
      warnings: [],
      diffSummary: diffSummaries[0] || null,
      diffSummaries,
    });
  } catch (error) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: error?.message || '删除技能失败',
    });
  }
}

async function cardListFieldsTool({ context, toolCallId, args, card }) {
  const path = typeof args?.path === 'string' ? args.path.trim() : '';
  if (isCharacterBookPath(path)) {
    return buildCharacterBookBlockedResponse({ context, toolCallId, path });
  }
  const result = await listFields({ context, toolCallId, args, card });
  if (result?.status === 'ok' && Array.isArray(result.fields)) {
    return {
      ...result,
      fields: result.fields.filter((field) => !isCharacterBookPath(field?.path)),
    };
  }
  return result;
}

async function cardReadFieldTool({ context, toolCallId, args, card }) {
  const path = typeof args?.path === 'string' ? args.path.trim() : '';
  if (isCharacterBookPath(path)) {
    return buildCharacterBookBlockedResponse({ context, toolCallId, path });
  }
  return viewField({ context, toolCallId, args, card });
}

async function cardSetFieldTool({ context, toolCallId, args, card }) {
  const path = typeof args?.path === 'string' ? args.path.trim() : '';
  if (isCharacterBookPath(path)) {
    return buildCharacterBookBlockedResponse({ context, toolCallId, path });
  }
  return setField({
    context,
    toolCallId,
    args: {
      path: args?.path,
      value: args?.value,
      old_hash: args?.expected_hash,
      return_value: args?.return_value,
      max_chars: args?.max_chars,
      max_bytes: args?.max_bytes,
    },
    card,
  });
}

async function cardPatchTextTool({ context, toolCallId, args, card }) {
  const path = typeof args?.path === 'string' ? args.path.trim() : '';
  if (isCharacterBookPath(path)) {
    return buildCharacterBookBlockedResponse({ context, toolCallId, path });
  }
  const pathResult = normalizePathInput(args?.path);
  if (!pathResult.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: pathResult.error,
      message: pathResult.message,
      path: pathResult.path,
    });
  }
  const rawPath = pathResult.path;
  const parsed = pathResult.parsed;
  const arrayAncestor = findNearestArrayAncestor(parsed.tokens);
  const scope = args?.scope === 'items' ? 'items' : 'field';
  const basePath = arrayAncestor ? tokensToPath(arrayAncestor.arrayTokens) : rawPath;
  const resolved = resolveFieldPath(basePath);
  if (resolved?.aliasAmbiguous) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_INTERNAL',
      message: '字段别名存在歧义',
      path: rawPath,
    });
  }
  if (!resolved?.field) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_NOT_FOUND',
      message: '字段未注册',
      path: rawPath,
    });
  }
  if (isDeprecated(resolved.field)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: '字段不可写',
      path: rawPath,
    });
  }
  if (isHighRisk(resolved.field) && !HIGH_RISK_WRITE_ALLOWLIST.has(resolved.canonicalPath)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: '高风险字段未授权写入',
      path: rawPath,
    });
  }

  const effectivePath = resolved?.aliasUsed
    ? applyCanonicalPath(rawPath, basePath, resolved.canonicalPath)
    : rawPath;
  const effectiveParsed = resolved?.aliasUsed ? parsePathTokens(effectivePath) : parsed;
  if (resolved?.aliasUsed && !effectiveParsed.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: effectiveParsed.error,
      message: effectiveParsed.message,
      path: effectivePath,
    });
  }

  const warnings = [...(pathResult.warnings || [])];
  if (resolved.aliasUsed) {
    warnings.push({
      code: 'W_ALIAS_USED',
      message: `使用别名，规范路径为 ${resolved.canonicalPath}`,
      severity: 'info',
      path: resolved.canonicalPath,
    });
  }

  if (!arrayAncestor && scope === 'field' && resolved.field.type === 'string') {
    if (!canWriteField(resolved.field)) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_PERMISSION_DENIED',
        message: '字段不可写',
        path: rawPath,
      });
    }
    const current = getValueByTokens(card, effectiveParsed.tokens);
    if (!current.exists) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_PATH_NOT_FOUND',
        message: '路径不存在',
        path: effectivePath,
      });
    }
    if (typeof current.value !== 'string') {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_TYPE_MISMATCH',
        message: 'card_patch_text 仅支持字符串字段',
        path: effectivePath,
      });
    }
    const patchResult = applyTextPatches(current.value, args?.patches);
    if (!patchResult.ok) {
      return attachPatchErrorDetails(buildErrorResponse({
        context,
        toolCallId,
        code: patchResult.code,
        message: patchResult.message,
        path: effectivePath,
      }), patchResult);
    }
    const result = await setField({
      context,
      toolCallId,
      args: {
        path: effectivePath,
        value: patchResult.text,
        old_hash: args?.expected_hash,
        return_value: args?.return_value,
        max_chars: args?.max_chars,
        max_bytes: args?.max_bytes,
      },
      card,
    });
    if (result?.status === 'ok') {
      result.warnings = uniqueWarnings([...(result.warnings || []), ...(patchResult.warnings || []), ...warnings]);
    }
    return result;
  }

  if (resolved.field.type !== 'array' || resolved.field.array_item_type !== 'string') {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_TYPE_MISMATCH',
      message: 'card_patch_text 仅支持字符串字段或字符串数组',
      path: effectivePath,
    });
  }
  if (!canAppendField(resolved.field) && !canWriteField(resolved.field)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: '字段不可写',
      path: effectivePath,
    });
  }

  const arrayPath = resolved?.aliasUsed ? resolved.canonicalPath : basePath;
  const arrayParsed = parsePathTokens(arrayPath);
  if (!arrayParsed.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: arrayParsed.error,
      message: arrayParsed.message,
      path: arrayPath,
    });
  }
  const arrayResult = getValueByTokens(card, arrayParsed.tokens);
  if (!arrayResult.exists) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_NOT_FOUND',
      message: '路径不存在',
      path: arrayPath,
    });
  }
  if (!Array.isArray(arrayResult.value)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_TYPE_MISMATCH',
      message: '目标字段不是数组',
      path: arrayPath,
    });
  }
  const list = arrayResult.value;
  const invalidIndex = list.findIndex((item) => typeof item !== 'string');
  if (invalidIndex !== -1) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_TYPE_MISMATCH',
      message: '数组元素应为 string',
      path: `${arrayPath}[${invalidIndex}]`,
    });
  }

  const currentHash = await hashValue(list);
  const requireHash = requireOldHash(resolved.field);
  if (requireHash && !args?.expected_hash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PRECONDITION_FAILED',
      message: 'risk>=medium 需要 expected_hash',
      path: arrayPath,
    });
  }
  if (args?.expected_hash && args.expected_hash !== currentHash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CAS_MISMATCH',
      message: 'expected_hash 与当前数组不匹配',
      path: arrayPath,
    });
  }

  const targetIndices = [];
  if (arrayAncestor) {
    if (arrayAncestor.indexPosition !== parsed.tokens.length - 1) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_PATH_INVALID',
        message: '字符串数组项不支持子路径',
        path: rawPath,
      });
    }
    if (arrayAncestor.index < 0 || arrayAncestor.index >= list.length) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_PATH_NOT_FOUND',
        message: '数组索引越界',
        path: effectivePath,
      });
    }
    targetIndices.push(arrayAncestor.index);
  } else if (scope === 'items') {
    for (let index = 0; index < list.length; index += 1) targetIndices.push(index);
  } else {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_TYPE_MISMATCH',
      message: '数组字段需使用 scope="items" 或指定数组项路径',
      path: arrayPath,
    });
  }

  const cloned = deepClone(card);
  const nextList = getByPath(cloned, arrayPath);
  const matchedIndices = [];
  const changedIndices = [];
  const failedItems = [];
  const itemHashes = [];
  const diffSummaries = [];

  for (const index of targetIndices) {
    const beforeValue = list[index];
    const beforeHash = await hashValue(beforeValue);
    const patchResult = applyTextPatches(beforeValue, args?.patches);
    if (!patchResult.ok) {
      const failure = {
        index,
        path: `${arrayPath}[${index}]`,
        code: patchResult.code,
        message: patchResult.message,
      };
      if (patchResult.candidate_snippets) failure.candidate_snippets = patchResult.candidate_snippets;
      failedItems.push(failure);
      continue;
    }
    matchedIndices.push(index);
    nextList[index] = patchResult.text;
    const afterHash = await hashValue(nextList[index]);
    itemHashes.push({
      index,
      content_hash: beforeHash,
      new_hash: afterHash,
    });
    warnings.push(...(patchResult.warnings || []));
    warnings.push(...collectContentWarnings(beforeValue, nextList[index]));
    if (!valuesEqual(beforeValue, nextList[index])) {
      changedIndices.push(index);
    }
    diffSummaries.push(await buildCardFieldDiff({
      path: `${arrayPath}[${index}]`,
      beforeValue,
      afterValue: nextList[index],
    }));
  }

  if (!matchedIndices.length) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_ANCHOR_NOT_FOUND',
      message: '没有数组项匹配补丁锚点',
      path: arrayPath,
      warnings: uniqueWarnings(warnings),
    });
  }

  const sizeCheck = checkValueSize(nextList);
  if (!sizeCheck.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: sizeCheck.code,
      message: sizeCheck.message,
      path: arrayPath,
    });
  }
  const constraintsCheck = validateConstraints(nextList, resolved.field);
  if (!constraintsCheck.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: constraintsCheck.code,
      message: constraintsCheck.message,
      path: arrayPath,
    });
  }
  if (sizeCheck.warnings?.length) warnings.push(...sizeCheck.warnings);
  if (!args?.expected_hash && !requireHash) {
    warnings.push({
      code: 'W_NON_CAS_WRITE',
      message: '未提供 expected_hash，写入未使用 CAS',
      severity: 'info',
      path: arrayPath,
    });
  }
  if (failedItems.length) {
    warnings.push({
      code: 'W_PARTIAL_PATCH_APPLIED',
      message: '部分数组项未应用补丁',
      severity: 'warn',
      path: arrayPath,
    });
  }

  const changed = changedIndices.length > 0;
  const newHash = await hashValue(nextList);
  const payload = {
    changed,
    current_hash: newHash,
    new_hash: newHash,
    new_card: changed ? cloned : undefined,
    matched_indices: matchedIndices,
    changed_indices: changedIndices,
    item_hashes: itemHashes,
    failed_items: failedItems,
  };
  const attach = maybeAttachReturnValue(payload, warnings, nextList, args);
  if (!attach.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: attach.code,
      message: attach.message,
      path: arrayPath,
    });
  }

  return buildOkResponse({
    context,
    toolCallId,
    payload,
    warnings: uniqueWarnings(warnings),
    diffSummary: diffSummaries[0] || null,
    diffSummaries,
  });
}

async function cardListItemsTool({ context, toolCallId, args, card }) {
  const path = typeof args?.path === 'string' ? args.path.trim() : '';
  if (isCharacterBookPath(path)) {
    return buildCharacterBookBlockedResponse({ context, toolCallId, path });
  }
  const readResult = await viewField({ context, toolCallId, args: { path }, card });
  if (readResult.status !== 'ok') return readResult;
  if (!Array.isArray(readResult.value)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_TYPE_MISMATCH',
      message: '目标字段不是数组',
      path,
    });
  }
  const offset = normalizeInteger(args?.offset, 0, { min: 0 });
  const limit = normalizeInteger(args?.limit, 100, { min: 1, max: 500 });
  const previewChars = clampPreviewChars(args?.max_preview_chars);
  const items = [];
  const visibleItems = readResult.value.slice(offset, offset + limit);
  for (let itemOffset = 0; itemOffset < visibleItems.length; itemOffset += 1) {
    const item = visibleItems[itemOffset];
    const row = {
      index: offset + itemOffset,
      type: Array.isArray(item) ? 'array' : typeof item,
      preview: previewText(typeof item === 'string' ? item : stableStringify(item), previewChars),
    };
    if (typeof item === 'string') {
      row.content_hash = await hashValue(item);
    }
    items.push(row);
  }
  return buildOkResponse({
    context,
    toolCallId,
    payload: {
      path,
      total: readResult.value.length,
      offset,
      items,
      current_hash: readResult.current_hash,
    },
    warnings: readResult.warnings || [],
  });
}

async function cardEditItemsTool({ context, toolCallId, args, card }) {
  const path = typeof args?.path === 'string' ? args.path.trim() : '';
  if (isCharacterBookPath(path)) {
    return buildCharacterBookBlockedResponse({ context, toolCallId, path });
  }
  const operation = String(args?.operation || '').trim();
  if (operation === 'append') {
    return appendEntry({
      context,
      toolCallId,
      args: {
        path,
        value: args?.value,
        old_hash: args?.expected_hash,
        return_value: args?.return_value,
        max_chars: args?.max_chars,
        max_bytes: args?.max_bytes,
      },
      card,
    });
  }
  if (operation === 'set') {
    const index = normalizeInteger(args?.index, -1, { min: -1 });
    const readResult = await viewField({ context, toolCallId, args: { path }, card });
    if (readResult.status !== 'ok') return readResult;
    if (!Array.isArray(readResult.value)) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_TYPE_MISMATCH',
        message: '目标字段不是数组',
        path,
      });
    }
    if (index < 0 || index >= readResult.value.length) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_PATH_NOT_FOUND',
        message: '数组索引越界',
        path: `${path}[${index}]`,
      });
    }
    if (args?.expected_hash && args.expected_hash !== readResult.current_hash) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_CAS_MISMATCH',
        message: 'expected_hash 与当前数组不匹配',
        path,
      });
    }
    const cloned = deepClone(card);
    const nextList = getByPath(cloned, path);
    const beforeValue = nextList[index];
    nextList[index] = deepClone(args?.value);
    const diffSummary = await buildCardFieldDiff({
      path: `${path}[${index}]`,
      beforeValue,
      afterValue: nextList[index],
    });
    const payload = {
      changed: diffSummary.change_type !== 'noop',
      current_hash: await hashValue(nextList),
      new_card: cloned,
    };
    const warnings = collectContentWarnings(beforeValue, nextList[index]);
    const attach = maybeAttachReturnValue(payload, warnings, nextList, args);
    if (!attach.ok) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: attach.code,
        message: attach.message,
        path,
      });
    }
    return buildOkResponse({
      context,
      toolCallId,
      payload,
      warnings,
      diffSummary,
    });
  }
  if (operation === 'remove') {
    const index = normalizeInteger(args?.index, -1, { min: -1 });
    return removeEntry({
      context,
      toolCallId,
      args: {
        path: `${path}[${index}]`,
        old_hash: args?.expected_hash,
        return_value: args?.return_value,
        max_chars: args?.max_chars,
        max_bytes: args?.max_bytes,
      },
      card,
    });
  }
  if (operation === 'move') {
    const fromIndex = normalizeInteger(args?.from_index ?? args?.index, -1, { min: -1 });
    return moveEntry({
      context,
      toolCallId,
      args: {
        from_path: `${path}[${fromIndex}]`,
        to_index: args?.to_index,
        old_hash: args?.expected_hash,
        return_value: args?.return_value,
        max_chars: args?.max_chars,
        max_bytes: args?.max_bytes,
      },
      card,
    });
  }
  return buildErrorResponse({
    context,
    toolCallId,
    code: 'E_CONSTRAINT_VIOLATION',
    message: 'operation 必须是 append/set/remove/move',
    path,
  });
}

async function lorebookSummaryTool({ context, toolCallId, args, card }) {
  const cloned = deepClone(card);
  const book = ensureLorebook(cloned);
  ensureLorebookEntryIds(book.entries);
  const maxEntries = normalizeInteger(args?.max_entries, DEFAULT_LOREBOOK_MAX_ENTRIES, {
    min: 0,
    max: 1000,
  });
  const rows = await buildLorebookRows(
    book.entries.slice(0, maxEntries),
    clampPreviewChars(args?.max_preview_chars),
  );
  const meta = { ...book };
  delete meta.entries;
  return buildOkResponse({
    context,
    toolCallId,
    payload: {
      total: book.entries.length,
      ids: book.entries.map((entry) => String(entry?.id || '')),
      entries: rows,
      meta,
      current_hash: await hashValue(book),
      changed: !valuesEqual(card, cloned),
      new_card: !valuesEqual(card, cloned) ? cloned : undefined,
    },
    warnings: [],
  });
}

async function lorebookSearchEntriesTool({ context, toolCallId, args, card }) {
  const { entries } = getLorebook(card);
  const query = String(args?.query || '').trim();
  if (!query) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: 'query 不能为空',
    });
  }
  const maxHits = normalizeInteger(args?.max_hits, DEFAULT_LOREBOOK_SEARCH_HITS, {
    min: 1,
    max: MAX_LOREBOOK_SEARCH_HITS,
  });
  const snippetChars = clampPreviewChars(args?.snippet_chars);
  const isRegex = args?.mode === 'regex';
  const matchAll = args?.match === 'all';
  let regexes = [];
  const keywords = isRegex
    ? [query]
    : query.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  if (isRegex) {
    try {
      regexes = [new RegExp(query, String(args?.flags || '').replace(/[^dgimsuvy]/g, ''))];
    } catch (error) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_CONSTRAINT_VIOLATION',
        message: error?.message || '正则无效',
      });
    }
  }
  const matches = [];
  let filteredByEnabled = 0;
  let filteredByConstant = 0;
  let searchedEntries = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] || {};
    if (typeof args?.enabled === 'boolean' && (entry.enabled !== false) !== args.enabled) {
      filteredByEnabled += 1;
      continue;
    }
    if (typeof args?.constant === 'boolean' && (entry.constant === true) !== args.constant) {
      filteredByConstant += 1;
      continue;
    }
    searchedEntries += 1;
    const fieldValues = {
      id: String(entry.id || ''),
      name: String(entry.name || ''),
      comment: String(entry.comment || ''),
      keys: normalizeKeys(entry.keys).join('\n'),
      secondary_keys: normalizeKeys(entry.secondary_keys).join('\n'),
      content: String(entry.content || ''),
    };
    const matchedFields = [];
    const fieldRanges = {};
    for (const [fieldName, fieldValue] of Object.entries(fieldValues)) {
      if (isRegex) {
        const regex = regexes[0];
        regex.lastIndex = 0;
        const fieldMatches = [];
        let match = regex.exec(fieldValue);
        while (match) {
          fieldMatches.push({
            start: match.index,
            end: match.index + match[0].length,
            match: match[0],
          });
          if (!regex.global) break;
          if (match[0].length === 0) regex.lastIndex += 1;
          match = regex.exec(fieldValue);
        }
        if (fieldMatches.length) {
          matchedFields.push(fieldName);
          fieldRanges[fieldName] = fieldMatches;
        }
        continue;
      }
      const lowerValue = fieldValue.toLowerCase();
      const ranges = [];
      for (const keyword of keywords) {
        const lowerKeyword = keyword.toLowerCase();
        let from = 0;
        while (from <= lowerValue.length) {
          const found = lowerValue.indexOf(lowerKeyword, from);
          if (found === -1) break;
          ranges.push({ start: found, end: found + keyword.length, match: fieldValue.slice(found, found + keyword.length), keyword });
          from = found + Math.max(1, keyword.length);
        }
      }
      if (ranges.length) {
        matchedFields.push(fieldName);
        fieldRanges[fieldName] = ranges;
      }
    }
    const hitKeywords = new Set();
    Object.values(fieldRanges).flat().forEach((range) => {
      if (range.keyword) hitKeywords.add(range.keyword.toLowerCase());
    });
    const matched = isRegex
      ? matchedFields.length > 0
      : (matchAll ? keywords.every((keyword) => hitKeywords.has(keyword.toLowerCase())) : matchedFields.length > 0);
    if (!matched) continue;
    const snippetField = fieldRanges.content ? 'content' : matchedFields[0];
    matches.push({
      ...(await buildLorebookRow(entry, index, snippetChars)),
      entry_id: String(entry?.id || ''),
      entry_index: index,
      matched_fields: matchedFields,
      snippet: buildSearchSnippet(fieldValues[snippetField], fieldRanges[snippetField], snippetChars),
    });
    if (matches.length >= maxHits) break;
  }
  const diagnostics = matches.length === 0
    ? {
      query,
      mode: isRegex ? 'regex' : 'text',
      match: matchAll ? 'all' : 'any',
      total_entries: entries.length,
      searched_entries: searchedEntries,
      filtered_by_enabled: filteredByEnabled,
      filtered_by_constant: filteredByConstant,
      searched_fields: ['id', 'name', 'comment', 'keys', 'secondary_keys', 'content'],
    }
    : null;
  return buildOkResponse({
    context,
    toolCallId,
    payload: {
      total: matches.length,
      snippets: matches,
      search_diagnostics: diagnostics,
    },
    warnings: [],
  });
}

async function lorebookReadEntryTool({ context, toolCallId, args, card }) {
  const cloned = deepClone(card);
  const book = ensureLorebook(cloned);
  const idsChanged = ensureLorebookEntryIds(book.entries);
  const resolved = await resolveLorebookEntryRef(book.entries, args?.entry_ref);
  if (!resolved.ok) {
    const error = buildErrorResponse({
      context,
      toolCallId,
      code: resolved.code,
      message: resolved.message,
    });
    if (resolved.candidates) error.candidates = resolved.candidates;
    return error;
  }
  const entry = resolved.entry;
  const offset = normalizeInteger(args?.offset, 0, { min: 0 });
  const maxChars = Number.isFinite(args?.max_chars) ? args.max_chars : getMaxValueChars();
  const maxBytes = Number.isFinite(args?.max_bytes) ? args.max_bytes : null;
  const contentResult = applyTruncate(String(entry.content || '').slice(offset), maxChars, maxBytes);
  const publicEntry = { ...entry, content: contentResult.value };
  return buildOkResponse({
    context,
    toolCallId,
    payload: {
      entry: publicEntry,
      index: resolved.index,
      current_hash: await hashValue(entry),
      content_hash: await hashValue(String(entry.content || '')),
      offset,
      truncated: contentResult.truncated,
      returned_chars: contentResult.returnedChars,
      returned_bytes: contentResult.returnedBytes,
      total_chars: measureValue(String(entry.content || '')).totalChars,
      total_bytes: measureValue(String(entry.content || '')).totalBytes,
      changed: idsChanged,
      new_card: idsChanged ? cloned : undefined,
    },
    warnings: contentResult.truncated
      ? [{ code: 'W_TRUNCATED', message: '返回值已截断', severity: 'warn' }]
      : [],
  });
}

async function lorebookPatchEntryTool({ context, toolCallId, args, card }) {
  const cloned = deepClone(card);
  const book = ensureLorebook(cloned);
  ensureLorebookEntryIds(book.entries);
  const resolved = await resolveLorebookEntryRef(book.entries, args?.entry_ref);
  if (!resolved.ok) {
    const error = buildErrorResponse({
      context,
      toolCallId,
      code: resolved.code,
      message: resolved.message,
    });
    if (resolved.candidates) error.candidates = resolved.candidates;
    return error;
  }
  const field = String(args?.field || 'content').trim() || 'content';
  if (containsUnsafeToken(field) || field.includes('.') || field.includes('[')) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PATH_INVALID',
      message: 'field 必须是条目内的普通字段名',
    });
  }
  const entry = resolved.entry;
  if (typeof entry[field] !== 'string') {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_TYPE_MISMATCH',
      message: 'lorebook_patch_entry 仅支持字符串字段',
    });
  }
  const currentHash = await hashValue(entry[field]);
  if (args?.expected_hash && args.expected_hash !== currentHash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CAS_MISMATCH',
      message: 'expected_hash 与当前字段不匹配',
      path: `${CHARACTER_BOOK_PATH}.entries[id=${entry.id}].${field}`,
    });
  }
  const patchResult = applyTextPatches(entry[field], args?.patches);
  if (!patchResult.ok) {
    return attachPatchErrorDetails(buildErrorResponse({
      context,
      toolCallId,
      code: patchResult.code,
      message: patchResult.message,
      path: `${CHARACTER_BOOK_PATH}.entries[id=${entry.id}].${field}`,
    }), patchResult);
  }
  const beforeValue = entry[field];
  entry[field] = patchResult.text;
  const afterHash = await hashValue(entry[field]);
  const diffSummary = await buildCardFieldDiff({
    path: `${CHARACTER_BOOK_PATH}.entries[id=${entry.id}].${field}`,
    beforeValue,
    afterValue: entry[field],
  });
  const payload = {
    changed: diffSummary.change_type !== 'noop',
    current_hash: afterHash,
    new_card: cloned,
  };
  const warnings = uniqueWarnings([
    ...(patchResult.warnings || []),
    ...collectContentWarnings(beforeValue, entry[field]),
  ]);
  const attach = maybeAttachReturnValue(payload, warnings, entry[field], args);
  if (!attach.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: attach.code,
      message: attach.message,
      path: `${CHARACTER_BOOK_PATH}.entries[id=${entry.id}].${field}`,
    });
  }
  return buildOkResponse({
    context,
    toolCallId,
    payload,
    warnings,
    diffSummary,
  });
}

async function lorebookUpsertEntryTool({ context, toolCallId, args, card }) {
  const cloned = deepClone(card);
  const book = ensureLorebook(cloned);
  ensureLorebookEntryIds(book.entries);
  if (!args?.entry || typeof args.entry !== 'object' || Array.isArray(args.entry)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: 'entry 必须为对象',
    });
  }
  const resolved = args?.entry_ref
    ? await resolveLorebookEntryRef(book.entries, args.entry_ref, { allowMissing: true })
    : { ok: true, index: -1, entry: null };
  if (!resolved.ok) {
    const error = buildErrorResponse({
      context,
      toolCallId,
      code: resolved.code,
      message: resolved.message,
    });
    if (resolved.candidates) error.candidates = resolved.candidates;
    return error;
  }
  const beforeEntry = resolved.entry ? deepClone(resolved.entry) : null;
  if (beforeEntry) {
    const currentHash = await hashValue(beforeEntry);
    if (args?.expected_hash && args.expected_hash !== currentHash) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_CAS_MISMATCH',
        message: 'expected_hash 与当前条目不匹配',
      });
    }
  }
  const nextEntry = {
    ...(beforeEntry || {}),
    ...deepClone(args.entry),
  };
  if (!String(nextEntry.id || '').trim()) {
    nextEntry.id = generateLorebookEntryId(book.entries);
  } else if (!LOREBOOK_ENTRY_ID_PATTERN.test(String(nextEntry.id))) {
    nextEntry.id = String(nextEntry.id).trim();
  }
  if (!Array.isArray(nextEntry.keys)) nextEntry.keys = [];
  if (!Array.isArray(nextEntry.secondary_keys)) nextEntry.secondary_keys = [];
  const duplicateIndex = book.entries.findIndex((entry, index) => (
    String(entry?.id || '') === String(nextEntry.id || '') && index !== resolved.index
  ));
  if (duplicateIndex !== -1) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: `世界书条目 id 已存在: ${nextEntry.id}`,
    });
  }
  if (resolved.index >= 0) {
    book.entries[resolved.index] = nextEntry;
  } else {
    book.entries.push(nextEntry);
  }
  const diffSummary = await buildCardFieldDiff({
    path: `${CHARACTER_BOOK_PATH}.entries[id=${nextEntry.id}]`,
    beforeValue: beforeEntry,
    afterValue: nextEntry,
    changeType: beforeEntry ? 'update' : 'add',
  });
  const payload = {
    changed: diffSummary.change_type !== 'noop',
    current_hash: await hashValue(nextEntry),
    ids: [String(nextEntry.id || '')],
    new_card: cloned,
  };
  maybeAttachReturnValue(payload, [], nextEntry, args);
  return buildOkResponse({
    context,
    toolCallId,
    payload,
    warnings: beforeEntry ? collectContentWarnings(beforeEntry, nextEntry) : [],
    diffSummary,
  });
}

async function lorebookRemoveEntryTool({ context, toolCallId, args, card }) {
  const cloned = deepClone(card);
  const book = ensureLorebook(cloned);
  ensureLorebookEntryIds(book.entries);
  const resolved = await resolveLorebookEntryRef(book.entries, args?.entry_ref);
  if (!resolved.ok) {
    const error = buildErrorResponse({
      context,
      toolCallId,
      code: resolved.code,
      message: resolved.message,
    });
    if (resolved.candidates) error.candidates = resolved.candidates;
    return error;
  }
  const beforeEntry = deepClone(resolved.entry);
  const currentHash = await hashValue(beforeEntry);
  if (args?.expected_hash && args.expected_hash !== currentHash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CAS_MISMATCH',
      message: 'expected_hash 与当前条目不匹配',
    });
  }
  book.entries.splice(resolved.index, 1);
  const diffSummary = await buildCardFieldDiff({
    path: `${CHARACTER_BOOK_PATH}.entries[id=${beforeEntry.id}]`,
    beforeValue: beforeEntry,
    afterValue: null,
    changeType: 'remove',
  });
  return buildOkResponse({
    context,
    toolCallId,
    payload: {
      changed: true,
      ids: [String(beforeEntry.id || '')],
      current_hash: await hashValue(book.entries),
      new_card: cloned,
    },
    warnings: [],
    diffSummary,
  });
}

async function lorebookReorderEntriesTool({ context, toolCallId, args, card }) {
  if (!Array.isArray(args?.entry_refs)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: 'entry_refs 必须为数组',
    });
  }
  const cloned = deepClone(card);
  const book = ensureLorebook(cloned);
  ensureLorebookEntryIds(book.entries);
  const beforeEntries = deepClone(book.entries);
  const currentHash = await hashValue(book.entries);
  if (args?.expected_hash && args.expected_hash !== currentHash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CAS_MISMATCH',
      message: 'expected_hash 与当前条目顺序不匹配',
    });
  }
  if (args.entry_refs.length !== book.entries.length) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: 'entry_refs 必须包含全部条目',
    });
  }
  const nextEntries = [];
  const used = new Set();
  for (const entryRef of args.entry_refs) {
    const resolved = await resolveLorebookEntryRef(book.entries, entryRef);
    if (!resolved.ok) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: resolved.code,
        message: resolved.message,
      });
    }
    const id = String(resolved.entry?.id || '');
    if (used.has(id)) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_CONSTRAINT_VIOLATION',
        message: `entry_refs 存在重复条目: ${id}`,
      });
    }
    used.add(id);
    nextEntries.push(resolved.entry);
  }
  book.entries = nextEntries;
  const diffSummary = await buildCardFieldDiff({
    path: `${CHARACTER_BOOK_PATH}.entries`,
    beforeValue: beforeEntries,
    afterValue: nextEntries,
    changeType: 'move',
  });
  return buildOkResponse({
    context,
    toolCallId,
    payload: {
      changed: diffSummary.change_type !== 'noop',
      ids: nextEntries.map((entry) => String(entry?.id || '')),
      current_hash: await hashValue(nextEntries),
      new_card: cloned,
    },
    warnings: [],
    diffSummary,
  });
}

async function lorebookSetMetaTool({ context, toolCallId, args, card }) {
  if (!args?.meta || typeof args.meta !== 'object' || Array.isArray(args.meta)) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: 'meta 必须为对象',
    });
  }
  if (Object.prototype.hasOwnProperty.call(args.meta, 'entries')) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: 'entries 请使用 lorebook entry 工具修改',
    });
  }
  const cloned = deepClone(card);
  const book = ensureLorebook(cloned);
  ensureLorebookEntryIds(book.entries);
  const beforeMeta = { ...book };
  delete beforeMeta.entries;
  const currentHash = await hashValue(beforeMeta);
  if (args?.expected_hash && args.expected_hash !== currentHash) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CAS_MISMATCH',
      message: 'expected_hash 与当前世界书元信息不匹配',
    });
  }
  Object.assign(book, deepClone(args.meta), { entries: book.entries });
  const afterMeta = { ...book };
  delete afterMeta.entries;
  const diffSummary = await buildCardFieldDiff({
    path: CHARACTER_BOOK_PATH,
    beforeValue: beforeMeta,
    afterValue: afterMeta,
  });
  const payload = {
    changed: diffSummary.change_type !== 'noop',
    current_hash: await hashValue(afterMeta),
    new_card: cloned,
  };
  maybeAttachReturnValue(payload, [], afterMeta, args);
  return buildOkResponse({
    context,
    toolCallId,
    payload,
    warnings: [],
    diffSummary,
  });
}

export async function executeToolCall({
  toolName,
  args,
  card,
  skillsRepository,
  context,
  toolCallId,
}) {
  const normalizedToolName = normalizeToolName(toolName);
  const contextCheck = ensureContext(context);
  if (!contextCheck.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: contextCheck.error,
      message: contextCheck.message,
    });
  }

  const argCheck = validateArgs(normalizedToolName, args);
  const safeArgs = argCheck.args ?? args;
  const argWarnings = Array.isArray(argCheck.warnings) ? argCheck.warnings : [];
  let result;

  switch (normalizedToolName) {
    case 'card_list_fields':
      result = await cardListFieldsTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'card_read_field':
      result = await cardReadFieldTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'card_set_field':
      result = await cardSetFieldTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'card_patch_text':
      result = await cardPatchTextTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'card_list_items':
      result = await cardListItemsTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'card_edit_items':
      result = await cardEditItemsTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'lorebook_summary':
      result = await lorebookSummaryTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'lorebook_search_entries':
      result = await lorebookSearchEntriesTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'lorebook_read_entry':
      result = await lorebookReadEntryTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'lorebook_patch_entry':
      result = await lorebookPatchEntryTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'lorebook_upsert_entry':
      result = await lorebookUpsertEntryTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'lorebook_remove_entry':
      result = await lorebookRemoveEntryTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'lorebook_reorder_entries':
      result = await lorebookReorderEntriesTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'lorebook_set_meta':
      result = await lorebookSetMetaTool({ context, toolCallId, args: safeArgs, card });
      break;
    case 'ref_list':
      result = await listRefsTool({ context, toolCallId, args: safeArgs });
      break;
    case 'ref_read':
      result = await viewRefTool({ context, toolCallId, args: safeArgs });
      break;
    case 'ref_search':
      result = await searchRefTool({ context, toolCallId, args: safeArgs });
      break;
    case 'skill_list':
      result = await listSkillsTool({
        context,
        toolCallId,
        args: safeArgs,
        skillsRepository,
      });
      break;
    case 'skill_read':
      result = await viewSkillTool({
        context,
        toolCallId,
        args: safeArgs,
        skillsRepository,
      });
      break;
    case 'skill_upsert':
      result = await saveSkillTool({
        context,
        toolCallId,
        args: safeArgs,
        skillsRepository,
      });
      break;
    case 'skill_delete':
      result = await deleteSkillTool({
        context,
        toolCallId,
        args: safeArgs,
        skillsRepository,
      });
      break;
    default:
      result = buildErrorResponse({
        context,
        toolCallId,
        code: 'E_CONSTRAINT_VIOLATION',
        message: `未知工具: ${toolName}`,
      });
      break;
  }

  if (!argWarnings.length || !result || typeof result !== 'object') {
    return result;
  }

  const existingWarnings = Array.isArray(result.warnings) ? result.warnings : [];
  return {
    ...result,
    warnings: [...argWarnings, ...existingWarnings],
  };
}

export const TOOL_LIMITS = {
  MAX_VALUE_CHARS,
  MAX_PATCH_CHARS,
};

export { getToolDefinitions };

export default {
  executeToolCall,
  getToolDefinitions,
  TOOL_LIMITS,
};
