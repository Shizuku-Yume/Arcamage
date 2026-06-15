import { STOP_REASONS, createAssistantTurn } from './types.js';

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

export function normalizeThinkingText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitThinkTaggedContent(content) {
  const raw = String(content || '');
  if (!raw) {
    return { visibleText: '', thinkingText: '' };
  }

  const lower = raw.toLowerCase();
  const visibleParts = [];
  const thinkingParts = [];
  let cursor = 0;

  while (cursor < raw.length) {
    const open = lower.indexOf('<think>', cursor);
    if (open === -1) {
      visibleParts.push(raw.slice(cursor));
      break;
    }

    visibleParts.push(raw.slice(cursor, open));
    const thinkStart = open + 7;
    const close = lower.indexOf('</think>', thinkStart);
    if (close === -1) {
      thinkingParts.push(raw.slice(thinkStart));
      cursor = raw.length;
      break;
    }

    thinkingParts.push(raw.slice(thinkStart, close));
    cursor = close + 8;
  }

  return {
    visibleText: visibleParts.join('').replace(/<\/?think>/gi, ''),
    thinkingText: thinkingParts.join('\n'),
  };
}

function parseToolArguments(value, diagnostics) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    diagnostics.push({
      code: 'E_TOOL_ARGUMENTS_JSON',
      message: 'Tool call arguments are not valid JSON',
    });
    return value;
  }
}

function normalizeLegacyToolCall(raw, diagnostics) {
  if (!raw || typeof raw !== 'object') return null;
  const fn = raw.function && typeof raw.function === 'object' ? raw.function : raw;
  const name = typeof fn.name === 'string' ? fn.name : '';
  if (!name) return null;
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    name,
    arguments: parseToolArguments(
      Object.prototype.hasOwnProperty.call(fn, 'arguments') ? fn.arguments : raw.arguments,
      diagnostics,
    ),
  };
}

function normalizeLegacyToolCalls(message, diagnostics) {
  if (!message || typeof message !== 'object') return [];
  const calls = [];
  const raw = message.tool_calls;

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const normalized = normalizeLegacyToolCall(item, diagnostics);
      if (normalized) calls.push(normalized);
    }
  } else if (raw && typeof raw === 'object') {
    const normalized = normalizeLegacyToolCall(raw, diagnostics);
    if (normalized) calls.push(normalized);
  }

  const functionCall = message.function_call;
  if (functionCall?.name) {
    calls.push({
      id: '',
      name: functionCall.name,
      arguments: parseToolArguments(functionCall.arguments, diagnostics),
    });
  }

  return calls;
}

function normalizeStopReason(finishReason, toolCalls) {
  if (toolCalls.length > 0 || finishReason === 'tool_calls' || finishReason === 'function_call') {
    return STOP_REASONS.TOOL_USE;
  }
  if (finishReason === STOP_REASONS.TOOL_USE) return STOP_REASONS.TOOL_USE;
  if (finishReason === 'length') return STOP_REASONS.LENGTH;
  if (finishReason === 'error') return STOP_REASONS.ERROR;
  if (finishReason === STOP_REASONS.ABORTED) return STOP_REASONS.ABORTED;
  return STOP_REASONS.STOP;
}

export function legacyCompletionToAssistantTurn(completion) {
  const choice = completion?.choices?.[0];
  const message = choice?.message || null;
  if (!message || typeof message !== 'object') return null;

  const diagnostics = [];
  const toolCalls = normalizeLegacyToolCalls(message, diagnostics);
  const content = extractTextFragment(message.content);
  const reasoning = extractReasoningFragment(message);

  return createAssistantTurn({
    text: content,
    thinking: reasoning,
    toolCalls,
    stopReason: normalizeStopReason(choice?.finish_reason, toolCalls),
    rawMessage: message,
    usage: completion?.usage || null,
    diagnostics,
  });
}

export function piAiMessageToAssistantTurn(message) {
  if (!message || typeof message !== 'object') return null;
  const content = Array.isArray(message.content) ? message.content : [];
  const diagnostics = [];
  const text = content
    .filter((block) => block?.type === 'text' || block?.type === 'output_text')
    .map((block) => block.text || block.content || '')
    .join('');
  const thinking = content
    .filter((block) => block?.type === 'thinking' || block?.type === 'reasoning')
    .map((block) => block.thinking || block.text || block.content || '')
    .join('\n');
  const toolCalls = content
    .filter((block) => block?.type === 'toolCall' || block?.type === 'tool_use')
    .map((block) => ({
      id: block.id || '',
      name: block.name || '',
      arguments: block.arguments ?? block.input ?? {},
    }))
    .filter((call) => call.name || call.id);

  return createAssistantTurn({
    text,
    thinking,
    toolCalls,
    stopReason: normalizeStopReason(message.stopReason || message.stop_reason, toolCalls),
    rawMessage: message,
    usage: message.usage || null,
    diagnostics,
  });
}

export function createAssistantTurnAssembler() {
  const textChunks = [];
  const thinkingChunks = [];
  const toolCalls = [];
  const idToIndex = new Map();
  let stopReason = STOP_REASONS.STOP;

  const ensureToolCall = (event) => {
    const id = typeof event?.id === 'string' ? event.id : '';
    if (id && idToIndex.has(id)) return toolCalls[idToIndex.get(id)];
    const call = {
      id,
      name: typeof event?.name === 'string' ? event.name : '',
      arguments: '',
    };
    toolCalls.push(call);
    if (id) idToIndex.set(id, toolCalls.length - 1);
    return call;
  };

  const apply = (event) => {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'text_delta') {
      textChunks.push(String(event.delta || ''));
      return;
    }
    if (event.type === 'thinking_delta') {
      thinkingChunks.push(String(event.delta || ''));
      return;
    }
    if (event.type === 'toolcall_delta') {
      const call = ensureToolCall(event);
      if (event.name) call.name = event.name;
      if (Object.prototype.hasOwnProperty.call(event, 'argumentsDelta')) {
        call.arguments += String(event.argumentsDelta ?? '');
      }
      stopReason = STOP_REASONS.TOOL_USE;
      return;
    }
    if (event.type === 'toolcall_end' && event.toolCall) {
      const call = ensureToolCall(event.toolCall);
      call.name = event.toolCall.name || call.name;
      call.arguments = event.toolCall.arguments ?? call.arguments;
      stopReason = STOP_REASONS.TOOL_USE;
      return;
    }
    if (event.type === 'error') {
      stopReason = STOP_REASONS.ERROR;
    }
  };

  const toTurn = (overrides = {}) => createAssistantTurn({
    text: textChunks.join(''),
    thinking: normalizeThinkingText(thinkingChunks.join('')),
    toolCalls: toolCalls.map((call) => ({ ...call })),
    stopReason,
    ...overrides,
  });

  return {
    apply,
    toTurn,
  };
}

export function isUsableAssistantTurn(turn) {
  if (!turn || typeof turn !== 'object') return false;
  if (Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) return true;
  return typeof turn.text === 'string';
}
