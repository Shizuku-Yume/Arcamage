import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/ai_client.js', () => ({
  completeChat: vi.fn(),
  streamCompleteChat: vi.fn(),
}));

import { completeChat, streamCompleteChat } from '../components/ai_client.js';
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

  it('falls back to completeChat when streamed result is unusable', async () => {
    streamCompleteChat.mockResolvedValue({
      choices: [{
        message: null,
      }],
    });
    completeChat.mockResolvedValue({
      choices: [{
        message: { role: 'assistant', content: 'fallback result' },
      }],
    });

    const result = await __agentRuntimeTesting.requestToolRoundCompletion({
      toolMessages: [{ role: 'user', content: 'do something' }],
      suppliers,
      toolDefinitions: [],
      toolChoice: 'auto',
      signal: null,
    });

    expect(streamCompleteChat).toHaveBeenCalledOnce();
    expect(completeChat).toHaveBeenCalledOnce();
    expect(result?.choices?.[0]?.message?.content).toBe('fallback result');
  });

  it('marks cache unsupported only for explicit tool unsupported errors', async () => {
    const unsupportedError = new Error('tool_calls not supported by this upstream provider');
    streamCompleteChat.mockRejectedValue(unsupportedError);

    await expect(__agentRuntimeTesting.requestToolRoundCompletion({
      toolMessages: [{ role: 'user', content: 'do something' }],
      suppliers,
      toolDefinitions: [],
      toolChoice: 'auto',
      signal: null,
    })).rejects.toThrow('tool_calls not supported');

    expect(completeChat).not.toHaveBeenCalled();
    expect(__agentRuntimeTesting.getToolSupportState(suppliers)).toBe(false);
  });

  it('does not poison cache on generic stream errors', async () => {
    streamCompleteChat.mockRejectedValue(new Error('temporary parse failure'));
    completeChat.mockResolvedValue({
      choices: [{
        message: { role: 'assistant', content: 'ok' },
      }],
    });

    await __agentRuntimeTesting.requestToolRoundCompletion({
      toolMessages: [{ role: 'user', content: 'do something' }],
      suppliers,
      toolDefinitions: [],
      toolChoice: 'auto',
      signal: null,
    });

    expect(completeChat).toHaveBeenCalledOnce();
    expect(__agentRuntimeTesting.getToolSupportState(suppliers)).toBeUndefined();
  });

  it('forwards streaming deltas to runtime callback', async () => {
    streamCompleteChat.mockImplementation(async ({ onDelta }) => {
      onDelta?.('part-1 ');
      onDelta?.('part-2');
      return {
        choices: [{
          message: { role: 'assistant', content: 'part-1 part-2' },
        }],
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
    streamCompleteChat.mockImplementation(async ({ onThinkingDelta }) => {
      onThinkingDelta?.('reason-1');
      onThinkingDelta?.('reason-2');
      return {
        choices: [{
          message: { role: 'assistant', content: 'ok', reasoning_content: 'reason-1reason-2' },
        }],
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
    expect(withSkillTools[1].content).toContain('list_skills');
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
      toolName: 'save_skill',
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
});
