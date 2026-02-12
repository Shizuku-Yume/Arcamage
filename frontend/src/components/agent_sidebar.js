/**
 * AI Agent sidebar component
 */

import Alpine from 'alpinejs';
import { getAgentRuntime } from './agent_runtime.js';
import { formatDiffLabel, formatDiffValue, splitDiffLines } from './agent_diff.js';
import { renderMarkdown, sanitizeHTML } from './preview_panel.js';
import { handleRefUpload, removeRefById, syncAgentRefs } from '../agent/ref_manager.js';
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
} from '../agent/skill_manager.js';
import { createEmptySkillContextMeta } from '../agent/skill_context.js';
import { openTextEditor } from '../stores/modal_stack.js';

const runtime = getAgentRuntime();

export function agentSidebar() {
  return {
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
    openActivityTraceIds: {},

    get agent() {
      return Alpine.store('agent');
    },

    get card() {
      return Alpine.store('card');
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

    get hasLastApplied() {
      if (!this.summaryEntry) return false;
      return this.hasActualChanges(this.summaryEntry);
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

    syncSkillFeatureState() {
      const featureEnabled = this.skillFeatureEnabled;
      if (!featureEnabled && this.headerMenuOpen === 'skill') this.closeHeaderMenus();
      this.setSkillsEnabled(featureEnabled);
    },

    isHeaderMenuOpen(menuId) {
      return this.headerMenuOpen === String(menuId || '').trim();
    },

    closeHeaderMenus() {
      this.headerMenuOpen = '';
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
      this.openSkillManagerInFullscreen();
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

    openSkillManagerInFullscreen() {
      if (!this.agent?.ui) return;
      this.agent.ui.openSkillManager = true;
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

    get appliedEntries() {
      return Array.isArray(this.agent?.appliedEntries) ? this.agent.appliedEntries : [];
    },

    get retryableEntryIdSet() {
      const entries = this.appliedEntries.slice(-10);
      return new Set(entries.map((entry) => entry.id));
    },

    get summaryEntry() {
      const focusId = this.agent?.ui?.diffEntryId;
      if (focusId) {
        const focused = this.appliedEntries.find((entry) => entry.id === focusId);
        if (focused) return focused;
      }
      if (this.appliedEntries.length) {
        return this.appliedEntries[this.appliedEntries.length - 1];
      }
      return null;
    },

    get isSummaryEntryLatest() {
      const latestId = this.agent?.lastApplied?.entryId || null;
      if (!latestId || !this.summaryEntry?.id) return false;
      return this.summaryEntry.id === latestId;
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
      this.$watch('$store.settings.skillsEnabled', () => {
        this.syncSkillFeatureState();
      });
    },

    autoResize(event) {
      const el = event?.target;
      if (!el) return;
      if (el.getClientRects().length === 0 && !el.value) return;
      const maxHeight = Number(el.dataset?.maxHeight || 120);
      const styles = window.getComputedStyle(el);
      const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
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

    getAppliedEntryByAssistantMessage(message) {
      if (!message?.id) return null;
      return this.appliedEntries.find((entry) => entry.assistantMessageId === message.id) || null;
    },

    getEntryDiffCount(entry) {
      return Array.isArray(entry?.diffs) ? entry.diffs.length : 0;
    },

    getEntryTotals(entry) {
      const totals = { adds: 0, dels: 0 };
      const diffs = Array.isArray(entry?.diffs) ? entry.diffs : [];
      diffs.forEach((diff) => {
        const beforeText = this.normalizeDiffText(diff.before);
        const afterText = this.normalizeDiffText(diff.after);
        const beforeLines = this.splitLines(beforeText);
        const afterLines = this.splitLines(afterText);
        if (afterLines.length > beforeLines.length) {
          totals.adds += afterLines.length - beforeLines.length;
        } else if (beforeLines.length > afterLines.length) {
          totals.dels += beforeLines.length - afterLines.length;
        }
        const minLen = Math.min(beforeLines.length, afterLines.length);
        for (let i = 0; i < minLen; i++) {
          if (beforeLines[i] !== afterLines[i]) {
            totals.adds += 1;
            totals.dels += 1;
          }
        }
      });
      return totals;
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

    hasActualChanges(entry) {
      const totals = this.getEntryTotals(entry);
      return totals.adds > 0 || totals.dels > 0;
    },

    viewEntryDiff(entryId) {
      if (!entryId || !this.agent?.ui) return;
      this.agent.ui.diffEntryId = entryId;
      this.agent.ui.showLastApplied = true;
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

    toggleOpen() {
      const nextOpen = !this.agent.ui.isOpen;
      this.agent.ui.isOpen = nextOpen;
      if (nextOpen) {
        this.agent.ui.sidebarMode = 'agent';
      }
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

    dismissLastApplied() {
      if (this.agent?.ui) {
        this.agent.ui.showLastApplied = false;
      }
      this.clearUndoConfirm();
    },

    restoreLastApplied() {
      if (this.agent?.ui) {
        this.agent.ui.showLastApplied = true;
      }
    },

    openFullscreen() {
      this.agent.ui.isFullscreen = true;
    },

    viewDiffs() {
      this.agent.ui.isFullscreen = true;
      this.agent.ui.previewPaneOpen = false;
      this.agent.ui.diffPanelOpen = true;
    },

    undoLast() {
      this.clearUndoConfirm();
      const latestEntryId = this.agent?.lastApplied?.entryId;
      if (latestEntryId && runtime.undoAppliedEntry(latestEntryId, { removeSummaryMessage: true })) {
        Alpine.store('toast')?.info?.('已撤销');
      }
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

    renderMessageContent(content) {
      if (!content) return '';
      return sanitizeHTML(renderMarkdown(content));
    },

    formatDiffLabel,
    formatDiffValue,
  };
}

export function registerAgentSidebarComponent() {
  Alpine.data('agentSidebar', agentSidebar);
}

export default {
  agentSidebar,
  registerAgentSidebarComponent,
};
