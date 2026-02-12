/**
 * 世界书编辑器组件 (Lorebook Editor)
 * 
 * 用于编辑 character_book (世界书/Lorebook) 
 * 支持条目的增删改、折叠展开、拖拽排序
 * 遵循 frontend_design.md 设计规范
 */

import Alpine from 'alpinejs';
import Sortable from 'sortablejs';

/**
 * 创建空的 Lorebook Entry
 * @returns {Object}
 */
function createEmptyEntry() {
  return {
    keys: [],
    content: '',
    extensions: {},
    enabled: true,
    insertion_order: 0,
    case_sensitive: false,
    use_regex: false,
    constant: false,
    name: '',
    priority: 0,
    id: generateUniqueId(),
    comment: '',
    selective: false,
    secondary_keys: [],
    position: null,
  };
}

/**
 * 生成唯一 ID
 * @returns {string}
 */
function generateUniqueId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 世界书编辑器组件
 * 
 * @example
 * <div x-data="lorebookEditor({
 *   lorebook: $store.card.data.data.character_book,
 *   onUpdate: (book) => { ... }
 * })">
 */
export function lorebookEditor(config = {}) {
  return {
    _initialLorebook: config.lorebook || null,
    onUpdate: config.onUpdate || null,
    sortable: null,
    expandedEntries: {},
    searchQuery: '',
    filterEnabled: 'all',
    editingKeyIndex: -1,
    newKey: '',

    get lorebook() {
      return this._initialLorebook;
    },

    set lorebook(value) {
      this._initialLorebook = value;
    },

    get entries() {
      const book = this.lorebook;
      if (!book) return [];
      if (!book.entries) return [];
      if (!Array.isArray(book.entries)) return [];
      return book.entries;
    },

    get filteredEntries() {
      let entries = this.entries;
      
      if (this.filterEnabled !== 'all') {
        const showEnabled = this.filterEnabled === 'enabled';
        entries = entries.filter(e => e.enabled === showEnabled);
      }
      
      if (this.searchQuery.trim()) {
        const query = this.searchQuery.toLowerCase();
        entries = entries.filter(e => {
          const nameMatch = (e.name || '').toLowerCase().includes(query);
          const keysMatch = (e.keys || []).some(k => k.toLowerCase().includes(query));
          const contentMatch = (e.content || '').toLowerCase().includes(query);
          return nameMatch || keysMatch || contentMatch;
        });
      }
      
      return entries;
    },

    get entryCount() {
      return this.entries.length;
    },

    get enabledCount() {
      return this.entries.filter(e => e.enabled).length;
    },

    get constantCount() {
      return this.entries.filter(e => e.constant).length;
    },

    init() {
      if (!this.lorebook) {
        this.lorebook = {
          name: '',
          description: '',
          scan_depth: null,
          token_budget: null,
          recursive_scanning: false,
          extensions: {},
          entries: [],
        };
      }
      
      if (this.lorebook && this.lorebook.entries && Array.isArray(this.lorebook.entries)) {
        this.lorebook.entries.forEach((entry, _index) => {
          if (entry.id === undefined || entry.id === null) {
            entry.id = generateUniqueId();
          }
        });
      }
      
      this.$nextTick(() => {
        this.initSortable();
      });
    },

    initSortable() {
      const container = this.$refs.entriesContainer;
      if (!container) return;

      this.sortable = Sortable.create(container, {
        animation: 200,
        handle: '.entry-drag-handle',
        ghostClass: 'opacity-50',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        onEnd: (evt) => {
          if (!this.lorebook) return;
          if (evt.oldIndex === evt.newIndex) return;
          
          const movedId = evt.item.getAttribute('data-entry-id');
          if (!movedId) return;
          
          const entries = this.lorebook.entries;
          const fromIndex = entries.findIndex(e => e.id === movedId);
          if (fromIndex === -1) return;
          
          let toIndex;
          const nextSibling = evt.item.nextElementSibling;
          const prevSibling = evt.item.previousElementSibling;
          
          if (nextSibling) {
            const nextId = nextSibling.getAttribute('data-entry-id');
            if (nextId) {
              const nextRealIndex = entries.findIndex(e => e.id === nextId);
              toIndex = nextRealIndex > fromIndex ? nextRealIndex - 1 : nextRealIndex;
            }
          }
          
          if (toIndex === undefined && prevSibling) {
            const prevId = prevSibling.getAttribute('data-entry-id');
            if (prevId) {
              const prevRealIndex = entries.findIndex(e => e.id === prevId);
              toIndex = prevRealIndex >= fromIndex ? prevRealIndex : prevRealIndex + 1;
            }
          }
          
          if (toIndex === undefined) toIndex = entries.length - 1;
          if (toIndex < 0) toIndex = 0;
          if (fromIndex === toIndex) return;
          
          this.sortable.option('disabled', true);
          
          const [removed] = entries.splice(fromIndex, 1);
          entries.splice(toIndex, 0, removed);
          
          this.$nextTick(() => {
            this.sortable.option('disabled', false);
          });
          
          this.triggerUpdate();
        },
      });
    },

    destroy() {
      if (this.sortable) {
        this.sortable.destroy();
        this.sortable = null;
      }
    },

    addEntry() {
      if (!this.lorebook) {
        this.lorebook = {
          name: '',
          description: '',
          extensions: {},
          entries: [],
        };
      }
      
      const newEntry = createEmptyEntry();
      newEntry.insertion_order = 0;
      this.lorebook.entries.unshift(newEntry);
      
      this.expandedEntries[newEntry.id] = true;
      this.triggerUpdate();
      
      this.$nextTick(() => {
        const container = this.$refs.entriesContainer;
        if (container) {
          container.scrollTop = 0;
        }
      });
    },

    removeEntry(index) {
      if (!this.lorebook || index < 0 || index >= this.lorebook.entries.length) return;
      
      const entry = this.lorebook.entries[index];
      delete this.expandedEntries[entry.id];
      this.lorebook.entries.splice(index, 1);
      this.triggerUpdate();
    },

    duplicateEntry(index) {
      if (!this.lorebook || index < 0 || index >= this.lorebook.entries.length) return;
      
      const original = this.lorebook.entries[index];
      const copy = JSON.parse(JSON.stringify(original));
      copy.id = generateUniqueId();
      copy.name = (original.name || '') + ' (副本)';
      
      this.lorebook.entries.splice(index + 1, 0, copy);
      this.expandedEntries[copy.id] = true;
      this.triggerUpdate();
    },

    openEntryModal(index) {
      if (!this.lorebook || index < 0 || index >= this.lorebook.entries.length) return;
      
      const entry = this.lorebook.entries[index];
      const entryCopy = JSON.parse(JSON.stringify(entry));
      
      Alpine.store('modalStack').push({
        type: 'lorebook-entry',
        title: entry.name || '编辑世界书条目',
        size: 'full',
        data: { entry: entryCopy, index },
        draft: { entry: entryCopy },
        onSave: (draft) => {
          if (this.lorebook && draft.entry) {
            this.lorebook.entries[index] = draft.entry;
            this.triggerUpdate();
          }
        }
      });
    },

    toggleEnabled(index) {
      if (!this.lorebook || index < 0 || index >= this.lorebook.entries.length) return;
      this.lorebook.entries[index].enabled = !this.lorebook.entries[index].enabled;
      this.triggerUpdate();
    },

    toggleConstant(index) {
      if (!this.lorebook || index < 0 || index >= this.lorebook.entries.length) return;
      this.lorebook.entries[index].constant = !this.lorebook.entries[index].constant;
      this.triggerUpdate();
    },

    addKey(index, key) {
      if (!this.lorebook || index < 0 || index >= this.lorebook.entries.length) return;
      const trimmed = key.trim();
      if (!trimmed) return;
      
      const entry = this.lorebook.entries[index];
      if (!entry.keys) entry.keys = [];
      if (entry.keys.includes(trimmed)) return;
      
      entry.keys.push(trimmed);
      this.triggerUpdate();
    },

    removeKey(entryIndex, keyIndex) {
      if (!this.lorebook || entryIndex < 0 || entryIndex >= this.lorebook.entries.length) return;
      const entry = this.lorebook.entries[entryIndex];
      if (!entry.keys || keyIndex < 0 || keyIndex >= entry.keys.length) return;
      
      entry.keys.splice(keyIndex, 1);
      this.triggerUpdate();
    },

    addSecondaryKey(index, key) {
      if (!this.lorebook || index < 0 || index >= this.lorebook.entries.length) return;
      const trimmed = key.trim();
      if (!trimmed) return;
      
      const entry = this.lorebook.entries[index];
      if (!entry.secondary_keys) entry.secondary_keys = [];
      if (entry.secondary_keys.includes(trimmed)) return;
      
      entry.secondary_keys.push(trimmed);
      this.triggerUpdate();
    },

    removeSecondaryKey(entryIndex, keyIndex) {
      if (!this.lorebook || entryIndex < 0 || entryIndex >= this.lorebook.entries.length) return;
      const entry = this.lorebook.entries[entryIndex];
      if (!entry.secondary_keys || keyIndex < 0 || keyIndex >= entry.secondary_keys.length) return;
      
      entry.secondary_keys.splice(keyIndex, 1);
      this.triggerUpdate();
    },

    updateEntryField(index, field, value) {
      if (!this.lorebook || index < 0 || index >= this.lorebook.entries.length) return;
      this.lorebook.entries[index][field] = value;
      this.triggerUpdate();
    },

    updateLorebookMeta(field, value) {
      if (!this.lorebook) return;
      this.lorebook[field] = value;
      this.triggerUpdate();
    },

    triggerUpdate() {
      if (this.onUpdate) {
        this.onUpdate(this.lorebook);
      }
    },

    clearAll() {
      if (!this.lorebook || this.lorebook.entries.length === 0) return;
      
      Alpine.store('modal')?.open({
        type: 'danger',
        title: '确认清空',
        message: `确定要删除所有 ${this.lorebook.entries.length} 个世界书条目吗？此操作不可撤销。`,
        confirmText: '清空',
        onConfirm: () => {
          this.lorebook.entries = [];
          this.expandedEntries = {};
          this.triggerUpdate();
        },
      });
    },

    handleExport() {
      if (!this.lorebook || this.lorebook.entries.length === 0) {
        Alpine.store('toast')?.info?.('没有可导出的世界书条目');
        return;
      }

      const dataStr = JSON.stringify(this.lorebook, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `lorebook_${this.lorebook.name || 'export'}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      Alpine.store('toast')?.success?.('世界书已导出');
    },

    async handleImportFile(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        
        if (!imported.entries || !Array.isArray(imported.entries)) {
          throw new Error('无效的世界书格式：缺少 entries 数组');
        }

        const hasExisting = this.lorebook && this.lorebook.entries.length > 0;
        
        if (hasExisting) {
          Alpine.store('modal')?.open({
            type: 'warning',
            title: '导入世界书',
            message: `当前已有 ${this.lorebook.entries.length} 个条目。要如何处理？`,
            confirmText: '替换全部',
            cancelText: '追加合并',
            showCancel: true,
            onConfirm: () => {
              this.applyImport(imported, 'replace');
            },
            onCancel: () => {
              this.applyImport(imported, 'merge');
            },
          });
        } else {
          this.applyImport(imported, 'replace');
        }
      } catch (error) {
        Alpine.store('toast')?.error?.(`导入失败: ${error.message}`);
      }
      
      event.target.value = '';
    },

    applyImport(imported, mode) {
      if (mode === 'replace') {
        this.lorebook = {
          ...imported,
          name: imported.name || '',
          description: imported.description || '',
          entries: imported.entries.map((e, _i) => ({
            ...e,
            id: e.id ?? generateUniqueId(),
          })),
        };
        this.expandedEntries = {};
        Alpine.store('toast')?.success?.(`已导入 ${imported.entries.length} 个条目`);
      } else {
        if (!this.lorebook) {
          this.lorebook = {
            name: '',
            description: '',
            extensions: {},
            entries: [],
          };
        }
        
        const existingIds = new Set(this.lorebook.entries.map(e => String(e.id)));
        let addedCount = 0;
        
        for (const entry of imported.entries) {
          const entryId = entry.id ?? generateUniqueId();
          const entryIdStr = String(entryId);
          
          if (!existingIds.has(entryIdStr)) {
            this.lorebook.entries.push({
              ...entry,
              id: entryId,
            });
            existingIds.add(entryIdStr);
            addedCount++;
          }
        }
        
        Alpine.store('toast')?.success?.(`已追加 ${addedCount} 个条目`);
      }
      
      this.triggerUpdate();
    },

    getPositionLabel(pos) {
      switch (pos) {
        case 'before_char': return '角色定义前';
        case 'after_char': return '角色定义后';
        default: return '默认';
      }
    },

    getEntrySummary(entry) {
      if (entry.constant) return '[始终激活]';
      if (!entry.keys || entry.keys.length === 0) return '[无关键词]';
      if (entry.keys.length <= 2) return entry.keys.join(', ');
      return entry.keys.slice(0, 2).join(', ') + ` +${entry.keys.length - 2}`;
    },

    getEntryPreview(entry) {
      const content = entry.content || '';
      if (content.length <= 60) return content;
      return content.slice(0, 60) + '...';
    },
  };
}

/**
 * 注册世界书编辑器组件
 */
export function registerLorebookEditorComponent() {
  Alpine.data('lorebookEditor', lorebookEditor);
}

export { createEmptyEntry };
