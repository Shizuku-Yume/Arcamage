import { beforeEach, describe, expect, it, vi } from 'vitest';
import Alpine from 'alpinejs';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
}));

vi.mock('../components/modal.js', () => ({
  confirm: (...args) => mocks.confirm(...args),
}));

import { initModalStackStore } from '../stores/modal_stack.js';

describe('modal stack unsaved guard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Alpine.store('modal', { isOpen: false });
    initModalStackStore();
    mocks.confirm.mockReset();
  });

  it('closes clean modals without prompting', async () => {
    const onCancel = vi.fn();
    Alpine.store('modalStack').push({
      type: 'text',
      data: { value: 'old' },
      onCancel,
    });

    await Alpine.store('modalStack').cancelAndClose();

    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(Alpine.store('modalStack').stack).toHaveLength(0);
  });

  it('discards dirty modals when user abandons editing', async () => {
    const onSave = vi.fn();
    mocks.confirm.mockResolvedValue(false);
    Alpine.store('modalStack').push({
      type: 'text',
      data: { value: 'old' },
      onSave,
    });
    Alpine.store('modalStack').current.dirty = true;

    await Alpine.store('modalStack').cancelAndClose();

    expect(mocks.confirm).toHaveBeenCalledWith(
      '有未保存的编辑内容',
      '当前编辑内容尚未保存。是否保存后退出？',
      expect.objectContaining({ confirmText: '保存后退出', cancelText: '放弃编辑' }),
    );
    expect(onSave).not.toHaveBeenCalled();
    expect(Alpine.store('modalStack').stack).toHaveLength(0);
  });

  it('saves dirty modals before closing when confirmed', async () => {
    const onSave = vi.fn();
    mocks.confirm.mockResolvedValue(true);
    Alpine.store('modalStack').push({
      type: 'text',
      data: { value: 'old' },
      draft: { value: 'new' },
      onSave,
    });
    Alpine.store('modalStack').current.dirty = true;

    await Alpine.store('modalStack').handleEscape();

    expect(onSave).toHaveBeenCalledWith({ value: 'new' });
    expect(Alpine.store('modalStack').stack).toHaveLength(0);
  });

  it('waits for request-save hooks and stays open on validation failure', async () => {
    const onRequestSave = vi.fn().mockResolvedValue(false);
    Alpine.store('modalStack').push({
      type: 'skill-manager',
      data: {},
      onRequestSave,
    });
    Alpine.store('modalStack').current.dirty = true;

    await Alpine.store('modalStack').saveAndClose();

    expect(onRequestSave).toHaveBeenCalled();
    expect(Alpine.store('modalStack').stack).toHaveLength(1);
  });
});
