import Alpine from 'alpinejs';

export function ferryBatch() {
  return {
    get ferryStore() {
      return Alpine.store('ferry');
    },

    get urlsText() {
      return this.ferryStore.batchUrlsText || '';
    },

    set urlsText(value) {
      this.ferryStore.batchUrlsText = value;
    },

    get isBatching() {
      return this.ferryStore.isBatching;
    },

    get batchProgress() {
      return this.ferryStore.batchProgress;
    },

    get batchResults() {
      return this.ferryStore.batchResults;
    },

    get error() {
      return this.ferryStore.batchError;
    },
    
    get parsedUrls() {
      return this.ferryStore.parseBatchUrls(this.urlsText);
    },
    
    get urlCount() {
      return this.parsedUrls.length;
    },
    
    async startBatch() {
      if (this.urlCount === 0) return;
      await this.ferryStore.startBatchScrape(this.parsedUrls);
    },
    
    clearResults() {
      if (this.isBatching) return;
      this.ferryStore.clearBatchResults();
      this.urlsText = '';
    },
  };
}

export function registerFerryBatchComponent() {
  Alpine.data('ferryBatch', ferryBatch);
}

export function getFerryBatchHTML() {
  return `
    <div x-data="ferryBatch()" class="space-y-4">
      <template x-if="!$store.ferry.isConnected">
        <div class="alert-warning-soft p-4 text-sm">
          请先连接 Arcaferry 服务
        </div>
      </template>
      <div class="space-y-2">
        <label class="text-sm font-bold text-zinc-700 dark:text-zinc-300">
          批量链接 <span class="text-xs font-normal text-zinc-400 dark:text-zinc-500" x-text="'(' + urlCount + ' 个有效链接)'"></span>
        </label>
        <textarea 
          x-model="urlsText"
          rows="6"
          placeholder="每行或逗号分隔一个链接，支持 Quack分享链接..."
          class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-4 py-3 text-sm font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none resize-none   focus:border-brand dark:focus:border-brand-400"
        ></textarea>
        <p class="text-xs text-zinc-400 dark:text-zinc-500">支持换行或逗号分隔</p>
      </div>

      <!-- 并发数设置 -->
      <div class="flex items-center gap-3">
        <span class="text-xs text-zinc-600 dark:text-zinc-400">同时进行的请求数</span>
        <input type="text"
               inputmode="numeric"
               pattern="[1-5]"
               :value="$store.ferry.defaultConcurrency"
               @blur="$store.ferry.defaultConcurrency = Math.min(5, Math.max(1, Number($event.target.value) || 3)); $store.ferry.save()"
               @keydown.enter.prevent="$store.ferry.defaultConcurrency = Math.min(5, Math.max(1, Number($event.target.value) || 3)); $store.ferry.save(); $event.target.blur()"
               class="w-14 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-2 py-1.5 text-sm text-center text-zinc-700 dark:text-zinc-200 outline-none   focus:border-brand dark:focus:border-brand-400">
        <span class="text-xs text-zinc-400 dark:text-zinc-500">范围 1-5</span>
      </div>
      
      <div x-show="batchProgress"
           x-transition:enter="transition ease-out duration-250"
           x-transition:enter-start="opacity-0 translate-y-1"
           x-transition:enter-end="opacity-100 translate-y-0"
           x-transition:leave="transition ease-in duration-180"
           x-transition:leave-start="opacity-100 translate-y-0"
           x-transition:leave-end="opacity-0 -translate-y-1"
           class="bg-brand-50 dark:bg-zinc-800/80 rounded-neo p-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-brand-dark dark:text-brand-light" x-text="batchProgress.status"></span>
            <span class="text-xs text-brand-600 dark:text-brand-400" x-text="batchProgress.current + '/' + batchProgress.total"></span>
          </div>
      <div class="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-neo overflow-hidden">
            <div class="h-full bg-brand transition-[width] duration-300 ease-out" :style="'width: ' + (batchProgress.current / batchProgress.total * 100) + '%'"></div>
          </div>
        </div>
      
      <div x-show="error"
           x-transition:enter="transition ease-out duration-220"
           x-transition:enter-start="opacity-0 -translate-y-1"
           x-transition:enter-end="opacity-100 translate-y-0"
           x-transition:leave="transition ease-in duration-160"
           x-transition:leave-start="opacity-100 translate-y-0"
           x-transition:leave-end="opacity-0 -translate-y-1"
           class="alert-danger-soft p-4 text-sm">
          <p class="font-medium" x-text="error.message"></p>
          <p class="text-xs mt-1 opacity-80" x-text="error.hint"></p>
        </div>
      
      <div x-show="batchResults"
           x-transition:enter="transition ease-out duration-250"
           x-transition:enter-start="opacity-0 translate-y-1"
           x-transition:enter-end="opacity-100 translate-y-0"
           x-transition:leave="transition ease-in duration-180"
           x-transition:leave-start="opacity-100 translate-y-0"
           x-transition:leave-end="opacity-0 -translate-y-1"
           class="bg-zinc-50 dark:bg-zinc-700/50 rounded-neo p-4 space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-medium text-zinc-700 dark:text-zinc-300">抓取结果</span>
            <button @click="clearResults()" :disabled="isBatching" class="btn-secondary px-2 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed">清除</button>
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
  `;
}
