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
    expect(suppliers.temperature).toBe(1.4);
  });
});
