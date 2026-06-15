import Alpine from 'alpinejs';
import { buildGreetingOptions, getCardPreviewData } from '../agent/card_preview/prompt_builder.js';
import { getCardPreviewRuntime } from './card_preview_runtime.js';
import { generateIframeContent, renderContent } from './preview_panel.js';

const runtime = getCardPreviewRuntime();
const DEFAULT_USER_NAME = 'user';
const DEFAULT_FRAME_HEIGHT = 420;
const MIN_FRAME_HEIGHT = 180;
const MAX_FRAME_HEIGHT = 720;
const FRAME_HEIGHT_PADDING = 2;
const WHEEL_LINE_HEIGHT = 16;
const EFFECT_FRAME_PATTERN = /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<style[\s>]|<script[\s>]/i;
const EFFECT_TAG_PATTERN = /<\/?(?:div|span|p|br|img|table|thead|tbody|tr|th|td|details|summary|section|article|header|footer|main|ul|ol|li|blockquote|pre|code|h[1-6]|strong|em|a)\b/gi;

function shouldRenderEffectFrame(content) {
  const text = String(content || '').trim();
  return Boolean(text && EFFECT_FRAME_PATTERN.test(text));
}

function shouldRenderInlineEffect(content) {
  const text = String(content || '').trim();
  if (!text || shouldRenderEffectFrame(text)) return false;
  const tags = text.match(EFFECT_TAG_PATTERN);
  return Array.isArray(tags) && tags.length >= 2;
}

function normalizeUserName(value) {
  const text = String(value || '').trim();
  return text || DEFAULT_USER_NAME;
}

function clampFrameHeight(height) {
  const value = Number(height);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_FRAME_HEIGHT;
  return Math.max(MIN_FRAME_HEIGHT, Math.min(MAX_FRAME_HEIGHT, Math.ceil(value + FRAME_HEIGHT_PADDING)));
}

function normalizeWheelDelta(event) {
  const unit = event?.deltaMode === 1 ? WHEEL_LINE_HEIGHT : event?.deltaMode === 2 ? window.innerHeight : 1;
  return Number(event?.deltaY || 0) * unit;
}

function findScrollableAncestor(target, boundary) {
  let node = target instanceof Element ? target : null;
  while (node && node !== boundary) {
    const style = window.getComputedStyle(node);
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    if (canScrollY) return node;
    node = node.parentElement;
  }
  return null;
}

export function cardPreviewSidebar() {
  return {
    isMultiline: false,
    greetingMenuOpen: false,
    frameHeights: {},

    init() {
      this.syncGreetingSelection();
      runtime.ensureGreeting();
    },

    get preview() {
      return Alpine.store('cardPreview');
    },

    get card() {
      return Alpine.store('card');
    },

    get agentUi() {
      return Alpine.store('agent')?.ui;
    },

    get suppliers() {
      return Alpine.store('suppliers');
    },

    get cardData() {
      return getCardPreviewData(this.card?.data);
    },

    get title() {
      return this.cardData?.name || '角色卡';
    },

    get greetingOptions() {
      return buildGreetingOptions(this.cardData);
    },

    get currentGreetingLabel() {
      const options = this.greetingOptions;
      return options.find((option) => option.id === this.preview?.selectedGreetingId)?.label || options[0]?.label || '开场白';
    },

    get isStreaming() {
      return this.preview?.status === 'streaming';
    },

    get hasMessages() {
      return Array.isArray(this.preview?.messages) && this.preview.messages.length > 0;
    },

    get supplierLabel() {
      const model = String(this.suppliers?.model || '').trim();
      if (!model) return '未配置模型';
      const provider = this.suppliers?.getCurrentProvider?.();
      const providerName = provider?.name || this.suppliers?.provider || '供应商';
      return `${providerName} · ${model}`;
    },

    get streamingText() {
      return String(this.preview?.streamingText || '').trim();
    },

    get isStreamingPlaceholder() {
      return /^生成中(?:\.{3}|…)?$/.test(this.streamingText);
    },

    get streamingPlaceholderChars() {
      return Array.from('生成中...');
    },

    get isDarkMode() {
      return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    },

    syncGreetingSelection() {
      const options = this.greetingOptions;
      if (!this.preview || !options.length) return;
      if (!this.preview.selectedGreetingId || !options.some((option) => option.id === this.preview.selectedGreetingId)) {
        this.preview.selectedGreetingId = options[0].id;
      }
    },

    changeGreeting(greetingId) {
      if (!this.preview) return;
      const options = this.greetingOptions;
      const next = options.find((option) => option.id === greetingId) || options[0];
      this.preview.selectedGreetingId = next?.id || 'empty';
      this.greetingMenuOpen = false;
      this.restartConversation();
    },

    changeUserName(value) {
      if (!this.preview) return;
      this.preview.userName = normalizeUserName(value);
      this.restartConversation();
    },

    restartConversation() {
      runtime.restartConversation();
    },

    sendMessage() {
      runtime.sendMessage(this.preview.input);
    },

    stopStreaming() {
      runtime.stop();
    },

    close() {
      if (!this.agentUi) return;
      this.agentUi.isOpen = false;
      this.agentUi.isFullscreen = false;
    },

    autoResize(event) {
      const el = event?.target;
      if (!el) return;
      const maxHeight = Number(el.dataset.maxHeight || 120);
      el.style.height = 'auto';
      const nextHeight = Math.min(el.scrollHeight, maxHeight);
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
      this.isMultiline = nextHeight > 42;
    },

    handleChatInputKeydown(event) {
      if (!event || event.key !== 'Enter' || event.isComposing) return;
      if (!(event.ctrlKey || event.shiftKey || event.metaKey)) return;
      event.preventDefault();
      if (this.isStreaming) {
        this.stopStreaming();
        return;
      }
      if (!String(this.preview?.input || '').trim()) return;
      this.sendMessage();
    },

    handleMessageWheel(event) {
      const list = this.$refs?.cardPreviewMessageList;
      if (!event || !list) return;
      const innerScroller = findScrollableAncestor(event.target, list);
      if (innerScroller) return;
      const deltaY = normalizeWheelDelta(event);
      if (!deltaY) return;
      const previousTop = list.scrollTop;
      list.scrollTop += deltaY;
      if (list.scrollTop !== previousTop) {
        event.preventDefault();
      }
    },

    getFrameKey(message, fallback = 'streaming') {
      return String(message?.id || message?.ts || fallback);
    },

    getFrameHeight(messageOrKey) {
      const key = typeof messageOrKey === 'string' ? messageOrKey : this.getFrameKey(messageOrKey);
      return this.frameHeights[key] || DEFAULT_FRAME_HEIGHT;
    },

    getFrameStyle(messageOrKey) {
      return `height: ${this.getFrameHeight(messageOrKey)}px;`;
    },

    measureFrame(event, messageOrKey) {
      const frame = event?.target;
      const doc = frame?.contentDocument;
      if (!frame || !doc) return;
      const nextHeight = clampFrameHeight(Math.max(
        doc.documentElement?.scrollHeight || 0,
        doc.body?.scrollHeight || 0,
        doc.body?.offsetHeight || 0
      ));
      const key = typeof messageOrKey === 'string' ? messageOrKey : this.getFrameKey(messageOrKey);
      this.frameHeights = {
        ...this.frameHeights,
        [key]: nextHeight,
      };
    },

    isGreetingMessage(message) {
      return message?.role === 'assistant' && message?.kind === 'greeting';
    },

    renderGreetingFrame(message) {
      return generateIframeContent(message?.content || '', {
        mode: 'first_mes_native',
        markdown: true,
        darkMode: this.isDarkMode,
      });
    },

    shouldRenderMessageFrame(message) {
      return shouldRenderEffectFrame(message?.content);
    },

    shouldRenderInlineMessageEffect(message) {
      return shouldRenderInlineEffect(message?.content);
    },

    renderMessageFrame(message) {
      return generateIframeContent(message?.content || '', {
        markdown: true,
        darkMode: this.isDarkMode,
      });
    },

    shouldRenderStreamingFrame() {
      return shouldRenderEffectFrame(this.preview?.streamingText);
    },

    shouldRenderInlineStreamingEffect() {
      return shouldRenderInlineEffect(this.preview?.streamingText);
    },

    renderStreamingFrame() {
      return generateIframeContent(this.preview?.streamingText || '', {
        markdown: true,
        darkMode: this.isDarkMode,
      });
    },

    renderMessageContent(content) {
      if (!content) return '';
      return renderContent(content, { markdown: true });
    },

    renderInlineEffectContent(content) {
      if (!content) return '';
      return renderContent(content, { markdown: false });
    },
  };
}

export function registerCardPreviewSidebarComponent() {
  Alpine.data('cardPreviewSidebar', cardPreviewSidebar);
}

export function getCardPreviewSidebarHTML() {
  return `
    <div x-data="cardPreviewSidebar()" x-init="init()" x-effect="greetingOptions; syncGreetingSelection()" class="flex flex-col h-full min-h-0">
      <div class="p-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">卡片效果预览</h3>
            <p class="text-xs text-zinc-500 dark:text-zinc-400 truncate" x-text="title"></p>
            <p class="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500 truncate" x-text="supplierLabel"></p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button @click="restartConversation()" class="group btn-secondary gap-1.5 px-3 py-1.5 text-xs font-medium" title="重开对话">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              <span>重开</span>
            </button>
            <button @click="close()" class="group btn-secondary gap-1.5 px-3 py-1.5 text-xs font-medium">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>关闭</span>
            </button>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div class="block min-w-0 relative" @keydown.escape.window="greetingMenuOpen = false">
            <span class="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">开场白</span>
            <button type="button"
                    @click="greetingMenuOpen = !greetingMenuOpen"
                    class="w-full flex items-center justify-between rounded-neo border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-200 hover:border-brand dark:hover:border-brand-400 transition-colors">
              <span class="truncate" x-text="currentGreetingLabel"></span>
              <svg class="w-3.5 h-3.5 text-zinc-400 transition-transform" :class="greetingMenuOpen ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div x-show="greetingMenuOpen"
                 x-transition
                 @click.outside="greetingMenuOpen = false"
                 class="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-neo border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-neo-lift dark:shadow-neo-lift-dark">
              <template x-for="option in greetingOptions" :key="option.id">
                <button type="button"
                        @click="changeGreeting(option.id)"
                        :class="preview.selectedGreetingId === option.id ? 'bg-brand-50/60 dark:bg-brand-900/25 text-brand-700 dark:text-brand-300' : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'"
                        class="w-full px-2.5 py-1.5 text-left text-xs transition-colors"
                        x-text="option.label"></button>
              </template>
            </div>
          </div>
          <label class="block min-w-0">
            <span class="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">用户名称</span>
            <input :value="preview.userName" @input="preview.userName = $event.target.value" @change="changeUserName($event.target.value)" class="w-full rounded-neo border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-200" placeholder="user">
          </label>
        </div>
        <p x-show="preview.error" x-cloak class="mt-2 rounded-neo border border-danger bg-danger-light text-danger px-3 py-2 text-xs break-anywhere" x-text="preview.error"></p>
      </div>

      <div x-ref="cardPreviewMessageList" @wheel="handleMessageWheel($event)" class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3 custom-scrollbar">
        <div x-show="!hasMessages && !isStreaming" class="h-full min-h-[180px] flex items-center justify-center text-center text-xs text-zinc-400 dark:text-zinc-500">
          选择开场白后开始体验这张角色卡的酒馆对话效果。
        </div>
        <template x-for="msg in preview.messages" :key="msg.id || msg.ts">
          <div class="flex min-w-0" :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
            <div class="group min-w-0" :class="msg.role === 'user' ? 'max-w-[88%] sm:max-w-[80%]' : 'w-full max-w-full'">
              <div class="rounded-neo px-3 py-2 text-sm min-w-0" :class="msg.role === 'user' ? 'bg-brand text-white' : (isGreetingMessage(msg) || shouldRenderMessageFrame(msg) ? 'w-full max-w-full bg-white/95 dark:bg-zinc-900/70 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 shadow-sm' : 'inline-block max-w-full sm:max-w-[86%] bg-white/95 dark:bg-zinc-900/70 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 shadow-sm')">
                <template x-if="msg.role === 'user'">
                  <p class="whitespace-pre-wrap break-anywhere" x-text="msg.content"></p>
                </template>
                <template x-if="msg.role === 'assistant' && isGreetingMessage(msg) && shouldRenderMessageFrame(msg)">
                  <div class="card-preview-effect-frame rounded-neo bg-zinc-50 dark:bg-zinc-950/40">
                    <iframe :srcdoc="renderGreetingFrame(msg)" sandbox="allow-same-origin" @load="measureFrame($event, msg)" :style="getFrameStyle(msg)" class="block w-full border-0 bg-zinc-50 dark:bg-zinc-950 transition-[height] duration-200"></iframe>
                  </div>
                </template>
                <template x-if="msg.role === 'assistant' && !isGreetingMessage(msg) && shouldRenderMessageFrame(msg)">
                  <div class="card-preview-effect-frame rounded-neo bg-zinc-50 dark:bg-zinc-950/40">
                    <iframe :srcdoc="renderMessageFrame(msg)" sandbox="allow-same-origin" @load="measureFrame($event, msg)" :style="getFrameStyle(msg)" class="block w-full border-0 bg-zinc-50 dark:bg-zinc-950 transition-[height] duration-200"></iframe>
                  </div>
                </template>
                <template x-if="msg.role === 'assistant' && (isGreetingMessage(msg) ? !shouldRenderMessageFrame(msg) : shouldRenderInlineMessageEffect(msg))">
                  <div class="card-preview-inline-effect" x-html="renderInlineEffectContent(msg.content)"></div>
                </template>
                <template x-if="msg.role === 'assistant' && !isGreetingMessage(msg) && !shouldRenderMessageFrame(msg) && !shouldRenderInlineMessageEffect(msg)">
                  <div class="agent-markdown card-preview-markdown prose prose-sm dark:prose-invert max-w-none min-w-0" x-html="renderMessageContent(msg.content)"></div>
                </template>
              </div>
            </div>
          </div>
        </template>

        <div x-show="preview.streamingThinking" x-cloak class="flex justify-start min-w-0">
          <div class="w-full max-w-full sm:max-w-[86%] min-w-0 rounded-neo-lg border border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-100/55 dark:bg-zinc-900/85 shadow-sm p-2.5">
            <div class="text-xs font-medium text-zinc-600 dark:text-zinc-200 mb-1 inline-flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full bg-brand/80 animate-pulse"></span>Thinking</div>
            <div class="text-[11px] text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap break-anywhere leading-5" x-text="preview.streamingThinking"></div>
          </div>
        </div>

        <div x-show="streamingText" x-cloak class="flex justify-start min-w-0">
          <div class="min-w-0 rounded-neo px-3 py-2 text-sm bg-white/95 dark:bg-zinc-900/70 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 shadow-sm" :class="shouldRenderStreamingFrame() ? 'w-full max-w-full' : 'inline-block max-w-full sm:max-w-[86%]'">
            <div x-show="isStreamingPlaceholder" x-cloak class="agent-loading-wave" aria-live="polite" aria-label="生成中">
              <template x-for="(char, idx) in streamingPlaceholderChars" :key="'card-preview-loading-' + idx">
                <span class="agent-loading-wave-char" :style="'--agent-wave-delay:' + (idx * 150) + 'ms'" x-text="char"></span>
              </template>
            </div>
            <template x-if="!isStreamingPlaceholder && shouldRenderStreamingFrame()">
              <div class="card-preview-effect-frame rounded-neo bg-zinc-50 dark:bg-zinc-950/40">
                <iframe :srcdoc="renderStreamingFrame()" sandbox="allow-same-origin" @load="measureFrame($event, 'streaming')" :style="getFrameStyle('streaming')" class="block w-full border-0 bg-zinc-50 dark:bg-zinc-950 transition-[height] duration-200"></iframe>
              </div>
            </template>
            <template x-if="!isStreamingPlaceholder && !shouldRenderStreamingFrame() && shouldRenderInlineStreamingEffect()">
              <div class="card-preview-inline-effect" x-html="renderInlineEffectContent(preview.streamingText)"></div>
            </template>
            <template x-if="!isStreamingPlaceholder && !shouldRenderStreamingFrame() && !shouldRenderInlineStreamingEffect()">
              <div class="agent-markdown card-preview-markdown prose prose-sm dark:prose-invert max-w-none min-w-0" x-html="renderMessageContent(preview.streamingText)"></div>
            </template>
          </div>
        </div>
      </div>

      <div class="px-4 pb-4 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/80 shrink-0">
        <div class="flex gap-2 rounded-neo border border-zinc-200 dark:border-zinc-700 bg-white/95 dark:bg-zinc-900/90 px-3 py-2 shadow-neo-lift dark:shadow-neo-lift-dark" :class="isMultiline ? 'flex-wrap items-end' : 'items-center'">
          <textarea x-model="preview.input" rows="1" data-max-height="120" x-ref="cardPreviewInput" x-init="$nextTick(() => autoResize({ target: $refs.cardPreviewInput }))" x-effect="preview.input; autoResize({ target: $refs.cardPreviewInput })" @input="autoResize($event)" @focus="autoResize($event)" @keydown="handleChatInputKeydown($event)" :class="isMultiline ? 'basis-full' : 'flex-1'" class="bg-transparent text-sm leading-6 text-zinc-700 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none resize-none min-h-[32px] py-1 min-w-0" placeholder="输入消息，体验角色回复..."></textarea>
          <button @click="isStreaming ? stopStreaming() : sendMessage()" :disabled="!preview.input && !isStreaming" class="h-8 w-8 flex items-center justify-center rounded-neo bg-brand text-white hover:bg-brand-dark disabled:opacity-50 shrink-0" title="发送 / 停止">
            <template x-if="!isStreaming">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m0-14l-6 6m6-6l6 6" />
              </svg>
            </template>
            <template x-if="isStreaming">
              <span class="block w-3.5 h-3.5 rounded-sm bg-white"></span>
            </template>
          </button>
        </div>
        <p class="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">Ctrl/Shift/⌘ + Enter 发送；预览聊天不会修改角色卡。</p>
      </div>
    </div>
  `;
}

export function getCardPreviewModalHTML() {
  return `
    <div x-show="$store.agent.ui.isFullscreen && $store.agent.ui.sidebarMode === 'cardPreview'" x-cloak class="fixed inset-0 z-50 bg-zinc-50 dark:bg-zinc-900 safe-area-inset-top safe-area-inset-bottom">
      ${getCardPreviewSidebarHTML()}
    </div>
  `;
}

export default {
  cardPreviewSidebar,
  registerCardPreviewSidebarComponent,
  getCardPreviewSidebarHTML,
  getCardPreviewModalHTML,
};
