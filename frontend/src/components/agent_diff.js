/**
 * Agent diff helpers
 */

import { resolveFieldPath } from '../agent/field_registry.js';

const FIELD_LABEL_OVERRIDES = {
  spec: '规范',
  spec_version: '规范版本',
  'data.name': '角色名称',
  'data.description': '描述',
  'data.first_mes': '开场白',
  'data.alternate_greetings': '备选开场白',
  'data.group_only_greetings': '群聊开场白',
  'data.personality': '性格',
  'data.scenario': '场景',
  'data.tags': '标签',
  'data.creator_notes': '创作者注释',
  'data.nickname': '昵称',
  'data.creator': '创作者',
  'data.character_version': '版本',
  'data.system_prompt': '系统提示词',
  'data.post_history_instructions': '历史后指令',
  'data.mes_example': '对话示例',
  'data.character_book': '世界书',
  'data.extensions': '扩展字段',
  'data.assets': '资源',
};

function normalizeEscapedLineBreaks(rawText) {
  const text = String(rawText ?? '');
  if (!text) return '';
  if (/[\r\n]/.test(text)) return text;
  if (!/(\\r\\n|\\n|\\r)/.test(text)) return text;
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n');
}

export function formatDiffValue(value, maxLength = 120, preserveNewlines = false) {
  if (value === null || value === undefined) return '(空)';
  if (typeof value === 'string') {
    const normalizedText = normalizeEscapedLineBreaks(value);
    const normalized = preserveNewlines ? normalizedText : normalizedText.replace(/\n/g, ' ');
    if (!Number.isFinite(maxLength) || maxLength <= 0) return normalized;
    return normalized.length > maxLength
      ? `${normalized.slice(0, maxLength)}...`
      : normalized;
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > maxLength) {
      return `${serialized.slice(0, maxLength)}...`;
    }
    return serialized;
  } catch {
    return String(value);
  }
}

export function splitDiffLines(text) {
  const normalized = normalizeEscapedLineBreaks(text);
  if (!normalized) return [];
  return normalized.split(/\r\n|\r|\n/);
}

export function formatDiffLabel(op, path) {
  const localizedPath = resolveDiffPathLabel(path);
  switch (op) {
    case 'append':
      return `追加 ${localizedPath}`;
    case 'remove':
      return `删除 ${localizedPath}`;
    case 'move':
      return `移动 ${localizedPath}`;
    case 'set':
    default:
      return `修改 ${localizedPath}`;
  }
}

function buildArrayItemSuffix(parts, baseLength) {
  if (!Array.isArray(parts)) return '';
  if (!Number.isInteger(baseLength) || baseLength < 0) return '';
  if (parts.length !== baseLength + 1) return '';
  const indexToken = parts[baseLength];
  if (!/^\d+$/.test(indexToken)) return '';
  const humanIndex = Number(indexToken) + 1;
  return ` #${humanIndex}`;
}

function resolveDiffPathLabel(path) {
  if (!path || typeof path !== 'string') return String(path || '');
  if (path.startsWith('skills/')) {
    const suffix = path.slice('skills/'.length) || path;
    return `技能文件 · ${suffix}`;
  }
  const normalized = String(path).replace(/\[(\d+)\]/g, '.$1').trim();
  if (!normalized) return String(path);

  const parts = normalized.split('.').filter(Boolean);
  for (let i = parts.length; i > 0; i -= 1) {
    const candidate = parts.slice(0, i).join('.');
    const itemSuffix = buildArrayItemSuffix(parts, i);
    const override = FIELD_LABEL_OVERRIDES[candidate];
    if (override) return `${override}${itemSuffix}`;

    const resolved = resolveFieldPath(candidate);
    const note = resolved?.field?.notes;
    if (note) {
      const compactNote = String(note).replace(/\s*[（(].*?[)）]\s*/g, '').trim();
      if (compactNote) return `${compactNote}${itemSuffix}`;
      return `${String(note).trim()}${itemSuffix}`;
    }
  }

  return normalized;
}

export default {
  formatDiffValue,
  formatDiffLabel,
  splitDiffLines,
};
