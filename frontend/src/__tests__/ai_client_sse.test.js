import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamCompleteChat } from '../components/ai_client.js';

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

describe('ai_client streamCompleteChat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('assembles fragmented delta.tool_calls arguments by index', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'set_field', arguments: '{"path":"data.name","value":"' },
            }],
          },
        }],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: 'Alice"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      })}\n\n`,
      'data: [DONE]\n\n',
    ]));

    const result = await streamCompleteChat({
      messages: [{ role: 'user', content: 'rename' }],
      model: 'test-model',
      baseUrl: 'https://example.com',
      apiKey: 'sk-test',
      useProxy: false,
      tools: [],
      toolChoice: 'auto',
    });

    const message = result?.choices?.[0]?.message;
    expect(Array.isArray(message?.tool_calls)).toBe(true);
    expect(message.tool_calls[0].function.name).toBe('set_field');
    expect(message.tool_calls[0].function.arguments).toBe('{"path":"data.name","value":"Alice"}');
    expect(result?.choices?.[0]?.finish_reason).toBe('tool_calls');
  });

  it('assembles fragmented delta.tool_calls arguments by id when index is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'append_entry', arguments: '{"path":"data.alternate_greetings","value":"你好' },
            }],
          },
        }],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              id: 'call_1',
              function: { arguments: '，世界"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      })}\n\n`,
      'data: [DONE]\n\n',
    ]));

    const result = await streamCompleteChat({
      messages: [{ role: 'user', content: 'append greeting' }],
      model: 'test-model',
      baseUrl: 'https://example.com',
      apiKey: 'sk-test',
      useProxy: false,
      tools: [],
      toolChoice: 'auto',
    });

    const message = result?.choices?.[0]?.message;
    expect(Array.isArray(message?.tool_calls)).toBe(true);
    expect(message.tool_calls).toHaveLength(1);
    expect(message.tool_calls[0].function.name).toBe('append_entry');
    expect(message.tool_calls[0].function.arguments).toBe('{"path":"data.alternate_greetings","value":"你好，世界"}');
  });

  it('continues tool-call arguments on last call when index/id are absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              type: 'function',
              function: { name: 'set_field', arguments: '{"path":"data.name","value":"Ali' },
            }],
          },
        }],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              function: { arguments: 'ce"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      })}\n\n`,
      'data: [DONE]\n\n',
    ]));

    const result = await streamCompleteChat({
      messages: [{ role: 'user', content: 'rename' }],
      model: 'test-model',
      baseUrl: 'https://example.com',
      apiKey: 'sk-test',
      useProxy: false,
      tools: [],
      toolChoice: 'auto',
    });

    const message = result?.choices?.[0]?.message;
    expect(Array.isArray(message?.tool_calls)).toBe(true);
    expect(message.tool_calls).toHaveLength(1);
    expect(message.tool_calls[0].function.name).toBe('set_field');
    expect(message.tool_calls[0].function.arguments).toBe('{"path":"data.name","value":"Alice"}');
  });

  it('collects streamed text content into assistant message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ]));

    const result = await streamCompleteChat({
      messages: [{ role: 'user', content: 'say hello' }],
      model: 'test-model',
      baseUrl: 'https://example.com',
      apiKey: 'sk-test',
      useProxy: false,
      tools: [],
      toolChoice: 'auto',
    });

    expect(result?.choices?.[0]?.message?.content).toBe('Hello world');
    expect(result?.choices?.[0]?.finish_reason).toBe('stop');
  });

  it('handles CRLF-delimited SSE blocks and forwards onDelta callback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi ' } }] })}\r\n\r\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'there' }, finish_reason: 'stop' }] })}\r\n\r\n`,
      'data: [DONE]\r\n\r\n',
    ]));

    const onDelta = vi.fn();
    const result = await streamCompleteChat({
      messages: [{ role: 'user', content: 'say hi' }],
      model: 'test-model',
      baseUrl: 'https://example.com',
      apiKey: 'sk-test',
      useProxy: false,
      tools: [],
      toolChoice: 'auto',
      onDelta,
    });

    expect(onDelta).toHaveBeenCalledTimes(2);
    expect(onDelta).toHaveBeenNthCalledWith(1, 'Hi ');
    expect(onDelta).toHaveBeenNthCalledWith(2, 'there');
    expect(result?.choices?.[0]?.message?.content).toBe('Hi there');
    expect(result?.choices?.[0]?.finish_reason).toBe('stop');
  });

  it('extracts text from structured delta content arrays', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: [{ type: 'text', text: 'A' }] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: [{ type: 'output_text', text: 'B' }] }, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ]));

    const onDelta = vi.fn();
    const result = await streamCompleteChat({
      messages: [{ role: 'user', content: 'letters' }],
      model: 'test-model',
      baseUrl: 'https://example.com',
      apiKey: 'sk-test',
      useProxy: false,
      tools: [],
      toolChoice: 'auto',
      onDelta,
    });

    expect(onDelta).toHaveBeenNthCalledWith(1, 'A');
    expect(onDelta).toHaveBeenNthCalledWith(2, 'B');
    expect(result?.choices?.[0]?.message?.content).toBe('AB');
  });

  it('routes streaming reasoning to onThinkingDelta and keeps正文 clean', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先分析', content: '结论：' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: '再检查', content: '可执行' }, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ]));

    const onDelta = vi.fn();
    const onThinkingDelta = vi.fn();
    const result = await streamCompleteChat({
      messages: [{ role: 'user', content: 'do it' }],
      model: 'test-model',
      baseUrl: 'https://example.com',
      apiKey: 'sk-test',
      useProxy: false,
      tools: [],
      toolChoice: 'auto',
      onDelta,
      onThinkingDelta,
    });

    expect(onDelta).toHaveBeenNthCalledWith(1, '结论：');
    expect(onDelta).toHaveBeenNthCalledWith(2, '可执行');
    expect(onThinkingDelta).toHaveBeenNthCalledWith(1, '先分析');
    expect(onThinkingDelta).toHaveBeenNthCalledWith(2, '再检查');
    expect(result?.choices?.[0]?.message?.content).toBe('结论：可执行');
    expect(result?.choices?.[0]?.message?.reasoning_content).toBe('先分析再检查');
  });
});
