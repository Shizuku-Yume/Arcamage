/**
 * 标签输入组件 (Tags Input)
 * 
 * 提供胶囊式标签编辑功能
 * 遵循 frontend_design.md §5.4 设计规范
 */

import Alpine from 'alpinejs';

/**
 * 标签输入组件
 * 
 * @example
 * <div x-data="tagsInput({ 
 *   tags: $store.card.data.data.tags,
 *   onUpdate: (tags) => { $store.card.data.data.tags = tags; $store.card.checkChanges(); }
 * })">
 *   ...
 * </div>
 */
export function tagsInput(config = {}) {
  return {
    tags: config.tags || [],
    inputValue: '',
    focused: false,
    onUpdate: config.onUpdate || null,
    placeholder: config.placeholder || '输入后回车添加...',
    maxLength: config.maxLength || 50,
    maxTags: config.maxTags || 100,
    
    init() {
      // 确保 tags 是数组
      if (!Array.isArray(this.tags)) {
        this.tags = [];
      }
    },
    
    /**
     * 添加标签
     */
    addTag() {
      const value = this.inputValue.trim();
      
      if (!value) return;
      
      // 检查是否超过最大数量
      if (this.tags.length >= this.maxTags) {
        Alpine.store('toast')?.error?.(`最多添加 ${this.maxTags} 个标签`);
        return;
      }
      
      // 检查是否已存在（不区分大小写）
      const exists = this.tags.some(tag => 
        tag.toLowerCase() === value.toLowerCase()
      );
      
      if (exists) {
        Alpine.store('toast')?.info?.('标签已存在');
        this.inputValue = '';
        return;
      }
      
      // 添加标签
      this.tags.push(value);
      this.inputValue = '';
      
      // 触发更新回调
      this.triggerUpdate();
    },
    
    /**
     * 删除标签
     */
    removeTag(index) {
      if (index >= 0 && index < this.tags.length) {
        this.tags.splice(index, 1);
        this.triggerUpdate();
      }
    },
    
    /**
     * 处理键盘输入
     */
    handleKeydown(event) {
      // 回车添加标签
      if (event.key === 'Enter') {
        event.preventDefault();
        this.addTag();
        return;
      }
      
      // 退格删除最后一个标签（当输入框为空时）
      if (event.key === 'Backspace' && !this.inputValue && this.tags.length > 0) {
        this.removeTag(this.tags.length - 1);
      }
    },
    
    /**
     * 触发更新回调
     */
    triggerUpdate() {
      if (this.onUpdate) {
        this.onUpdate(this.tags);
      }
    },
    
    /**
     * 清空所有标签
     */
    clearAll() {
      this.tags = [];
      this.triggerUpdate();
    },
  };
}

/**
 * 注册标签输入组件
 */
export function registerTagsInputComponent() {
  Alpine.data('tagsInput', tagsInput);
}

/**
 * 生成标签输入 HTML 模板
 * 
 * @param {Object} options
 * @param {string} options.modelPath - Alpine store 路径，如 "$store.card.data.data.tags"
 * @param {string} options.label - 标签文字
 * @param {string} options.placeholder - 输入框占位符
 */
export function getTagsInputHTML(options = {}) {
  const modelPath = options.modelPath || '$store.card.data.data.tags';
  const label = options.label || '标签';
  const placeholder = options.placeholder || '输入后回车添加...';
  
  return `
    <div x-data="tagsInput({ 
      tags: ${modelPath},
      onUpdate: (tags) => { ${modelPath} = tags; $store.card.checkChanges(); },
      placeholder: '${placeholder}'
    })">
      <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">${label}</label>
      <div class="flex flex-wrap gap-2 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo p-2 min-h-[44px] cursor-text"
           :class="focused ? 'border-brand dark:border-brand-400' : ''"
           @click="$refs.tagInput.focus()">
        <!-- 标签列表 -->
        <template x-for="(tag, index) in tags" :key="index">
          <span class="bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-full px-3 py-1.5 text-xs font-medium 
                       inline-flex items-center gap-1.5 transition-all duration-200 hover:bg-zinc-200 dark:hover:bg-zinc-600 border border-zinc-200 dark:border-zinc-600 shadow-sm animate-fade-in-up">
            <span x-text="tag" class="max-w-[150px] truncate"></span>
             <button @click.stop="removeTag(index)" 
                    type="button"
                    class="text-zinc-400 dark:text-zinc-500 hover:text-danger dark:hover:text-danger-light transition-colors flex-shrink-0"
                    title="删除">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        </template>
        
        <!-- 输入框 -->
        <input type="text"
               x-ref="tagInput"
               x-model="inputValue"
               @keydown="handleKeydown($event)"
               @focus="focused = true"
               @blur="focused = false"
               :placeholder="tags.length === 0 ? placeholder : ''"
               :maxlength="maxLength"
               class="flex-1 min-w-[120px] bg-transparent outline-none text-sm text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500">
      </div>
      
      <!-- 标签数量提示 -->
      <div class="flex justify-between mt-1">
        <span x-show="tags.length > 0"
              x-transition:enter="transition ease-out duration-180"
              x-transition:enter-start="opacity-0"
              x-transition:enter-end="opacity-100"
              x-transition:leave="transition ease-in duration-120"
              x-transition:leave-start="opacity-100"
              x-transition:leave-end="opacity-0"
              class="text-xs text-zinc-400 dark:text-zinc-500"
              x-text="tags.length + ' 个标签'"></span>
        <button x-show="tags.length > 3"
                x-transition:enter="transition ease-out duration-180"
                x-transition:enter-start="opacity-0"
                x-transition:enter-end="opacity-100"
                x-transition:leave="transition ease-in duration-120"
                x-transition:leave-start="opacity-100"
                x-transition:leave-end="opacity-0"
                @click="clearAll()"
                type="button"
                class="text-xs text-zinc-400 dark:text-zinc-500 hover:text-danger dark:hover:text-danger-light transition-colors">
          清空
        </button>
      </div>
    </div>
  `;
}

// ============================================================
// 导出
// ============================================================

export default {
  tagsInput,
  registerTagsInputComponent,
  getTagsInputHTML,
};
