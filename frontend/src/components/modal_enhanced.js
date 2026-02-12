import Alpine from 'alpinejs';
import { getArrayEditorHTML } from './array_editor.js';
import { getFerryBatchHTML } from './ferry_batch.js';
import { getFerryStagingHTML } from './ferry_staging.js';

export function modalEnhanced() {
  return {
    get stack() {
      return Alpine.store('modalStack').stack;
    },

    get visible() {
      return this.stack.length > 0;
    },

    get topModal() {
      return Alpine.store('modalStack').current;
    },

    getSizeClasses(size) {
      const sizes = {
        sm: 'max-w-sm',
        md: 'max-w-md',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
        full: 'max-w-[95vw] sm:max-w-[90vw] max-h-[calc(100dvh-1rem)] h-full',
      };
      return sizes[size] || sizes.lg;
    },

    getHeightClasses(modal) {
      if (modal.type === 'text' || modal.type === 'extensions') {
        return 'max-h-[calc(100dvh-8rem)] sm:max-h-[calc(100dvh-7rem)]';
      }
      return 'max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)]';
    },

    getModalBaseZIndex() {
      const agentStore = Alpine.store('agent');
      return agentStore?.ui?.isFullscreen ? 90 : 50;
    },

    getBackdropZIndex() {
      return this.getModalBaseZIndex();
    },

    getZIndex(index) {
      return this.getModalBaseZIndex() + Math.min(index, 8);
    },

    renderArrayEditor(modal) {
      return getArrayEditorHTML({
        modelPath: 'modal.draft.items',
        itemLabel: modal.meta?.itemLabel,
        placeholder: '输入内容...',
        emptyMessage: '暂无条目，点击下方按钮添加',
        singleLine: modal.meta?.singleLine || false
      });
    },

    handleSave(_modal) {
      Alpine.store('modalStack').pop(true);
    },

    handleCancel() {
      Alpine.store('modalStack').cancelAndClose();
    },

    isTop(modal) {
      return this.topModal && this.topModal.id === modal.id;
    },
    
    getTitle(modal) {
      return modal.title || '编辑';
    },

    getModalTabClass(isActive) {
      return isActive
        ? 'border-brand dark:border-brand-400 text-brand dark:text-brand-400'
        : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200';
    },

    getCompactToggleClass(isActive) {
      return isActive
        ? 'bg-brand dark:bg-brand-600 text-white border-transparent shadow-none'
        : 'bg-white/70 dark:bg-zinc-800/70 text-zinc-500 dark:text-zinc-400 border-transparent shadow-none';
    },

    getProviderChipClass(isActive) {
      return isActive
        ? 'bg-brand dark:bg-brand-600 text-white border-brand dark:border-brand-600'
        : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-600 hover:border-brand dark:hover:border-brand-500';
    }
  };
}

export function registerModalEnhancedComponent() {
  Alpine.data('modalEnhanced', modalEnhanced);
}

export function getModalEnhancedHTML() {
  return `
    <div x-data="modalEnhanced()" 
         @keydown.escape.window="$store.modalStack.handleEscape()"
         class="relative">
      
       <div x-show="visible"
            x-transition:enter="transition ease-out duration-300"
            x-transition:enter-start="opacity-0"
            x-transition:enter-end="opacity-100"
            x-transition:leave="transition ease-in duration-200"
            x-transition:leave-start="opacity-100"
            x-transition:leave-end="opacity-0"
           class="fixed inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm"
           :style="{ zIndex: getBackdropZIndex() }">
       </div>

      <template x-for="(modal, index) in stack" :key="modal.id">
        <div>
          <!-- Inter-modal backdrop: dims the parent modal when a child is open -->
          <div x-show="index > 0"
               x-transition:enter="transition ease-out duration-300"
               x-transition:enter-start="opacity-0"
               x-transition:enter-end="opacity-100"
               x-transition:leave="transition ease-in duration-200"
               x-transition:leave-start="opacity-100"
               x-transition:leave-end="opacity-0"
               class="fixed inset-0 bg-zinc-900/40 dark:bg-zinc-950/60"
               :style="{ zIndex: getZIndex(index) - 1 }">
          </div>
         
          <div class="fixed inset-0 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto overscroll-contain safe-area-inset-top safe-area-inset-bottom"
               :style="{ zIndex: getZIndex(index) }">
             
          <div class="relative w-full bg-white dark:bg-zinc-800 shadow-neo-lift dark:shadow-neo-lift-dark rounded-neo-lg flex flex-col overflow-hidden  duration-300 custom-scrollbar"
               :class="[getSizeClasses(modal.size), getHeightClasses(modal)]"
               x-show="true"
               x-transition:enter="transition ease-out duration-300"
               x-transition:enter-start="opacity-0 translate-y-8 scale-95"
               x-transition:enter-end="opacity-100 translate-y-0 scale-100"
               x-transition:leave="transition ease-in duration-200"
               x-transition:leave-start="opacity-100 translate-y-0 scale-100"
               x-transition:leave-end="opacity-0 translate-y-8 scale-95">
            
            <!-- Header: Modern Toolbar Style -->
            <div x-show="modal.showHeader" 
                 class="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm select-none z-10">
              
              <!-- Left: Cancel button -->
              <div class="flex items-center min-w-[80px]">
                <button x-show="modal.closeable"
                        @click="handleCancel()"
                        class="group btn-secondary gap-1.5 px-3 py-1.5 text-xs font-medium"
                        title="取消">
                  <svg class="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  <span>取消</span>
                </button>
              </div>
              
              <!-- Center: Title -->
              <div class="flex-1 flex justify-center overflow-hidden px-2">
                <h3 class="text-sm font-bold text-zinc-800 dark:text-zinc-100 truncate tracking-tight" x-text="getTitle(modal)"></h3>
              </div>
              
              <!-- Right: Save button -->
              <div class="flex items-center justify-end min-w-[80px]">
                <!-- Settings modal save button -->
                <button x-show="modal.type === 'settings'"
                        @click="$dispatch('settings-save')"
                        class="group btn-primary gap-1.5 px-3.5 py-1.5 text-xs font-bold">
                  <span>保存</span>
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <!-- Generic save button for other modals -->
                <button x-show="modal.showFooter && modal.type !== 'info' && modal.type !== 'settings'"
                        @click="handleSave(modal)"
                        class="group btn-primary gap-1.5 px-3.5 py-1.5 text-xs font-bold">
                  <span>应用</span>
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>
            </div>

            <div class="flex-1 min-h-0 custom-scrollbar" :class="modal.type === 'lorebook' ? 'overflow-hidden p-0 flex flex-col' : (modal.type === 'ferry' ? 'overflow-hidden p-0 flex flex-col' : 'overflow-y-auto p-5')">
              
              <template x-if="modal.type === 'text'">
                <div class="flex flex-col gap-4">
                  <div class="relative">
                    <textarea x-model="modal.draft.value"
                              x-ref="textareaAutosize"
                              x-init="$nextTick(() => { 
                                const el = $refs.textareaAutosize;
                                if (el) {
                                  el.style.height = 'auto';
                                  const scrollHeight = el.scrollHeight;
                                  const minHeight = 200;
                                  const maxHeight = window.innerHeight * 0.6;
                                  const targetHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
                                  el.style.height = targetHeight + 'px';
                                  el.style.overflowY = scrollHeight > targetHeight ? 'auto' : 'hidden';
                                }
                              })"
                              @input="$nextTick(() => { 
                                const el = $refs.textareaAutosize;
                                if (el) {
                                  el.style.height = 'auto';
                                  const scrollHeight = el.scrollHeight;
                                  const minHeight = 200;
                                  const maxHeight = window.innerHeight * 0.6;
                                  const targetHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
                                  el.style.height = targetHeight + 'px';
                                  el.style.overflowY = scrollHeight > targetHeight ? 'auto' : 'hidden';
                                }
                              })"
                              class="w-full min-h-[200px] max-h-[60vh] p-4 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none resize-none font-mono text-sm leading-relaxed text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 overflow-hidden scrollbar-auto focus:border-brand dark:focus:border-brand-400"
                              :placeholder="modal.meta?.placeholder || ''"></textarea>
                  </div>
                  
                  <div x-show="modal.meta?.enablePreview" class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 px-1">
                    <span>Markdown 预览: <span x-text="modal.meta?.enablePreview ? '开启' : '关闭'"></span></span>
                  </div>
                </div>
              </template>

              <template x-if="modal.type === 'array'">
                <div x-data="arrayFieldModal(modal)" class="min-h-full flex flex-col">
                  <div class="flex-1 overflow-y-auto min-h-0 p-1 custom-scrollbar">
                    <div x-ref="sortableContainer" class="space-y-2">
                      <template x-for="(item, index) in items" :key="index">
                        <div class="bg-white dark:bg-zinc-700 rounded-neo p-3 shadow-neo-lift dark:shadow-neo-lift-dark border border-zinc-100 dark:border-zinc-600 flex items-center gap-3 group hover:shadow-neo-lift-hover dark:hover:shadow-neo-lift-hover-dark transition-all duration-200 animate-fade-in-up">
                          <div class="drag-handle cursor-grab active:cursor-grabbing text-zinc-300 dark:text-zinc-500 hover:text-zinc-500 dark:hover:text-zinc-300 p-1 "
                               x-show="meta.enableReorder !== false">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                            </svg>
                          </div>

                          <div class="w-6 h-6 rounded-neo bg-zinc-100 dark:bg-zinc-600 flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-300 font-mono flex-shrink-0"
                               x-text="index + 1"></div>

                          <div class="flex-1 min-w-0 cursor-pointer py-1" @click="editItem(index)">
                            <div class="text-sm text-zinc-700 dark:text-zinc-200 truncate font-medium" 
                                 x-text="item || '(空)'"
                                 :class="!item ? 'text-zinc-400 dark:text-zinc-500 italic' : ''"></div>
                          </div>

                          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button @click="editItem(index)" 
                                    class="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-brand dark:hover:text-brand-400 hover:bg-brand/10 dark:hover:bg-brand-900/30 rounded-neo "
                                    title="编辑">
                              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                              </svg>
                            </button>
                            <button @click="removeItem(index)"
                                    class="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-danger dark:hover:text-danger-light hover:bg-danger-light dark:hover:bg-danger-dark rounded-neo "
                                    title="删除">
                              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </template>
                    </div>

                    <div x-show="items.length === 0"
                         x-transition:enter="transition ease-out duration-220"
                         x-transition:enter-start="opacity-0 translate-y-1"
                         x-transition:enter-end="opacity-100 translate-y-0"
                         x-transition:leave="transition ease-in duration-160"
                         x-transition:leave-start="opacity-100 translate-y-0"
                         x-transition:leave-end="opacity-0 -translate-y-1"
                         class="flex flex-col items-center justify-center py-12 text-zinc-400 dark:text-zinc-500">
                      <svg class="w-12 h-12 mb-3 text-zinc-200 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                      </svg>
                      <p class="text-sm">暂无内容，点击下方按钮添加</p>
                    </div>
                  </div>

                  <div class="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-600 flex-shrink-0">
                    <button @click="addItem()"
                            class="w-full py-3 border-2 border-dashed border-zinc-200 dark:border-zinc-600 rounded-neo text-zinc-500 dark:text-zinc-400 font-medium hover:border-brand dark:hover:border-brand-500 hover:text-brand dark:hover:text-brand-400 hover:bg-brand/5 dark:hover:bg-brand-900/20  flex items-center justify-center gap-2">
                      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      <span x-text="meta.addLabel || '添加项目'"></span>
                    </button>
                  </div>
                </div>
              </template>

              <template x-if="modal.type === 'tags'">
                <div x-data="tagsFieldModal(modal)" class="flex flex-col gap-3">
                  <!-- Input field with Add button -->
                  <div class="flex items-center gap-2">
                    <div class="relative flex-1">
                      <input type="text" 
                             x-ref="tagInput"
                             x-model="newTag"
                             @keydown.enter.prevent="addTag()"
                             @keydown.backspace="handleBackspace($event)"
                             :maxlength="maxLength"
                             placeholder="输入标签，按回车添加..."
                             class="w-full px-4 py-2.5 bg-zinc-100/80 dark:bg-zinc-700  rounded-neo text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none   focus:border-brand dark:focus:border-brand-400">
                      <div class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 dark:text-zinc-500">
                        <span x-text="items.length"></span> 个标签
                      </div>
                    </div>
                    <button @click="addTag()" 
                            type="button"
                            class="btn-secondary px-4 py-2.5 text-sm font-medium flex-shrink-0">
                      添加
                    </button>
                  </div>
                  
                  <!-- Tags display area -->
                  <div class="flex flex-wrap gap-2 min-h-[32px] p-2 bg-zinc-50/50 dark:bg-zinc-900/50 rounded-neo border border-zinc-100 dark:border-zinc-700">
                    <template x-for="(tag, index) in items" :key="index">
                      <span class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-full text-sm border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all duration-200 shadow-sm animate-fade-in-up">
                        <span x-text="tag" class="max-w-[150px] truncate"></span>
                        <button @click="removeTag(index)" 
                                type="button"
                                class="w-4 h-4 flex items-center justify-center text-zinc-400 dark:text-zinc-500 hover:text-danger dark:hover:text-danger-light  flex-shrink-0"
                                title="删除标签">
                          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    </template>
                    <span x-show="items.length === 0"
                          x-transition:enter="transition ease-out duration-180"
                          x-transition:enter-start="opacity-0"
                          x-transition:enter-end="opacity-100"
                          x-transition:leave="transition ease-in duration-120"
                          x-transition:leave-start="opacity-100"
                          x-transition:leave-end="opacity-0"
                          class="text-zinc-400 dark:text-zinc-500 text-sm py-1.5">暂无标签，在上方输入后按回车或点击添加按钮</span>
                  </div>
                  
                  <!-- Clear all button -->
                  <div x-show="items.length > 3"
                       x-transition:enter="transition ease-out duration-180"
                       x-transition:enter-start="opacity-0"
                       x-transition:enter-end="opacity-100"
                       x-transition:leave="transition ease-in duration-120"
                       x-transition:leave-start="opacity-100"
                       x-transition:leave-end="opacity-0"
                       class="flex justify-end">
                    <button @click="clearAll()"
                            type="button"
                            class="text-xs text-zinc-400 dark:text-zinc-500 hover:text-danger dark:hover:text-danger-light ">
                      清空全部
                    </button>
                  </div>
                </div>
              </template>

              <template x-if="modal.type === 'extensions'">
                <div x-data="extensionsEditor({ 
                  value: modal.draft.value,
                  onUpdate: (value) => { modal.draft.value = value; modal.dirty = true; },
                  expanded: true
                })">
                  <!-- 标题栏 -->
                  <div class="flex items-center gap-2 mb-3">
                    <svg class="w-4 h-4 text-zinc-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
                    </svg>
                    <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">Extensions</span>
                    <span x-show="!isEmpty" 
                          class="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-700 rounded-neo px-2 py-0.5"
                          x-text="Object.keys(value).length + ' 字段'"></span>
                  </div>
                  
                  <!-- 提示信息 -->
                  <p class="text-xs text-zinc-400 dark:text-zinc-500 mb-2" x-text="description"></p>
                  
                  <!-- JSON 编辑器 -->
                  <div class="relative">
                    <textarea x-model="rawText"
                              x-ref="textareaAutosize"
                              x-init="$nextTick(() => {
                                const el = $refs.textareaAutosize;
                                if (el) {
                                  el.style.height = 'auto';
                                  const scrollHeight = el.scrollHeight;
                                  const minHeight = 200;
                                  const maxHeight = window.innerHeight * 0.6;
                                  el.style.height = Math.min(Math.max(scrollHeight, minHeight), maxHeight) + 'px';
                                }
                              })"
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
                                ? 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-600  focus:border-zinc-300 dark:focus:border-zinc-500' 
                                : 'bg-danger-light dark:bg-danger-dark border-danger dark:border-danger'"
                              class="w-full rounded-neo px-4 py-3 border outline-none  font-mono text-sm text-zinc-700 dark:text-zinc-200 resize-y min-h-[200px] max-h-[60vh] custom-scrollbar"
                              placeholder="{}"></textarea>
                    
                    <!-- 行号指示 -->
                    <span class="absolute bottom-2 right-2 text-xs text-zinc-300 dark:text-zinc-600 bg-white/80 dark:bg-zinc-800/80 px-1.5 py-0.5 rounded"
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
                              :class="isValid ? 'hover:text-brand dark:hover:text-brand-400' : 'opacity-30 cursor-not-allowed'"
                              type="button"
                              class="text-xs text-zinc-500 dark:text-zinc-400 ">
                        格式化
                      </button>
                      <button @click="reset()"
                              type="button"
                              class="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 ">
                        重置
                      </button>
                    </div>
                    <button @click="clear()"
                            x-show="!isEmpty"
                            type="button"
                            class="text-xs text-zinc-400 dark:text-zinc-500 hover:text-danger dark:hover:text-danger-light ">
                      清空
                    </button>
                  </div>
                </div>
              </template>

              <template x-if="modal.type === 'assets'">
                <div x-data="assetsEditor({ 
                  assets: modal.draft.value,
                  onUpdate: (assets) => { modal.draft.value = assets; modal.dirty = true; },
                  expanded: true
                })">
                  <!-- 标题栏 -->
                  <div class="flex items-center gap-2 mb-3">
                    <svg class="w-4 h-4 text-zinc-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                    <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">Assets</span>
                    <span x-show="assets.length > 0" 
                          class="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-700 rounded-neo px-2 py-0.5"
                          x-text="assets.length + ' 项'"></span>
                  </div>
                  
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
                            x-transition:enter="transition ease-out duration-180"
                            x-transition:enter-start="opacity-0"
                            x-transition:enter-end="opacity-100"
                            x-transition:leave="transition ease-in duration-120"
                            x-transition:leave-start="opacity-100"
                            x-transition:leave-end="opacity-0"
                            type="button"
                            class="text-brand dark:text-brand-light hover:text-brand-dark dark:hover:text-brand text-sm font-medium flex items-center gap-1 ">
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
                      <div class="flex flex-col items-center justify-center py-6 text-center bg-zinc-50 dark:bg-zinc-800/50 rounded-neo animate-fade-in-up">
                        <svg class="w-8 h-8 text-zinc-300 dark:text-zinc-600 mb-2" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                        </svg>
                        <p class="text-zinc-500 dark:text-zinc-400 text-sm">暂无资源</p>
                        <button @click="addAsset()"
                                type="button"
                                class="text-brand dark:text-brand-light hover:text-brand-dark dark:hover:text-brand text-sm font-medium mt-2 ">
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
                                      class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 outline-none cursor-pointer   focus:border-brand dark:focus:border-brand-400">
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
                                     class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none   focus:border-brand dark:focus:border-brand-400">
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
                                     class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-2 py-1.5 text-sm font-mono text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none   focus:border-brand dark:focus:border-brand-400">
                            </div>
                            
                            <!-- Ext -->
                            <div>
                              <label class="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">Extension</label>
                              <input type="text"
                                     :value="asset.ext"
                                     @input="updateAsset(index, 'ext', $event.target.value)"
                                     placeholder="png"
                                     class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none   focus:border-brand dark:focus:border-brand-400">
                            </div>
                          </div>
                          
                          <!-- 操作按钮 -->
                          <div class="flex-shrink-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button @click="duplicateAsset(index)"
                                    type="button"
                                    class="p-1 text-zinc-400 dark:text-zinc-500 hover:text-brand dark:hover:text-brand-light "
                                    title="复制">
                              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                              </svg>
                            </button>
                            <button @click="removeAsset(index)"
                                    type="button"
                                    class="p-1 text-zinc-400 dark:text-zinc-500 hover:text-danger dark:hover:text-danger-light "
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
                                x-ref="jsonTextarea"
                                x-effect="if (editMode === 'json') { $nextTick(() => {
                                  const el = $refs.jsonTextarea;
                                  if (el) {
                                    el.style.height = 'auto';
                                    const scrollHeight = el.scrollHeight;
                                    const minHeight = 200;
                                    const maxHeight = window.innerHeight * 0.6;
                                    el.style.height = Math.min(Math.max(scrollHeight, minHeight), maxHeight) + 'px';
                                  }
                                }) }"
                                @input.debounce.300ms="handleJsonInput(); $nextTick(() => { 
                                  const el = $refs.jsonTextarea;
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
                                    class="w-full rounded-neo px-4 py-3 border outline-none  font-mono text-sm text-zinc-700 dark:text-zinc-200 resize-y min-h-[200px] max-h-[60vh] custom-scrollbar"
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
                            class="text-xs text-zinc-400 dark:text-zinc-500 hover:text-danger dark:hover:text-danger-light ">
                      清空全部
                    </button>
                  </div>
                </div>
              </template>

              <template x-if="modal.type === 'lorebook'">
                <div class="flex-1 min-h-0 flex flex-col" x-data="lorebookEditor({
                  lorebook: modal.draft.lorebook,
                  onUpdate: (book) => { modal.draft.lorebook = book; modal.dirty = true; }
                })">
                  <!-- Toolbar Area -->
                  <div class="p-4 border-b border-zinc-100 dark:border-zinc-700 flex flex-col gap-3">
                    <div class="flex items-center justify-between gap-3">
                        <!-- Left: Search & Filter -->
                        <div class="flex items-center gap-2 flex-1">
                            <div class="relative flex-1 max-w-xs group">
                                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500 group-focus-within:text-brand dark:group-focus-within:text-brand-400 ">
                                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                </span>
                                <input type="text" x-model="searchQuery" placeholder="搜索条目..." 
                                       class="w-full pl-9 pr-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 border-transparent  rounded-neo text-xs focus:bg-white dark:focus:bg-zinc-700 focus:border-zinc-200 dark:focus:border-zinc-600 outline-none  placeholder-zinc-400 dark:placeholder-zinc-500 text-zinc-600 dark:text-zinc-200">
                            </div>
                            <select x-model="filterEnabled" class="pl-3 pr-7 py-1.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo text-xs text-zinc-600 dark:text-zinc-200 outline-none cursor-pointer   focus:border-brand dark:focus:border-brand-400">
                              <option value="all">全部显示</option>
                              <option value="enabled">仅启用</option>
                              <option value="disabled">仅禁用</option>
                            </select>
                        </div>
                        
                        <!-- Right: Actions -->
                        <div class="flex items-center gap-2">
                             <label class="btn-secondary px-3 py-1.5 text-xs cursor-pointer flex items-center gap-1.5 select-none">
                               <svg class="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                导入
                                <input type="file" accept=".json" class="hidden" @change="handleImportFile">
                             </label>
                             <button @click="handleExport()" class="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5">
                               <svg class="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                导出
                             </button>
                             <div class="w-px h-4 bg-zinc-200 dark:bg-zinc-600 mx-1"></div>
                             <button @click="clearAll()" class="btn-danger px-3 py-1.5 text-xs" title="清空全部">
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                             </button>
                        </div>
                    </div>
                    
                    <button @click="addEntry()" class="w-full py-2 bg-white dark:bg-zinc-800 border border-dashed border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:text-brand dark:hover:text-brand-400 hover:border-brand dark:hover:border-brand-500 hover:bg-brand-light/10 dark:hover:bg-brand-900/20 rounded-neo text-xs font-medium  shadow-sm hover:shadow flex items-center justify-center gap-1">
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                        添加新条目
                    </button>
                  </div>

                  <!-- Entries List -->
                  <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
                     <div x-ref="entriesContainer" class="space-y-2 pb-12">
                        <template x-for="(entry, index) in filteredEntries" :key="entry.id">
                          <div class="group relative bg-white dark:bg-zinc-800 border border-zinc-100/80 dark:border-zinc-700 rounded-neo shadow-sm hover:shadow-neo-lift dark:hover:shadow-neo-lift-dark hover:border-zinc-200 dark:hover:border-zinc-600 transition-all duration-200 overflow-hidden animate-fade-in-up" :data-entry-id="entry.id">
                           <div class="flex items-start p-3 gap-3">
                             <!-- Drag Handle -->
                             <div class="entry-drag-handle mt-0.5 cursor-grab active:cursor-grabbing text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400  p-1 -ml-1">
                               <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16" />
                               </svg>
                             </div>
                             
                             <!-- Toggle -->
                             <button @click="toggleEnabled(index)" 
                                      class="mt-0.5 w-5 h-5 rounded-neo flex items-center justify-center  border shadow-sm flex-shrink-0"
                                     :class="entry.enabled ? 'bg-brand border-brand text-white shadow-brand/20' : 'bg-zinc-50 dark:bg-zinc-700 border-zinc-200 dark:border-zinc-600 text-transparent hover:border-zinc-300 dark:hover:border-zinc-500'">
                               <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                                 <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                               </svg>
                             </button>

                             <!-- Info -->
                             <div class="flex-1 min-w-0 pt-0.5 cursor-pointer" @click="openEntryModal(index)">
                               <div class="flex items-center gap-2 mb-1">
                                 <span class="text-sm font-semibold text-zinc-700 dark:text-zinc-200 truncate group-hover:text-brand dark:group-hover:text-brand-400 " x-text="entry.name || '未命名条目'"></span>
                                 <div class="flex items-center gap-1">
                                      <span class="text-[10px] px-1.5 py-0.5 rounded-neo bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 font-mono" x-text="'#' + entry.insertion_order"></span>
                                      <span x-show="entry.constant" class="text-[10px] px-1.5 py-0.5 rounded-neo bg-warning-light dark:bg-warning-dark text-warning dark:text-warning-light border border-warning/40 dark:border-warning/60">Constant</span>
                                 </div>
                               </div>
                               <div class="text-xs text-zinc-400 dark:text-zinc-500 truncate font-mono" x-text="getEntrySummary(entry)"></div>
                             </div>

                             <!-- Quick Actions -->
                             <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity self-center">
                                <button @click.stop="openEntryModal(index)" class="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-brand dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded-neo " title="编辑">
                                 <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                               </button>
                                <button @click.stop="duplicateEntry(index)" class="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-brand dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded-neo " title="复制">
                                 <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                               </button>
                                <button @click.stop="removeEntry(index)" class="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-danger dark:hover:text-danger-light hover:bg-danger-light dark:hover:bg-danger-dark rounded-neo " title="删除">
                                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                             </div>
                           </div>
                         </div>
                       </template>
                       
                        <div x-show="filteredEntries.length === 0"
                             x-transition:enter="transition ease-out duration-220"
                             x-transition:enter-start="opacity-0 translate-y-1"
                             x-transition:enter-end="opacity-100 translate-y-0"
                             x-transition:leave="transition ease-in duration-160"
                             x-transition:leave-start="opacity-100 translate-y-0"
                             x-transition:leave-end="opacity-0 -translate-y-1"
                             class="flex flex-col items-center justify-center py-12 text-zinc-400 dark:text-zinc-500">
                          <div class="w-16 h-16 rounded-neo bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 flex items-center justify-center mb-3 text-zinc-300 dark:text-zinc-600">
                            <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                         </div>
                         <p class="text-sm font-medium text-zinc-500 dark:text-zinc-400">暂无条目</p>
                         <p class="text-xs mt-1">点击上方按钮添加或导入</p>
                       </div>
                     </div>
                  </div>
                </div>
              </template>

              <template x-if="modal.type === 'settings'">
                <div class="flex flex-col h-[min(74dvh,760px)] min-h-[320px] sm:min-h-[400px]" x-data="settingsModal()" @settings-save.window="saveSettings()">
                  <!-- Tab Navigation (fixed height) -->
                  <div class="flex-shrink-0 flex border-b border-zinc-200 dark:border-zinc-700">
                    <button @click="setTab('editor')"
                            :class="getModalTabClass(isActive('editor'))"
                            class="px-4 py-2.5 text-sm font-medium border-b-2  -mb-px">
                      编辑器设置
                    </button>
                    <button @click="setTab('supplier')"
                            :class="getModalTabClass(isActive('supplier'))"
                            class="px-4 py-2.5 text-sm font-medium border-b-2  -mb-px">
                      供应商配置
                    </button>
                    <button @click="setTab('agent')"
                            :class="getModalTabClass(isActive('agent'))"
                            class="px-4 py-2.5 text-sm font-medium border-b-2  -mb-px">
                      Agent 功能
                    </button>
                    <button @click="setTab('theme')"
                            :class="getModalTabClass(isActive('theme'))"
                            class="px-4 py-2.5 text-sm font-medium border-b-2  -mb-px">
                      主题
                    </button>
                  </div>
                  
                  <!-- Scrollable content area -->
                  <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar pl-6 pr-8 pt-6 pb-2"
                       style="scrollbar-gutter: stable;">
                  <!-- Editor Settings Tab -->
                  <template x-if="isActive('editor')">
                  <div class="space-y-6">
                    <!-- Auto Save -->
                    <div class="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900 rounded-neo">
                      <div>
                        <h4 class="text-sm font-medium text-zinc-700 dark:text-zinc-200">自动保存</h4>
                        <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">编辑时自动保存到浏览器本地存储</p>
                      </div>
                      <button @click="autoSaveEnabled = !autoSaveEnabled"
                              :class="autoSaveEnabled ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-600'"
                              class="relative w-11 h-6 rounded-neo ">
                        <span :class="autoSaveEnabled ? 'translate-x-[22px]' : 'translate-x-1'"
                              class="absolute top-1 left-0 w-4 h-4 bg-white rounded-neo shadow transition-transform"></span>
                      </button>
                    </div>
                    
                    <!-- Auto Save Interval -->
                    <div x-show="autoSaveEnabled">
                      <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-2">保存间隔（秒）</label>
                      <input type="text" x-model="autoSaveIntervalInput" inputmode="numeric" pattern="[0-9]*"
                             @blur="commitAutoSaveInterval()"
                             @keydown.enter.prevent="commitAutoSaveInterval(); $event.target.blur()"
                             class="w-32 px-4 py-2.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none  text-sm text-zinc-800 dark:text-zinc-100  focus:border-brand dark:focus:border-brand-400">
                    </div>
                    
                    <!-- V2 Compatibility -->
                    <div class="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900 rounded-neo">
                      <div>
                        <h4 class="text-sm font-medium text-zinc-700 dark:text-zinc-200">V2 兼容导出</h4>
                        <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">导出时同时写入 V2 格式的 chara 块，以兼容旧版酒馆</p>
                      </div>
                      <button @click="includeV2Compat = !includeV2Compat"
                              :class="includeV2Compat ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-600'"
                              class="relative w-11 h-6 rounded-neo ">
                        <span :class="includeV2Compat ? 'translate-x-[22px]' : 'translate-x-1'"
                              class="absolute top-1 left-0 w-4 h-4 bg-white rounded-neo shadow transition-transform"></span>
                      </button>
                    </div>

                    <!-- Local Storage -->
                    <div class="p-4 rounded-neo border border-zinc-200/70 dark:border-zinc-800/80 bg-gradient-to-br from-zinc-50 to-zinc-100/70 dark:from-zinc-900 dark:to-zinc-900/70">
                      <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex items-start gap-3">
                          <div class="w-10 h-10 rounded-neo flex items-center justify-center bg-brand/12 text-brand dark:bg-brand/20 dark:text-brand-300">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 7.5h16.5M6 16.5h12M7.5 12h9m-11.25 7.5h13.5A1.5 1.5 0 0020.25 18V6A1.5 1.5 0 0018.75 4.5H5.25A1.5 1.5 0 003.75 6v12a1.5 1.5 0 001.5 1.5z" />
                            </svg>
                          </div>
                          <div>
                            <h4 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">网页本地存储</h4>
                            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">当前站点 localStorage 实时占用</p>
                          </div>
                        </div>
                      </div>

                      <div class="grid grid-cols-2 gap-2 mt-3">
                        <div class="p-3 rounded-neo border border-zinc-200/70 dark:border-zinc-700/70 bg-white/75 dark:bg-zinc-800/55">
                          <p class="text-[11px] text-zinc-400 dark:text-zinc-500">占用空间</p>
                          <p class="text-lg font-semibold text-zinc-800 dark:text-zinc-100 mt-1"
                             x-text="formatStorageBytes(localStorageUsageBytes)"></p>
                        </div>
                        <div class="p-3 rounded-neo border border-zinc-200/70 dark:border-zinc-700/70 bg-white/75 dark:bg-zinc-800/55">
                          <p class="text-[11px] text-zinc-400 dark:text-zinc-500">存储项数</p>
                          <p class="text-lg font-semibold text-zinc-800 dark:text-zinc-100 mt-1"
                             x-text="localStorageKeyCount + ' 项'"></p>
                        </div>
                      </div>

                      <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <p class="text-xs text-zinc-400 dark:text-zinc-500">按 UTF-16 字符长度估算，实际容量由浏览器实现决定</p>
                        <div class="flex items-center gap-2">
                          <button @click="refreshLocalStorageUsage()"
                                  class="btn-secondary px-3 py-1.5 text-xs font-medium gap-1.5">
                            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                            刷新统计
                          </button>
                          <button @click="clearLocalStorage()"
                                  class="btn-danger px-3 py-1.5 text-xs font-medium gap-1.5">
                            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            清空本地存储
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  </template>

                  <!-- Supplier Settings Tab -->
                  <template x-if="isActive('supplier')">
                  <div class="space-y-6">
                    <div class="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-neo border border-zinc-200/70 dark:border-zinc-800/80">
                      <div class="flex items-center justify-between mb-3">
                        <h4 class="text-sm font-medium text-zinc-700 dark:text-zinc-200">供应商配置</h4>
                        <button @click="addProvider()" class="text-xs text-brand dark:text-brand-400 hover:text-brand-dark dark:hover:text-brand-300 font-medium flex items-center gap-1">
                          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                          添加供应商
                        </button>
                      </div>

                      <div class="flex flex-wrap gap-2">
                        <template x-for="provider in providers" :key="provider.id">
                          <button @click="switchProvider(provider.id)"
                                  :class="getProviderChipClass(provider.id === currentProviderId)"
                                  class="px-3 py-1.5 text-sm font-medium rounded-neo border  flex items-center gap-2">
                            <span x-text="provider.name"></span>
                          </button>
                        </template>
                        <template x-if="providers.length === 0">
                          <button @click="addProvider()" class="px-3 py-1.5 text-sm text-zinc-400 dark:text-zinc-500 border border-dashed border-zinc-300 dark:border-zinc-600 rounded-neo hover:border-brand dark:hover:border-brand-500 hover:text-brand dark:hover:text-brand-400 ">
                            + 创建第一个供应商
                          </button>
                        </template>
                      </div>

                      <div x-show="currentProviderId && !editingProviderName" class="mt-3 flex items-center gap-2">
                        <span class="text-xs text-zinc-400 dark:text-zinc-500">当前:</span>
                        <span class="text-xs font-medium text-zinc-600 dark:text-zinc-300" x-text="currentProviderName"></span>
                        <button @click="startRenameProvider()" class="text-xs text-zinc-400 dark:text-zinc-500 hover:text-brand dark:hover:text-brand-400">
                          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button x-show="providers.length > 1"
                                @click="removeProvider(currentProviderId)"
                                class="text-xs text-danger dark:text-danger-light hover:text-danger-dark dark:hover:text-danger transition-colors"
                                title="删除当前供应商">
                          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                      <div x-show="editingProviderName" class="mt-3 flex items-center gap-2">
                        <input type="text" x-model="newProviderName"
                               @keydown.enter="finishRenameProvider()"
                               @keydown.escape="editingProviderName = false"
                               @blur="finishRenameProvider()"
                               class="px-2.5 py-1 text-xs bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none   focus:border-brand dark:focus:border-brand-400"
                               placeholder="供应商名称">
                      </div>
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-2">API 地址</label>
                      <input type="text" x-model="apiUrl"
                             placeholder="https://api.openai.com"
                             class="w-full px-4 py-2.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none  text-sm text-zinc-800 dark:text-zinc-100  focus:border-brand dark:focus:border-brand-400">
                      <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">支持 OpenAI 兼容的 API 端点</p>
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-2">API Key</label>
                      <div class="relative">
                        <input :type="showApiKey ? 'text' : 'password'" x-model="apiKey"
                               placeholder="sk-..."
                               class="hide-password-reveal w-full px-4 py-2.5 pr-12 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none  text-sm font-mono text-zinc-800 dark:text-zinc-100  focus:border-brand dark:focus:border-brand-400">
                        <button @click="showApiKey = !showApiKey" type="button"
                                class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300">
                          <svg x-show="!showApiKey" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          <svg x-show="showApiKey" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        </button>
                      </div>
                      <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">密钥仅存储在本地浏览器中</p>
                    </div>

                    <div class="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900 rounded-neo">
                      <div>
                        <h4 class="text-sm font-medium text-zinc-700 dark:text-zinc-200">使用代理</h4>
                        <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">通过 Arcamage 后端转发 API 请求，可解决跨域问题</p>
                      </div>
                      <button @click="proxyEnabled = !proxyEnabled"
                              :class="proxyEnabled ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-600'"
                              class="relative w-11 h-6 rounded-neo ">
                        <span :class="proxyEnabled ? 'translate-x-[22px]' : 'translate-x-1'"
                              class="absolute top-1 left-0 w-4 h-4 bg-white rounded-neo shadow transition-transform"></span>
                      </button>
                    </div>

                    <div class="flex items-center gap-4">
                      <button @click="testConnection()"
                              :disabled="!apiUrl || !apiKey || connectionStatus === 'testing'"
                              class="btn-primary px-4 py-2 text-sm font-medium flex items-center gap-2">
                        <span x-show="connectionStatus !== 'testing'">测试连接</span>
                        <span x-show="connectionStatus === 'testing'" class="flex items-center gap-2">
                          <span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                          连接中...
                        </span>
                      </button>

                      <div class="flex items-center gap-2">
                        <span :class="connectionStatus === 'success' ? 'bg-brand' : connectionStatus === 'error' ? 'bg-danger' : 'bg-zinc-300 dark:bg-zinc-600'"
                              class="w-2.5 h-2.5 rounded-full"></span>
                        <span class="text-sm" :class="connectionStatus === 'success' ? 'text-brand-600 dark:text-brand-400' : connectionStatus === 'error' ? 'text-danger dark:text-danger-light' : 'text-zinc-500 dark:text-zinc-400'"
                              x-text="connectionMessage || '未测试'"></span>
                      </div>
                    </div>

                    <div x-show="availableModels.length > 0 || selectedModel">
                      <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-2">选择模型</label>
                      <select x-model="selectedModel"
                              class="w-full px-4 py-2.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none  text-sm text-zinc-800 dark:text-zinc-100  focus:border-brand dark:focus:border-brand-400">
                        <template x-if="selectedModel && !availableModels.find(m => m.id === selectedModel)">
                          <option :value="selectedModel" x-text="selectedModel" selected></option>
                        </template>
                        <template x-for="model in availableModels" :key="model.id">
                          <option :value="model.id" x-text="model.id"></option>
                        </template>
                      </select>
                      <p x-show="selectedModel && availableModels.length === 0" class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">点击"测试连接"可获取更多模型选项</p>
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-2">模型温度 (Temperature)</label>
                      <input type="text" x-model="temperatureInput" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*"
                             @blur="commitTemperature()"
                             @keydown.enter.prevent="commitTemperature(); $event.target.blur()"
                             class="w-32 px-4 py-2.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none  text-sm text-zinc-800 dark:text-zinc-100  focus:border-brand dark:focus:border-brand-400">
                      <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">控制输出随机性，范围 0.0 - 2.0，默认 1.0</p>
                    </div>
                  </div>
                  </template>
                  
                  <!-- Agent Settings Tab -->
                  <template x-if="isActive('agent')">
                  <div class="space-y-6">
                    <!-- Skills Feature Toggle -->
                    <div class="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900 rounded-neo">
                      <div>
                        <h4 class="text-sm font-medium text-zinc-700 dark:text-zinc-200">技能功能</h4>
                        <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">启用后可在工作台使用技能功能增强 Agent 编辑能力</p>
                      </div>
                      <button @click="skillsEnabled = !skillsEnabled"
                              :class="skillsEnabled ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-600'"
                              class="relative w-11 h-6 rounded-neo ">
                        <span :class="skillsEnabled ? 'translate-x-[22px]' : 'translate-x-1'"
                              class="absolute top-1 left-0 w-4 h-4 bg-white rounded-neo shadow transition-transform"></span>
                      </button>
                    </div>

                    <!-- Agent Activity Trace -->
                    <div class="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900 rounded-neo">
                      <div>
                        <h4 class="text-sm font-medium text-zinc-700 dark:text-zinc-200">活动轨迹显示</h4>
                        <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">显示模型思考与工具调用轨迹</p>
                      </div>
                      <button @click="agentShowActivityTrace = !agentShowActivityTrace"
                              :class="agentShowActivityTrace ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-600'"
                              class="relative w-11 h-6 rounded-neo ">
                        <span :class="agentShowActivityTrace ? 'translate-x-[22px]' : 'translate-x-1'"
                              class="absolute top-1 left-0 w-4 h-4 bg-white rounded-neo shadow transition-transform"></span>
                      </button>
                    </div>

                    <!-- Diff Display Settings -->
                    <div class="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-neo space-y-4">
                      <h4 class="text-sm font-medium text-zinc-700 dark:text-zinc-200">Diff 显示设置</h4>
                      
                      <div class="flex items-center justify-between">
                        <div>
                          <p class="text-sm text-zinc-600 dark:text-zinc-300">布局模式</p>
                          <p class="text-xs text-zinc-400 dark:text-zinc-500">选择变更对比的显示方式</p>
                        </div>
                        <div class="flex rounded-neo border border-zinc-200/70 dark:border-zinc-700/70 overflow-hidden bg-white/65 dark:bg-zinc-800/55">
                          <button @click="agentDiffLayout = 'unified'"
                                  :class="agentDiffLayout === 'unified' ? 'bg-brand text-white' : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'"
                                  class="px-3 py-1.5 text-xs font-medium">统一</button>
                          <button @click="agentDiffLayout = 'split'"
                                  :class="agentDiffLayout === 'split' ? 'bg-brand text-white' : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'"
                                  class="px-3 py-1.5 text-xs font-medium border-l border-zinc-200/70 dark:border-zinc-700/70">分屏</button>
                        </div>
                      </div>

                      <div class="flex items-center justify-between">
                        <div>
                          <p class="text-sm text-zinc-600 dark:text-zinc-300">自动换行</p>
                          <p class="text-xs text-zinc-400 dark:text-zinc-500">长行自动换行显示</p>
                        </div>
                        <button @click="agentDiffWrap = !agentDiffWrap"
                                :class="agentDiffWrap ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-600'"
                                class="relative w-11 h-6 rounded-neo">
                          <span :class="agentDiffWrap ? 'translate-x-[22px]' : 'translate-x-1'"
                                class="absolute top-1 left-0 w-4 h-4 bg-white rounded-neo shadow transition-transform"></span>
                        </button>
                      </div>

                      <div class="flex items-center justify-between">
                        <div>
                          <p class="text-sm text-zinc-600 dark:text-zinc-300">折叠未变更区域</p>
                          <p class="text-xs text-zinc-400 dark:text-zinc-500">隐藏无变更的上下文行</p>
                        </div>
                        <button @click="agentDiffFold = !agentDiffFold"
                                :class="agentDiffFold ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-600'"
                                class="relative w-11 h-6 rounded-neo">
                          <span :class="agentDiffFold ? 'translate-x-[22px]' : 'translate-x-1'"
                                class="absolute top-1 left-0 w-4 h-4 bg-white rounded-neo shadow transition-transform"></span>
                        </button>
                      </div>
                    </div>

                    <!-- Advanced Settings (Collapsible) -->
                    <div class="border border-zinc-200/70 dark:border-zinc-800/80 rounded-neo overflow-hidden">
                      <button @click="showAdvancedAgent = !showAdvancedAgent"
                              class="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
                        <div class="flex items-center gap-2">
                          <svg class="w-4 h-4 text-zinc-500 dark:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span class="text-sm font-medium text-zinc-700 dark:text-zinc-200">高级设置</span>
                        </div>
                        <svg :class="showAdvancedAgent ? 'rotate-180' : ''" class="w-4 h-4 text-zinc-400 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      
                      <div x-show="showAdvancedAgent" x-collapse class="border-t border-zinc-200/70 dark:border-zinc-800/80">
                        <div class="p-4 space-y-4 bg-white dark:bg-zinc-900/50">
                          <p class="text-xs text-zinc-400 dark:text-zinc-500">这些设置通常无需修改，仅供高级用户调整</p>
                          
                          <div>
                            <label class="block text-sm text-zinc-600 dark:text-zinc-300 mb-1">单次会话最大工具调用数</label>
                            <input type="text" x-model="agentToolCallLimitInput" inputmode="numeric" pattern="[0-9]*"
                                   @blur="commitAgentAdvancedInputs()"
                                   class="w-32 px-3 py-2 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none text-sm text-zinc-800 dark:text-zinc-100 focus:border-brand dark:focus:border-brand-400">
                            <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">范围 10-200，默认 50</p>
                          </div>
                          
                          <div>
                            <label class="block text-sm text-zinc-600 dark:text-zinc-300 mb-1">工具输出最大字符数</label>
                            <input type="text" x-model="agentMaxValueCharsInput" inputmode="numeric" pattern="[0-9]*"
                                   @blur="commitAgentAdvancedInputs()"
                                   class="w-32 px-3 py-2 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none text-sm text-zinc-800 dark:text-zinc-100 focus:border-brand dark:focus:border-brand-400">
                            <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">范围 10000-500000，默认 80000</p>
                          </div>
                          
                          <div>
                            <label class="block text-sm text-zinc-600 dark:text-zinc-300 mb-1">技能自动匹配数量上限</label>
                            <input type="text" x-model="agentSkillAutoMatchLimitInput" inputmode="numeric" pattern="[0-9]*"
                                   @blur="commitAgentAdvancedInputs()"
                                   class="w-32 px-3 py-2 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo outline-none text-sm text-zinc-800 dark:text-zinc-100 focus:border-brand dark:focus:border-brand-400">
                            <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">范围 0-10，默认 3（0 表示禁用自动匹配）</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  </template>
                  
                  <!-- Theme Tab -->
                  <template x-if="isActive('theme')">
                  <div class="space-y-6">
                    <div>
                      <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-4">外观模式</label>
                      <div class="grid grid-cols-3 gap-3">
                        <button @click="$store.settings.setTheme('system')"
                                :class="$store.settings.theme === 'system'
                                  ? 'border-zinc-200/80 dark:border-zinc-700/80 bg-brand-50/45 dark:bg-brand-900/18'
                                  : 'border-zinc-200/80 dark:border-zinc-800/75 bg-zinc-50 dark:bg-zinc-900 hover:border-zinc-300/80 dark:hover:border-zinc-700/70 hover:bg-zinc-100 dark:hover:bg-zinc-900'"
                                class="p-4 rounded-neo border text-center ">
                          <svg class="w-8 h-8 mx-auto mb-2 text-zinc-600 dark:text-zinc-300" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" />
                          </svg>
                          <span class="text-sm font-medium text-zinc-700 dark:text-zinc-200">跟随系统</span>
                        </button>
                        <button @click="$store.settings.setTheme('light')"
                                :class="$store.settings.theme === 'light'
                                  ? 'border-zinc-200/80 dark:border-zinc-700/80 bg-brand-50/45 dark:bg-brand-900/18'
                                  : 'border-zinc-200/80 dark:border-zinc-800/75 bg-zinc-50 dark:bg-zinc-900 hover:border-zinc-300/80 dark:hover:border-zinc-700/70 hover:bg-zinc-100 dark:hover:bg-zinc-900'"
                                class="p-4 rounded-neo border text-center ">
                          <svg class="w-8 h-8 mx-auto mb-2 text-warning" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
                          </svg>
                          <span class="text-sm font-medium text-zinc-700 dark:text-zinc-200">浅色模式</span>
                        </button>
                        <button @click="$store.settings.setTheme('dark')"
                                :class="$store.settings.theme === 'dark'
                                  ? 'border-zinc-200/80 dark:border-zinc-700/80 bg-brand-50/45 dark:bg-brand-900/18'
                                  : 'border-zinc-200/80 dark:border-zinc-800/75 bg-zinc-50 dark:bg-zinc-900 hover:border-zinc-300/80 dark:hover:border-zinc-700/70 hover:bg-zinc-100 dark:hover:bg-zinc-900'"
                                class="p-4 rounded-neo border text-center ">
                          <svg class="w-8 h-8 mx-auto mb-2 text-zinc-600 dark:text-zinc-300" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
                          </svg>
                          <span class="text-sm font-medium text-zinc-700 dark:text-zinc-200">深色模式</span>
                        </button>
                      </div>
                    </div>
                    
                    <div>
                      <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-4">强调色</label>
                      <div class="flex flex-wrap gap-3 mb-4">
                        <template x-for="(preset, id) in accentPresets" :key="id">
                          <button @click="selectPreset(id)"
                                  :class="selectedAccent === id ? 'ring-2 ring-offset-2 ring-zinc-400 dark:ring-zinc-500 dark:ring-offset-zinc-800' : 'hover:scale-110'"
                                  :style="{ backgroundColor: preset.shades[500] }"
                                  class="w-10 h-10 rounded-full shadow-md  duration-150 flex items-center justify-center"
                                  :title="preset.name">
                            <svg x-show="selectedAccent === id" class="w-5 h-5 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                        </template>
                      </div>
                      
                      <div class="flex items-center gap-3">
                        <div class="relative flex-1">
                          <input type="text" 
                                 x-model="customHex"
                                 @input.debounce.300ms="validateCustomHex()"
                                 placeholder="#7c3aed"
                                 maxlength="7"
                                 :class="customHexError ? 'border-danger dark:border-danger' : 'border-zinc-200 dark:border-zinc-600'"
                                  class="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-900 border rounded-neo  focus:border-zinc-300 dark:focus:border-zinc-500 outline-none  text-sm font-mono text-zinc-800 dark:text-zinc-100">
                          <div x-show="customHex && !customHexError"
                               :style="{ backgroundColor: customHex }"
                               class="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border border-zinc-300 dark:border-zinc-600 shadow-sm">
                          </div>
                        </div>
                      </div>
                      
                      <p x-show="customHexError" class="text-xs text-danger dark:text-danger-light mt-1" x-text="customHexError"></p>
                      <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-2">
                        选择预设颜色或输入自定义十六进制色值 (如 #7c3aed)
                      </p>
                    </div>
                  </div>
                  </template>
                  </div><!-- End scrollable content area -->
                  
                </div>
              </template>

              <template x-if="modal.type === 'ferry'">
                <div class="flex flex-col h-[min(74dvh,760px)] min-h-[320px] sm:min-h-[400px] pt-5 px-5" x-data="ferryModal(modal)">
                  <!-- Tab Navigation (fixed height) -->
                  <div class="flex-shrink-0 flex border-b border-zinc-200 dark:border-zinc-700">
                        <button @click="activeTab = 'single'" 
                                :class="getModalTabClass(activeTab === 'single')"
                                class="px-4 py-2.5 text-sm font-medium border-b-2  -mb-px whitespace-nowrap">
                          单个抓取
                        </button>
                        <button @click="activeTab = 'batch'" 
                                :class="getModalTabClass(activeTab === 'batch')"
                                class="px-4 py-2.5 text-sm font-medium border-b-2  -mb-px whitespace-nowrap">
                          批量抓取
                        </button>
                        <button @click="activeTab = 'staging'" 
                                :class="getModalTabClass(activeTab === 'staging')"
                                class="px-4 py-2.5 text-sm font-medium border-b-2  -mb-px whitespace-nowrap flex items-center gap-1">
                          暂存区
                          <template x-if="$store.ferry.stagedCards.length > 0">
                            <span class="bg-brand text-white text-xs px-1.5 py-0.5 rounded-neo" x-text="$store.ferry.stagedCards.length"></span>
                          </template>
                        </button>
                        <button @click="activeTab = 'settings'" 
                                :class="getModalTabClass(activeTab === 'settings')"
                                class="px-4 py-2.5 text-sm font-medium border-b-2  -mb-px whitespace-nowrap">
                          参数设置
                        </button>
                  </div>
                  
                  <!-- Scrollable content area -->
                  <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar pl-6 pr-8 pt-6 pb-2"
                       style="scrollbar-gutter: stable;">
                      <template x-if="activeTab === 'single'">
                        <div class="space-y-6">
                          <template x-if="importResult">
                            <div class="space-y-5 animate-fade-in-up">
                              <div class="alert-success-soft p-4 text-sm flex items-start gap-3 shadow-sm">
                                <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                <div class="space-y-1">
                                  <p class="font-bold">抓取成功</p>
                                  <p class="text-xs opacity-80">请确认卡片信息后发送到工作台编辑</p>
                                </div>
                              </div>

                              <div class="bg-white dark:bg-zinc-800 rounded-neo-lg border border-zinc-100 dark:border-zinc-700 shadow-neo-lift dark:shadow-neo-lift-dark p-4 sm:p-5">
                                <div class="flex flex-col sm:flex-row gap-4 sm:gap-5">
                                  <div class="w-28 h-28 sm:w-32 sm:h-32 flex-shrink-0 rounded-neo-lg overflow-hidden shadow-neo-lift dark:shadow-neo-lift-dark ring-2 ring-white dark:ring-zinc-700">
                                    <template x-if="importResult.avatar_base64">
                                      <img :src="'data:image/png;base64,' + importResult.avatar_base64" class="w-full h-full object-cover">
                                    </template>
                                    <template x-if="!importResult.avatar_base64">
                                      <div class="w-full h-full flex items-center justify-center text-3xl font-bold text-zinc-300 dark:text-zinc-600 bg-zinc-100 dark:bg-zinc-800">?</div>
                                    </template>
                                  </div>

                                  <div class="flex-1 min-w-0 flex flex-col justify-between">
                                    <div>
                                      <h4 class="text-lg font-bold text-zinc-800 dark:text-zinc-100 truncate" x-text="importResult.card?.data?.name || '未知角色'"></h4>
                                      <template x-if="importResult.card?.data?.creator">
                                        <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5" x-text="'by ' + importResult.card.data.creator"></p>
                                      </template>
                                      <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-2 line-clamp-3 leading-relaxed"
                                         x-text="importResult.card?.data?.creator_notes || importResult.card?.data?.description?.substring(0, 120) || '无简介'"></p>
                                    </div>

                                    <div class="flex flex-wrap gap-1.5 mt-3">
                                      <template x-if="importResult.card?.data?.character_book">
                                        <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-brand/10 dark:bg-brand/25 text-brand-700 dark:text-brand-300 text-[11px] rounded-full font-medium">
                                          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                                          世界书
                                        </span>
                                      </template>
                                      <span class="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 text-[11px] rounded-full font-medium"
                                            x-text="'SP ' + ((importResult.card?.data?.system_prompt || '').length) + ' chars'"></span>
                                      <template x-if="(importResult.card?.data?.system_prompt || '').includes('[性格补充:') || (importResult.card?.data?.system_prompt || '').includes('[对话内容修改:')">
                                        <span class="px-2 py-0.5 bg-warning/10 dark:bg-warning/20 text-warning-dark dark:text-warning-light text-[11px] rounded-full font-medium">含隐藏设定</span>
                                      </template>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <template x-if="importResult.warnings && importResult.warnings.length">
                                <div class="alert-warning-soft p-4 text-sm flex items-start gap-3">
                                  <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"></path></svg>
                                  <div class="space-y-1 min-w-0">
                                    <p class="font-bold">Arcaferry 提示</p>
                                    <ul class="text-xs opacity-80 space-y-1">
                                      <template x-for="(w, idx) in importResult.warnings" :key="idx">
                                        <li class="break-words leading-relaxed" x-text="w"></li>
                                      </template>
                                    </ul>
                                  </div>
                                </div>
                              </template>

                              <div class="flex flex-col sm:flex-row gap-3">
                                <button @click="applyImport()" class="btn-primary w-full sm:flex-1 py-3 font-bold gap-2">
                                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                  <span>发送到工作台编辑</span>
                                </button>
                                <button @click="importResult = null" class="btn-secondary w-full sm:w-auto sm:px-5 py-3 font-medium text-sm">
                                  返回重试
                                </button>
                              </div>
                            </div>
                          </template>

                          <template x-if="!importResult">
                            <div class="space-y-6">
                              <div class="space-y-2 p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-neo border border-zinc-100 dark:border-zinc-600/50">
                                <div class="flex justify-between items-center mb-2">
                                  <label class="text-sm font-bold text-zinc-700 dark:text-zinc-300">服务端连接</label>
                                  
                                  <div class="flex items-center gap-2">
                                    <span class="flex h-2.5 w-2.5 relative">
                                      <span x-show="isConnected" class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
                                      <span :class="isConnected ? 'bg-brand' : 'bg-danger'" class="relative inline-flex rounded-full h-2.5 w-2.5"></span>
                                    </span>
                                    <span class="text-xs font-mono text-zinc-500 dark:text-zinc-400" x-text="isConnected ? '已连接 ' + serverVersion : '未连接'"></span>
                                  </div>
                                </div>
                                <div class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                                  <span class="font-mono truncate" x-text="ferryUrl || '未设置地址'"></span>
                                  <button @click="openSettings()" class="text-xs text-brand hover:text-brand-dark font-semibold">前往设置</button>
                                </div>
                                <template x-if="!isConnected">
                                  <p class="text-xs text-warning dark:text-warning-light">未连接，请在参数设置中配置并连接</p>
                                </template>
                              </div>

                              <div class="space-y-2 duration-300" :class="isConnected ? 'opacity-100 pointer-events-auto' : 'opacity-50 pointer-events-none'">
                                <label class="text-sm font-bold text-zinc-700 dark:text-zinc-300 ml-1">分享链接 / 来源地址</label>
                                <div class="relative group">
                                  <input 
                                    type="text" 
                                    x-model="shareLink"
                                    placeholder="https://quack.im/discovery/share/..."
                      class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80  focus:border-brand dark:focus:border-brand-400 rounded-neo px-4 py-3   text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 group-hover:bg-white/50 dark:group-hover:bg-zinc-600/50"
                                  >
                                  <div class="absolute right-3 top-3 text-zinc-400 dark:text-zinc-500">🔗</div>
                                </div>
                                <p class="text-xs text-zinc-400 dark:text-zinc-500 ml-1">支持 Quack分享链接</p>
                              </div>
                              
                              <template x-if="error">
                                <div class="alert-danger-soft p-4 text-sm flex items-start gap-3 shadow-sm animate-shake">
                                  <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                  <div class="space-y-1">
                                    <p class="font-bold" x-text="error.message"></p>
                                    <p class="text-xs opacity-80" x-text="error.hint" x-show="error.hint"></p>
                                  </div>
                                </div>
                              </template>
                              
                              <button 
                                @click="scrape()" 
                                :disabled="!hasInput || isScraping || !isConnected"
                                class="btn-primary w-full py-3 font-bold gap-2"
                              >
                                <template x-if="isScraping">
                                  <svg class="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                </template>
                                <span x-text="isScraping ? '抓取中...' : '开始抓取'"></span>
                              </button>
                            </div>
                          </template>
                        </div>
                      </template>
                      
                      <template x-if="activeTab === 'batch'">
                        <div>
                          ${getFerryBatchHTML()}
                        </div>
                      </template>

                      <template x-if="activeTab === 'batch' && false">
                        <div x-data="ferryBatch()">
                          <template x-if="!$store.ferry.isConnected">
                            <div class="alert-warning-soft p-4 mb-4 text-sm">
                              请先在"单个抓取"标签页中连接 Arcaferry 服务
                            </div>
                          </template>
                          <div class="space-y-4">
                            <div class="space-y-2">
                              <label class="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                                批量链接 <span class="text-xs font-normal text-zinc-400 dark:text-zinc-500" x-text="'(' + urlCount + ' 个有效链接)'"></span>
                              </label>
                              <textarea 
                                x-model="urlsText"
                                rows="6"
                                placeholder="每行一个链接，支持 Quack分享链接..."
                                class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-4 py-3 text-sm font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none resize-none   focus:border-brand dark:focus:border-brand-400"
                              ></textarea>
                            </div>
                            
                            <div class="flex items-center gap-6">
                              <div class="flex items-center gap-2">
                                <label class="text-xs text-zinc-600 dark:text-zinc-400">并发数:</label>
                                <input type="text" x-model="concurrencyInput" inputmode="numeric" pattern="[1-5]"
                                       @blur="commitConcurrency()"
                                       @keydown.enter.prevent="commitConcurrency(); $event.target.blur()"
                                       class="w-16 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-2 py-1 text-xs text-center text-zinc-700 dark:text-zinc-200 outline-none   focus:border-brand dark:focus:border-brand-400">
                              </div>
                            </div>
                            
                            <template x-if="batchProgress">
                              <div class="bg-brand-50 dark:bg-zinc-800/80 rounded-neo p-4">
                                <div class="flex items-center justify-between mb-2">
                                  <span class="text-sm font-medium text-brand-dark dark:text-brand-light" x-text="batchProgress.status"></span>
                                  <span class="text-xs text-brand-600 dark:text-brand-400" x-text="batchProgress.current + '/' + batchProgress.total"></span>
                                </div>
                                <div class="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-neo overflow-hidden">
                                  <div class="h-full bg-brand  duration-300" :style="'width: ' + (batchProgress.current / batchProgress.total * 100) + '%'"></div>
                                </div>
                              </div>
                            </template>
                            
                            <template x-if="error">
                              <div class="alert-danger-soft p-4 text-sm">
                                <p class="font-medium" x-text="error.message"></p>
                                <p class="text-xs mt-1 opacity-80" x-text="error.hint"></p>
                              </div>
                            </template>
                            
                            <template x-if="batchResults">
                              <div class="bg-zinc-50 dark:bg-zinc-700/50 rounded-neo p-4 space-y-3">
                                <div class="flex items-center justify-between">
                                  <span class="font-medium text-zinc-700 dark:text-zinc-300">抓取结果</span>
            <button @click="clearResults()" class="btn-secondary px-2 py-1 text-xs">清除</button>
                                </div>
                                <div class="grid grid-cols-3 gap-3 text-center">
                                  <div class="bg-white dark:bg-zinc-800 rounded-neo p-2">
                                    <div class="text-lg font-bold text-zinc-800 dark:text-zinc-200" x-text="batchResults.total"></div>
              <div class="text-xs text-zinc-500 dark:text-zinc-400">总计</div>
                                  </div>
                                  <div class="bg-brand-50 dark:bg-zinc-800 rounded-neo p-2">
                                    <div class="text-lg font-bold text-brand-700 dark:text-brand-300" x-text="batchResults.succeeded"></div>
                                    <div class="text-xs text-brand-600 dark:text-brand-400">成功</div>
                                  </div>
                                  <div class="alert-danger-soft p-2">
                                    <div class="text-lg font-bold text-danger dark:text-danger-light" x-text="batchResults.failed"></div>
                                    <div class="text-xs text-danger dark:text-danger-light opacity-70">失败</div>
                                  </div>
                                </div>
                              </div>
                            </template>
                            
                            <button 
                              @click="startBatch()"
                              :disabled="urlCount === 0 || isBatching"
                              class="btn-primary w-full py-3 font-bold gap-2"
                            >
                              <template x-if="isBatching">
                                <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                </svg>
                              </template>
                              <span x-text="isBatching ? '批量抓取中...' : '开始批量抓取'"></span>
                            </button>
                          </div>
                        </div>
                      </template>
                      
                      <template x-if="activeTab === 'staging'">
                        <div>
                        ${getFerryStagingHTML()}
                        </div>
                      </template>

                      <template x-if="activeTab === 'settings'">
                        <div class="space-y-6">
                          <div class="space-y-2 p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-neo border border-zinc-100 dark:border-zinc-600/50">
                            <div class="flex justify-between items-center mb-2">
                              <label class="text-sm font-bold text-zinc-700 dark:text-zinc-300">服务端连接</label>
                              <div class="flex items-center gap-2">
                                <span class="flex h-2.5 w-2.5 relative">
                                  <span x-show="isConnected" class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
                                  <span :class="isConnected ? 'bg-brand' : 'bg-danger'" class="relative inline-flex rounded-full h-2.5 w-2.5"></span>
                                </span>
                                <span class="text-xs font-mono text-zinc-500 dark:text-zinc-400" x-text="isConnected ? '已连接 ' + serverVersion : '未连接'"></span>
                              </div>
                            </div>
                            <div class="flex gap-2">
                              <input 
                                type="text" 
                                x-model="ferryUrl"
                                @input.debounce.300ms="syncSettings(true)"
                                :disabled="isConnected"
                                placeholder="http://localhost:17236"
                                class="flex-1 bg-white dark:bg-zinc-700 border-zinc-200 dark:border-zinc-600  focus:border-brand dark:focus:border-brand-400 rounded-neo px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 disabled:opacity-60 disabled:bg-zinc-100 dark:disabled:bg-zinc-800"
                              >
                              <button 
                                @click="isConnected ? disconnect() : connect()"
                                :class="isConnected ? 'btn-secondary' : 'btn-primary'"
                                class="px-4 py-2.5 text-sm font-bold min-w-[80px]"
                              >
                                <template x-if="isConnecting">
                                  <svg class="animate-spin h-4 w-4 mx-auto" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                </template>
                                <span x-show="!isConnecting" x-text="isConnected ? '断开' : '连接'"></span>
                              </button>
                            </div>
                            <div class="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 ml-1">
                              <button type="button" @click="rememberServer = !rememberServer; syncSettings(true)"
                                      :class="getCompactToggleClass(rememberServer)"
                                      class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-neo border  active:scale-95 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
                                <svg x-show="rememberServer" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                <span>记住地址</span>
                              </button>
                              <button type="button" @click="autoConnect = !autoConnect; syncSettings(true)"
                                      :class="getCompactToggleClass(autoConnect)"
                                      class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-neo border  active:scale-95 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
                                <svg x-show="autoConnect" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                <span>自动连接</span>
                              </button>
                            </div>
                          </div>

                          <div class="space-y-4">
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div class="space-y-1.5">
                                <div class="flex items-center justify-between">
                                  <label class="text-xs font-bold text-zinc-700 dark:text-zinc-300 ml-1">Bearer Token</label>
                                  <button type="button" @click="saveToken = !saveToken; syncSettings(true)"
                                          :class="getCompactToggleClass(saveToken)"
                                          class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-neo border  active:scale-95 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
                                    <svg x-show="saveToken" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    <span>记住</span>
                                  </button>
                                </div>
                                <input 
                                  type="text" 
                                  x-model="bearerToken"
                                  @input.debounce.300ms="syncSettings(true)"
                                  placeholder="Authorization 头的值..."
                                  class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80  focus:border-brand dark:focus:border-brand-400 rounded-neo px-3 py-1.5   text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                                >
                                <p class="text-[11px] text-zinc-400 dark:text-zinc-500 ml-1 leading-tight">用于接口授权（Authorization: Bearer ...），缺失可能导致请求被拒绝。</p>
                              </div>

                              <div class="space-y-1.5">
                                <div class="flex items-center justify-between">
                                  <label class="text-xs font-bold text-zinc-700 dark:text-zinc-300 ml-1">Cookies</label>
                                  <button type="button" @click="saveCookie = !saveCookie; syncSettings(true)"
                                          :class="getCompactToggleClass(saveCookie)"
                                          class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-neo border  active:scale-95 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
                                    <svg x-show="saveCookie" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    <span>记住</span>
                                  </button>
                                </div>
                                <input 
                                  type="text" 
                                  x-model="cookies"
                                  @input.debounce.300ms="syncSettings(true)"
                                  placeholder="cf_clearance=..."
                                  class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80  focus:border-brand dark:focus:border-brand-400 rounded-neo px-3 py-1.5   text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                                >
                                <p class="text-[11px] text-zinc-400 dark:text-zinc-500 ml-1 leading-tight">用于通过 Cloudflare 验证（cf_clearance），需与签发该 Cookie 的浏览器 UA 与 IP 完全一致。</p>
                              </div>
                            </div>

                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div class="space-y-1.5">
                                <div class="flex items-center justify-between">
                                  <label class="text-xs font-bold text-zinc-700 dark:text-zinc-300 ml-1">User Agent</label>
                                  <button type="button" @click="saveUserAgent = !saveUserAgent; syncSettings(true)"
                                          :class="getCompactToggleClass(saveUserAgent)"
                                          class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-neo border  active:scale-95 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
                                    <svg x-show="saveUserAgent" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    <span>记住</span>
                                  </button>
                                </div>
                                <input
                                  type="text"
                                  x-model="userAgent"
                                  @input.debounce.300ms="syncSettings(true)"
                                  placeholder="Mozilla/5.0 ..."
                                  class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80  focus:border-brand dark:focus:border-brand-400 rounded-neo px-3 py-1.5   text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                                >
                                <p class="text-[11px] text-zinc-400 dark:text-zinc-500 ml-1 leading-tight">用于绑定浏览器标识，需与获取 cf_clearance 的 UA 完全一致。</p>
                              </div>

                              <div class="space-y-1.5">
                                <div class="flex items-center justify-between">
                                  <label class="text-xs font-bold text-zinc-700 dark:text-zinc-300 ml-1">Gemini API Key</label>
                                  <button type="button" @click="saveGeminiApiKey = !saveGeminiApiKey; syncSettings(true)"
                                          :class="getCompactToggleClass(saveGeminiApiKey)"
                                          class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-neo border  active:scale-95 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
                                    <svg x-show="saveGeminiApiKey" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    <span>记住</span>
                                  </button>
                                </div>
                                <input
                                  type="text"
                                  x-model="geminiApiKey"
                                  @input.debounce.300ms="syncSettings(true)"
                                  placeholder="AIzaSy..."
                                  class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80  focus:border-brand dark:focus:border-brand-400 rounded-neo px-3 py-1.5   text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                                >
                                <p class="text-[11px] text-zinc-400 dark:text-zinc-500 ml-1 leading-tight">用于切换 Gemini 2.5 Flash，隐藏设定提取更稳定、速度更快。</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </template>

                      <template x-if="activeTab === 'staging' && false">
                        <div class="h-full" x-data="ferryStaging()">
                          <div class="h-full flex flex-col">
                            <div class="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-700">
                              <div class="flex items-center gap-3">
                                <h3 class="font-bold text-zinc-800 dark:text-zinc-200">
            暂存区 <span class="text-sm font-normal text-zinc-500 dark:text-zinc-400" x-text="'(' + stagedCards.length + ')'"></span>
                                </h3>
                              </div>
                              
                              <div class="flex items-center gap-2">
                              <div class="flex bg-zinc-100 dark:bg-zinc-700 rounded-neo p-0.5">
                                  <button @click="viewMode = 'grid'" 
                                          :class="viewMode === 'grid' ? 'bg-white dark:bg-zinc-600 shadow-sm' : ''"
                    class="p-1.5 rounded-neo ">
                                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                                    </svg>
                                  </button>
                                  <button @click="viewMode = 'list'"
                                          :class="viewMode === 'list' ? 'bg-white dark:bg-zinc-600 shadow-sm' : ''"
                    class="p-1.5 rounded-neo ">
                                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                                    </svg>
                                  </button>
                                </div>
                                
          <button @click="clearAll()" x-show="hasCards" class="text-xs text-zinc-500 hover:text-danger dark:text-zinc-400 dark:hover:text-danger-light">
                                  清空全部
                                </button>
                              </div>
                            </div>
                            
                            <div class="flex-1 overflow-y-auto p-4 custom-scrollbar">
                              <template x-if="!hasCards">
                                <div class="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-500">
                                  <svg class="w-16 h-16 mb-4 text-zinc-200 dark:text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                  </svg>
                                  <p class="text-sm">暂存区为空</p>
                                  <p class="text-xs mt-1">批量抓取的角色卡会显示在这里</p>
                                </div>
                              </template>
                              
                              <template x-if="hasCards && viewMode === 'grid'">
                                <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                  <template x-for="item in stagedCards" :key="item.id">
                                    <div class="group relative bg-white dark:bg-zinc-800 rounded-neo shadow-neo-lift dark:shadow-neo-lift-dark border border-zinc-100 dark:border-zinc-700 overflow-hidden hover:shadow-neo-lift-hover dark:hover:shadow-neo-lift-hover-dark ">
                                      <div class="aspect-square bg-zinc-100 dark:bg-zinc-700">
                                        <template x-if="item.avatar">
                                          <img :src="'data:image/png;base64,' + item.avatar" class="w-full h-full object-cover">
                                        </template>
                                        <template x-if="!item.avatar">
                                          <div class="w-full h-full flex items-center justify-center text-4xl text-zinc-300 dark:text-zinc-600">?</div>
                                        </template>
                                      </div>
                                      
                                      <div class="p-3">
                                        <h4 class="font-medium text-sm text-zinc-800 dark:text-zinc-200 truncate" x-text="item.card.data.name"></h4>
                                        <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1 truncate" x-text="item.card.data.creator || '未知作者'"></p>
                                      </div>
                                      
                                      <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/65 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                        <button @click="editCard(item.id)" class="p-2 bg-white dark:bg-zinc-700 rounded-neo shadow hover:bg-zinc-100 dark:hover:bg-zinc-600" title="编辑">
                                          <svg class="w-5 h-5 text-zinc-700 dark:text-zinc-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                          </svg>
                                        </button>
                                        <button @click="removeCard(item.id)" class="p-2 bg-white dark:bg-zinc-700 rounded-neo shadow hover:bg-danger-light dark:hover:bg-danger-dark" title="删除">
                                          <svg class="w-5 h-5 text-danger dark:text-danger-light" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                        </button>
                                      </div>
                                    </div>
                                  </template>
                                </div>
                              </template>
                              
                              <template x-if="hasCards && viewMode === 'list'">
                                <div class="space-y-2">
                                  <template x-for="item in stagedCards" :key="item.id">
                                    <div class="flex items-center gap-4 p-3 bg-white dark:bg-zinc-800 rounded-neo border border-zinc-100 dark:border-zinc-700 hover:shadow-neo-lift-hover dark:hover:shadow-neo-lift-hover-dark  group">
                                      <div class="w-12 h-12 rounded bg-zinc-100 dark:bg-zinc-700 overflow-hidden flex-shrink-0">
                                        <template x-if="item.avatar">
                                          <img :src="'data:image/png;base64,' + item.avatar" class="w-full h-full object-cover">
                                        </template>
                                      </div>
                                      
                                      <div class="flex-1 min-w-0">
                                        <h4 class="font-medium text-zinc-800 dark:text-zinc-200 truncate" x-text="item.card.data.name"></h4>
                  <p class="text-xs text-zinc-400 dark:text-zinc-500 truncate" x-text="item.card.data.creator || '未知作者'"></p>
                                      </div>
                                      
                                      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button @click="editCard(item.id)" class="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded">
                                          <svg class="w-4 h-4 text-zinc-500 dark:text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                        </button>
                                        <button @click="removeCard(item.id)" class="p-2 hover:bg-danger-light dark:hover:bg-danger-dark rounded">
                                          <svg class="w-4 h-4 text-danger dark:text-danger-light" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                      </div>
                                    </div>
                                  </template>
                                </div>
                              </template>
                            </div>
                          </div>
                        </div>
                      </template>
                    </div>
                </div>
              </template>
              
              <template x-if="modal.type === 'lorebook-entry'">
                <div class="min-h-full flex flex-col" x-data="{
                  entry: modal.draft.entry,
                  newKey: '',
                  showAdvanced: false,
                  
                  addKey() {
                    const trimmed = this.newKey.trim();
                    if (!trimmed) return;
                    if (!this.entry.keys) this.entry.keys = [];
                    if (!this.entry.keys.includes(trimmed)) {
                      this.entry.keys.push(trimmed);
                    }
                    this.newKey = '';
                  },
                  
                  removeKey(keyIndex) {
                    if (this.entry.keys && keyIndex >= 0 && keyIndex < this.entry.keys.length) {
                      this.entry.keys.splice(keyIndex, 1);
                    }
                  },
                  
                  addSecondaryKey() {
                    const input = this.$refs.secondaryKeyInput;
                    const trimmed = input.value.trim();
                    if (!trimmed) return;
                    if (!this.entry.secondary_keys) this.entry.secondary_keys = [];
                    if (!this.entry.secondary_keys.includes(trimmed)) {
                      this.entry.secondary_keys.push(trimmed);
                    }
                    input.value = '';
                  },
                  
                  removeSecondaryKey(keyIndex) {
                    if (this.entry.secondary_keys && keyIndex >= 0 && keyIndex < this.entry.secondary_keys.length) {
                      this.entry.secondary_keys.splice(keyIndex, 1);
                    }
                  }
                }">
                  <!-- Compact header row: Name + Order + Keys + Options -->
                  <div class="flex flex-wrap items-end gap-3 mb-3">
                    <div class="w-48">
                      <label class="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">名称</label>
                      <input type="text" x-model="entry.name" 
                             class="w-full px-2.5 py-1.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo text-sm text-zinc-800 dark:text-zinc-100 outline-none   focus:border-brand dark:focus:border-brand-400"
                             placeholder="条目名称">
                    </div>
                    <div class="w-20">
                      <label class="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">顺序</label>
                      <input type="text" x-model.number="entry.insertion_order" inputmode="numeric" pattern="[0-9]*"
                             class="w-full px-2.5 py-1.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo text-sm text-zinc-800 dark:text-zinc-100 outline-none   focus:border-brand dark:focus:border-brand-400">
                    </div>
                    <div class="flex-1 min-w-[200px]">
                      <label class="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">触发关键词</label>
                      <div class="grid grid-cols-[1fr_auto] gap-1 px-2 py-1.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo min-h-[38px] items-center  focus-within:border-brand dark:focus-within:border-brand-400"
                           @click="$refs.keyInput?.focus()">
                        <div class="flex flex-wrap gap-1.5 items-center">
                          <template x-for="(key, kIndex) in entry.keys" :key="kIndex">
                            <span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-neo text-xs font-medium bg-brand-100 dark:bg-zinc-700 text-brand-800 dark:text-brand-300">
                              <span x-text="key"></span>
                              <button type="button" @click.stop="removeKey(kIndex)" class="ml-0.5 text-brand-600/70 dark:text-brand-400/70 hover:text-brand-800 dark:hover:text-brand-200">
                                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                              </button>
                            </span>
                          </template>
                          <input type="text" x-model="newKey" x-ref="keyInput"
                                 class="flex-1 bg-transparent text-xs text-zinc-700 dark:text-zinc-200 outline-none min-w-[60px] placeholder-zinc-400 dark:placeholder-zinc-500" 
                                 placeholder="输入关键词..."
                                 @keydown.enter.prevent="addKey()">
                        </div>
                        <button type="button" @click.stop="addKey()" :disabled="!newKey?.trim()"
                                class="flex-shrink-0 p-1 rounded-neo text-zinc-400 dark:text-zinc-500 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/30 disabled:opacity-30 disabled:cursor-not-allowed "
                                title="添加关键词">
                          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
                        </button>
                      </div>
                    </div>
                    <div class="flex items-center gap-1.5 py-1.5">
                      <!-- 启用 toggle -->
                      <button @click="entry.enabled = !entry.enabled" type="button"
                              :class="entry.enabled ? 'bg-brand dark:bg-brand-600 text-white border-brand dark:border-brand-600 shadow-sm' : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-600 hover:border-zinc-300 dark:hover:border-zinc-500'"
                              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-neo border ">
                        <svg x-show="entry.enabled" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <span>启用</span>
                      </button>
                      <!-- Constant toggle -->
                      <button @click="entry.constant = !entry.constant" type="button"
                              :class="entry.constant ? 'bg-brand dark:bg-brand-600 text-white border-brand dark:border-brand-600 shadow-sm' : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-600 hover:border-zinc-300 dark:hover:border-zinc-500'"
                              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-neo border ">
                        <svg x-show="entry.constant" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <span>常驻</span>
                      </button>
                      <!-- Selective toggle -->
                      <button @click="entry.selective = !entry.selective" type="button"
                              :class="entry.selective ? 'bg-brand dark:bg-brand-600 text-white border-brand dark:border-brand-600 shadow-sm' : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-600 hover:border-zinc-300 dark:hover:border-zinc-500'"
                              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-neo border ">
                        <svg x-show="entry.selective" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <span>选择性</span>
                      </button>
                    </div>
                  </div>
                  
                  <!-- Main content area - takes remaining space -->
                  <div class="flex-1 flex flex-col min-h-0">
                    <label class="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">内容</label>
                    <textarea x-model="entry.content"
                              class="flex-1 w-full px-3 py-2 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo text-sm font-mono text-zinc-800 dark:text-zinc-100 outline-none resize-none   focus:border-brand dark:focus:border-brand-400"
                              placeholder="条目内容..."></textarea>
                  </div>
                  
                  <!-- Advanced Settings - collapsed by default -->
                  <div class="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-700">
                    <button @click="showAdvanced = !showAdvanced" 
                            class="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 ">
                      <svg class="w-3.5 h-3.5 transition-transform duration-300" :class="showAdvanced ? '' : 'rotate-180'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                      </svg>
                      <span x-text="showAdvanced ? '收起高级设置' : '高级设置'"></span>
                    </button>
                    
                    <div x-show="showAdvanced" x-collapse.duration.300ms class="mt-3 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-neo border border-zinc-100 dark:border-zinc-700">
                      <div class="space-y-3">
                        <div class="grid grid-cols-1 lg:grid-cols-[auto_auto_auto_1fr] gap-3 items-end">
                          <div class="flex flex-wrap items-center gap-1.5 pt-5">
                            <button @click="entry.case_sensitive = !entry.case_sensitive" type="button"
                                    :class="entry.case_sensitive ? 'bg-brand dark:bg-brand-600 text-white border-brand dark:border-brand-600' : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-600 hover:border-zinc-300 dark:hover:border-zinc-500'"
                                     class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-neo border ">
                              <svg x-show="entry.case_sensitive" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              <span>区分大小写</span>
                            </button>
                            <button @click="entry.use_regex = !entry.use_regex" type="button"
                                    :class="entry.use_regex ? 'bg-brand dark:bg-brand-600 text-white border-brand dark:border-brand-600' : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-600 hover:border-zinc-300 dark:hover:border-zinc-500'"
                                     class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-neo border ">
                              <svg x-show="entry.use_regex" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              <span>正则表达式</span>
                            </button>
                          </div>
                          <div class="lg:w-32">
                            <label class="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">插入位置</label>
                            <select x-model="entry.position" 
                                    class="w-full px-2.5 py-1.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo text-xs text-zinc-700 dark:text-zinc-200 outline-none cursor-pointer   focus:border-brand dark:focus:border-brand-400">
                              <option :value="null">默认</option>
                              <option value="before_char">Before Char</option>
                              <option value="after_char">After Char</option>
                              <option value="an_top">A/N Top</option>
                              <option value="an_bottom">A/N Bottom</option>
                            </select>
                          </div>
                          <div class="lg:w-24">
                            <label class="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">优先级</label>
                            <input type="text" x-model.number="entry.priority" inputmode="numeric" pattern="[0-9]*"
                                   class="w-full px-2.5 py-1.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo text-xs text-zinc-700 dark:text-zinc-200 outline-none   focus:border-brand dark:focus:border-brand-400"
                                   placeholder="0">
                          </div>
                          <div class="min-w-[200px]">
                            <label class="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">备注</label>
                            <input type="text" x-model="entry.comment" 
                                   class="w-full px-2.5 py-1.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo text-xs text-zinc-700 dark:text-zinc-200 outline-none   focus:border-brand dark:focus:border-brand-400"
                                   placeholder="仅供参考">
                          </div>
                        </div>

                        <div x-show="entry.selective">
                          <label class="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">次要关键词</label>
                          <div class="grid grid-cols-[1fr_auto] gap-1 px-2 py-1.5 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo min-h-[38px] items-center  focus-within:border-brand dark:focus-within:border-brand-400"
                                @click="$refs.secondaryKeyInput?.focus()">
                            <div class="flex flex-wrap gap-1.5 items-center">
                              <template x-for="(key, kIndex) in entry.secondary_keys" :key="kIndex">
                                <span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-neo text-xs font-medium bg-brand-100 dark:bg-zinc-700 text-brand-800 dark:text-brand-300">
                                  <span x-text="key"></span>
                                  <button type="button" @click.stop="removeSecondaryKey(kIndex)" class="ml-0.5 text-brand-600/70 dark:text-brand-400/70 hover:text-brand-800 dark:hover:text-brand-200">
                                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                                  </button>
                                </span>
                              </template>
                              <input type="text" x-ref="secondaryKeyInput"
                                     class="flex-1 bg-transparent text-xs text-zinc-700 dark:text-zinc-200 outline-none min-w-[60px] placeholder-zinc-400 dark:placeholder-zinc-500" 
                                     placeholder="输入关键词..."
                                     @keydown.enter.prevent="addSecondaryKey()">
                            </div>
                            <button type="button" @click.stop="addSecondaryKey()" 
                                    class="flex-shrink-0 p-1 rounded-neo text-zinc-400 dark:text-zinc-500 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/30 "
                                    title="添加关键词">
                              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <template x-if="modal.type === 'custom'">
                <div x-html="modal.data.html || ''"></div>
              </template>

            </div>

          </div>
        </div>
        </div>
      </template>

    </div>
  `;
}

export default {
  modalEnhanced,
  registerModalEnhancedComponent,
  getModalEnhancedHTML,
};
