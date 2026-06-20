import { afterEach, describe, expect, it, vi } from 'vitest';

const streamMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());

vi.mock('../../../api.js', () => ({
  post: postMock,
}));

vi.mock('@earendil-works/pi-ai', () => ({
  stream: streamMock,
}));

import { requestAssistantTurn } from '../client.js';

function createSseResponse(blocks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(blocks.join('')));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('llm client adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    streamMock.mockReset();
    postMock.mockReset();
  });

  it('migrates old useProxy supplier config to the controlled LLM proxy', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ]));

    const turn = await requestAssistantTurn({
      messages: [{ role: 'user', content: 'hello' }],
      supplier: {
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-test',
        model: 'model-x',
        useProxy: true,
      },
      tools: [{ name: 'card_read_field', parameters: { type: 'object' } }],
      toolChoice: 'auto',
    });

    expect(turn.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith('/api/llm/proxy', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      provider: 'openai-compatible',
      api: 'openai-completions',
      base_url: 'https://api.example.com',
      api_key: 'sk-test',
      path: '/v1/chat/completions',
      stream: true,
      body: {
        model: 'model-x',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [{
          type: 'function',
          function: {
            name: 'card_read_field',
            description: '',
            parameters: { type: 'object' },
          },
        }],
        tool_choice: 'auto',
      },
    });
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('uses pi-ai first for direct OpenAI-compatible completions', async () => {
    async function* streamEvents() {
      yield { type: 'text_delta', delta: 'hello' };
      yield {
        type: 'done',
        reason: 'stop',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          api: 'openai-completions',
          provider: 'openai-compatible',
          model: 'model-x',
          usage: null,
          stopReason: 'stop',
          timestamp: 1,
        },
      };
    }
    streamMock.mockReturnValue(streamEvents());
    const onTextDelta = vi.fn();

    const turn = await requestAssistantTurn({
      messages: [{ role: 'user', content: 'hello' }],
      supplier: {
        provider: 'openai-compatible',
        api: 'openai-completions',
        transport: 'direct',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-test',
        model: 'model-x',
      },
      tools: [],
      onTextDelta,
    });

    expect(streamMock).toHaveBeenCalledOnce();
    expect(streamMock.mock.calls[0][0]).toMatchObject({
      api: 'openai-completions',
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      compat: {
        supportsDeveloperRole: false,
      },
    });
    expect(onTextDelta).toHaveBeenCalledWith('hello');
    expect(turn.text).toBe('hello');
  });

  it('routes direct non-legacy suppliers through pi-ai', async () => {
    async function* streamEvents() {
      yield { type: 'text_delta', delta: 'ok' };
      yield { type: 'thinking_delta', delta: 'thinking' };
      yield {
        type: 'toolcall_end',
        toolCall: {
          type: 'toolCall',
          id: 'call_1',
          name: 'card_set_field',
          arguments: { path: 'data.name', value: 'Ada' },
        },
      };
      yield {
        type: 'done',
        reason: 'toolUse',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'ok' },
            { type: 'thinking', thinking: 'thinking' },
            {
              type: 'toolCall',
              id: 'call_1',
              name: 'card_set_field',
              arguments: { path: 'data.name', value: 'Ada' },
            },
          ],
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-test',
          usage: null,
          stopReason: 'toolUse',
          timestamp: 1,
        },
      };
    }
    streamMock.mockReturnValue(streamEvents());
    const onTextDelta = vi.fn();
    const onThinkingDelta = vi.fn();

    const turn = await requestAssistantTurn({
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'hello' },
      ],
      supplier: {
        provider: 'anthropic',
        api: 'anthropic-messages',
        transport: 'direct',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-test',
        model: 'claude-test',
        temperature: 0.7,
        reasoning: true,
      },
      tools: [{ name: 'card_set_field', parameters: { type: 'object' } }],
      toolChoice: 'auto',
      onTextDelta,
      onThinkingDelta,
    });
    expect(streamMock).toHaveBeenCalledOnce();
    expect(streamMock.mock.calls[0][0]).toMatchObject({
      id: 'claude-test',
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      reasoning: true,
    });
    expect(streamMock.mock.calls[0][1]).toMatchObject({
      systemPrompt: 'System prompt',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'card_set_field', description: '', parameters: { type: 'object' } }],
    });
    expect(streamMock.mock.calls[0][2]).toMatchObject({
      apiKey: 'sk-test',
      temperature: 0.7,
      toolChoice: 'auto',
      reasoning: 'medium',
      reasoningEffort: 'medium',
    });
    expect(onTextDelta).toHaveBeenCalledWith('ok');
    expect(onThinkingDelta).toHaveBeenCalledWith('thinking');
    expect(turn.text).toBe('ok');
    expect(turn.thinking).toBe('thinking');
    expect(turn.toolCalls).toEqual([{
      id: 'call_1',
      name: 'card_set_field',
      arguments: { path: 'data.name', value: 'Ada' },
    }]);
  });

  it('streams OpenAI-compatible Arcamage proxy requests through the controlled LLM proxy', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'done' } }] })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_1',
              type: 'function',
              function: {
                name: 'card_set_field',
                arguments: '{"path":"data.name"',
              },
            }],
          },
        }],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: ',"value":"Ada"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      })}\n\n`,
      'data: [DONE]\n\n',
    ]));
    const onTextDelta = vi.fn();

    const turn = await requestAssistantTurn({
      messages: [{ role: 'user', content: 'hello' }],
      supplier: {
        provider: 'openrouter',
        api: 'openai-completions',
        transport: 'arcamage-proxy',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-test',
        model: 'model-x',
      },
      tools: [{ name: 'card_set_field', parameters: { type: 'object' } }],
      toolChoice: 'auto',
      onTextDelta,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/llm/proxy', expect.objectContaining({
      method: 'POST',
      headers: {
        'Accept': 'text/event-stream',
        'Content-Type': 'application/json',
      },
      signal: undefined,
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      provider: 'openrouter',
      api: 'openai-completions',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-test',
      method: 'POST',
      path: '/chat/completions',
      stream: true,
      body: {
        model: 'model-x',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
        temperature: 1,
        tools: [{
          type: 'function',
          function: {
            name: 'card_set_field',
            description: '',
            parameters: { type: 'object' },
          },
        }],
        tool_choice: 'auto',
      },
    });
    expect(postMock).not.toHaveBeenCalled();
    expect(streamMock).not.toHaveBeenCalled();
    expect(onTextDelta).toHaveBeenCalledWith('done');
    expect(turn.toolCalls).toEqual([{
      id: 'call_1',
      name: 'card_set_field',
      arguments: { path: 'data.name', value: 'Ada' },
    }]);
  });

  it('does not fallback after partial OpenAI-compatible proxy stream output', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`,
      `event: error\ndata: ${JSON.stringify({ code: 'UPSTREAM_ERROR', message: 'stream failed' })}\n\n`,
    ]));
    const onTextDelta = vi.fn();

    await expect(requestAssistantTurn({
      messages: [{ role: 'user', content: 'hello' }],
      supplier: {
        provider: 'openrouter',
        api: 'openai-completions',
        transport: 'arcamage-proxy',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-test',
        model: 'model-x',
      },
      tools: [],
      onTextDelta,
    })).rejects.toThrow('stream failed');

    expect(onTextDelta).toHaveBeenCalledWith('partial');
    expect(postMock).not.toHaveBeenCalled();
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('routes OpenAI Responses Arcamage proxy requests through the controlled LLM proxy', async () => {
    postMock.mockResolvedValue({
      id: 'resp_test',
      status: 'completed',
      output: [
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'checking' }],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'done', annotations: [] }],
        },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'card_set_field',
          arguments: '{"path":"data.name","value":"Ada"}',
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });
    const onTextDelta = vi.fn();
    const onThinkingDelta = vi.fn();

    const turn = await requestAssistantTurn({
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'hello' },
      ],
      supplier: {
        provider: 'openai',
        api: 'openai-responses',
        transport: 'arcamage-proxy',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-openai-test',
        model: 'gpt-test',
        maxTokens: 4096,
        reasoning: true,
      },
      tools: [{ name: 'card_set_field', parameters: { type: 'object' } }],
      toolChoice: 'required',
      onTextDelta,
      onThinkingDelta,
    });

    expect(postMock).toHaveBeenCalledWith('/api/llm/proxy', expect.objectContaining({
      provider: 'openai',
      api: 'openai-responses',
      base_url: 'https://api.openai.com',
      api_key: 'sk-openai-test',
      method: 'POST',
      path: '/v1/responses',
      stream: false,
      body: expect.objectContaining({
        model: 'gpt-test',
        input: [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
        ],
        stream: false,
        store: false,
        max_output_tokens: 4096,
        temperature: 1,
        reasoning: { effort: 'medium', summary: 'auto' },
        include: ['reasoning.encrypted_content'],
        tool_choice: 'required',
        tools: [{
          type: 'function',
          name: 'card_set_field',
          description: '',
          parameters: { type: 'object' },
          strict: false,
        }],
      }),
    }), { timeout: 60000 });
    expect(streamMock).not.toHaveBeenCalled();
    expect(onTextDelta).toHaveBeenCalledWith('done');
    expect(onThinkingDelta).toHaveBeenCalledWith('checking');
    expect(turn.stopReason).toBe('toolUse');
    expect(turn.text).toBe('done');
    expect(turn.thinking).toBe('checking');
    expect(turn.toolCalls).toEqual([{
      id: 'call_1|fc_1',
      name: 'card_set_field',
      arguments: { path: 'data.name', value: 'Ada' },
    }]);
  });

  it('serializes OpenAI Responses tool-call history for follow-up proxy rounds', async () => {
    postMock.mockResolvedValue({
      id: 'resp_test',
      status: 'completed',
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'updated', annotations: [] }],
      }],
    });

    const turn = await requestAssistantTurn({
      messages: [
        { role: 'user', content: 'rename' },
        {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'call_1|fc_1',
            name: 'card_set_field',
            arguments: { path: 'data.name', value: 'Ada' },
          }],
        },
        {
          role: 'toolResult',
          toolCallId: 'call_1|fc_1',
          toolName: 'card_set_field',
          content: [{ type: 'text', text: '{"ok":true}' }],
        },
      ],
      supplier: {
        provider: 'openai',
        api: 'openai-responses',
        transport: 'arcamage-proxy',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai-test',
        model: 'gpt-test',
      },
      tools: [],
    });

    expect(postMock.mock.calls[0][1].path).toBe('/responses');
    expect(postMock.mock.calls[0][1].body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'rename' }] },
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'card_set_field',
        arguments: '{"path":"data.name","value":"Ada"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"ok":true}',
      },
    ]);
    expect(turn.text).toBe('updated');
    expect(turn.stopReason).toBe('stop');
  });

  it('routes Anthropic Arcamage proxy requests through the controlled LLM proxy', async () => {
    postMock.mockResolvedValue({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'done' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'card_set_field',
          input: { path: 'data.name', value: 'Ada' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    const onTextDelta = vi.fn();

    const turn = await requestAssistantTurn({
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'hello' },
      ],
      supplier: {
        provider: 'anthropic',
        api: 'anthropic-messages',
        transport: 'arcamage-proxy',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-test',
        model: 'claude-test',
        maxTokens: 8192,
      },
      tools: [{ name: 'card_set_field', parameters: { type: 'object' } }],
      toolChoice: 'required',
      onTextDelta,
    });

    expect(postMock).toHaveBeenCalledWith('/api/llm/proxy', expect.objectContaining({
      provider: 'anthropic',
      api: 'anthropic-messages',
      base_url: 'https://api.anthropic.com',
      api_key: 'sk-ant-test',
      method: 'POST',
      path: '/v1/messages',
      stream: false,
      body: expect.objectContaining({
        model: 'claude-test',
        max_tokens: 8192,
        system: 'System prompt',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
        tool_choice: { type: 'any' },
        tools: [{
          name: 'card_set_field',
          description: '',
          input_schema: { type: 'object' },
        }],
      }),
    }), { timeout: 60000 });
    expect(streamMock).not.toHaveBeenCalled();
    expect(onTextDelta).toHaveBeenCalledWith('done');
    expect(turn.stopReason).toBe('toolUse');
    expect(turn.toolCalls).toEqual([{
      id: 'toolu_1',
      name: 'card_set_field',
      arguments: { path: 'data.name', value: 'Ada' },
    }]);
  });

  it('serializes Anthropic follow-up tool results for proxy rounds', async () => {
    postMock.mockResolvedValue({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'updated' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const turn = await requestAssistantTurn({
      messages: [
        { role: 'user', content: 'rename' },
        {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'toolu_1',
            name: 'card_set_field',
            arguments: { path: 'data.name', value: 'Ada' },
          }],
        },
        {
          role: 'toolResult',
          toolCallId: 'toolu_1',
          toolName: 'card_set_field',
          content: [{ type: 'text', text: '{"ok":true}' }],
        },
      ],
      supplier: {
        provider: 'anthropic',
        api: 'anthropic-messages',
        transport: 'arcamage-proxy',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-ant-test',
        model: 'claude-test',
      },
      tools: [],
    });

    expect(postMock.mock.calls[0][1].path).toBe('/messages');
    expect(postMock.mock.calls[0][1].body.messages).toEqual([
      { role: 'user', content: 'rename' },
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_1',
          name: 'card_set_field',
          input: { path: 'data.name', value: 'Ada' },
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: '{"ok":true}',
          is_error: false,
        }],
      },
    ]);
    expect(turn.text).toBe('updated');
  });

  it('serializes Anthropic error tool results for retry proxy rounds', async () => {
    postMock.mockResolvedValue({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'toolu_retry',
        name: 'card_set_field',
        input: { path: 'data.name', value: 'Ada' },
      }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const turn = await requestAssistantTurn({
      messages: [
        { role: 'user', content: 'rename' },
        {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'toolu_1',
            name: 'card_set_field',
            arguments: { path: 'data.name', value: 'Ada' },
          }],
        },
        {
          role: 'toolResult',
          toolCallId: 'toolu_1',
          toolName: 'card_set_field',
          content: [{ type: 'text', text: 'temporary failure' }],
          isError: true,
        },
      ],
      supplier: {
        provider: 'anthropic',
        api: 'anthropic-messages',
        transport: 'arcamage-proxy',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-test',
        model: 'claude-test',
      },
      tools: [{ name: 'card_set_field', parameters: { type: 'object' } }],
      toolChoice: 'required',
    });

    expect(postMock.mock.calls[0][1].body.messages.at(-1)).toEqual({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: 'temporary failure',
        is_error: true,
      }],
    });
    expect(turn.stopReason).toBe('toolUse');
    expect(turn.toolCalls).toEqual([{
      id: 'toolu_retry',
      name: 'card_set_field',
      arguments: { path: 'data.name', value: 'Ada' },
    }]);
  });

  it('routes Google Arcamage proxy requests through the controlled LLM proxy', async () => {
    postMock.mockResolvedValue({
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { text: 'done' },
            {
              functionCall: {
                name: 'card_set_field',
                args: { path: 'data.name', value: 'Ada' },
              },
            },
          ],
        },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
    });
    const onTextDelta = vi.fn();

    const turn = await requestAssistantTurn({
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'hello' },
      ],
      supplier: {
        provider: 'google',
        api: 'google-generative-ai',
        transport: 'arcamage-proxy',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'google-key',
        model: 'gemini-test',
        maxTokens: 4096,
      },
      tools: [{ name: 'card_set_field', parameters: { type: 'object' } }],
      toolChoice: 'required',
      onTextDelta,
    });

    expect(postMock).toHaveBeenCalledWith('/api/llm/proxy', expect.objectContaining({
      provider: 'google',
      api: 'google-generative-ai',
      base_url: 'https://generativelanguage.googleapis.com',
      api_key: 'google-key',
      method: 'POST',
      path: '/v1beta/models/gemini-test:generateContent',
      stream: false,
      body: expect.objectContaining({
        systemInstruction: { parts: [{ text: 'System prompt' }] },
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
        generationConfig: { maxOutputTokens: 4096, temperature: 1 },
        toolConfig: { functionCallingConfig: { mode: 'ANY' } },
        tools: [{
          functionDeclarations: [{
            name: 'card_set_field',
            description: '',
            parametersJsonSchema: { type: 'object' },
          }],
        }],
      }),
    }), { timeout: 60000 });
    expect(streamMock).not.toHaveBeenCalled();
    expect(onTextDelta).toHaveBeenCalledWith('done');
    expect(turn.stopReason).toBe('toolUse');
    expect(turn.toolCalls).toEqual([{
      id: 'call_1',
      name: 'card_set_field',
      arguments: { path: 'data.name', value: 'Ada' },
    }]);
  });

  it('serializes Google follow-up tool results for proxy rounds', async () => {
    postMock.mockResolvedValue({
      candidates: [{
        content: {
          role: 'model',
          parts: [{ text: 'updated' }],
        },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
    });

    const turn = await requestAssistantTurn({
      messages: [
        { role: 'user', content: 'rename' },
        {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'call_1',
            name: 'card_set_field',
            arguments: { path: 'data.name', value: 'Ada' },
          }],
        },
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'card_set_field',
          content: [{ type: 'text', text: '{"ok":true}' }],
        },
      ],
      supplier: {
        provider: 'google',
        api: 'google-generative-ai',
        transport: 'arcamage-proxy',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'google-key',
        model: 'gemini-test',
      },
      tools: [],
    });

    expect(postMock.mock.calls[0][1].path).toBe('/models/gemini-test:generateContent');
    expect(postMock.mock.calls[0][1].body.contents).toEqual([
      { role: 'user', parts: [{ text: 'rename' }] },
      {
        role: 'model',
        parts: [{
          functionCall: {
            name: 'card_set_field',
            args: { path: 'data.name', value: 'Ada' },
          },
        }],
      },
      {
        role: 'user',
        parts: [{
          functionResponse: {
            name: 'card_set_field',
            response: { output: '{"ok":true}' },
          },
        }],
      },
    ]);
    expect(turn.text).toBe('updated');
  });

  it('serializes Google error tool results for retry proxy rounds', async () => {
    postMock.mockResolvedValue({
      candidates: [{
        content: {
          role: 'model',
          parts: [{
            functionCall: {
              name: 'card_set_field',
              args: { path: 'data.name', value: 'Ada' },
            },
          }],
        },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
    });

    const turn = await requestAssistantTurn({
      messages: [
        { role: 'user', content: 'rename' },
        {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'call_1',
            name: 'card_set_field',
            arguments: { path: 'data.name', value: 'Ada' },
          }],
        },
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'card_set_field',
          content: [{ type: 'text', text: 'temporary failure' }],
          isError: true,
        },
      ],
      supplier: {
        provider: 'google',
        api: 'google-generative-ai',
        transport: 'arcamage-proxy',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'google-key',
        model: 'gemini-test',
      },
      tools: [{ name: 'card_set_field', parameters: { type: 'object' } }],
      toolChoice: 'required',
    });

    expect(postMock.mock.calls[0][1].body.contents.at(-1)).toEqual({
      role: 'user',
      parts: [{
        functionResponse: {
          name: 'card_set_field',
          response: { error: 'temporary failure' },
        },
      }],
    });
    expect(turn.stopReason).toBe('toolUse');
    expect(turn.toolCalls).toEqual([{
      id: 'call_1',
      name: 'card_set_field',
      arguments: { path: 'data.name', value: 'Ada' },
    }]);
  });

  it('routes Mistral Arcamage proxy requests through the controlled LLM proxy', async () => {
    postMock.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: [{ type: 'text', text: 'checking' }] },
            { type: 'text', text: 'done' },
          ],
          tool_calls: [{
            id: 'call_abc1',
            type: 'function',
            function: {
              name: 'card_set_field',
              arguments: '{"path":"data.name","value":"Ada"}',
            },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    const onTextDelta = vi.fn();
    const onThinkingDelta = vi.fn();

    const turn = await requestAssistantTurn({
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'hello' },
      ],
      supplier: {
        provider: 'mistral',
        api: 'mistral-conversations',
        transport: 'arcamage-proxy',
        baseUrl: 'https://api.mistral.ai',
        apiKey: 'sk-mistral-test',
        model: 'mistral-test',
        maxTokens: 4096,
      },
      tools: [{ name: 'card_set_field', parameters: { type: 'object' } }],
      toolChoice: 'required',
      onTextDelta,
      onThinkingDelta,
    });

    expect(postMock).toHaveBeenCalledWith('/api/llm/proxy', expect.objectContaining({
      provider: 'mistral',
      api: 'mistral-conversations',
      base_url: 'https://api.mistral.ai',
      api_key: 'sk-mistral-test',
      method: 'POST',
      path: '/v1/chat/completions',
      stream: false,
      body: expect.objectContaining({
        model: 'mistral-test',
        messages: [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'hello' },
        ],
        stream: false,
        max_tokens: 4096,
        temperature: 1,
        tool_choice: 'required',
        tools: [{
          type: 'function',
          function: {
            name: 'card_set_field',
            description: '',
            parameters: { type: 'object' },
            strict: false,
          },
        }],
      }),
    }), { timeout: 60000 });
    expect(streamMock).not.toHaveBeenCalled();
    expect(onTextDelta).toHaveBeenCalledWith('done');
    expect(onThinkingDelta).toHaveBeenCalledWith('checking');
    expect(turn.stopReason).toBe('toolUse');
    expect(turn.text).toBe('done');
    expect(turn.thinking).toBe('checking');
    expect(turn.toolCalls).toEqual([{
      id: 'call_abc1',
      name: 'card_set_field',
      arguments: { path: 'data.name', value: 'Ada' },
    }]);
  });

  it('serializes Mistral follow-up tool results for proxy rounds', async () => {
    postMock.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: 'updated',
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    const turn = await requestAssistantTurn({
      messages: [
        { role: 'user', content: 'rename' },
        {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'call_abc1',
            name: 'card_set_field',
            arguments: { path: 'data.name', value: 'Ada' },
          }],
        },
        {
          role: 'toolResult',
          toolCallId: 'call_abc1',
          toolName: 'card_set_field',
          content: [{ type: 'text', text: '{"ok":true}' }],
        },
      ],
      supplier: {
        provider: 'mistral',
        api: 'mistral-conversations',
        transport: 'arcamage-proxy',
        baseUrl: 'https://api.mistral.ai/v1',
        apiKey: 'sk-mistral-test',
        model: 'mistral-test',
      },
      tools: [],
    });

    expect(postMock.mock.calls[0][1].path).toBe('/chat/completions');
    expect(postMock.mock.calls[0][1].body.messages).toEqual([
      { role: 'user', content: 'rename' },
      {
        role: 'assistant',
        tool_calls: [{
          id: 'call_abc1',
          type: 'function',
          function: {
            name: 'card_set_field',
            arguments: '{"path":"data.name","value":"Ada"}',
          },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'call_abc1',
        name: 'card_set_field',
        content: '{"ok":true}',
      },
    ]);
    expect(turn.text).toBe('updated');
  });

  it('serializes Mistral error tool results for retry proxy rounds', async () => {
    postMock.mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_retry',
            type: 'function',
            function: {
              name: 'card_set_field',
              arguments: '{"path":"data.name","value":"Ada"}',
            },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    const turn = await requestAssistantTurn({
      messages: [
        { role: 'user', content: 'rename' },
        {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'call_abc1',
            name: 'card_set_field',
            arguments: { path: 'data.name', value: 'Ada' },
          }],
        },
        {
          role: 'toolResult',
          toolCallId: 'call_abc1',
          toolName: 'card_set_field',
          content: [{ type: 'text', text: 'temporary failure' }],
          isError: true,
        },
      ],
      supplier: {
        provider: 'mistral',
        api: 'mistral-conversations',
        transport: 'arcamage-proxy',
        baseUrl: 'https://api.mistral.ai',
        apiKey: 'sk-mistral-test',
        model: 'mistral-test',
      },
      tools: [{ name: 'card_set_field', parameters: { type: 'object' } }],
      toolChoice: 'required',
    });

    expect(postMock.mock.calls[0][1].body.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call_abc1',
      name: 'card_set_field',
      content: '[tool error] temporary failure',
    });
    expect(turn.stopReason).toBe('toolUse');
    expect(turn.toolCalls).toEqual([{
      id: 'call_retry',
      name: 'card_set_field',
      arguments: { path: 'data.name', value: 'Ada' },
    }]);
  });

  it('fails explicitly for unsupported Arcamage proxy protocols', async () => {
    await expect(requestAssistantTurn({
      messages: [{ role: 'user', content: 'hello' }],
      supplier: {
        provider: 'aws-bedrock',
        api: 'bedrock-converse',
        transport: 'arcamage-proxy',
        baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
        apiKey: 'sk-test',
        model: 'bedrock-test',
      },
      tools: [],
    })).rejects.toThrow(
      'Arcamage LLM proxy currently supports openai-completions, openai-responses, anthropic-messages, google-generative-ai, and mistral-conversations only',
    );
    expect(postMock).not.toHaveBeenCalled();
    expect(streamMock).not.toHaveBeenCalled();
  });
});
