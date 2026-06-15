import { describe, expect, it } from 'vitest';

import { contentToText } from '../agent/llm/messages.js';
import {
  buildCardPreviewMessages,
  buildGreetingOptions,
  resolveGreetingOption,
} from '../agent/card_preview/prompt_builder.js';

function textOf(message) {
  return contentToText(message.content);
}

function createCardData(overrides = {}) {
  return {
    name: '艾琳',
    description: '她是{{char}}的角色描述。',
    personality: '{{char}}温柔但谨慎。',
    scenario: '{{user}}来到旧书店。',
    first_mes: '{{char}}: 欢迎，{{user}}。',
    alternate_greetings: ['{{char}}: 你终于来了，{{user}}。'],
    group_only_greetings: [],
    mes_example: '<START>\n{{user}}: 你好\n{{char}}: 你好，旅人。',
    creator_notes: '不要泄露给{{user}}。',
    system_prompt: '始终保持沉浸。',
    post_history_instructions: '回复应简短。',
    character_book: null,
    ...overrides,
  };
}

describe('card preview prompt builder', () => {
  it('builds greeting choices from primary alternate and group greetings', () => {
    const options = buildGreetingOptions(createCardData({
      group_only_greetings: ['群聊开场'],
    }));

    expect(options.map((option) => option.id)).toEqual(['first', 'alt_0', 'group_0']);
    expect(resolveGreetingOption(createCardData(), 'alt_0')).toMatchObject({
      id: 'alt_0',
      content: '{{char}}: 你终于来了，{{user}}。',
    });
  });

  it('orders ST-like system fields examples history post-history and current input', () => {
    const { messages, meta } = buildCardPreviewMessages({
      card: createCardData(),
      selectedGreetingId: 'first',
      userName: '旅人',
      userInput: '这里是什么地方？',
    });

    expect(meta.charName).toBe('艾琳');
    expect(meta.greeting.id).toBe('first');

    const texts = messages.map(textOf);
    const joined = texts.join('\n---\n');
    expect(joined).toContain('始终保持沉浸。');
    expect(joined).toContain('## 角色描述\n她是艾琳的角色描述。');
    expect(joined).toContain('## 性格\n艾琳温柔但谨慎。');
    expect(joined).toContain('## 场景\n旅人来到旧书店。');
    expect(joined).toContain('你好，旅人。');
    expect(joined).toContain('欢迎，旅人。');
    expect(texts.at(-2)).toBe('回复应简短。');
    expect(messages.at(-1).role).toBe('user');
    expect(texts.at(-1)).toBe('这里是什么地方？');
  });

  it('keeps an alternate greeting as the first assistant preview message', () => {
    const { messages } = buildCardPreviewMessages({
      card: createCardData(),
      selectedGreetingId: 'alt_0',
      userName: '旅人',
      userInput: '继续',
    });

    const assistantMessages = messages.filter((message) => message.role === 'assistant').map(textOf);
    expect(assistantMessages.at(-1)).toBe('你终于来了，旅人。');
    expect(assistantMessages).not.toContain('欢迎，旅人。');
  });

  it('uses only the selected greeting when returning to the primary greeting', () => {
    const { messages } = buildCardPreviewMessages({
      card: createCardData(),
      selectedGreetingId: 'first',
      userName: '旅人',
      messages: [
        { role: 'assistant', kind: 'greeting', greetingId: 'alt_0', content: '你终于来了，旅人。' },
      ],
      userInput: '继续',
    });

    const assistantMessages = messages.filter((message) => message.role === 'assistant').map(textOf);
    expect(assistantMessages).toContain('欢迎，旅人。');
    expect(assistantMessages).not.toContain('你终于来了，旅人。');
    expect(assistantMessages[assistantMessages.length - 1]).toBe('欢迎，旅人。');
  });

  it('activates lightweight lorebook entries without dropping constant empty-key entries', () => {
    const { messages, meta } = buildCardPreviewMessages({
      card: createCardData({
        character_book: {
          token_budget: 2000,
          entries: [
            { id: 'always', keys: [], content: '常驻：{{char}}知道暗号。', enabled: true, constant: true },
            { id: 'disabled', keys: ['红门'], content: '禁用条目', enabled: false },
            { id: 'keyword', keys: ['红门'], content: '红门后是温室。', enabled: true },
            { id: 'selective-hit', keys: ['红门'], secondary_keys: ['月亮'], selective: true, content: '月亮会打开红门。', enabled: true, position: 'after_char' },
            { id: 'selective-miss', keys: ['红门'], secondary_keys: ['太阳'], selective: true, content: '不应出现', enabled: true },
          ],
        },
      }),
      userName: '旅人',
      userInput: '我看见红门和月亮。',
    });

    const joined = messages.map(textOf).join('\n');
    expect(joined).toContain('常驻：艾琳知道暗号。');
    expect(joined).toContain('红门后是温室。');
    expect(joined).toContain('月亮会打开红门。');
    expect(joined).not.toContain('禁用条目');
    expect(joined).not.toContain('不应出现');
    expect(meta.activatedLorebookEntries.map((entry) => entry.id)).toEqual(['always', 'keyword', 'selective-hit']);
  });
});
