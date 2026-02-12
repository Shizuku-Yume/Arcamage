import {
  SKILL_BASE_PUBLIC_PATH,
  SKILL_CATALOG_FILE,
  SKILL_CATALOG_MAX_CHARS,
  SKILL_MAIN_MAX_CHARS,
  SKILL_MAX_REFS_PER_SKILL,
  SKILL_REF_MAX_CHARS,
  SKILL_REFERENCE_MAX_DEPTH,
  SKILL_REPOSITORY_STORAGE_KEY,
  SKILL_REPOSITORY_STORAGE_VERSION,
  SKILL_STORAGE_KEY,
} from './skill_constants.js';
import { parseSkillCatalog, parseSkillDocument } from './skill_parser.js';
import JSZip from 'jszip';

const HTML_FALLBACK_MARKERS = ['<!doctype html', '<html', '<head', '<body'];
const SKILL_TRANSFER_MARKDOWN_MIME = 'text/markdown;charset=utf-8';
const SKILL_TRANSFER_ZIP_MIME = 'application/zip';
const SKILL_TRANSFER_ZIP_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'multipart/x-zip',
]);

let catalogCache = null;
let repositoryCache = null;
const skillBundleCache = new Map();
let fetchOverride = null;

function normalizeSkillId(skillId) {
  return String(skillId || '').trim();
}

function normalizeSelectedIds(selectedIds) {
  if (!Array.isArray(selectedIds)) return [];
  const values = selectedIds
    .map((item) => normalizeSkillId(item))
    .filter(Boolean);
  return Array.from(new Set(values));
}

function toManagerError(error, fallback) {
  const message = String(error?.message || fallback || 'Skill load failed').trim();
  return message || 'Skill load failed';
}

function buildWarning(code, message, context = null) {
  return {
    code,
    message,
    context,
  };
}

function buildIgnoredRef(path, reason, detail = null) {
  return {
    path,
    reason,
    detail,
  };
}

function isUrlPath(path) {
  return /^https?:\/\//i.test(path);
}

function normalizeBasePath(basePath) {
  const raw = String(basePath || '').trim();
  if (!raw || raw === '/') return '';
  const cleaned = raw.replace(/^\/+|\/+$/g, '');
  return cleaned ? `/${cleaned}` : '';
}

function quoteFrontmatterValue(value) {
  const text = String(value || '').trim();
  if (!text) return '""';
  if (/[:#[\]{},]|^\s|\s$/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function normalizeImportedSkillId(rawValue) {
  const normalized = normalizeSkillId(rawValue)
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized;
}

function sanitizeTransferFileName(rawValue, fallback = 'skill') {
  const normalized = String(rawValue || '')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

function deriveDescriptionFromBody(body, skillId) {
  const lines = String(body || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'));
  if (lines.length > 0) {
    return lines[0].slice(0, 220);
  }
  const fallbackId = normalizeImportedSkillId(skillId || 'skill') || 'skill';
  return `Imported skill: ${fallbackId}`;
}

function serializeSkillDocumentMarkdown({ name, description, content, references }) {
  const normalizedName = String(name || '').trim();
  const normalizedDescription = String(description || '').trim();
  const normalizedBody = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const normalizedRefs = Array.from(new Set(
    (Array.isArray(references) ? references : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  ));

  const lines = [
    '---',
    `name: ${quoteFrontmatterValue(normalizedName)}`,
    `description: ${quoteFrontmatterValue(normalizedDescription)}`,
  ];

  if (normalizedRefs.length > 0) {
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

function getRuntimeBasePath() {
  const base = typeof import.meta !== 'undefined' ? import.meta.env?.BASE_URL : '/';
  return normalizeBasePath(base || '/');
}

function tokenizeRelativePath(rawPath, { allowCurrentDir = false } = {}) {
  const raw = String(rawPath || '').trim().replace(/\\/g, '/');
  if (!raw) {
    throw new Error('Empty path');
  }
  if (isUrlPath(raw)) {
    throw new Error('Remote URL is not allowed');
  }
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) {
    throw new Error('Absolute path is not allowed');
  }
  if (raw.includes('?') || raw.includes('#')) {
    throw new Error('Query/hash path is not allowed');
  }

  const segments = [];
  raw.split('/').forEach((segment) => {
    const value = segment.trim();
    if (!value) return;
    if (value === '.') {
      if (allowCurrentDir) return;
      throw new Error('Path segment "." is not allowed');
    }
    if (value === '..') {
      throw new Error('Path traversal is not allowed');
    }
    segments.push(value);
  });

  if (segments.length === 0) {
    throw new Error('Empty path segments');
  }
  return segments;
}

function ensureMarkdownPath(path) {
  if (!/\.md$/i.test(path)) {
    throw new Error('Only .md files are allowed');
  }
  return path;
}

function normalizeCatalogSkillPath(skillPath) {
  const segments = tokenizeRelativePath(skillPath, { allowCurrentDir: false });
  const normalized = segments.join('/');
  return ensureMarkdownPath(normalized);
}

function resolveReferenceSkillPath(skillPath, referencePath) {
  const skillSegments = tokenizeRelativePath(skillPath, { allowCurrentDir: false });
  const refSegments = tokenizeRelativePath(referencePath, { allowCurrentDir: true });
  const base = skillSegments.slice(0, -1);
  const merged = [...base, ...refSegments];
  const normalized = merged.join('/');
  return ensureMarkdownPath(normalized);
}

function normalizeTransferReferencePath(referencePath) {
  const segments = tokenizeRelativePath(referencePath, { allowCurrentDir: true });
  const normalized = segments.join('/');
  return ensureMarkdownPath(normalized);
}

function normalizeZipEntryPath(rawPath) {
  const normalized = String(rawPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .trim();
  return normalized;
}

function detectSkillTransferFormat(fileLike) {
  const fileName = String(fileLike?.name || '').trim();
  const fileType = String(fileLike?.type || '').trim().toLowerCase();
  if (/\.zip$/i.test(fileName) || SKILL_TRANSFER_ZIP_MIME_TYPES.has(fileType)) {
    return 'zip';
  }
  if (/\.md$/i.test(fileName) || fileType === 'text/markdown' || fileType === SKILL_TRANSFER_MARKDOWN_MIME) {
    return 'markdown';
  }
  return '';
}

function readWithFileReader(fileLike, mode) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader is unavailable in current environment'));
      return;
    }
    try {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read file content'));
      reader.onload = () => resolve(reader.result);
      if (mode === 'arrayBuffer') {
        reader.readAsArrayBuffer(fileLike);
        return;
      }
      reader.readAsText(fileLike);
    } catch (error) {
      reject(error);
    }
  });
}

async function readFileLikeText(fileLike) {
  if (!fileLike) {
    throw new Error('Missing file');
  }
  if (typeof fileLike.text === 'function') {
    return fileLike.text();
  }
  const result = await readWithFileReader(fileLike, 'text');
  return String(result || '');
}

async function readFileLikeArrayBuffer(fileLike) {
  if (!fileLike) {
    throw new Error('Missing file');
  }
  if (typeof fileLike.arrayBuffer === 'function') {
    return fileLike.arrayBuffer();
  }
  const result = await readWithFileReader(fileLike, 'arrayBuffer');
  if (result instanceof ArrayBuffer) {
    return result;
  }
  if (ArrayBuffer.isView(result)) {
    return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
  }
  throw new Error('Failed to read binary file content');
}

function getFetcher() {
  if (typeof fetchOverride === 'function') return fetchOverride;
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  throw new Error('fetch is unavailable in current environment');
}

function truncateText(text, maxChars) {
  const value = String(text || '');
  if (!Number.isFinite(maxChars) || maxChars <= 0 || value.length <= maxChars) {
    return {
      text: value,
      truncated: false,
      originalChars: value.length,
      usedChars: value.length,
    };
  }
  const truncatedText = value.slice(0, maxChars);
  return {
    text: truncatedText,
    truncated: true,
    originalChars: value.length,
    usedChars: truncatedText.length,
  };
}

function buildSkillAssetUrl(relativePath) {
  const safePath = normalizeCatalogSkillPath(relativePath);
  const basePath = getRuntimeBasePath();
  const root = `${basePath}${SKILL_BASE_PUBLIC_PATH}`;
  return `${root}/${safePath}`;
}

function looksLikeHtmlFallback(text) {
  const sample = String(text || '').slice(0, 800).toLowerCase();
  return HTML_FALLBACK_MARKERS.every((marker) => sample.includes(marker));
}

async function fetchStaticMarkdownByRelativePath(relativePath, { maxChars = null } = {}) {
  const fetcher = getFetcher();
  const safePath = normalizeCatalogSkillPath(relativePath);
  const url = buildSkillAssetUrl(safePath);

  const response = await fetcher(url);
  if (!response?.ok) {
    const status = response?.status;
    throw new Error(`Unable to load ${safePath}${status ? ` (HTTP ${status})` : ''}`);
  }

  if (typeof response.text !== 'function') {
    throw new Error('Invalid response object for markdown file');
  }

  const text = await response.text();
  if (looksLikeHtmlFallback(text)) {
    throw new Error(`Expected markdown but received HTML fallback for ${safePath}`);
  }
  const trimmed = truncateText(text, maxChars);
  return {
    path: safePath,
    url,
    ...trimmed,
  };
}

function createEmptyRepositoryState() {
  return {
    version: SKILL_REPOSITORY_STORAGE_VERSION,
    catalog: [],
    files: {
      [SKILL_CATALOG_FILE]: serializeCatalogMarkdown([]),
    },
  };
}

function cloneRepositoryState(state) {
  if (!state || typeof state !== 'object') {
    return createEmptyRepositoryState();
  }
  const files = {};
  const inputFiles = state.files && typeof state.files === 'object' ? state.files : {};
  Object.keys(inputFiles).forEach((path) => {
    files[path] = String(inputFiles[path] || '');
  });
  const catalog = Array.isArray(state.catalog)
    ? state.catalog.map((entry) => ({
      id: String(entry.id || ''),
      description: String(entry.description || ''),
      path: String(entry.path || ''),
      tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
    }))
    : [];
  return {
    version: SKILL_REPOSITORY_STORAGE_VERSION,
    catalog,
    files,
  };
}

export function cloneSkillRepositoryState(state) {
  return cloneRepositoryState(state);
}

export function buildDefaultSkillMarkdown({ name, description } = {}) {
  const safeName = String(name || '').trim() || 'New Skill';
  const safeDescription = String(description || '').trim() || 'Describe what this skill should do.';
  return `---
name: ${safeName}
description: ${safeDescription}
references:
  - references/example.md
---

## When to use

- Describe when this skill should be applied.

## Must do

- List required behaviors.

## Must not do

- List forbidden behaviors.

## Examples

- Add practical examples.
`;
}

function normalizeCatalogEntry(entry) {
  const item = entry && typeof entry === 'object' ? entry : {};
  const id = normalizeSkillId(item.id);
  const description = String(item.description || '').trim();
  const path = normalizeCatalogSkillPath(item.path || `${id}/SKILL.md`);
  const tags = Array.isArray(item.tags)
    ? item.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];

  if (!id || !description) {
    return null;
  }

  return {
    id,
    description,
    path,
    tags,
  };
}

function parseCatalogFromContent(content) {
  const parsed = parseSkillCatalog(String(content || ''));
  const warnings = [...(parsed.warnings || [])];
  const catalog = [];
  const seen = new Set();

  parsed.entries.forEach((entry) => {
    try {
      const normalized = normalizeCatalogEntry(entry);
      if (!normalized) return;
      if (seen.has(normalized.id)) {
        warnings.push(buildWarning('W_SKILL_CATALOG_DUPLICATE', `Duplicate skill id ignored: ${normalized.id}`));
        return;
      }
      seen.add(normalized.id);
      catalog.push(normalized);
    } catch (error) {
      warnings.push(buildWarning(
        'W_SKILL_CATALOG_PATH_INVALID',
        `Ignored invalid skill path for ${entry?.id || ''}`,
        { id: entry?.id || '', path: entry?.path || '', reason: toManagerError(error) },
      ));
    }
  });

  return { catalog, warnings };
}

function serializeCatalogMarkdown(entries) {
  const lines = [
    '---',
    'name: Arcamage Skill Catalog',
    'description: Frontend local markdown skill catalog.',
    '---',
    '',
  ];

  (entries || []).forEach((entry) => {
    const item = normalizeCatalogEntry(entry);
    if (!item) return;
    lines.push(`- id: ${item.id}`);
    lines.push(`  description: ${item.description}`);
    lines.push(`  path: ${item.path}`);
    lines.push(`  tags: [${item.tags.join(', ')}]`);
    lines.push('');
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

function loadRepositoryFromLocalStorage() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SKILL_REPOSITORY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const catalog = [];
    const seen = new Set();
    let invalidCatalogEntryCount = 0;
    let firstCatalogError = null;
    (Array.isArray(parsed.catalog) ? parsed.catalog : []).forEach((entry) => {
      try {
        const normalized = normalizeCatalogEntry(entry);
        if (!normalized || seen.has(normalized.id)) return;
        seen.add(normalized.id);
        catalog.push(normalized);
      } catch (error) {
        invalidCatalogEntryCount += 1;
        if (!firstCatalogError) {
          firstCatalogError = error;
        }
      }
    });
    if (invalidCatalogEntryCount > 0) {
      console.warn(
        `[skill_manager] Ignored ${invalidCatalogEntryCount} invalid catalog entr${invalidCatalogEntryCount > 1 ? 'ies' : 'y'} from localStorage`,
        firstCatalogError,
      );
    }

    const files = {};
    const inputFiles = parsed.files && typeof parsed.files === 'object' ? parsed.files : {};
    let invalidFilePathCount = 0;
    let firstPathError = null;
    Object.keys(inputFiles).forEach((rawPath) => {
      try {
        const normalizedPath = normalizeCatalogSkillPath(rawPath);
        files[normalizedPath] = String(inputFiles[rawPath] || '');
      } catch (error) {
        invalidFilePathCount += 1;
        if (!firstPathError) {
          firstPathError = error;
        }
      }
    });
    if (invalidFilePathCount > 0) {
      console.warn(
        `[skill_manager] Ignored ${invalidFilePathCount} invalid skill file path${invalidFilePathCount > 1 ? 's' : ''} from localStorage`,
        firstPathError,
      );
    }

    if (!files[SKILL_CATALOG_FILE]) {
      files[SKILL_CATALOG_FILE] = serializeCatalogMarkdown(catalog);
    }

    catalog.forEach((entry) => {
      if (!files[entry.path]) {
        files[entry.path] = buildDefaultSkillMarkdown({
          name: entry.id,
          description: entry.description,
        });
      }
    });

    return {
      version: SKILL_REPOSITORY_STORAGE_VERSION,
      catalog,
      files,
    };
  } catch (error) {
    console.warn('Failed to load skill repository:', error);
    return null;
  }
}

function saveRepositoryToLocalStorage(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SKILL_REPOSITORY_STORAGE_KEY, JSON.stringify({
      version: SKILL_REPOSITORY_STORAGE_VERSION,
      catalog: Array.isArray(state.catalog) ? state.catalog : [],
      files: state.files && typeof state.files === 'object' ? state.files : {},
    }));
  } catch (error) {
    console.warn('Failed to save skill repository:', error);
  }
}

function clearTransientCaches() {
  catalogCache = null;
  skillBundleCache.clear();
}

function applyCatalogToRepository(state, catalog) {
  const nextState = cloneRepositoryState(state);
  nextState.catalog = Array.isArray(catalog) ? catalog.map((item) => ({ ...item })) : [];
  nextState.files[SKILL_CATALOG_FILE] = serializeCatalogMarkdown(nextState.catalog);
  nextState.catalog.forEach((entry) => {
    if (!nextState.files[entry.path]) {
      nextState.files[entry.path] = buildDefaultSkillMarkdown({
        name: entry.id,
        description: entry.description,
      });
    }
  });
  return nextState;
}

function ensureReferencePlaceholders(state, skillPath, skillContent) {
  const nextState = cloneRepositoryState(state);
  const parsedSkill = parseSkillDocument(skillContent);
  const refs = Array.isArray(parsedSkill.references) ? parsedSkill.references : [];
  refs.forEach((refPath) => {
    try {
      const resolved = resolveReferenceSkillPath(skillPath, refPath);
      if (!nextState.files[resolved]) {
        nextState.files[resolved] = `# ${resolved}\n\n`;
      }
    } catch {
      // ignore invalid reference path
    }
  });
  return nextState;
}

async function bootstrapRepositoryFromStatic() {
  const warnings = [];
  try {
    const catalogFile = await fetchStaticMarkdownByRelativePath(SKILL_CATALOG_FILE, {
      maxChars: SKILL_CATALOG_MAX_CHARS,
    });
    const parsedCatalog = parseCatalogFromContent(catalogFile.text);
    warnings.push(...parsedCatalog.warnings);

    let state = createEmptyRepositoryState();
    state.files[SKILL_CATALOG_FILE] = catalogFile.text;
    state.catalog = parsedCatalog.catalog;

    for (let index = 0; index < state.catalog.length; index += 1) {
      const entry = state.catalog[index];
      try {
        const skillFile = await fetchStaticMarkdownByRelativePath(entry.path);
        state.files[entry.path] = skillFile.text;

        const parsedSkill = parseSkillDocument(skillFile.text);
        const refs = Array.isArray(parsedSkill.references) ? parsedSkill.references : [];
        for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
          const rawRef = refs[refIndex];
          try {
            const resolvedRef = resolveReferenceSkillPath(entry.path, rawRef);
            if (state.files[resolvedRef]) continue;
            const refFile = await fetchStaticMarkdownByRelativePath(resolvedRef);
            state.files[resolvedRef] = refFile.text;
          } catch (error) {
            warnings.push(buildWarning(
              'W_SKILL_REF_BOOTSTRAP_FAILED',
              `Failed to bootstrap reference: ${rawRef}`,
              { skillId: entry.id, reason: toManagerError(error) },
            ));
          }
        }
      } catch (error) {
        warnings.push(buildWarning(
          'W_SKILL_BOOTSTRAP_FAILED',
          `Failed to bootstrap skill file: ${entry.path}`,
          { skillId: entry.id, reason: toManagerError(error) },
        ));
      }
    }

    state = applyCatalogToRepository(state, state.catalog);
    if (state.catalog.length === 0) {
      warnings.push(buildWarning('W_SKILL_CATALOG_EMPTY', 'No skill entry found during bootstrap'));
    }

    return {
      state,
      warnings,
      error: null,
    };
  } catch (error) {
    return {
      state: createEmptyRepositoryState(),
      warnings,
      error: toManagerError(error, 'Failed to bootstrap local skills from static bundle'),
    };
  }
}

async function ensureRepositoryState({ forceReload = false, forceBootstrap = false } = {}) {
  if (repositoryCache && !forceReload && !forceBootstrap) {
    return {
      state: cloneRepositoryState(repositoryCache),
      warnings: [],
      error: null,
    };
  }

  if (!forceBootstrap) {
    const stored = loadRepositoryFromLocalStorage();
    if (stored) {
      repositoryCache = stored;
      return {
        state: cloneRepositoryState(stored),
        warnings: [],
        error: null,
      };
    }
  }

  const bootstrapped = await bootstrapRepositoryFromStatic();
  repositoryCache = cloneRepositoryState(bootstrapped.state);
  saveRepositoryToLocalStorage(repositoryCache);
  return {
    state: cloneRepositoryState(repositoryCache),
    warnings: [...(bootstrapped.warnings || [])],
    error: bootstrapped.error || null,
  };
}

export async function exportSkillRepositoryState({ forceRefresh = false } = {}) {
  const repositoryResult = await ensureRepositoryState({ forceReload: forceRefresh });
  return cloneRepositoryState(repositoryResult.state);
}

function normalizeImportedRepositoryState(state) {
  const input = state && typeof state === 'object' ? state : null;
  if (!input) {
    throw new Error('Skill repository snapshot is required');
  }

  const catalog = [];
  const seen = new Set();
  const rawCatalog = Array.isArray(input.catalog) ? input.catalog : [];
  rawCatalog.forEach((entry) => {
    const normalized = normalizeCatalogEntry(entry);
    if (!normalized) {
      throw new Error('Skill repository snapshot contains invalid catalog entry');
    }
    if (seen.has(normalized.id)) {
      throw new Error(`Duplicate skill id in snapshot: ${normalized.id}`);
    }
    seen.add(normalized.id);
    catalog.push(normalized);
  });

  const files = {};
  const rawFiles = input.files && typeof input.files === 'object' ? input.files : {};
  Object.keys(rawFiles).forEach((rawPath) => {
    const normalizedPath = normalizeCatalogSkillPath(rawPath);
    files[normalizedPath] = String(rawFiles[rawPath] || '');
  });

  const baseState = {
    version: SKILL_REPOSITORY_STORAGE_VERSION,
    catalog,
    files,
  };

  return applyCatalogToRepository(baseState, catalog);
}

export function importSkillRepositoryState(state) {
  const normalized = normalizeImportedRepositoryState(state);
  const nextState = cloneRepositoryState(normalized);
  repositoryCache = nextState;
  saveRepositoryToLocalStorage(repositoryCache);
  clearTransientCaches();
  return cloneRepositoryState(repositoryCache);
}

function cloneBundle(bundle) {
  if (!bundle) return null;
  return {
    skill: bundle.skill ? { ...bundle.skill } : null,
    references: Array.isArray(bundle.references)
      ? bundle.references.map((item) => ({ ...item }))
      : [],
    ignored: Array.isArray(bundle.ignored)
      ? bundle.ignored.map((item) => ({ ...item }))
      : [],
    warnings: Array.isArray(bundle.warnings)
      ? bundle.warnings.map((item) => ({ ...item }))
      : [],
    error: bundle.error || null,
  };
}

function loadReferencesForSkillFromRepository({ repositoryState, skillPath, references, maxRefs, maxChars, maxDepth }) {
  const loaded = [];
  const ignored = [];
  const warnings = [];
  const visited = new Set();

  if (!Array.isArray(references) || references.length === 0) {
    return { loaded, ignored, warnings };
  }
  if (maxDepth < 1) {
    references.forEach((path) => {
      ignored.push(buildIgnoredRef(path, 'depth_limit', 'Reference depth exceeds limit'));
    });
    return { loaded, ignored, warnings };
  }

  for (let index = 0; index < references.length; index += 1) {
    const rawPath = String(references[index] || '').trim();
    if (!rawPath) continue;

    if (loaded.length >= maxRefs) {
      ignored.push(buildIgnoredRef(rawPath, 'ref_limit', 'Exceeded per-skill reference limit'));
      continue;
    }

    let resolvedPath = '';
    try {
      resolvedPath = resolveReferenceSkillPath(skillPath, rawPath);
    } catch (error) {
      ignored.push(buildIgnoredRef(rawPath, 'invalid_reference_path', toManagerError(error)));
      continue;
    }

    if (visited.has(resolvedPath)) {
      ignored.push(buildIgnoredRef(rawPath, 'duplicate_reference', 'Reference already loaded'));
      continue;
    }
    visited.add(resolvedPath);

    const content = repositoryState.files?.[resolvedPath];
    if (typeof content !== 'string') {
      ignored.push(buildIgnoredRef(rawPath, 'reference_not_found', `Reference not found: ${resolvedPath}`));
      continue;
    }

    const clipped = truncateText(content, maxChars);
    loaded.push({
      path: resolvedPath,
      content: clipped.text,
      truncated: clipped.truncated,
      originalChars: clipped.originalChars,
      usedChars: clipped.usedChars,
    });
    if (clipped.truncated) {
      warnings.push(buildWarning('W_SKILL_REF_TRUNCATED', `Reference truncated: ${resolvedPath}`, { path: resolvedPath }));
    }
  }

  return { loaded, ignored, warnings };
}

async function parseSkillTransferMarkdownFile(fileLike) {
  if (!fileLike) {
    throw new Error('Invalid markdown file');
  }

  const fileName = String(fileLike.name || '').trim();
  const baseName = fileName.replace(/\.md$/i, '').trim();
  const markdown = await readFileLikeText(fileLike);
  const parsed = parseSkillDocument(markdown);

  const skillId = normalizeImportedSkillId(parsed.name || '')
    || normalizeImportedSkillId(baseName === 'SKILL' ? '' : baseName);
  if (!skillId) {
    throw new Error('Unable to resolve skill id from markdown file');
  }

  const body = String(parsed.body || '').trim();
  const description = String(parsed.description || '').trim() || deriveDescriptionFromBody(body, skillId);
  const name = String(parsed.name || '').trim() || skillId;

  return {
    format: 'markdown',
    skillId,
    name,
    description,
    body,
    referenceFiles: [],
  };
}

async function parseSkillTransferZipFile(fileLike) {
  if (!fileLike) {
    throw new Error('Invalid zip file');
  }

  const zipBuffer = await readFileLikeArrayBuffer(fileLike);
  const zip = await JSZip.loadAsync(zipBuffer);
  const allEntries = Object.values(zip.files || {}).filter((entry) => entry && !entry.dir);
  const skillEntries = allEntries.filter((entry) => /(^|\/)SKILL\.md$/i.test(normalizeZipEntryPath(entry.name)));
  if (skillEntries.length === 0) {
    throw new Error('Zip package does not contain SKILL.md');
  }

  const sortedSkills = [...skillEntries].sort((left, right) => {
    const leftDepth = normalizeZipEntryPath(left.name).split('/').filter(Boolean).length;
    const rightDepth = normalizeZipEntryPath(right.name).split('/').filter(Boolean).length;
    return leftDepth - rightDepth;
  });
  const selectedSkill = sortedSkills[0];
  const selectedDepth = normalizeZipEntryPath(selectedSkill.name).split('/').filter(Boolean).length;
  const sameDepth = sortedSkills.filter((entry) => (
    normalizeZipEntryPath(entry.name).split('/').filter(Boolean).length === selectedDepth
  ));
  if (sameDepth.length > 1) {
    throw new Error('Zip package contains multiple SKILL.md files');
  }

  const skillEntryPath = normalizeZipEntryPath(selectedSkill.name);
  const skillRoot = skillEntryPath.replace(/(^|\/)SKILL\.md$/i, '').replace(/\/+$/g, '');
  const rootPrefix = skillRoot ? `${skillRoot}/` : '';

  const skillMarkdown = await selectedSkill.async('string');
  const parsed = parseSkillDocument(skillMarkdown);
  const rootSegments = skillRoot ? skillRoot.split('/').filter(Boolean) : [];
  const rootSkillId = normalizeImportedSkillId(rootSegments[rootSegments.length - 1] || '');
  const skillId = rootSkillId || normalizeImportedSkillId(parsed.name || '');
  if (!skillId) {
    throw new Error('Unable to resolve skill id from zip package');
  }

  const body = String(parsed.body || '').trim();
  const description = String(parsed.description || '').trim() || deriveDescriptionFromBody(body, skillId);
  const name = String(parsed.name || '').trim() || skillId;

  const referenceFiles = [];
  const seenRefPath = new Set();
  const appendReference = (relativePath, content) => {
    if (seenRefPath.has(relativePath)) return;
    seenRefPath.add(relativePath);
    referenceFiles.push({
      path: relativePath,
      content: String(content || ''),
    });
  };

  const declaredRefs = Array.isArray(parsed.references) ? parsed.references : [];
  for (let index = 0; index < declaredRefs.length; index += 1) {
    const rawRefPath = declaredRefs[index];
    let normalizedRefPath = '';
    try {
      normalizedRefPath = normalizeTransferReferencePath(rawRefPath);
    } catch {
      continue;
    }
    const zipPath = `${rootPrefix}${normalizedRefPath}`;
    const refEntry = zip.file(zipPath);
    if (!refEntry || refEntry.dir) continue;
    const refContent = await refEntry.async('string');
    appendReference(normalizedRefPath, refContent);
  }

  for (let index = 0; index < allEntries.length; index += 1) {
    const entry = allEntries[index];
    const entryPath = normalizeZipEntryPath(entry.name);
    if (!entryPath || entryPath === skillEntryPath) continue;
    if (!/\.md$/i.test(entryPath)) continue;
    if (rootPrefix && !entryPath.startsWith(rootPrefix)) continue;

    const relativePath = rootPrefix ? entryPath.slice(rootPrefix.length) : entryPath;
    if (!relativePath || /^SKILL\.md$/i.test(relativePath)) continue;
    if (!/^references\//i.test(relativePath)) continue;

    let normalizedRefPath = '';
    try {
      normalizedRefPath = normalizeTransferReferencePath(relativePath);
    } catch {
      continue;
    }

    const refContent = await entry.async('string');
    appendReference(normalizedRefPath, refContent);
  }

  return {
    format: 'zip',
    skillId,
    name,
    description,
    body,
    referenceFiles,
  };
}

function normalizeSkillTransferPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const skillId = normalizeImportedSkillId(source.skillId || '');
  if (!skillId) {
    throw new Error('Skill id is required for import');
  }

  const skillPath = normalizeCatalogSkillPath(`${skillId}/SKILL.md`);
  const body = String(source.body || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const name = String(source.name || '').trim() || skillId;
  const description = String(source.description || '').trim() || deriveDescriptionFromBody(body, skillId);

  const references = [];
  const referenceFiles = [];
  const seen = new Set();
  const inputRefFiles = Array.isArray(source.referenceFiles) ? source.referenceFiles : [];
  inputRefFiles.forEach((item) => {
    try {
      const relativePath = normalizeTransferReferencePath(item?.path || '');
      if (seen.has(relativePath)) return;
      seen.add(relativePath);
      references.push(relativePath);
      referenceFiles.push({
        path: relativePath,
        content: String(item?.content || ''),
      });
    } catch {
      // ignore invalid reference path
    }
  });

  const skillMarkdown = serializeSkillDocumentMarkdown({
    name,
    description,
    content: body,
    references,
  });

  return {
    format: source.format || 'markdown',
    skillId,
    skillPath,
    name,
    description,
    body,
    references,
    referenceFiles,
    skillMarkdown,
  };
}

async function applyImportedSkillTransfer(payload) {
  const normalized = normalizeSkillTransferPayload(payload);
  const repositoryResult = await ensureRepositoryState();
  let nextState = cloneRepositoryState(repositoryResult.state);

  const existingIndex = (nextState.catalog || []).findIndex((entry) => entry.id === normalized.skillId);
  const existingEntry = existingIndex >= 0 ? nextState.catalog[existingIndex] : null;
  const nextEntry = normalizeCatalogEntry({
    id: normalized.skillId,
    description: normalized.description,
    path: normalized.skillPath,
    tags: Array.isArray(existingEntry?.tags) ? existingEntry.tags : [],
  });
  if (!nextEntry) {
    throw new Error(`Failed to normalize imported skill entry: ${normalized.skillId}`);
  }

  if (existingIndex >= 0) {
    nextState.catalog.splice(existingIndex, 1, nextEntry);
  } else {
    nextState.catalog.push(nextEntry);
  }

  nextState.files[normalized.skillPath] = normalized.skillMarkdown;
  const expectedFiles = new Set([normalized.skillPath]);
  normalized.referenceFiles.forEach((item) => {
    const resolvedPath = resolveReferenceSkillPath(normalized.skillPath, item.path);
    expectedFiles.add(resolvedPath);
    nextState.files[resolvedPath] = String(item.content || '');
  });

  Object.keys(nextState.files || {}).forEach((path) => {
    if (!path.startsWith(`${normalized.skillId}/`)) return;
    if (expectedFiles.has(path)) return;
    delete nextState.files[path];
  });

  nextState = applyCatalogToRepository(nextState, nextState.catalog);

  repositoryCache = cloneRepositoryState(nextState);
  saveRepositoryToLocalStorage(repositoryCache);
  clearTransientCaches();

  return {
    skillId: normalized.skillId,
    referencesCount: normalized.referenceFiles.length,
    replaced: existingIndex >= 0,
    format: normalized.format,
  };
}

export async function exportSkillTransferFile(skillId, { forceRefresh = false } = {}) {
  const normalizedId = normalizeImportedSkillId(skillId);
  if (!normalizedId) {
    throw new Error('Skill id is required for export');
  }

  const repositoryResult = await ensureRepositoryState({ forceReload: forceRefresh });
  const repositoryState = repositoryResult.state || createEmptyRepositoryState();
  const entry = (repositoryState.catalog || []).find((item) => item.id === normalizedId);
  if (!entry) {
    throw new Error(`Skill not found: ${normalizedId}`);
  }

  const skillPath = normalizeCatalogSkillPath(entry.path || `${entry.id}/SKILL.md`);
  const skillContent = repositoryState.files?.[skillPath];
  if (typeof skillContent !== 'string') {
    throw new Error(`Skill file missing: ${skillPath}`);
  }

  const parsed = parseSkillDocument(skillContent);
  const references = [];
  const seenRefs = new Set();

  const appendReference = (relativePath, content) => {
    if (seenRefs.has(relativePath)) return;
    seenRefs.add(relativePath);
    references.push({
      path: relativePath,
      content: String(content || ''),
    });
  };

  const declaredRefs = Array.isArray(parsed.references) ? parsed.references : [];
  for (let index = 0; index < declaredRefs.length; index += 1) {
    const rawRef = declaredRefs[index];
    let normalizedRefPath = '';
    let resolvedRefPath = '';
    try {
      normalizedRefPath = normalizeTransferReferencePath(rawRef);
      resolvedRefPath = resolveReferenceSkillPath(skillPath, normalizedRefPath);
    } catch {
      continue;
    }
    const content = repositoryState.files?.[resolvedRefPath];
    if (typeof content !== 'string') continue;
    appendReference(normalizedRefPath, content);
  }

  if (references.length === 0) {
    Object.keys(repositoryState.files || {}).forEach((path) => {
      if (!path.startsWith(`${entry.id}/references/`)) return;
      if (!/\.md$/i.test(path)) return;
      const content = repositoryState.files[path];
      if (typeof content !== 'string') return;
      const relativePath = path.slice(`${entry.id}/`.length);
      appendReference(relativePath, content);
    });
  }

  const safeFileName = sanitizeTransferFileName(entry.id || normalizedId, 'skill');
  if (references.length === 0) {
    return {
      format: 'markdown',
      skillId: entry.id || normalizedId,
      referencesCount: 0,
      fileName: `${safeFileName}.md`,
      mimeType: SKILL_TRANSFER_MARKDOWN_MIME,
      blob: new Blob([skillContent], { type: SKILL_TRANSFER_MARKDOWN_MIME }),
    };
  }

  const zip = new JSZip();
  zip.file(`${safeFileName}/SKILL.md`, skillContent);
  references.forEach((item) => {
    zip.file(`${safeFileName}/${item.path}`, item.content);
  });

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const blob = new Blob([zipBytes], { type: SKILL_TRANSFER_ZIP_MIME });
  return {
    format: 'zip',
    skillId: entry.id || normalizedId,
    referencesCount: references.length,
    fileName: `${safeFileName}.zip`,
    mimeType: SKILL_TRANSFER_ZIP_MIME,
    blob,
  };
}

export async function importSkillTransferFile(fileLike) {
  if (!fileLike) {
    throw new Error('Skill transfer file is required');
  }

  const format = detectSkillTransferFormat(fileLike);
  if (!format) {
    throw new Error('Only .md and .zip files are supported');
  }

  const payload = format === 'zip'
    ? await parseSkillTransferZipFile(fileLike)
    : await parseSkillTransferMarkdownFile(fileLike);

  return applyImportedSkillTransfer(payload);
}

export function setSkillFetcher(fetcher) {
  fetchOverride = typeof fetcher === 'function' ? fetcher : null;
}

export function resetSkillManagerCache() {
  repositoryCache = null;
  clearTransientCaches();
}

export function loadSkillPreferenceState() {
  try {
    const raw = localStorage.getItem(SKILL_STORAGE_KEY);
    if (!raw) {
      return {
        enabled: true,
        selectedIds: [],
      };
    }
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed?.enabled !== false,
      selectedIds: normalizeSelectedIds(parsed?.selectedIds),
    };
  } catch (error) {
    console.warn('Failed to load skill preferences:', error);
    return {
      enabled: true,
      selectedIds: [],
    };
  }
}

export function saveSkillPreferenceState({ enabled, selectedIds }) {
  try {
    localStorage.setItem(SKILL_STORAGE_KEY, JSON.stringify({
      enabled: enabled !== false,
      selectedIds: normalizeSelectedIds(selectedIds),
    }));
  } catch (error) {
    console.warn('Failed to save skill preferences:', error);
  }
}

export async function loadSkillCatalog({ forceRefresh = false } = {}) {
  if (catalogCache && !forceRefresh) {
    return {
      catalog: [...catalogCache.catalog],
      warnings: [...catalogCache.warnings],
      error: catalogCache.error,
    };
  }

  const repositoryResult = await ensureRepositoryState({ forceReload: forceRefresh });
  const catalog = Array.isArray(repositoryResult.state?.catalog)
    ? repositoryResult.state.catalog.map((entry) => ({ ...entry }))
    : [];
  const warnings = Array.isArray(repositoryResult.warnings) ? [...repositoryResult.warnings] : [];

  const error = repositoryResult.error
    || (catalog.length === 0 ? 'Skill catalog is empty. Please add skills in local editor.' : null);

  catalogCache = {
    catalog,
    warnings,
    error,
  };

  return {
    catalog: [...catalog],
    warnings,
    error,
  };
}

export async function loadSkillBundle(skillId, options = {}) {
  const normalizedId = normalizeSkillId(skillId);
  if (!normalizedId) {
    return {
      skill: null,
      references: [],
      ignored: [],
      warnings: [],
      error: 'Missing skill id',
    };
  }

  const maxMainChars = Number.isFinite(options.maxMainChars) ? options.maxMainChars : SKILL_MAIN_MAX_CHARS;
  const maxRefChars = Number.isFinite(options.maxRefChars) ? options.maxRefChars : SKILL_REF_MAX_CHARS;
  const maxRefsPerSkill = Number.isFinite(options.maxRefsPerSkill)
    ? options.maxRefsPerSkill
    : SKILL_MAX_REFS_PER_SKILL;
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : SKILL_REFERENCE_MAX_DEPTH;

  const cacheKey = `${normalizedId}::${maxMainChars}::${maxRefChars}::${maxRefsPerSkill}::${maxDepth}`;
  if (skillBundleCache.has(cacheKey)) {
    return cloneBundle(skillBundleCache.get(cacheKey));
  }

  const repositoryResult = await ensureRepositoryState();
  if (repositoryResult.error && !(repositoryResult.state?.catalog?.length)) {
    return {
      skill: null,
      references: [],
      ignored: [],
      warnings: [],
      error: repositoryResult.error,
    };
  }

  const repositoryState = repositoryResult.state || createEmptyRepositoryState();
  const entry = (repositoryState.catalog || []).find((item) => item.id === normalizedId);
  if (!entry) {
    return {
      skill: null,
      references: [],
      ignored: [],
      warnings: [],
      error: `Skill not found: ${normalizedId}`,
    };
  }

  const skillContent = repositoryState.files?.[entry.path];
  if (typeof skillContent !== 'string') {
    return {
      skill: null,
      references: [],
      ignored: [],
      warnings: [],
      error: `Skill file missing: ${entry.path}`,
    };
  }

  try {
    const parsedSkill = parseSkillDocument(skillContent);
    const mainContent = truncateText(parsedSkill.body || '', maxMainChars);
    const references = loadReferencesForSkillFromRepository({
      repositoryState,
      skillPath: entry.path,
      references: parsedSkill.references,
      maxRefs: maxRefsPerSkill,
      maxChars: maxRefChars,
      maxDepth,
    });

    const bundle = {
      skill: {
        id: entry.id,
        name: parsedSkill.name || entry.id,
        description: parsedSkill.description || entry.description,
        path: entry.path,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        content: mainContent.text,
        truncated: mainContent.truncated,
        originalChars: mainContent.originalChars,
        usedChars: mainContent.usedChars,
      },
      references: references.loaded,
      ignored: references.ignored,
      warnings: [
        ...(parsedSkill.warnings || []),
        ...references.warnings,
      ],
      error: null,
    };

    skillBundleCache.set(cacheKey, bundle);
    return cloneBundle(bundle);
  } catch (error) {
    return {
      skill: null,
      references: [],
      ignored: [],
      warnings: [],
      error: toManagerError(error, `Failed to load skill: ${normalizedId}`),
    };
  }
}

export async function readSkillMarkdown(relativePath) {
  const normalizedPath = normalizeCatalogSkillPath(relativePath);
  const repositoryResult = await ensureRepositoryState();
  const repositoryState = repositoryResult.state || createEmptyRepositoryState();

  const content = repositoryState.files?.[normalizedPath];
  if (typeof content === 'string') {
    return {
      path: normalizedPath,
      content,
    };
  }

  throw new Error(`Skill file not found: ${normalizedPath}`);
}

export async function writeSkillMarkdown(relativePath, content) {
  const normalizedPath = normalizeCatalogSkillPath(relativePath);
  const safeContent = String(content || '');
  const repositoryResult = await ensureRepositoryState();
  let nextState = cloneRepositoryState(repositoryResult.state);
  nextState.files[normalizedPath] = safeContent;

  const warnings = [];
  if (normalizedPath === SKILL_CATALOG_FILE) {
    const parsedCatalog = parseCatalogFromContent(safeContent);
    warnings.push(...parsedCatalog.warnings);
    nextState = applyCatalogToRepository(nextState, parsedCatalog.catalog);
  }

  if (/\/SKILL\.md$/i.test(normalizedPath)) {
    nextState = ensureReferencePlaceholders(nextState, normalizedPath, safeContent);
  }

  repositoryCache = cloneRepositoryState(nextState);
  saveRepositoryToLocalStorage(repositoryCache);
  clearTransientCaches();

  return {
    path: normalizedPath,
    warnings,
  };
}

export async function createSkillEntry(entry) {
  const normalized = normalizeCatalogEntry(entry);
  if (!normalized) {
    throw new Error('Skill id/description are required');
  }

  const repositoryResult = await ensureRepositoryState();
  let nextState = cloneRepositoryState(repositoryResult.state);
  if ((nextState.catalog || []).some((item) => item.id === normalized.id)) {
    throw new Error(`Skill id already exists: ${normalized.id}`);
  }

  nextState.catalog.push(normalized);
  const content = String(entry?.content || '').trim() || buildDefaultSkillMarkdown({
    name: normalized.id,
    description: normalized.description,
  });
  nextState.files[normalized.path] = content;
  nextState = ensureReferencePlaceholders(nextState, normalized.path, content);
  nextState = applyCatalogToRepository(nextState, nextState.catalog);

  repositoryCache = cloneRepositoryState(nextState);
  saveRepositoryToLocalStorage(repositoryCache);
  clearTransientCaches();

  return { ...normalized };
}

export async function deleteSkillEntry(skillId, { deleteFiles = true } = {}) {
  const normalizedId = normalizeSkillId(skillId);
  if (!normalizedId) {
    throw new Error('Skill id is required');
  }

  const repositoryResult = await ensureRepositoryState();
  let nextState = cloneRepositoryState(repositoryResult.state);
  const target = (nextState.catalog || []).find((item) => item.id === normalizedId);
  if (!target) {
    throw new Error(`Skill not found: ${normalizedId}`);
  }

  nextState.catalog = (nextState.catalog || []).filter((item) => item.id !== normalizedId);
  if (deleteFiles) {
    Object.keys(nextState.files || {}).forEach((path) => {
      if (path.startsWith(`${normalizedId}/`)) {
        delete nextState.files[path];
      }
    });
  }

  nextState = applyCatalogToRepository(nextState, nextState.catalog);

  repositoryCache = cloneRepositoryState(nextState);
  saveRepositoryToLocalStorage(repositoryCache);
  clearTransientCaches();

  return {
    id: normalizedId,
    removed_from_catalog: true,
    removed_files: Boolean(deleteFiles),
  };
}

export function getSkillCatalogAssetUrl() {
  return buildSkillAssetUrl(SKILL_CATALOG_FILE);
}

export function getSkillAssetUrl(relativePath) {
  return buildSkillAssetUrl(relativePath);
}

export default {
  setSkillFetcher,
  resetSkillManagerCache,
  cloneSkillRepositoryState,
  exportSkillRepositoryState,
  importSkillRepositoryState,
  exportSkillTransferFile,
  importSkillTransferFile,
  loadSkillPreferenceState,
  saveSkillPreferenceState,
  loadSkillCatalog,
  loadSkillBundle,
  buildDefaultSkillMarkdown,
  readSkillMarkdown,
  writeSkillMarkdown,
  createSkillEntry,
  deleteSkillEntry,
  getSkillCatalogAssetUrl,
  getSkillAssetUrl,
};
