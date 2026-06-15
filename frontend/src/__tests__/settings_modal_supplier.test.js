import { describe, expect, it, beforeEach, vi } from 'vitest';
import Alpine from 'alpinejs';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  getSupplierModels: vi.fn(),
  requestAssistantTurn: vi.fn(),
}));

vi.mock('../components/modal.js', () => ({
  confirm: (...args) => mocks.confirm(...args),
}));

vi.mock('../api.js', () => ({
  getSupplierModels: (...args) => mocks.getSupplierModels(...args),
}));

vi.mock('../agent/llm/client.js', () => ({
  requestAssistantTurn: (...args) => mocks.requestAssistantTurn(...args),
}));

import { initStores } from '../store.js';
import { flattenGroupedSupplierModels, groupSupplierModels, settingsModal } from '../components/settings_modal.js';

describe('settings modal supplier logic', () => {
  beforeEach(() => {
    localStorage.clear();
    initStores();
    Alpine.store('suppliers').load();
    Alpine.store('modalStack', { pop: vi.fn() });
    Alpine.store('toast').success = vi.fn();
    Alpine.store('toast').error = vi.fn();
    mocks.confirm.mockReset();
    mocks.getSupplierModels.mockReset();
    mocks.requestAssistantTurn.mockReset();
  });

  it('loads supplier settings and saves back to store', async () => {
    const modal = settingsModal();
    modal.loadFromStores();

    modal.apiUrl = 'https://api.example.com';
    modal.apiKey = 'sk-test';
    modal.selectedModel = 'model-x';
    modal.supplierTransport = 'arcamage-proxy';
    modal.temperatureInput = '1.3';
    modal.commitTemperature();
    modal.commitAutoSaveInterval();

    await modal.saveSettings();

    const suppliers = Alpine.store('suppliers');
    const current = suppliers.getCurrentProvider();

    expect(current?.baseUrl).toBe('https://api.example.com');
    expect(current?.apiKey).toBe('sk-test');
    expect(current?.model).toBe('model-x');
    expect(current?.useProxy).toBe(true);
    expect(current?.transport).toBe('arcamage-proxy');
    expect(current?.temperature).toBe(1.3);
  });

  it('saves SupplierConfigV2 fields from the settings modal', async () => {
    const modal = settingsModal();
    modal.loadFromStores();

    modal.apiUrl = 'https://api.anthropic.com';
    modal.apiKey = 'sk-ant-test';
    modal.selectedModel = 'claude-test';
    modal.supplierProvider = 'anthropic';
    modal.supplierApi = 'anthropic-messages';
    modal.supplierTransport = 'arcamage-proxy';
    modal.reasoningEnabled = true;
    modal.compatJson = '{"cacheSystemPrompt":true}';
    modal.contextWindowInput = '200000';
    modal.maxTokensInput = '8192';

    await modal.saveSettings();

    const current = Alpine.store('suppliers').getCurrentProvider();
    expect(current).toMatchObject({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
      model: 'claude-test',
      provider: 'anthropic',
      api: 'anthropic-messages',
      transport: 'arcamage-proxy',
      useProxy: true,
      reasoning: true,
      compat: { cacheSystemPrompt: true },
      contextWindow: 200000,
      maxTokens: 8192,
    });

    Alpine.store('suppliers').load();
    const reopened = settingsModal();
    reopened.loadFromStores();

    expect(reopened.selectedModel).toBe('claude-test');
    expect(reopened.supplierApi).toBe('anthropic-messages');
    expect(reopened.supplierTransport).toBe('arcamage-proxy');
  });

  it('does not expose the removed legacy OpenAI proxy transport', () => {
    const modal = settingsModal();
    modal.loadFromStores();

    expect(modal.supplierTransportOptions.map((item) => item.value)).toEqual([
      'direct',
      'arcamage-proxy',
    ]);
  });

  it('saves the selected transport instead of stale proxy state', async () => {
    const modal = settingsModal();
    modal.loadFromStores();

    modal.proxyEnabled = true;
    modal.supplierTransport = 'direct';

    await modal.saveSettings();

    const current = Alpine.store('suppliers').getCurrentProvider();
    expect(current?.transport).toBe('direct');
    expect(current?.useProxy).toBe(false);
  });

  it('syncs supplier draft when protocol, transport and model are selected', () => {
    const modal = settingsModal();
    modal.loadFromStores();
    modal.$nextTick = (callback) => callback();

    modal.selectSupplierApi('anthropic-messages');
    modal.selectSupplierTransport('arcamage-proxy');
    modal.selectModel('claude-test');

    const current = modal.providers.find((provider) => provider.id === modal.currentProviderId);
    expect(current).toMatchObject({
      api: 'anthropic-messages',
      provider: 'anthropic',
      transport: 'arcamage-proxy',
      model: 'claude-test',
    });
  });

  it('groups available models by vendor and generation', () => {
    const models = [
      { id: 'claude-opus-4-8-reverse' },
      { id: 'claude-opus-4-6-free' },
      { id: 'gpt-5.5-fast' },
      { id: 'deepseek-v4-flash' },
      { id: 'custom-model' },
    ];
    const groups = groupSupplierModels(models);

    expect(groups).toEqual([
      { label: 'Claude · 4 系列', models: [{ id: 'claude-opus-4-8-reverse' }, { id: 'claude-opus-4-6-free' }] },
      { label: 'OpenAI / GPT · 5 系列', models: [{ id: 'gpt-5.5-fast' }] },
      { label: 'DeepSeek · 4 系列', models: [{ id: 'deepseek-v4-flash' }] },
      { label: '其他模型 · 其他系列', models: [{ id: 'custom-model' }] },
    ]);
    expect(flattenGroupedSupplierModels(models).slice(0, 3)).toEqual([
      { type: 'group', id: 'group:Claude · 4 系列', label: 'Claude · 4 系列' },
      { type: 'model', id: 'claude-opus-4-8-reverse', label: 'claude-opus-4-8-reverse' },
      { type: 'model', id: 'claude-opus-4-6-free', label: 'claude-opus-4-6-free' },
    ]);
  });

  it('derives supplier provider from the selected protocol', async () => {
    const modal = settingsModal();
    modal.loadFromStores();

    modal.supplierProvider = 'openrouter';
    modal.supplierApi = 'anthropic-messages';
    modal.changeSupplierApi();

    expect(modal.supplierProvider).toBe('anthropic');

    await modal.saveSettings();

    const current = Alpine.store('suppliers').getCurrentProvider();
    expect(current?.provider).toBe('anthropic');
    expect(current?.api).toBe('anthropic-messages');
  });

  it('does not expose a separate supplier provider selector', () => {
    const modal = settingsModal();
    modal.loadFromStores();

    expect(modal.supplierProviderOptions).toBeUndefined();
  });


  it('does not save invalid compat JSON', async () => {
    const modal = settingsModal();
    modal.loadFromStores();
    modal.compatJson = '{invalid';

    await modal.saveSettings();

    expect(modal.compatJsonError).toBe('Compat JSON 格式无效');
    expect(Alpine.store('toast').error).toHaveBeenCalledWith('供应商高级配置格式有误');
    expect(Alpine.store('modalStack').pop).not.toHaveBeenCalled();
  });

  it('loads cached model list from the current supplier and saves refreshed results', async () => {
    const suppliers = Alpine.store('suppliers');
    const current = suppliers.getCurrentProvider();
    current.availableModels = [{ id: 'cached-model' }];

    const modal = settingsModal();
    modal.loadFromStores();

    expect(modal.availableModels).toEqual([{ id: 'cached-model' }]);

    modal.apiUrl = 'https://api.example.com';
    modal.apiKey = 'sk-test';
    modal.supplierTransport = 'arcamage-proxy';
    mocks.getSupplierModels.mockResolvedValue([{ id: 'fresh-model' }]);

    await modal.loadModels();

    expect(mocks.getSupplierModels).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      transport: 'arcamage-proxy',
    }));
    expect(modal.availableModels).toEqual([{ id: 'fresh-model' }]);
    expect(modal.selectedModel).toBe('fresh-model');
    expect(Alpine.store('suppliers').getCurrentProvider()?.availableModels).toEqual([{ id: 'fresh-model' }]);
  });

  it('tests the selected model with an assistant message', async () => {
    const modal = settingsModal();
    modal.loadFromStores();

    modal.apiUrl = 'https://api.example.com';
    modal.apiKey = 'sk-test';
    modal.selectedModel = 'model-x';
    modal.supplierApi = 'openai-completions';
    modal.supplierTransport = 'direct';
    mocks.requestAssistantTurn.mockResolvedValue({ text: '连接成功' });

    await modal.testConnection();

    expect(mocks.requestAssistantTurn).toHaveBeenCalledWith(expect.objectContaining({
      supplier: expect.objectContaining({
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-test',
        model: 'model-x',
        transport: 'direct',
      }),
      messages: [expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('供应商连接测试'),
      })],
      tools: undefined,
    }));
    expect(modal.connectionStatus).toBe('success');
    expect(modal.connectionMessage).toContain('连接成功');
  });


  it('calculates localStorage usage and key count', () => {
    localStorage.setItem('foo', 'bar');
    localStorage.setItem('baz', 'qux');

    const modal = settingsModal();
    modal.loadFromStores();

    expect(modal.localStorageKeyCount).toBe(2);
    expect(modal.localStorageUsageBytes).toBe((3 + 3) * 2 + (3 + 3) * 2);
    expect(modal.formatStorageBytes(modal.localStorageUsageBytes)).toBe('24 B');
  });

  it('does not clear localStorage when user cancels confirmation', async () => {
    localStorage.setItem('foo', 'bar');
    mocks.confirm.mockResolvedValue(false);

    const modal = settingsModal();
    modal.loadFromStores();
    await modal.clearLocalStorage();

    expect(localStorage.getItem('foo')).toBe('bar');
    expect(Alpine.store('toast').success).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalled();
  });

  it('clears localStorage and refreshes usage when confirmed', async () => {
    localStorage.setItem('foo', 'bar');
    localStorage.setItem('bar', 'baz');
    mocks.confirm.mockResolvedValue(true);

    const modal = settingsModal();
    modal.loadFromStores();
    await modal.clearLocalStorage();

    expect(localStorage.length).toBe(0);
    expect(modal.localStorageKeyCount).toBe(0);
    expect(modal.localStorageUsageBytes).toBe(0);
    expect(Alpine.store('toast').success).toHaveBeenCalledWith('本地存储已清空（刷新页面后将使用默认设置）');
  });
});
