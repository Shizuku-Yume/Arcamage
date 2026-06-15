import { beforeEach, describe, expect, it, vi } from 'vitest';
import Alpine from 'alpinejs';

vi.mock('../api.js', () => ({
  validateCard: vi.fn(async () => ({ data: { valid: true } })),
}));

vi.mock('../agent/skill_manager.js', () => ({
  exportSkillRepositoryState: vi.fn(async () => ({ version: 1, catalog: [], skills: {} })),
  importSkillRepositoryState: vi.fn(),
  loadSkillCatalog: vi.fn(async () => []),
  loadSkillPreferenceState: vi.fn(() => ({ enabled: true, selectedIds: [] })),
  saveSkillPreferenceState: vi.fn(),
}));

vi.mock('../agent/llm/client.js', () => ({
  requestAssistantTurn: vi.fn(),
}));

import { requestAssistantTurn } from '../agent/llm/client.js';
import { validateCard } from '../api.js';
import { initStores } from '../store.js';
import { getAgentRuntime } from '../components/agent_runtime.js';

function createCard(name = 'Before') {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name,
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      tags: [],
      creator: '',
      character_version: '',
      alternate_greetings: [],
      group_only_greetings: [],
      character_book: null,
      extensions: {},
      assets: [],
      nickname: '',
      source: [],
    },
  };
}

function setupRuntime({ toolLimit = 50, name = 'Before' } = {}) {
  initStores();
  Alpine.store('card').data = createCard(name);
  Alpine.store('card').originalData = createCard(name);
  Alpine.store('card').cardId = 'test-card';
  Alpine.store('history').init(createCard(name));
  Alpine.store('settings').agentToolCallLimit = toolLimit;
  Alpine.store('suppliers').baseUrl = 'https://api.example.com';
  Alpine.store('suppliers').apiKey = 'sk-test';
  Alpine.store('suppliers').model = 'test-model';
  Alpine.store('suppliers').transport = 'direct';
  Alpine.store('suppliers').useProxy = false;
  return {
    agent: Alpine.store('agent'),
    card: Alpine.store('card'),
    runtime: getAgentRuntime(),
  };
}

describe('agent_runtime tool flow regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestAssistantTurn.mockReset();
    validateCard.mockResolvedValue({ data: { valid: true } });
  });

  it('resumes a pending tool session with internal tool history', async () => {
    const { agent, card, runtime } = setupRuntime({ toolLimit: 1 });
    requestAssistantTurn
      .mockResolvedValueOnce({
        text: '',
        thinking: '',
        toolCalls: [{
          id: 'call_1',
          name: 'card_set_field',
          arguments: { path: 'data.name', value: 'After' },
        }],
      })
      .mockResolvedValueOnce({
        text: 'done',
        thinking: '',
        toolCalls: [],
      });

    await runtime.sendMessage('rename');

    expect(agent.runtime.toolSession).not.toBeNull();
    expect(card.data.data.name).toBe('After');
    expect(agent.chat.messages.at(-1).content).toContain('继续');
    expect(agent.runtime.status).toBe('idle');

    await runtime.sendMessage('继续');

    expect(requestAssistantTurn).toHaveBeenCalledTimes(2);
    const resumedMessages = requestAssistantTurn.mock.calls[1][0].messages;
    expect(resumedMessages.some((message) => message.role === 'toolResult')).toBe(true);
    expect(resumedMessages.at(-1).role).toBe('user');
    expect(resumedMessages.at(-1).content[0].text).toBe('继续');
    expect(card.data.data.name).toBe('After');
    expect(agent.runtime.toolSession).toBeNull();
    expect(agent.appliedEntries).toHaveLength(1);
  });

  it('recovers a CAS mismatch by reading the latest hash and retrying once', async () => {
    const { agent, card, runtime } = setupRuntime({ name: 'Current' });
    requestAssistantTurn
      .mockResolvedValueOnce({
        text: '',
        thinking: '',
        toolCalls: [{
          id: 'call_1',
          name: 'card_set_field',
          arguments: {
            path: 'data.name',
            expected_hash: 'stale-hash',
            value: 'Recovered',
          },
        }],
      })
      .mockResolvedValueOnce({
        text: 'updated',
        thinking: '',
        toolCalls: [],
      });

    await runtime.sendMessage('rename with stale hash');

    expect(card.data.data.name).toBe('Recovered');
    expect(agent.appliedEntries).toHaveLength(1);
    expect(agent.appliedEntries[0].diffs[0]).toMatchObject({
      resource: 'card_field',
      path: 'data.name',
      op: 'update',
      before: 'Current',
      after: 'Recovered',
    });

    const firstCallMessages = requestAssistantTurn.mock.calls[0][0].messages;
    const toolResults = firstCallMessages.filter((message) => message.role === 'toolResult');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].isError).toBe(false);
    expect(toolResults[0].content[0].text).toContain('diff_summary');
    expect(toolResults[0].content[0].text).not.toContain('new_card');
    expect(toolResults[0].content[0].text).not.toContain('"data"');
  });

  it('rejects the latest applied diff and updates the summary entry', async () => {
    const { agent, card, runtime } = setupRuntime({ name: 'Before' });
    requestAssistantTurn
      .mockResolvedValueOnce({
        text: '',
        thinking: '',
        toolCalls: [{
          id: 'call_1',
          name: 'card_set_field',
          arguments: { path: 'data.name', value: 'After' },
        }],
      })
      .mockResolvedValueOnce({
        text: 'renamed',
        thinking: '',
        toolCalls: [],
      });

    await runtime.sendMessage('rename');

    const entry = agent.appliedEntries[0];
    const diffKey = entry.diffs[0].id;
    const result = await runtime.rejectEntryDiff(entry.id, diffKey);

    expect(result).toEqual({ ok: true, remainingCount: 0 });
    expect(card.data.data.name).toBe('Before');
    expect(entry.diffs).toEqual([]);
    expect(entry.summary).toBe('该次修改已全部不采纳');
    expect(agent.chat.messages.find((message) => message.id === entry.assistantMessageId)?.content)
      .toBe('该次修改已全部不采纳');
    expect(agent.ui.diffPanelOpen).toBe(false);
  });
});
