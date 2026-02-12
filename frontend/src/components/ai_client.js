/**
 * AI SSE client helpers
 *
 * Supports direct OpenAI-compatible streaming and backend proxy streaming.
 */

const DONE_SIGNAL = '[DONE]';

function createToolCallAssembler() {
  const calls = [];
  const idToIndex = new Map();
  let lastCallIndex = -1;

  const ensureCall = (index) => {
    const safeIndex = Number.isInteger(index) && index >= 0 ? index : calls.length;
    if (!calls[safeIndex]) {
      calls[safeIndex] = {
        id: '',
        type: 'function',
        function: {
          name: '',
          arguments: '',
        },
      };
    }
    return calls[safeIndex];
  };

  const normalizeArgumentsChunk = (value) => {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return '';
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const isCompleteJsonObject = (value) => {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return false;
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  };

  const resolveTargetIndex = (entry) => {
    const hasExplicitIndex = Number.isInteger(entry?.index) && entry.index >= 0;
    if (hasExplicitIndex) {
      return entry.index;
    }

    const entryId = typeof entry?.id === 'string' ? entry.id : '';
    if (entryId && idToIndex.has(entryId)) {
      return idToIndex.get(entryId);
    }

    const fn = entry?.function;
    const hasArgsChunk = Boolean(
      fn
      && typeof fn === 'object'
      && Object.prototype.hasOwnProperty.call(fn, 'arguments')
    );
    const entryName = typeof fn?.name === 'string' ? fn.name : '';

    if (lastCallIndex >= 0 && !entryId && !entryName && hasArgsChunk) {
      return lastCallIndex;
    }

    if (lastCallIndex >= 0 && !entryId && entryName && hasArgsChunk) {
      const current = calls[lastCallIndex];
      const chunk = normalizeArgumentsChunk(fn.arguments);
      const currentArgs = current?.function?.arguments || '';
      if (
        current?.function?.name === entryName
        && !current?.id
        && !isCompleteJsonObject(chunk)
        && !isCompleteJsonObject(currentArgs)
      ) {
        return lastCallIndex;
      }
    }

    return calls.length;
  };

  const applyToolCallDeltas = (entries) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const targetIndex = resolveTargetIndex(entry);
      const call = ensureCall(targetIndex);
      lastCallIndex = targetIndex;
      if (typeof entry.id === 'string' && entry.id) {
        call.id = entry.id;
        idToIndex.set(entry.id, targetIndex);
      }
      if (typeof entry.type === 'string' && entry.type) {
        call.type = entry.type;
      }

      const fn = entry.function;
      if (fn && typeof fn === 'object') {
        if (typeof fn.name === 'string' && fn.name) {
          call.function.name = fn.name;
        }
        if (Object.prototype.hasOwnProperty.call(fn, 'arguments')) {
          call.function.arguments += normalizeArgumentsChunk(fn.arguments);
        }
      }
    }
  };

  const toArray = () => calls
    .filter((item) => item && (item.function?.name || item.id || item.function?.arguments))
    .map((item) => ({
      id: item.id || undefined,
      type: item.type || 'function',
      function: {
        name: item.function?.name || '',
        arguments: item.function?.arguments || '',
      },
    }));

  return {
    applyToolCallDeltas,
    toArray,
  };
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return '';
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildDirectChatUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return '';
  try {
    const url = new URL('/v1/chat/completions', normalized);
    return url.toString();
  } catch {
    return '';
  }
}

function buildProxyPayload({ messages, model, baseUrl, apiKey, temperature, stream, tools, toolChoice }) {
  const normalizedTools = normalizeTools(tools);
  return {
    base_url: baseUrl,
    api_key: apiKey,
    model,
    messages,
    stream,
    temperature,
    tools: normalizedTools,
    tool_choice: toolChoice,
  };
}

function buildDirectPayload({ messages, model, temperature, stream, tools, toolChoice }) {
  const normalizedTools = normalizeTools(tools);
  return {
    model,
    messages,
    stream,
    temperature,
    tools: normalizedTools,
    tool_choice: toolChoice,
  };
}

function normalizeTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  if (tools.length === 0) return [];
  const hasTyped = tools.some((tool) => tool?.type === 'function' && tool?.function);
  if (hasTyped) return tools;
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool?.name,
      description: tool?.description,
      parameters: tool?.parameters,
    },
  }));
}

function extractTextFragment(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => extractTextFragment(item, depth + 1)).join('');
  }
  if (typeof value !== 'object') return '';

  const directKeys = ['text', 'content', 'output_text', 'delta'];
  for (const key of directKeys) {
    const direct = value[key];
    if (typeof direct === 'string') return direct;
  }

  const nestedKeys = ['text', 'content', 'output_text', 'delta', 'parts'];
  for (const key of nestedKeys) {
    const nested = value[key];
    if (nested !== null && nested !== undefined) {
      const resolved = extractTextFragment(nested, depth + 1);
      if (resolved) return resolved;
    }
  }

  return '';
}

function extractReasoningFragment(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractReasoningFragment(item, depth + 1)).join('');
  }
  if (typeof value !== 'object') return '';

  const reasoningKeys = [
    'reasoning_content',
    'reasoning',
    'thinking',
    'reasoning_text',
    'thought',
  ];

  for (const key of reasoningKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const fragment = extractTextFragment(value[key], depth + 1);
    if (fragment) return fragment;
  }

  return '';
}

function normalizeSseChunk(chunk) {
  return String(chunk || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseSseEvents(chunk, state) {
  const buffer = state.buffer + normalizeSseChunk(chunk);
  const parts = buffer.split('\n\n');
  state.buffer = parts.pop() || '';
  return parts;
}

function parseSseBlock(block) {
  const lines = block.split('\n');
  let eventType = 'message';
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  return {
    eventType,
    data: dataLines.join('\n'),
  };
}

function parseSsePayload(payload) {
  try {
    const data = JSON.parse(payload);
    const choice = data?.choices?.[0];
    const delta = choice?.delta;
    const deltaContent = extractTextFragment(delta?.content);
    const deltaText = extractTextFragment(delta?.text);
    const messageContent = extractTextFragment(choice?.message?.content);
    const choiceText = extractTextFragment(choice?.text);
    const deltaReasoning = extractReasoningFragment(delta);
    const messageReasoning = extractReasoningFragment(choice?.message);
    const choiceReasoning = extractReasoningFragment(choice);
    return {
      content: deltaContent || deltaText || messageContent || choiceText || '',
      reasoning: deltaReasoning || messageReasoning || choiceReasoning || '',
      deltaToolCalls: Array.isArray(delta?.tool_calls) ? delta.tool_calls : null,
      message: choice?.message || null,
      finishReason: choice?.finish_reason || null,
    };
  } catch {
    return {
      content: '',
      reasoning: '',
      deltaToolCalls: null,
      message: null,
      finishReason: null,
    };
  }
}

function buildError(code, message) {
  const error = new Error(message || 'AI 请求失败');
  error.code = code || 'UPSTREAM_ERROR';
  return error;
}

async function processSseStream({ response, signal, onDelta, onThinkingDelta, onError, onDone, onPayload }) {
  if (!response?.body) {
    throw buildError('NETWORK_ERROR', '响应为空，无法读取流');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { buffer: '' };

  for (;;) {
    if (signal?.aborted) {
      try {
        reader.cancel();
      } catch {
        // ignore
      }
      return;
    }

    const { done, value } = await reader.read();
    if (done) {
      const tail = decoder.decode();
      if (tail) {
        const tailBlocks = parseSseEvents(tail, state);
        for (const block of tailBlocks) {
          if (!block.trim()) continue;
          const { eventType, data } = parseSseBlock(block);

          if (!data) continue;

          if (eventType === 'error') {
            try {
              const payload = JSON.parse(data);
              onError?.(buildError(payload?.code, payload?.message));
            } catch {
              onError?.(buildError('UPSTREAM_ERROR', data));
            }
            return;
          }

          if (data === DONE_SIGNAL) {
            onDone?.();
            return;
          }

          const payload = parseSsePayload(data);
          onPayload?.(payload);
          if (payload.content) onDelta?.(payload.content);
          if (payload.reasoning) onThinkingDelta?.(payload.reasoning);
        }
      }

      if (state.buffer.trim()) {
        const { eventType, data } = parseSseBlock(state.buffer);
        state.buffer = '';

        if (data) {
          if (eventType === 'error') {
            try {
              const payload = JSON.parse(data);
              onError?.(buildError(payload?.code, payload?.message));
            } catch {
              onError?.(buildError('UPSTREAM_ERROR', data));
            }
            return;
          }

          if (data === DONE_SIGNAL) {
            onDone?.();
            return;
          }

          const payload = parseSsePayload(data);
          onPayload?.(payload);
          if (payload.content) onDelta?.(payload.content);
          if (payload.reasoning) onThinkingDelta?.(payload.reasoning);
        }
      }

      break;
    }

    const chunk = decoder.decode(value, { stream: true });
    const blocks = parseSseEvents(chunk, state);

    for (const block of blocks) {
      if (!block.trim()) continue;
      const { eventType, data } = parseSseBlock(block);

      if (!data) continue;

      if (eventType === 'error') {
        try {
          const payload = JSON.parse(data);
          onError?.(buildError(payload?.code, payload?.message));
        } catch {
          onError?.(buildError('UPSTREAM_ERROR', data));
        }
        return;
      }

      if (data === DONE_SIGNAL) {
        onDone?.();
        return;
      }

      const payload = parseSsePayload(data);
      onPayload?.(payload);
      if (payload.content) onDelta?.(payload.content);
      if (payload.reasoning) onThinkingDelta?.(payload.reasoning);
    }
  }

  onDone?.();
}

async function startStream({
  messages,
  model,
  baseUrl,
  apiKey,
  useProxy,
  temperature,
  tools,
  toolChoice,
  signal,
  onDelta,
  onThinkingDelta,
  onError,
  onDone,
  onPayload,
}) {
  const payload = useProxy
    ? buildProxyPayload({ messages, model, baseUrl, apiKey, temperature, stream: true, tools, toolChoice })
    : buildDirectPayload({ messages, model, temperature, stream: true, tools, toolChoice });

  const url = useProxy ? '/api/proxy/chat' : buildDirectChatUrl(baseUrl);

  if (!url) {
    throw buildError('VALIDATION_ERROR', 'API 地址无效');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  };

  if (!useProxy) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    throw buildError('NETWORK_ERROR', error?.message || '网络请求失败');
  }

  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const errorPayload = await response.json();
      message = errorPayload?.error?.message || errorPayload?.message || message;
    } catch {
      // ignore parse errors
    }
    throw buildError('UPSTREAM_ERROR', message);
  }

  await processSseStream({
    response,
    signal,
    onDelta,
    onThinkingDelta,
    onError,
    onDone,
    onPayload,
  });
}

async function startCompletion({
  messages,
  model,
  baseUrl,
  apiKey,
  useProxy,
  temperature,
  tools,
  toolChoice,
  signal,
}) {
  const payload = useProxy
    ? buildProxyPayload({ messages, model, baseUrl, apiKey, temperature, stream: false, tools, toolChoice })
    : buildDirectPayload({ messages, model, temperature, stream: false, tools, toolChoice });

  const url = useProxy ? '/api/proxy/chat' : buildDirectChatUrl(baseUrl);
  if (!url) {
    throw buildError('VALIDATION_ERROR', 'API 地址无效');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (!useProxy) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    throw buildError('NETWORK_ERROR', error?.message || '网络请求失败');
  }

  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const errorPayload = await response.json();
      message = errorPayload?.error?.message || errorPayload?.message || message;
    } catch {
      // ignore parse errors
    }
    throw buildError('UPSTREAM_ERROR', message);
  }

  return response.json();
}

export function streamChat({
  messages,
  model,
  baseUrl,
  apiKey,
  useProxy = true,
  temperature = 0.7,
  tools,
  toolChoice,
  onDelta,
  onThinkingDelta,
  onError,
  onDone,
  onPayload,
}) {
  const controller = new AbortController();
  const promise = startStream({
    messages,
    model,
    baseUrl,
    apiKey,
    useProxy,
    temperature,
    tools,
    toolChoice,
    signal: controller.signal,
    onDelta,
    onThinkingDelta,
    onError,
    onDone,
    onPayload,
  });

  return { controller, promise };
}

export async function streamCompleteChat({
  messages,
  model,
  baseUrl,
  apiKey,
  useProxy = true,
  temperature = 0.7,
  tools,
  toolChoice,
  signal,
  onDelta,
  onThinkingDelta,
}) {
  const chunks = [];
  const reasoningChunks = [];
  const toolCallAssembler = createToolCallAssembler();
  let finishReason = null;
  let upstreamMessage = null;

  await startStream({
    messages,
    model,
    baseUrl,
    apiKey,
    useProxy,
    temperature,
    tools,
    toolChoice,
    signal,
    onDelta: (delta) => {
      chunks.push(delta);
      onDelta?.(delta);
    },
    onThinkingDelta: (delta) => {
      reasoningChunks.push(delta);
      onThinkingDelta?.(delta);
    },
    onPayload: (payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (Array.isArray(payload.deltaToolCalls)) {
        toolCallAssembler.applyToolCallDeltas(payload.deltaToolCalls);
      }
      if (payload.message && typeof payload.message === 'object') {
        upstreamMessage = payload.message;
        if (Array.isArray(payload.message.tool_calls)) {
          toolCallAssembler.applyToolCallDeltas(payload.message.tool_calls);
        }
      }
      if (payload.finishReason) {
        finishReason = payload.finishReason;
      }
    },
  });

  const assembledToolCalls = toolCallAssembler.toArray();
  const content = chunks.join('');
  const reasoningContent = reasoningChunks.join('');
  const message = {
    role: upstreamMessage?.role || 'assistant',
    content: content || upstreamMessage?.content || '',
  };

  const upstreamReasoning = extractReasoningFragment(upstreamMessage);
  if (reasoningContent || upstreamReasoning) {
    message.reasoning_content = reasoningContent || upstreamReasoning;
  }

  if (assembledToolCalls.length > 0) {
    message.tool_calls = assembledToolCalls;
  } else if (Array.isArray(upstreamMessage?.tool_calls) && upstreamMessage.tool_calls.length > 0) {
    message.tool_calls = upstreamMessage.tool_calls;
  }

  if (!message.tool_calls && upstreamMessage?.function_call) {
    message.function_call = upstreamMessage.function_call;
  }

  return {
    choices: [{
      message,
      finish_reason: finishReason,
    }],
  };
}

export async function completeChat({
  messages,
  model,
  baseUrl,
  apiKey,
  useProxy = true,
  temperature = 0.7,
  tools,
  toolChoice,
  signal,
}) {
  return startCompletion({
    messages,
    model,
    baseUrl,
    apiKey,
    useProxy,
    temperature,
    tools,
    toolChoice,
    signal,
  });
}

export default {
  streamChat,
  streamCompleteChat,
  completeChat,
};
