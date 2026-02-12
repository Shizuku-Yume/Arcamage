import Alpine from 'alpinejs';
import { injectCard } from '../api.js';

export function ferryStaging() {
  return {
    viewMode: 'grid',
    isDownloading: false,
    
    get stagedCards() {
      return Alpine.store('ferry').stagedCards;
    },
    
    get selectedCount() {
      return this.stagedCards.filter(c => c.selected).count;
    },
    
    get hasCards() {
      return this.stagedCards.length > 0;
    },
    
    toggleSelect(id) {
      const card = this.stagedCards.find(c => c.id === id);
      if (card) card.selected = !card.selected;
    },
    
    selectAll() {
      this.stagedCards.forEach((card) => {
        card.selected = true;
      });
    },

    deselectAll() {
      this.stagedCards.forEach((card) => {
        card.selected = false;
      });
    },
    
    removeCard(id) {
      Alpine.store('ferry').removeFromStaging(id);
    },
    
    removeSelected() {
      const selected = this.stagedCards.filter((card) => card.selected);
      selected.forEach((card) => {
        this.removeCard(card.id);
      });
    },
    
    clearAll() {
      Alpine.store('ferry').clearStaging();
    },
    
    editCard(id) {
      const item = this.stagedCards.find(c => c.id === id);
      if (!item) return;

      const cardStore = Alpine.store('card');
      const cardPayload = JSON.parse(JSON.stringify(item.card));
      const imageDataUrl = item.avatar ? `data:image/png;base64,${item.avatar}` : null;
      cardStore.loadCard({
        card: cardPayload,
        source_format: 'ferry',
        card_id: item.id ? `ferry_${item.id}` : null,
      }, null, imageDataUrl);

      Alpine.store('modalStack').closeAll();
      Alpine.store('ui').currentPage = 'workshop';
      Alpine.store('toast').success(`已加载 ${item.card.data.name}`);
    },
    
    async downloadCard(id) {
      const item = this.stagedCards.find(c => c.id === id);
      if (!item) return;

      this.isDownloading = true;
      const toastId = Alpine.store('toast').loading('正在导出...');
      try {
        const imageFile = await this._avatarToFile(item.avatar, item.card.data.name);
        const blob = await injectCard(imageFile, item.card.data, true);
        this._downloadBlob(blob, this._generateFilename(item.card.data.name));
        Alpine.store('toast').dismiss(toastId);
        Alpine.store('toast').success(`已下载 ${item.card.data.name}`);
      } catch (err) {
        console.error('Download error:', err);
        Alpine.store('toast').dismiss(toastId);
        Alpine.store('toast').error('下载失败: ' + (err.message || '未知错误'));
      } finally {
        this.isDownloading = false;
      }
    },
    
    async downloadSelected() {
      const selected = this.stagedCards.filter(c => c.selected);
      if (selected.length === 0) return;
      
      this.isDownloading = true;
      const toastId = Alpine.store('toast').loading(`正在导出 ${selected.length} 张卡片...`);
      let succeeded = 0;
      let failed = 0;

      for (const item of selected) {
        try {
          const imageFile = await this._avatarToFile(item.avatar, item.card.data.name);
          const blob = await injectCard(imageFile, item.card.data, true);
          this._downloadBlob(blob, this._generateFilename(item.card.data.name));
          succeeded++;
        } catch (err) {
          console.error(`Download error for ${item.card.data.name}:`, err);
          failed++;
        }
        // Small delay between downloads to avoid browser blocking
        if (selected.indexOf(item) < selected.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      Alpine.store('toast').dismiss(toastId);
      if (failed === 0) {
        Alpine.store('toast').success(`已下载 ${succeeded} 张卡片`);
      } else {
        Alpine.store('toast').warning(`下载完成: ${succeeded} 成功, ${failed} 失败`);
      }
      this.isDownloading = false;
    },

    async _avatarToFile(avatarBase64, name) {
      if (avatarBase64) {
        const res = await fetch(`data:image/png;base64,${avatarBase64}`);
        const blob = await res.blob();
        return new File([blob], `${name || 'card'}.png`, { type: 'image/png' });
      }
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 600;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgb(55, 65, 81)';
      ctx.fillRect(0, 0, 400, 600);
      ctx.fillStyle = 'rgb(156, 163, 175)';
      ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(name ? name.charAt(0) : '?', 200, 320);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      return new File([blob], `${name || 'card'}.png`, { type: 'image/png' });
    },

    _generateFilename(name) {
      const safeName = (name || 'Character').replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
      const now = new Date();
      const date = now.toISOString().split('T')[0].replace(/-/g, '');
      const time = now.toTimeString().split(' ')[0].replace(/:/g, '').substring(0, 4);
      return `${safeName}_${date}_${time}.png`;
    },

    _downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    hasHiddenSettings(item) {
      const sp = item.card?.data?.system_prompt || '';
      return sp.includes('[性格补充:') || sp.includes('[对话内容修改:');
    },

    hasLorebook(item) {
      const book = item.card?.data?.character_book;
      return book && book.entries && book.entries.length > 0;
    },
  };
}

export function registerFerryStagingComponent() {
  Alpine.data('ferryStaging', ferryStaging);
}

export function getFerryStagingHTML() {
  return `
    <div x-data="ferryStaging()" class="h-full flex flex-col">
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
                    class="p-1.5 rounded-neo transition-all">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
            <button @click="viewMode = 'list'"
                    :class="viewMode === 'list' ? 'bg-white dark:bg-zinc-600 shadow-sm' : ''"
                    class="p-1.5 rounded-neo transition-all">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
          
          <button @click="clearAll()"
                  x-show="hasCards"
                  x-transition:enter="transition ease-out duration-180"
                  x-transition:enter-start="opacity-0"
                  x-transition:enter-end="opacity-100"
                  x-transition:leave="transition ease-in duration-120"
                  x-transition:leave-start="opacity-100"
                  x-transition:leave-end="opacity-0"
                  class="btn-danger px-2 py-1 text-xs">
            清空全部
          </button>
        </div>
      </div>
      
      <div class="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <template x-if="!hasCards">
          <div class="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-500 animate-fade-in-up">
            <svg class="w-16 h-16 mb-4 text-zinc-200 dark:text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p class="text-sm">暂存区为空</p>
            <p class="text-xs mt-1 text-zinc-400 dark:text-zinc-500">批量抓取的角色卡会显示在这里</p>
          </div>
        </template>
        
        <template x-if="hasCards && viewMode === 'grid'">
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"
               x-transition:enter="transition ease-out duration-220"
               x-transition:enter-start="opacity-0 translate-y-1"
               x-transition:enter-end="opacity-100 translate-y-0"
               x-transition:leave="transition ease-in duration-160"
               x-transition:leave-start="opacity-100 translate-y-0"
               x-transition:leave-end="opacity-0 -translate-y-1">
            <template x-for="item in stagedCards" :key="item.id">
              <div class="group relative bg-white dark:bg-zinc-800 rounded-neo shadow-neo-lift dark:shadow-neo-lift-dark border border-zinc-100 dark:border-zinc-700 overflow-hidden hover:shadow-neo-lift-hover dark:hover:shadow-neo-lift-hover-dark transition-all duration-200 animate-fade-in-up">
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
                  <div class="flex flex-wrap gap-1 mt-1.5" x-show="hasLorebook(item) || hasHiddenSettings(item)">
                    <template x-if="hasLorebook(item)">
                      <span class="px-1.5 py-0.5 bg-brand-50 dark:bg-zinc-700 text-brand-700 dark:text-brand-300 text-[10px] rounded-full font-medium">世界书</span>
                    </template>
                    <template x-if="hasHiddenSettings(item)">
                      <span class="px-1.5 py-0.5 bg-warning-light dark:bg-zinc-700 text-warning-dark dark:text-warning-light text-[10px] rounded-full font-medium">隐藏设定</span>
                    </template>
                  </div>
                </div>
                
                <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/65 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button @click="editCard(item.id)" class="btn-icon-ghost p-2" title="编辑">
                    <svg class="w-5 h-5 text-zinc-700 dark:text-zinc-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button @click="downloadCard(item.id)" class="btn-icon-ghost p-2" title="下载">
                    <svg class="w-5 h-5 text-zinc-700 dark:text-zinc-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  <button @click="removeCard(item.id)" class="btn-danger p-2" title="删除">
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
          <div class="space-y-2"
               x-transition:enter="transition ease-out duration-220"
               x-transition:enter-start="opacity-0 translate-y-1"
               x-transition:enter-end="opacity-100 translate-y-0"
               x-transition:leave="transition ease-in duration-160"
               x-transition:leave-start="opacity-100 translate-y-0"
               x-transition:leave-end="opacity-0 -translate-y-1">
            <template x-for="item in stagedCards" :key="item.id">
              <div class="flex items-center gap-4 p-3 bg-white dark:bg-zinc-800 rounded-neo border border-zinc-100 dark:border-zinc-700 hover:shadow-neo-lift-hover dark:hover:shadow-neo-lift-hover-dark transition-all duration-200 group animate-fade-in-up">
                <div class="w-12 h-12 rounded-neo bg-zinc-100 dark:bg-zinc-700 overflow-hidden flex-shrink-0">
                  <template x-if="item.avatar">
                    <img :src="'data:image/png;base64,' + item.avatar" class="w-full h-full object-cover">
                  </template>
                </div>
                
                <div class="flex-1 min-w-0">
                  <h4 class="font-medium text-zinc-800 dark:text-zinc-200 truncate" x-text="item.card.data.name"></h4>
                  <div class="flex items-center gap-2 mt-0.5">
                    <p class="text-xs text-zinc-400 dark:text-zinc-500 truncate" x-text="item.card.data.creator || '未知作者'"></p>
                    <template x-if="hasLorebook(item)">
                      <span class="px-1.5 py-0.5 bg-brand-50 dark:bg-zinc-700 text-brand-700 dark:text-brand-300 text-[10px] rounded-full font-medium flex-shrink-0">世界书</span>
                    </template>
                    <template x-if="hasHiddenSettings(item)">
                      <span class="px-1.5 py-0.5 bg-warning-light dark:bg-zinc-700 text-warning-dark dark:text-warning-light text-[10px] rounded-full font-medium flex-shrink-0">隐藏设定</span>
                    </template>
                  </div>
                </div>
                
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button @click="editCard(item.id)" class="btn-icon-ghost p-2">
                    <svg class="w-4 h-4 text-zinc-500 dark:text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                  <button @click="downloadCard(item.id)" class="btn-icon-ghost p-2">
                    <svg class="w-4 h-4 text-zinc-500 dark:text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  </button>
                  <button @click="removeCard(item.id)" class="btn-danger p-2">
                    <svg class="w-4 h-4 text-danger dark:text-danger-light" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>
  `;
}
