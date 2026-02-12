/**
 * AI Agent fullscreen modal component
 */

import Alpine from 'alpinejs';
import { getAgentRuntime } from './agent_runtime.js';
import { generateIframeContent, renderMarkdown, sanitizeHTML } from './preview_panel.js';
import { formatDiffLabel, formatDiffValue, splitDiffLines } from './agent_diff.js';
import { resolveFieldPath } from '../agent/field_registry.js';
import { handleRefUpload, removeRefById, syncAgentRefs } from '../agent/ref_manager.js';
import { openArrayEditor, openLorebookEditor, openTagsEditor, openTextEditor } from '../stores/modal_stack.js';
import { deepClone } from '../store.js';
import {
  DEFAULT_PRESETS,
  createCustomPreset,
  loadPresetState,
  savePresetState,
} from '../agent/preset_manager.js';
import {
  loadSkillCatalog,
  saveSkillPreferenceState,
  readSkillMarkdown,
  writeSkillMarkdown,
  createSkillEntry,
  deleteSkillEntry,
  buildDefaultSkillMarkdown,
  exportSkillTransferFile,
  importSkillTransferFile,
} from '../agent/skill_manager.js';
import { createEmptySkillContextMeta } from '../agent/skill_context.js';
import { parseSkillDocument } from '../agent/skill_parser.js';

const runtime = getAgentRuntime();

const DIFF_MAX_LCS_LINES = 400;
const DIFF_MAX_RENDER_LINES = 800;
const DIFF_FOLD_CONTEXT_LINES = 2;
const SKILL_IDENTIFIER_PATTERN = /^[\p{L}\p{N}_\-\s]+$/u;

function buildEditorError(error, fallback = '操作失败') {
  const message = String(error?.message || fallback || '操作失败').trim();
  return message || '操作失败';
}

function quoteFrontmatterValue(value) {
  const text = String(value || '').trim();
  if (!text) return '""';
  if (/[:#[\]{},]|^\s|\s$/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function normalizeSkillIdentifier(rawValue) {
  return String(rawValue || '').trim().replace(/\s+/g, ' ');
}

function isValidSkillIdentifier(rawValue) {
  const normalized = normalizeSkillIdentifier(rawValue);
  if (!normalized) return false;
  return SKILL_IDENTIFIER_PATTERN.test(normalized);
}

function buildSkillPathById(rawId) {
  const normalizedId = normalizeSkillIdentifier(rawId);
  if (!isValidSkillIdentifier(normalizedId)) return '';
  return normalizeSkillEditorPath(`${normalizedId}/SKILL.md`);
}

function buildReferenceRelativePathFromName(rawName) {
  const normalizedName = normalizeSkillIdentifier(rawName);
  if (!isValidSkillIdentifier(normalizedName)) return '';
  return normalizeSkillEditorPath(`references/${normalizedName}.md`);
}

function getReferenceNameFromPath(referencePath) {
  const normalized = normalizeSkillEditorPath(referencePath);
  if (!normalized) return '';
  const fileName = normalized.split('/').pop() || '';
  if (!/\.md$/i.test(fileName)) return '';
  return normalizeSkillIdentifier(fileName.slice(0, -3));
}

function normalizeSkillEditorPath(rawPath) {
  const raw = String(rawPath || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return '';
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) return '';
  if (raw.includes('?') || raw.includes('#')) return '';

  const segments = [];
  let invalid = false;
  raw.split('/').forEach((segment) => {
    const value = segment.trim();
    if (invalid) return;
    if (!value || value === '.') return;
    if (value === '..') {
      invalid = true;
      return;
    }
    segments.push(value);
  });

  if (invalid) return '';
  if (!segments.length) return '';
  const normalized = segments.join('/');
  if (!/\.md$/i.test(normalized)) return '';
  return normalized;
}

function resolveSkillReferencePath(skillPath, referencePath) {
  const normalizedSkillPath = normalizeSkillEditorPath(skillPath);
  const normalizedRefPath = normalizeSkillEditorPath(referencePath);
  if (!normalizedSkillPath || !normalizedRefPath) return '';

  const baseSegments = normalizedSkillPath.split('/').slice(0, -1);
  const refSegments = normalizedRefPath.split('/');
  const merged = [...baseSegments, ...refSegments].filter(Boolean);
  if (!merged.length) return '';
  const mergedPath = merged.join('/');
  if (!/\.md$/i.test(mergedPath)) return '';
  return mergedPath;
}

function createSkillReferenceDraft(name = '', content = '', error = '') {
  return {
    uid: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: normalizeSkillIdentifier(name),
    content: String(content || ''),
    error: String(error || ''),
  };
}

function cloneSkillReferenceDrafts(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => createSkillReferenceDraft(
    item?.name || '',
    item?.content || '',
    item?.error || '',
  ));
}

function ensureReferenceHeadingLine(rawName, rawContent = '') {
  const referenceName = normalizeSkillIdentifier(rawName);
  const normalizedContent = String(rawContent || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedContent.split('\n');
  const hasHeading = /^#(?:\s|$)/.test(lines[0] || '');
  const bodyLines = hasHeading ? lines.slice(1) : lines;

  while (bodyLines.length > 0 && !String(bodyLines[0] || '').trim()) {
    bodyLines.shift();
  }

  const body = bodyLines.join('\n').trimEnd();
  if (!referenceName) {
    return body;
  }
  if (!body) {
    return `# ${referenceName}\n`;
  }
  return `# ${referenceName}\n\n${body}`;
}

function createEmptySkillEditorDraft() {
  return {
    id: '',
    sourcePath: '',
    description: '',
    content: '',
    references: [],
  };
}

function downloadBlobAsFile(blob, fileName) {
  const targetName = String(fileName || '').trim() || 'skill.md';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = targetName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function serializeSkillCatalogMarkdown(entries) {
  const lines = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const id = normalizeSkillIdentifier(entry?.id || '');
    const description = String(entry?.description || '').trim();
    const path = buildSkillPathById(id) || normalizeSkillEditorPath(entry?.path || '');
    if (!id || !description || !path) return;
    const tags = Array.isArray(entry?.tags)
      ? entry.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
      : [];

    lines.push(`- id: ${id}`);
    lines.push(`  description: ${quoteFrontmatterValue(description)}`);
    lines.push(`  path: ${path}`);
    lines.push(`  tags: [${tags.map((tag) => quoteFrontmatterValue(tag)).join(', ')}]`);
    lines.push('');
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

function serializeSkillDocumentMarkdown({ name, description, content, references }) {
  const normalizedName = String(name || '').trim();
  const normalizedDescription = String(description || '').trim();
  const normalizedBody = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const normalizedRefs = (Array.isArray(references) ? references : [])
    .map((item) => normalizeSkillEditorPath(item))
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

export function agentModal() {
  return {
    previewMarkdown: true,
    previewSelection: null,
    headerMenuOpen: '',
    skillMenuRefreshing: false,
    presetEditorOpen: false,
    presetDeleteOpen: false,
    presetEditorMode: 'add',
    editingPresetId: null,
    presetToDelete: null,
    isMultiline: false,
    customPresets: [],
    hiddenPresetIds: [],
    presetLabel: '',
    presetPrompt: '',
    confirmUndo: false,
    undoConfirmTimer: null,
    diffSearch: '',
    diffCache: new Map(),
    diffInlineCache: new Map(),
    diffScrollTopByKey: new Map(),
    openActivityTraceIds: {},
    skillManagerOpen: false,
    skillManagerBusy: false,
    skillManagerSaving: false,
    skillTransferBusy: false,
    skillManagerError: '',
    skillManagerSelectedId: '',
    skillManagerNewMode: false,
    skillDeleteConfirmOpen: false,
    skillDeleteConfirmName: '',
    skillValidationDialogOpen: false,
    skillValidationMessage: '',
    skillReferencePanelOpen: false,
    skillReferenceSelectedIndex: -1,
    skillReferenceManagerOpen: false,
    skillReferenceEditorDrafts: [],
    skillReferenceSaving: false,
    skillReferenceDeleteConfirmOpen: false,
    skillReferenceDeleteConfirmName: '',
    skillReferenceDeleteConfirmIndex: -1,
    skillEditorDraft: createEmptySkillEditorDraft(),

    get agent() {
      return Alpine.store('agent');
    },

    get card() {
      return Alpine.store('card');
    },

    get hasOverlayModalOpen() {
      return Boolean(
        this.skillManagerOpen
        || this.skillReferenceManagerOpen
        || this.skillDeleteConfirmOpen
        || this.skillReferenceDeleteConfirmOpen
        || this.skillValidationDialogOpen
        || this.presetEditorOpen
        || this.presetDeleteOpen,
      );
    },

    get isStreaming() {
      return this.agent.runtime.status === 'streaming';
    },

    get showActivityTrace() {
      return Boolean(Alpine.store('settings')?.agentShowActivityTrace);
    },

    get skillFeatureEnabled() {
      return Alpine.store('settings')?.skillsEnabled !== false;
    },

    get headerMenus() {
      const menus = [{ id: 'preset', label: '预设' }];
      if (this.skillFeatureEnabled) {
        menus.push({ id: 'skill', label: '技能' });
      }
      return menus;
    },

    get streamingText() {
      return String(this.agent?.chat?.streamingText || '').trim();
    },

    get isStreamingPlaceholder() {
      return /^生成中(?:\.{3}|…)?$/.test(this.streamingText);
    },

    get streamingPlaceholderChars() {
      return Array.from('生成中...');
    },

    get streamingToolStatus() {
      const text = this.streamingText;
      if (!text) return '';
      return text.startsWith('正在调用工具') ? text : '';
    },

    get hasStreamingActivityCard() {
      if (!this.showActivityTrace) return false;
      return Boolean(this.agent?.chat?.streamingThinking || this.streamingToolStatus);
    },

    get shouldShowStreamingMessage() {
      const text = this.streamingText;
      if (!text) return false;
      if (!this.showActivityTrace) return true;
      return !this.streamingToolStatus;
    },

    get previewCard() {
      return this.agent.stagingCard || this.card.data;
    },

    get previewTitle() {
      return this.previewCard?.data?.name || '角色卡';
    },

    get previewContent() {
      const options = this.previewOptions;
      const selected = options.find((item) => item.id === this.previewSelection) || options[0];
      return selected?.content || '';
    },

    get previewIframeContent() {
      return generateIframeContent(this.previewContent, {
        markdown: this.previewMarkdown,
        darkMode: document.documentElement.classList.contains('dark'),
      });
    },

    get diffLayout() {
      return this.agent?.ui?.diffLayout || 'split';
    },

    set diffLayout(value) {
      if (!this.agent?.ui) return;
      this.agent.ui.diffLayout = value === 'unified' ? 'unified' : 'split';
    },

    get diffWrap() {
      return this.agent?.ui?.diffWrap ?? true;
    },

    set diffWrap(value) {
      if (!this.agent?.ui) return;
      this.agent.ui.diffWrap = Boolean(value);
    },

    get diffFold() {
      return this.agent?.ui?.diffFold ?? true;
    },

    set diffFold(value) {
      if (!this.agent?.ui) return;
      this.agent.ui.diffFold = Boolean(value);
    },

    get diffCollapsed() {
      return this.agent?.ui?.diffCollapsed ?? false;
    },

    set diffCollapsed(value) {
      if (!this.agent?.ui) return;
      this.agent.ui.diffCollapsed = Boolean(value);
    },

    get diffSelectedId() {
      return this.agent?.ui?.diffSelectedId ?? null;
    },

    set diffSelectedId(value) {
      if (!this.agent?.ui) return;
      this.agent.ui.diffSelectedId = value ?? null;
    },

    get diffPanelOpen() {
      return this.agent?.ui?.diffPanelOpen ?? false;
    },

    set diffPanelOpen(value) {
      if (!this.agent?.ui) return;
      this.agent.ui.diffPanelOpen = Boolean(value);
    },

    get refs() {
      return this.agent.refs || [];
    },

    get skillsState() {
      return this.agent?.skills || {};
    },

    get skillsEnabled() {
      return this.skillsState.enabled !== false;
    },

    get skillCatalog() {
      return Array.isArray(this.skillsState.catalog) ? this.skillsState.catalog : [];
    },

    get selectedSkillIds() {
      return Array.isArray(this.skillsState.selectedIds) ? this.skillsState.selectedIds : [];
    },

    get autoMatchedSkillIds() {
      return Array.isArray(this.skillsState.autoMatchedIds) ? this.skillsState.autoMatchedIds : [];
    },

    get loadedSkillMeta() {
      return this.skillsState.loadedContextMeta || createEmptySkillContextMeta();
    },

    get loadedReferences() {
      return Array.isArray(this.loadedSkillMeta.loadedReferences) ? this.loadedSkillMeta.loadedReferences : [];
    },

    get ignoredSkillItems() {
      return Array.isArray(this.loadedSkillMeta.ignored) ? this.loadedSkillMeta.ignored : [];
    },

    get truncatedSkillItems() {
      return Array.isArray(this.loadedSkillMeta.truncated) ? this.loadedSkillMeta.truncated : [];
    },

    get hasSkillEditorSelection() {
      return this.skillManagerNewMode
        || Boolean(this.skillManagerSelectedId)
        || Boolean(this.skillEditorDraft?.sourcePath);
    },

    get skillReferenceEditorItems() {
      return Array.isArray(this.skillReferenceEditorDrafts) ? this.skillReferenceEditorDrafts : [];
    },

    get selectedSkillReferenceDraft() {
      const references = this.skillReferenceEditorItems;
      const index = Number(this.skillReferenceSelectedIndex);
      if (!Number.isInteger(index) || index < 0 || index >= references.length) {
        return null;
      }
      return references[index] || null;
    },

    get skillEditorTargetPath() {
      return buildSkillPathById(this.skillEditorDraft?.id || '');
    },

    getSelectedReferenceTargetPath() {
      const ref = this.selectedSkillReferenceDraft;
      if (!ref) return '';
      return buildReferenceRelativePathFromName(ref.name || '');
    },

    isSkillSelected(skillId) {
      return this.selectedSkillIds.includes(skillId);
    },

    isSkillAutoMatched(skillId) {
      return this.autoMatchedSkillIds.includes(skillId);
    },

    persistSkillPreference() {
      if (!this.agent?.skills) return;
      saveSkillPreferenceState({
        enabled: this.skillsEnabled,
        selectedIds: this.selectedSkillIds,
      });
    },

    setSkillsEnabled(enabled) {
      if (!this.agent?.skills) return;
      this.agent.skills.enabled = Boolean(enabled);
      this.persistSkillPreference();
    },

    isHeaderMenuOpen(menuId) {
      return this.headerMenuOpen === String(menuId || '').trim();
    },

    closeHeaderMenus() {
      this.headerMenuOpen = '';
    },

    syncSkillFeatureState() {
      const featureEnabled = this.skillFeatureEnabled;
      if (!featureEnabled && this.headerMenuOpen === 'skill') this.closeHeaderMenus();
      this.setSkillsEnabled(featureEnabled);
    },

    async toggleHeaderMenu(menuId) {
      const id = String(menuId || '').trim();
      if (!id) return;
      if (id === 'skill' && !this.skillFeatureEnabled) return;
      if (this.isHeaderMenuOpen(id)) {
        this.closeHeaderMenus();
        return;
      }
      this.headerMenuOpen = id;
      if (id !== 'skill') return;
      await this.ensureSkillCatalog();
    },

    async refreshSkillCatalogFromMenu() {
      if (this.skillMenuRefreshing) return;
      this.skillMenuRefreshing = true;
      try {
        await this.refreshSkillCatalog();
      } finally {
        this.skillMenuRefreshing = false;
      }
    },

    openSkillManagerFromMenu() {
      this.closeHeaderMenus();
      this.openSkillManager();
    },

    toggleSkill(skillId) {
      if (!this.agent?.skills) return;
      const id = String(skillId || '').trim();
      if (!id) return;
      const current = Array.isArray(this.agent.skills.selectedIds) ? [...this.agent.skills.selectedIds] : [];
      const index = current.indexOf(id);
      if (index >= 0) {
        current.splice(index, 1);
      } else {
        current.push(id);
      }
      this.agent.skills.selectedIds = current;
      this.persistSkillPreference();
    },

    formatSkillIssue(item) {
      const reasonMap = {
        context_budget: '超出上下文预算',
        invalid_reference_path: '引用路径非法',
        duplicate_reference: '重复引用',
        ref_limit: '引用数量超过上限',
        reference_load_failed: '引用加载失败',
        skill_load_failed: '技能加载失败',
        low_priority_section_pruned: '低优先级章节已裁剪',
        skill_content_truncated: '技能正文已截断',
        reference_content_truncated: '引用内容已截断',
      };
      const reason = String(item?.reason || '').trim();
      const detail = String(item?.detail || '').trim();
      const label = reasonMap[reason] || reason || '已忽略';
      return detail ? `${label}：${detail}` : label;
    },

    getSkillName(skillId) {
      const id = String(skillId || '').trim();
      if (!id) return '';
      const matched = this.skillCatalog.find((item) => item.id === id);
      return matched?.id || id;
    },

    normalizeSelectedSkills() {
      if (!this.agent?.skills) return;
      const validIds = new Set(this.skillCatalog.map((item) => item.id));
      const current = Array.isArray(this.agent.skills.selectedIds) ? this.agent.skills.selectedIds : [];
      const normalized = current
        .map((item) => String(item || '').trim())
        .filter((item, index, array) => item && validIds.has(item) && array.indexOf(item) === index);
      if (JSON.stringify(normalized) !== JSON.stringify(current)) {
        this.agent.skills.selectedIds = normalized;
        this.persistSkillPreference();
      }
    },

    async ensureSkillCatalog(forceRefresh = false) {
      if (!this.agent?.skills) return;
      if (!forceRefresh && this.skillCatalog.length > 0) return;
      const result = await loadSkillCatalog({ forceRefresh });
      this.agent.skills.catalog = result.catalog;
      this.agent.skills.lastError = result.error || null;
      this.normalizeSelectedSkills();
    },

    async refreshSkillCatalog() {
      await this.ensureSkillCatalog(true);
      const hasCatalog = this.skillCatalog.length > 0;
      if (hasCatalog) {
        Alpine.store('toast')?.success?.('本地 Skills 已刷新');
      } else if (this.skillsState.lastError) {
        Alpine.store('toast')?.error?.(this.skillsState.lastError);
      } else {
        Alpine.store('toast')?.show?.({
          message: '未读取到本地 skills，请检查 SKILLS.md',
          type: 'warning',
          duration: 5000,
        });
      }
    },

    openSkillTransferImportPicker() {
      if (this.skillTransferBusy || this.skillManagerSaving) return;
      const input = this.$refs.skillTransferImportInput;
      if (!input) return;
      input.value = '';
      input.click();
    },

    async importSkillTransferFromInput(event) {
      const input = event?.target || this.$refs.skillTransferImportInput;
      const file = input?.files?.[0] || null;
      if (!file) return;

      this.skillTransferBusy = true;
      this.skillManagerError = '';
      try {
        const imported = await importSkillTransferFile(file);
        await this.ensureSkillCatalog(true);

        this.skillManagerNewMode = false;
        this.skillManagerSelectedId = imported.skillId;
        await this.selectSkillForManager(imported.skillId);

        const modeLabel = imported.format === 'zip' ? 'ZIP' : 'Markdown';
        const actionLabel = imported.replaced ? '已覆盖导入' : '已导入';
        Alpine.store('toast')?.success?.(`技能「${imported.skillId}」${actionLabel}（${modeLabel}）`);
      } catch (error) {
        this.skillManagerError = buildEditorError(error, '导入技能失败');
        Alpine.store('toast')?.error?.(this.skillManagerError);
      } finally {
        this.skillTransferBusy = false;
        if (input) {
          input.value = '';
        }
      }
    },

    async exportSelectedSkillTransfer() {
      if (this.skillTransferBusy || this.skillManagerSaving) return;
      if (this.skillManagerNewMode) {
        Alpine.store('toast')?.show?.({
          message: '请先保存新建技能后再导出',
          type: 'warning',
          duration: 3000,
        });
        return;
      }

      const skillId = normalizeSkillIdentifier(this.skillManagerSelectedId || this.skillEditorDraft.id || '');
      if (!skillId) {
        Alpine.store('toast')?.show?.({
          message: '请先选择一个技能再导出',
          type: 'warning',
          duration: 3000,
        });
        return;
      }

      this.skillTransferBusy = true;
      this.skillManagerError = '';
      try {
        const exported = await exportSkillTransferFile(skillId);
        downloadBlobAsFile(exported.blob, exported.fileName);
        const modeLabel = exported.format === 'zip' ? 'ZIP' : 'Markdown';
        Alpine.store('toast')?.success?.(`技能「${skillId}」已导出（${modeLabel}）`);
      } catch (error) {
        this.skillManagerError = buildEditorError(error, '导出技能失败');
        Alpine.store('toast')?.error?.(this.skillManagerError);
      } finally {
        this.skillTransferBusy = false;
      }
    },

    resetSkillEditorDraft() {
      this.skillEditorDraft = createEmptySkillEditorDraft();
      this.skillReferenceSelectedIndex = -1;
      this.skillReferencePanelOpen = false;
      this.skillReferenceEditorDrafts = [];
      this.skillReferenceSaving = false;
      this.skillReferenceDeleteConfirmOpen = false;
      this.skillReferenceDeleteConfirmName = '';
      this.skillReferenceDeleteConfirmIndex = -1;
    },

    closeSkillManager() {
      this.skillManagerOpen = false;
      this.skillReferencePanelOpen = false;
      this.closeSkillReferenceManager();
      this.skillManagerError = '';
      if (this.agent?.ui) {
        this.agent.ui.openSkillManager = false;
      }
    },

    openSkillReferenceManager() {
      if (!this.hasSkillEditorSelection) return;
      const sourceRefs = Array.isArray(this.skillEditorDraft.references) ? this.skillEditorDraft.references : [];
      this.skillReferenceEditorDrafts = cloneSkillReferenceDrafts(sourceRefs);
      this.skillReferenceManagerOpen = true;
      this.skillReferenceDeleteConfirmOpen = false;
      this.skillReferenceDeleteConfirmName = '';
      this.skillReferenceDeleteConfirmIndex = -1;
      if (this.skillReferenceEditorDrafts.length > 0) {
        if (
          this.skillReferenceSelectedIndex < 0
          || this.skillReferenceSelectedIndex >= this.skillReferenceEditorDrafts.length
        ) {
          this.skillReferenceSelectedIndex = 0;
        }
        return;
      }
      this.skillReferenceSelectedIndex = -1;
    },

    closeSkillReferenceManager() {
      this.skillReferenceManagerOpen = false;
      this.skillReferenceEditorDrafts = [];
      this.skillReferenceSaving = false;
      this.skillReferenceDeleteConfirmOpen = false;
      this.skillReferenceDeleteConfirmName = '';
      this.skillReferenceDeleteConfirmIndex = -1;
    },

    async openSkillManager(preferredSkillId = '') {
      this.skillManagerOpen = true;
      this.skillManagerError = '';
      await this.ensureSkillCatalog();

      const targetId = String(
        preferredSkillId
        || this.skillManagerSelectedId
        || this.skillCatalog[0]?.id
        || '',
      ).trim();

      if (!targetId) {
        this.resetSkillEditorDraft();
        return;
      }

      await this.selectSkillForManager(targetId);
    },

    async selectSkillForManager(skillId) {
      const targetId = String(skillId || '').trim();
      if (!targetId) return;

      const entry = this.skillCatalog.find((item) => item.id === targetId);
      if (!entry) {
        this.skillManagerError = `技能不存在：${targetId}`;
        return;
      }

      this.skillManagerNewMode = false;
      this.skillManagerBusy = true;
      this.skillManagerError = '';
      try {
        const file = await readSkillMarkdown(entry.path);
        const parsed = parseSkillDocument(file.content);
        const references = [];
        const seen = new Set();
        const rawRefs = Array.isArray(parsed.references) ? parsed.references : [];

        for (let index = 0; index < rawRefs.length; index += 1) {
          const rawPath = String(rawRefs[index] || '').trim();
          if (!rawPath) continue;
          const normalizedPath = normalizeSkillEditorPath(rawPath);
          if (!normalizedPath) {
            references.push(createSkillReferenceDraft(rawPath, '', '引用名称无效'));
            continue;
          }

          const referenceName = getReferenceNameFromPath(normalizedPath);
          if (!isValidSkillIdentifier(referenceName)) {
            references.push(createSkillReferenceDraft(rawPath, '', '引用名称无效'));
            continue;
          }
          if (seen.has(referenceName)) continue;
          seen.add(referenceName);

          const resolvedPath = resolveSkillReferencePath(entry.path, normalizedPath);
          if (!resolvedPath) {
            references.push(createSkillReferenceDraft(referenceName, '', '引用名称无效'));
            continue;
          }

          try {
            const refFile = await readSkillMarkdown(resolvedPath);
            references.push(createSkillReferenceDraft(referenceName, refFile.content));
          } catch (error) {
            references.push(createSkillReferenceDraft(
              referenceName,
              '',
              buildEditorError(error, '读取 reference 失败'),
            ));
          }
        }

        this.skillEditorDraft = {
          id: entry.id,
          sourcePath: entry.path,
          description: parsed.description || entry.description,
          content: parsed.body || '',
          references,
        };
        this.skillManagerSelectedId = entry.id;
        this.skillReferenceSelectedIndex = references.length > 0 ? 0 : -1;
        this.skillReferencePanelOpen = false;
        this.skillReferenceEditorDrafts = [];
        this.skillReferenceDeleteConfirmOpen = false;
        this.skillReferenceDeleteConfirmName = '';
        this.skillReferenceDeleteConfirmIndex = -1;
      } catch (error) {
        this.resetSkillEditorDraft();
        this.skillManagerError = buildEditorError(error, '读取技能失败');
        Alpine.store('toast')?.error?.(this.skillManagerError);
      } finally {
        this.skillManagerBusy = false;
      }
    },

    async addSkillFromManager() {
      this.skillEditorDraft = {
        id: '',
        sourcePath: '',
        description: '',
        content: '',
        references: [],
      };
      this.skillManagerSelectedId = '';
      this.skillManagerNewMode = true;
      this.skillReferenceSelectedIndex = -1;
      this.skillReferencePanelOpen = false;
      this.skillReferenceEditorDrafts = [];
      this.skillReferenceDeleteConfirmOpen = false;
      this.skillReferenceDeleteConfirmName = '';
      this.skillReferenceDeleteConfirmIndex = -1;
      this.skillManagerError = '';
    },

    async deleteSelectedSkillFromManager() {
      if (!this.hasSkillEditorSelection) return;
      if (this.skillManagerNewMode) {
        this.skillManagerNewMode = false;
        this.resetSkillEditorDraft();
        const fallback = this.skillCatalog[0]?.id || '';
        if (fallback) {
          await this.selectSkillForManager(fallback);
        }
        return;
      }
      const skillId = normalizeSkillIdentifier(this.skillManagerSelectedId || this.skillEditorDraft.id || '');
      if (!skillId) return;
      const displayName = skillId;
      this.skillDeleteConfirmName = displayName;
      this.skillDeleteConfirmOpen = true;
    },

    async confirmDeleteSkill() {
      const skillId = normalizeSkillIdentifier(this.skillManagerSelectedId || this.skillEditorDraft.id || '');
      if (!skillId) {
        this.skillDeleteConfirmOpen = false;
        return;
      }

      try {
        await deleteSkillEntry(skillId, { deleteFiles: true });
        if (this.isSkillSelected(skillId)) {
          this.toggleSkill(skillId);
        }
        await this.ensureSkillCatalog(true);
        const fallback = this.skillCatalog[0]?.id || '';
        if (fallback) {
          await this.selectSkillForManager(fallback);
        } else {
          this.skillManagerSelectedId = '';
          this.resetSkillEditorDraft();
        }
        Alpine.store('toast')?.success?.('技能已删除');
      } catch (error) {
        this.skillManagerError = buildEditorError(error, '删除技能失败');
        Alpine.store('toast')?.error?.(this.skillManagerError);
      } finally {
        this.skillDeleteConfirmOpen = false;
      }
    },

    cancelDeleteSkill() {
      this.skillDeleteConfirmOpen = false;
      this.skillDeleteConfirmName = '';
    },

    closeValidationDialog() {
      this.skillValidationDialogOpen = false;
      this.skillValidationMessage = '';
    },

    selectSkillReferenceDraft(index) {
      const next = Number(index);
      if (!Number.isInteger(next)) return;
      if (!Array.isArray(this.skillReferenceEditorDrafts)) return;
      if (next < 0 || next >= this.skillReferenceEditorDrafts.length) return;
      this.skillReferenceSelectedIndex = next;
    },

    syncSelectedReferenceName() {
      const ref = this.selectedSkillReferenceDraft;
      if (!ref) return;
      ref.name = normalizeSkillIdentifier(ref.name || '');
      ref.content = ensureReferenceHeadingLine(ref.name, ref.content || '');
    },

    addSkillReferenceDraft() {
      if (!this.skillReferenceManagerOpen) return;
      const currentRefs = Array.isArray(this.skillReferenceEditorDrafts) ? [...this.skillReferenceEditorDrafts] : [];
      const nextRefs = [...currentRefs, createSkillReferenceDraft('', '')];
      this.skillReferenceEditorDrafts = nextRefs;
      this.skillReferencePanelOpen = true;
      this.skillReferenceSelectedIndex = nextRefs.length - 1;
      this.skillReferenceDeleteConfirmOpen = false;
      this.skillReferenceDeleteConfirmName = '';
      this.skillReferenceDeleteConfirmIndex = -1;
    },

    requestDeleteSkillReferenceDraft(index) {
      const currentRefs = Array.isArray(this.skillReferenceEditorDrafts) ? this.skillReferenceEditorDrafts : [];
      const targetIndex = Number(index);
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= currentRefs.length) return;
      const target = currentRefs[targetIndex] || {};
      this.skillReferenceDeleteConfirmName = normalizeSkillIdentifier(target.name || '') || '未命名参考文件';
      this.skillReferenceDeleteConfirmIndex = targetIndex;
      this.skillReferenceDeleteConfirmOpen = true;
    },

    removeSkillReferenceDraft(index) {
      const currentRefs = Array.isArray(this.skillReferenceEditorDrafts) ? [...this.skillReferenceEditorDrafts] : [];
      const targetIndex = Number(index);
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= currentRefs.length) return;

      currentRefs.splice(targetIndex, 1);
      this.skillReferenceEditorDrafts = currentRefs;
      if (!currentRefs.length) {
        this.skillReferenceSelectedIndex = -1;
        return;
      }
      if (this.skillReferenceSelectedIndex > targetIndex) {
        this.skillReferenceSelectedIndex -= 1;
      } else if (this.skillReferenceSelectedIndex >= currentRefs.length) {
        this.skillReferenceSelectedIndex = currentRefs.length - 1;
      }
    },

    confirmDeleteSkillReferenceDraft() {
      const targetIndex = Number(this.skillReferenceDeleteConfirmIndex);
      this.removeSkillReferenceDraft(targetIndex);
      this.cancelDeleteSkillReferenceDraft();
    },

    cancelDeleteSkillReferenceDraft() {
      this.skillReferenceDeleteConfirmOpen = false;
      this.skillReferenceDeleteConfirmName = '';
      this.skillReferenceDeleteConfirmIndex = -1;
    },

    saveSkillReferenceManagerDraft() {
      const currentRefs = Array.isArray(this.skillReferenceEditorDrafts) ? this.skillReferenceEditorDrafts : [];
      const seenRef = new Set();
      const nextRefs = [];

      this.skillReferenceSaving = true;
      try {
        for (let index = 0; index < currentRefs.length; index += 1) {
          const refDraft = currentRefs[index] || {};
          const referenceName = normalizeSkillIdentifier(refDraft.name || '');
          const referenceContent = ensureReferenceHeadingLine(referenceName, refDraft.content || '');

          if (!referenceName) {
            if (referenceContent) {
              this.skillValidationMessage = `请先填写第 ${index + 1} 个参考文件名称`;
              this.skillValidationDialogOpen = true;
              this.skillReferenceSelectedIndex = index;
              return;
            }
            continue;
          }

          if (!isValidSkillIdentifier(referenceName)) {
            this.skillValidationMessage = `参考文件名称无效：${referenceName}`;
            this.skillValidationDialogOpen = true;
            this.skillReferenceSelectedIndex = index;
            return;
          }

          const relativePath = buildReferenceRelativePathFromName(referenceName);
          if (!relativePath) {
            this.skillValidationMessage = `参考文件名称无效：${referenceName}`;
            this.skillValidationDialogOpen = true;
            this.skillReferenceSelectedIndex = index;
            return;
          }
          if (seenRef.has(relativePath)) {
            this.skillValidationMessage = `参考文件名称重复：${referenceName}`;
            this.skillValidationDialogOpen = true;
            this.skillReferenceSelectedIndex = index;
            return;
          }
          seenRef.add(relativePath);

          nextRefs.push(createSkillReferenceDraft(
            referenceName,
            referenceContent,
            refDraft.error || '',
          ));
        }

        this.skillEditorDraft.references = nextRefs;
        this.skillReferenceEditorDrafts = cloneSkillReferenceDrafts(nextRefs);
        this.cancelDeleteSkillReferenceDraft();
        if (!nextRefs.length) {
          this.skillReferenceSelectedIndex = -1;
        } else if (this.skillReferenceSelectedIndex < 0 || this.skillReferenceSelectedIndex >= nextRefs.length) {
          this.skillReferenceSelectedIndex = 0;
        }
        Alpine.store('toast')?.success?.('参考文件修改已保存');
      } finally {
        this.skillReferenceSaving = false;
      }
    },

    async saveSkillManagerDraft() {
      if (!this.hasSkillEditorSelection) return;
      const isNewSkill = this.skillManagerNewMode;
      const currentSkillId = normalizeSkillIdentifier(this.skillManagerSelectedId || this.skillEditorDraft.id || '');
      const nextSkillId = normalizeSkillIdentifier(this.skillEditorDraft.id || '');
      const description = String(this.skillEditorDraft.description || '').trim();
      const body = String(this.skillEditorDraft.content || '').trim();

      const missingFields = [];
      if (!nextSkillId) missingFields.push('名称');
      if (!description) missingFields.push('描述');
      if (!body) missingFields.push('技能正文');

      if (missingFields.length > 0) {
        this.skillValidationMessage = `请填写以下必填项：${missingFields.join('、')}`;
        this.skillValidationDialogOpen = true;
        return;
      }

      if (!isValidSkillIdentifier(nextSkillId)) {
        this.skillValidationMessage = '名称仅支持中英文、数字、空格、下划线、中划线';
        this.skillValidationDialogOpen = true;
        return;
      }
      const nextSkillPath = buildSkillPathById(nextSkillId);
      if (!nextSkillPath) {
        this.skillValidationMessage = '名称格式无效';
        this.skillValidationDialogOpen = true;
        return;
      }

      if (isNewSkill) {
        if (this.skillCatalog.some((entry) => entry.id === nextSkillId)) {
          this.skillValidationMessage = `技能 ID 已存在：${nextSkillId}`;
          this.skillValidationDialogOpen = true;
          return;
        }
      } else {
        const currentEntry = this.skillCatalog.find((entry) => entry.id === currentSkillId);
        if (!currentEntry) {
          this.skillManagerError = `技能不存在：${currentSkillId || nextSkillId}`;
          return;
        }

        const idChanged = nextSkillId !== currentEntry.id;
        if (idChanged && this.skillCatalog.some((entry) => entry.id === nextSkillId)) {
          this.skillValidationMessage = `技能 ID 已存在：${nextSkillId}`;
          this.skillValidationDialogOpen = true;
          return;
        }
      }

      const references = [];
      const referenceWrites = [];
      const seenRef = new Set();
      const refDrafts = Array.isArray(this.skillEditorDraft.references) ? this.skillEditorDraft.references : [];
      for (let index = 0; index < refDrafts.length; index += 1) {
        const refDraft = refDrafts[index] || {};
        const referenceName = normalizeSkillIdentifier(refDraft.name || '');
        const referenceContent = ensureReferenceHeadingLine(referenceName, refDraft.content || '');
        if (!referenceName) {
          if (referenceContent) {
            this.skillValidationMessage = `请先填写第 ${index + 1} 个参考文件名称`;
            this.skillValidationDialogOpen = true;
            this.openSkillReferenceManager();
            this.skillReferenceSelectedIndex = index;
            return;
          }
          continue;
        }
        if (!isValidSkillIdentifier(referenceName)) {
          this.skillValidationMessage = `参考文件名称无效：${referenceName}`;
          this.skillValidationDialogOpen = true;
          this.openSkillReferenceManager();
          this.skillReferenceSelectedIndex = index;
          return;
        }

        const relativePath = buildReferenceRelativePathFromName(referenceName);
        if (!relativePath) {
          this.skillValidationMessage = `参考文件名称无效：${referenceName}`;
          this.skillValidationDialogOpen = true;
          this.openSkillReferenceManager();
          this.skillReferenceSelectedIndex = index;
          return;
        }
        if (seenRef.has(relativePath)) {
          this.skillValidationMessage = `参考文件名称重复：${referenceName}`;
          this.skillValidationDialogOpen = true;
          this.openSkillReferenceManager();
          this.skillReferenceSelectedIndex = index;
          return;
        }
        seenRef.add(relativePath);

        const resolvedPath = resolveSkillReferencePath(nextSkillPath, relativePath);
        if (!resolvedPath) {
          this.skillValidationMessage = `参考文件名称无效：${referenceName}`;
          this.skillValidationDialogOpen = true;
          this.openSkillReferenceManager();
          this.skillReferenceSelectedIndex = index;
          return;
        }

        references.push(relativePath);
        referenceWrites.push({
          path: resolvedPath,
          content: referenceContent,
        });
      }

      const skillMarkdown = serializeSkillDocumentMarkdown({
        name: nextSkillId,
        description,
        content: body,
        references,
      });

      this.skillManagerSaving = true;
      this.skillManagerError = '';
      try {
        if (isNewSkill) {
          await createSkillEntry({
            id: nextSkillId,
            description,
            content: skillMarkdown,
          });
          for (let index = 0; index < referenceWrites.length; index += 1) {
            const refWrite = referenceWrites[index];
            await writeSkillMarkdown(refWrite.path, refWrite.content);
          }
          if (!this.isSkillSelected(nextSkillId)) {
            this.toggleSkill(nextSkillId);
          }
          await this.ensureSkillCatalog(true);
          this.skillManagerNewMode = false;
          this.skillManagerSelectedId = nextSkillId;
          await this.selectSkillForManager(nextSkillId);
          Alpine.store('toast')?.success?.(`技能「${nextSkillId}」已创建`);
        } else {
          const currentEntry = this.skillCatalog.find((entry) => entry.id === currentSkillId);
          const idChanged = nextSkillId !== currentEntry.id;
          const wasSelected = this.isSkillSelected(currentEntry.id);

          if (idChanged) {
            await createSkillEntry({
              id: nextSkillId,
              description,
              content: skillMarkdown,
            });
          } else {
            const nextCatalog = this.skillCatalog.map((entry) => (
              entry.id === currentEntry.id
                ? {
                  ...entry,
                  id: nextSkillId,
                  description,
                  path: nextSkillPath,
                }
                : entry
            ));
            const catalogMarkdown = serializeSkillCatalogMarkdown(nextCatalog);
            await writeSkillMarkdown('SKILLS.md', catalogMarkdown);
            await writeSkillMarkdown(nextSkillPath, skillMarkdown);
          }

          for (let index = 0; index < referenceWrites.length; index += 1) {
            const refWrite = referenceWrites[index];
            await writeSkillMarkdown(refWrite.path, refWrite.content);
          }

          if (idChanged) {
            await deleteSkillEntry(currentEntry.id, { deleteFiles: true });
          }

          await this.ensureSkillCatalog(true);
          if (wasSelected && !this.isSkillSelected(nextSkillId)) {
            this.toggleSkill(nextSkillId);
          }
          this.skillManagerSelectedId = nextSkillId;
          await this.selectSkillForManager(nextSkillId);
          Alpine.store('toast')?.success?.(idChanged ? '技能已保存并重命名' : '技能已保存');
        }
      } catch (error) {
        this.skillManagerError = buildEditorError(error, '保存技能失败');
        Alpine.store('toast')?.error?.(this.skillManagerError);
      } finally {
        this.skillManagerSaving = false;
      }
    },

    async openSkillCatalogFile() {
      try {
        const file = await readSkillMarkdown('SKILLS.md');
        openTextEditor({
          title: '编辑 SKILLS.md',
          value: file.content,
          rows: 24,
          onSave: async (draft) => {
            try {
              await writeSkillMarkdown('SKILLS.md', String(draft?.value || ''));
              await this.refreshSkillCatalog();
              Alpine.store('toast')?.success?.('技能目录已保存');
            } catch (error) {
              Alpine.store('toast')?.error?.(error?.message || '保存技能目录失败');
            }
          },
        });
      } catch (error) {
        Alpine.store('toast')?.error?.(error?.message || '读取技能目录失败');
      }
    },

    async openSkillFile(path) {
      if (!path) return;
      try {
        const file = await readSkillMarkdown(path);
        openTextEditor({
          title: `编辑 ${file.path}`,
          value: file.content,
          rows: 24,
          onSave: async (draft) => {
            try {
              await writeSkillMarkdown(file.path, String(draft?.value || ''));
              await this.refreshSkillCatalog();
              Alpine.store('toast')?.success?.('技能文件已保存');
            } catch (error) {
              Alpine.store('toast')?.error?.(error?.message || '保存技能文件失败');
            }
          },
        });
      } catch (error) {
        Alpine.store('toast')?.error?.(error?.message || '读取技能文件失败');
      }
    },

    async showAddSkillGuide() {
      const id = String(window.prompt('输入新技能 ID（如 writing-style）', '') || '').trim();
      if (!id) return;
      const name = String(window.prompt('输入技能名称', id) || '').trim();
      if (!name) return;
      const description = String(window.prompt('输入技能描述', '') || '').trim();
      if (!description) return;

      const initialContent = buildDefaultSkillMarkdown({ name, description });
      openTextEditor({
        title: `新增技能 ${id}`,
        value: initialContent,
        rows: 24,
        onSave: async (draft) => {
          try {
            await createSkillEntry({
              id,
              name,
              description,
              content: String(draft?.value || ''),
            });
            await this.refreshSkillCatalog();
            this.toggleSkill(id);
            Alpine.store('toast')?.success?.(`技能 ${name} 已创建`);
          } catch (error) {
            Alpine.store('toast')?.error?.(error?.message || '创建技能失败');
          }
        },
      });
    },

    async deleteSkill(skill) {
      const skillId = String(skill?.id || '').trim();
      if (!skillId) return;
      const ok = window.confirm(`确定删除技能「${skillId}」吗？`);
      if (!ok) return;

      try {
        await deleteSkillEntry(skillId, { deleteFiles: true });
        if (this.isSkillSelected(skillId)) {
          this.toggleSkill(skillId);
        }
        await this.refreshSkillCatalog();
        Alpine.store('toast')?.success?.('技能已删除');
      } catch (error) {
        Alpine.store('toast')?.error?.(error?.message || '删除技能失败');
      }
    },

    get presets() {
      const hidden = new Set(this.hiddenPresetIds);
      const customMap = new Map(this.customPresets.map((item) => [item.id, item]));
      const merged = [];
      DEFAULT_PRESETS.forEach((preset) => {
        if (hidden.has(preset.id)) return;
        const override = customMap.get(preset.id);
        if (override) {
          merged.push(override);
          customMap.delete(preset.id);
        } else {
          merged.push(preset);
        }
      });
      customMap.forEach((preset) => {
        if (!hidden.has(preset.id)) {
          merged.push(preset);
        }
      });
      return merged;
    },

    get previewOptions() {
      const options = [];
      const data = this.previewCard?.data || {};
      if (data.first_mes) {
        options.push({ id: 'first', label: '主开场白', content: data.first_mes });
      }
      if (Array.isArray(data.alternate_greetings)) {
        data.alternate_greetings.forEach((text, index) => {
          if (text) {
            options.push({
              id: `alt_${index}`,
              label: `备用开场白 ${index + 1}`,
              content: text,
            });
          }
        });
      }
      if (Array.isArray(data.group_only_greetings)) {
        data.group_only_greetings.forEach((text, index) => {
          if (text) {
            options.push({
              id: `group_${index}`,
              label: `群聊开场白 ${index + 1}`,
              content: text,
            });
          }
        });
      }
      if (options.length === 0) {
        options.push({ id: 'empty', label: '暂无开场白', content: '' });
      }
      return options;
    },

    get activeDiffs() {
      if (this.agent.stagingDiffs?.length) return this.agent.stagingDiffs;
      const entry = this.activeDiffEntry;
      return entry?.diffs || [];
    },

    get appliedEntries() {
      return Array.isArray(this.agent?.appliedEntries) ? this.agent.appliedEntries : [];
    },

    get activeDiffEntry() {
      if (this.agent.stagingDiffs?.length) return null;
      const focusId = this.agent?.ui?.diffEntryId;
      if (focusId) {
        const focused = this.appliedEntries.find((entry) => entry.id === focusId);
        if (focused) return focused;
      }
      if (this.agent?.lastApplied?.entryId) {
        const latest = this.appliedEntries.find((entry) => entry.id === this.agent.lastApplied.entryId);
        if (latest) return latest;
      }
      return this.appliedEntries.length ? this.appliedEntries[this.appliedEntries.length - 1] : null;
    },

    get latestAppliedEntryId() {
      const latest = this.appliedEntries.length ? this.appliedEntries[this.appliedEntries.length - 1] : null;
      return latest?.id || null;
    },

    get retryableEntryIdSet() {
      const entries = this.appliedEntries.slice(-10);
      return new Set(entries.map((entry) => entry.id));
    },

    get selectedDiff() {
      const diffs = this.activeDiffs;
      if (!diffs.length) return null;
      if (this.diffSelectedId) {
        const byId = diffs.find((diff) => this.getDiffKey(diff) === this.diffSelectedId);
        if (byId) return byId;
      }
      return diffs[0];
    },

    get diffRows() {
      const diff = this.selectedDiff;
      if (!diff) return [];
      const rows = this.diffLayout === 'split'
        ? this.buildSplitRows(diff)
        : this.buildUnifiedRows(diff);
      return this.diffFold ? this.foldDiffRows(rows) : rows;
    },

    get diffTotals() {
      const totals = { adds: 0, dels: 0 };
      this.activeDiffs.forEach((diff) => {
        const stats = this.computeDiffStats(diff);
        totals.adds += stats.adds;
        totals.dels += stats.dels;
      });
      return totals;
    },

    get diffBrief() {
      const staging = String(this.agent?.stagingSummary || '').trim();
      if (staging) return staging;
      const applied = String(this.activeDiffEntry?.summary || this.agent?.lastApplied?.summary || '').trim();
      if (applied) return applied;
      return '基础修改';
    },

    isDefaultPreset(preset) {
      if (!preset) return true;
      return DEFAULT_PRESETS.some((item) => item.id === preset.id);
    },

    init() {
      const state = loadPresetState();
      this.customPresets = state.customPresets;
      this.hiddenPresetIds = state.hiddenPresetIds;
      syncAgentRefs(this.agent);
      this.syncSkillFeatureState();
      this.ensureSkillCatalog();
      this.diffWrap = true;
      this.syncPreviewSelection();
      this.ensureDiffSelection();
      this.$watch('$store.agent.stagingDiffs', () => {
        this.ensureDiffSelection();
      });
      this.$watch('$store.agent.lastApplied', () => {
        this.ensureDiffSelection();
      });
      this.$watch('$store.agent.appliedEntries', () => {
        this.ensureDiffSelection();
      });
      this.$watch('$store.agent.ui.diffEntryId', () => {
        this.ensureDiffSelection();
      });
      this.$watch('$store.agent.ui.isFullscreen', (open) => {
        const isOpen = Boolean(open);
        this.updatePageScrollLock(isOpen);
        this.applyMobileFullscreenDefaults(isOpen);
      });
      this.$watch('$store.agent.ui.openSkillManager', (open) => {
        if (!open) return;
        this.openSkillManager()
          .finally(() => {
            if (this.agent?.ui) {
              this.agent.ui.openSkillManager = false;
            }
          });
      });
      this.$watch('$store.settings.skillsEnabled', () => {
        this.syncSkillFeatureState();
      });
      if (typeof document !== 'undefined' && this.agent?.ui?.isFullscreen) {
        this.updatePageScrollLock(true);
      }
      if (this.agent?.ui?.openSkillManager) {
        this.openSkillManager()
          .finally(() => {
            if (this.agent?.ui) {
              this.agent.ui.openSkillManager = false;
            }
          });
      }
      this.$nextTick(() => {
        this.restoreChatScrollTopFromStore();
      });
    },

    updatePageScrollLock(locked) {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      const body = document.body;
      if (!root || !body) return;
      const overflowValue = locked ? 'hidden' : '';
      const overscrollValue = locked ? 'none' : '';
      root.style.overflow = overflowValue;
      root.style.overscrollBehavior = overscrollValue;
      body.style.overflow = overflowValue;
      body.style.overscrollBehavior = overscrollValue;
    },

    applyMobileFullscreenDefaults(open) {
      if (!open || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      const isMobile = window.matchMedia('(max-width: 639px)').matches;
      if (!isMobile) return;
      this.diffLayout = 'unified';
      this.diffWrap = true;
      this.diffFold = true;
    },

    syncPreviewSelection() {
      const options = this.previewOptions;
      if (!options.length) {
        this.previewSelection = null;
        return;
      }
      const exists = options.some((item) => item.id === this.previewSelection);
      if (!exists) {
        this.previewSelection = options[0].id;
      }
    },

    ensureDiffSelection() {
      const diffs = this.activeDiffs;
      if (!diffs.length) {
        this.diffSelectedId = null;
        return;
      }
      if (this.diffSelectedId) {
        const exists = diffs.some((diff) => this.getDiffKey(diff) === this.diffSelectedId);
        if (exists) return;
      }
      this.diffSelectedId = this.getDiffKey(diffs[0]);
    },

    getDiffKey(diff) {
      if (!diff) return '';
      if (diff.id) return String(diff.id);
      return `${diff.op || 'update'}:${diff.path || ''}`;
    },

    selectDiffByKey(diffKey, event = null) {
      if (!diffKey) return;
      const currentKey = this.diffSelectedId || this.getDiffKey(this.selectedDiff);
      if (currentKey === diffKey) return;
      const chatScrollTop = this.captureChatScrollTop();
      this.saveChatScrollTop(chatScrollTop);
      this.rememberDiffScrollPosition(currentKey);
      this.diffSelectedId = diffKey;
      this.$nextTick(() => {
        this.restoreDiffScrollPosition(diffKey);
        this.restoreChatScrollTopFromStore();
        if (event?.type === 'click' && typeof event?.currentTarget?.blur === 'function') {
          event.currentTarget.blur();
        }
      });
    },

    getModalRootElement() {
      if (typeof document === 'undefined') return null;
      const rootByCurrent = this.$el?.closest?.('[data-agent-modal-root]');
      if (rootByCurrent) return rootByCurrent;
      if (this.$root?.matches?.('[data-agent-modal-root]')) return this.$root;
      return document.querySelector('[data-agent-modal-root]');
    },

    getChatScrollPane() {
      const root = this.getModalRootElement();
      return root?.querySelector?.('[data-agent-chat-scroll-pane]') || null;
    },

    captureChatScrollTop() {
      const pane = this.getChatScrollPane();
      return pane ? pane.scrollTop : 0;
    },

    saveChatScrollTop(scrollTop = null) {
      if (!this.agent?.ui) return;
      const nextTop = Number.isFinite(scrollTop) ? scrollTop : this.captureChatScrollTop();
      this.agent.ui.fullscreenChatScrollTop = Math.max(0, Number(nextTop) || 0);
    },

    restoreChatScrollTop(scrollTop) {
      const pane = this.getChatScrollPane();
      if (!pane) return;
      const maxTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
      pane.scrollTop = Math.min(Math.max(scrollTop, 0), maxTop);
    },

    restoreChatScrollTopFromStore(attempt = 0) {
      const pane = this.getChatScrollPane();
      const targetTop = Math.max(0, Number(this.agent?.ui?.fullscreenChatScrollTop || 0));
      if (!pane || !pane.isConnected || pane.clientHeight === 0) {
        if (attempt < 24) {
          window.requestAnimationFrame(() => this.restoreChatScrollTopFromStore(attempt + 1));
        }
        return;
      }
      const maxTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
      if (maxTop === 0 && targetTop > 0 && attempt < 24) {
        window.requestAnimationFrame(() => this.restoreChatScrollTopFromStore(attempt + 1));
        return;
      }
      const desiredTop = Math.min(targetTop, maxTop);
      pane.scrollTop = desiredTop;
      if (attempt < 12 && Math.abs(pane.scrollTop - desiredTop) > 1) {
        window.requestAnimationFrame(() => this.restoreChatScrollTopFromStore(attempt + 1));
      }
    },

    getActiveDiffScrollPane() {
      const entryId = this.activeDiffEntry?.id;
      if (!entryId) return null;
      const root = this.getModalRootElement();
      if (!root) return null;
      return root.querySelector(`[data-diff-scroll-pane="${entryId}"]`);
    },

    rememberDiffScrollPosition(diffKey = null) {
      const pane = this.getActiveDiffScrollPane();
      if (!pane) return;
      const key = diffKey || this.diffSelectedId || this.getDiffKey(this.selectedDiff);
      if (!key) return;
      this.diffScrollTopByKey.set(key, pane.scrollTop);
    },

    restoreDiffScrollPosition(diffKey = null) {
      const pane = this.getActiveDiffScrollPane();
      if (!pane) return;
      const key = diffKey || this.diffSelectedId || this.getDiffKey(this.selectedDiff);
      if (!key) return;
      const targetTop = this.diffScrollTopByKey.get(key) ?? 0;
      const maxTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
      pane.scrollTop = Math.min(Math.max(targetTop, 0), maxTop);
    },

    isDiffSelected(index, diffKey) {
      if (this.diffSelectedId) {
        return this.diffSelectedId === diffKey;
      }
      return index === 0;
    },

    resolveEditablePath(path) {
      if (!path) return { field: null, canonicalPath: null };
      const normalized = String(path).replace(/\[(\d+)\]/g, '.$1');
      const parts = normalized.split('.').filter(Boolean);
      for (let i = parts.length; i > 0; i--) {
        const candidate = parts.slice(0, i).join('.');
        const resolved = resolveFieldPath(candidate);
        if (resolved?.field) {
          return { field: resolved.field, canonicalPath: resolved.canonicalPath || candidate };
        }
      }
      return { field: null, canonicalPath: null };
    },

    getItemLabelForField(fieldPath) {
      const labelMap = {
        'data.tags': '标签',
        'data.alternate_greetings': '开场白',
        'data.group_only_greetings': '群聊开场白',
      };
      return labelMap[fieldPath] || '项目';
    },

    getAddLabelForField(fieldPath) {
      const labelMap = {
        'data.tags': '添加标签',
        'data.alternate_greetings': '添加开场白',
        'data.group_only_greetings': '添加群聊开场白',
      };
      return labelMap[fieldPath] || '添加项目';
    },

    applyFieldUpdate(fieldPath, value, title) {
      if (!this.card?.data) return;
      const history = Alpine.store('history');
      history?.push?.(deepClone(this.card.data));
      this.card.updateField(fieldPath, value);
      Alpine.store('toast')?.success?.(`${title}已更新`);
    },

    editDiff(diff) {
      if (!diff?.path) return;
      if (!this.card?.data) {
        Alpine.store('toast')?.error?.('未加载卡片');
        return;
      }
      const resolved = this.resolveEditablePath(diff.path);
      const fieldPath = resolved.canonicalPath || diff.path;
      const fieldMeta = resolved.field;
      const fieldLabel = fieldMeta?.notes || fieldPath;
      const title = fieldLabel.startsWith('编辑') ? fieldLabel : `编辑${fieldLabel}`;
      const value = this.card.getField(fieldPath);

      if (fieldPath === 'data.tags') {
        openTagsEditor({
          title,
          items: Array.isArray(value) ? value : [],
          fieldPath,
          onSave: (draft) => {
            this.applyFieldUpdate(fieldPath, Array.isArray(draft.items) ? draft.items : [], title);
          },
        });
        return;
      }

      if (fieldPath === 'data.character_book') {
        openLorebookEditor({
          title,
          lorebook: value || null,
          onSave: (draft) => {
            this.applyFieldUpdate(fieldPath, draft.lorebook ?? null, title);
          },
        });
        return;
      }

      if (fieldPath === 'data.extensions') {
        Alpine.store('modalStack').push({
          type: 'extensions',
          title,
          size: 'xl',
          data: { value: value || {}, fieldPath },
          onSave: (draft) => {
            this.applyFieldUpdate(fieldPath, draft.value || {}, title);
          },
        });
        return;
      }

      if (fieldMeta?.type === 'array' && fieldMeta.array_item_type === 'string') {
        openArrayEditor({
          title,
          items: Array.isArray(value) ? value : [],
          fieldPath,
          itemLabel: this.getItemLabelForField(fieldPath),
          addLabel: this.getAddLabelForField(fieldPath),
          onSave: (draft) => {
            this.applyFieldUpdate(fieldPath, Array.isArray(draft.items) ? draft.items : [], title);
          },
        });
        return;
      }

      if (fieldMeta?.type === 'string') {
        openTextEditor({
          title,
          value: typeof value === 'string' ? value : value ?? '',
          fieldPath,
          onSave: (draft) => {
            this.applyFieldUpdate(fieldPath, draft.value ?? '', title);
          },
        });
        return;
      }

      Alpine.store('toast')?.info?.('该字段暂不支持在此编辑');
    },

    editSelectedDiff() {
      if (!this.selectedDiff) return;
      this.editDiff(this.selectedDiff);
    },

    canRejectSelectedDiff(entry) {
      if (!entry?.id || !this.selectedDiff) return false;
      if (this.isStreaming) return false;
      if (this.selectedDiff.resource && this.selectedDiff.resource !== 'card_field') return false;
      return entry.id === this.latestAppliedEntryId;
    },

    async rejectSelectedDiff(entry) {
      if (!entry?.id || !this.selectedDiff) return;
      if (!this.canRejectSelectedDiff(entry)) {
        Alpine.store('toast')?.info?.('仅支持对最新一条变更执行“本项撤销”');
        return;
      }

      const result = await runtime.rejectEntryDiff(entry.id, this.getDiffKey(this.selectedDiff));
      if (!result?.ok) {
        Alpine.store('toast')?.error?.(result?.message || '本项撤销失败');
        return;
      }

      Alpine.store('toast')?.success?.('已撤销该变更项');
      this.ensureDiffSelection();
      this.$nextTick(() => {
        this.restoreDiffScrollPosition();
      });
    },


    setDiffLayout(layout) {
      this.diffLayout = layout === 'unified' ? 'unified' : 'split';
    },

    toggleDiffCollapsed() {
      this.diffCollapsed = !this.diffCollapsed;
      if (!this.diffCollapsed) {
        this.$nextTick(() => {
          this.restoreDiffScrollPosition();
        });
      }
    },

    clearDiffSearch() {
      this.diffSearch = '';
      this.diffInlineCache.clear();
    },

    getAppliedEntryByAssistantMessage(message) {
      if (!message?.id) return null;
      return this.appliedEntries.find((entry) => entry.assistantMessageId === message.id) || null;
    },

    getAppliedEntryByUserMessage(message) {
      if (!message?.id) return null;
      return this.appliedEntries.find((entry) => entry.userMessageId === message.id) || null;
    },

    getLatestUserMessage() {
      const messages = Array.isArray(this.agent?.chat?.messages) ? this.agent.chat.messages : [];
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (msg?.role === 'user') return msg;
      }
      return null;
    },

    isSameMessage(left, right) {
      if (!left || !right) return false;
      if (left.id && right.id) return left.id === right.id;
      return left.ts === right.ts && String(left.content || '') === String(right.content || '');
    },

    canRetryLatestUserMessageWithoutEntry(message) {
      if (!message || message.role !== 'user') return false;
      if (this.isStreaming) return false;
      const latest = this.getLatestUserMessage();
      if (!latest || !this.isSameMessage(latest, message)) return false;
      return !this.getAppliedEntryByUserMessage(message);
    },

    isLatestUndoEntry(entry) {
      if (!entry?.id) return false;
      return entry.id === this.latestAppliedEntryId;
    },

    canRetryMessage(message) {
      if (!message || message.role !== 'user') return false;
      if (this.isStreaming) return false;
      const entry = this.getAppliedEntryByUserMessage(message);
      if (entry?.id) {
        return this.retryableEntryIdSet.has(entry.id);
      }
      if (
        String(this.agent?.runtime?.lastUserInput || '').trim()
        && String(this.agent?.runtime?.lastUserInput || '').trim() === String(message.content || '').trim()
      ) {
        const latest = this.getLatestUserMessage();
        if (latest && this.isSameMessage(latest, message)) {
          return true;
        }
      }
      return this.canRetryLatestUserMessageWithoutEntry(message);
    },

    isEntryDiffOpen(entry) {
      if (!entry?.id) return false;
      return Boolean(this.diffPanelOpen && this.activeDiffEntry?.id === entry.id);
    },

    viewEntryDiff(entryId) {
      if (!entryId || !this.agent?.ui) return;
      this.saveChatScrollTop();
      if (this.diffPanelOpen && this.activeDiffEntry?.id === entryId) {
        this.diffPanelOpen = false;
        this.clearUndoConfirm();
        return;
      }
      this.agent.ui.diffEntryId = entryId;
      this.diffPanelOpen = true;
      this.diffCollapsed = false;
      this.ensureDiffSelection();
      this.$nextTick(() => {
        this.restoreDiffScrollPosition();
        this.restoreChatScrollTopFromStore();
      });
    },

    copyMessage(message) {
      const content = String(message?.content || '');
      if (!content) return;
      navigator.clipboard.writeText(content)
        .then(() => {
          Alpine.store('toast')?.success?.('已复制消息');
        })
        .catch(() => {
          Alpine.store('toast')?.error?.('复制失败');
        });
    },

    editUserMessage(message) {
      if (!message || message.role !== 'user') return;
      openTextEditor({
        title: '编辑消息',
        value: String(message.content || ''),
        fieldPath: 'agent.chat.user_message',
        onSave: (draft) => {
          message.content = String(draft?.value ?? '');
        },
      });
    },

    retryFromMessage(message) {
      if (!message || message.role !== 'user') return;
      const entry = this.getAppliedEntryByUserMessage(message);
      if (!entry) {
        if (!this.canRetryLatestUserMessageWithoutEntry(message)) {
          Alpine.store('toast')?.info?.('该消息暂无可重试变更');
          return;
        }
        runtime.sendMessage(String(message.content || ''), {
          skipUserMessage: true,
          sourceUserMessageId: message.id,
        });
        return;
      }
      if (!this.retryableEntryIdSet.has(entry.id)) {
        Alpine.store('toast')?.info?.('仅支持最近 10 条变更消息重试');
        return;
      }
      const ok = runtime.retryFromEntry(entry.id, {
        messageText: String(message.content || ''),
      });
      if (!ok) {
        Alpine.store('toast')?.error?.('重试失败');
      }
    },

    undoEntry(entryId) {
      if (!entryId) return;
      if (!runtime.undoAppliedEntry(entryId, { removeSummaryMessage: true })) {
        Alpine.store('toast')?.info?.('仅最新变更可撤销');
        return;
      }
      Alpine.store('toast')?.info?.('已撤销');
    },

    getEntryTotals(entry) {
      const totals = { adds: 0, dels: 0 };
      const diffs = Array.isArray(entry?.diffs) ? entry.diffs : [];
      diffs.forEach((diff) => {
        const stats = this.computeDiffStats(diff);
        totals.adds += stats.adds;
        totals.dels += stats.dels;
      });
      return totals;
    },

    computeDiffStats(diff) {
      if (!diff) return { adds: 0, dels: 0 };
      const cacheKey = diff.id || this.getDiffKey(diff);
      const beforeText = this.normalizeDiffText(diff.before);
      const afterText = this.normalizeDiffText(diff.after);
      const cached = this.diffCache.get(cacheKey);
      if (
        cached
        && cached.beforeText === beforeText
        && cached.afterText === afterText
        && cached.stats
      ) {
        return cached.stats;
      }

      const beforeLines = this.splitLines(beforeText);
      const afterLines = this.splitLines(afterText);
      const ops = this.buildLineOps(beforeLines, afterLines);
      const stats = { adds: 0, dels: 0 };

      if (!ops) {
        stats.adds = afterLines.length;
        stats.dels = beforeLines.length;
      } else {
        ops.forEach((op) => {
          if (op.type === 'add') stats.adds += 1;
          if (op.type === 'del') stats.dels += 1;
        });
      }

      this.diffCache.set(cacheKey, {
        beforeText,
        afterText,
        unifiedRows: cached?.unifiedRows ?? null,
        splitRows: cached?.splitRows ?? null,
        stats,
      });

      return stats;
    },

    normalizeDiffText(value) {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    },

    splitLines(text) {
      return splitDiffLines(text);
    },

    escapeHtml(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    escapeRegExp(text) {
      return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    highlightSearchInEscaped(escapedText) {
      const query = String(this.diffSearch || '').trim();
      if (!query) return escapedText;
      const regex = new RegExp(this.escapeRegExp(query), 'gi');
      return escapedText.replace(regex, (match) => (
        `<mark class="rounded bg-warning-light text-warning-dark dark:bg-warning-dark dark:text-warning-light px-0.5">${match}</mark>`
      ));
    },

    renderEscapedSegment(text) {
      return this.highlightSearchInEscaped(this.escapeHtml(text ?? ''));
    },

    buildInlineDiffPair(leftText, rightText) {
      const leftRaw = String(leftText ?? '');
      const rightRaw = String(rightText ?? '');

      if (!leftRaw && !rightRaw) {
        return { leftHtml: '', rightHtml: '' };
      }

      if (leftRaw === rightRaw) {
        const same = this.renderEscapedSegment(leftRaw);
        return { leftHtml: same, rightHtml: same };
      }

      const minLen = Math.min(leftRaw.length, rightRaw.length);
      let prefix = 0;
      while (prefix < minLen && leftRaw[prefix] === rightRaw[prefix]) {
        prefix += 1;
      }

      let leftSuffix = leftRaw.length - 1;
      let rightSuffix = rightRaw.length - 1;
      while (
        leftSuffix >= prefix
        && rightSuffix >= prefix
        && leftRaw[leftSuffix] === rightRaw[rightSuffix]
      ) {
        leftSuffix -= 1;
        rightSuffix -= 1;
      }

      const leftBefore = leftRaw.slice(0, prefix);
      const leftChanged = leftRaw.slice(prefix, leftSuffix + 1);
      const leftAfter = leftRaw.slice(leftSuffix + 1);
      const rightBefore = rightRaw.slice(0, prefix);
      const rightChanged = rightRaw.slice(prefix, rightSuffix + 1);
      const rightAfter = rightRaw.slice(rightSuffix + 1);

      const leftChangedHtml = leftChanged
        ? `<span class="rounded px-0.5 agent-diff-inline-del">${this.renderEscapedSegment(leftChanged)}</span>`
        : '';
      const rightChangedHtml = rightChanged
        ? `<span class="rounded px-0.5 agent-diff-inline-add">${this.renderEscapedSegment(rightChanged)}</span>`
        : '';

      return {
        leftHtml: `${this.renderEscapedSegment(leftBefore)}${leftChangedHtml}${this.renderEscapedSegment(leftAfter)}`,
        rightHtml: `${this.renderEscapedSegment(rightBefore)}${rightChangedHtml}${this.renderEscapedSegment(rightAfter)}`,
      };
    },

    getInlineDiffPair(leftText, rightText) {
      const queryKey = String(this.diffSearch || '').trim().toLowerCase();
      const cacheKey = `${leftText ?? ''}\u0000${rightText ?? ''}\u0000${queryKey}`;
      const cached = this.diffInlineCache.get(cacheKey);
      if (cached) return cached;

      const pair = this.buildInlineDiffPair(leftText, rightText);
      this.diffInlineCache.set(cacheKey, pair);
      if (this.diffInlineCache.size > 400) {
        this.diffInlineCache.clear();
        this.diffInlineCache.set(cacheKey, pair);
      }
      return pair;
    },

    renderSplitCellText(side, row) {
      if (!row) return '';
      const leftText = row.leftText ?? '';
      const rightText = row.rightText ?? '';
      if (row.leftType === 'del' && row.rightType === 'add' && leftText && rightText) {
        const pair = this.getInlineDiffPair(leftText, rightText);
        return side === 'left' ? pair.leftHtml : pair.rightHtml;
      }
      return this.renderDiffText(side === 'left' ? leftText : rightText);
    },

    renderDiffText(text) {
      return this.renderEscapedSegment(text ?? '');
    },

    renderMessageContent(content) {
      if (!content) return '';
      return sanitizeHTML(renderMarkdown(content));
    },

    getActivityTraceKey(message) {
      if (!message) return '';
      return String(message.id || message.ts || '');
    },

    getMessageActivityTrace(message) {
      if (!Array.isArray(message?.activityTrace)) return [];
      return message.activityTrace.filter((step) => step?.kind === 'tool' || step?.kind === 'thinking');
    },

    hasMessageActivityTrace(message) {
      return this.getMessageActivityTrace(message).length > 0;
    },

    isMessageActivityOpen(message) {
      const key = this.getActivityTraceKey(message);
      if (!key) return false;
      return Boolean(this.openActivityTraceIds[key]);
    },

    toggleMessageActivity(message) {
      const key = this.getActivityTraceKey(message);
      if (!key) return;
      const next = !this.openActivityTraceIds[key];
      this.openActivityTraceIds = {
        ...this.openActivityTraceIds,
        [key]: next,
      };
    },

    getMessageActivitySummary(message) {
      const steps = this.getMessageActivityTrace(message);
      if (!steps.length) return '无活动';
      const thinkingCount = steps.filter((step) => step?.kind === 'thinking').length;
      const toolCount = steps.filter((step) => step?.kind === 'tool').length;
      if (thinkingCount > 0) {
        return `${steps.length} 步 · ${toolCount} 工具 · ${thinkingCount} 思考`;
      }
      return `${toolCount} 次工具调用`;
    },

    isThinkingStep(step) {
      return step?.kind === 'thinking';
    },

    getActivityStepTitle(step) {
      if (!step) return '活动';
      if (step.kind === 'thinking') return 'Thinking';
      if (step.kind === 'tool') return `Tool · ${step.toolName || 'unknown'}`;
      return '活动';
    },

    getActivityStepMeta(step) {
      if (!step) return '';
      if (step.kind === 'thinking') {
        const length = String(step.text || '').trim().length;
        return length > 0 ? `${length} 字` : '思考摘要';
      }
      const parts = [];
      if (step.status === 'ok') {
        parts.push('成功');
      } else {
        parts.push(step.errorCode ? `失败 (${step.errorCode})` : '失败');
      }
      if (Number.isFinite(step.durationMs)) {
        parts.push(`${step.durationMs}ms`);
      }
      if (step.path) {
        parts.push(step.path);
      }
      return parts.join(' · ');
    },

    buildLineOps(beforeLines, afterLines) {
      const maxLines = Math.max(beforeLines.length, afterLines.length);
      if (maxLines > DIFF_MAX_LCS_LINES) {
        return null;
      }

      const n = beforeLines.length;
      const m = afterLines.length;
      const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          if (beforeLines[i] === afterLines[j]) {
            dp[i][j] = dp[i + 1][j + 1] + 1;
          } else {
            dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
          }
        }
      }

      const ops = [];
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (beforeLines[i] === afterLines[j]) {
          ops.push({ type: 'context', text: beforeLines[i] });
          i += 1;
          j += 1;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
          ops.push({ type: 'del', text: beforeLines[i] });
          i += 1;
        } else {
          ops.push({ type: 'add', text: afterLines[j] });
          j += 1;
        }
      }
      while (i < n) {
        ops.push({ type: 'del', text: beforeLines[i] });
        i += 1;
      }
      while (j < m) {
        ops.push({ type: 'add', text: afterLines[j] });
        j += 1;
      }
      return ops;
    },

    buildUnifiedRows(diff) {
      const diffKey = diff.id || this.getDiffKey(diff);
      const beforeText = this.normalizeDiffText(diff.before);
      const afterText = this.normalizeDiffText(diff.after);
      const cached = this.diffCache.get(diffKey);
      if (cached && cached.beforeText === beforeText && cached.afterText === afterText && cached.unifiedRows) {
        return cached.unifiedRows;
      }

      const beforeLines = this.splitLines(beforeText);
      const afterLines = this.splitLines(afterText);
      const ops = this.buildLineOps(beforeLines, afterLines);
      const rows = [];
      let leftNo = 1;
      let rightNo = 1;

      if (!ops) {
        rows.push({
          type: 'notice',
          key: `${diffKey}_u_notice_large`,
          text: '内容较长，已按整体展示。',
        });
        const limitedBefore = beforeLines.slice(0, DIFF_MAX_RENDER_LINES);
        const limitedAfter = afterLines.slice(0, DIFF_MAX_RENDER_LINES);
        limitedBefore.forEach((line, index) => {
          rows.push({
            type: 'del',
            leftNo,
            rightNo: null,
            leftText: line,
            rightText: '',
            key: `${diffKey}_u_del_${index}`,
          });
          leftNo += 1;
        });
        if (beforeLines.length > DIFF_MAX_RENDER_LINES) {
          rows.push({
            type: 'notice',
            key: `${diffKey}_u_notice_before_truncate`,
            text: `旧内容已省略 ${beforeLines.length - DIFF_MAX_RENDER_LINES} 行`,
          });
        }
        limitedAfter.forEach((line, index) => {
          rows.push({
            type: 'add',
            leftNo: null,
            rightNo,
            leftText: '',
            rightText: line,
            key: `${diffKey}_u_add_${index}`,
          });
          rightNo += 1;
        });
        if (afterLines.length > DIFF_MAX_RENDER_LINES) {
          rows.push({
            type: 'notice',
            key: `${diffKey}_u_notice_after_truncate`,
            text: `新内容已省略 ${afterLines.length - DIFF_MAX_RENDER_LINES} 行`,
          });
        }
        this.diffCache.set(diffKey, {
          beforeText,
          afterText,
          unifiedRows: rows,
          splitRows: cached?.splitRows ?? null,
          stats: cached?.stats ?? null,
        });
        return rows;
      }

      ops.forEach((op, index) => {
        if (op.type === 'context') {
          rows.push({
            type: 'context',
            leftNo,
            rightNo,
            leftText: op.text,
            rightText: op.text,
            key: `${diffKey}_u_ctx_${index}`,
          });
          leftNo += 1;
          rightNo += 1;
          return;
        }
        if (op.type === 'del') {
          rows.push({
            type: 'del',
            leftNo,
            rightNo: null,
            leftText: op.text,
            rightText: '',
            key: `${diffKey}_u_del_${index}`,
          });
          leftNo += 1;
          return;
        }
        rows.push({
          type: 'add',
          leftNo: null,
          rightNo,
          leftText: '',
          rightText: op.text,
          key: `${diffKey}_u_add_${index}`,
        });
        rightNo += 1;
      });

      this.diffCache.set(diffKey, {
        beforeText,
        afterText,
        unifiedRows: rows,
        splitRows: cached?.splitRows ?? null,
        stats: cached?.stats ?? null,
      });
      return rows;
    },

    buildSplitRows(diff) {
      const diffKey = diff.id || this.getDiffKey(diff);
      const beforeText = this.normalizeDiffText(diff.before);
      const afterText = this.normalizeDiffText(diff.after);
      const cached = this.diffCache.get(diffKey);
      if (cached && cached.beforeText === beforeText && cached.afterText === afterText && cached.splitRows) {
        return cached.splitRows;
      }

      const beforeLines = this.splitLines(beforeText);
      const afterLines = this.splitLines(afterText);
      const ops = this.buildLineOps(beforeLines, afterLines);
      const rows = ops
        ? this.buildSplitRowsFromOps(diff, ops)
        : this.buildSplitRowsFallback(diff, beforeLines, afterLines);

      this.diffCache.set(diffKey, {
        beforeText,
        afterText,
        splitRows: rows,
        unifiedRows: cached?.unifiedRows ?? null,
        stats: cached?.stats ?? null,
      });
      return rows;
    },

    buildSplitRowsFromOps(diff, ops) {
      const diffKey = diff.id || this.getDiffKey(diff);
      const rows = [];
      let leftNo = 1;
      let rightNo = 1;
      let pendingDel = [];
      let pendingAdd = [];

      const flush = () => {
        if (pendingDel.length === 0 && pendingAdd.length === 0) return;
        const count = Math.max(pendingDel.length, pendingAdd.length);
        for (let i = 0; i < count; i += 1) {
          const leftText = pendingDel[i] ?? '';
          const rightText = pendingAdd[i] ?? '';
          const leftHas = leftText !== '';
          const rightHas = rightText !== '';
          const row = {
            type: 'change',
            leftType: leftHas ? 'del' : 'empty',
            rightType: rightHas ? 'add' : 'empty',
            leftNo: leftHas ? leftNo : null,
            rightNo: rightHas ? rightNo : null,
            leftText,
            rightText,
            key: `${diffKey}_s_change_${rows.length}`,
          };
          rows.push(row);
          if (leftHas) leftNo += 1;
          if (rightHas) rightNo += 1;
        }
        pendingDel = [];
        pendingAdd = [];
      };

      ops.forEach((op) => {
        if (op.type === 'context') {
          flush();
          rows.push({
            type: 'context',
            leftType: 'context',
            rightType: 'context',
            leftNo,
            rightNo,
            leftText: op.text,
            rightText: op.text,
            key: `${diffKey}_s_ctx_${rows.length}`,
          });
          leftNo += 1;
          rightNo += 1;
          return;
        }
        if (op.type === 'del') {
          pendingDel.push(op.text);
          return;
        }
        pendingAdd.push(op.text);
      });

      flush();
      return rows;
    },

    buildSplitRowsFallback(diff, beforeLines, afterLines) {
      const diffKey = diff.id || this.getDiffKey(diff);
      const rows = [];
      let leftNo = 1;
      let rightNo = 1;

      rows.push({
        type: 'notice',
        key: `${diffKey}_s_notice_large`,
        text: '内容较长，已按整体展示。',
      });

      const limitedBefore = beforeLines.slice(0, DIFF_MAX_RENDER_LINES);
      const limitedAfter = afterLines.slice(0, DIFF_MAX_RENDER_LINES);
      const maxLines = Math.max(limitedBefore.length, limitedAfter.length);
      for (let i = 0; i < maxLines; i += 1) {
        const leftText = limitedBefore[i] ?? '';
        const rightText = limitedAfter[i] ?? '';
        const leftHas = leftText !== '';
        const rightHas = rightText !== '';
        const isContext = leftHas && rightHas && leftText === rightText;
        rows.push({
          type: isContext ? 'context' : 'change',
          leftType: isContext ? 'context' : leftHas ? 'del' : 'empty',
          rightType: isContext ? 'context' : rightHas ? 'add' : 'empty',
          leftNo: leftHas ? leftNo : null,
          rightNo: rightHas ? rightNo : null,
          leftText,
          rightText,
          key: `${diffKey}_s_fallback_${i}`,
        });
        if (leftHas) leftNo += 1;
        if (rightHas) rightNo += 1;
      }

      if (beforeLines.length > DIFF_MAX_RENDER_LINES) {
        rows.push({
          type: 'notice',
          key: `${diffKey}_s_notice_before_truncate`,
          text: `旧内容已省略 ${beforeLines.length - DIFF_MAX_RENDER_LINES} 行`,
        });
      }
      if (afterLines.length > DIFF_MAX_RENDER_LINES) {
        rows.push({
          type: 'notice',
          key: `${diffKey}_s_notice_after_truncate`,
          text: `新内容已省略 ${afterLines.length - DIFF_MAX_RENDER_LINES} 行`,
        });
      }

      return rows;
    },

    foldDiffRows(rows) {
      const folded = [];
      let i = 0;
      while (i < rows.length) {
        const row = rows[i];
        if (row.type !== 'context') {
          folded.push(row);
          i += 1;
          continue;
        }
        let j = i;
        while (j < rows.length && rows[j].type === 'context') {
          j += 1;
        }
        const runLength = j - i;
        if (runLength <= DIFF_FOLD_CONTEXT_LINES * 2 + 1) {
          for (let k = i; k < j; k += 1) {
            folded.push(rows[k]);
          }
          i = j;
          continue;
        }
        for (let k = i; k < i + DIFF_FOLD_CONTEXT_LINES; k += 1) {
          folded.push(rows[k]);
        }
        const startLeft = rows[i + DIFF_FOLD_CONTEXT_LINES]?.leftNo;
        const endLeft = rows[j - DIFF_FOLD_CONTEXT_LINES - 1]?.leftNo;
        const startRight = rows[i + DIFF_FOLD_CONTEXT_LINES]?.rightNo;
        const endRight = rows[j - DIFF_FOLD_CONTEXT_LINES - 1]?.rightNo;
        const anchorKey = rows[i]?.key || `${i}`;
        folded.push({
          type: 'fold',
          key: `fold_${anchorKey}_${i}_${j}`,
          count: runLength - DIFF_FOLD_CONTEXT_LINES * 2,
          startLeft,
          endLeft,
          startRight,
          endRight,
        });
        for (let k = j - DIFF_FOLD_CONTEXT_LINES; k < j; k += 1) {
          folded.push(rows[k]);
        }
        i = j;
      }
      return folded;
    },

    autoResize(event) {
      const el = event?.target;
      if (!el) return;
      if (el.getClientRects().length === 0 && !el.value) return;
      const maxHeight = Number(el.dataset?.maxHeight || 140);
      const styles = window.getComputedStyle(el);
      const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
      const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
      const minHeight = lineHeight + paddingTop + paddingBottom;
      el.style.height = 'auto';
      const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
      const contentHeight = Math.max(el.scrollHeight - paddingTop - paddingBottom, lineHeight);
      const lineCount = Math.max(1, Math.floor((contentHeight - 1) / lineHeight) + 1);
      this.isMultiline = lineCount > 1;
    },

    autoResizePresetPrompt(event) {
      const el = event?.target;
      if (!el) return;
      if (el.getClientRects().length === 0 && !el.value) return;
      const styles = window.getComputedStyle(el);
      const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
      const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
      const minHeight = Math.max(180, lineHeight * 5 + paddingTop + paddingBottom);
      const maxHeight = Math.max(minHeight, Math.floor(window.innerHeight * 0.6));
      el.style.height = 'auto';
      const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = el.scrollHeight > nextHeight ? 'auto' : 'hidden';
    },

    sendMessage() {
      runtime.sendMessage(this.agent.chat.input);
    },

    handleChatInputKeydown(event) {
      if (!event || event.key !== 'Enter' || event.isComposing) return;
      if (!(event.ctrlKey || event.shiftKey || event.metaKey)) return;
      event.preventDefault();
      if (this.isStreaming) {
        this.stopStreaming();
        return;
      }
      if (!String(this.agent?.chat?.input || '').trim()) return;
      this.sendMessage();
    },

    stopStreaming() {
      runtime.stop();
    },

    retryLast() {
      runtime.retryLast();
    },

    async attachRefs(event) {
      const toast = Alpine.store('toast');
      await handleRefUpload({ files: event?.target?.files, agent: this.agent, toast });
      if (event?.target) {
        event.target.value = '';
      }
    },

    removeRef(refId) {
      removeRefById({ refId, agent: this.agent });
    },

    applyPreset(preset) {
      if (!preset?.prompt) return;
      this.agent.chat.input = preset.prompt;
      this.closeHeaderMenus();
    },

    openPresetEditor(preset = null) {
      this.closeHeaderMenus();
      if (preset) {
        this.presetEditorMode = 'edit';
        this.editingPresetId = preset.id;
        this.presetLabel = preset.label || '';
        this.presetPrompt = preset.prompt || '';
      } else {
        this.presetEditorMode = 'add';
        this.editingPresetId = null;
        this.presetLabel = '';
        this.presetPrompt = '';
      }
      this.presetEditorOpen = true;
    },

    closePresetEditor() {
      this.presetEditorOpen = false;
    },

    savePreset() {
      const preset = createCustomPreset({
        label: this.presetLabel,
        prompt: this.presetPrompt,
      });
      if (!preset) return;
      if (this.presetEditorMode === 'edit' && this.editingPresetId) {
        const idx = this.customPresets.findIndex((item) => item.id === this.editingPresetId);
        const updated = { ...preset, id: this.editingPresetId };
        if (idx >= 0) {
          this.customPresets.splice(idx, 1, updated);
        } else {
          this.customPresets.push(updated);
        }
        if (this.isDefaultPreset(updated)) {
          this.hiddenPresetIds = this.hiddenPresetIds.filter((id) => id !== updated.id);
        }
      } else {
        this.customPresets.push(preset);
      }
      savePresetState({
        customPresets: this.customPresets,
        hiddenPresetIds: this.hiddenPresetIds,
      });
      this.presetLabel = '';
      this.presetPrompt = '';
      this.presetEditorOpen = false;
    },

    confirmDeletePreset(preset) {
      if (!preset) return;
      this.presetToDelete = preset;
      this.presetDeleteOpen = true;
      this.closeHeaderMenus();
    },

    cancelDeletePreset() {
      this.presetDeleteOpen = false;
      this.presetToDelete = null;
    },

    deletePresetConfirmed() {
      if (!this.presetToDelete) return;
      const targetId = this.presetToDelete.id;
      if (this.isDefaultPreset(this.presetToDelete)) {
        if (!this.hiddenPresetIds.includes(targetId)) {
          this.hiddenPresetIds.push(targetId);
        }
      }
      this.customPresets = this.customPresets.filter((item) => item.id !== targetId);
      savePresetState({
        customPresets: this.customPresets,
        hiddenPresetIds: this.hiddenPresetIds,
      });
      this.presetDeleteOpen = false;
      this.presetToDelete = null;
    },

    close() {
      this.agent.ui.isFullscreen = false;
      this.closeHeaderMenus();
      this.skillManagerOpen = false;
      this.skillReferencePanelOpen = false;
      this.closeSkillReferenceManager();
      this.skillManagerError = '';
      if (this.agent?.ui) {
        this.agent.ui.openSkillManager = false;
      }
      this.diffPanelOpen = false;
      this.clearUndoConfirm();
    },

    clearUndoConfirm() {
      if (this.undoConfirmTimer) {
        clearTimeout(this.undoConfirmTimer);
        this.undoConfirmTimer = null;
      }
      this.confirmUndo = false;
    },

    requestUndo() {
      if (this.confirmUndo) {
        this.clearUndoConfirm();
        this.undoLast();
        return;
      }
      this.confirmUndo = true;
      if (this.undoConfirmTimer) {
        clearTimeout(this.undoConfirmTimer);
      }
      this.undoConfirmTimer = setTimeout(() => {
        this.confirmUndo = false;
        this.undoConfirmTimer = null;
      }, 2600);
    },

    togglePreview() {
      this.agent.ui.previewPaneOpen = !this.agent.ui.previewPaneOpen;
    },

    undoLast() {
      this.clearUndoConfirm();
      const latestEntryId = this.agent?.lastApplied?.entryId;
      if (latestEntryId && runtime.undoAppliedEntry(latestEntryId, { removeSummaryMessage: true })) {
        Alpine.store('toast')?.info?.('已撤销');
      }
    },

    formatDiffLabel,
    formatDiffValue,
  };
}

export function registerAgentModalComponent() {
  Alpine.data('agentModal', agentModal);
}

export function getAgentModalHTML() {
  return `
    <div x-data="agentModal()"
         x-show="$store.agent.ui.isFullscreen || hasOverlayModalOpen"
         x-cloak
         data-agent-modal-root
         class="fixed inset-0 z-70">
      <div x-show="$store.agent.ui.isFullscreen"
           class="absolute inset-0 bg-zinc-900/70 backdrop-blur-sm"
           @click="close()"></div>
        <div class="relative"
           :class="$store.agent.ui.isFullscreen
             ? 'h-[100dvh] w-full bg-zinc-50 dark:bg-zinc-900 flex p-0 sm:p-4 gap-0 sm:gap-4 pt-[env(safe-area-inset-top)] sm:pt-4 pb-[env(safe-area-inset-bottom)] sm:pb-4'
             : 'h-0 w-0 p-0 gap-0 overflow-hidden'">
        <!-- Main Panel -->
        <div class="flex-1 min-w-0 flex flex-col rounded-none sm:rounded-neo-lg border-0 sm:border border-zinc-200 dark:border-zinc-700 bg-white/95 dark:bg-zinc-800/95 shadow-neo-lift dark:shadow-neo-lift-dark overflow-hidden"
             :class="$store.agent.ui.isFullscreen
               ? ''
               : 'w-0 h-0 min-w-0 min-h-0 border-transparent bg-transparent shadow-none overflow-hidden'">
          <div class="relative z-20 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-6 py-2.5 sm:py-3 border-b border-zinc-200 dark:border-zinc-700">
              <div>
                <h2 class="text-base font-semibold">Agent 模式</h2>
              </div>
              <div class="flex items-center gap-2 flex-wrap justify-end">
                <template x-for="menu in headerMenus" :key="menu.id">
                  <div class="relative">
                    <button @click="toggleHeaderMenu(menu.id)"
                            class="group flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-neo border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/80">
                      <template x-if="menu.id === 'preset'">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h10" />
                        </svg>
                      </template>
                      <template x-if="menu.id === 'skill'">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                          <path stroke-linecap="round" stroke-linejoin="round" d="M18 8.25h.008v.008H18V8.25zm0 0V7.5m0 .75H17.25m.75 0h.75m-.75 0v.75m0 5.25h.008v.008H18v-.008zm0 0V13.5m0 .75h-.75m.75 0h.75m-.75 0v.75" />
                        </svg>
                      </template>
                      <span x-text="menu.label"></span>
                    </button>

                    <div x-show="isHeaderMenuOpen(menu.id)"
                         x-cloak
                         x-transition:enter="transition ease-out duration-180"
                         x-transition:enter-start="opacity-0 -translate-y-1 scale-[0.98]"
                         x-transition:enter-end="opacity-100 translate-y-0 scale-100"
                         x-transition:leave="transition ease-in duration-120"
                         x-transition:leave-start="opacity-100 translate-y-0 scale-100"
                         x-transition:leave-end="opacity-0 -translate-y-1 scale-[0.99]"
                         @click.outside="closeHeaderMenus()"
                         class="fixed left-2.5 right-2.5 sm:left-4 sm:right-4 md:left-6 md:right-6 top-[calc(env(safe-area-inset-top)+3.9rem)] max-h-[min(70dvh,30rem)] overflow-y-auto rounded-neo border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-neo-lift dark:shadow-neo-lift-dark p-3 sm:p-4 z-[85] lg:absolute lg:left-auto lg:right-0 lg:top-full lg:mt-2 lg:w-[24rem] lg:max-h-[28rem] lg:max-w-[24rem]">
                      <template x-if="menu.id === 'preset'">
                        <div>
                          <div class="space-y-2.5 max-h-64 overflow-y-auto overflow-x-hidden custom-scrollbar">
                            <template x-for="preset in presets" :key="preset.id">
                              <div class="flex items-center gap-2 rounded-neo border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-600 dark:text-zinc-300">
                                <button @click="applyPreset(preset)"
                                        :title="preset.prompt"
                                        class="flex-1 min-w-0 text-left">
                                  <div class="flex items-center gap-2 min-w-0">
                                    <span class="font-semibold text-brand dark:text-brand-light shrink-0" x-text="preset.label"></span>
                                    <span class="text-zinc-400 shrink-0">：</span>
                                    <span class="flex-1 min-w-0 truncate text-zinc-500 dark:text-zinc-400" x-text="preset.prompt"></span>
                                  </div>
                                </button>
                                <div class="flex items-center gap-1">
                                  <button @click.stop="openPresetEditor(preset)"
                                          class="btn-icon-ghost h-7 w-7 text-zinc-500 dark:text-zinc-300"
                                          title="编辑预设">
                                    <svg class="w-3.5 h-3.5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                      <path stroke-linecap="round" stroke-linejoin="round" d="M11 5h2m-1-1v2m-7.293 9.293l9.414-9.414a1 1 0 011.414 0l2.586 2.586a1 1 0 010 1.414l-9.414 9.414H6v-2.293z" />
                                    </svg>
                                  </button>
                                  <button @click.stop="confirmDeletePreset(preset)"
                                          class="h-7 w-7 rounded-neo border border-zinc-200 dark:border-zinc-600 text-danger hover:bg-danger-light dark:hover:bg-danger-dark"
                                          title="删除预设">
                                    <svg class="w-3.5 h-3.5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0H7m2-3h6a1 1 0 011 1v1H8V5a1 1 0 011-1z" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            </template>
                          </div>
                          <button @click="openPresetEditor()"
                                  class="btn-secondary mt-3 w-full text-sm px-3 py-2">
                            添加预设
                          </button>
                        </div>
                      </template>

                      <template x-if="menu.id === 'skill'">
                        <div>
                          <div class="flex items-center justify-between gap-2 mb-3">
                            <button @click="refreshSkillCatalogFromMenu()"
                                    :disabled="skillMenuRefreshing"
                                    class="btn-secondary text-xs px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
                              <span x-text="skillMenuRefreshing ? '刷新中…' : '刷新'"></span>
                            </button>
                            <button @click="openSkillManagerFromMenu()"
                                    class="btn-secondary text-xs px-3 py-2">
                              管理
                            </button>
                          </div>

                          <p x-show="skillsState.lastError"
                             x-cloak
                             class="mb-3 text-xs text-danger dark:text-danger-light"
                             x-text="skillsState.lastError"></p>

                          <div class="space-y-2.5 max-h-64 overflow-y-auto overflow-x-hidden custom-scrollbar">
                            <template x-for="skill in skillCatalog" :key="skill.id">
                              <button @click="toggleSkill(skill.id)"
                                      class="w-full flex items-center gap-3 rounded-neo border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3.5 py-2.5 text-left">
                                <span class="flex-1 min-w-0">
                                  <span class="flex items-center gap-1.5 min-w-0">
                                    <span class="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 truncate" x-text="skill.id"></span>
                                    <span x-show="isSkillAutoMatched(skill.id)"
                                          class="shrink-0 text-[10px] px-1.5 py-0.5 rounded-neo bg-warning-light text-warning dark:bg-warning-dark dark:text-warning-light">自动</span>
                                  </span>
                                  <span class="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate" x-text="skill.description"></span>
                                </span>
                                <span class="shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors"
                                      :class="isSkillSelected(skill.id)
                                        ? 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-600'
                                        : 'bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-700 dark:text-zinc-300 dark:border-zinc-600'">
                                  <span class="h-1.5 w-1.5 rounded-full"
                                        :class="isSkillSelected(skill.id)
                                          ? 'bg-brand-600 dark:bg-brand-400'
                                          : 'bg-zinc-400 dark:bg-zinc-500'"></span>
                                  <span x-text="isSkillSelected(skill.id) ? '启用' : '未启用'"></span>
                                </span>
                              </button>
                            </template>
                          </div>

                          <div x-show="!skillCatalog.length" class="text-center py-6 text-[11px] text-zinc-500 dark:text-zinc-400">
                            暂无技能，点击"管理"创建
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>
                </template>
                <button @click="close()" class="btn-secondary gap-1.5 px-3.5 py-1.5 text-sm font-medium">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>关闭</span>
                </button>
              </div>
          </div>

          <!-- Chat / Diff -->
          <div x-ref="chatScrollPane" data-agent-chat-scroll-pane class="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4">
            <div x-show="$store.agent.runtime.error" x-cloak
                 class="rounded-neo border border-danger bg-danger-light text-danger px-3 py-2 text-xs">
              <div x-text="$store.agent.runtime.error"></div>
              <button x-show="$store.agent.runtime.lastUserInput" @click="retryLast()"
                      class="mt-2 text-xs px-2 py-1 rounded-neo bg-danger text-white hover:bg-danger-dark">一键重试</button>
            </div>
              <template x-for="msg in $store.agent.chat.messages" :key="msg.id || msg.ts">
                <div class="flex" :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
                  <div class="group" :class="msg.role === 'user' ? 'max-w-[88%] sm:max-w-[80%]' : 'w-full max-w-full'">
                  <div x-show="msg.role === 'assistant' && showActivityTrace && hasMessageActivityTrace(msg)"
                       x-cloak
                       class="mb-2 w-full lg:w-[44rem] max-w-full sm:max-w-[86%] rounded-neo-lg border border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-100/55 dark:bg-zinc-900/85 shadow-sm overflow-hidden">
                    <button @click="toggleMessageActivity(msg)"
                            class="w-full inline-flex items-center justify-between gap-2 text-sm px-4 py-2 font-medium text-zinc-600 dark:text-zinc-200 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/35">
                      <span class="truncate inline-flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-brand/85"></span>Activity · <span x-text="getMessageActivitySummary(msg)"></span></span>
                      <svg class="w-3.5 h-3.5 transition-transform" :class="isMessageActivityOpen(msg) ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    <div x-show="isMessageActivityOpen(msg)"
                         x-cloak
                         class="px-3.5 pb-3.5 pt-2 space-y-2">
                      <template x-for="(step, idx) in getMessageActivityTrace(msg)" :key="(step.toolCallId || step.kind || 'trace') + '_' + idx">
                        <div class="text-[13px] rounded-neo-lg px-3 py-2.5 border border-zinc-200/70 dark:border-zinc-700/60 bg-white/85 dark:bg-zinc-800/75">
                          <div class="flex items-center justify-between gap-2">
                            <span class="font-semibold text-zinc-700 dark:text-zinc-200" x-text="getActivityStepTitle(step)"></span>
                            <span class="text-xs text-zinc-400 dark:text-zinc-500" x-text="getActivityStepMeta(step)"></span>
                          </div>
                          <p x-show="isThinkingStep(step) && step.text"
                             class="mt-1.5 text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-6"
                             x-text="step.text"></p>
                          <div x-show="Array.isArray(step.warnings) && step.warnings.length" class="mt-1 flex flex-wrap gap-1">
                            <template x-for="warn in (step.warnings || [])" :key="warn">
                              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs bg-warning-light text-warning dark:bg-warning-dark dark:text-warning-light" x-text="warn"></span>
                            </template>
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>

                  <div class="rounded-neo px-4 py-2 text-sm"
                       :class="msg.role === 'user' ? 'bg-brand text-white' : 'inline-block max-w-full sm:max-w-[86%] bg-white/95 dark:bg-zinc-900/70 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 shadow-sm'">
                    <template x-if="msg.role === 'user'">
                      <p class="whitespace-pre-wrap" x-text="msg.content"></p>
                    </template>
                    <template x-if="msg.role === 'assistant'">
                      <div class="agent-markdown prose prose-sm dark:prose-invert max-w-none" x-html="renderMessageContent(msg.content)"></div>
                    </template>
                  </div>

                  <div x-data="{ entry: null }"
                       x-effect="entry = getAppliedEntryByAssistantMessage(msg)"
                       x-show="msg.role === 'assistant' && entry && (getEntryTotals(entry).adds > 0 || getEntryTotals(entry).dels > 0)"
                       x-cloak
                       class="mt-2">
                    <div class="rounded-neo-lg border border-zinc-200/90 dark:border-zinc-700/80 bg-white/95 dark:bg-zinc-900/80 shadow-sm overflow-hidden w-full">
                      <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/55">
                        <div class="min-w-0">
                          <div class="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            <span>变更 Diff</span>
                            <span class="text-xs font-normal text-zinc-500 dark:text-zinc-400" x-text="(entry?.diffs?.length || 0) + ' 处'"></span>
                            <button x-show="isLatestUndoEntry(entry)"
                                    x-cloak
                                    @click.stop="requestUndo()"
                                    class="ml-2 inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-neo border"
                                    :class="confirmUndo
                                      ? 'bg-danger text-white border-danger hover:bg-danger-dark'
                                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70'">
                              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                              </svg>
                              <span x-text="confirmUndo ? '确认撤销' : '撤销'"></span>
                            </button>
                          </div>
                          <div class="mt-1 flex items-center gap-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400 min-w-0">
                            <span class="max-w-[56rem] truncate" x-text="entry?.summary || ''"></span>
                            <span class="px-1.5 py-0.5 rounded agent-diff-stat-add tabular-nums font-semibold" x-text="'+' + getEntryTotals(entry).adds"></span>
                            <span class="px-1.5 py-0.5 rounded agent-diff-stat-del tabular-nums font-semibold" x-text="'-' + getEntryTotals(entry).dels"></span>
                          </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-3">
                          <div x-show="isEntryDiffOpen(entry)" x-cloak class="flex flex-wrap items-center gap-3">
                            <div class="flex items-center rounded-neo border border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/70 overflow-hidden text-xs">
                              <button @click="setDiffLayout('unified')"
                                      class="px-2.5 py-1.5"
                                      :class="diffLayout === 'unified' ? 'bg-brand dark:bg-brand-600 text-white shadow-inner' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/70'">统一</button>
                              <button @click="setDiffLayout('split')"
                                      class="px-2.5 py-1.5"
                                      :class="diffLayout === 'split' ? 'bg-brand dark:bg-brand-600 text-white shadow-inner' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/70'">分屏</button>
                            </div>
                            <button @click="diffFold = !diffFold"
                                    class="px-2.5 py-1.5 text-xs rounded-neo border"
                                    :class="diffFold ? 'bg-brand text-white border-brand shadow-sm' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70'">
                              折叠未改行
                            </button>
                                     <div class="relative">
                               <input x-model="diffSearch"
                                     class="w-32 sm:w-44 rounded-neo border border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/80 px-2.5 py-1.5 text-xs text-zinc-700 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none"
                                     placeholder="搜索">
                              <button x-show="diffSearch" @click="clearDiffSearch()"
                            class="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 rounded-neo text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/70">
                                <svg class="w-3 h-3 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <button @click="viewEntryDiff(entry?.id)"
                                  class="px-2.5 py-1.5 text-xs rounded-neo border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70">
                            <span x-text="isEntryDiffOpen(entry) ? '收起' : '展开'"></span>
                          </button>
                        </div>
                      </div>
                      <div x-show="isEntryDiffOpen(entry)" x-cloak class="flex flex-col sm:flex-row overflow-visible">
                        <aside class="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/35 relative z-10 pointer-events-auto">
                          <div class="px-3 py-2 text-[11px] uppercase tracking-wide text-zinc-400">变更项</div>
                          <template x-for="(diff, index) in activeDiffs" :key="getDiffKey(diff)">
                            <div @pointerdown.prevent
                                 @mousedown.prevent
                                 @click.prevent.stop="selectDiffByKey(getDiffKey(diff), $event)"
                                 @keydown.enter.prevent="selectDiffByKey(getDiffKey(diff), $event)"
                                 @keydown.space.prevent="selectDiffByKey(getDiffKey(diff), $event)"
                                 role="button"
                                 tabindex="0"
                                 class="agent-diff-item flex items-start gap-2 px-3 py-1.5 border-l-2 transition cursor-pointer"
                                 :class="isDiffSelected(index, getDiffKey(diff)) ? 'agent-diff-item-selected' : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/65'">
                               <div class="flex-1 min-w-0">
                                 <div class="flex items-start gap-3">
                                   <span class="px-1 py-[1px] rounded text-[8px] font-semibold uppercase tracking-[0.08em] shrink-0"
                                         :class="{
                                          'bg-info-light text-info dark:bg-info-dark dark:text-info-light': diff.op === 'set' || diff.op === 'update',
                                          'agent-diff-op-add': diff.op === 'append' || diff.op === 'add',
                                          'agent-diff-op-remove': diff.op === 'remove',
                                          'agent-diff-op-move': diff.op === 'move'
                                          }"
                                         x-text="diff.op"></span>
                                   <div class="min-w-0">
                                    <div class="agent-diff-item-title text-xs font-semibold text-zinc-700 dark:text-zinc-100 truncate" x-text="formatDiffLabel(diff.op, diff.path)"></div>
                                    <div class="agent-diff-item-path text-[11px] text-zinc-500 dark:text-zinc-400 truncate" x-text="diff.path"></div>
                                   </div>
                                 </div>
                               </div>
                            </div>
                          </template>
                        </aside>
                        <div class="flex-1 min-w-0 flex flex-col">
                          <div class="flex items-center justify-between gap-3 px-4 py-2 border-b border-zinc-200/80 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40">
                            <div class="min-w-0">
                              <div class="text-[11px] text-zinc-500 dark:text-zinc-400">当前字段</div>
                              <div class="mt-0.5 flex items-center gap-2 min-w-0">
                                <div class="text-sm font-semibold text-zinc-700 dark:text-zinc-200 truncate" x-text="selectedDiff ? formatDiffLabel(selectedDiff.op, selectedDiff.path) : ''"></div>
                                <button type="button"
                                        @click="rejectSelectedDiff(entry)"
                                        :disabled="!selectedDiff || !canRejectSelectedDiff(entry)"
                                        class="px-2.5 py-1.5 text-xs rounded-neo border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 shrink-0">
                                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                  </svg>
                                  <span>本项撤销</span>
                                </button>
                              </div>
                            </div>
                            <div class="flex items-center gap-2 min-w-0">
                              <div class="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-[45%] truncate" x-text="selectedDiff?.path || ''"></div>
                              <div x-show="selectedDiff" x-cloak class="flex items-center gap-1 text-xs font-semibold tabular-nums">
                                <span class="px-1.5 py-0.5 rounded agent-diff-stat-add tabular-nums font-semibold" x-text="'+' + computeDiffStats(selectedDiff).adds"></span>
                                <span class="px-1.5 py-0.5 rounded agent-diff-stat-del tabular-nums font-semibold" x-text="'-' + computeDiffStats(selectedDiff).dels"></span>
                              </div>
                               <button type="button" @click="editSelectedDiff()" :disabled="!selectedDiff"
                                       class="px-2.5 py-1.5 text-xs rounded-neo border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 disabled:opacity-50">
                                 编辑字段
                               </button>
                            </div>
                          </div>
                          <div :data-diff-scroll-pane="entry?.id" class="overflow-y-visible" :class="diffWrap ? 'overflow-x-hidden' : 'overflow-x-auto'">
                            <div x-show="diffLayout === 'unified'" x-cloak class="font-mono text-sm leading-6 text-zinc-700 dark:text-zinc-200">
                              <template x-for="row in diffRows" :key="row.key">
                                <div>
                                  <template x-if="row.type === 'fold'">
                                    <div class="py-1 text-center text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50/70 dark:bg-zinc-900/40"><span x-text="'@@ 已折叠 ' + row.count + ' 行 @@'"></span></div>
                                  </template>
                                  <template x-if="row.type === 'notice'">
                                    <div class="py-1 text-center text-xs text-warning dark:text-warning-light bg-warning-light/70 dark:bg-warning-dark/40" x-text="row.text"></div>
                                  </template>
                                  <template x-if="row.type !== 'fold' && row.type !== 'notice'">
                                    <div class="flex items-center border-b border-zinc-200/50 dark:border-zinc-800/70 border-l-2"
                                         :class="row.type === 'add' ? 'agent-diff-row-add' : row.type === 'del' ? 'agent-diff-row-del' : 'border-transparent'">
                                      <div class="w-11 shrink-0 pr-3 flex items-center justify-end text-right text-xs tabular-nums select-none" :class="row.type === 'del' ? 'agent-diff-gutter-del' : 'text-zinc-400/80'" x-text="row.leftNo ?? ''"></div>
                                      <div class="w-11 shrink-0 pr-3 flex items-center justify-end text-right text-xs tabular-nums select-none border-r border-zinc-200/80 dark:border-zinc-700" :class="row.type === 'add' ? 'agent-diff-gutter-add' : 'text-zinc-400/80'" x-text="row.rightNo ?? ''"></div>
                                      <div class="w-6 shrink-0 flex items-center justify-start pl-1 text-center text-sm leading-none select-none" :class="row.type === 'add' ? 'agent-diff-sign-add' : row.type === 'del' ? 'agent-diff-sign-del' : 'text-transparent'" x-text="row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '"></div>
                                      <div class="flex-1 min-w-0 pl-2 pr-2 py-0.5" :class="diffWrap ? 'whitespace-pre-wrap break-all [overflow-wrap:anywhere]' : 'whitespace-pre'" x-html="renderDiffText(row.type === 'add' ? row.rightText : row.leftText)"></div>
                                    </div>
                                  </template>
                                </div>
                              </template>
                            </div>
                            <div x-show="diffLayout === 'split'" x-cloak class="font-mono text-sm leading-6 text-left text-zinc-700 dark:text-zinc-200">
                              <template x-for="row in diffRows" :key="row.key">
                                <div>
                                  <template x-if="row.type === 'fold'">
                                    <div class="flex items-center text-xs text-zinc-500/90 dark:text-zinc-400/90 py-1 bg-zinc-50/60 dark:bg-zinc-900/35"><div class="flex-1 text-center"><span x-text="'@@ 已折叠 ' + row.count + ' 行 @@'"></span></div><div class="flex-1 text-center"><span x-text="'@@ 已折叠 ' + row.count + ' 行 @@'"></span></div></div>
                                  </template>
                                  <template x-if="row.type === 'notice'">
                                    <div class="flex items-center text-xs text-warning/90 dark:text-warning-light/90 py-1 bg-warning-light/60 dark:bg-warning-dark/40"><div class="flex-1 text-center" x-text="row.text"></div><div class="flex-1 text-center" x-text="row.text"></div></div>
                                  </template>
                                  <template x-if="row.type !== 'fold' && row.type !== 'notice'">
                                    <div class="flex items-stretch gap-0 border-b border-zinc-200/45 dark:border-zinc-800/60">
                                      <div class="flex-1 min-w-0 flex items-center pr-3 border-l-2" :class="row.leftType === 'del' ? 'agent-diff-row-del' : 'border-transparent'">
                                        <div class="w-11 shrink-0 pr-3 flex items-center justify-end text-right text-xs tabular-nums select-none" :class="row.leftType === 'del' ? 'agent-diff-gutter-del' : 'text-zinc-400/80'" x-text="row.leftNo ?? ''"></div>
                                        <div class="w-5 shrink-0 flex items-center justify-start pl-1 text-center text-sm leading-none select-none" :class="row.leftType === 'del' ? 'agent-diff-sign-del' : 'text-transparent'" x-text="row.leftType === 'del' ? '-' : ' '"></div>
                                        <div class="flex-1 min-w-0 text-left py-0.5 pl-1" :class="diffWrap ? 'whitespace-pre-wrap break-all [overflow-wrap:anywhere]' : 'whitespace-pre'" x-html="renderSplitCellText('left', row)"></div>
                                      </div>
                                      <div class="flex-1 min-w-0 flex items-center pl-3 border-l-2" :class="row.rightType === 'add' ? 'agent-diff-row-add' : 'border-transparent'">
                                        <div class="w-11 shrink-0 pr-3 flex items-center justify-end text-right text-xs tabular-nums select-none" :class="row.rightType === 'add' ? 'agent-diff-gutter-add' : 'text-zinc-400/80'" x-text="row.rightNo ?? ''"></div>
                                        <div class="w-5 shrink-0 flex items-center justify-start pl-1 text-center text-sm leading-none select-none" :class="row.rightType === 'add' ? 'agent-diff-sign-add' : 'text-transparent'" x-text="row.rightType === 'add' ? '+' : ' '"></div>
                                        <div class="flex-1 min-w-0 text-left py-0.5 pl-1" :class="diffWrap ? 'whitespace-pre-wrap break-all [overflow-wrap:anywhere]' : 'whitespace-pre'" x-html="renderSplitCellText('right', row)"></div>
                                      </div>
                                    </div>
                                  </template>
                                </div>
                              </template>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>

                  <div x-show="msg.role === 'user'"
                       x-cloak
                       class="mt-1 flex items-center justify-end gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150">
                    <button @click="editUserMessage(msg)"
                            title="编辑消息"
                            class="btn-icon-ghost h-7 w-7">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M11 5h2m-1-1v2m-7.293 9.293l9.414-9.414a1 1 0 011.414 0l2.586 2.586a1 1 0 010 1.414l-9.414 9.414H6v-2.293z" />
                      </svg>
                    </button>
                    <button @click="retryFromMessage(msg)"
                            :disabled="!canRetryMessage(msg)"
                            title="重试"
                            class="btn-icon-ghost h-7 w-7">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                    </button>
                    <button @click="copyMessage(msg)"
                            title="复制消息"
                            class="btn-icon-ghost h-7 w-7">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-4 12h6a2 2 0 002-2v-8a2 2 0 00-2-2h-6a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <div x-show="hasStreamingActivityCard" x-cloak class="flex justify-start">
              <div class="w-full lg:w-[44rem] max-w-full sm:max-w-[86%] rounded-neo-lg border border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-100/55 dark:bg-zinc-900/85 shadow-sm p-3">
                <div class="text-sm font-semibold text-zinc-600 dark:text-zinc-200 mb-1 inline-flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-brand/85 animate-pulse"></span>Activity · 执行中</div>
                <div x-show="streamingToolStatus" class="text-xs text-zinc-500 dark:text-zinc-400" x-text="streamingToolStatus"></div>
                <div x-show="$store.agent.chat.streamingThinking" class="mt-2 text-[13px] text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-6" x-text="$store.agent.chat.streamingThinking"></div>
              </div>
            </div>

            <div x-show="shouldShowStreamingMessage" class="flex justify-start">
              <div class="max-w-full sm:max-w-[86%] rounded-neo px-4 py-2 text-sm bg-white/95 dark:bg-zinc-900/70 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 shadow-sm">
                <div x-show="isStreamingPlaceholder" x-cloak class="agent-loading-wave" aria-live="polite" aria-label="生成中">
                  <template x-for="(char, idx) in streamingPlaceholderChars" :key="'modal-loading-' + idx">
                    <span class="agent-loading-wave-char" :style="'--agent-wave-delay:' + (idx * 150) + 'ms'" x-text="char"></span>
                  </template>
                </div>
                <div x-show="!isStreamingPlaceholder" x-cloak class="agent-markdown prose prose-sm dark:prose-invert max-w-none" x-html="renderMessageContent($store.agent.chat.streamingText)"></div>
              </div>
            </div>

          </div>

          <!-- Input -->
          <div class="px-3 sm:px-6 pb-5 sm:pb-5 pt-3" style="padding-bottom: max(1.25rem, env(safe-area-inset-bottom));">
            <div class="space-y-2">
              <div x-show="refs.length" x-cloak class="flex flex-wrap gap-2">
                <template x-for="ref in refs" :key="ref.ref_id">
                  <div class="flex items-center gap-1 rounded-neo border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-1 text-xs text-zinc-600 dark:text-zinc-300 max-w-full"
                       :title="ref.mime + ' · ' + ref.bytes + ' bytes'">
                    <span class="truncate max-w-[220px]" x-text="ref.name"></span>
                    <button @click="removeRef(ref.ref_id)"
                            class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                            title="移除附件">
                      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </template>
              </div>

              <div class="flex gap-2 rounded-neo border border-zinc-200 dark:border-zinc-700 bg-white/95 dark:bg-zinc-900/90 px-3 py-2 shadow-neo-lift dark:shadow-neo-lift-dark"
                   :class="isMultiline ? 'flex-wrap items-end' : 'items-center'">
                  <label class="btn-icon-ghost h-9 w-9 text-zinc-500 dark:text-zinc-300 cursor-pointer"
                         :class="isMultiline ? 'order-2' : 'order-1'"
                         title="上传附件">
                  <input type="file"
                         class="hidden"
                         multiple
                         accept=".txt,.md,text/plain,text/markdown,image/*"
                         @change="attachRefs($event)">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </label>

                <textarea x-model="$store.agent.chat.input"
                          rows="1"
                          data-max-height="140"
                          x-ref="chatInput"
                          x-init="$nextTick(() => autoResize({ target: $refs.chatInput }))"
                          x-effect="$store.agent.chat.input; autoResize({ target: $refs.chatInput })"
                          @input="autoResize($event)"
                          @focus="autoResize($event)"
                          @keydown="handleChatInputKeydown($event)"
                          :class="isMultiline ? 'order-1 basis-full' : 'order-2 flex-1'"
                          class="bg-transparent text-sm leading-6 text-zinc-700 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none resize-none min-h-[32px] py-1"
                          placeholder="输入指令，让 AI 修改角色卡..."></textarea>

                <button @click="isStreaming ? stopStreaming() : sendMessage()"
                        :disabled="!$store.agent.chat.input && !isStreaming"
                        :class="isMultiline ? 'order-2 ml-auto' : 'order-3'"
                        class="btn-primary h-9 w-9"
                        title="发送 / 停止">
                  <template x-if="!isStreaming">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m0-14l-6 6m6-6l6 6" />
                    </svg>
                  </template>
                  <template x-if="isStreaming">
                    <span class="block w-4 h-4 rounded-sm bg-white"></span>
                  </template>
                </button>
              </div>
            </div>
            <div x-show="skillManagerOpen" x-cloak class="fixed inset-0 z-82 flex items-center justify-center p-0 sm:p-6">
              <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm" @click="closeSkillManager()"></div>
              <div class="relative w-full max-w-6xl h-[100dvh] sm:h-[min(92vh,860px)] rounded-none sm:rounded-neo-lg border-0 sm:border border-zinc-200/80 dark:border-zinc-700/80 bg-white/95 dark:bg-zinc-900/95 shadow-none dark:shadow-none sm:shadow-neo-lift sm:dark:shadow-neo-lift-dark flex flex-col overflow-hidden">
                <div class="px-5 py-3.5 border-b border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-50/70 dark:bg-zinc-900/70 backdrop-blur-sm flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 class="text-base font-semibold tracking-tight text-zinc-800 dark:text-zinc-100">技能管理</h3>
                    <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">本地浏览器存储 · 编辑名称、描述、正文与参考文件</p>
                  </div>
                  <div class="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
                    <input x-ref="skillTransferImportInput"
                           type="file"
                           class="hidden"
                           accept=".md,.zip,text/markdown,application/zip,application/x-zip-compressed"
                           @change="importSkillTransferFromInput($event)">
                    <button @click="addSkillFromManager()"
                            class="group btn-primary h-8 px-3 text-xs font-semibold">新增技能</button>
                    <button @click="refreshSkillCatalog()"
                            class="group btn-secondary h-8 px-3 text-xs font-medium">刷新列表</button>
                    <button @click="openSkillTransferImportPicker()"
                            :disabled="skillTransferBusy || skillManagerSaving"
                            class="group btn-secondary h-8 px-3 text-xs font-medium"
                            x-text="skillTransferBusy ? '处理中...' : '导入'"></button>
                    <button @click="exportSelectedSkillTransfer()"
                            :disabled="skillTransferBusy || skillManagerSaving || !hasSkillEditorSelection || skillManagerNewMode"
                            class="group btn-secondary h-8 px-3 text-xs font-medium"
                            x-text="skillTransferBusy ? '处理中...' : '导出'"></button>
                    <button @click="closeSkillManager()"
                            class="group btn-secondary h-8 px-3 text-xs font-medium">关闭</button>
                  </div>
                </div>

                <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-0">
                  <div class="col-span-1 lg:col-span-3 border-b lg:border-b-0 lg:border-r border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-50/75 dark:bg-zinc-950/35 min-h-0 max-h-56 lg:max-h-none flex flex-col">
                    <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-2.5">
                      <div x-show="skillManagerNewMode"
                           class="rounded-neo-lg border overflow-hidden duration-150 shadow-sm border-zinc-200/80 dark:border-zinc-700/80 bg-brand-50/45 dark:bg-brand-900/18 shadow-neo-lift dark:shadow-neo-lift-dark">
                        <div class="w-full text-left px-3 py-2.5">
                          <div class="flex items-center justify-between gap-2">
                            <span class="text-sm font-semibold text-zinc-700 dark:text-zinc-100 truncate" x-text="skillEditorDraft.id || '新技能'"></span>
                            <span class="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-warning-light text-warning dark:bg-warning-dark dark:text-warning-light">新建</span>
                          </div>
                          <div class="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400 line-clamp-2" x-text="skillEditorDraft.description || '请填写技能信息'"></div>
                        </div>
                      </div>
                      <template x-for="skill in skillCatalog" :key="skill.id">
                        <div class="rounded-neo-lg border overflow-hidden duration-150 shadow-sm"
                             :class="!skillManagerNewMode && skillManagerSelectedId === skill.id
                                ? 'border-zinc-200/80 dark:border-zinc-700/80 bg-brand-50/45 dark:bg-brand-900/18 shadow-neo-lift dark:shadow-neo-lift-dark'
                                : 'border-zinc-200/80 dark:border-zinc-800/75 bg-white/90 dark:bg-zinc-900/90 hover:border-zinc-300/80 dark:hover:border-zinc-700/70'">
                          <button @click="selectSkillForManager(skill.id)"
                                  class="w-full text-left px-3 py-2.5 hover:bg-zinc-100/75 dark:hover:bg-zinc-800/60 transition-colors">
                            <div class="flex items-center justify-between gap-2">
                              <span class="text-sm font-semibold truncate"
                                    :class="!skillManagerNewMode && skillManagerSelectedId === skill.id
                                      ? 'text-brand-700 dark:text-brand-300'
                                      : 'text-zinc-700 dark:text-zinc-100'"
                                    x-text="skill.id"></span>
                              <span @click.stop="toggleSkill(skill.id)"
                                    class="shrink-0 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors cursor-pointer"
                                    :class="isSkillSelected(skill.id)
                                      ? 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-600'
                                      : 'bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-700 dark:text-zinc-300 dark:border-zinc-600'">
                                <span class="h-1.5 w-1.5 rounded-full"
                                      :class="isSkillSelected(skill.id)
                                        ? 'bg-brand-600 dark:bg-brand-400'
                                        : 'bg-zinc-400 dark:bg-zinc-500'"></span>
                                <span x-text="isSkillSelected(skill.id) ? '启用' : '未启用'"></span>
                              </span>
                            </div>
                            <div class="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400 line-clamp-2" x-text="skill.description"></div>
                          </button>
                        </div>
                      </template>
                      <p x-show="!skillCatalog.length && !skillManagerNewMode" class="text-xs text-zinc-500 dark:text-zinc-400">暂无技能，请先新增。</p>
                    </div>
                  </div>

                  <div class="col-span-1 lg:col-span-9 min-h-0 flex flex-col">
                    <template x-if="skillManagerError || skillManagerBusy">
                      <div class="px-5 py-3 border-b border-zinc-200/80 dark:border-zinc-700/80 bg-white/65 dark:bg-zinc-900/55">
                        <p x-show="skillManagerError"
                           x-cloak
                           class="text-xs text-danger dark:text-danger-light"
                           x-text="skillManagerError"></p>
                        <p x-show="skillManagerBusy"
                           x-cloak
                           class="text-xs text-zinc-500 dark:text-zinc-400">正在加载技能...</p>
                      </div>
                    </template>

                    <div x-show="hasSkillEditorSelection" x-cloak class="flex-1 min-h-0 overflow-hidden p-4 sm:p-5 flex flex-col gap-4 bg-zinc-50/35 dark:bg-zinc-900/20">
                      <div>
                        <label class="block text-[11px] font-semibold tracking-wide text-zinc-600 dark:text-zinc-300 mb-1.5">名称</label>
                        <input x-model="skillEditorDraft.id"
                               class="w-full rounded-neo border-2 border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-900/[0.03] dark:bg-zinc-800/80 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-100  placeholder:text-zinc-400 dark:placeholder:text-zinc-500   focus:border-brand dark:focus:border-brand-400"
                               placeholder="技能名称">
                      </div>

                      <div>
                        <label class="block text-[11px] font-semibold tracking-wide text-zinc-600 dark:text-zinc-300 mb-1.5">描述</label>
                        <textarea x-model="skillEditorDraft.description"
                                  rows="2"
                                  class="w-full rounded-neo border-2 border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-900/[0.03] dark:bg-zinc-800/80 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-100  placeholder:text-zinc-400 dark:placeholder:text-zinc-500   focus:border-brand dark:focus:border-brand-400 resize-y"
                                  placeholder="技能描述"></textarea>
                      </div>

                      <div class="flex-1 flex flex-col min-h-0">
                        <label class="block text-[11px] font-semibold tracking-wide text-zinc-600 dark:text-zinc-300 mb-1.5">技能正文</label>
                        <textarea x-model="skillEditorDraft.content"
                                  class="flex-1 w-full min-h-[12rem] rounded-neo border-2 border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-900/[0.03] dark:bg-zinc-800/80 px-3 py-2 text-sm font-mono text-zinc-700 dark:text-zinc-100  placeholder:text-zinc-400 dark:placeholder:text-zinc-500   focus:border-brand dark:focus:border-brand-400 resize-none"
                                  placeholder="填写技能正文内容"></textarea>
                      </div>

                      <div class="rounded-neo-lg border border-zinc-200/90 dark:border-zinc-700/80 bg-white/70 dark:bg-zinc-900/55 p-3.5 shadow-sm">
                        <div class="flex items-center justify-between gap-2">
                          <div class="flex items-center gap-2">
                            <svg class="w-4 h-4 text-zinc-500 dark:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                            <span class="text-xs font-semibold text-zinc-700 dark:text-zinc-200">参考文件</span>
                            <span class="text-[11px] text-zinc-500 dark:text-zinc-400" x-text="'(' + (skillEditorDraft.references?.length || 0) + ')'"></span>
                          </div>
                          <button @click="openSkillReferenceManager()"
                                  class="btn-secondary h-7 px-3 text-[11px] font-medium">管理参考文件</button>
                        </div>
                      </div>
                    </div>

                    <div x-show="!hasSkillEditorSelection" x-cloak class="flex-1 min-h-0 flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                      从左侧选择一个技能开始编辑。
                    </div>

                    <div class="px-5 py-3 border-t border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-50/70 dark:bg-zinc-900/70 backdrop-blur-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <button @click="deleteSelectedSkillFromManager()"
                              :disabled="!hasSkillEditorSelection || skillManagerSaving"
                              class="btn-danger h-8 w-full sm:w-auto px-3 text-xs font-medium"
                              x-text="skillManagerNewMode ? '取消新建' : '删除技能'"></button>
                      <div class="flex items-center gap-2 w-full sm:w-auto">
                        <button @click="saveSkillManagerDraft()"
                                :disabled="!hasSkillEditorSelection || skillManagerSaving"
                                class="btn-primary h-8 w-full sm:w-auto px-3 text-xs font-semibold">
                          <span x-text="skillManagerSaving ? '保存中...' : (skillManagerNewMode ? '创建技能' : '保存修改')"></span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div x-show="skillReferenceManagerOpen" x-cloak class="fixed inset-0 z-83 flex items-center justify-center p-0 sm:p-6">
              <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm" @click="closeSkillReferenceManager()"></div>
              <div class="relative w-full max-w-6xl h-[100dvh] sm:h-[min(92vh,860px)] rounded-none sm:rounded-neo-lg border-0 sm:border border-zinc-200/80 dark:border-zinc-700/80 bg-white/95 dark:bg-zinc-900/95 shadow-none dark:shadow-none sm:shadow-neo-lift sm:dark:shadow-neo-lift-dark flex flex-col overflow-hidden">
                <div class="px-5 py-3.5 border-b border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-50/70 dark:bg-zinc-900/70 backdrop-blur-sm flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 class="text-base font-semibold tracking-tight text-zinc-800 dark:text-zinc-100">参考文件管理</h3>
                    <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5" x-text="skillEditorDraft.id || '新技能'"></p>
                  </div>
                  <div class="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
                    <button @click="addSkillReferenceDraft()"
                            class="group btn-primary h-8 px-3 text-xs font-semibold">新增参考文件</button>
                    <button @click="closeSkillReferenceManager()"
                            class="group btn-secondary h-8 px-3 text-xs font-medium">关闭</button>
                  </div>
                </div>

                <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-0">
                  <div class="col-span-1 lg:col-span-3 border-b lg:border-b-0 lg:border-r border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-50/75 dark:bg-zinc-950/35 min-h-0 max-h-56 lg:max-h-none flex flex-col">
                    <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-2.5">
                      <template x-for="(ref, index) in skillReferenceEditorItems" :key="ref.uid">
                        <div class="rounded-neo-lg border overflow-hidden duration-150 shadow-sm"
                             :class="skillReferenceSelectedIndex === index
                                ? 'border-zinc-200/80 dark:border-zinc-700/80 bg-brand-50/45 dark:bg-brand-900/18 shadow-neo-lift dark:shadow-neo-lift-dark'
                                : 'border-zinc-200/80 dark:border-zinc-800/75 bg-white/90 dark:bg-zinc-900/90 hover:border-zinc-300/80 dark:hover:border-zinc-700/70'">
                          <button @click="selectSkillReferenceDraft(index)"
                                  class="w-full text-left px-3 py-2.5 hover:bg-zinc-100/75 dark:hover:bg-zinc-800/60 transition-colors">
                            <span class="text-sm font-semibold truncate block"
                                  :class="skillReferenceSelectedIndex === index
                                    ? 'text-brand-700 dark:text-brand-300'
                                    : 'text-zinc-700 dark:text-zinc-100'"
                                  x-text="ref.name || '未命名参考文件'"></span>
                          </button>
                        </div>
                      </template>
                      <p x-show="!skillReferenceEditorItems.length" class="text-xs text-zinc-500 dark:text-zinc-400">暂无参考文件，请先新增。</p>
                    </div>
                  </div>

                  <div class="col-span-1 lg:col-span-9 min-h-0 flex flex-col">
                    <div x-show="selectedSkillReferenceDraft" x-cloak class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-4 bg-zinc-50/35 dark:bg-zinc-900/20">
                      <div>
                        <label class="block text-[11px] font-semibold tracking-wide text-zinc-600 dark:text-zinc-300 mb-1.5">参考文件名称</label>
                        <input x-model="selectedSkillReferenceDraft.name"
                               @input="syncSelectedReferenceName()"
                               class="w-full rounded-neo border-2 border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-900/[0.03] dark:bg-zinc-800/80 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-100  placeholder:text-zinc-400 dark:placeholder:text-zinc-500   focus:border-brand dark:focus:border-brand-400"
                               placeholder="例如：背景设定">
                        <p x-show="selectedSkillReferenceDraft?.error"
                           x-cloak
                           class="mt-1.5 text-xs text-warning dark:text-warning-light"
                           x-text="selectedSkillReferenceDraft?.error"></p>
                      </div>

                      <div class="flex-1">
                        <label class="block text-[11px] font-semibold tracking-wide text-zinc-600 dark:text-zinc-300 mb-1.5">参考文件内容</label>
                        <textarea x-model="selectedSkillReferenceDraft.content"
                                  rows="24"
                                  class="w-full min-h-[18rem] sm:min-h-[32rem] rounded-neo border-2 border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-900/[0.03] dark:bg-zinc-800/80 px-3 py-2 text-sm font-mono text-zinc-700 dark:text-zinc-100  placeholder:text-zinc-400 dark:placeholder:text-zinc-500   focus:border-brand dark:focus:border-brand-400 resize-y"
                                  placeholder="填写参考文件内容"></textarea>
                      </div>
                    </div>

                    <div x-show="!selectedSkillReferenceDraft" x-cloak class="flex-1 min-h-0 flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                      从左侧选择一个参考文件开始编辑。
                    </div>

                    <div class="px-5 py-3 border-t border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-50/70 dark:bg-zinc-900/70 backdrop-blur-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <button @click="requestDeleteSkillReferenceDraft(skillReferenceSelectedIndex)"
                               :disabled="!selectedSkillReferenceDraft"
                               class="btn-danger h-8 w-full sm:w-auto px-3 text-xs font-medium">删除参考文件</button>
                      <div class="flex items-center w-full sm:w-auto">
                        <button @click="saveSkillReferenceManagerDraft()"
                                :disabled="skillReferenceSaving"
                                class="btn-primary h-8 w-full sm:w-auto px-3 text-xs font-semibold"
                                x-text="skillReferenceSaving ? '保存中...' : '保存修改'"></button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div x-show="skillDeleteConfirmOpen" x-cloak class="fixed inset-0 z-84 flex items-center justify-center px-4 sm:px-6">
              <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm" @click="cancelDeleteSkill()"></div>
              <div class="relative max-w-lg w-full mx-4 bg-white dark:bg-zinc-800 rounded-neo-lg shadow-neo-lift dark:shadow-neo-lift-dark p-6">
                <div class="flex items-center gap-3 mb-4">
                  <div class="w-10 h-10 rounded-full bg-danger-light dark:bg-danger-dark flex items-center justify-center">
                    <svg class="w-5 h-5 text-danger dark:text-danger-light" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <h4 class="text-xl font-bold text-zinc-900 dark:text-zinc-100">删除技能</h4>
                </div>
                <p class="text-zinc-600 dark:text-zinc-300 mb-6">确定要删除技能「<span class="text-zinc-700 dark:text-zinc-200 font-medium" x-text="skillDeleteConfirmName"></span>」吗？</p>
                <div class="flex justify-end gap-3">
                  <button @click="cancelDeleteSkill()" class="btn-secondary px-4 py-2.5">取消</button>
                  <button @click="confirmDeleteSkill()" class="btn-danger-solid px-4 py-2.5">删除</button>
                </div>
              </div>
            </div>
            <div x-show="skillReferenceDeleteConfirmOpen" x-cloak class="fixed inset-0 z-84 flex items-center justify-center px-4 sm:px-6">
              <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm" @click="cancelDeleteSkillReferenceDraft()"></div>
              <div class="relative max-w-lg w-full mx-4 bg-white dark:bg-zinc-800 rounded-neo-lg shadow-neo-lift dark:shadow-neo-lift-dark p-6">
                <div class="flex items-center gap-3 mb-4">
                  <div class="w-10 h-10 rounded-full bg-danger-light dark:bg-danger-dark flex items-center justify-center">
                    <svg class="w-5 h-5 text-danger dark:text-danger-light" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <h4 class="text-xl font-bold text-zinc-900 dark:text-zinc-100">删除参考文件</h4>
                </div>
                <p class="text-zinc-600 dark:text-zinc-300 mb-6">确定要删除参考文件「<span class="text-zinc-700 dark:text-zinc-200 font-medium" x-text="skillReferenceDeleteConfirmName"></span>」吗？</p>
                <div class="flex justify-end gap-3">
                  <button @click="cancelDeleteSkillReferenceDraft()" class="btn-secondary px-4 py-2.5">取消</button>
                  <button @click="confirmDeleteSkillReferenceDraft()" class="btn-danger-solid px-4 py-2.5">删除</button>
                </div>
              </div>
            </div>
            <div x-show="skillValidationDialogOpen" x-cloak class="fixed inset-0 z-84 flex items-center justify-center px-4 sm:px-6">
              <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm" @click="closeValidationDialog()"></div>
              <div class="relative max-w-lg w-full mx-4 bg-white dark:bg-zinc-800 rounded-neo-lg shadow-neo-lift dark:shadow-neo-lift-dark p-6">
                <div class="flex items-center gap-3 mb-4">
                  <div class="w-10 h-10 rounded-full bg-warning-light dark:bg-warning-dark flex items-center justify-center">
                    <svg class="w-5 h-5 text-warning dark:text-warning-light" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <h4 class="text-xl font-bold text-zinc-900 dark:text-zinc-100">信息不完整</h4>
                </div>
                <p class="text-zinc-600 dark:text-zinc-300 mb-6" x-text="skillValidationMessage"></p>
                <div class="flex justify-end gap-3">
                  <button @click="closeValidationDialog()" class="btn-primary px-4 py-2.5">知道了</button>
                </div>
              </div>
            </div>
            <div x-show="presetEditorOpen" x-cloak class="fixed inset-0 z-80 flex items-center justify-center px-4 sm:px-6">
              <div class="absolute inset-0 bg-zinc-900/40" @click="closePresetEditor()"></div>
              <div class="relative w-full max-w-4xl rounded-neo border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-neo-lift dark:shadow-neo-lift-dark overflow-hidden">
                <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm select-none">
                  <div class="flex items-center min-w-[80px]">
                    <button @click="closePresetEditor()"
                            class="group btn-secondary gap-1.5 px-3 py-1.5 text-xs font-medium"
                            title="取消">
                      <svg class="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                      <span>取消</span>
                    </button>
                  </div>
                  <div class="flex-1 flex justify-center overflow-hidden px-2">
                    <h4 class="text-sm font-bold text-zinc-800 dark:text-zinc-100 truncate tracking-tight" x-text="presetEditorMode === 'edit' ? '编辑预设' : '新增预设'"></h4>
                  </div>
                  <div class="flex items-center justify-end min-w-[80px]">
                    <button @click="savePreset()"
                            class="group btn-primary gap-1.5 px-3.5 py-1.5 text-xs font-bold"
                            title="保存">
                      <span>应用</span>
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div class="p-5 space-y-4 bg-zinc-50 dark:bg-zinc-800">
                  <div>
                    <label class="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">名称</label>
                    <input x-model="presetLabel"
                           class="w-full rounded-neo border-2 border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-900/[0.03] dark:bg-zinc-800/80 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:border-brand dark:focus:border-brand-400"
                           placeholder="预设名称">
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">内容</label>
                    <textarea x-model="presetPrompt"
                              x-effect="if (presetEditorOpen) { $nextTick(() => autoResizePresetPrompt({ target: $el })); }"
                              @input="autoResizePresetPrompt($event)"
                              class="w-full min-h-[180px] max-h-[60vh] rounded-neo border-2 border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-900/[0.03] dark:bg-zinc-800/80 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none resize-none overflow-hidden focus:border-brand dark:focus:border-brand-400"
                              placeholder="预设内容"></textarea>
                  </div>
                </div>
              </div>
            </div>
            <div x-show="presetDeleteOpen" x-cloak class="fixed inset-0 z-80 flex items-center justify-center px-4 sm:px-6">
              <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm" @click="cancelDeletePreset()"></div>
              <div class="relative max-w-lg w-full mx-4 bg-white dark:bg-zinc-800 rounded-neo-lg shadow-neo-lift dark:shadow-neo-lift-dark p-6">
                <div class="flex items-center gap-3 mb-4">
                  <div class="w-10 h-10 rounded-full bg-danger-light dark:bg-danger-dark flex items-center justify-center">
                    <svg class="w-5 h-5 text-danger dark:text-danger-light" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <h4 class="text-xl font-bold text-zinc-900 dark:text-zinc-100">删除预设</h4>
                </div>
                <p class="text-zinc-600 dark:text-zinc-300 mb-6">确定要删除预设“<span class="text-zinc-700 dark:text-zinc-200 font-medium" x-text="presetToDelete?.label || ''"></span>”吗？</p>
                <div class="flex justify-end gap-3">
                    <button @click="cancelDeletePreset()"
                           class="btn-secondary px-4 py-2.5">取消</button>
                    <button @click="deletePresetConfirmed()"
                           class="btn-danger-solid px-4 py-2.5">删除</button>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
}

export const __agentModalTesting = {
  normalizeSkillIdentifier,
  isValidSkillIdentifier,
  buildSkillPathById,
  buildReferenceRelativePathFromName,
  getReferenceNameFromPath,
  ensureReferenceHeadingLine,
  normalizeSkillEditorPath,
  resolveSkillReferencePath,
  serializeSkillCatalogMarkdown,
  serializeSkillDocumentMarkdown,
};

export default {
  agentModal,
  registerAgentModalComponent,
  getAgentModalHTML,
};
