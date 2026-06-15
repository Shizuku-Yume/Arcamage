import {
  CONTENT_BLOCK_TYPES,
  MESSAGE_ROLES,
  createTextBlock,
  createThinkingBlock,
  createToolCallBlock,
} from './types.js';
import { toPiAiTools } from './tools.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object';
}

function normalizeBlock(block) {
  if (typeof block === 'string') return createTextBlock(block);
  if (!isObject(block)) return null;

  if (block.type === CONTENT_BLOCK_TYPES.TOOL_CALL || block.type === 'tool_use') {
    return createToolCallBlock({
      id: block.id || block.toolCallId || '',
      name: block.name || block.function?.name || '',
      arguments: Object.prototype.hasOwnProperty.call(block, 'arguments')
        ? block.arguments
        : (block.input ?? block.function?.arguments ?? {}),
    });
  }

  if (block.type === CONTENT_BLOCK_TYPES.THINKING || block.type === 'reasoning') {
    return createThinkingBlock(block.text ?? block.content ?? block.delta ?? '');
  }

  if (block.type === CONTENT_BLOCK_TYPES.TEXT || block.type === 'output_text') {
    return createTextBlock(block.text ?? block.content ?? block.delta ?? '');
  }

  if (Object.prototype.hasOwnProperty.call(block, 'text')) {
    return createTextBlock(block.text);
  }
  if (Object.prototype.hasOwnProperty.call(block, 'content')) {
    return createTextBlock(block.content);
  }
  return null;
}

export function normalizeContentBlocks(content) {
  if (Array.isArray(content)) {
    return content
      .map((block) => normalizeBlock(block))
      .filter(Boolean);
  }
  if (content === undefined || content === null) return [];
  return [createTextBlock(content)];
}

export function contentToText(content) {
  return normalizeContentBlocks(content)
    .filter((block) => block.type === CONTENT_BLOCK_TYPES.TEXT)
    .map((block) => block.text || '')
    .join('');
}

export function contentToThinking(content) {
  return normalizeContentBlocks(content)
    .filter((block) => block.type === CONTENT_BLOCK_TYPES.THINKING)
    .map((block) => block.text || '')
    .join('\n');
}

export function contentToToolCalls(content) {
  return normalizeContentBlocks(content)
    .filter((block) => block.type === CONTENT_BLOCK_TYPES.TOOL_CALL)
    .map((block) => ({
      id: block.id || '',
      name: block.name || '',
      arguments: block.arguments ?? {},
    }))
    .filter((call) => call.name || call.id);
}

function legacyToolCallToBlock(toolCall) {
  if (!isObject(toolCall)) return null;
  const fn = isObject(toolCall.function) ? toolCall.function : toolCall;
  const name = typeof fn.name === 'string' ? fn.name : '';
  if (!name) return null;
  return createToolCallBlock({
    id: toolCall.id || '',
    name,
    arguments: Object.prototype.hasOwnProperty.call(fn, 'arguments') ? fn.arguments : (toolCall.arguments ?? {}),
  });
}

function legacyFunctionCallToBlock(functionCall) {
  if (!isObject(functionCall) || !functionCall.name) return null;
  return createToolCallBlock({
    id: '',
    name: functionCall.name,
    arguments: Object.prototype.hasOwnProperty.call(functionCall, 'arguments') ? functionCall.arguments : {},
  });
}

export function createInternalTextMessage(role, text, extra = {}) {
  return {
    ...extra,
    role,
    content: [createTextBlock(text)],
  };
}

export function toInternalMessage(message) {
  if (!message || typeof message !== 'object') return null;

  if (message.role === MESSAGE_ROLES.TOOL_RESULT || message.role === 'tool') {
    return {
      role: MESSAGE_ROLES.TOOL_RESULT,
      toolCallId: message.toolCallId || message.tool_call_id || '',
      toolName: message.toolName || message.name || '',
      content: normalizeContentBlocks(message.content),
      isError: message.isError === true,
      timestamp: message.timestamp,
    };
  }

  const role = [MESSAGE_ROLES.SYSTEM, MESSAGE_ROLES.USER, MESSAGE_ROLES.ASSISTANT].includes(message.role)
    ? message.role
    : MESSAGE_ROLES.USER;
  const content = normalizeContentBlocks(message.content);

  if (role === MESSAGE_ROLES.ASSISTANT) {
    if (Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        const block = legacyToolCallToBlock(toolCall);
        if (block) content.push(block);
      }
    } else if (message.tool_calls && typeof message.tool_calls === 'object') {
      const block = legacyToolCallToBlock(message.tool_calls);
      if (block) content.push(block);
    }

    const functionCallBlock = legacyFunctionCallToBlock(message.function_call);
    if (functionCallBlock) content.push(functionCallBlock);
  }

  return {
    role,
    content,
    timestamp: message.timestamp,
  };
}

export function toInternalMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => toInternalMessage(message))
    .filter(Boolean);
}

function stringifyToolArguments(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toLegacyToolCall(toolCall, index) {
  return {
    id: toolCall.id || `call_${index + 1}`,
    type: 'function',
    function: {
      name: toolCall.name || '',
      arguments: stringifyToolArguments(toolCall.arguments),
    },
  };
}

export function toLegacyOpenAiMessages(messages) {
  return toInternalMessages(messages).map((message) => {
    if (message.role === MESSAGE_ROLES.TOOL_RESULT) {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId || '',
        content: contentToText(message.content),
      };
    }

    const legacy = {
      role: message.role,
      content: contentToText(message.content),
    };

    if (message.role === MESSAGE_ROLES.ASSISTANT) {
      const toolCalls = contentToToolCalls(message.content);
      if (toolCalls.length > 0) {
        legacy.tool_calls = toolCalls.map((toolCall, index) => toLegacyToolCall(toolCall, index));
      }
    }

    return legacy;
  });
}

export function toPiAiContext({ systemPrompt = '', messages = [], tools = [] } = {}) {
  return {
    systemPrompt,
    messages: toInternalMessages(messages),
    tools: toPiAiTools(tools),
  };
}

export function toolResultToInternalMessage({ toolCallId = '', toolName = '', result = null, isError = false } = {}) {
  const content = typeof result === 'string' ? result : JSON.stringify(result ?? null);
  return {
    role: MESSAGE_ROLES.TOOL_RESULT,
    toolCallId: String(toolCallId || ''),
    toolName: String(toolName || ''),
    content: [createTextBlock(content)],
    isError,
  };
}

export function assistantTurnToInternalMessage(turn = {}) {
  const content = [];
  if (Object.prototype.hasOwnProperty.call(turn, 'text')) {
    content.push(createTextBlock(turn.text || ''));
  }
  if (turn.thinking) {
    content.push(createThinkingBlock(turn.thinking));
  }
  for (const toolCall of Array.isArray(turn.toolCalls) ? turn.toolCalls : []) {
    content.push(createToolCallBlock(toolCall));
  }
  return {
    role: MESSAGE_ROLES.ASSISTANT,
    content,
  };
}
