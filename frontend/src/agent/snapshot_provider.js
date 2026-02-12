import { getByPath } from '../store.js';
import { REGISTRY_VERSION } from './field_registry.js';
import { hashValue, stableStringify, measureValue } from './value_utils.js';

export const DEFAULT_SNAPSHOT_PATHS = [
  'data.name',
  'data.description',
  'data.first_mes',
  'data.alternate_greetings',
  'data.personality',
  'data.scenario',
  'data.tags',
  'data.creator_notes',
  'data.nickname',
  'data.character_book',
];

function normalizePaths(paths) {
  const list = Array.isArray(paths) ? paths : [];
  const cleaned = list.map((item) => String(item || '').trim()).filter(Boolean);
  return Array.from(new Set(cleaned));
}

function buildSnapshotScope({ cardId, registryVersion, paths }) {
  return {
    card_id: cardId,
    registry_version: registryVersion,
    paths,
  };
}

function computePayloadSize(payload) {
  try {
    const { totalBytes } = measureValue(payload);
    return totalBytes;
  } catch {
    return null;
  }
}

function enforceMaxBytes({ payload, maxBytes }) {
  if (!Number.isFinite(maxBytes)) return payload;
  let current = payload;
  let size = computePayloadSize(current);
  if (size !== null && size <= maxBytes) return payload;

  const trimmed = { ...payload };
  const fields = { ...payload.fields };
  const paths = [...payload.paths];
  while (paths.length > 0) {
    const removed = paths.pop();
    delete fields[removed];
    trimmed.fields = fields;
    trimmed.paths = paths;
    size = computePayloadSize(trimmed);
    if (size !== null && size <= maxBytes) {
      return { ...trimmed, snapshot_truncated: true };
    }
  }

  return { ...trimmed, snapshot_truncated: true };
}

export async function buildSnapshot({ card, context, paths, maxBytes }) {
  const registryVersion = context?.registry_version || REGISTRY_VERSION;
  const cardId = context?.card_id || null;
  const normalized = normalizePaths(paths.length ? paths : DEFAULT_SNAPSHOT_PATHS);
  const fields = {};

  for (const path of normalized) {
    fields[path] = getByPath(card, path);
  }

  const scope = buildSnapshotScope({ cardId, registryVersion, paths: normalized });
  const snapshotHash = await hashValue({ ...scope, fields });

  const payload = {
    snapshot: true,
    registry_version: registryVersion,
    card_id: cardId,
    paths: normalized,
    fields,
    snapshot_hash: snapshotHash,
    snapshot_scope: scope,
  };

  return enforceMaxBytes({ payload, maxBytes });
}

export async function buildDelta({ card, context, paths, sinceHash, previousSnapshot, maxBytes }) {
  const registryVersion = context?.registry_version || REGISTRY_VERSION;
  const cardId = context?.card_id || null;
  const normalized = normalizePaths(paths.length ? paths : DEFAULT_SNAPSHOT_PATHS);
  const scope = buildSnapshotScope({ cardId, registryVersion, paths: normalized });

  if (!previousSnapshot || !sinceHash || previousSnapshot.snapshot_hash !== sinceHash) {
    const snapshot = await buildSnapshot({ card, context, paths: normalized, maxBytes });
    return { ...snapshot, snapshot_fallback: true, since_hash_used: null };
  }

  const previousScope = previousSnapshot.snapshot_scope || {};
  const scopeMatch =
    previousScope.card_id === scope.card_id &&
    previousScope.registry_version === scope.registry_version &&
    stableStringify(previousScope.paths || []) === stableStringify(scope.paths || []);

  if (!scopeMatch) {
    const snapshot = await buildSnapshot({ card, context, paths: normalized, maxBytes });
    return { ...snapshot, snapshot_fallback: true, since_hash_used: null };
  }

  const changes = [];
  for (const path of normalized) {
    const currentValue = getByPath(card, path);
    const previousValue = previousSnapshot.fields?.[path];
    if (stableStringify(currentValue) !== stableStringify(previousValue)) {
      if (currentValue === undefined) {
        changes.push({ path, deleted: true });
      } else {
        changes.push({ path, value: currentValue });
      }
    }
  }

  const payload = {
    snapshot: false,
    registry_version: registryVersion,
    card_id: cardId,
    paths: normalized,
    since_hash_used: sinceHash,
    changes,
  };

  return enforceMaxBytes({ payload, maxBytes });
}

export default {
  DEFAULT_SNAPSHOT_PATHS,
  buildSnapshot,
  buildDelta,
};
