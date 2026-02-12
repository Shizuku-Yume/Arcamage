import Alpine from 'alpinejs';
import Sortable from 'sortablejs';

export function arrayFieldModal(modal) {
  return {
    _modal: modal,
    sortable: null,
    
    init() {
      this.$nextTick(() => {
        if (this.meta.enableReorder !== false) {
          this.initSortable();
        }
      });
    },

    get items() {
      return this._modal.draft?.items || [];
    },

    set items(value) {
      if (this._modal && this._modal.draft) {
        this._modal.draft.items = value;
        this._modal.dirty = true;
      }
    },

    get meta() {
      return this._modal.meta || {};
    },

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
          const items = [...this.items];
          const item = items.splice(evt.oldIndex, 1)[0];
          items.splice(evt.newIndex, 0, item);
          
          this.items = [];
          this.$nextTick(() => {
            this.items = items;
          });
        },
      });
    },
    
    addItem() {
      const items = [...this.items];
      items.push('');
      this.items = items;
      
      this.$nextTick(() => {
        this.editItem(items.length - 1);
      });
    },
    
    removeItem(index) {
      const items = [...this.items];
      items.splice(index, 1);
      this.items = items;
    },

    editItem(index) {
      const item = this.items[index];
      const label = this.meta.itemLabel || '项目';
      
      Alpine.store('modalStack').push({
        type: 'text',
        title: `编辑${label} #${index + 1}`,
        size: 'lg',
        data: { value: item },
        draft: { value: item },
        onSave: (draftData) => {
          const items = [...this.items];
          items[index] = draftData.value;
          this.items = items;
        },
        meta: {
          placeholder: `请输入${label}内容...`,
        }
      });
    }
  };
}

export function registerArrayFieldModalComponent() {
  Alpine.data('arrayFieldModal', arrayFieldModal);
}

export function getArrayFieldModalHTML() {
  return `
    <div x-data="arrayFieldModal(modal)" class="h-full flex flex-col">
      <div class="bg-zinc-50 dark:bg-zinc-900/50 rounded-neo p-4 h-full flex flex-col">
        <div class="flex-1 overflow-y-auto min-h-0 p-1 custom-scrollbar">
          <div x-ref="sortableContainer" class="space-y-2">
          <template x-for="(item, index) in items" :key="index">
            <div class="bg-white dark:bg-zinc-700 rounded-neo p-3 shadow-neo-lift dark:shadow-neo-lift-dark border border-zinc-100 dark:border-zinc-600 flex items-center gap-3 group hover:shadow-neo-lift-hover dark:hover:shadow-neo-lift-hover-dark transition-all duration-200 animate-fade-in-up">
              <div class="drag-handle cursor-grab active:cursor-grabbing text-zinc-300 dark:text-zinc-500 hover:text-zinc-500 dark:hover:text-zinc-300 p-1 transition-colors"
                   x-show="meta.enableReorder !== false">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </div>

            <div class="w-6 h-6 rounded-neo bg-zinc-100 dark:bg-zinc-600 flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-200 font-mono flex-shrink-0"
                   x-text="index + 1"></div>

              <div class="flex-1 min-w-0 cursor-pointer py-1" @click="editItem(index)">
                <div class="text-sm text-zinc-700 dark:text-zinc-200 truncate font-medium" 
                     x-text="item || '(空)'"
                     :class="!item ? 'text-zinc-400 dark:text-zinc-500 italic' : ''"></div>
              </div>

              <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button @click="editItem(index)" 
                        class="btn-icon-ghost p-1.5 transition-colors"
                        title="编辑">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button @click="removeItem(index)"
                        class="btn-danger p-1.5 transition-colors"
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
            <svg class="w-12 h-12 mb-3 text-zinc-200 dark:text-zinc-700" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
            </svg>
            <p class="text-sm">暂无内容，点击下方按钮添加</p>
          </div>
        </div>

        <div class="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-700 flex-shrink-0">
          <button @click="addItem()"
                  class="btn-secondary w-full py-3 font-medium border-2 border-dashed border-zinc-200 dark:border-zinc-600 hover:border-brand dark:hover:border-brand-500 hover:text-brand dark:hover:text-brand-400 hover:bg-brand/5 dark:hover:bg-brand-900/20 gap-2">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span x-text="meta.addLabel || '添加项目'"></span>
          </button>
        </div>
      </div>
    </div>
  `;
}

export default {
  arrayFieldModal,
  registerArrayFieldModalComponent,
  getArrayFieldModalHTML
};
