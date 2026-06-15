import { describe, expect, it } from 'vitest';

import { __agentRuntimeTesting } from '../components/agent_runtime.js';

function messageText(message) {
  return message?.content?.[0]?.text || '';
}

describe('agent_runtime skill message injection', () => {
  it('injects guardrail and skill context before history', () => {
    const history = [
      { role: 'assistant', content: 'old assistant' },
      { role: 'user', content: 'old user' },
    ];
    const payload = { snapshot: true, fields: { a: 1 } };

    const messages = __agentRuntimeTesting.buildToolMessages(history, 'do something', payload, {
      contextText: '## Skill · Demo\n\nSkill body',
    });

    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('system');
    expect(messages[2].role).toBe('system');
    expect(messageText(messages[2])).toContain('Skill · Demo');
    expect(messageText(messages[3])).toBe('old assistant');
    expect(messageText(messages[4])).toBe('old user');
    expect(messages[5].role).toBe('user');
    expect(messageText(messages[5])).toContain('用户指令：do something');
  });

  it('keeps original structure when no skill context', () => {
    const history = [{ role: 'assistant', content: 'old assistant' }];
    const payload = { snapshot: false, changes: [] };

    const messages = __agentRuntimeTesting.buildToolMessages(history, 'continue', payload, null);
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('system');
    expect(messageText(messages[1])).toBe('old assistant');
    expect(messages[2].role).toBe('user');
  });
});
