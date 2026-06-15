import { describe, expect, it } from 'vitest';

import {
  createAssistantTurnAssembler,
  legacyCompletionToAssistantTurn,
  splitThinkTaggedContent,
} from '../events.js';

describe('llm events', () => {
  it('converts legacy OpenAI completion into AssistantTurn', () => {
    const turn = legacyCompletionToAssistantTurn({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: 'Working',
          reasoning_content: 'Reasoning',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'card_set_field',
              arguments: '{"path":"data.name","value":"Alice"}',
            },
          }],
        },
      }],
      usage: { prompt_tokens: 1 },
    });

    expect(turn.text).toBe('Working');
    expect(turn.thinking).toBe('Reasoning');
    expect(turn.stopReason).toBe('toolUse');
    expect(turn.usage).toEqual({ prompt_tokens: 1 });
    expect(turn.toolCalls).toEqual([{
      id: 'call_1',
      name: 'card_set_field',
      arguments: { path: 'data.name', value: 'Alice' },
    }]);
  });

  it('preserves invalid tool argument JSON for runtime parse errors', () => {
    const turn = legacyCompletionToAssistantTurn({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'card_set_field', arguments: '{bad json' } }],
        },
      }],
    });

    expect(turn.toolCalls[0].arguments).toBe('{bad json');
    expect(turn.diagnostics[0].code).toBe('E_TOOL_ARGUMENTS_JSON');
  });

  it('normalizes legacy function_call into AssistantTurn tool calls', () => {
    const turn = legacyCompletionToAssistantTurn({
      choices: [{
        finish_reason: 'function_call',
        message: {
          role: 'assistant',
          content: '',
          function_call: { name: 'card_read_field', arguments: '{"path":"data.name"}' },
        },
      }],
    });

    expect(turn.stopReason).toBe('toolUse');
    expect(turn.toolCalls).toEqual([{
      id: '',
      name: 'card_read_field',
      arguments: { path: 'data.name' },
    }]);
  });

  it('assembles normalized stream events into AssistantTurn', () => {
    const assembler = createAssistantTurnAssembler();
    assembler.apply({ type: 'text_delta', delta: 'Hello ' });
    assembler.apply({ type: 'thinking_delta', delta: 'Check' });
    assembler.apply({
      type: 'toolcall_delta',
      id: 'call_1',
      name: 'card_set_field',
      argumentsDelta: '{"path":"data.name"}',
    });

    const turn = assembler.toTurn();
    expect(turn.text).toBe('Hello ');
    expect(turn.thinking).toBe('Check');
    expect(turn.stopReason).toBe('toolUse');
    expect(turn.toolCalls).toEqual([{
      id: 'call_1',
      name: 'card_set_field',
      arguments: '{"path":"data.name"}',
    }]);
  });

  it('splits think-tagged fallback content', () => {
    expect(splitThinkTaggedContent('<think>A</think>B')).toEqual({
      visibleText: 'B',
      thinkingText: 'A',
    });
  });
});
