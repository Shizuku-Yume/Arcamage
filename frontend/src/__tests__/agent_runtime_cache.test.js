import { beforeEach, describe, expect, it, vi } from 'vitest';
import Alpine from 'alpinejs';

vi.mock('../agent/llm/client.js', () => ({
  requestAssistantTurn: vi.fn(),
}));

import { requestAssistantTurn } from '../agent/llm/client.js';
import { __agentRuntimeTesting } from '../components/agent_runtime.js';

describe('agent_runtime tool support cache and fallback', () => {
  const suppliers = {
    baseUrl: 'https://api.example.com',
    model: 'test-model',
    apiKey: 'sk-test',
    useProxy: true,
  };

  beforeEach(() => {
    __agentRuntimeTesting.clearToolSupportCache();
    vi.clearAllMocks();
  });

  it('short-circuits when supplier is already marked unsupported', () => {
    __agentRuntimeTesting.setToolSupportState(suppliers, false);
    expect(__agentRuntimeTesting.shouldSkipToolFlowForUnsupportedSupplier(suppliers)).toBe(true);
  });

  it('requests assistant turns through the LLM client', async () => {
    requestAssistantTurn.mockResolvedValue({
      role: 'assistant',
      text: 'result',
      thinking: '',
      toolCalls: [],
      stopReason: 'stop',
    });

    const result = await __agentRuntimeTesting.requestToolRoundCompletion({
      toolMessages: [{ role: 'user', content: 'do something' }],
      suppliers,
      toolDefinitions: [],
      toolChoice: 'auto',
      signal: null,
    });

    expect(requestAssistantTurn).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: 'user', content: 'do something' }],
      supplier: suppliers,
      tools: [],
      toolChoice: 'auto',
    }));
    expect(result?.text).toBe('result');
  });

  it('marks cache unsupported only for explicit tool unsupported errors', async () => {
    const unsupportedError = new Error('tool_calls not supported by this upstream provider');
    requestAssistantTurn.mockRejectedValue(unsupportedError);

    await expect(__agentRuntimeTesting.requestToolRoundCompletion({
      toolMessages: [{ role: 'user', content: 'do something' }],
      suppliers,
      toolDefinitions: [],
      toolChoice: 'auto',
      signal: null,
    })).rejects.toThrow('tool_calls not supported');

    expect(__agentRuntimeTesting.getToolSupportState(suppliers)).toBe(false);
  });

  it('does not poison cache on generic stream errors', async () => {
    requestAssistantTurn.mockRejectedValue(new Error('temporary parse failure'));

    await expect(__agentRuntimeTesting.requestToolRoundCompletion({
      toolMessages: [{ role: 'user', content: 'do something' }],
      suppliers,
      toolDefinitions: [],
      toolChoice: 'auto',
      signal: null,
    })).rejects.toThrow('temporary parse failure');

    expect(__agentRuntimeTesting.getToolSupportState(suppliers)).toBeUndefined();
  });

  it('forwards streaming deltas to runtime callback', async () => {
    requestAssistantTurn.mockImplementation(async ({ onTextDelta }) => {
      onTextDelta?.('part-1 ');
      onTextDelta?.('part-2');
      return {
        role: 'assistant',
        text: 'part-1 part-2',
        thinking: '',
        toolCalls: [],
        stopReason: 'stop',
      };
    });

    const onDelta = vi.fn();
    await __agentRuntimeTesting.requestToolRoundCompletion({
      toolMessages: [{ role: 'user', content: 'do something' }],
      suppliers,
      toolDefinitions: [],
      toolChoice: 'auto',
      signal: null,
      onDelta,
    });

    expect(onDelta).toHaveBeenCalledTimes(2);
    expect(onDelta).toHaveBeenNthCalledWith(1, 'part-1 ');
    expect(onDelta).toHaveBeenNthCalledWith(2, 'part-2');
  });

  it('forwards streaming thinking deltas to runtime callback', async () => {
    requestAssistantTurn.mockImplementation(async ({ onThinkingDelta }) => {
      onThinkingDelta?.('reason-1');
      onThinkingDelta?.('reason-2');
      return {
        role: 'assistant',
        text: 'ok',
        thinking: 'reason-1reason-2',
        toolCalls: [],
        stopReason: 'stop',
      };
    });

    const onThinkingDelta = vi.fn();
    await __agentRuntimeTesting.requestToolRoundCompletion({
      toolMessages: [{ role: 'user', content: 'do something' }],
      suppliers,
      toolDefinitions: [],
      toolChoice: 'auto',
      signal: null,
      onThinkingDelta,
    });

    expect(onThinkingDelta).toHaveBeenCalledTimes(2);
    expect(onThinkingDelta).toHaveBeenNthCalledWith(1, 'reason-1');
    expect(onThinkingDelta).toHaveBeenNthCalledWith(2, 'reason-2');
  });

  it('injects skill tool system prompt conditionally', () => {
    const baseMessages = __agentRuntimeTesting.buildToolMessages(
      [],
      'test',
      { snapshot: true },
      null,
      { includeSkillTools: false },
    );
    const withSkillTools = __agentRuntimeTesting.buildToolMessages(
      [],
      'test',
      { snapshot: true },
      null,
      { includeSkillTools: true },
    );

    expect(baseMessages.length).toBe(2);
    expect(withSkillTools.length).toBe(3);
    expect(withSkillTools[1].content[0].text).toContain('skill_list');
  });

  it('prefers diff_summaries batch contract and builds skill file diffs', () => {
    const toolResult = {
      diff_summary: {
        path: 'data.name',
        change_type: 'update',
      },
      diff_summaries: [
        {
          resource: 'skill_file',
          path: 'skills/demo/SKILL.md',
          change_type: 'update',
          before_value: 'before',
          after_value: 'after',
        },
      ],
    };

    const summaries = __agentRuntimeTesting.collectToolDiffSummaries(toolResult);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].path).toBe('skills/demo/SKILL.md');

    const diffs = __agentRuntimeTesting.buildToolDiffs(
      { data: { name: 'before-name' } },
      { data: { name: 'after-name' } },
      summaries,
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0].resource).toBe('skill_file');
    expect(diffs[0].before).toBe('before');
    expect(diffs[0].after).toBe('after');
  });

  it('uses diff_summaries[0].path as tool trace fallback', () => {
    const trace = __agentRuntimeTesting.createToolTrace({
      toolName: 'skill_upsert',
      toolCallId: 'tool_1',
      parsedArgs: {},
      toolResult: {
        status: 'ok',
        diff_summaries: [{ path: 'skills/demo/SKILL.md', change_type: 'update' }],
      },
      durationMs: 12,
    });

    expect(trace.path).toBe('skills/demo/SKILL.md');
  });

  it('prefers explicit before_value/after_value for card field diffs', () => {
    const diffs = __agentRuntimeTesting.buildToolDiffs(
      { data: { alternate_greetings: [] } },
      { data: { alternate_greetings: ['A', 'B'] } },
      [{
        resource: 'card_field',
        path: 'data.alternate_greetings[1]',
        change_type: 'add',
        before_value: null,
        after_value: 'B',
      }],
    );

    expect(diffs).toHaveLength(1);
    expect(diffs[0].before).toBeNull();
    expect(diffs[0].after).toBe('B');
  });

  it('rolls back the latest applied entry and restores card state', () => {
    const checkChanges = vi.fn();
    Alpine.store('card', {
      data: { data: { name: 'After' } },
      checkChanges,
    });
    Alpine.store('history', {
      canUndo: false,
      undo: vi.fn(),
    });

    const agent = {
      chat: {
        messages: [
          { id: 'user_1', role: 'user', content: 'rename' },
          { id: 'assistant_1', role: 'assistant', content: 'Renamed' },
        ],
      },
      appliedEntries: [{
        id: 'apply_1',
        userMessageId: 'user_1',
        assistantMessageId: 'assistant_1',
        beforeCard: { data: { name: 'Before' } },
        afterCard: { data: { name: 'After' } },
      }],
      lastApplied: null,
      ui: { showLastApplied: true },
    };
    agent.lastApplied = agent.appliedEntries[0];

    const undone = __agentRuntimeTesting.rollbackLatestApplied(agent);

    expect(undone?.id).toBe('apply_1');
    expect(Alpine.store('card').data).toEqual({ data: { name: 'Before' } });
    expect(checkChanges).toHaveBeenCalledOnce();
    expect(agent.appliedEntries).toEqual([]);
    expect(agent.lastApplied).toBeNull();
    expect(agent.ui.showLastApplied).toBe(false);
    expect(agent.chat.messages).toEqual([
      { id: 'user_1', role: 'user', content: 'rename' },
    ]);
  });
});
