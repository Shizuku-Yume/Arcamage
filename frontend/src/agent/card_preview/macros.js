const DEFAULT_USER_NAME = 'user';
const DEFAULT_CHAR_NAME = '角色';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizePreviewName(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

export function createMacroContext({ charName, userName } = {}) {
  return {
    charName: normalizePreviewName(charName, DEFAULT_CHAR_NAME),
    userName: normalizePreviewName(userName, DEFAULT_USER_NAME),
  };
}

export function expandCardPreviewMacros(value, context = {}) {
  if (value === null || value === undefined) return '';
  const { charName, userName } = createMacroContext(context);
  return String(value)
    .replace(/\{\{\s*char\s*\}\}/gi, charName)
    .replace(/\{\{\s*user\s*\}\}/gi, userName)
    .replace(/<\s*BOT\s*>/gi, charName)
    .replace(/<\s*USER\s*>/gi, userName);
}

export function buildNamePrefixPattern(name) {
  const normalized = normalizePreviewName(name, '');
  if (!normalized) return null;
  return new RegExp(`^\\s*${escapeRegExp(normalized)}\\s*[：:]\\s*`, 'i');
}

export function stripNamePrefix(text, name) {
  const pattern = buildNamePrefixPattern(name);
  if (!pattern) return String(text || '');
  return String(text || '').replace(pattern, '');
}

export default {
  normalizePreviewName,
  createMacroContext,
  expandCardPreviewMacros,
  buildNamePrefixPattern,
  stripNamePrefix,
};
