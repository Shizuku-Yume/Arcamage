import { describe, expect, it } from 'vitest';

import {
  assistantTurnToInternalMessage,
  contentToText,
  contentToToolCalls,
  createInternalTextMessage,
  toInternalMessages,
  toLegacyOpenAiMessages,
  toolResultToInternalMessage,
} from '../messages.js';

describe('llm messages', () => {
  it('converts legacy OpenAI assistant tool calls into internal blocks', () => {
    const [message] = toInternalMessages([{
      role: 'assistant',
      content: 'I will edit it',
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: {
          name: 'card_set_field',
          arguments: '{"path":"data.name","value":"Alice"}',
        },
      }],
    }]);

    expect(message.role).toBe('assistant');
    expect(contentToText(message.content)).toBe('I will edit it');
    expect(contentToToolCalls(message.content)).toEqual([{
      id: 'call_1',
      name: 'card_set_field',
      arguments: '{"path":"data.name","value":"Alice"}',
    }]);
  });

  it('converts internal messages back to legacy OpenAI chat messages', () => {
    const messages = [
      createInternalTextMessage('system', 'system prompt'),
      createInternalTextMessage('user', 'rename'),
      assistantTurnToInternalMessage({
        text: '',
        toolCalls: [{
          id: 'call_1',
          name: 'card_set_field',
          arguments: { path: 'data.name', value: 'Alice' },
        }],
      }),
      toolResultToInternalMessage({
        toolCallId: 'call_1',
        toolName: 'card_set_field',
        result: { status: 'ok' },
      }),
    ];

    expect(toLegacyOpenAiMessages(messages)).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'rename' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: {
            name: 'card_set_field',
            arguments: '{"path":"data.name","value":"Alice"}',
          },
        }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"status":"ok"}' },
    ]);
  });

  it('keeps legacy function_call recoverable as a tool call', () => {
    const legacy = [{
      role: 'assistant',
      content: '',
      function_call: { name: 'card_read_field', arguments: '{"path":"data.name"}' },
    }];

    const [message] = toInternalMessages(legacy);
    expect(contentToToolCalls(message.content)).toEqual([{
      id: '',
      name: 'card_read_field',
      arguments: '{"path":"data.name"}',
    }]);
  });
});
