import { beforeEach, describe, expect, it, vi } from 'vitest';
import Alpine from 'alpinejs';

vi.mock('../components/card_preview_runtime.js', () => {
  const runtime = {
    ensureGreeting: vi.fn(),
    restartConversation: vi.fn(),
    sendMessage: vi.fn(),
    stop: vi.fn(),
  };
  return {
    getCardPreviewRuntime: () => runtime,
    __mockCardPreviewRuntime: runtime,
  };
});

import { initStores } from '../store.js';
import { cardPreviewSidebar, getCardPreviewSidebarHTML } from '../components/card_preview_sidebar.js';
import { __mockCardPreviewRuntime as runtime } from '../components/card_preview_runtime.js';

function setupSidebar() {
  initStores();
  Alpine.store('card').data = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '艾琳',
      first_mes: '{{char}}: 欢迎，{{user}}。',
      alternate_greetings: ['{{char}}: 你终于来了，{{user}}。'],
      group_only_greetings: [],
    },
  };
  Alpine.store('cardPreview').userName = '旅人';
  const component = cardPreviewSidebar();
  return { component, preview: Alpine.store('cardPreview') };
}

describe('card preview sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('changes alternate greetings and can switch back to primary', () => {
    const { component, preview } = setupSidebar();

    component.changeGreeting('alt_0');
    expect(preview.selectedGreetingId).toBe('alt_0');
    expect(runtime.restartConversation).toHaveBeenCalledTimes(1);

    component.changeGreeting('first');
    expect(preview.selectedGreetingId).toBe('first');
    expect(runtime.restartConversation).toHaveBeenCalledTimes(2);
  });

  it('renders greeting messages through a frameless sandboxed iframe path', () => {
    const html = getCardPreviewSidebarHTML();

    expect(html).toContain('renderGreetingFrame(msg)');
    expect(html).toContain('sandbox="allow-same-origin"');
    expect(html).toContain('measureFrame($event, msg)');
    expect(html).toContain('@wheel="handleMessageWheel($event)"');
    expect(html).toContain('card-preview-effect-frame');
    expect(html).not.toContain('开场白预览');
    expect(html).not.toContain('沙盒化 HTML');
    expect(html).toContain('greetingMenuOpen = !greetingMenuOpen');
    expect(html).toContain('changeGreeting(option.id)');
  });

  it('forwards plain-message wheel movement to the message list', () => {
    const { component } = setupSidebar();
    const list = document.createElement('div');
    const target = document.createElement('p');
    list.appendChild(target);
    Object.defineProperties(list, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 300 },
      scrollTop: { value: 0, writable: true },
    });
    component.$refs = { cardPreviewMessageList: list };

    const event = {
      target,
      deltaY: 80,
      deltaMode: 0,
      preventDefault: vi.fn(),
    };
    component.handleMessageWheel(event);

    expect(list.scrollTop).toBe(80);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('routes html fragments inline and full effects through sandboxed iframes', () => {
    const { component } = setupSidebar();
    const richReply = { role: 'assistant', content: '<div class="reply-card"><span>效果</span></div>' };
    const fullEffectReply = { role: 'assistant', content: '<style>.reply-card{color:red}</style><div class="reply-card">效果</div>' };

    expect(component.shouldRenderMessageFrame(richReply)).toBe(false);
    expect(component.shouldRenderInlineMessageEffect(richReply)).toBe(true);
    expect(component.renderInlineEffectContent(richReply.content)).toContain('reply-card');

    const multilineInline = component.renderInlineEffectContent(`<div style="
    width: 95%;
    max-width: 330px;
    background: url('https://example.com/bg.jpg') center / cover no-repeat;
"><h4>故事背景</h4></div>`);
    expect(multilineInline).toContain('<div style=');
    expect(multilineInline).toContain('max-width: 330px');
    expect(multilineInline).toContain('<h4>故事背景</h4>');
    expect(multilineInline).not.toContain('&lt;div style');

    expect(component.shouldRenderMessageFrame(fullEffectReply)).toBe(true);
    expect(component.renderMessageFrame(fullEffectReply)).toContain('reply-card');
    expect(component.getFrameStyle(fullEffectReply)).toBe('height: 420px;');

    component.preview.streamingText = '<style>.reply-card{color:red}</style><div class="reply-card">效果</div>';
    expect(component.shouldRenderStreamingFrame()).toBe(true);
    expect(component.renderStreamingFrame()).toContain('reply-card');
  });
});
