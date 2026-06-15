import { beforeEach, describe, expect, it, vi } from 'vitest';
import Alpine from 'alpinejs';

vi.mock('../agent/llm/client.js', () => ({
  requestAssistantTurn: vi.fn(),
}));

vi.mock('../api.js', () => ({
  validateCard: vi.fn(),
}));

import { contentToText } from '../agent/llm/messages.js';
import { requestAssistantTurn } from '../agent/llm/client.js';
import { validateCard } from '../api.js';
import { initStores } from '../store.js';
import { getCardPreviewRuntime } from '../components/card_preview_runtime.js';

function createCard(name = '艾琳', overrides = {}) {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name,
      description: `${name}住在旧书店。`,
      personality: '温柔。',
      scenario: '夜晚的书店。',
      first_mes: '{{char}}: 欢迎，{{user}}。',
      alternate_greetings: [],
      group_only_greetings: [],
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      character_book: null,
      tags: [],
      creator: '',
      character_version: '',
      extensions: {},
      assets: [],
      nickname: '',
      source: [],
      ...overrides,
    },
  };
}

function messageTextsFromRequest() {
  const request = requestAssistantTurn.mock.calls.at(-1)?.[0];
  return (request?.messages || []).map((message) => ({
    role: message.role,
    text: contentToText(message.content),
  }));
}

function setupRuntime(options = {}) {
  initStores();
  const card = createCard(options.name || '艾琳', options.cardData || {});
  Alpine.store('card').data = card;
  Alpine.store('card').originalData = structuredClone(card);
  Alpine.store('card').hasChanges = false;
  Alpine.store('suppliers').baseUrl = 'https://api.example.com';
  Alpine.store('suppliers').apiKey = 'sk-test';
  Alpine.store('suppliers').model = 'test-model';
  Alpine.store('suppliers').transport = 'direct';
  Alpine.store('suppliers').useProxy = false;
  Alpine.store('cardPreview').userName = '旅人';
  return {
    runtime: getCardPreviewRuntime(),
    preview: Alpine.store('cardPreview'),
    card: Alpine.store('card'),
  };
}

describe('card preview runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestAssistantTurn.mockReset();
  });

  it('streams a pure character chat turn without tools or card mutation', async () => {
    const { runtime, preview, card } = setupRuntime();
    const beforeCard = JSON.parse(JSON.stringify(card.data));
    const beforeOriginal = JSON.parse(JSON.stringify(card.originalData));
    requestAssistantTurn.mockImplementation(async ({ onTextDelta, onThinkingDelta }) => {
      onThinkingDelta?.('思考');
      onTextDelta?.('你好');
      onTextDelta?.('，旅人。');
      return { text: '你好，旅人。', thinking: '思考', toolCalls: [] };
    });

    preview.input = '这里是什么地方？';
    await runtime.sendMessage();

    expect(requestAssistantTurn).toHaveBeenCalledTimes(1);
    expect(requestAssistantTurn).toHaveBeenCalledWith(expect.objectContaining({
      supplier: expect.objectContaining({
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-test',
        model: 'test-model',
      }),
      tools: [],
    }));
    expect(validateCard).not.toHaveBeenCalled();
    expect(card.data).toEqual(beforeCard);
    expect(card.originalData).toEqual(beforeOriginal);
    expect(card.hasChanges).toBe(false);
    expect(preview.messages.map((message) => [message.role, message.content])).toEqual([
      ['assistant', '欢迎，旅人。'],
      ['user', '这里是什么地方？'],
      ['assistant', '你好，旅人。'],
    ]);
    expect(preview.streamingText).toBe('');
    expect(preview.streamingThinking).toBe('');
    expect(preview.status).toBe('idle');
  });

  it('uses the selected alternate greeting in the LLM request', async () => {
    const { runtime, preview } = setupRuntime({
      cardData: {
        alternate_greetings: ['{{char}}: 你终于来了，{{user}}。'],
      },
    });
    requestAssistantTurn.mockResolvedValue({ text: '请进。', toolCalls: [] });

    preview.selectedGreetingId = 'alt_0';
    await runtime.sendMessage('继续');

    const requestTexts = messageTextsFromRequest();
    const assistantTexts = requestTexts.filter((message) => message.role === 'assistant').map((message) => message.text);
    expect(preview.messages[0]).toMatchObject({ role: 'assistant', kind: 'greeting', greetingId: 'alt_0', content: '你终于来了，旅人。' });
    expect(assistantTexts).toContain('你终于来了，旅人。');
    expect(assistantTexts).not.toContain('欢迎，旅人。');
  });

  it('can return from an alternate greeting to the primary greeting', async () => {
    const { runtime, preview } = setupRuntime({
      cardData: {
        alternate_greetings: ['{{char}}: 你终于来了，{{user}}。'],
      },
    });
    requestAssistantTurn.mockResolvedValue({ text: '好的。', toolCalls: [] });

    preview.selectedGreetingId = 'alt_0';
    runtime.restartConversation();
    expect(preview.messages.map((message) => message.content)).toEqual(['你终于来了，旅人。']);

    preview.selectedGreetingId = 'first';
    runtime.restartConversation();
    expect(preview.messages).toHaveLength(1);
    expect(preview.messages[0]).toMatchObject({ role: 'assistant', kind: 'greeting', greetingId: 'first', content: '欢迎，旅人。' });

    await runtime.sendMessage('继续');
    const assistantTexts = messageTextsFromRequest().filter((message) => message.role === 'assistant').map((message) => message.text);
    expect(assistantTexts).toContain('欢迎，旅人。');
    expect(assistantTexts).not.toContain('你终于来了，旅人。');
  });

  it('ignores unexpected supplier tool calls and does not mutate the card', async () => {
    const { runtime, preview, card } = setupRuntime();
    const beforeCard = JSON.parse(JSON.stringify(card.data));
    const beforeOriginal = JSON.parse(JSON.stringify(card.originalData));
    requestAssistantTurn.mockResolvedValue({
      text: '这里只聊天，不修改卡片。',
      toolCalls: [{ name: 'card_set_field', arguments: { path: 'data.name', value: '被修改' } }],
    });

    await runtime.sendMessage('修改名字');

    expect(validateCard).not.toHaveBeenCalled();
    expect(card.data).toEqual(beforeCard);
    expect(card.originalData).toEqual(beforeOriginal);
    expect(card.hasChanges).toBe(false);
    expect(preview.messages.at(-1)).toMatchObject({ role: 'assistant', content: '这里只聊天，不修改卡片。' });
  });

  it('requires supplier settings before sending', async () => {
    const { runtime, preview } = setupRuntime();
    Alpine.store('suppliers').baseUrl = '';

    await runtime.sendMessage('你好');

    expect(requestAssistantTurn).not.toHaveBeenCalled();
    expect(preview.error).toBe('请先在设置中配置 AI 供应商');
    expect(preview.messages).toEqual([]);
  });

  it('clears streaming state after request errors', async () => {
    const { runtime, preview } = setupRuntime();
    requestAssistantTurn.mockRejectedValue(new Error('供应商超时'));

    await runtime.sendMessage('你好');

    expect(preview.status).toBe('idle');
    expect(preview.streamingText).toBe('');
    expect(preview.streamingThinking).toBe('');
    expect(preview.abortController).toBeNull();
    expect(preview.error).toBe('供应商超时');
    expect(preview.messages.at(-1)).toMatchObject({ role: 'assistant', kind: 'error', content: '供应商超时' });
  });

  it('stops streaming and clears the abort controller', () => {
    const { runtime, preview } = setupRuntime();
    const abort = vi.fn();
    preview.abortController = { abort };
    preview.status = 'streaming';
    preview.streamingText = '生成中';
    preview.streamingThinking = 'thinking';

    runtime.stop();

    expect(abort).toHaveBeenCalledTimes(1);
    expect(preview.abortController).toBeNull();
    expect(preview.status).toBe('idle');
    expect(preview.streamingText).toBe('');
    expect(preview.streamingThinking).toBe('');
  });
});
