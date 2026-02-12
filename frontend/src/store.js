/**
 * Alpine.js 全局状态管理
 * 
 * 提供深层嵌套对象的响应式更新支持
 */

import Alpine from 'alpinejs';
import { getAccentShades, applyAccentToDOM } from './utils/accent_colors.js';
import { hashBytes } from './agent/crypto_utils.js';
import { loadSkillPreferenceState } from './agent/skill_manager.js';
import { createEmptySkillContextMeta } from './agent/skill_context.js';

// ============================================================
// 工具函数
// ============================================================

/**
 * 深拷贝对象
 * 优先使用原生 structuredClone，兜底手写实现
 */
export function deepClone(obj) {
  // 优先使用原生 structuredClone (性能更好，支持更多类型)
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch {
      // structuredClone 不支持某些类型 (如函数)，回退手写
    }
  }
  
  // 兜底实现
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item));
  }
  
  const cloned = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

async function computeFileHash(file) {
  if (!file?.arrayBuffer) return null;
  const buffer = await file.arrayBuffer();
  return hashBytes(buffer);
}

function createAgentSkillsState() {
  const saved = loadSkillPreferenceState();
  return {
    enabled: saved.enabled !== false,
    catalog: [],
    selectedIds: Array.isArray(saved.selectedIds) ? saved.selectedIds : [],
    autoMatchedIds: [],
    loadedContextMeta: createEmptySkillContextMeta(),
    lastError: null,
  };
}

function resetAgentSessionForCardSwitch() {
  const agent = Alpine.store('agent');
  if (!agent) return;

  if (agent.runtime?.stagingTimer) {
    clearTimeout(agent.runtime.stagingTimer);
    agent.runtime.stagingTimer = null;
  }

  if (agent.runtime?.abortController) {
    try {
      agent.runtime.abortController.abort();
    } catch {
      // ignore abort failures
    }
  }

  if (agent.runtime) {
    agent.runtime.status = 'idle';
    agent.runtime.runId = null;
    agent.runtime.abortController = null;
    agent.runtime.error = null;
    agent.runtime.lastUserInput = '';
    agent.runtime.toolSession = null;
  }

  if (agent.chat) {
    agent.chat.messages = [];
    agent.chat.input = '';
    agent.chat.streamingText = '';
    agent.chat.streamingThinking = '';
  }

  agent.refs = [];
  agent.stagingSummary = '';
  agent.stagingWarnings = [];
  agent.stagingDiffs = [];
  agent.stagingCard = null;
  agent.stagingAt = null;
  agent.lastApplied = null;
  agent.appliedEntries = [];

  if (agent.skills) {
    agent.skills.autoMatchedIds = [];
    agent.skills.loadedContextMeta = createEmptySkillContextMeta();
    agent.skills.lastError = null;
  }

  if (agent.ui) {
    agent.ui.previewPaneOpen = false;
    agent.ui.sidebarMode = 'agent';
    agent.ui.showLastApplied = true;
    agent.ui.diffSelectedId = null;
    agent.ui.diffEntryId = null;
    agent.ui.diffPanelOpen = false;
    agent.ui.fullscreenChatScrollTop = 0;
  }
}

/**
 * 深度比较两个对象是否相等
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  
  // 数组类型必须一致
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (!keysB.includes(key) || !deepEqual(a[key], b[key])) {
      return false;
    }
  }
  
  return true;
}

/**
 * 通过路径获取嵌套对象的值
 * @param {Object} obj - 目标对象
 * @param {string} path - 路径，如 'data.character_book.entries[0].keys'
 * @returns {any} 路径对应的值
 */
export function getByPath(obj, path) {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }
  
  return current;
}

/**
 * 通过路径设置嵌套对象的值
 * @param {Object} obj - 目标对象
 * @param {string} path - 路径
 * @param {any} value - 要设置的值
 * @param {boolean} autoCreate - 是否自动创建不存在的路径 (默认 true)
 */
export function setByPath(obj, path, value, autoCreate = true) {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const nextKey = keys[i + 1];
    
    // 类型检查：如果 current[key] 存在但不是对象，必须覆盖它
    if (current[key] !== undefined && current[key] !== null && typeof current[key] !== 'object') {
      if (!autoCreate) {
        console.warn(`[store] Cannot traverse path at ${keys.slice(0, i + 1).join('.')}`);
        return;
      }
      console.warn(`[store] Overwriting primitive value at ${keys.slice(0, i + 1).join('.')}`);
      current[key] = /^\d+$/.test(nextKey) ? [] : {};
    }
    
    if (current[key] === undefined || current[key] === null) {
      if (!autoCreate) {
        console.warn(`[store] Path does not exist: ${keys.slice(0, i + 1).join('.')}`);
        return;
      }
      // 判断下一个 key 是否为数字索引
      current[key] = /^\d+$/.test(nextKey) ? [] : {};
    }
    current = current[key];
  }
  
  current[keys[keys.length - 1]] = value;
}

// ============================================================
// 创建默认空卡片结构 (CCv3)
// ============================================================

export function createEmptyCard() {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      tags: [],
      creator: '',
      character_version: '',
      alternate_greetings: [],
      group_only_greetings: [],
      character_book: null,
      extensions: {},
      assets: [],
      nickname: '',
      source: [],
    },
  };
}

const DEFAULT_MODEL_TEMPERATURE = 1.0;

function normalizeSupplierTemperature(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_MODEL_TEMPERATURE;
  }
  const clamped = Math.min(2, Math.max(0, numeric));
  return Number(clamped.toFixed(1));
}

// ============================================================
// 初始化 Alpine Stores
// ============================================================

export function initStores() {
  // ----- App Store -----
  Alpine.store('app', {
    version: '0.1.0',
    ready: false,
    
    init() {
      this.ready = true;
    },
  });

  // ----- UI Store -----
  Alpine.store('ui', {
    // 导航
    currentPage: 'home',
    sidebarOpen: true,
    mobileMenuOpen: false,
    
    // 加载状态
    globalLoading: false,
    loadingMessage: '',
    loadingProgress: 0,

    // 设置加载状态
    setLoading(loading, message = '') {
      this.globalLoading = loading;
      this.loadingMessage = message;
      this.loadingProgress = 0;
    },

    // 更新加载进度
    setProgress(progress) {
      this.loadingProgress = Math.min(100, Math.max(0, progress));
    },
  });

  // ----- Card Store -----
  Alpine.store('card', {
    // 当前编辑的卡片数据
    data: null,
    
    // 原始数据 (用于比较变更)
    originalData: null,
    
    // 源文件信息
    sourceFile: null,
    sourceFormat: null,
    
    // 图片数据
    imageDataUrl: null,
    imageFile: null,
    
    // 状态标记
    hasChanges: false,
    lastSaved: null,
    lastChangedAt: 0,

    cardId: null,

    // 初始化新卡片
    initNew() {
      resetAgentSessionForCardSwitch();
      this.data = createEmptyCard();
      this.originalData = deepClone(this.data);
      this.sourceFile = null;
      this.sourceFormat = null;
      this.imageDataUrl = null;
      this.imageFile = null;
      this.cardId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      this.hasChanges = false;
      this.lastSaved = null;
      this.lastChangedAt = 0;
    },

    // 加载解析后的卡片
    loadCard(parseResult, file = null, imageDataUrl = null) {
      resetAgentSessionForCardSwitch();
      this.data = parseResult.card;
      this.originalData = deepClone(parseResult.card);
      this.sourceFile = file;
      this.sourceFormat = parseResult.source_format;
      this.imageDataUrl = imageDataUrl;
      this.imageFile = file?.type?.startsWith('image/') ? file : null;
      this.cardId = parseResult.card_id || null;
      if (!this.cardId && file) {
        computeFileHash(file)
          .then((hash) => {
            if (hash) {
              this.cardId = `file_${hash}`;
            }
          })
          .catch((error) => {
            console.warn('Failed to compute file hash for card id:', error);
          });
      }
      this.hasChanges = false;
      this.lastSaved = null;
      this.lastChangedAt = 0;
    },

    // 更新字段 (支持深层路径)
    updateField(path, value) {
      if (!this.data) return;
      setByPath(this.data, path, value);
      this.checkChanges();
    },

    // 获取字段值 (支持深层路径)
    getField(path) {
      if (!this.data) return undefined;
      return getByPath(this.data, path);
    },

    // 防抖定时器
    _checkChangesTimer: null,
    
    // 检查是否有变更 (防抖优化: 500ms 内连续调用只执行一次)
    checkChanges() {
      // 立即设置脏标记 (乐观更新)
      this.hasChanges = true;
      this.lastChangedAt = Date.now();
      
      // 防抖: 清除之前的定时器
      if (this._checkChangesTimer) {
        clearTimeout(this._checkChangesTimer);
      }
      
      // 延迟执行精确比较
      this._checkChangesTimer = setTimeout(() => {
        this.hasChanges = !deepEqual(this.data, this.originalData);
        this._checkChangesTimer = null;
      }, 500);
    },

    // 标记已保存
    markSaved() {
      this.originalData = deepClone(this.data);
      this.hasChanges = false;
      this.lastSaved = new Date();
      this.lastChangedAt = 0;
    },

    // 重置到原始状态
    reset() {
      if (this.originalData) {
        this.data = deepClone(this.originalData);
        this.hasChanges = false;
        this.lastChangedAt = 0;
      }
    },

    // 清空卡片
    clear() {
      resetAgentSessionForCardSwitch();
      this.data = null;
      this.originalData = null;
      this.sourceFile = null;
      this.sourceFormat = null;
      this.imageDataUrl = null;
      this.imageFile = null;
      this.cardId = null;
      this.hasChanges = false;
      this.lastSaved = null;
      this.lastChangedAt = 0;
    },
  });

  // ----- Settings Store -----
  Alpine.store('settings', {
    apiKey: '',
    apiUrl: '',
    model: '',
    proxyEnabled: false,
    availableModels: [],
    
    theme: 'system',
    accentColor: 'teal',
    customAccentHex: '',
    
    autoSaveEnabled: true,
    autoSaveInterval: 30,
    includeV2Compat: true,
    
    // Agent 功能设置
    agentShowActivityTrace: false,
    skillsEnabled: true,
    
    // Agent 高级设置
    agentToolCallLimit: 50,
    agentMaxValueChars: 80000,
    agentSkillAutoMatchLimit: 3,
    agentDiffLayout: 'split',
    agentDiffWrap: true,
    agentDiffFold: true,
    
    applyTheme(mode) {
      const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', isDark);
    },
    
    applyAccent() {
      const shades = getAccentShades(this.accentColor, this.customAccentHex);
      applyAccentToDOM(shades);
    },
    
    setAccent(colorId, customHex = null) {
      this.accentColor = colorId;
      if (colorId === 'custom' && customHex) {
        this.customAccentHex = customHex;
      } else if (colorId !== 'custom') {
        this.customAccentHex = '';
      }
      localStorage.setItem('arcamage_accent', JSON.stringify({
        colorId: this.accentColor,
        customHex: this.customAccentHex,
      }));
      this.applyAccent();
    },
    
    load() {
      try {
        const saved = localStorage.getItem('arcamage_settings');
        if (saved) {
          const parsed = JSON.parse(saved);
          this.autoSaveEnabled = parsed.autoSaveEnabled ?? true;
          this.autoSaveInterval = parsed.autoSaveInterval ?? 30;
          this.agentShowActivityTrace = parsed.agentShowActivityTrace ?? false;
          this.skillsEnabled = parsed.skillsEnabled ?? true;
          this.includeV2Compat = parsed.includeV2Compat ?? true;
          this.proxyEnabled = parsed.proxyEnabled ?? false;
          this.agentToolCallLimit = parsed.agentToolCallLimit ?? 50;
          this.agentMaxValueChars = parsed.agentMaxValueChars ?? 80000;
          this.agentSkillAutoMatchLimit = parsed.agentSkillAutoMatchLimit ?? 3;
          this.agentDiffLayout = parsed.agentDiffLayout ?? 'split';
          this.agentDiffWrap = parsed.agentDiffWrap ?? true;
          this.agentDiffFold = parsed.agentDiffFold ?? true;
        }
        
        const savedTheme = localStorage.getItem('arcamage_theme');
        this.theme = savedTheme || 'system';
        this.applyTheme(this.theme);
        
        try {
          const savedAccent = localStorage.getItem('arcamage_accent');
          if (savedAccent) {
            const { colorId, customHex } = JSON.parse(savedAccent);
            this.accentColor = colorId || 'teal';
            this.customAccentHex = customHex || '';
          }
        } catch (e) {
          console.warn('Failed to load accent settings:', e);
        }
        this.applyAccent();
        
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
          if (this.theme === 'system') {
            this.applyTheme('system');
          }
        });
        
        this.applyAgentDiffSettings();
      } catch (e) {
        console.warn('Failed to load settings:', e);
      }
    },
    
    applyAgentDiffSettings() {
      const agent = Alpine.store('agent');
      if (agent?.ui) {
        agent.ui.diffLayout = this.agentDiffLayout;
        agent.ui.diffWrap = this.agentDiffWrap;
        agent.ui.diffFold = this.agentDiffFold;
      }
    },
    
    save() {
      try {
        const toSave = {
          autoSaveEnabled: this.autoSaveEnabled,
          autoSaveInterval: this.autoSaveInterval,
          agentShowActivityTrace: this.agentShowActivityTrace,
          skillsEnabled: this.skillsEnabled,
          includeV2Compat: this.includeV2Compat,
          proxyEnabled: this.proxyEnabled,
          agentToolCallLimit: this.agentToolCallLimit,
          agentMaxValueChars: this.agentMaxValueChars,
          agentSkillAutoMatchLimit: this.agentSkillAutoMatchLimit,
          agentDiffLayout: this.agentDiffLayout,
          agentDiffWrap: this.agentDiffWrap,
          agentDiffFold: this.agentDiffFold,
        };
        localStorage.setItem('arcamage_settings', JSON.stringify(toSave));
      } catch (e) {
        console.warn('Failed to save settings:', e);
      }
    },
    
    setTheme(mode) {
      this.theme = mode;
      localStorage.setItem('arcamage_theme', mode);
      this.applyTheme(mode);
    },
  });

  // ----- Suppliers Store -----
  Alpine.store('suppliers', {
    storageKey: 'arcamage_supplier_settings',

    providers: [],
    currentProviderId: null,

    baseUrl: '',
    apiKey: '',
    model: '',
    useProxy: false,
    temperature: DEFAULT_MODEL_TEMPERATURE,

    getConfig() {
      return {
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
        model: this.model,
        useProxy: this.useProxy,
        temperature: this.temperature,
      };
    },

    getCurrentProvider() {
      if (!this.currentProviderId || this.providers.length === 0) return null;
      return this.providers.find((provider) => provider.id === this.currentProviderId) || null;
    },

    ensureDefaultProvider() {
      if (this.providers.length > 0) return;

      const id = 'provider_default';
      const provider = {
        id,
        name: '供应商 1',
        baseUrl: '',
        apiKey: '',
        model: '',
        useProxy: false,
        temperature: DEFAULT_MODEL_TEMPERATURE,
      };

      this.providers = [provider];
      this.currentProviderId = id;
      this.baseUrl = '';
      this.apiKey = '';
      this.model = '';
      this.useProxy = false;
      this.temperature = DEFAULT_MODEL_TEMPERATURE;
    },

    switchProvider(providerId) {
      this.syncCurrentProvider();

      const provider = this.providers.find((item) => item.id === providerId);
      if (!provider) return;

      this.currentProviderId = providerId;
      this.baseUrl = provider.baseUrl || '';
      this.apiKey = provider.apiKey || '';
      this.model = provider.model || '';
      this.useProxy = provider.useProxy ?? false;
      this.temperature = normalizeSupplierTemperature(provider.temperature);
    },

    addProvider(name) {
      const id = `provider_${Date.now()}`;
      const provider = {
        id,
        name: name || `供应商 ${this.providers.length + 1}`,
        baseUrl: '',
        apiKey: '',
        model: '',
        useProxy: false,
        temperature: DEFAULT_MODEL_TEMPERATURE,
      };

      this.providers.push(provider);
      this.currentProviderId = id;
      this.baseUrl = provider.baseUrl;
      this.apiKey = provider.apiKey;
      this.model = provider.model;
      this.useProxy = provider.useProxy;
      this.temperature = provider.temperature;

      this.save();

      return id;
    },

    removeProvider(providerId) {
      const index = this.providers.findIndex((item) => item.id === providerId);
      if (index === -1) return;

      const removingCurrent = this.currentProviderId === providerId;
      this.providers.splice(index, 1);

      if (removingCurrent) {
        if (this.providers.length > 0) {
          const nextProvider = this.providers[0];
          this.currentProviderId = nextProvider.id;
          this.baseUrl = nextProvider.baseUrl || '';
          this.apiKey = nextProvider.apiKey || '';
          this.model = nextProvider.model || '';
          this.useProxy = nextProvider.useProxy ?? false;
          this.temperature = normalizeSupplierTemperature(nextProvider.temperature);
        } else {
          this.currentProviderId = null;
          this.baseUrl = '';
          this.apiKey = '';
          this.model = '';
          this.useProxy = false;
          this.temperature = DEFAULT_MODEL_TEMPERATURE;
        }
      }

      this.save();
    },

    renameProvider(providerId, newName) {
      const provider = this.providers.find((item) => item.id === providerId);
      if (!provider) return;
      provider.name = newName;
      this.save();
    },

    syncCurrentProvider() {
      const provider = this.getCurrentProvider();
      if (!provider) return;
      provider.baseUrl = this.baseUrl;
      provider.apiKey = this.apiKey;
      provider.model = this.model;
      provider.useProxy = this.useProxy;
      provider.temperature = normalizeSupplierTemperature(this.temperature);
    },

    load() {
      try {
        const saved = localStorage.getItem(this.storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.providers)) {
            this.providers = parsed.providers.map((provider) => ({
              ...provider,
              temperature: normalizeSupplierTemperature(provider?.temperature),
            }));
            this.currentProviderId = parsed.currentProviderId || null;
          }
        }

        if (this.providers.length === 0) {
          this.ensureDefaultProvider();
          return;
        }

        const current = this.getCurrentProvider() || this.providers[0];
        this.currentProviderId = current?.id ?? null;
        this.baseUrl = current?.baseUrl || '';
        this.apiKey = current?.apiKey || '';
        this.model = current?.model || '';
        this.useProxy = current?.useProxy ?? false;
        this.temperature = normalizeSupplierTemperature(current?.temperature);
      } catch (error) {
        console.warn('Failed to load supplier settings:', error);
        this.ensureDefaultProvider();
      }
    },

    save() {
      try {
        this.syncCurrentProvider();
        localStorage.setItem(this.storageKey, JSON.stringify({
          providers: this.providers,
          currentProviderId: this.currentProviderId,
        }));
      } catch (error) {
        console.warn('Failed to save supplier settings:', error);
      }
    },
  });

  // ----- Toast Store -----
  Alpine.store('toast', {
    items: [],
    nextId: 1,

    /**
     * 显示 toast 通知
     * @param {Object} options
     * @param {string} options.message - 消息内容
     * @param {'success'|'error'|'loading'|'info'|'warning'} options.type - 类型
     * @param {number} options.duration - 持续时间 (毫秒), 0 表示不自动关闭
     * @returns {number} toast ID
     */
    show({ message, type = 'info', duration = 3000 }) {
      const id = this.nextId++;
      this.items.push({ id, message, type, duration });
      
      if (duration > 0) {
        setTimeout(() => this.dismiss(id), duration);
      }
      
      return id;
    },

    // 快捷方法
    success(message, duration = 3000) {
      return this.show({ message, type: 'success', duration });
    },

    error(message, duration = 5000) {
      return this.show({ message, type: 'error', duration });
    },

    loading(message) {
      return this.show({ message, type: 'loading', duration: 0 });
    },

    info(message, duration = 3000) {
      return this.show({ message, type: 'info', duration });
    },

    // 关闭指定 toast
    dismiss(id) {
      const index = this.items.findIndex(item => item.id === id);
      if (index !== -1) {
        this.items.splice(index, 1);
      }
    },

    // 更新 toast 消息
    update(id, { message, type }) {
      const item = this.items.find(item => item.id === id);
      if (item) {
        if (message !== undefined) item.message = message;
        if (type !== undefined) item.type = type;
      }
    },

    // 清空所有 toast
    clear() {
      this.items = [];
    },
  });

  // ----- Undo/Redo Store (历史记录) -----
  // 采用单栈+指针方案（与 undo_redo.js 保持一致）
  Alpine.store('history', {
    stack: [],
    index: -1,
    maxSize: 10,

    /**
     * 记录新状态
     * @param {Object} state - 要记录的状态
     */
    push(state) {
      // 如果当前不在栈顶，裁剪掉指针后面的状态
      if (this.index < this.stack.length - 1) {
        this.stack = this.stack.slice(0, this.index + 1);
      }
      
      // 添加新状态
      this.stack.push(deepClone(state));
      this.index = this.stack.length - 1;
      
      // 限制栈大小
      if (this.stack.length > this.maxSize) {
        this.stack.shift();
        this.index--;
      }
    },

    /**
     * 撤销操作
     * @returns {Object|null} 撤销后的状态
     */
    undo() {
      if (!this.canUndo) return null;
      
      this.index--;
      return deepClone(this.stack[this.index]);
    },

    /**
     * 重做操作
     * @returns {Object|null} 重做后的状态
     */
    redo() {
      if (!this.canRedo) return null;
      
      this.index++;
      return deepClone(this.stack[this.index]);
    },

    /**
     * 清空历史
     */
    clear() {
      this.stack = [];
      this.index = -1;
    },

    /**
     * 初始化（保存当前状态作为初始状态）
     * @param {Object} initialState - 初始状态
     */
    init(initialState) {
      this.clear();
      this.push(initialState);
    },

    /**
     * 是否可以撤销
     */
    get canUndo() {
      return this.index > 0;
    },

    /**
     * 是否可以重做
     */
    get canRedo() {
      return this.index < this.stack.length - 1;
    },
  });

  // ----- Agent Store (AI Agent runtime) -----
  Alpine.store('agent', {
    ui: {
      isOpen: false,
      sidebarMode: 'agent',
      isFullscreen: false,
      previewPaneOpen: false,
      showLastApplied: true,
      diffLayout: 'split',
      diffWrap: true,
      diffFold: true,
      diffCollapsed: false,
      diffSelectedId: null,
      diffEntryId: null,
      diffPanelOpen: false,
      fullscreenChatScrollTop: 0,
      openSkillManager: false,
    },

    runtime: {
      status: 'idle', // idle | streaming | staging | error
      runId: null,
      abortController: null,
      error: null,
      lastUserInput: '',
      stagingTimer: null,
      toolSession: null,
    },

    chat: {
      messages: [],
      input: '',
      streamingText: '',
      streamingThinking: '',
    },

    refs: [],

    skills: createAgentSkillsState(),

    stagingSummary: '',
    stagingWarnings: [],
    stagingDiffs: [],
    stagingCard: null,
    stagingAt: null,

    lastApplied: null,
    appliedEntries: [],
  });

  // ----- Ferry Store (Arcaferry integration) -----
  Alpine.store('ferry', {
    serverUrl: 'http://localhost:17236',
    defaultConcurrency: 3,
    autoConnect: true,
    rememberServer: true,

    cookies: '',
    bearerToken: '',
    userAgent: '',
    geminiApiKey: '',
    rememberCookie: false,
    rememberToken: false,
    rememberUserAgent: false,
    rememberGeminiApiKey: false,

    isConnected: false,
    serverVersion: '',

    stagedCards: [],
    batchUrlsText: '',
    isBatching: false,
    batchProgress: null,
    batchResults: null,
    batchError: null,

    load() {
      try {
        const saved = localStorage.getItem('arcamage_ferry');
        if (saved) {
          const parsed = JSON.parse(saved);
          this.serverUrl = parsed.serverUrl || 'http://localhost:17236';
          this.defaultConcurrency = parsed.defaultConcurrency || 3;
          this.autoConnect = parsed.autoConnect !== false;
          this.rememberServer = parsed.rememberServer !== false;

          this.cookies = parsed.cookies || '';
          this.bearerToken = parsed.bearerToken || '';
          this.userAgent = parsed.userAgent || '';
          this.geminiApiKey = parsed.geminiApiKey || '';
          this.rememberCookie = parsed.rememberCookie === true;
          this.rememberToken = parsed.rememberToken === true;
          this.rememberUserAgent = parsed.rememberUserAgent === true;
          this.rememberGeminiApiKey = parsed.rememberGeminiApiKey === true;
          this.batchUrlsText = typeof parsed.batchUrlsText === 'string' ? parsed.batchUrlsText : '';
          return;
        }
      } catch (e) {
        console.warn('Failed to load ferry settings:', e);
      }

      const legacyUrl = localStorage.getItem('ferry_url');
      if (legacyUrl) {
        this.serverUrl = legacyUrl;
        this.rememberServer = true;
      }

      const legacyCookie = localStorage.getItem('ferry_cookie');
      if (legacyCookie) {
        this.cookies = legacyCookie;
        this.rememberCookie = true;
      }

      const legacyToken = localStorage.getItem('ferry_bearer_token');
      if (legacyToken) {
        this.bearerToken = legacyToken;
        this.rememberToken = true;
      }

      const legacyUserAgent = localStorage.getItem('ferry_user_agent');
      if (legacyUserAgent) {
        this.userAgent = legacyUserAgent;
        this.rememberUserAgent = true;
      }

      const legacyGemini = localStorage.getItem('ferry_gemini_api_key');
      if (legacyGemini) {
        this.geminiApiKey = legacyGemini;
        this.rememberGeminiApiKey = true;
      }
    },

    save() {
      try {
        const payload = {
          defaultConcurrency: this.defaultConcurrency,
          autoConnect: this.autoConnect,
          rememberServer: this.rememberServer,
          rememberCookie: this.rememberCookie,
          rememberToken: this.rememberToken,
          rememberUserAgent: this.rememberUserAgent,
          rememberGeminiApiKey: this.rememberGeminiApiKey,
          batchUrlsText: this.batchUrlsText,
        };

        if (this.rememberServer) {
          payload.serverUrl = this.serverUrl;
        }

        if (this.rememberCookie) {
          payload.cookies = this.cookies;
        }

        if (this.rememberToken) {
          payload.bearerToken = this.bearerToken;
        }

        if (this.rememberUserAgent) {
          payload.userAgent = this.userAgent;
        }

        if (this.rememberGeminiApiKey) {
          payload.geminiApiKey = this.geminiApiKey;
        }

        localStorage.setItem('arcamage_ferry', JSON.stringify({
          ...payload,
        }));
      } catch (e) {
        console.warn('Failed to save ferry settings:', e);
      }
    },

    normalizeToken(token) {
      if (!token) return '';
      let t = token.trim();
      if (t.toLowerCase().startsWith('bearer ')) {
        t = t.slice(7).trim();
      }
      return t;
    },

    buildAuthPayload() {
      const normalizedToken = this.normalizeToken(this.bearerToken);
      return {
        cookies: this.cookies || null,
        bearer_token: normalizedToken || null,
        user_agent: this.userAgent || null,
        gemini_api_key: this.geminiApiKey || null,
      };
    },

    parseBatchUrls(text) {
      return (text || '')
        .split(/[\n,，]+/)
        .map(url => url.trim())
        .filter(url => url.length > 0 && (url.includes('purrly') || url.includes('quack') || url.startsWith('http')));
    },

    clearBatchResults() {
      if (this.isBatching) {
        return;
      }
      this.batchResults = null;
      this.batchError = null;
      this.batchProgress = null;
    },

    createBatchFailureResult(url, message, errorCode = 'NETWORK_ERROR', warnings = []) {
      return {
        url,
        success: false,
        card: null,
        avatar_base64: null,
        png_base64: null,
        warnings,
        error: message,
        error_code: errorCode,
      };
    },

    async scrapeSingleForBatch(serverBaseUrl, targetUrl, authPayload) {
      try {
        const response = await fetch(`${serverBaseUrl}/api/scrape`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: targetUrl,
            ...authPayload,
          }),
        });

        const payload = await response.json().catch((error) => {
          console.warn('[ferry] Failed to parse scrape response body:', error);
          return null;
        });

        if (!response.ok) {
          return this.createBatchFailureResult(
            targetUrl,
            payload?.error || `HTTP ${response.status}`,
            payload?.error_code || 'NETWORK_ERROR',
            Array.isArray(payload?.warnings) ? payload.warnings : [],
          );
        }

        if (!payload || payload.success !== true || !payload.card) {
          return this.createBatchFailureResult(
            targetUrl,
            payload?.error || '抓取失败，未返回卡片数据',
            payload?.error_code || 'PARSE_ERROR',
            Array.isArray(payload?.warnings) ? payload.warnings : [],
          );
        }

        return {
          url: targetUrl,
          success: true,
          card: payload.card,
          avatar_base64: payload.avatar_base64 || null,
          png_base64: payload.png_base64 || null,
          warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
          error: null,
          error_code: null,
        };
      } catch (error) {
        return this.createBatchFailureResult(
          targetUrl,
          error?.message || '网络请求失败',
          'NETWORK_ERROR',
        );
      }
    },

    async startBatchScrape(urls) {
      if (this.isBatching) {
        return false;
      }

      const normalizedUrls = Array.isArray(urls)
        ? urls
            .map(url => (typeof url === 'string' ? url.trim() : ''))
            .filter(url => url.length > 0)
        : this.parseBatchUrls(this.batchUrlsText);

      if (normalizedUrls.length === 0) {
        this.batchError = {
          message: '未提供可用链接',
          hint: '请先输入至少一个有效分享链接',
        };
        return false;
      }

      if (!this.isConnected) {
        this.batchError = {
          message: '未连接服务',
          hint: '请先连接 Arcaferry 服务',
        };
        return false;
      }

      const serverBaseUrl = this.serverUrl.trim().replace(/\/$/, '');
      if (!serverBaseUrl) {
        this.batchError = {
          message: '服务地址为空',
          hint: '请先在参数设置中配置 Arcaferry 地址',
        };
        return false;
      }

      this.batchError = null;
      this.batchResults = {
        success: false,
        total: normalizedUrls.length,
        succeeded: 0,
        failed: 0,
        results: [],
      };
      this.batchProgress = {
        current: 0,
        total: normalizedUrls.length,
        status: '准备中...',
      };
      this.isBatching = true;

      try {
        const rawConcurrency = Number(this.defaultConcurrency);
        const resolvedConcurrency = Number.isFinite(rawConcurrency) ? rawConcurrency : 3;
        const concurrency = Math.min(5, Math.max(1, resolvedConcurrency));
        const authPayload = this.buildAuthPayload();

        let nextIndex = 0;
        const worker = async () => {
          while (nextIndex < normalizedUrls.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            if (currentIndex >= normalizedUrls.length) {
              return;
            }

            const targetUrl = normalizedUrls[currentIndex];
            const itemResult = await this.scrapeSingleForBatch(serverBaseUrl, targetUrl, authPayload);

            this.batchResults.results.push(itemResult);
            if (itemResult.success && itemResult.card) {
              this.batchResults.succeeded += 1;
              this.addToStaging(itemResult.card, itemResult.avatar_base64);
            } else {
              this.batchResults.failed += 1;
            }

            const completed = this.batchResults.succeeded + this.batchResults.failed;
            this.batchProgress.current = completed;
            this.batchProgress.status = completed >= normalizedUrls.length ? '整理结果...' : '抓取中...';
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(concurrency, normalizedUrls.length) }, () => worker()),
        );

        this.batchResults.success = this.batchResults.failed === 0;
        this.batchProgress = null;
        Alpine.store('toast').success(`批量抓取完成: ${this.batchResults.succeeded}/${this.batchResults.total} 成功`);
        return true;
      } catch (error) {
        this.batchError = {
          message: error?.message || '批量抓取失败',
          hint: '请检查网络连接和服务状态',
        };
        return false;
      } finally {
        this.isBatching = false;
      }
    },

    addToStaging(card, avatar) {
      this.stagedCards.push({
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        card,
        avatar,
        selected: false,
        addedAt: new Date(),
      });
    },

    removeFromStaging(id) {
      this.stagedCards = this.stagedCards.filter(c => c.id !== id);
    },

    clearStaging() {
      this.stagedCards = [];
    },
  });
}

// ============================================================
// 导出
// ============================================================

export default {
  initStores,
  createEmptyCard,
  deepClone,
  deepEqual,
  getByPath,
  setByPath,
};
