
import Alpine from 'alpinejs';
import { ACCENT_PRESETS, isValidHex, normalizeHex } from '../utils/accent_colors.js';
import { getSupplierModels } from '../api.js';
import { requestAssistantTurn } from '../agent/llm/client.js';
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_SUPPLIER_API,
  MAX_CONTEXT_WINDOW,
  MAX_MAX_TOKENS,
  MIN_CONTEXT_WINDOW,
  MIN_MAX_TOKENS,
  DEFAULT_SUPPLIER_PROVIDER,
  DEFAULT_SUPPLIER_TRANSPORT,
  normalizeSupplierConfig,
  normalizeSupplierModels,
} from '../agent/llm/model.js';
import { confirm } from './modal.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hexToRgb(hex) {
  if (!isValidHex(hex)) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex(r, g, b) {
  const toHex = (value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function hexToHsv(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return { h: 260, s: 56, v: 100 };

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }

  return {
    h: Math.round((h + 360) % 360),
    s: Math.round(max === 0 ? 0 : (delta / max) * 100),
    v: Math.round(max * 100),
  };
}

function hsvToHex(h, s, v) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 100) / 100;
  const value = clamp(v, 0, 100) / 100;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value - chroma;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = chroma;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = chroma;
  } else if (hue < 180) {
    g = chroma;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = chroma;
  } else if (hue < 300) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

const SUPPLIER_PROVIDER_BY_API = {
  'openai-completions': 'openai-compatible',
  'openai-responses': 'openai',
  'anthropic-messages': 'anthropic',
  'google-generative-ai': 'google',
  'mistral-conversations': 'mistral',
};

const SUPPLIER_API_OPTIONS = [
  { value: 'openai-completions', label: 'openai-completions' },
  { value: 'openai-responses', label: 'openai-responses' },
  { value: 'anthropic-messages', label: 'anthropic-messages' },
  { value: 'google-generative-ai', label: 'google-generative-ai' },
  { value: 'mistral-conversations', label: 'mistral-conversations' },
];

const SUPPLIER_TRANSPORT_OPTIONS = [
  { value: 'direct', label: '浏览器直连' },
  { value: 'arcamage-proxy', label: 'Arcamage 代理' },
];

const MODEL_VENDOR_PATTERNS = [
  { key: 'claude', label: 'Claude' },
  { key: 'gpt', label: 'OpenAI / GPT' },
  { key: 'openai', label: 'OpenAI / GPT' },
  { key: 'gemini', label: 'Google / Gemini' },
  { key: 'grok', label: 'xAI / Grok' },
  { key: 'qwen', label: 'Qwen' },
  { key: 'deepseek', label: 'DeepSeek' },
  { key: 'kimi', label: 'Kimi' },
  { key: 'glm', label: 'GLM' },
  { key: 'mistral', label: 'Mistral' },
  { key: 'minimax', label: 'MiniMax' },
  { key: 'llama', label: 'Llama' },
];

function formatJsonObject(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return JSON.stringify(source, null, 2);
}

function resolveSupplierProviderForApi(api, fallback = DEFAULT_SUPPLIER_PROVIDER) {
  return SUPPLIER_PROVIDER_BY_API[api] || fallback || DEFAULT_SUPPLIER_PROVIDER;
}

function getModelVendorLabel(modelId) {
  const normalized = String(modelId || '').toLowerCase();
  const match = MODEL_VENDOR_PATTERNS.find((item) => normalized.includes(item.key));
  return match?.label || '其他模型';
}

function getModelGenerationLabel(modelId) {
  const text = String(modelId || '');
  const version = text.match(/(?:^|[-_])(?:v)?(\d+(?:\.\d+)?)/i)?.[1];
  if (!version) return '其他系列';
  return `${version.split('.')[0]} 系列`;
}

export function groupSupplierModels(models) {
  const groups = new Map();

  normalizeSupplierModels(models).forEach((model) => {
    const vendor = getModelVendorLabel(model.id);
    const generation = getModelGenerationLabel(model.id);
    const label = `${vendor} · ${generation}`;
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(model);
  });

  return Array.from(groups, ([label, items]) => ({ label, models: items }));
}

export function flattenGroupedSupplierModels(models) {
  return groupSupplierModels(models).flatMap((group) => [
    { type: 'group', id: `group:${group.label}`, label: group.label },
    ...group.models.map((model) => ({ type: 'model', id: model.id, label: model.id })),
  ]);
}

export function settingsModal() {
  return {
    activeTab: 'editor',
    showAdvancedAgent: false,
    
    autoSaveEnabled: true,
    autoSaveInterval: 30,
    autoSaveIntervalInput: '30',
    includeV2Compat: true,

    agentShowActivityTrace: false,
    skillsEnabled: true,
    agentToolCallLimit: 50,
    agentToolCallLimitInput: '50',
    agentMaxValueChars: 80000,
    agentMaxValueCharsInput: '80000',
    agentSkillAutoMatchLimit: 3,
    agentSkillAutoMatchLimitInput: '3',
    agentDiffLayout: 'split',
    agentDiffWrap: true,
    agentDiffFold: true,

    apiUrl: '',
    apiKey: '',
    showApiKey: false,
    selectedModel: '',
    proxyEnabled: false,
    supplierProvider: DEFAULT_SUPPLIER_PROVIDER,
    supplierApi: DEFAULT_SUPPLIER_API,
    supplierTransport: DEFAULT_SUPPLIER_TRANSPORT,
    reasoningEnabled: false,
    showSupplierAdvanced: false,
    compatJson: '{}',
    compatJsonError: '',
    contextWindowInput: String(DEFAULT_CONTEXT_WINDOW),
    maxTokensInput: String(DEFAULT_MAX_TOKENS),
    temperature: 1.0,
    temperatureInput: '1.0',
    availableModels: [],
    modelFilter: '',
    connectionStatus: null,
    modelsStatus: null,
    connectionMessage: '',
    supplierApiOptions: SUPPLIER_API_OPTIONS,
    supplierTransportOptions: SUPPLIER_TRANSPORT_OPTIONS,
    supplierApiOpen: false,

    get currentSupplierApiLabel() {
      return this.supplierApiOptions.find((option) => option.value === this.supplierApi)?.label || this.supplierApi;
    },

    get currentSupplierTransportLabel() {
      return this.supplierTransportOptions.find((option) => option.value === this.supplierTransport)?.label || this.supplierTransport;
    },

    get groupedAvailableModels() {
      return groupSupplierModels(this.availableModels);
    },

    get modelSelectOptions() {
      return flattenGroupedSupplierModels(this.availableModels);
    },

    get filteredModelGroups() {
      const keyword = String(this.modelFilter || '').trim().toLowerCase();
      return this.groupedAvailableModels
        .map((group) => ({
          ...group,
          models: keyword
            ? group.models.filter((model) => model.id.toLowerCase().includes(keyword))
            : group.models,
        }))
        .filter((group) => group.models.length > 0);
    },

    syncSupplierDraftSoon() {
      this.$nextTick?.(() => {
        this.syncCurrentProviderToList();
      });
    },

    selectModel(modelId) {
      this.selectedModel = modelId;
      this.syncCurrentProviderToList();
    },

    providers: [],
    currentProviderId: null,
    editingProviderName: false,
    newProviderName: '',
    
    selectedAccent: 'teal',
    customHex: '',
    customHexError: '',
    customPickerOpen: false,
    customPickerHue: 260,
    customPickerSaturation: 56,
    customPickerValue: 100,
    customRgb: { r: 157, g: 111, b: 255 },
    accentPresets: ACCENT_PRESETS,

    localStorageUsageBytes: 0,
    localStorageKeyCount: 0,
    
    init() {
      this.loadFromStores();
    },
    
    loadFromStores() {
      const settings = Alpine.store('settings');
      const suppliers = Alpine.store('suppliers');
      
      this.autoSaveEnabled = settings.autoSaveEnabled;
      this.autoSaveInterval = settings.autoSaveInterval;
      this.autoSaveIntervalInput = String(settings.autoSaveInterval ?? 30);
      this.includeV2Compat = settings.includeV2Compat;
      
      this.agentShowActivityTrace = settings.agentShowActivityTrace ?? false;
      this.skillsEnabled = settings.skillsEnabled ?? true;
      this.agentToolCallLimit = settings.agentToolCallLimit ?? 50;
      this.agentToolCallLimitInput = String(settings.agentToolCallLimit ?? 50);
      this.agentMaxValueChars = settings.agentMaxValueChars ?? 80000;
      this.agentMaxValueCharsInput = String(settings.agentMaxValueChars ?? 80000);
      this.agentSkillAutoMatchLimit = settings.agentSkillAutoMatchLimit ?? 3;
      this.agentSkillAutoMatchLimitInput = String(settings.agentSkillAutoMatchLimit ?? 3);
      this.agentDiffLayout = settings.agentDiffLayout ?? 'split';
      this.agentDiffWrap = settings.agentDiffWrap ?? true;
      this.agentDiffFold = settings.agentDiffFold ?? true;
      
      this.selectedAccent = settings.accentColor || 'teal';
      this.customHex = settings.customAccentHex || '';
      this.syncCustomPickerFromHex(this.customColorPickerValue);

      this.providers = (suppliers.providers || []).map((provider, index) => normalizeSupplierConfig({
        id: provider?.id || `provider_${index + 1}`,
        name: provider?.name || `供应商 ${index + 1}`,
        ...provider,
      }));
      this.currentProviderId = suppliers.currentProviderId;
      this.applySupplierToForm(suppliers.getCurrentProvider?.() || suppliers.getConfig?.() || suppliers);
      this.connectionStatus = null;
      this.connectionMessage = '';
      this.refreshLocalStorageUsage();
    },
    
    
    selectPreset(presetId) {
      this.selectedAccent = presetId;
      this.customHex = '';
      this.customHexError = '';
      Alpine.store('settings').setAccent(presetId);
    },
    
    get customColorPickerValue() {
      const normalized = normalizeHex(this.customHex);
      return isValidHex(normalized) ? normalized : ACCENT_PRESETS.fuji.shades[500];
    },

    get customPickerHueColor() {
      return hsvToHex(this.customPickerHue, 100, 100);
    },

    get customPickerPanelStyle() {
      return {
        background: `linear-gradient(to top, rgb(0 0 0), transparent), linear-gradient(to right, rgb(255 255 255), ${this.customPickerHueColor})`,
      };
    },

    get customPickerCursorStyle() {
      return {
        left: `${this.customPickerSaturation}%`,
        top: `${100 - this.customPickerValue}%`,
        backgroundColor: this.customColorPickerValue,
      };
    },

    get customPickerHueStyle() {
      return { left: `${(this.customPickerHue / 360) * 100}%` };
    },

    toggleCustomPicker() {
      this.customPickerOpen = !this.customPickerOpen;
      if (this.customPickerOpen) {
        this.syncCustomPickerFromHex(this.customColorPickerValue);
      }
    },

    closeCustomPicker() {
      this.customPickerOpen = false;
    },

    syncCustomPickerFromHex(hexValue) {
      const normalized = normalizeHex(hexValue);
      if (!isValidHex(normalized)) return;

      const hsv = hexToHsv(normalized);
      const rgb = hexToRgb(normalized);
      this.customPickerHue = hsv.h;
      this.customPickerSaturation = hsv.s;
      this.customPickerValue = hsv.v;
      this.customRgb = rgb;
    },

    applyCustomHex(hexValue, syncPicker = true) {
      const normalized = normalizeHex(hexValue);
      if (!isValidHex(normalized)) {
        this.customHexError = '请输入有效的十六进制颜色码 (#RRGGBB)';
        return;
      }

      this.customHexError = '';
      this.customHex = normalized;
      this.selectedAccent = 'custom';
      if (syncPicker) {
        this.syncCustomPickerFromHex(normalized);
      } else {
        this.customRgb = hexToRgb(normalized);
      }
      Alpine.store('settings').setAccent('custom', normalized);
    },

    applyCustomPickerColor() {
      this.applyCustomHex(
        hsvToHex(this.customPickerHue, this.customPickerSaturation, this.customPickerValue),
        false,
      );
    },

    updateCustomPanel(event, rect = event.currentTarget.getBoundingClientRect()) {
      this.customPickerSaturation = Math.round(clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100));
      this.customPickerValue = Math.round(clamp((1 - ((event.clientY - rect.top) / rect.height)) * 100, 0, 100));
      this.applyCustomPickerColor();
    },

    startCustomPanelDrag(event) {
      const rect = event.currentTarget.getBoundingClientRect();
      this.updateCustomPanel(event, rect);
      const move = (moveEvent) => this.updateCustomPanel(moveEvent, rect);
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop, { once: true });
    },

    updateCustomHue(event, rect = event.currentTarget.getBoundingClientRect()) {
      this.customPickerHue = Math.round(clamp(((event.clientX - rect.left) / rect.width) * 360, 0, 360));
      this.applyCustomPickerColor();
    },

    startCustomHueDrag(event) {
      const rect = event.currentTarget.getBoundingClientRect();
      this.updateCustomHue(event, rect);
      const move = (moveEvent) => this.updateCustomHue(moveEvent, rect);
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop, { once: true });
    },

    updateCustomRgb(channel, value) {
      const rgb = {
        ...this.customRgb,
        [channel]: clamp(Number.parseInt(value, 10) || 0, 0, 255),
      };
      this.applyCustomHex(rgbToHex(rgb.r, rgb.g, rgb.b));
    },

    validateCustomHex() {
      if (!this.customHex) {
        this.customHexError = '';
        return;
      }
      this.applyCustomHex(this.customHex);
    },

    get currentProviderName() {
      const provider = this.providers.find((item) => item.id === this.currentProviderId);
      return provider?.name || '未选择';
    },

    switchProvider(providerId) {
      if (!this.syncCurrentProviderToList()) return;

      const provider = this.providers.find((item) => item.id === providerId);
      if (!provider) return;

      this.currentProviderId = providerId;
      this.applySupplierToForm(provider);
      this.connectionStatus = null;
      this.connectionMessage = '';
    },

    addProvider() {
      const id = `provider_${Date.now()}`;
      const newProvider = normalizeSupplierConfig({
        id,
        name: `供应商 ${this.providers.length + 1}`,
        baseUrl: '',
        apiKey: '',
        model: '',
        useProxy: false,
        temperature: 1.0,
      });

      this.providers.push(newProvider);
      this.switchProvider(id);
    },

    removeProvider(providerId) {
      if (this.providers.length <= 1) {
        Alpine.store('toast').error('至少保留一个供应商配置');
        return;
      }

      const index = this.providers.findIndex((item) => item.id === providerId);
      if (index === -1) return;

      this.providers.splice(index, 1);

      if (this.currentProviderId === providerId) {
        this.switchProvider(this.providers[0].id);
      }
    },

    startRenameProvider() {
      const provider = this.providers.find((item) => item.id === this.currentProviderId);
      if (!provider) return;

      this.newProviderName = provider.name;
      this.editingProviderName = true;
    },

    finishRenameProvider() {
      if (this.newProviderName.trim()) {
        const provider = this.providers.find((item) => item.id === this.currentProviderId);
        if (provider) {
          provider.name = this.newProviderName.trim();
        }
      }

      this.editingProviderName = false;
      this.newProviderName = '';
    },

    syncCurrentProviderToList() {
      const provider = this.providers.find((item) => item.id === this.currentProviderId);
      if (!provider) return true;

      this.commitTemperature();
      const advanced = this.commitSupplierAdvancedInputs();
      if (!advanced) return false;

      provider.baseUrl = this.apiUrl;
      provider.apiKey = this.apiKey;
      provider.model = this.selectedModel;
      provider.provider = resolveSupplierProviderForApi(
        this.supplierApi || DEFAULT_SUPPLIER_API,
        this.supplierProvider,
      );
      provider.api = this.supplierApi || DEFAULT_SUPPLIER_API;
      provider.transport = this.supplierTransport || DEFAULT_SUPPLIER_TRANSPORT;
      provider.useProxy = provider.transport === 'arcamage-proxy';
      this.proxyEnabled = provider.useProxy;
      provider.compat = advanced.compat;
      provider.headers = provider.headers && typeof provider.headers === 'object' ? provider.headers : {};
      provider.reasoning = this.reasoningEnabled === true;
      provider.contextWindow = advanced.contextWindow;
      provider.maxTokens = advanced.maxTokens;
      provider.availableModels = normalizeSupplierModels(this.availableModels);
      provider.temperature = this.temperature;
      Object.assign(provider, normalizeSupplierConfig(provider));
      return true;
    },
    
    persistSuppliersToStore() {
      const suppliers = Alpine.store('suppliers');
      const currentProvider = normalizeSupplierConfig(
        this.providers.find((provider) => provider.id === this.currentProviderId) || {},
      );

      suppliers.providers = this.providers.map((provider) => normalizeSupplierConfig({ ...provider }));
      suppliers.currentProviderId = this.currentProviderId;
      suppliers.applyProvider(currentProvider);
      suppliers.syncCurrentProvider();
      localStorage.setItem(suppliers.storageKey, JSON.stringify({
        providers: suppliers.providers,
        currentProviderId: suppliers.currentProviderId,
      }));
    },

    async saveSettings() {
      this.commitAutoSaveInterval();
      this.commitAgentAdvancedInputs();
      if (!this.syncCurrentProviderToList()) {
        Alpine.store('toast').error('供应商高级配置格式有误');
        return;
      }

      const settings = Alpine.store('settings');
      const toast = Alpine.store('toast');

      if (this.selectedAccent === 'custom') {
        const normalized = normalizeHex(this.customHex);
        if (!isValidHex(normalized)) {
          this.customHexError = '请输入有效的十六进制颜色码 (#RRGGBB)';
          toast.error('请输入有效的自定义强调色');
          return;
        }
        this.customHex = normalized;
      }

      this.persistSuppliersToStore();

      settings.autoSaveEnabled = this.autoSaveEnabled;
      settings.autoSaveInterval = this.autoSaveInterval;
      settings.includeV2Compat = this.includeV2Compat;
      settings.agentShowActivityTrace = this.agentShowActivityTrace;
      settings.skillsEnabled = this.skillsEnabled;
      settings.agentToolCallLimit = this.agentToolCallLimit;
      settings.agentMaxValueChars = this.agentMaxValueChars;
      settings.agentSkillAutoMatchLimit = this.agentSkillAutoMatchLimit;
      settings.agentDiffLayout = this.agentDiffLayout;
      settings.agentDiffWrap = this.agentDiffWrap;
      settings.agentDiffFold = this.agentDiffFold;
      settings.setAccent(this.selectedAccent, this.customHex);
      settings.save();
      settings.applyAgentDiffSettings();

      toast.success('设置已保存');

      Alpine.store('modalStack').pop();
    },

    buildSupplierRequestConfig(overrides = {}) {
      this.commitTemperature();
      const advanced = this.commitSupplierAdvancedInputs();
      if (!advanced) {
        Alpine.store('toast').error('供应商高级配置格式有误');
        return null;
      }

      const currentProvider = this.providers.find((item) => item.id === this.currentProviderId) || {};
      return normalizeSupplierConfig({
        ...currentProvider,
        baseUrl: this.apiUrl,
        apiKey: this.apiKey,
        model: this.selectedModel,
        provider: resolveSupplierProviderForApi(
          this.supplierApi || DEFAULT_SUPPLIER_API,
          this.supplierProvider,
        ),
        api: this.supplierApi || DEFAULT_SUPPLIER_API,
        transport: this.supplierTransport || DEFAULT_SUPPLIER_TRANSPORT,
        useProxy: this.supplierTransport === 'arcamage-proxy',
        headers: currentProvider.headers || {},
        reasoning: this.reasoningEnabled === true,
        compat: advanced.compat,
        contextWindow: advanced.contextWindow,
        maxTokens: advanced.maxTokens,
        temperature: this.temperature,
        availableModels: this.availableModels,
        ...overrides,
      });
    },

    persistSupplierDraft() {
      if (!this.syncCurrentProviderToList()) return false;
      this.persistSuppliersToStore();
      return true;
    },

    async testConnection() {
      if (!this.apiUrl || !this.apiKey) {
        Alpine.store('toast').error('请填写 API 地址和 Key');
        return;
      }
      if (!this.selectedModel) {
        Alpine.store('toast').error('请选择模型');
        return;
      }

      const supplier = this.buildSupplierRequestConfig();
      if (!supplier) return;

      this.connectionStatus = 'testing';
      this.connectionMessage = '正在发送测试消息...';

      try {
        const turn = await requestAssistantTurn({
          supplier,
          messages: [
            {
              role: 'user',
              content: '请只回复“连接成功”。这是 Arcamage 的供应商连接测试。',
            },
          ],
          tools: undefined,
        });

        this.connectionStatus = 'success';
        const text = String(turn?.text || '').trim();
        this.connectionMessage = text ? `连接成功：${text.slice(0, 40)}` : '连接成功';
      } catch (error) {
        this.connectionStatus = 'error';
        this.connectionMessage = error?.getUserMessage ? error.getUserMessage() : (error?.message || '连接失败');
      }
    },

    async loadModels() {
      if (!this.apiUrl || !this.apiKey) {
        Alpine.store('toast').error('请填写 API 地址和 Key');
        return;
      }

      const supplier = this.buildSupplierRequestConfig();
      if (!supplier) return;

      this.modelsStatus = 'loading';
      this.connectionMessage = '正在获取模型列表...';

      try {
        const models = normalizeSupplierModels(await getSupplierModels(supplier));
        this.availableModels = models;

        if (!this.selectedModel && models.length > 0) {
          this.selectedModel = models[0].id;
        }
        this.syncCurrentProviderToList();

        this.modelsStatus = 'success';
        this.connectionStatus = 'success';
        this.connectionMessage = models.length > 0
          ? `已获取 ${models.length} 个模型`
          : '模型列表为空';
        this.persistSupplierDraft();
      } catch (error) {
        this.modelsStatus = 'error';
        this.connectionStatus = 'error';
        this.connectionMessage = error?.getUserMessage ? error.getUserMessage() : '获取模型失败';
      }
    },

    commitAutoSaveInterval() {
      if (this.autoSaveIntervalInput === '' || this.autoSaveIntervalInput === null || this.autoSaveIntervalInput === undefined) {
        this.autoSaveIntervalInput = String(this.autoSaveInterval ?? 30);
        return;
      }

      const parsed = Number(this.autoSaveIntervalInput);
      if (Number.isNaN(parsed)) {
        this.autoSaveIntervalInput = String(this.autoSaveInterval ?? 30);
        return;
      }

      const clamped = Math.min(300, Math.max(5, parsed));
      this.autoSaveInterval = clamped;
      this.autoSaveIntervalInput = String(clamped);
    },

    commitAgentAdvancedInputs() {
      const toolLimit = Number(this.agentToolCallLimitInput);
      if (Number.isFinite(toolLimit)) {
        this.agentToolCallLimit = Math.min(200, Math.max(10, Math.round(toolLimit)));
      }
      this.agentToolCallLimitInput = String(this.agentToolCallLimit);

      const valueChars = Number(this.agentMaxValueCharsInput);
      if (Number.isFinite(valueChars)) {
        this.agentMaxValueChars = Math.min(500000, Math.max(10000, Math.round(valueChars)));
      }
      this.agentMaxValueCharsInput = String(this.agentMaxValueChars);

      const skillLimit = Number(this.agentSkillAutoMatchLimitInput);
      if (Number.isFinite(skillLimit)) {
        this.agentSkillAutoMatchLimit = Math.min(10, Math.max(0, Math.round(skillLimit)));
      }
      this.agentSkillAutoMatchLimitInput = String(this.agentSkillAutoMatchLimit);
    },

    normalizeTemperature(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return 1.0;
      }
      const clamped = Math.min(2, Math.max(0, numeric));
      return Number(clamped.toFixed(1));
    },

    commitTemperature() {
      if (this.temperatureInput === '' || this.temperatureInput === null || this.temperatureInput === undefined) {
        this.temperatureInput = this.temperature.toFixed(1);
        return;
      }

      const normalized = this.normalizeTemperature(this.temperatureInput);
      this.temperature = normalized;
      this.temperatureInput = normalized.toFixed(1);
    },

    applySupplierToForm(provider) {
      const normalized = normalizeSupplierConfig(provider || {});
      this.apiUrl = normalized.baseUrl || '';
      this.apiKey = normalized.apiKey || '';
      this.selectedModel = normalized.model || '';
      this.supplierProvider = normalized.provider;
      this.supplierApi = normalized.api;
      this.supplierTransport = normalized.transport;
      this.proxyEnabled = normalized.transport === 'arcamage-proxy';
      this.reasoningEnabled = normalized.reasoning === true;
      this.compatJson = formatJsonObject(normalized.compat);
      this.compatJsonError = '';
      this.contextWindowInput = String(normalized.contextWindow);
      this.maxTokensInput = String(normalized.maxTokens);
      this.temperature = this.normalizeTemperature(normalized.temperature);
      this.temperatureInput = this.temperature.toFixed(1);
      this.availableModels = normalizeSupplierModels(normalized.availableModels);
    },

    changeSupplierApi(value = this.supplierApi) {
      this.supplierApi = value || DEFAULT_SUPPLIER_API;
      this.supplierProvider = resolveSupplierProviderForApi(this.supplierApi, this.supplierProvider);
      this.syncCurrentProviderToList();
    },

    selectSupplierApi(value) {
      this.changeSupplierApi(value);
      this.supplierApiOpen = false;
    },

    changeSupplierTransport(value = this.supplierTransport) {
      this.supplierTransport = value || DEFAULT_SUPPLIER_TRANSPORT;
      this.proxyEnabled = this.supplierTransport === 'arcamage-proxy';
      this.syncCurrentProviderToList();
    },

    selectSupplierTransport(value) {
      this.changeSupplierTransport(value);
    },

    parseCompatJson() {
      const text = String(this.compatJson || '').trim();
      if (!text) {
        this.compatJsonError = '';
        this.compatJson = '{}';
        return {};
      }

      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          this.compatJsonError = 'Compat 必须是 JSON 对象';
          return null;
        }
        this.compatJsonError = '';
        this.compatJson = formatJsonObject(parsed);
        return parsed;
      } catch (error) {
        this.compatJsonError = 'Compat JSON 格式无效';
        return null;
      }
    },

    normalizeIntegerRangeInput(value, fallback, min, max) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return fallback;
      return Math.min(max, Math.max(min, Math.floor(numeric)));
    },

    commitSupplierAdvancedInputs() {
      const compat = this.parseCompatJson();
      if (compat === null) return null;

      const contextWindow = this.normalizeIntegerRangeInput(
        this.contextWindowInput,
        DEFAULT_CONTEXT_WINDOW,
        MIN_CONTEXT_WINDOW,
        MAX_CONTEXT_WINDOW,
      );
      const maxTokens = this.normalizeIntegerRangeInput(
        this.maxTokensInput,
        DEFAULT_MAX_TOKENS,
        MIN_MAX_TOKENS,
        MAX_MAX_TOKENS,
      );

      this.contextWindowInput = String(contextWindow);
      this.maxTokensInput = String(maxTokens);

      return { compat, contextWindow, maxTokens };
    },

    refreshLocalStorageUsage() {
      try {
        let usageBytes = 0;
        let keyCount = 0;

        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (!key) continue;

          const value = localStorage.getItem(key) ?? '';
          usageBytes += (key.length + value.length) * 2;
          keyCount += 1;
        }

        this.localStorageUsageBytes = usageBytes;
        this.localStorageKeyCount = keyCount;
      } catch (error) {
        this.localStorageUsageBytes = 0;
        this.localStorageKeyCount = 0;
      }
    },

    formatStorageBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    },

    async clearLocalStorage() {
      const confirmed = await confirm(
        '清空本地存储',
        '确定要清空当前网页的本地存储吗？此操作不可撤销。',
        {
          type: 'danger',
          confirmText: '确认清空',
          cancelText: '取消',
        },
      );
      if (!confirmed) return;

      try {
        localStorage.clear();
        this.refreshLocalStorageUsage();
        Alpine.store('toast').success('本地存储已清空（刷新页面后将使用默认设置）');
      } catch (error) {
        Alpine.store('toast').error('清空本地存储失败');
      }
    },
    
    
    isActive(tab) {
      return this.activeTab === tab;
    },
    
    setTab(tab) {
      this.activeTab = tab;
      if (tab === 'editor') {
        this.refreshLocalStorageUsage();
      }
    }
  };
}

export function registerSettingsModalComponent() {
  Alpine.data('settingsModal', settingsModal);
}

export function openSettingsModal() {
  Alpine.store('modalStack').push({
    type: 'settings',
    title: '设置',
    size: 'xl',
    data: {},
    closeable: true,
    showFooter: false
  });
}
