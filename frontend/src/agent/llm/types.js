export const MESSAGE_ROLES = Object.freeze({
  SYSTEM: 'system',
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL_RESULT: 'toolResult',
});

export const CONTENT_BLOCK_TYPES = Object.freeze({
  TEXT: 'text',
  THINKING: 'thinking',
  TOOL_CALL: 'toolCall',
});

export const STOP_REASONS = Object.freeze({
  STOP: 'stop',
  LENGTH: 'length',
  TOOL_USE: 'toolUse',
  ERROR: 'error',
  ABORTED: 'aborted',
});

export function createTextBlock(text = '') {
  return {
    type: CONTENT_BLOCK_TYPES.TEXT,
    text: String(text || ''),
  };
}

export function createThinkingBlock(text = '') {
  return {
    type: CONTENT_BLOCK_TYPES.THINKING,
    text: String(text || ''),
  };
}

export function createToolCallBlock({ id = '', name = '', arguments: args = {} } = {}) {
  return {
    type: CONTENT_BLOCK_TYPES.TOOL_CALL,
    id: String(id || ''),
    name: String(name || ''),
    arguments: args ?? {},
  };
}

export function createAssistantTurn(overrides = {}) {
  return {
    role: MESSAGE_ROLES.ASSISTANT,
    text: '',
    thinking: '',
    toolCalls: [],
    stopReason: STOP_REASONS.STOP,
    rawMessage: null,
    usage: null,
    diagnostics: [],
    ...overrides,
  };
}
