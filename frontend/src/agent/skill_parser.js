function normalizeLineBreaks(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function stripWrappingQuotes(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function parseInlineArray(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((item) => stripWrappingQuotes(item))
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseScalar(value) {
  const text = stripWrappingQuotes(value);
  if (!text) return '';
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const num = Number(text);
    if (Number.isFinite(num)) return num;
  }
  const inlineArray = parseInlineArray(text);
  if (inlineArray) return inlineArray;
  return text;
}

function parseFrontmatterObject(frontmatterText) {
  const lines = normalizeLineBreaks(frontmatterText).split('\n');
  const parsed = {};
  let arrayKey = null;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      arrayKey = null;
      return;
    }

    if (arrayKey) {
      const arrayItemMatch = trimmed.match(/^[-*]\s+(.+)$/);
      if (arrayItemMatch) {
        if (!Array.isArray(parsed[arrayKey])) {
          parsed[arrayKey] = [];
        }
        parsed[arrayKey].push(parseScalar(arrayItemMatch[1]));
        return;
      }
      arrayKey = null;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) return;

    const key = keyMatch[1];
    const rawValue = keyMatch[2] || '';
    if (!rawValue.trim()) {
      parsed[key] = [];
      arrayKey = key;
      return;
    }

    parsed[key] = parseScalar(rawValue);
    arrayKey = null;
  });

  return parsed;
}

function splitFrontmatterDocument(text) {
  const normalized = normalizeLineBreaks(text);
  if (!normalized.startsWith('---\n')) {
    return {
      frontmatter: {},
      body: normalized,
      hasFrontmatter: false,
    };
  }

  const closeIndex = normalized.indexOf('\n---\n', 4);
  if (closeIndex === -1) {
    return {
      frontmatter: {},
      body: normalized,
      hasFrontmatter: false,
    };
  }

  const frontmatterRaw = normalized.slice(4, closeIndex);
  const body = normalized.slice(closeIndex + 5);
  return {
    frontmatter: parseFrontmatterObject(frontmatterRaw),
    body,
    hasFrontmatter: true,
  };
}

function toStringValue(value) {
  return String(value || '').trim();
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => toStringValue(item))
      .filter(Boolean);
  }
  const text = toStringValue(value);
  if (!text) return [];
  if (text.includes(',')) {
    return text
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [text];
}

function createParserWarning(code, message, context = null) {
  return {
    code,
    message,
    context,
  };
}

function normalizeCatalogEntry(rawEntry) {
  const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
  const id = toStringValue(entry.id);
  const description = toStringValue(entry.description);
  const path = toStringValue(entry.path);
  const tags = toStringArray(entry.tags);

  if (!id || !description || !path) {
    return null;
  }

  return {
    id,
    description,
    path,
    tags,
  };
}

function parseCatalogFromFrontmatter(frontmatter) {
  const skills = frontmatter?.skills;
  if (!Array.isArray(skills)) return [];
  return skills
    .map((item) => normalizeCatalogEntry(item))
    .filter(Boolean);
}

function parseCatalogFromMarkdownList(body) {
  const lines = normalizeLineBreaks(body).split('\n');
  const entries = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    const normalized = normalizeCatalogEntry(current);
    if (normalized) {
      entries.push(normalized);
    }
    current = null;
  };

  lines.forEach((line) => {
    const itemStart = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (itemStart) {
      pushCurrent();
      current = {
        id: parseScalar(itemStart[1]),
      };
      return;
    }

    if (!current) return;

    const keyValue = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValue) return;

    const key = keyValue[1];
    const rawValue = keyValue[2] || '';
    if (!rawValue.trim()) {
      current[key] = [];
      return;
    }

    current[key] = parseScalar(rawValue);
  });

  pushCurrent();
  return entries;
}

export function parseFrontmatterDocument(text) {
  return splitFrontmatterDocument(text);
}

export function parseSkillCatalog(text) {
  const doc = splitFrontmatterDocument(text);
  const warnings = [];

  let entries = parseCatalogFromFrontmatter(doc.frontmatter);
  if (entries.length === 0) {
    entries = parseCatalogFromMarkdownList(doc.body);
  }

  if (entries.length === 0) {
    warnings.push(createParserWarning('W_SKILL_CATALOG_EMPTY', 'No valid skill entry found in SKILLS.md'));
  }

  const deduped = [];
  const seen = new Set();
  entries.forEach((entry) => {
    if (seen.has(entry.id)) {
      warnings.push(createParserWarning('W_SKILL_CATALOG_DUPLICATE', `Duplicate skill id ignored: ${entry.id}`));
      return;
    }
    seen.add(entry.id);
    deduped.push(entry);
  });

  return {
    entries: deduped,
    warnings,
  };
}

export function parseSkillDocument(text) {
  const doc = splitFrontmatterDocument(text);
  const frontmatter = doc.frontmatter || {};

  const name = toStringValue(frontmatter.name);
  const description = toStringValue(frontmatter.description);
  const references = toStringArray(frontmatter.references);
  const body = String(doc.body || '').trim();
  const warnings = [];

  if (!name) {
    warnings.push(createParserWarning('W_SKILL_NAME_MISSING', 'Missing frontmatter field: name'));
  }
  if (!description) {
    warnings.push(createParserWarning('W_SKILL_DESCRIPTION_MISSING', 'Missing frontmatter field: description'));
  }

  return {
    name,
    description,
    references,
    body,
    warnings,
    frontmatter,
  };
}

export default {
  parseFrontmatterDocument,
  parseSkillCatalog,
  parseSkillDocument,
};
