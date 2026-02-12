import Alpine from 'alpinejs';
import { getFerryBatchHTML } from './ferry_batch.js';
import { getFerryStagingHTML } from './ferry_staging.js';

export function ferryModal(modal) {
  return {
    modal: modal,

    activeTab: 'single',

    // Form data
    ferryUrl: 'http://localhost:17236',
    shareLink: '',
    cookies: '',
    bearerToken: '',
    userAgent: '',
    geminiApiKey: '',
    
    // Options
    rememberServer: true,
    autoConnect: true,
    saveCookie: false,
    saveToken: false,
    saveUserAgent: false,
    saveGeminiApiKey: false,

    defaultConcurrency: 3,
    defaultConcurrencyInput: '3',
    
    // State
    isConnected: false,
    isConnecting: false,
    isScraping: false,
    serverVersion: '',
    importResult: null,
    error: null,
    
    get hasInput() {
      return this.shareLink.trim().length > 0;
    },

    init() {
      const ferry = Alpine.store('ferry');
      if (ferry) {
        this.ferryUrl = ferry.serverUrl;
        this.rememberServer = ferry.rememberServer;
        this.autoConnect = ferry.autoConnect;
        this.cookies = ferry.cookies;
        this.bearerToken = ferry.bearerToken;
        this.userAgent = ferry.userAgent;
        this.geminiApiKey = ferry.geminiApiKey;
        this.saveCookie = ferry.rememberCookie;
        this.saveToken = ferry.rememberToken;
        this.saveUserAgent = ferry.rememberUserAgent;
        this.saveGeminiApiKey = ferry.rememberGeminiApiKey;
        this.defaultConcurrency = ferry.defaultConcurrency;
        this.defaultConcurrencyInput = String(this.defaultConcurrency);
      }

      // Email/password login support has been removed. Clean up any previously stored secrets.
      localStorage.removeItem('ferry_email');
      localStorage.removeItem('ferry_password');

      if (this.autoConnect && this.ferryUrl && !this.isConnected) {
        this.connect();
      }
    },
    
    saveCredentials() {
      this.syncSettings(true);
    },

    commitDefaultConcurrency() {
      if (this.defaultConcurrencyInput === '' || this.defaultConcurrencyInput === null || this.defaultConcurrencyInput === undefined) {
        this.defaultConcurrencyInput = String(this.defaultConcurrency ?? 1);
        return;
      }

      const parsed = Number(this.defaultConcurrencyInput);
      if (Number.isNaN(parsed)) {
        this.defaultConcurrencyInput = String(this.defaultConcurrency ?? 1);
        return;
      }

      const clamped = Math.min(5, Math.max(1, parsed));
      this.defaultConcurrency = clamped;
      this.defaultConcurrencyInput = String(clamped);
      this.syncSettings(true);
    },

    syncSettings(persist = false) {
      const ferry = Alpine.store('ferry');
      if (!ferry) return;
      ferry.serverUrl = this.ferryUrl;
      ferry.defaultConcurrency = this.defaultConcurrency;
      ferry.autoConnect = this.autoConnect;
      ferry.rememberServer = this.rememberServer;
      ferry.cookies = this.cookies;
      ferry.bearerToken = this.bearerToken;
      ferry.userAgent = this.userAgent;
      ferry.geminiApiKey = this.geminiApiKey;
      ferry.rememberCookie = this.saveCookie;
      ferry.rememberToken = this.saveToken;
      ferry.rememberUserAgent = this.saveUserAgent;
      ferry.rememberGeminiApiKey = this.saveGeminiApiKey;
      if (persist) {
        ferry.save();
      }
    },

    openSettings() {
      this.activeTab = 'settings';
    },

    async connect() {
      if (!this.ferryUrl) return;

      this.isConnecting = true;
      this.error = null;
      
      try {
        const url = this.ferryUrl.trim().replace(/\/$/, '');
        this.ferryUrl = url;
        this.syncSettings(true);
        const res = await fetch(`${url}/api/status`);
        
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        
        const data = await res.json();
        
        if (data.status === 'ok' || data.ready === true || data.version) {
          this.isConnected = true;
          this.serverVersion = data.version || 'Unknown';
          this.saveCredentials();
          
          const ferryStore = Alpine.store('ferry');
          if (ferryStore) {
            ferryStore.isConnected = true;
            ferryStore.serverVersion = this.serverVersion;
            ferryStore.serverUrl = this.ferryUrl;
          }
          
          Alpine.store('toast').success(`已连接 Arcaferry ${this.serverVersion}`);
        } else {
          throw new Error('Server returned unexpected status');
        }
      } catch (err) {
        console.error('Ferry connect error:', err);
        this.isConnected = false;
        this.error = { 
          message: '连接失败', 
          hint: '请确认 Arcaferry 服务已启动，且允许跨域请求。' 
        };
      } finally {
        this.isConnecting = false;
      }
    },

    disconnect() {
      this.isConnected = false;
      this.serverVersion = '';
      this.importResult = null;
      this.error = null;
      
      const ferryStore = Alpine.store('ferry');
      if (ferryStore) {
        ferryStore.isConnected = false;
        ferryStore.serverVersion = '';
      }
    },

    async scrape() {
      if (!this.shareLink) return;
      if (!this.isConnected) {
        this.error = { message: '尚未连接', hint: '请先连接 Arcaferry 服务' };
        return;
      }
      
      this.isScraping = true;
      this.error = null;
      this.importResult = null;
      
      try {
        const url = this.ferryUrl.replace(/\/$/, '');
        this.syncSettings();
        const ferry = Alpine.store('ferry');
        const authPayload = ferry ? ferry.buildAuthPayload() : {};
        const res = await fetch(`${url}/api/scrape`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: this.shareLink,
            ...authPayload,
          })
        });

        if (!res.ok) {
           const errData = await res.json().catch((error) => {
             console.warn('[ferry_modal] Failed to parse error response body:', error);
             return {};
           });
           throw new Error(errData.error || `HTTP ${res.status}`);
        }
        
        const result = await res.json();
        
        if (result.success) {
          this.importResult = result;
          this.saveCredentials();
          Alpine.store('toast').success('抓取成功，请确认信息');
        } else {
          throw new Error(result.error || '抓取失败，未返回详细错误');
        }

      } catch (err) {
        console.error('Ferry scrape error:', err);
        this.error = { 
          message: err.message || '抓取失败', 
          hint: '请检查链接是否有效，或 Token/Cookies 是否正确' 
        };
      } finally {
        this.isScraping = false;
      }
    },

    applyImport() {
      if (!this.importResult) return;

      const result = this.importResult;
      const cardStore = Alpine.store('card');

      if (result.card) {
        const cardPayload = JSON.parse(JSON.stringify(result.card));
        const imageDataUrl = result.avatar_base64
          ? `data:image/png;base64,${result.avatar_base64}`
          : null;
        cardStore.loadCard({
          card: cardPayload,
          source_format: 'ferry',
          card_id: result.card_id || null,
        }, null, imageDataUrl);
      }
      
      Alpine.store('modalStack').closeAll();
      Alpine.store('ui').currentPage = 'workshop';
      Alpine.store('toast').success('已发送到工作台');
    }
  };
}

export function registerFerryModalComponent() {
  Alpine.data('ferryModal', ferryModal);
}

export function getFerryModalHTML() {
  return `
    <div x-data="ferryModal($el.closest('[x-data]')._x_dataStack[0])" class="flex flex-col h-[min(74dvh,760px)] min-h-[320px] sm:min-h-[400px] overflow-hidden">
      <!-- Modal Header -->
      <div class="px-6 py-4 border-b border-zinc-100 dark:border-zinc-700 flex justify-between items-center bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md z-10">
        <h3 class="text-lg font-bold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
          <span class="text-2xl">⛴️</span> Arcaferry
        </h3>
        <button @click="_modal.close()" class="text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
      
      <!-- Tab Navigation -->
      <div class="px-6 pt-5 bg-zinc-50/50 dark:bg-zinc-800/50">
        <div class="flex border-b border-zinc-200 dark:border-zinc-700">
          <button @click="activeTab = 'single'" 
                  :class="activeTab === 'single' ? 'border-brand dark:border-brand-400 text-brand dark:text-brand-400' : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'"
                  class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap">
            单个抓取
          </button>
          <button @click="activeTab = 'batch'" 
                  :class="activeTab === 'batch' ? 'border-brand dark:border-brand-400 text-brand dark:text-brand-400' : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'"
                  class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap">
            批量抓取
          </button>
          <button @click="activeTab = 'staging'" 
                  :class="activeTab === 'staging' ? 'border-brand dark:border-brand-400 text-brand dark:text-brand-400' : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'"
                  class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap flex items-center gap-1">
            暂存区
            <template x-if="$store.ferry.stagedCards.length > 0">
              <span class="bg-brand text-white text-xs px-1.5 py-0.5 rounded-neo" x-text="$store.ferry.stagedCards.length"></span>
            </template>
          </button>
          <button @click="activeTab = 'settings'" 
                  :class="activeTab === 'settings' ? 'border-brand dark:border-brand-400 text-brand dark:text-brand-400' : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'"
                  class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap">
            参数设置
          </button>
        </div>
      </div>
      
      <!-- Tab Content -->
      <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar" style="scrollbar-gutter: stable;">
        <!-- Single Tab -->
        <template x-if="activeTab === 'single'">
          <div class="p-6 space-y-6">
            <!-- Success State (Preview) -->
            <template x-if="importResult">
              <div class="space-y-5 animate-fade-in-up">
                <!-- Success banner -->
                <div class="alert-success-soft p-4 text-sm flex items-start gap-3 shadow-sm">
                  <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                  <div class="space-y-1">
                    <p class="font-bold">抓取成功</p>
                    <p class="text-xs opacity-80">请确认卡片信息后发送到工作台编辑</p>
                  </div>
                </div>

                <!-- Card preview -->
                <div class="bg-white dark:bg-zinc-800 rounded-neo-lg border border-zinc-100 dark:border-zinc-700 shadow-neo-lift dark:shadow-neo-lift-dark p-4 sm:p-5">
                  <div class="flex flex-col sm:flex-row gap-4 sm:gap-5">
                    <!-- Avatar -->
                    <div class="w-28 h-28 sm:w-32 sm:h-32 flex-shrink-0 rounded-neo-lg overflow-hidden shadow-neo-lift dark:shadow-neo-lift-dark ring-2 ring-white dark:ring-zinc-700">
                      <template x-if="importResult.avatar_base64">
                        <img :src="'data:image/png;base64,' + importResult.avatar_base64" class="w-full h-full object-cover">
                      </template>
                      <template x-if="!importResult.avatar_base64">
                        <div class="w-full h-full flex items-center justify-center text-3xl font-bold text-zinc-300 dark:text-zinc-600 bg-zinc-100 dark:bg-zinc-800">?</div>
                      </template>
                    </div>

                    <!-- Info -->
                    <div class="flex-1 min-w-0 flex flex-col justify-between">
                      <div>
                        <h4 class="text-lg font-bold text-zinc-800 dark:text-zinc-100 truncate" x-text="importResult.card?.data?.name || '未知角色'"></h4>
                        <template x-if="importResult.card?.data?.creator">
                          <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5" x-text="'by ' + importResult.card.data.creator"></p>
                        </template>
                        <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-2 line-clamp-3 leading-relaxed"
                           x-text="importResult.card?.data?.creator_notes || importResult.card?.data?.description?.substring(0, 120) || '无简介'"></p>
                      </div>

                      <!-- Badges -->
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

                <!-- Warnings -->
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

                <!-- Actions -->
                <div class="flex flex-col sm:flex-row gap-3 pt-1">
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

            <!-- Input State -->
            <template x-if="!importResult">
              <div class="space-y-6">
                <!-- Connection Status -->
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

                <!-- Scrape Input -->
                <div class="space-y-2 duration-300" :class="isConnected ? 'opacity-100 pointer-events-auto' : 'opacity-50 pointer-events-none'">
                  <label class="text-sm font-bold text-zinc-700 dark:text-zinc-300 ml-1">分享链接 / 来源地址</label>
                  <div class="relative group">
                    <input 
                      type="text" 
                      x-model="shareLink"
                      placeholder="https://quack.im/discovery/share/..."
                      class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80  focus:border-brand dark:focus:border-brand-400 rounded-neo px-4 py-3 shadow-neo-inset dark:shadow-neo-inset-dark  text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 group-hover:bg-white/50 dark:group-hover:bg-zinc-600/50"
                    >
                    <div class="absolute right-3 top-3 text-zinc-400 dark:text-zinc-500">🔗</div>
                  </div>
                  <p class="text-xs text-zinc-400 dark:text-zinc-500 ml-1">支持 Quack分享链接</p>
                </div>
                
                <!-- Error Display -->
                <template x-if="error">
                  <div class="alert-danger-soft p-4 text-sm flex items-start gap-3 shadow-sm animate-shake">
                    <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <div class="space-y-1">
                      <p class="font-bold" x-text="error.message"></p>
                      <p class="text-xs opacity-80" x-text="error.hint" x-show="error.hint"></p>
                    </div>
                  </div>
                </template>
                
                <!-- Action Button -->
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
        
        <!-- Batch Tab -->
        <template x-if="activeTab === 'batch'">
          <div class="p-6">
            ${getFerryBatchHTML()}
          </div>
        </template>

        <!-- Legacy (kept for reference, disabled) -->
        <template x-if="activeTab === 'batch' && false">
          <div class="p-6" x-data="ferryBatch()">
            <!-- Connection reminder -->
            <template x-if="!$store.ferry.isConnected">
              <div class="alert-warning-soft p-4 mb-4 text-sm">
                请先在"单个抓取"标签页中连接 Arcaferry 服务
              </div>
            </template>
            ${getFerryBatchInnerHTML()}
          </div>
        </template>
        
        <!-- Staging Tab -->
        <template x-if="activeTab === 'staging'">
          <div class="h-full">
            ${getFerryStagingHTML()}
          </div>
        </template>

        <!-- Settings Tab -->
        <template x-if="activeTab === 'settings'">
          <div class="p-6 space-y-6">
            <!-- Connection Section -->
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
                  class="flex-1 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-4 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none   focus:border-brand dark:focus:border-brand-400 disabled:opacity-60 disabled:bg-zinc-100/60 dark:disabled:bg-zinc-800/60 disabled:shadow-none"
                >
                <button 
                  @click="isConnected ? disconnect() : connect()"
                  :class="isConnected ? 'btn-secondary' : 'btn-primary'"
                  class="px-4 py-2 text-sm font-bold min-w-[80px]"
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
              <div class="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400 ml-1">
                <label class="flex items-center gap-2">
                  <input type="checkbox" x-model="rememberServer" @change="syncSettings(true)" class="rounded text-brand focus:ring-0 border-zinc-300 dark:border-zinc-600 dark:bg-zinc-700 w-3 h-3">
                  记住地址
                </label>
                <label class="flex items-center gap-2">
                  <input type="checkbox" x-model="autoConnect" @change="syncSettings(true)" class="rounded text-brand focus:ring-0 border-zinc-300 dark:border-zinc-600 dark:bg-zinc-700 w-3 h-3">
                  自动连接
                </label>
              </div>
            </div>

            <!-- Credentials Section -->
            <div class="space-y-5">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <label class="text-xs font-bold text-zinc-700 dark:text-zinc-300">Bearer Token</label>
                    <label class="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" x-model="saveToken" @change="syncSettings(true)" class="rounded text-brand focus:ring-0 border-zinc-300 dark:border-zinc-600 dark:bg-zinc-700 w-3 h-3">
                      <span class="text-[11px] text-zinc-400 dark:text-zinc-500">记住</span>
                    </label>
                  </div>
                  <input 
                    type="text" 
                    x-model="bearerToken"
                    @input.debounce.300ms="syncSettings(true)"
                    placeholder="Bearer ey..."
                    class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80  focus:border-brand dark:focus:border-brand-400 rounded-neo px-4 py-2.5 shadow-neo-inset dark:shadow-neo-inset-dark  text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                  >
                  <p class="text-[11px] text-zinc-400 dark:text-zinc-500 leading-tight">用于接口授权（Authorization: Bearer ...），缺失可能导致请求被拒绝。</p>
                </div>
                
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <label class="text-xs font-bold text-zinc-700 dark:text-zinc-300">Cookies</label>
                    <label class="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" x-model="saveCookie" @change="syncSettings(true)" class="rounded text-brand focus:ring-0 border-zinc-300 dark:border-zinc-600 dark:bg-zinc-700 w-3 h-3">
                      <span class="text-[11px] text-zinc-400 dark:text-zinc-500">记住</span>
                    </label>
                  </div>
                  <input 
                    type="text" 
                    x-model="cookies"
                    @input.debounce.300ms="syncSettings(true)"
                    placeholder="cf_clearance=..."
                    class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80  focus:border-brand dark:focus:border-brand-400 rounded-neo px-4 py-2.5 shadow-neo-inset dark:shadow-neo-inset-dark  text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                  >
                  <p class="text-[11px] text-zinc-400 dark:text-zinc-500 leading-tight">用于通过 Cloudflare 验证（cf_clearance），需与签发该 Cookie 的浏览器 UA 与 IP 完全一致。</p>
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <label class="text-xs font-bold text-zinc-700 dark:text-zinc-300">User Agent</label>
                    <label class="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" x-model="saveUserAgent" @change="syncSettings(true)" class="rounded text-brand focus:ring-0 border-zinc-300 dark:border-zinc-600 dark:bg-zinc-700 w-3 h-3">
                      <span class="text-[11px] text-zinc-400 dark:text-zinc-500">记住</span>
                    </label>
                  </div>
                  <input 
                    type="text" 
                    x-model="userAgent"
                    @input.debounce.300ms="syncSettings(true)"
                    placeholder="Mozilla/5.0 ..."
                    class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80  focus:border-brand dark:focus:border-brand-400 rounded-neo px-4 py-2.5 shadow-neo-inset dark:shadow-neo-inset-dark  text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                  >
                  <p class="text-[11px] text-zinc-400 dark:text-zinc-500 leading-tight">用于绑定浏览器标识，需与获取 cf_clearance 的 UA 完全一致。</p>
                </div>
                
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <label class="text-xs font-bold text-zinc-700 dark:text-zinc-300">Gemini API Key</label>
                    <label class="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" x-model="saveGeminiApiKey" @change="syncSettings(true)" class="rounded text-brand focus:ring-0 border-zinc-300 dark:border-zinc-600 dark:bg-zinc-700 w-3 h-3">
                      <span class="text-[11px] text-zinc-400 dark:text-zinc-500">记住</span>
                    </label>
                  </div>
                  <input 
                    type="text" 
                    x-model="geminiApiKey"
                    @input.debounce.300ms="syncSettings(true)"
                    placeholder="AIzaSy..."
                    class="w-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80  focus:border-brand dark:focus:border-brand-400 rounded-neo px-4 py-2.5 shadow-neo-inset dark:shadow-neo-inset-dark  text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                  >
                  <p class="text-[11px] text-zinc-400 dark:text-zinc-500 leading-tight">用于切换 Gemini 2.5 Flash，隐藏设定提取更稳定、速度更快。</p>
                </div>
              </div>

              <!-- Batch Settings -->
              <div class="flex items-center gap-4 pt-2">
                <span class="text-xs font-bold text-zinc-700 dark:text-zinc-300">批量并发数</span>
                <input type="text"
                       inputmode="numeric"
                       pattern="[1-5]"
                       x-model="defaultConcurrencyInput"
                       @blur="commitDefaultConcurrency()"
                       @keydown.enter.prevent="commitDefaultConcurrency(); $event.target.blur()"
                       class="w-16 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-3 py-2 text-sm text-center text-zinc-700 dark:text-zinc-200 outline-none   focus:border-brand dark:focus:border-brand-400">
                <span class="text-xs text-zinc-400 dark:text-zinc-500">同时进行的请求数，范围 1-5</span>
              </div>
            </div>
          </div>
        </template>

        <!-- Legacy (kept for reference, disabled) -->
        <template x-if="activeTab === 'staging' && false">
          <div class="h-full" x-data="ferryStaging()">
            ${getFerryStagingInnerHTML()}
          </div>
        </template>
      </div>
    </div>
  `;
}

function getFerryBatchInnerHTML() {
  return `
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
              <input type="text"
                     inputmode="numeric"
                     pattern="[1-5]"
                     x-model="concurrencyInput"
                     @blur="commitConcurrency()"
                     @keydown.enter.prevent="commitConcurrency(); $event.target.blur()"
                     class="w-16 bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo px-3 py-1.5 text-xs text-center text-zinc-700 dark:text-zinc-200 outline-none   focus:border-brand dark:focus:border-brand-400">
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
  `;
}

function getFerryStagingInnerHTML() {
  return `
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
          
          <button @click="clearAll()" x-show="hasCards" class="btn-danger px-2 py-1 text-xs">
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
                  <button @click="editCard(item.id)" class="btn-icon-ghost p-2" title="编辑">
                    <svg class="w-5 h-5 text-zinc-700 dark:text-zinc-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
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
                  <button @click="editCard(item.id)" class="btn-icon-ghost p-2">
                    <svg class="w-4 h-4 text-zinc-500 dark:text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
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
