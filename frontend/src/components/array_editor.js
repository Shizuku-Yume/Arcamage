/**
 * 字符串数组编辑器组件 (Array Editor)
 * 
 * 用于 alternate_greetings/group_only_greetings 等字符串数组字段
 * 支持拖拽排序（使用 SortableJS）
 * 遵循 frontend_design.md §5.5 设计规范
 */

import Alpine from 'alpinejs';
import Sortable from 'sortablejs';

/**
 * 字符串数组编辑器组件
 * 
 * @example
 * <div x-data="arrayEditor({ 
 *   items: $store.card.data.data.alternate_greetings,
 *   onUpdate: (items) => { ... },
 *   itemLabel: '开场白',
 *   placeholder: '输入开场白内容...'
 * })">
 */
export function arrayEditor(config = {}) {
  return {
    items: config.items || [],
    onUpdate: config.onUpdate || null,
    itemLabel: config.itemLabel || '项目',
    placeholder: config.placeholder || '输入内容...',
    emptyMessage: config.emptyMessage || '暂无内容',
    maxItems: config.maxItems || 50,
    minHeight: config.minHeight || '80px',
    maxHeight: config.maxHeight || '300px',
    singleLine: config.singleLine || false,
    sortable: null,
    editingIndex: -1,
    
    init() {
      // 确保 items 是数组
      if (!Array.isArray(this.items)) {
        this.items = [];
      }
      
      // 初始化拖拽排序
      this.$nextTick(() => {
        this.initSortable();
      });
    },
    
    /**
     * 初始化 SortableJS
     */
    initSortable() {
      const container = this.$refs.sortableContainer;
      if (!container) return;
      
      this.sortable = Sortable.create(container, {
        animation: 200,
        handle: '.drag-handle',
        ghostClass: 'opacity-50',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        onEnd: (evt) => {
          // 更新数组顺序
          const item = this.items.splice(evt.oldIndex, 1)[0];
          this.items.splice(evt.newIndex, 0, item);
          this.triggerUpdate();
        },
      });
    },
    
    /**
     * 销毁 SortableJS 实例
     */
    destroy() {
      if (this.sortable) {
        this.sortable.destroy();
        this.sortable = null;
      }
    },
    
    /**
     * 添加新项
     */
    addItem() {
      if (this.items.length >= this.maxItems) {
        Alpine.store('toast')?.error?.(`最多添加 ${this.maxItems} 项`);
        return;
      }
      
      this.items.push('');
      this.editingIndex = this.items.length - 1;
      this.triggerUpdate();
      
      this.$nextTick(() => {
        const inputs = this.$el.querySelectorAll(this.singleLine ? 'input[type="text"]' : 'textarea');
        const lastInput = inputs[inputs.length - 1];
        if (lastInput) {
          lastInput.focus();
        }
      });
    },
    
    /**
     * 删除项
     */
    removeItem(index) {
      if (index >= 0 && index < this.items.length) {
        this.items.splice(index, 1);
        this.editingIndex = -1;
        this.triggerUpdate();
      }
    },
    
    /**
     * 更新项内容
     */
    updateItem(index, value) {
      if (index >= 0 && index < this.items.length) {
        this.items[index] = value;
        this.triggerUpdate();
      }
    },
    
    /**
     * 复制项
     */
    duplicateItem(index) {
      if (this.items.length >= this.maxItems) {
        Alpine.store('toast')?.error?.(`最多添加 ${this.maxItems} 项`);
        return;
      }
      
      if (index >= 0 && index < this.items.length) {
        const copy = this.items[index];
        this.items.splice(index + 1, 0, copy);
        this.triggerUpdate();
      }
    },
    
    /**
     * 上移项
     */
    moveUp(index) {
      if (index > 0) {
        const item = this.items.splice(index, 1)[0];
        this.items.splice(index - 1, 0, item);
        this.triggerUpdate();
      }
    },
    
    /**
     * 下移项
     */
    moveDown(index) {
      if (index < this.items.length - 1) {
        const item = this.items.splice(index, 1)[0];
        this.items.splice(index + 1, 0, item);
        this.triggerUpdate();
      }
    },
    
    /**
     * 触发更新回调
     */
    triggerUpdate() {
      if (this.onUpdate) {
        this.onUpdate(this.items);
      }
    },
    
    /**
     * 清空所有项
     */
    clearAll() {
      if (this.items.length === 0) return;
      
      Alpine.store('modal')?.open({
        type: 'danger',
        title: '确认清空',
        message: `确定要删除所有 ${this.items.length} 个${this.itemLabel}吗？此操作不可撤销。`,
        confirmText: '清空',
        onConfirm: () => {
          this.items = [];
          this.triggerUpdate();
        },
      });
    },
  };
}

/**
 * 注册字符串数组编辑器组件
 */
export function registerArrayEditorComponent() {
  Alpine.data('arrayEditor', arrayEditor);
}

/**
 * 生成字符串数组编辑器 HTML
 * 
 * @param {Object} options
 * @param {string} options.modelPath - Alpine store 路径
 * @param {string} options.label - 标签文字
 * @param {string} options.itemLabel - 项目标签
 * @param {string} options.placeholder - 占位符
 * @param {string} options.emptyMessage - 空状态消息
 * @param {boolean} options.singleLine - 是否使用单行输入（适用于 tags 等短文本）
 */
export function getArrayEditorHTML(options = {}) {
  const modelPath = options.modelPath || '$store.card.data.data.alternate_greetings';
  const label = options.label || '备选开场白';
  const itemLabel = options.itemLabel || '开场白';
  const placeholder = options.placeholder || '输入内容...';
  const emptyMessage = options.emptyMessage || '暂无内容';
  const singleLine = options.singleLine || false;
  
  return `
    <div x-data="arrayEditor({ 
      items: ${modelPath},
      onUpdate: (items) => { ${modelPath} = items; $store.card.checkChanges(); },
      itemLabel: '${itemLabel}',
      placeholder: '${placeholder}',
      emptyMessage: '${emptyMessage}',
      singleLine: ${singleLine}
    })">
      <div class="bg-zinc-50 dark:bg-zinc-900/50 rounded-neo p-4">
        <!-- 标题栏 -->
        <div class="flex items-center justify-between mb-3">
          <label class="text-sm font-medium text-zinc-700 dark:text-zinc-300">${label}</label>
          <div class="flex items-center gap-2">
            <span class="text-xs text-zinc-400 dark:text-zinc-500" x-text="items.length + ' 项'"></span>
            <button @click="addItem()"
                    type="button"
                    class="btn-secondary px-2 py-1 text-sm font-medium gap-1">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              添加
            </button>
          </div>
        </div>
        
        <!-- 空状态 -->
        <template x-if="items.length === 0">
          <div class="flex flex-col items-center justify-center py-8 text-center bg-zinc-50 dark:bg-zinc-800/50 rounded-neo animate-fade-in-up">
          <div class="w-12 h-12 bg-zinc-100 dark:bg-zinc-700 rounded-neo flex items-center justify-center mb-3">
              <svg class="w-6 h-6 text-zinc-300 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
              </svg>
            </div>
            <p class="text-zinc-500 dark:text-zinc-400 text-sm mb-1" x-text="emptyMessage"></p>
            <button @click="addItem()"
                    type="button"
                    class="btn-secondary px-2 py-1 text-sm font-medium mt-2">
              + 添加<span x-text="itemLabel"></span>
            </button>
          </div>
        </template>
        
        <!-- 列表 -->
        <div x-ref="sortableContainer"
             class="space-y-2"
             x-show="items.length > 0"
             x-transition:enter="transition ease-out duration-220"
             x-transition:enter-start="opacity-0 translate-y-1"
             x-transition:enter-end="opacity-100 translate-y-0"
             x-transition:leave="transition ease-in duration-160"
             x-transition:leave-start="opacity-100 translate-y-0"
             x-transition:leave-end="opacity-0 -translate-y-1">
          <template x-for="(item, index) in items" :key="index">
            <div class="bg-white dark:bg-zinc-800 rounded-neo shadow-neo-lift dark:shadow-neo-lift-dark border border-zinc-100 dark:border-zinc-700 transition-all duration-200 hover:shadow-neo-lift-hover dark:hover:shadow-neo-lift-hover-dark group animate-fade-in-up"
                 :class="singleLine ? 'p-2' : 'p-3'">
              <div class="flex gap-2" :class="singleLine ? 'items-center' : 'items-start'">
                <!-- 拖拽手柄 -->
                <div class="drag-handle flex-shrink-0 cursor-grab active:cursor-grabbing text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 transition-colors"
                     :class="singleLine ? '' : 'mt-2'">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                </div>
                
                <!-- 序号 -->
              <span class="flex-shrink-0 w-6 h-6 bg-zinc-100 dark:bg-zinc-700 rounded-neo flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400 font-medium"
                      :class="singleLine ? '' : 'mt-1'"
                      x-text="index + 1"></span>
                
                <!-- 内容编辑区 -->
                <div class="flex-1 min-w-0">
                  <template x-if="singleLine">
                    <input type="text" 
                           x-model="items[index]"
                           @input="triggerUpdate()"
                           :placeholder="placeholder"
                           class="w-full bg-zinc-100/80 dark:bg-zinc-700  rounded-neo px-3 py-1.5 outline-none 
                                   text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500
                                    focus:border-brand dark:focus:border-brand-400  text-sm">
                  </template>
                  <template x-if="!singleLine">
                    <textarea x-model="items[index]"
                              @input="triggerUpdate()"
                              :placeholder="placeholder"
                              class="w-full bg-zinc-100/80 dark:bg-zinc-700  rounded-neo px-3 py-2 outline-none resize-y 
                                     text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500
                                      focus:border-brand dark:focus:border-brand-400  text-sm"
                              :style="'min-height: ' + minHeight + '; max-height: ' + maxHeight + ';'"
                              rows="2"></textarea>
                  </template>
                </div>
                
                <!-- 操作按钮组 -->
                <div class="flex-shrink-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                     :class="singleLine ? 'flex-row items-center' : 'flex-col'">
                  <button @click="moveUp(index)"
                          :disabled="index === 0"
                          :class="index === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:text-brand dark:hover:text-brand-light'"
                          class="btn-icon-ghost p-1 transition-colors"
                          title="上移"
                          type="button">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                  <button @click="moveDown(index)"
                          :disabled="index === items.length - 1"
                          :class="index === items.length - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:text-brand dark:hover:text-brand-light'"
                          class="btn-icon-ghost p-1 transition-colors"
                          title="下移"
                          type="button">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  <button @click="duplicateItem(index)"
                          class="btn-icon-ghost p-1 transition-colors"
                          title="复制"
                          type="button">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                    </svg>
                  </button>
                  <button @click="removeItem(index)"
                          class="btn-danger p-1 transition-colors"
                          title="删除"
                          type="button">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </template>
        </div>
        
        <!-- 添加按钮 (底部虚线样式) -->
        <button x-show="items.length > 0 && items.length < maxItems"
                @click="addItem()"
                type="button"
                class="w-full mt-2 border-2 border-dashed border-zinc-200 dark:border-zinc-700 hover:border-brand-400 dark:hover:border-brand-500 
                       rounded-neo py-3 text-zinc-400 dark:text-zinc-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors
                       flex items-center justify-center gap-2">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span>添加<span x-text="itemLabel"></span></span>
        </button>
        
        <!-- 清空按钮 -->
        <div x-show="items.length > 2"
             x-transition:enter="transition ease-out duration-220"
             x-transition:enter-start="opacity-0 translate-y-1"
             x-transition:enter-end="opacity-100 translate-y-0"
             x-transition:leave="transition ease-in duration-160"
             x-transition:leave-start="opacity-100 translate-y-0"
             x-transition:leave-end="opacity-0 -translate-y-1"
             class="flex justify-end mt-2">
          <button @click="clearAll()"
                  type="button"
                  class="btn-danger px-2 py-1 text-xs">
            清空全部
          </button>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// 导出
// ============================================================

export default {
  arrayEditor,
  registerArrayEditorComponent,
  getArrayEditorHTML,
};
