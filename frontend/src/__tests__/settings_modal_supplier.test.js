import { describe, expect, it, beforeEach, vi } from 'vitest';
import Alpine from 'alpinejs';

const confirmMock = vi.fn();

vi.mock('../components/modal.js', () => ({
  confirm: (...args) => confirmMock(...args),
}));

import { initStores } from '../store.js';
import { settingsModal } from '../components/settings_modal.js';

describe('settings modal supplier logic', () => {
  beforeEach(() => {
    localStorage.clear();
    initStores();
    Alpine.store('suppliers').load();
    Alpine.store('modalStack', { pop: vi.fn() });
    Alpine.store('toast').success = vi.fn();
    Alpine.store('toast').error = vi.fn();
    confirmMock.mockReset();
  });

  it('loads supplier settings and saves back to store', async () => {
    const modal = settingsModal();
    modal.loadFromStores();

    modal.apiUrl = 'https://api.example.com';
    modal.apiKey = 'sk-test';
    modal.selectedModel = 'model-x';
    modal.proxyEnabled = true;
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
    expect(current?.temperature).toBe(1.3);
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
    confirmMock.mockResolvedValue(false);

    const modal = settingsModal();
    modal.loadFromStores();
    await modal.clearLocalStorage();

    expect(localStorage.getItem('foo')).toBe('bar');
    expect(Alpine.store('toast').success).not.toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalled();
  });

  it('clears localStorage and refreshes usage when confirmed', async () => {
    localStorage.setItem('foo', 'bar');
    localStorage.setItem('bar', 'baz');
    confirmMock.mockResolvedValue(true);

    const modal = settingsModal();
    modal.loadFromStores();
    await modal.clearLocalStorage();

    expect(localStorage.length).toBe(0);
    expect(modal.localStorageKeyCount).toBe(0);
    expect(modal.localStorageUsageBytes).toBe(0);
    expect(Alpine.store('toast').success).toHaveBeenCalledWith('本地存储已清空（刷新页面后将使用默认设置）');
  });
});
