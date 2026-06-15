import { beforeEach, describe, expect, it } from 'vitest';
import Alpine from 'alpinejs';

import { initStores } from '../store.js';

describe('suppliers store migration', () => {
  beforeEach(() => {
    localStorage.clear();
    initStores();
  });

  it('fills SupplierConfigV2 fields for old localStorage providers', () => {
    localStorage.setItem('arcamage_supplier_settings', JSON.stringify({
      currentProviderId: 'legacy_provider',
      providers: [{
        id: 'legacy_provider',
        name: 'Legacy Provider',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-test',
        model: 'model-x',
        useProxy: true,
        temperature: 1.2,
      }],
    }));

    const suppliers = Alpine.store('suppliers');
    suppliers.load();

    expect(suppliers.currentProviderId).toBe('legacy_provider');
    expect(suppliers.baseUrl).toBe('https://api.example.com');
    expect(suppliers.apiKey).toBe('sk-test');
    expect(suppliers.model).toBe('model-x');
    expect(suppliers.useProxy).toBe(true);
    expect(suppliers.transport).toBe('arcamage-proxy');
    expect(suppliers.provider).toBe('openai-compatible');
    expect(suppliers.api).toBe('openai-completions');
    expect(suppliers.compat).toEqual({ supportsDeveloperRole: false });
    expect(suppliers.headers).toEqual({});
    expect(suppliers.contextWindow).toBe(128000);
    expect(suppliers.maxTokens).toBe(4096);

    suppliers.save();
    const saved = JSON.parse(localStorage.getItem('arcamage_supplier_settings'));
    expect(saved.providers[0]).toMatchObject({
      id: 'legacy_provider',
      name: 'Legacy Provider',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'model-x',
      useProxy: true,
      transport: 'arcamage-proxy',
      provider: 'openai-compatible',
      api: 'openai-completions',
    });
  });
});
