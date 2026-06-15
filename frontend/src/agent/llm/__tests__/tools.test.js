import { describe, expect, it } from 'vitest';

import { normalizeToolDefinitions, toLegacyOpenAiTools, toPiAiTools } from '../tools.js';

describe('llm tools', () => {
  it('normalizes plain and OpenAI typed tool definitions', () => {
    const tools = normalizeToolDefinitions([
      { name: 'card_card_read_field', description: 'View', parameters: { type: 'object' } },
      {
        type: 'function',
        function: {
          name: 'card_set_field',
          description: 'Set',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
      { description: 'missing name' },
    ]);

    expect(tools.map((tool) => tool.name)).toEqual(['card_card_read_field', 'card_set_field']);
  });

  it('converts normalized tools to legacy OpenAI tools', () => {
    expect(toLegacyOpenAiTools([{ name: 'card_card_read_field', parameters: { type: 'object' } }])).toEqual([{
      type: 'function',
      function: {
        name: 'card_card_read_field',
        description: '',
        parameters: { type: 'object' },
      },
    }]);
  });

  it('omits empty legacy OpenAI tools', () => {
    expect(toLegacyOpenAiTools([])).toBeUndefined();
    expect(toLegacyOpenAiTools([{ description: 'missing name' }])).toBeUndefined();
  });

  it('keeps pi-ai tools plain', () => {
    expect(toPiAiTools([{ name: 'card_card_read_field', description: 'View', parameters: { type: 'object' } }])).toEqual([
      { name: 'card_card_read_field', description: 'View', parameters: { type: 'object' } },
    ]);
  });
});
