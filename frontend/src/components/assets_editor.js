import Alpine from 'alpinejs';

export function assetsEditor(config = {}) {
  return {
    assets: config.assets || [],
    onUpdate: config.onUpdate || null,
    expanded: config.expanded ?? false,
    editMode: 'list',
    rawJson: '',
    isJsonValid: true,
    jsonError: '',
    
    assetTypes: [
      { value: 'icon', label: '图标 (Icon)' },
      { value: 'background', label: '背景 (Background)' },
      { value: 'user_icon', label: '用户图标 (User Icon)' },
      { value: 'emotion', label: '表情 (Emotion)' },
      { value: 'other', label: '其他 (Other)' },
    ],
    
    init() {
      if (!Array.isArray(this.assets)) {
        this.assets = [];
      }
      this.updateRawJson();
    },
    
    /**
     * 切换展开/折叠
     */
    toggle() {
      this.expanded = !this.expanded;
    },
    
    /**
     * 切换编辑模式
     */
    switchMode(mode) {
      if (mode === 'json') {
        this.updateRawJson();
      } else if (mode === 'list' && this.isJsonValid) {
        this.parseRawJson();
      }
      this.editMode = mode;
    },
    
    /**
     * 更新 JSON 文本
     */
    updateRawJson() {
      try {
        this.rawJson = JSON.stringify(this.assets, null, 2);
        this.isJsonValid = true;
        this.jsonError = '';
      } catch (error) {
        console.warn('[assets_editor] Failed to serialize assets JSON:', error);
        this.isJsonValid = false;
        this.jsonError = '资源序列化失败，请检查当前数据';
        if (!this.rawJson) {
          this.rawJson = '[]';
        }
      }
    },
    
    /**
     * 解析 JSON 文本
     */
    parseRawJson() {
      try {
        const parsed = JSON.parse(this.rawJson);
        if (!Array.isArray(parsed)) {
          throw new Error('必须是一个数组');
        }
        this.assets = parsed;
        this.isJsonValid = true;
        this.jsonError = '';
        return true;
      } catch (e) {
        this.isJsonValid = false;
        this.jsonError = e.message || '无效的 JSON 格式';
        return false;
      }
    },
    
    /**
     * 处理 JSON 输入
     */
    handleJsonInput() {
      if (this.parseRawJson()) {
        this.triggerUpdate();
      }
    },
    
    /**
     * 添加新资源
     */
    addAsset() {
      this.assets.push({
        type: 'icon',
        uri: 'ccdefault:',
        name: 'main',
        ext: 'png',
      });
      this.triggerUpdate();
      this.updateRawJson();
    },
    
    /**
     * 删除资源
     */
    removeAsset(index) {
      if (index >= 0 && index < this.assets.length) {
        this.assets.splice(index, 1);
        this.triggerUpdate();
        this.updateRawJson();
      }
    },
    
    /**
     * 更新资源字段
     */
    updateAsset(index, field, value) {
      if (index >= 0 && index < this.assets.length) {
        this.assets[index][field] = value;
        this.triggerUpdate();
        this.updateRawJson();
      }
    },
    
    /**
     * 复制资源
     */
    duplicateAsset(index) {
      if (index >= 0 && index < this.assets.length) {
        const copy = { ...this.assets[index] };
        copy.name = copy.name + '_copy';
        this.assets.splice(index + 1, 0, copy);
        this.triggerUpdate();
        this.updateRawJson();
      }
    },
    
    /**
     * 触发更新回调
     */
    triggerUpdate() {
      if (this.onUpdate) {
        this.onUpdate(this.assets);
      }
    },
    
    /**
     * 清空所有资源
     */
    clearAll() {
      Alpine.store('modal')?.open({
        type: 'danger',
        title: '确认清空',
        message: `确定要删除所有 ${this.assets.length} 个资源吗？`,
        confirmText: '清空',
        onConfirm: () => {
          this.assets = [];
          this.triggerUpdate();
          this.updateRawJson();
        },
      });
    },
    
    /**
     * 获取资源类型标签
     */
    getTypeLabel(type) {
      const found = this.assetTypes.find(t => t.value === type);
      return found ? found.label : type;
    },
    
    /**
     * URI 类型判断
     */
    getUriType(uri) {
      if (!uri) return 'empty';
      if (uri.startsWith('ccdefault:')) return 'default';
      if (uri.startsWith('embeded://')) return 'embedded';
      if (uri.startsWith('data:')) return 'dataurl';
      if (uri.startsWith('http://') || uri.startsWith('https://')) return 'url';
      return 'other';
    },
    
    /**
     * URI 类型标签
     */
    getUriTypeLabel(uri) {
      const type = this.getUriType(uri);
      const labels = {
        default: '默认',
        embedded: '嵌入',
        dataurl: 'Data URL',
        url: '外部 URL',
        other: '其他',
        empty: '空',
      };
      return labels[type] || type;
    },
  };
}

/**
 * 注册 Assets 编辑器组件
 */
export function registerAssetsEditorComponent() {
  Alpine.data('assetsEditor', assetsEditor);
}

/**
 * 生成 Assets 编辑器 HTML
 */
export function getAssetsEditorHTML(options = {}) {
  const modelPath = options.modelPath || '$store.card.data.data.assets';
  const label = options.label || 'Assets 资源';
  const expanded = options.expanded ?? false;
  
  return `
    <div x-data="assetsEditor({ 
      assets: ${modelPath},
      onUpdate: (assets) => { ${modelPath} = assets; $store.card.checkChanges(); },
      expanded: ${expanded}
    })">
      <!-- 标题栏 -->
      <button @click="toggle()" 
              type="button"
              class="w-full flex items-center justify-between py-2 text-left">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-zinc-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
          <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">${label}</span>
          <span x-show="assets.length > 0" 
                          class="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-700 rounded-neo px-2 py-0.5"
                x-text="assets.length + ' 项'"></span>
        </div>
        <svg class="w-4 h-4 text-zinc-400 dark:text-zinc-500 transition-transform"
             :class="expanded ? 'rotate-180' : ''"
             fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      
      <!-- 编辑区域 -->
      <div x-show="expanded" x-collapse class="mt-2">
        <!-- 模式切换 -->
        <div class="flex items-center justify-between mb-3">
          <div class="inline-flex bg-zinc-100 dark:bg-zinc-700 rounded-neo p-0.5">
            <button @click="switchMode('list')"
                    :class="editMode === 'list' ? 'bg-white dark:bg-zinc-600 shadow-sm text-zinc-700 dark:text-zinc-200' : 'text-zinc-500 dark:text-zinc-400'"
                    type="button"
                    class="px-3 py-1 text-xs font-medium rounded-neo ">
              列表
            </button>
            <button @click="switchMode('json')"
                    :class="editMode === 'json' ? 'bg-white dark:bg-zinc-600 shadow-sm text-zinc-700 dark:text-zinc-200' : 'text-zinc-500 dark:text-zinc-400'"
                    type="button"
                    class="px-3 py-1 text-xs font-medium rounded-neo ">
              JSON
            </button>
          </div>
          <button @click="addAsset()"
                  x-show="editMode === 'list'"
                  type="button"
                  class="btn-secondary px-2 py-1 text-sm font-medium gap-1">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            添加
          </button>
        </div>
        
        <!-- 列表模式 -->
        <div x-show="editMode === 'list'"
             x-transition:enter="transition ease-out duration-220"
             x-transition:enter-start="opacity-0 translate-y-1"
             x-transition:enter-end="opacity-100 translate-y-0"
             x-transition:leave="transition ease-in duration-160"
             x-transition:leave-start="opacity-100 translate-y-0"
             x-transition:leave-end="opacity-0 -translate-y-1"
             class="space-y-2">
          <!-- 空状态 -->
          <template x-if="assets.length === 0">
            <div class="flex flex-col items-center justify-center py-6 text-center bg-zinc-50 dark:bg-zinc-800/50 rounded-neo">
              <svg class="w-8 h-8 text-zinc-300 dark:text-zinc-600 mb-2" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
              </svg>
              <p class="text-zinc-500 dark:text-zinc-400 text-sm">暂无资源</p>
              <button @click="addAsset()"
                      type="button"
                      class="btn-secondary px-2 py-1 text-sm font-medium mt-2">
                + 添加资源
              </button>
            </div>
          </template>
          
          <!-- 资源列表 -->
          <template x-for="(asset, index) in assets" :key="index">
            <div class="bg-white dark:bg-zinc-800 rounded-neo p-3 shadow-neo-lift dark:shadow-neo-lift-dark border border-zinc-100 dark:border-zinc-700 group transition-all duration-200 animate-fade-in-up">
              <div class="flex items-start gap-3">
                <!-- 序号 -->
              <span class="flex-shrink-0 w-6 h-6 bg-zinc-100 dark:bg-zinc-700 rounded-neo flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400 font-medium"
                      x-text="index + 1"></span>
                
                <!-- 字段编辑 -->
                <div class="flex-1 grid grid-cols-2 gap-2">
                  <!-- Type -->
                  <div>
                    <label class="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">Type</label>
                    <select :value="asset.type"
                            @change="updateAsset(index, 'type', $event.target.value)"
                            class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 outline-none  focus:border-brand dark:focus:border-brand-400  cursor-pointer">
                      <template x-for="t in assetTypes" :key="t.value">
                        <option :value="t.value" x-text="t.label"></option>
                      </template>
                    </select>
                  </div>
                  
                  <!-- Name -->
                  <div>
                    <label class="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">Name</label>
                    <input type="text"
                           :value="asset.name"
                           @input="updateAsset(index, 'name', $event.target.value)"
                           placeholder="main"
                           class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none  focus:border-brand dark:focus:border-brand-400 ">
                  </div>
                  
                  <!-- URI -->
                  <div class="col-span-2">
                    <div class="flex items-center justify-between mb-1">
                      <label class="text-xs text-zinc-500 dark:text-zinc-400">URI</label>
                      <span class="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-700 rounded-neo px-1.5"
                            x-text="getUriTypeLabel(asset.uri)"></span>
                    </div>
                    <input type="text"
                           :value="asset.uri"
                           @input="updateAsset(index, 'uri', $event.target.value)"
                           placeholder="ccdefault:"
                           class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-2 py-1.5 text-sm font-mono text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none  focus:border-brand dark:focus:border-brand-400 ">
                  </div>
                  
                  <!-- Ext -->
                  <div>
                    <label class="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">Extension</label>
                    <input type="text"
                           :value="asset.ext"
                           @input="updateAsset(index, 'ext', $event.target.value)"
                           placeholder="png"
                           class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none  focus:border-brand dark:focus:border-brand-400 ">
                  </div>
                </div>
                
                <!-- 操作按钮 -->
                <div class="flex-shrink-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button @click="duplicateAsset(index)"
                          type="button"
                          class="btn-icon-ghost p-1 transition-colors"
                          title="复制">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                    </svg>
                  </button>
                  <button @click="removeAsset(index)"
                          type="button"
                          class="btn-danger p-1 transition-colors"
                          title="删除">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </template>
        </div>
        
        <!-- JSON 模式 -->
        <div x-show="editMode === 'json'"
             x-transition:enter="transition ease-out duration-220"
             x-transition:enter-start="opacity-0 translate-y-1"
             x-transition:enter-end="opacity-100 translate-y-0"
             x-transition:leave="transition ease-in duration-160"
             x-transition:leave-start="opacity-100 translate-y-0"
             x-transition:leave-end="opacity-0 -translate-y-1">
          <div class="relative">
            <textarea x-model="rawJson"
                      x-ref="textareaAutosize"
                      x-effect="if (expanded && editMode === 'json') { $nextTick(() => {
                        const el = $refs.textareaAutosize;
                        if (el) {
                          el.style.height = 'auto';
                          const scrollHeight = el.scrollHeight;
                          const minHeight = 200;
                          const maxHeight = window.innerHeight * 0.6;
                          el.style.height = Math.min(Math.max(scrollHeight, minHeight), maxHeight) + 'px';
                        }
                      }) }"
                      @input.debounce.300ms="handleJsonInput(); $nextTick(() => { 
                        const el = $refs.textareaAutosize;
                        if (el) {
                          el.style.height = 'auto';
                          const scrollHeight = el.scrollHeight;
                          const minHeight = 200;
                          const maxHeight = window.innerHeight * 0.6;
                          el.style.height = Math.min(Math.max(scrollHeight, minHeight), maxHeight) + 'px';
                        }
                      })"
                       :class="isJsonValid 
                         ? 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-600  focus:border-zinc-300 dark:focus:border-zinc-500' 
                         : 'bg-danger-light dark:bg-danger-dark border-danger dark:border-danger'"
                       class="w-full rounded-neo px-4 py-3 border outline-none transition-colors font-mono text-sm text-zinc-700 dark:text-zinc-200 resize-y min-h-[200px] max-h-[60vh] custom-scrollbar"
                       placeholder="[]"></textarea>
          </div>
          
          <!-- JSON 错误提示 -->
          <div x-show="!isJsonValid" class="flex items-center gap-2 mt-2 text-danger dark:text-danger-light text-sm">
            <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span x-text="jsonError"></span>
          </div>
        </div>
        
        <!-- 底部操作 -->
        <div x-show="assets.length > 1" class="flex justify-end mt-2">
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
  assetsEditor,
  registerAssetsEditorComponent,
  getAssetsEditorHTML,
};
