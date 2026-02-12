
import Alpine from 'alpinejs';
import { ACCENT_PRESETS, isValidHex, normalizeHex } from '../utils/accent_colors.js';
import { getSupplierModels, testSupplierConnection } from '../api.js';
import { confirm } from './modal.js';

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
    temperature: 1.0,
    temperatureInput: '1.0',
    availableModels: [],
    connectionStatus: null,
    connectionMessage: '',

    providers: [],
    currentProviderId: null,
    editingProviderName: false,
    newProviderName: '',
    
    selectedAccent: 'teal',
    customHex: '',
    customHexError: '',
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

      this.providers = (suppliers.providers || []).map((provider) => ({ ...provider }));
      this.currentProviderId = suppliers.currentProviderId;
      this.apiUrl = suppliers.baseUrl || '';
      this.apiKey = suppliers.apiKey || '';
      this.selectedModel = suppliers.model || '';
      this.proxyEnabled = suppliers.useProxy ?? false;
      this.temperature = this.normalizeTemperature(suppliers.temperature);
      this.temperatureInput = this.temperature.toFixed(1);
      this.availableModels = [];
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
    
    validateCustomHex() {
      if (!this.customHex) {
        this.customHexError = '';
        return;
      }
      const normalized = normalizeHex(this.customHex);
      if (!isValidHex(normalized)) {
        this.customHexError = '请输入有效的十六进制颜色码 (#RRGGBB)';
      } else {
        this.customHexError = '';
        this.customHex = normalized;
        this.selectedAccent = 'custom';
        Alpine.store('settings').setAccent('custom', normalized);
      }
    },

    get currentProviderName() {
      const provider = this.providers.find((item) => item.id === this.currentProviderId);
      return provider?.name || '未选择';
    },

    switchProvider(providerId) {
      this.syncCurrentProviderToList();

      const provider = this.providers.find((item) => item.id === providerId);
      if (!provider) return;

      this.currentProviderId = providerId;
      this.apiUrl = provider.baseUrl || '';
      this.apiKey = provider.apiKey || '';
      this.selectedModel = provider.model || '';
      this.proxyEnabled = provider.useProxy ?? false;
      this.temperature = this.normalizeTemperature(provider.temperature);
      this.temperatureInput = this.temperature.toFixed(1);
      this.availableModels = [];
      this.connectionStatus = null;
      this.connectionMessage = '';
    },

    addProvider() {
      const id = `provider_${Date.now()}`;
      const newProvider = {
        id,
        name: `供应商 ${this.providers.length + 1}`,
        baseUrl: '',
        apiKey: '',
        model: '',
        useProxy: false,
        temperature: 1.0,
      };

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
      if (!provider) return;

      this.commitTemperature();

      provider.baseUrl = this.apiUrl;
      provider.apiKey = this.apiKey;
      provider.model = this.selectedModel;
      provider.useProxy = this.proxyEnabled;
      provider.temperature = this.temperature;
    },
    
    async saveSettings() {
      this.commitAutoSaveInterval();
      this.commitAgentAdvancedInputs();
      this.syncCurrentProviderToList();

      const suppliers = Alpine.store('suppliers');
      const settings = Alpine.store('settings');
      const toast = Alpine.store('toast');

      suppliers.providers = this.providers.map((provider) => ({ ...provider }));
      suppliers.currentProviderId = this.currentProviderId;
      suppliers.baseUrl = this.apiUrl;
      suppliers.apiKey = this.apiKey;
      suppliers.model = this.selectedModel;
      suppliers.useProxy = this.proxyEnabled;
      suppliers.temperature = this.temperature;
      suppliers.save();

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

    async testConnection() {
      if (!this.apiUrl || !this.apiKey) {
        Alpine.store('toast').error('请填写 API 地址和 Key');
        return;
      }

      this.connectionStatus = 'testing';
      this.connectionMessage = '正在连接...';

      try {
        const result = await testSupplierConnection({
          baseUrl: this.apiUrl,
          apiKey: this.apiKey,
          useProxy: this.proxyEnabled,
          model: this.selectedModel,
        });

        if (result.success) {
          this.connectionStatus = 'success';
          this.connectionMessage = result.message || '连接成功';
          this.availableModels = result.models || [];

          if (!this.selectedModel && this.availableModels.length > 0) {
            this.selectedModel = this.availableModels[0].id;
          }
        } else {
          this.connectionStatus = 'error';
          this.connectionMessage = result.message || '连接失败';
        }
      } catch (error) {
        this.connectionStatus = 'error';
        this.connectionMessage = error?.getUserMessage ? error.getUserMessage() : '连接失败';
      }
    },

    async loadModels() {
      if (!this.apiUrl || !this.apiKey) return;

      try {
        this.availableModels = await getSupplierModels({
          baseUrl: this.apiUrl,
          apiKey: this.apiKey,
          useProxy: this.proxyEnabled,
        });
      } catch (error) {
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
