import Alpine from 'alpinejs';

export function jsonEditor(config = {}) {
  return {
    value: config.value || {},
    initialValue: null,
    onUpdate: config.onUpdate || null,
    label: config.label || 'Extensions',
    description: config.description || '扩展字段（JSON 格式）',
    rawText: '',
    isValid: true,
    errorMessage: '',
    expanded: config.expanded ?? false,
    
    init() {
      this.initialValue = JSON.parse(JSON.stringify(this.value || {}));
      this.rawText = this.formatJson(this.value);
    },
    
    formatJson(obj) {
      try {
        return JSON.stringify(obj || {}, null, 2);
      } catch (error) {
        console.warn('[extensions_editor] Failed to serialize JSON value:', error);
        return this.rawText || '{}';
      }
    },
    
    /**
     * 验证并解析 JSON
     */
    validateAndParse() {
      try {
        const parsed = JSON.parse(this.rawText);
        
        // 必须是对象类型
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          this.isValid = false;
          this.errorMessage = '必须是一个 JSON 对象 {}';
          return null;
        }
        
        this.isValid = true;
        this.errorMessage = '';
        return parsed;
      } catch (e) {
        this.isValid = false;
        this.errorMessage = e.message || '无效的 JSON 格式';
        return null;
      }
    },
    
    /**
     * 处理输入变化
     */
    handleInput() {
      const parsed = this.validateAndParse();
      
      if (parsed !== null && this.onUpdate) {
        this.value = parsed;
        this.onUpdate(parsed);
      }
    },
    
    /**
     * 格式化当前 JSON
     */
    formatCurrent() {
      const parsed = this.validateAndParse();
      if (parsed !== null) {
        this.rawText = this.formatJson(parsed);
      }
    },
    
    /**
     * 重置为初始值
     */
    reset() {
      this.value = JSON.parse(JSON.stringify(this.initialValue || {}));
      this.rawText = this.formatJson(this.value);
      this.isValid = true;
      this.errorMessage = '';
      if (this.onUpdate) {
        this.onUpdate(this.value);
      }
    },
    
    /**
     * 清空内容
     */
    clear() {
      this.rawText = '{}';
      this.value = {};
      this.isValid = true;
      this.errorMessage = '';
      if (this.onUpdate) {
        this.onUpdate({});
      }
    },
    
    /**
     * 计算行数
     */
    get lineCount() {
      return this.rawText.split('\n').length;
    },
    
    /**
     * 是否为空
     */
    get isEmpty() {
      try {
        const parsed = JSON.parse(this.rawText);
        return Object.keys(parsed).length === 0;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Extensions 专用编辑器组件
 */
export function extensionsEditor(config = {}) {
  const base = jsonEditor({
    value: config.value || {},
    onUpdate: config.onUpdate,
    label: config.label || 'Extensions',
    description: config.description || '扩展字段用于存储第三方工具的自定义数据',
  });
  
  return {
    ...base,
    expanded: config.expanded ?? false,
    
    /**
     * 切换展开/折叠
     */
    toggle() {
      this.expanded = !this.expanded;
    },
    
    /**
     * 添加常用字段模板
     */
    addTemplate(template) {
      try {
        const current = JSON.parse(this.rawText);
        const merged = { ...current, ...template };
        this.rawText = this.formatJson(merged);
        this.handleInput();
      } catch {
        Alpine.store('toast')?.error?.('合并失败：当前 JSON 格式无效');
      }
    },
  };
}

/**
 * 注册 JSON 编辑器组件
 */
export function registerJsonEditorComponent() {
  Alpine.data('jsonEditor', jsonEditor);
  Alpine.data('extensionsEditor', extensionsEditor);
}

/**
 * 生成 Extensions 编辑器 HTML
 */
export function getExtensionsEditorHTML(options = {}) {
  const modelPath = options.modelPath || '$store.card.data.data.extensions';
  const label = options.label || '扩展字段 (Extensions)';
  const expanded = options.expanded ?? false;
  
  return `
    <div x-data="extensionsEditor({ 
      value: ${modelPath},
      onUpdate: (value) => { ${modelPath} = value; $store.card.checkChanges(); },
      expanded: ${expanded}
    })">
      <!-- 标题栏 -->
      <button @click="toggle()" 
              type="button"
              class="w-full flex items-center justify-between py-2 text-left">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-zinc-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
          </svg>
          <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">${label}</span>
          <span x-show="!isEmpty" 
                          class="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-700 rounded-neo px-2 py-0.5"
                x-text="Object.keys(value).length + ' 字段'"></span>
        </div>
        <svg class="w-4 h-4 text-zinc-400 dark:text-zinc-500 transition-transform"
             :class="expanded ? 'rotate-180' : ''"
             fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      
      <!-- 编辑区域 -->
      <div x-show="expanded" x-collapse class="mt-2">
        <!-- 提示信息 -->
        <p class="text-xs text-zinc-400 dark:text-zinc-500 mb-2" x-text="description"></p>
        
        <!-- JSON 编辑器 -->
        <div class="relative">
          <textarea x-model="rawText"
                    x-ref="textareaAutosize"
                    x-effect="if (expanded) { $nextTick(() => {
                      const el = $refs.textareaAutosize;
                      if (el) {
                        el.style.height = 'auto';
                        const scrollHeight = el.scrollHeight;
                        const minHeight = 200;
                        const maxHeight = window.innerHeight * 0.6;
                        el.style.height = Math.min(Math.max(scrollHeight, minHeight), maxHeight) + 'px';
                      }
                    }) }"
                    @input.debounce.300ms="handleInput(); $nextTick(() => { 
                      const el = $refs.textareaAutosize;
                      if (el) {
                        el.style.height = 'auto';
                        const scrollHeight = el.scrollHeight;
                        const minHeight = 200;
                        const maxHeight = window.innerHeight * 0.6;
                        el.style.height = Math.min(Math.max(scrollHeight, minHeight), maxHeight) + 'px';
                      }
                    })"
                    :class="isValid 
                      ? 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-600 focus:bg-white dark:focus:bg-zinc-800 focus:border-zinc-300 dark:focus:border-zinc-500' 
                      : 'bg-danger-light dark:bg-danger-dark border-danger dark:border-danger'"
                    class="w-full rounded-neo px-4 py-3 border outline-none transition-colors font-mono text-sm text-zinc-700 dark:text-zinc-200 resize-y min-h-[200px] max-h-[60vh] custom-scrollbar"
                    placeholder="{}"></textarea>
          
          <!-- 行号指示 -->
                    <span class="absolute bottom-2 right-2 text-xs text-zinc-300 dark:text-zinc-600 bg-white/80 dark:bg-zinc-800/80 px-1.5 py-0.5 rounded-neo"
                x-text="lineCount + ' 行'"></span>
        </div>
        
        <!-- 错误提示 -->
        <div x-show="!isValid" class="flex items-center gap-2 mt-2 text-danger dark:text-danger-light text-sm">
          <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <span x-text="errorMessage"></span>
        </div>
        
        <!-- 操作按钮 -->
        <div class="flex items-center justify-between mt-2">
          <div class="flex gap-2">
            <button @click="formatCurrent()"
                    :disabled="!isValid"
                    :class="isValid ? '' : 'opacity-30 cursor-not-allowed'"
                    type="button"
                    class="btn-secondary px-2 py-1 text-xs">
              格式化
            </button>
            <button @click="reset()"
                    type="button"
                    class="btn-secondary px-2 py-1 text-xs">
              重置
            </button>
          </div>
          <button @click="clear()"
                  x-show="!isEmpty"
                  type="button"
                  class="btn-danger px-2 py-1 text-xs">
            清空
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
  jsonEditor,
  extensionsEditor,
  registerJsonEditorComponent,
  getExtensionsEditorHTML,
};
