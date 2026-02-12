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

const MAX_VALUE_CHARS = 80000;
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

const TOOL_ARG_WHITELIST = {
  list_fields: ['path', 'filters', 'include_indices'],
  view_field: ['path', 'max_chars', 'max_bytes'],
  edit_field: ['path', 'new_value', 'old_value', 'old_hash', 'return_value', 'max_chars', 'max_bytes'],
  set_field: ['path', 'value', 'old_hash', 'return_value', 'max_chars', 'max_bytes'],
  clear_field: ['path', 'mode', 'old_hash', 'return_value', 'max_chars', 'max_bytes'],
  append_entry: ['path', 'value', 'old_hash', 'return_value', 'max_chars', 'max_bytes'],
  remove_entry: ['path', 'old_hash', 'return_value', 'max_chars', 'max_bytes'],
  move_entry: ['from_path', 'to_index', 'old_hash', 'return_value', 'max_chars', 'max_bytes'],
  list_refs: ['filters'],
  view_ref: ['ref_id', 'offset', 'max_chars', 'max_bytes'],
  search_ref: ['ref_id', 'query', 'max_hits', 'snippet_chars', 'mode', 'flags'],
  list_skills: ['filters'],
  view_skill: ['skill_id'],
  save_skill: ['skill_id', 'previous_skill_id', 'description', 'content', 'references'],
  delete_skill: ['skill_id', 'delete_files'],
};

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
        code: 'W_MACRO_CHANGED',
        message: `可能丢失宏：${lostMacros.join(', ')}`,
        severity: 'warn',
      });
    }
    if (hasHtml(beforeText) && !hasHtml(afterText)) {
      warnings.push({
        code: 'W_HTML_CHANGED',
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
  let truncation;
  try {
    truncation = applyTruncate(valueResult.value, limitChars, maxBytes);
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
    arrayPath = resolved?.aliasUsed ? applyCanonicalPath(rawPath, basePath, resolved.canonicalPath) : basePath;
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
      truncated: truncation.truncated,
      returned_chars: truncation.returnedChars,
      returned_bytes: truncation.returnedBytes,
      total_chars: truncation.totalChars,
      total_bytes: truncation.totalBytes,
      array_path: arrayPath,
      array_hash: arrayHash,
      canonical_path: resolved?.aliasUsed ? effectivePath : undefined,
      alias_used: resolved?.aliasUsed || undefined,
    },
    warnings,
    diffSummary: null,
  });
}

async function editField({ context, toolCallId, args, card }) {
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

  if (!Object.prototype.hasOwnProperty.call(args || {}, 'new_value')) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: 'new_value 必填',
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
      message: '数组项不支持 edit_field',
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
  const sizeCheck = checkValueSize(args.new_value);
  if (!sizeCheck.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: sizeCheck.code,
      message: sizeCheck.message,
      path: rawPath,
    });
  }
  const typeCheck = validateValueType(args.new_value, resolved.field, allowNull);
  if (!typeCheck.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: typeCheck.code,
      message: typeCheck.message,
      path: rawPath,
    });
  }
  const constraintsCheck = validateConstraints(args.new_value, resolved.field);
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
  if (!args?.old_hash && !Object.prototype.hasOwnProperty.call(args || {}, 'old_value')) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: 'old_hash 或 old_value 至少提供一个',
      path: rawPath,
    });
  }

  let currentHash;
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
  if (Object.prototype.hasOwnProperty.call(args || {}, 'old_value')) {
    if (!valuesEqual(args.old_value, current.value)) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_CAS_MISMATCH',
        message: 'old_value 与当前值不匹配',
        path: rawPath,
      });
    }
  }

  const cloned = deepClone(card);
  const setResult = setValueByTokens(cloned, effectiveParsed.tokens, args.new_value);
  if (!setResult.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: setResult.error,
      message: setResult.message,
      path: rawPath,
    });
  }

  const newHash = await hashValue(args.new_value);
  warnings.push(...collectContentWarnings(current.value, args.new_value));
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
  const diffSummary = applyAliasSummary(
    {
      path: effectivePath,
      change_type: 'update',
      before_hash: currentHash,
      after_hash: newHash,
      before_bytes: measureValue(current.value).totalBytes,
      after_bytes: measureValue(args.new_value).totalBytes,
      delta_bytes: measureValue(args.new_value).totalBytes - measureValue(current.value).totalBytes,
    },
    resolved?.aliasUsed ? effectivePath : null,
    resolved?.aliasUsed
  );

  const payload = {
    new_hash: newHash,
    new_card: cloned,
  };
  const attach = maybeAttachReturnValue(payload, warnings, args.new_value, args);
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
      message: '数组项不支持 set_field',
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

async function clearField({ context, toolCallId, args, card }) {
  const pathResult = normalizePathInput(args?.path);
  const mode = args?.mode || 'null';
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
  if (arrayAncestor) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_PERMISSION_DENIED',
      message: '数组项不支持 clear_field',
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
    ? applyCanonicalPath(rawPath, rawPath, resolved.canonicalPath)
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

  let nextValue = null;
  if (mode === 'default') {
    if (!Object.prototype.hasOwnProperty.call(resolved.field, 'default')) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_CONSTRAINT_VIOLATION',
        message: '字段无默认值，无法使用 default 模式',
        path: rawPath,
      });
    }
    nextValue = resolved.field.default;
  } else if (mode === 'null') {
    if (!resolved.field.nullable) {
      return buildErrorResponse({
        context,
        toolCallId,
        code: 'E_CONSTRAINT_VIOLATION',
        message: '字段不可置为 null',
        path: rawPath,
      });
    }
    nextValue = null;
  } else {
    return buildErrorResponse({
      context,
      toolCallId,
      code: 'E_CONSTRAINT_VIOLATION',
      message: 'mode 仅支持 null 或 default',
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
  let currentHash;
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
  const setResult = setValueByTokens(cloned, effectiveParsed.tokens, nextValue);
  if (!setResult.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: setResult.error,
      message: setResult.message,
      path: rawPath,
    });
  }

  const newHash = await hashValue(nextValue);
  warnings.push(...collectContentWarnings(current.value, nextValue));
  const sizeCheck = checkValueSize(nextValue);
  if (!sizeCheck.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: sizeCheck.code,
      message: sizeCheck.message,
      path: rawPath,
    });
  }
  if (sizeCheck.warnings?.length) {
    warnings.push(...sizeCheck.warnings);
  }
  const constraintsCheck = validateConstraints(nextValue, resolved.field);
  if (!constraintsCheck.ok) {
    return buildErrorResponse({
      context,
      toolCallId,
      code: constraintsCheck.code,
      message: constraintsCheck.message,
      path: rawPath,
    });
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
  const attach = maybeAttachReturnValue(payload, warnings, nextValue, args);
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
        path: effectivePath,
        change_type: 'update',
        before_hash: currentHash,
        after_hash: newHash,
        before_bytes: measureValue(current.value).totalBytes,
        after_bytes: measureValue(nextValue).totalBytes,
        delta_bytes: measureValue(nextValue).totalBytes - measureValue(current.value).totalBytes,
      },
      resolved?.aliasUsed ? effectivePath : null,
      resolved?.aliasUsed
    ),
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
      message: 'append_entry 需要数组本体路径',
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
      message: 'remove_entry 需要数组项路径',
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
      message: 'move_entry 需要数组项路径',
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
    case 'list_fields':
      result = await listFields({ context, toolCallId, args: safeArgs, card });
      break;
    case 'view_field':
      result = await viewField({ context, toolCallId, args: safeArgs, card });
      break;
    case 'edit_field':
      result = await editField({ context, toolCallId, args: safeArgs, card });
      break;
    case 'set_field':
      result = await setField({ context, toolCallId, args: safeArgs, card });
      break;
    case 'clear_field':
      result = await clearField({ context, toolCallId, args: safeArgs, card });
      break;
    case 'append_entry':
      result = await appendEntry({ context, toolCallId, args: safeArgs, card });
      break;
    case 'remove_entry':
      result = await removeEntry({ context, toolCallId, args: safeArgs, card });
      break;
    case 'move_entry':
      result = await moveEntry({ context, toolCallId, args: safeArgs, card });
      break;
    case 'list_refs':
      result = await listRefsTool({ context, toolCallId, args: safeArgs });
      break;
    case 'view_ref':
      result = await viewRefTool({ context, toolCallId, args: safeArgs });
      break;
    case 'search_ref':
      result = await searchRefTool({ context, toolCallId, args: safeArgs });
      break;
    case 'list_skills':
      result = await listSkillsTool({
        context,
        toolCallId,
        args: safeArgs,
        skillsRepository,
      });
      break;
    case 'view_skill':
      result = await viewSkillTool({
        context,
        toolCallId,
        args: safeArgs,
        skillsRepository,
      });
      break;
    case 'save_skill':
      result = await saveSkillTool({
        context,
        toolCallId,
        args: safeArgs,
        skillsRepository,
      });
      break;
    case 'delete_skill':
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

export function getToolDefinitions({ includeSkillTools = false } = {}) {
  const definitions = [
    {
      name: 'list_fields',
      description: '列出字段结构与元信息，可选过滤与索引信息',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          filters: { type: 'object' },
          include_indices: { type: 'boolean' },
        },
      },
    },
    {
      name: 'view_field',
      description: '读取字段值（支持截断）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['path'],
      },
    },
    {
      name: 'edit_field',
      description: '精确替换字段值（old_value 或 old_hash）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          new_value: {},
          old_value: {},
          old_hash: { type: 'string' },
          return_value: { type: 'boolean' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['path', 'new_value'],
      },
    },
    {
      name: 'set_field',
      description: '覆盖写入字段值',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          value: {},
          old_hash: { type: 'string' },
          return_value: { type: 'boolean' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['path', 'value'],
      },
    },
    {
      name: 'clear_field',
      description: '清空字段值（null 或 default）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          mode: { type: 'string' },
          old_hash: { type: 'string' },
          return_value: { type: 'boolean' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['path'],
      },
    },
    {
      name: 'append_entry',
      description: '向数组追加元素',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          value: {},
          old_hash: { type: 'string' },
          return_value: { type: 'boolean' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['path', 'value'],
      },
    },
    {
      name: 'remove_entry',
      description: '删除数组元素',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_hash: { type: 'string' },
          return_value: { type: 'boolean' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['path'],
      },
    },
    {
      name: 'move_entry',
      description: '移动数组元素',
      parameters: {
        type: 'object',
        properties: {
          from_path: { type: 'string' },
          to_index: { type: 'number' },
          old_hash: { type: 'string' },
          return_value: { type: 'boolean' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['from_path', 'to_index'],
      },
    },
    {
      name: 'list_refs',
      description: '列出参考附件元信息',
      parameters: {
        type: 'object',
        properties: {
          filters: { type: 'object' },
        },
      },
    },
    {
      name: 'view_ref',
      description: '读取参考附件文本片段',
      parameters: {
        type: 'object',
        properties: {
          ref_id: { type: 'string' },
          offset: { type: 'number' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['ref_id'],
      },
    },
    {
      name: 'search_ref',
      description: '检索参考附件文本内容',
      parameters: {
        type: 'object',
        properties: {
          ref_id: { type: 'string' },
          query: { type: 'string' },
          max_hits: { type: 'number' },
          snippet_chars: { type: 'number' },
          mode: { type: 'string' },
          flags: { type: 'string' },
        },
        required: ['ref_id', 'query'],
      },
    },
  ];

  if (includeSkillTools) {
    definitions.push(
      {
        name: 'list_skills',
        description: '列出本地技能目录与基础元信息',
        parameters: {
          type: 'object',
          properties: {
            filters: { type: 'object' },
          },
        },
      },
      {
        name: 'view_skill',
        description: '读取单个技能内容（描述、正文与 references）',
        parameters: {
          type: 'object',
          properties: {
            skill_id: { type: 'string' },
          },
          required: ['skill_id'],
        },
      },
      {
        name: 'save_skill',
        description: '创建/更新技能；支持通过 previous_skill_id 重命名；references 仅接受 [{name, content}]',
        parameters: {
          type: 'object',
          properties: {
            skill_id: { type: 'string' },
            previous_skill_id: { type: 'string' },
            description: { type: 'string' },
            content: { type: 'string' },
            references: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  content: { type: 'string' },
                },
                required: ['name', 'content'],
              },
            },
          },
          required: ['skill_id'],
        },
      },
      {
        name: 'delete_skill',
        description: '删除技能（从目录移除并可选删除技能文件）',
        parameters: {
          type: 'object',
          properties: {
            skill_id: { type: 'string' },
            delete_files: { type: 'boolean' },
          },
          required: ['skill_id'],
        },
      },
    );
  }

  return definitions;
}

export const TOOL_LIMITS = {
  MAX_VALUE_CHARS,
  MAX_PATCH_CHARS,
};

export default {
  executeToolCall,
  getToolDefinitions,
  TOOL_LIMITS,
};
