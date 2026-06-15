import { describe, expect, it, beforeEach } from 'vitest';
import Alpine from 'alpinejs';

import { initStores } from '../store.js';

describe('suppliers store', () => {
  beforeEach(() => {
    localStorage.clear();
    initStores();
  });

  it('initializes with a default provider', () => {
    const suppliers = Alpine.store('suppliers');
    suppliers.load();

    expect(suppliers.providers.length).toBe(1);
    expect(suppliers.currentProviderId).toBeTruthy();
    expect(suppliers.baseUrl).toBe('');
    expect(suppliers.useProxy).toBe(false);
    expect(suppliers.provider).toBe('openai-compatible');
    expect(suppliers.api).toBe('openai-completions');
    expect(suppliers.transport).toBe('direct');
    expect(suppliers.temperature).toBe(1.0);
  });

  it('saves and restores provider settings', () => {
    const suppliers = Alpine.store('suppliers');
    suppliers.load();

    const newId = suppliers.addProvider('测试供应商');
    suppliers.switchProvider(newId);
    suppliers.baseUrl = 'https://api.example.com';
    suppliers.apiKey = 'sk-test';
    suppliers.model = 'model-x';
    suppliers.useProxy = true;
    suppliers.temperature = 1.4;
    suppliers.save();

    suppliers.baseUrl = '';
    suppliers.apiKey = '';
    suppliers.model = '';
    suppliers.useProxy = false;
    suppliers.temperature = 0;
    suppliers.load();

    expect(suppliers.currentProviderId).toBe(newId);
    expect(suppliers.baseUrl).toBe('https://api.example.com');
    expect(suppliers.apiKey).toBe('sk-test');
    expect(suppliers.model).toBe('model-x');
    expect(suppliers.useProxy).toBe(true);
    expect(suppliers.provider).toBe('openai-compatible');
    expect(suppliers.api).toBe('openai-completions');
    expect(suppliers.transport).toBe('arcamage-proxy');
    expect(suppliers.temperature).toBe(1.4);

    suppliers.availableModels = [{ id: 'model-x' }, { id: 'model-y' }];
    suppliers.save();
    suppliers.load();

    expect(suppliers.availableModels).toEqual([{ id: 'model-x' }, { id: 'model-y' }]);
    expect(suppliers.getCurrentProvider()?.availableModels).toEqual([{ id: 'model-x' }, { id: 'model-y' }]);
  });

  it('preserves explicit non-legacy transport settings', () => {
    const suppliers = Alpine.store('suppliers');
    suppliers.load();

    suppliers.baseUrl = 'https://api.anthropic.com';
    suppliers.apiKey = 'sk-test';
    suppliers.model = 'claude-test';
    suppliers.provider = 'anthropic';
    suppliers.api = 'anthropic-messages';
    suppliers.transport = 'arcamage-proxy';
    suppliers.useProxy = false;
    suppliers.reasoning = true;
    suppliers.compat = { cacheSystemPrompt: true };
    suppliers.contextWindow = 200000;
    suppliers.maxTokens = 8192;
    suppliers.save();
    suppliers.load();

    expect(suppliers.provider).toBe('anthropic');
    expect(suppliers.api).toBe('anthropic-messages');
    expect(suppliers.transport).toBe('arcamage-proxy');
    expect(suppliers.useProxy).toBe(true);
    expect(suppliers.reasoning).toBe(true);
    expect(suppliers.compat).toEqual({ cacheSystemPrompt: true });
    expect(suppliers.contextWindow).toBe(200000);
    expect(suppliers.maxTokens).toBe(8192);

    suppliers.transport = 'direct';
    suppliers.useProxy = true;
    suppliers.save();
    suppliers.load();

    expect(suppliers.transport).toBe('direct');
    expect(suppliers.useProxy).toBe(false);
  });
});
