import Alpine from 'alpinejs';
import { normalizeSupplierConfig } from '../agent/llm/model.js';
import { requestAssistantTurn } from '../agent/llm/client.js';
import { buildCardPreviewMessages, buildGreetingPreviewMessage, getCardPreviewData } from '../agent/card_preview/prompt_builder.js';

const STREAMING_PLACEHOLDER_TEXT = '生成中...';
let runtimeInstance = null;
let messageSeq = 0;

function nextMessageId() {
  messageSeq += 1;
  return `card_preview_${Date.now()}_${messageSeq}`;
}

function getPreviewStore() {
  return Alpine.store('cardPreview');
}

function getCardStore() {
  return Alpine.store('card');
}

function getSuppliersStore() {
  return Alpine.store('suppliers');
}

function getToastStore() {
  return Alpine.store('toast');
}

function normalizeUserFacingError(error) {
  const raw = typeof error === 'string' ? error : (error?.message || '卡片预览生成失败');
  if (/abort|aborted|signal is aborted/i.test(raw)) return '已停止生成';
  return raw;
}

function clearStreaming(preview) {
  if (!preview) return;
  preview.streamingText = '';
  preview.streamingThinking = '';
}

function appendMessage(preview, role, content, extra = {}) {
  const message = {
    id: nextMessageId(),
    role,
    content: String(content || ''),
    ts: Date.now(),
    ...extra,
  };
  preview.messages.push(message);
  return message;
}

function stopStreaming(preview) {
  if (preview?.abortController) {
    try {
      preview.abortController.abort();
    } catch {
      // ignore
    }
  }
  if (preview) {
    preview.abortController = null;
  }
}

function ensureGreetingMessage(preview, cardData) {
  const greetingInfo = buildGreetingPreviewMessage(cardData, preview.selectedGreetingId, preview.userName);
  if (greetingInfo.greeting?.id && preview.selectedGreetingId !== greetingInfo.greeting.id) {
    preview.selectedGreetingId = greetingInfo.greeting.id;
  }
  if (!greetingInfo.content) return null;
  const first = preview.messages[0];
  if (first?.role === 'assistant' && first?.kind === 'greeting' && first?.greetingId === greetingInfo.greeting.id) {
    return first;
  }
  if (preview.messages.length === 0) {
    return appendMessage(preview, 'assistant', greetingInfo.content, {
      kind: 'greeting',
      greetingId: greetingInfo.greeting.id,
    });
  }
  return null;
}

function buildSupplierConfig(suppliers) {
  const config = typeof suppliers?.getConfig === 'function' ? suppliers.getConfig() : (suppliers || {});
  return normalizeSupplierConfig(config);
}

function validateSupplierConfig(supplierConfig) {
  if (!supplierConfig.model) return '请先在设置中选择 AI 模型';
  if (!supplierConfig.baseUrl || !supplierConfig.apiKey) return '请先在设置中配置 AI 供应商';
  return '';
}

export function getCardPreviewRuntime() {
  if (runtimeInstance) return runtimeInstance;

  runtimeInstance = {
    ensureGreeting() {
      const preview = getPreviewStore();
      const cardData = getCardPreviewData(getCardStore()?.data);
      return ensureGreetingMessage(preview, cardData);
    },

    restartConversation() {
      const preview = getPreviewStore();
      if (!preview) return;
      stopStreaming(preview);
      preview.status = 'idle';
      preview.error = null;
      preview.lastUserInput = '';
      preview.messages = [];
      preview.input = '';
      clearStreaming(preview);
      this.ensureGreeting();
    },

    async sendMessage(rawText) {
      const preview = getPreviewStore();
      const cardStore = getCardStore();
      const suppliers = getSuppliersStore();
      const toast = getToastStore();
      const text = String(rawText || preview?.input || '').trim();
      if (!text || !preview) return;

      if (!cardStore?.data) {
        toast?.error?.('请先加载角色卡');
        return;
      }

      const supplierConfig = buildSupplierConfig(suppliers);
      const supplierError = validateSupplierConfig(supplierConfig);
      if (supplierError) {
        preview.error = supplierError;
        toast?.error?.(supplierError);
        return;
      }

      stopStreaming(preview);
      preview.status = 'streaming';
      preview.error = null;
      preview.lastUserInput = text;
      preview.input = '';
      clearStreaming(preview);
      preview.streamingText = STREAMING_PLACEHOLDER_TEXT;

      const cardData = getCardPreviewData(cardStore.data);
      ensureGreetingMessage(preview, cardData);
      appendMessage(preview, 'user', text);

      const controller = new AbortController();
      preview.abortController = controller;
      let accumulatedText = '';
      let accumulatedThinking = '';

      try {
        const { messages } = buildCardPreviewMessages({
          card: cardStore.data,
          selectedGreetingId: preview.selectedGreetingId,
          userName: preview.userName,
          messages: preview.messages,
          userInput: '',
        });

        const turn = await requestAssistantTurn({
          messages,
          supplier: supplierConfig,
          tools: [],
          signal: controller.signal,
          onTextDelta: (delta) => {
            accumulatedText += delta || '';
            preview.streamingText = accumulatedText || STREAMING_PLACEHOLDER_TEXT;
          },
          onThinkingDelta: (delta) => {
            accumulatedThinking += delta || '';
            preview.streamingThinking = accumulatedThinking;
          },
        });

        const finalText = String(turn?.text ?? accumulatedText ?? '').trim();
        const finalThinking = String(turn?.thinking ?? accumulatedThinking ?? '').trim();
        clearStreaming(preview);
        if (finalText) {
          appendMessage(preview, 'assistant', finalText, finalThinking ? { thinking: finalThinking } : {});
        } else {
          appendMessage(preview, 'assistant', '（供应商没有返回内容）');
        }
        preview.status = 'idle';
      } catch (error) {
        const message = normalizeUserFacingError(error);
        clearStreaming(preview);
        preview.status = 'idle';
        if (message !== '已停止生成') {
          preview.error = message;
          toast?.error?.(message);
          appendMessage(preview, 'assistant', message, { kind: 'error' });
        }
      } finally {
        if (preview.abortController === controller) {
          preview.abortController = null;
        }
      }
    },

    stop() {
      const preview = getPreviewStore();
      stopStreaming(preview);
      clearStreaming(preview);
      if (preview) {
        preview.status = 'idle';
      }
    },
  };

  return runtimeInstance;
}

export const __cardPreviewRuntimeTesting = {
  buildSupplierConfig,
  clearStreaming,
  ensureGreetingMessage,
  validateSupplierConfig,
};

export default {
  getCardPreviewRuntime,
};
