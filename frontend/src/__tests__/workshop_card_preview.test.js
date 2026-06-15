import { beforeEach, describe, expect, it, vi } from 'vitest';
import Alpine from 'alpinejs';

import { initStores } from '../store.js';
import { workshopPage } from '../pages/workshop.js';

function mockMatchMedia(matches) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(min-width: 1024px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('workshop card preview entry', () => {
  beforeEach(() => {
    initStores();
  });

  it('opens the card preview sidebar on desktop', () => {
    mockMatchMedia(true);
    const page = workshopPage();

    page.openCardPreviewSidebar();

    expect(Alpine.store('agent').ui.sidebarMode).toBe('cardPreview');
    expect(Alpine.store('agent').ui.isOpen).toBe(true);
    expect(Alpine.store('agent').ui.isFullscreen).toBe(false);
    expect(Alpine.store('agent').ui.diffPanelOpen).toBe(false);
  });

  it('opens the card preview fullscreen view on mobile', () => {
    mockMatchMedia(false);
    const page = workshopPage();

    page.openCardPreviewSidebar();

    expect(Alpine.store('agent').ui.sidebarMode).toBe('cardPreview');
    expect(Alpine.store('agent').ui.isOpen).toBe(false);
    expect(Alpine.store('agent').ui.isFullscreen).toBe(true);
    expect(Alpine.store('agent').ui.diffPanelOpen).toBe(false);
  });
});
