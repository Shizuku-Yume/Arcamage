import Alpine from 'alpinejs';
import {
  loadSkillCatalog,
  readSkillMarkdown,
  writeSkillMarkdown,
  createSkillEntry,
  deleteSkillEntry,
  saveSkillPreferenceState,
} from '../agent/skill_manager.js';
import { parseSkillDocument } from '../agent/skill_parser.js';

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

  if (invalid || !segments.length) return '';
  const normalized = segments.join('/');
  if (!/\.md$/i.test(normalized)) return '';
  return normalized;
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

function normalizeReferenceDraftForSnapshot(item = {}) {
  return {
    name: normalizeSkillIdentifier(item?.name || ''),
    content: String(item?.content || ''),
    error: String(item?.error || ''),
  };
}

function serializeSkillEditorSnapshot({ draft, referenceDrafts, referenceLoaded, newMode, selectedId }) {
  const editorDraft = draft || createEmptySkillEditorDraft();
  const references = referenceLoaded ? referenceDrafts : editorDraft.references;
  return JSON.stringify({
    newMode: Boolean(newMode),
    selectedId: normalizeSkillIdentifier(selectedId || ''),
    id: normalizeSkillIdentifier(editorDraft.id || ''),
    sourcePath: normalizeSkillEditorPath(editorDraft.sourcePath || ''),
    description: String(editorDraft.description || ''),
    content: String(editorDraft.content || ''),
    references: (Array.isArray(references) ? references : []).map(normalizeReferenceDraftForSnapshot),
  });
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

export function skillManagerModal(modal) {
  return {
    modal,
    activeScreen: 'list',
    skillCatalog: [],
    skillEditorDraft: createEmptySkillEditorDraft(),
    skillReferenceEditorDrafts: [],
    skillReferenceEditorLoaded: false,
    skillReferenceSelectedIndex: -1,
    skillManagerError: '',
    skillManagerSaving: false,
    skillManagerBusy: false,
    skillManagerRefreshing: false,
    skillManagerNewMode: false,
    skillManagerSelectedId: '',
    skillDeleteConfirmOpen: false,
    skillDeleteConfirmName: '',
    skillValidationDialogOpen: false,
    skillValidationMessage: '',
    skillReferenceSaving: false,
    skillReferenceDeleteConfirmOpen: false,
    skillReferenceDeleteConfirmName: '',
    skillReferenceDeleteConfirmIndex: -1,
    skillApplyHandler: null,
    skillEditorBaseline: '',

    get agent() {
      return Alpine.store('agent') || {};
    },

    get skillsState() {
      return this.agent?.skills || {};
    },

    get selectedSkillIds() {
      return Array.isArray(this.skillsState.selectedIds) ? this.skillsState.selectedIds : [];
    },

    get hasSkillEditorSelection() {
      return this.skillManagerNewMode
        || Boolean(this.skillManagerSelectedId)
        || Boolean(this.skillEditorDraft?.sourcePath);
    },

    get skillReferenceEditorItems() {
      return Array.isArray(this.skillReferenceEditorDrafts) ? this.skillReferenceEditorDrafts : [];
    },

    get skillEditorReferenceItems() {
      if (this.skillReferenceEditorLoaded) {
        return this.skillReferenceEditorItems;
      }
      return Array.isArray(this.skillEditorDraft.references) ? this.skillEditorDraft.references : [];
    },

    get selectedSkillReferenceDraft() {
      const references = this.skillReferenceEditorItems;
      const index = Number(this.skillReferenceSelectedIndex);
      if (!Number.isInteger(index) || index < 0 || index >= references.length) {
        return null;
      }
      return references[index] || null;
    },

    get currentSkillEditorSnapshot() {
      return serializeSkillEditorSnapshot({
        draft: this.skillEditorDraft,
        referenceDrafts: this.skillReferenceEditorDrafts,
        referenceLoaded: this.skillReferenceEditorLoaded,
        newMode: this.skillManagerNewMode,
        selectedId: this.skillManagerSelectedId,
      });
    },

    get isSkillManagerDirty() {
      return Boolean(this.skillEditorBaseline) && this.currentSkillEditorSnapshot !== this.skillEditorBaseline;
    },

    syncModalDirty() {
      if (this.modal) {
        this.modal.dirty = this.isSkillManagerDirty;
      }
    },

    markSkillEditorBaseline() {
      this.skillEditorBaseline = this.currentSkillEditorSnapshot;
      this.syncModalDirty();
    },

    markSkillManagerDirty() {
      this.syncModalDirty();
    },

    init() {
      this.activeScreen = this.modal?.data?.initialScreen || 'list';
      this.markSkillEditorBaseline();
      if (this.modal) {
        this.modal.onRequestSave = () => this.handleModalApply();
      }
      this.refreshSkillCatalog({ silent: true }).then(() => {
        const initialId = String(this.modal?.data?.skillId || '').trim();
        if (initialId) {
          this.goToEditSkill(initialId);
        }
      });
      this.skillApplyHandler = (event) => {
        if (event?.detail?.modalId && event.detail.modalId !== this.modal?.id) return;
        this.handleModalApply();
      };
      window.addEventListener('skill-manager-apply', this.skillApplyHandler);
    },

    destroy() {
      if (this.skillApplyHandler) {
        window.removeEventListener('skill-manager-apply', this.skillApplyHandler);
      }
    },

    async handleModalApply() {
      if (this.activeScreen === 'edit-reference' || this.activeScreen === 'edit-skill') {
        return this.saveSkillManagerDraft({ closeAfterSave: true });
      }
      Alpine.store('modalStack')?.pop?.(true);
      return true;
    },

    getReferenceDraftTargetPath(ref) {
      if (!ref) return '';
      return buildReferenceRelativePathFromName(ref.name || '');
    },

    isSkillSelected(skillId) {
      return this.selectedSkillIds.includes(skillId);
    },

    persistSkillPreference() {
      if (!this.agent?.skills) return;
      saveSkillPreferenceState({
        enabled: this.agent.skills.enabled !== false,
        selectedIds: this.selectedSkillIds,
      });
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
      const result = await loadSkillCatalog({ forceRefresh });
      this.skillCatalog = result.catalog;
      if (this.agent?.skills) {
        this.agent.skills.catalog = result.catalog;
        this.agent.skills.lastError = result.error || null;
      }
      this.normalizeSelectedSkills();
      return result;
    },

    async refreshSkillCatalog(options = {}) {
      if (this.skillManagerRefreshing) return;
      this.skillManagerRefreshing = true;
      this.skillManagerError = '';
      try {
        const result = await this.ensureSkillCatalog(true);
        if (!options.silent) {
          if (this.skillCatalog.length > 0) {
            Alpine.store('toast')?.success?.('本地 Skills 已刷新');
          } else if (result.error) {
            Alpine.store('toast')?.show?.({
              message: result.error,
              type: 'warning',
              duration: 4000,
            });
          }
        }
      } catch (error) {
        this.skillManagerError = buildEditorError(error, '刷新技能列表失败');
        if (!options.silent) Alpine.store('toast')?.error?.(this.skillManagerError);
      } finally {
        this.skillManagerRefreshing = false;
      }
    },

    async requestSkillEditorExit(nextScreen = 'list') {
      if (this.isSkillManagerDirty) {
        const shouldSave = await Alpine.store('modalStack')?.confirmSaveBeforeExit?.();
        if (shouldSave) {
          const saved = await this.saveSkillManagerDraft({ stayOnScreen: true });
          if (!saved) return false;
        }
      }
      this.activeScreen = nextScreen;
      this.skillValidationDialogOpen = false;
      this.markSkillEditorBaseline();
      return true;
    },

    goToList() {
      this.activeScreen = 'list';
      this.skillValidationDialogOpen = false;
      this.markSkillEditorBaseline();
    },

    async requestGoToList() {
      return this.requestSkillEditorExit('list');
    },

    async goToEditSkill(skillId) {
      this.activeScreen = 'edit-skill';
      if (skillId) {
        await this.selectSkillForManager(skillId);
      }
    },

    ensureSkillReferenceEditorDrafts() {
      if (!this.skillReferenceEditorLoaded) {
        this.skillReferenceEditorDrafts = cloneSkillReferenceDrafts(this.skillEditorDraft.references || []);
        this.skillReferenceEditorLoaded = true;
      }
    },

    goToEditReference(index) {
      const targetIndex = Number(index);
      if (!Number.isInteger(targetIndex) || targetIndex < 0) return;
      this.ensureSkillReferenceEditorDrafts();
      if (targetIndex >= this.skillReferenceEditorItems.length) return;
      this.skillReferenceSelectedIndex = targetIndex;
      this.activeScreen = 'edit-reference';
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
        this.skillReferenceEditorDrafts = [];
        this.skillReferenceEditorLoaded = false;
        this.skillReferenceDeleteConfirmOpen = false;
        this.skillReferenceDeleteConfirmName = '';
        this.skillReferenceDeleteConfirmIndex = -1;
        this.markSkillEditorBaseline();
      } catch (error) {
        this.resetSkillEditorDraft();
        this.skillManagerError = buildEditorError(error, '读取技能失败');
        Alpine.store('toast')?.error?.(this.skillManagerError);
      } finally {
        this.skillManagerBusy = false;
      }
    },

    resetSkillEditorDraft() {
      this.skillEditorDraft = createEmptySkillEditorDraft();
      this.skillReferenceSelectedIndex = -1;
      this.skillReferenceEditorDrafts = [];
      this.skillReferenceEditorLoaded = false;
      this.skillReferenceSaving = false;
      this.skillReferenceDeleteConfirmOpen = false;
      this.skillReferenceDeleteConfirmName = '';
      this.skillReferenceDeleteConfirmIndex = -1;
      this.markSkillManagerDirty();
    },

    addSkillFromManager() {
      this.skillEditorDraft = createEmptySkillEditorDraft();
      this.skillReferenceEditorDrafts = [];
      this.skillReferenceEditorLoaded = false;
      this.skillReferenceSelectedIndex = -1;
      this.skillManagerSelectedId = '';
      this.skillManagerNewMode = true;
      this.skillManagerError = '';
      this.activeScreen = 'edit-skill';
      this.markSkillEditorBaseline();
    },

    async deleteSelectedSkillFromManager(skillId = '') {
      if (skillId) {
        await this.selectSkillForManager(skillId);
      }
      if (!this.hasSkillEditorSelection) return;
      if (this.skillManagerNewMode) {
        this.skillManagerNewMode = false;
        this.resetSkillEditorDraft();
        this.goToList();
        return;
      }
      const targetId = normalizeSkillIdentifier(this.skillManagerSelectedId || this.skillEditorDraft.id || '');
      if (!targetId) return;
      this.skillDeleteConfirmName = targetId;
      this.skillDeleteConfirmOpen = true;
    },

    async confirmDeleteSkill() {
      const skillId = normalizeSkillIdentifier(this.skillManagerSelectedId || this.skillEditorDraft.id || '');
      if (!skillId) {
        this.skillDeleteConfirmOpen = false;
        return;
      }

      this.skillManagerBusy = true;
      try {
        await deleteSkillEntry(skillId, { deleteFiles: true });
        if (this.isSkillSelected(skillId)) {
          this.toggleSkill(skillId);
        }
        await this.ensureSkillCatalog(true);
        this.skillManagerSelectedId = '';
        this.resetSkillEditorDraft();
        this.goToList();
        Alpine.store('toast')?.success?.('技能已删除');
      } catch (error) {
        this.skillManagerError = buildEditorError(error, '删除技能失败');
        Alpine.store('toast')?.error?.(this.skillManagerError);
      } finally {
        this.skillManagerBusy = false;
        this.skillDeleteConfirmOpen = false;
        this.skillDeleteConfirmName = '';
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

    addSkillReferenceDraft() {
      this.ensureSkillReferenceEditorDrafts();
      const nextRefs = [
        ...(Array.isArray(this.skillReferenceEditorDrafts) ? this.skillReferenceEditorDrafts : []),
        createSkillReferenceDraft('', ''),
      ];
      this.skillReferenceEditorDrafts = nextRefs;
      this.skillReferenceEditorLoaded = true;
      this.skillReferenceSelectedIndex = nextRefs.length - 1;
      this.activeScreen = 'edit-reference';
      this.skillReferenceDeleteConfirmOpen = false;
      this.skillReferenceDeleteConfirmName = '';
      this.skillReferenceDeleteConfirmIndex = -1;
      this.markSkillManagerDirty();
    },

    selectSkillReferenceDraft(index) {
      const next = Number(index);
      if (!Number.isInteger(next)) return;
      if (next < 0 || next >= this.skillReferenceEditorItems.length) return;
      this.skillReferenceSelectedIndex = next;
    },

    syncSelectedReferenceName() {
      const ref = this.selectedSkillReferenceDraft;
      if (!ref) return;
      ref.name = normalizeSkillIdentifier(ref.name || '');
      ref.content = ensureReferenceHeadingLine(ref.name, ref.content || '');
    },

    requestDeleteSkillReferenceDraft(index) {
      const targetIndex = Number(index);
      const currentRefs = this.skillReferenceEditorItems;
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
      this.markSkillManagerDirty();
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

    prepareSkillReferenceDraftsForSave() {
      const currentRefs = this.skillReferenceEditorLoaded
        ? this.skillReferenceEditorDrafts
        : this.skillEditorDraft.references;
      const seenRef = new Set();
      const nextRefs = [];

      for (let index = 0; index < (Array.isArray(currentRefs) ? currentRefs : []).length; index += 1) {
        const refDraft = currentRefs[index] || {};
        const referenceName = normalizeSkillIdentifier(refDraft.name || '');
        const referenceContent = ensureReferenceHeadingLine(referenceName, refDraft.content || '');

        if (!referenceName) {
          if (referenceContent) {
            this.skillValidationMessage = `请先填写第 ${index + 1} 个参考文件名称`;
            this.skillValidationDialogOpen = true;
            this.skillReferenceSelectedIndex = index;
            this.activeScreen = 'edit-reference';
            return null;
          }
          continue;
        }

        if (!isValidSkillIdentifier(referenceName)) {
          this.skillValidationMessage = `参考文件名称无效：${referenceName}`;
          this.skillValidationDialogOpen = true;
          this.skillReferenceSelectedIndex = index;
          this.activeScreen = 'edit-reference';
          return null;
        }

        const relativePath = buildReferenceRelativePathFromName(referenceName);
        if (!relativePath) {
          this.skillValidationMessage = `参考文件名称无效：${referenceName}`;
          this.skillValidationDialogOpen = true;
          this.skillReferenceSelectedIndex = index;
          this.activeScreen = 'edit-reference';
          return null;
        }
        if (seenRef.has(relativePath)) {
          this.skillValidationMessage = `参考文件名称重复：${referenceName}`;
          this.skillValidationDialogOpen = true;
          this.skillReferenceSelectedIndex = index;
          this.activeScreen = 'edit-reference';
          return null;
        }
        seenRef.add(relativePath);

        nextRefs.push(createSkillReferenceDraft(
          referenceName,
          referenceContent,
          refDraft.error || '',
        ));
      }

      this.skillEditorDraft.references = nextRefs;
      if (this.skillReferenceEditorLoaded) {
        this.skillReferenceEditorDrafts = cloneSkillReferenceDrafts(nextRefs);
      }
      if (!nextRefs.length) {
        this.skillReferenceSelectedIndex = -1;
      } else if (this.skillReferenceSelectedIndex < 0 || this.skillReferenceSelectedIndex >= nextRefs.length) {
        this.skillReferenceSelectedIndex = 0;
      }
      return nextRefs;
    },

    saveSkillReferenceManagerDraft() {
      this.skillReferenceSaving = true;
      try {
        if (!this.prepareSkillReferenceDraftsForSave()) return;
        this.activeScreen = 'edit-skill';
      } finally {
        this.skillReferenceSaving = false;
      }
    },

    async saveSkillManagerDraft(options = {}) {
      if (!this.hasSkillEditorSelection) return false;
      const isNewSkill = this.skillManagerNewMode;
      const currentSkillId = normalizeSkillIdentifier(this.skillManagerSelectedId || this.skillEditorDraft.id || '');
      const nextSkillId = normalizeSkillIdentifier(this.skillEditorDraft.id || '');
      const description = String(this.skillEditorDraft.description || '').trim();
      const body = String(this.skillEditorDraft.content || '').trim();

      const missingFields = [];
      if (!nextSkillId) missingFields.push('技能 ID');
      if (!description) missingFields.push('描述');
      if (!body) missingFields.push('正文');

      if (missingFields.length > 0) {
        this.skillValidationMessage = `请填写以下必填项：${missingFields.join('、')}`;
        this.skillValidationDialogOpen = true;
        return false;
      }

      if (!isValidSkillIdentifier(nextSkillId)) {
        this.skillValidationMessage = '技能 ID 仅支持中英文、数字、空格、下划线、中划线';
        this.skillValidationDialogOpen = true;
        return false;
      }
      const nextSkillPath = buildSkillPathById(nextSkillId);
      if (!nextSkillPath) {
        this.skillValidationMessage = '技能 ID 格式无效';
        this.skillValidationDialogOpen = true;
        return false;
      }

      if (isNewSkill) {
        if (this.skillCatalog.some((entry) => entry.id === nextSkillId)) {
          this.skillValidationMessage = `技能 ID 已存在：${nextSkillId}`;
          this.skillValidationDialogOpen = true;
          return false;
        }
      } else {
        const currentEntry = this.skillCatalog.find((entry) => entry.id === currentSkillId);
        if (!currentEntry) {
          this.skillManagerError = `技能不存在：${currentSkillId || nextSkillId}`;
          return false;
        }

        const idChanged = nextSkillId !== currentEntry.id;
        if (idChanged && this.skillCatalog.some((entry) => entry.id === nextSkillId)) {
          this.skillValidationMessage = `技能 ID 已存在：${nextSkillId}`;
          this.skillValidationDialogOpen = true;
          return false;
        }
      }

      const preparedReferences = this.prepareSkillReferenceDraftsForSave();
      if (!preparedReferences) return false;

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
            this.goToEditReference(index);
            return false;
          }
          continue;
        }
        if (!isValidSkillIdentifier(referenceName)) {
          this.skillValidationMessage = `参考文件名称无效：${referenceName}`;
          this.skillValidationDialogOpen = true;
          this.goToEditReference(index);
          return false;
        }

        const relativePath = buildReferenceRelativePathFromName(referenceName);
        if (!relativePath) {
          this.skillValidationMessage = `参考文件名称无效：${referenceName}`;
          this.skillValidationDialogOpen = true;
          this.goToEditReference(index);
          return false;
        }
        if (seenRef.has(relativePath)) {
          this.skillValidationMessage = `参考文件名称重复：${referenceName}`;
          this.skillValidationDialogOpen = true;
          this.goToEditReference(index);
          return false;
        }
        seenRef.add(relativePath);
        references.push(relativePath);
        const absolutePath = resolveSkillReferencePath(nextSkillPath, relativePath);
        if (!absolutePath) {
          this.skillValidationMessage = `参考文件路径无效：${referenceName}`;
          this.skillValidationDialogOpen = true;
          this.goToEditReference(index);
          return false;
        }
        referenceWrites.push({ path: absolutePath, content: referenceContent });
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
        this.markSkillEditorBaseline();
        if (!options.stayOnScreen && !options.closeAfterSave) {
          this.activeScreen = 'list';
        }
        return true;
      } catch (error) {
        this.skillManagerError = buildEditorError(error, '保存技能失败');
        Alpine.store('toast')?.error?.(this.skillManagerError);
        return false;
      } finally {
        this.skillManagerSaving = false;
      }
    },
  };
}

export function registerSkillManagerModalComponent() {
  Alpine.data('skillManagerModal', skillManagerModal);
}

export function getSkillManagerModalHTML() {
  return `
    <div class="flex-1 min-h-0 flex flex-col bg-transparent" x-effect="syncModalDirty()">
      <div x-show="activeScreen === 'list'" x-cloak class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-5 sm:px-6" style="scrollbar-gutter: stable;">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">技能列表</h3>
          <button @click="addSkillFromManager()" class="btn-primary h-9 px-3.5 text-xs font-semibold">新增技能</button>
        </div>

        <div x-show="skillManagerError || skillManagerBusy" x-cloak class="mb-3 rounded-neo border border-zinc-200/80 dark:border-zinc-700/80 bg-white/60 dark:bg-zinc-900/50 px-3.5 py-2.5">
          <p x-show="skillManagerError" x-cloak class="text-xs text-danger dark:text-danger-light" x-text="skillManagerError"></p>
          <p x-show="skillManagerBusy" x-cloak class="text-xs text-zinc-500 dark:text-zinc-400">正在加载技能...</p>
        </div>

        <div class="space-y-2.5">
          <template x-for="skill in skillCatalog" :key="skill.id">
            <div class="group flex items-center justify-between gap-3 rounded-neo bg-white/80 dark:bg-zinc-900/70 border border-zinc-200/70 dark:border-zinc-800/80 px-4 py-3 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-white dark:hover:bg-zinc-900">
              <button @click="goToEditSkill(skill.id)" class="min-w-0 flex-1 text-left py-0.5">
                <span class="block truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100" x-text="skill.id"></span>
                <span class="mt-1 block truncate text-xs text-zinc-500 dark:text-zinc-400" x-text="skill.description || '暂无描述'"></span>
              </button>
              <div class="flex shrink-0 items-center gap-1.5">
                <button @click.stop="toggleSkill(skill.id)"
                        class="h-8 rounded-neo border px-2.5 text-xs font-semibold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
                        :class="isSkillSelected(skill.id) ? 'border-brand bg-brand text-white shadow-sm hover:bg-brand-dark dark:border-brand-400 dark:bg-brand-500 dark:text-white dark:hover:bg-brand-400' : 'border-zinc-200/80 bg-zinc-100/60 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700/80 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'"
                        x-text="isSkillSelected(skill.id) ? '启用' : '未启用'"></button>
                <button @click.stop="goToEditSkill(skill.id)" class="btn-secondary h-8 px-2.5 text-xs font-medium">编辑</button>
                <button @click.stop="deleteSelectedSkillFromManager(skill.id)" class="btn-danger h-8 px-2.5 text-xs font-medium">删除</button>
              </div>
            </div>
          </template>
        </div>

        <div x-show="!skillCatalog.length && !skillManagerRefreshing" x-cloak class="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          暂无技能，点击“新增技能”创建
        </div>
      </div>

      <div x-show="activeScreen === 'edit-skill'" x-cloak class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-5 sm:px-6" style="scrollbar-gutter: stable;">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">技能编辑器</h3>
          <div class="flex items-center gap-2">
            <button @click="requestGoToList()" class="btn-secondary h-9 px-3.5 text-xs font-medium">返回</button>
            <button @click="saveSkillManagerDraft()"
                    :disabled="!hasSkillEditorSelection || skillManagerSaving || skillManagerBusy"
                    class="btn-primary h-9 px-3.5 text-xs font-semibold"
                    x-text="skillManagerSaving ? '保存中…' : '保存'"></button>
          </div>
        </div>

        <div x-show="skillManagerError || skillManagerBusy" x-cloak class="mb-3 rounded-neo border border-zinc-200/80 dark:border-zinc-700/80 bg-white/60 dark:bg-zinc-900/50 px-3.5 py-2.5">
          <p x-show="skillManagerError" x-cloak class="text-xs text-danger dark:text-danger-light" x-text="skillManagerError"></p>
          <p x-show="skillManagerBusy" x-cloak class="text-xs text-zinc-500 dark:text-zinc-400">正在加载技能...</p>
        </div>

        <div class="space-y-4">
          <div>
            <label class="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">技能 ID</label>
            <input x-model="skillEditorDraft.id"
                   class="w-full px-3.5 py-2 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none text-xs text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 transition-colors focus:border-brand dark:focus:border-brand-400"
                   placeholder="技能 ID">
          </div>

          <div>
            <label class="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">描述</label>
            <textarea x-model="skillEditorDraft.description"
                      rows="4"
                      class="w-full px-3.5 py-2 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none text-xs leading-6 text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 transition-colors focus:border-brand dark:focus:border-brand-400 resize-y"
                      placeholder="描述"></textarea>
          </div>

          <div>
            <label class="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">正文</label>
            <textarea x-model="skillEditorDraft.content"
                      class="w-full h-56 px-4 py-2.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none text-xs leading-5 font-mono text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 transition-colors focus:border-brand dark:focus:border-brand-400 resize-y custom-scrollbar"
                      placeholder="正文"></textarea>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="block text-xs font-medium text-zinc-700 dark:text-zinc-300">参考文件</label>
              <button @click="addSkillReferenceDraft()" class="btn-secondary h-8 px-2.5 text-xs font-medium">+ 添加参考</button>
            </div>
            <div class="space-y-2">
              <template x-for="(ref, index) in skillEditorReferenceItems" :key="ref.uid">
                <div class="flex items-center justify-between gap-3 rounded-neo bg-white/70 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800/80 px-3 py-2.5">
                  <button @click="goToEditReference(index)" class="min-w-0 flex-1 text-left">
                    <span class="block truncate text-sm text-zinc-800 dark:text-zinc-100" x-text="ref.name || '未命名引用'"></span>
                    <span class="mt-0.5 block truncate text-xs text-zinc-400 dark:text-zinc-500" x-text="getReferenceDraftTargetPath(ref) || 'references/未命名.md'"></span>
                  </button>
                  <button @click="goToEditReference(index)" class="btn-secondary h-8 px-2.5 text-xs font-medium">编辑</button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div x-show="activeScreen === 'edit-reference'" x-cloak class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-5 sm:px-6" style="scrollbar-gutter: stable;">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">参考编辑器</h3>
          <div class="flex items-center gap-2">
            <button @click="activeScreen = 'edit-skill'" class="btn-secondary h-9 px-3.5 text-xs font-medium">返回技能编辑</button>
          </div>
        </div>

        <div class="mb-3 flex items-center justify-between">
          <div class="text-xs text-zinc-500 dark:text-zinc-400" x-text="skillReferenceEditorItems.length + ' 个参考文件'"></div>
          <button @click="addSkillReferenceDraft()" class="btn-secondary h-8 px-2.5 text-xs font-medium">+ 新增参考</button>
        </div>

        <div x-show="skillReferenceEditorItems.length > 1" x-cloak class="mb-3 flex flex-wrap gap-1.5">
          <template x-for="(ref, index) in skillReferenceEditorItems" :key="ref.uid">
            <button @click="selectSkillReferenceDraft(index)"
                    class="inline-flex items-center gap-2 rounded-neo border px-3 py-1.5 text-xs font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
                    :class="skillReferenceSelectedIndex === index
                      ? 'border-brand bg-brand text-white shadow-sm dark:border-brand-500 dark:bg-brand-600 dark:text-white'
                      : 'border-zinc-200 bg-white/35 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-100/70 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/30 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-200'">
              <span class="h-1.5 w-1.5 rounded-full"
                    :class="skillReferenceSelectedIndex === index ? 'bg-white/90' : 'bg-zinc-300 dark:bg-zinc-600'"></span>
              <span x-text="ref.name || '未命名引用'"></span>
            </button>
          </template>
        </div>

        <div x-show="selectedSkillReferenceDraft" x-cloak class="space-y-5">
          <div>
            <label class="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">引用名称</label>
            <input x-model="selectedSkillReferenceDraft.name"
                   @input="syncSelectedReferenceName()"
                   class="w-full px-3.5 py-2 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none text-xs text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 transition-colors focus:border-brand dark:focus:border-brand-400"
                   placeholder="引用名称">
            <p x-show="selectedSkillReferenceDraft?.error" x-cloak class="mt-1.5 text-xs text-warning dark:text-warning-light" x-text="selectedSkillReferenceDraft?.error"></p>
          </div>

          <div>
            <label class="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">内容</label>
            <textarea x-model="selectedSkillReferenceDraft.content"
                      class="w-full h-64 px-4 py-2.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none text-xs leading-5 font-mono text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 transition-colors focus:border-brand dark:focus:border-brand-400 resize-y custom-scrollbar"
                      placeholder="内容"></textarea>
          </div>

          <div class="flex items-center justify-start">
            <button @click="requestDeleteSkillReferenceDraft(skillReferenceSelectedIndex)" class="btn-danger h-10 px-4 text-sm font-medium">删除参考文件</button>
          </div>
        </div>

        <div x-show="!selectedSkillReferenceDraft" x-cloak class="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          暂无参考文件，点击“新增参考”创建
        </div>
      </div>

      <div x-show="skillDeleteConfirmOpen" x-cloak class="fixed inset-0 z-[70] flex items-center justify-center px-4 sm:px-6">
        <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm" @click="cancelDeleteSkill()"></div>
        <div class="relative max-w-lg w-full mx-4 bg-white dark:bg-zinc-800 rounded-neo-lg shadow-neo-lift dark:shadow-neo-lift-dark p-6">
          <h4 class="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-3">删除技能</h4>
          <p class="text-sm text-zinc-600 dark:text-zinc-300 mb-5">确定要删除技能「<span class="font-medium" x-text="skillDeleteConfirmName"></span>」吗？</p>
          <div class="flex justify-end gap-3">
            <button @click="cancelDeleteSkill()" class="btn-secondary px-4 py-2.5 text-sm">取消</button>
            <button @click="confirmDeleteSkill()" class="btn-danger-solid px-4 py-2.5 text-sm">删除</button>
          </div>
        </div>
      </div>

      <div x-show="skillReferenceDeleteConfirmOpen" x-cloak class="fixed inset-0 z-[70] flex items-center justify-center px-4 sm:px-6">
        <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm" @click="cancelDeleteSkillReferenceDraft()"></div>
        <div class="relative max-w-lg w-full mx-4 bg-white dark:bg-zinc-800 rounded-neo-lg shadow-neo-lift dark:shadow-neo-lift-dark p-6">
          <h4 class="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-3">删除参考文件</h4>
          <p class="text-sm text-zinc-600 dark:text-zinc-300 mb-5">确定要删除参考文件「<span class="font-medium" x-text="skillReferenceDeleteConfirmName"></span>」吗？</p>
          <div class="flex justify-end gap-3">
            <button @click="cancelDeleteSkillReferenceDraft()" class="btn-secondary px-4 py-2.5 text-sm">取消</button>
            <button @click="confirmDeleteSkillReferenceDraft()" class="btn-danger-solid px-4 py-2.5 text-sm">删除</button>
          </div>
        </div>
      </div>

      <div x-show="skillValidationDialogOpen" x-cloak class="fixed inset-0 z-[70] flex items-center justify-center px-4 sm:px-6">
        <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm" @click="closeValidationDialog()"></div>
        <div class="relative max-w-lg w-full mx-4 bg-white dark:bg-zinc-800 rounded-neo-lg shadow-neo-lift dark:shadow-neo-lift-dark p-6">
          <h4 class="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-3">信息不完整</h4>
          <p class="text-sm text-zinc-600 dark:text-zinc-300 mb-5" x-text="skillValidationMessage"></p>
          <div class="flex justify-end gap-3">
            <button @click="closeValidationDialog()" class="btn-primary px-4 py-2.5 text-sm">知道了</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export const __skillManagerModalTesting = {
  createSkillReferenceDraft,
  cloneSkillReferenceDrafts,
  createEmptySkillEditorDraft,
  normalizeSkillIdentifier,
  isValidSkillIdentifier,
  normalizeSkillEditorPath,
  buildSkillPathById,
  buildReferenceRelativePathFromName,
  getReferenceNameFromPath,
  resolveSkillReferencePath,
  ensureReferenceHeadingLine,
  serializeSkillCatalogMarkdown,
  serializeSkillDocumentMarkdown,
};
