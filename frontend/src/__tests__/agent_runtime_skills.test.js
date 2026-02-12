import { describe, expect, it } from 'vitest';

import { __agentRuntimeTesting } from '../components/agent_runtime.js';

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
    expect(messages[2].content).toContain('Skill · Demo');
    expect(messages[3].content).toBe('old assistant');
    expect(messages[4].content).toBe('old user');
    expect(messages[5].role).toBe('user');
    expect(messages[5].content).toContain('用户指令：do something');
  });

  it('keeps original structure when no skill context', () => {
    const history = [{ role: 'assistant', content: 'old assistant' }];
    const payload = { snapshot: false, changes: [] };

    const messages = __agentRuntimeTesting.buildToolMessages(history, 'continue', payload, null);
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toBe('old assistant');
    expect(messages[2].role).toBe('user');
  });
});
