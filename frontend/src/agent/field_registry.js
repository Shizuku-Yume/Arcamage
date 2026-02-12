import registry from './field_registry.v0.4.0.json';

const FIELD_LIST = Array.isArray(registry?.fields) ? registry.fields : [];

const FIELD_INDEX = new Map();
const ALIAS_INDEX = new Map();

for (const field of FIELD_LIST) {
  if (!field?.field_path) continue;
  FIELD_INDEX.set(field.field_path, field);
  const aliases = Array.isArray(field.aliases) ? field.aliases : [];
  for (const alias of aliases) {
    if (!alias) continue;
    if (!ALIAS_INDEX.has(alias)) {
      ALIAS_INDEX.set(alias, new Set());
    }
    ALIAS_INDEX.get(alias).add(field.field_path);
  }
}

export const REGISTRY_VERSION = registry?.registry_version || '0.0.0';
export const SOURCE_OF_TRUTH_PATH = registry?.source_of_truth_path || '';
export const FIELD_REGISTRY = FIELD_LIST;

export function getFieldByPath(path) {
  return FIELD_INDEX.get(path) || null;
}

export function resolveFieldPath(path) {
  if (!path || typeof path !== 'string') return { field: null };
  const trimmed = path.trim();
  if (!trimmed) return { field: null };

  const direct = FIELD_INDEX.get(trimmed);
  if (direct) {
    return { field: direct, canonicalPath: trimmed, aliasUsed: false };
  }

  const aliasSet = ALIAS_INDEX.get(trimmed);
  if (!aliasSet || aliasSet.size === 0) {
    return { field: null };
  }
  if (aliasSet.size > 1) {
    return { field: null, aliasAmbiguous: true, aliasTargets: Array.from(aliasSet) };
  }

  const [canonicalPath] = Array.from(aliasSet);
  const resolved = FIELD_INDEX.get(canonicalPath) || null;
  return {
    field: resolved,
    canonicalPath,
    aliasUsed: true,
  };
}

export default {
  REGISTRY_VERSION,
  SOURCE_OF_TRUTH_PATH,
  FIELD_REGISTRY,
  getFieldByPath,
  resolveFieldPath,
};
