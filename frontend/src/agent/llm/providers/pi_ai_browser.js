import { supplierToModel } from '../model.js';
import { contentToText, toInternalMessages } from '../messages.js';
import { toPiAiTools } from '../tools.js';
import {
  createAssistantTurnAssembler,
  isUsableAssistantTurn,
  piAiMessageToAssistantTurn,
} from '../events.js';

const PI_AI_BROWSER_APIS = new Set([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'mistral-conversations',
]);

function createEmptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function normalizeToolArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toPiAiContentBlocks(content) {
  return (Array.isArray(content) ? content : [])
    .map((block) => {
      if (block?.type === 'text') {
        return { type: 'text', text: String(block.text || '') };
      }
      if (block?.type === 'thinking') {
        return { type: 'thinking', thinking: String(block.thinking ?? block.text ?? '') };
      }
      if (block?.type === 'toolCall') {
        return {
          type: 'toolCall',
          id: String(block.id || ''),
          name: String(block.name || ''),
          arguments: normalizeToolArguments(block.arguments),
        };
      }
      return null;
    })
    .filter(Boolean);
}

function toPiAiMessages(messages, supplier) {
  return toInternalMessages(messages)
    .filter((message) => message.role !== 'system')
    .map((message) => {
      if (message.role === 'user') {
        return {
          role: 'user',
          content: contentToText(message.content),
          timestamp: message.timestamp || Date.now(),
        };
      }

      if (message.role === 'toolResult') {
        return {
          role: 'toolResult',
          toolCallId: String(message.toolCallId || ''),
          toolName: String(message.toolName || ''),
          content: toPiAiContentBlocks(message.content),
          isError: message.isError === true,
          timestamp: message.timestamp || Date.now(),
        };
      }

      if (message.role === 'assistant') {
        const content = toPiAiContentBlocks(message.content);
        return {
          role: 'assistant',
          content,
          api: message.api || supplier.api,
          provider: message.provider || supplier.provider,
          model: message.model || supplier.model,
          usage: message.usage || createEmptyUsage(),
          stopReason: message.stopReason || (content.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop'),
          timestamp: message.timestamp || Date.now(),
        };
      }

      return null;
    })
    .filter(Boolean);
}

function extractSystemPrompt(messages) {
  return toInternalMessages(messages)
    .filter((message) => message.role === 'system')
    .map((message) => contentToText(message.content))
    .filter(Boolean)
    .join('\n\n');
}

function toPiAiContext({ messages, tools, supplier }) {
  return {
    systemPrompt: extractSystemPrompt(messages),
    messages: toPiAiMessages(messages, supplier),
    tools: toPiAiTools(tools),
  };
}

function eventToolCall(event) {
  const block = event?.partial?.content?.[event.contentIndex];
  return {
    id: block?.id || '',
    name: block?.name || '',
    argumentsDelta: event?.delta || '',
  };
}

function createPiAiOptions({ supplier, toolChoice, signal }) {
  return {
    apiKey: supplier.apiKey,
    temperature: supplier.temperature,
    maxTokens: supplier.maxTokens,
    signal,
    headers: supplier.headers,
    toolChoice,
    reasoning: supplier.reasoning ? 'medium' : undefined,
    reasoningEffort: supplier.reasoning ? 'medium' : undefined,
  };
}

export function canUsePiAiBrowserProvider(supplier) {
  if (!supplier || supplier.transport !== 'direct') return false;
  return PI_AI_BROWSER_APIS.has(supplier.api);
}

export async function requestPiAiBrowserTurn({
  supplier,
  internalMessages,
  tools,
  toolChoice,
  signal,
  onTextDelta,
  onThinkingDelta,
}) {
  const { stream } = await import('@earendil-works/pi-ai');
  const model = supplierToModel(supplier);
  const context = toPiAiContext({ messages: internalMessages, tools, supplier });
  const options = createPiAiOptions({ supplier, toolChoice, signal });
  const assembler = createAssistantTurnAssembler();
  let finalTurn = null;

  const eventStream = stream(model, context, options);
  for await (const event of eventStream) {
    if (event?.type === 'text_delta') {
      onTextDelta?.(event.delta || '');
      assembler.apply({ type: 'text_delta', delta: event.delta || '' });
    } else if (event?.type === 'thinking_delta') {
      onThinkingDelta?.(event.delta || '');
      assembler.apply({ type: 'thinking_delta', delta: event.delta || '' });
    } else if (event?.type === 'toolcall_delta') {
      assembler.apply({ type: 'toolcall_delta', ...eventToolCall(event) });
    } else if (event?.type === 'toolcall_end') {
      assembler.apply({ type: 'toolcall_end', toolCall: event.toolCall });
    } else if (event?.type === 'done') {
      finalTurn = piAiMessageToAssistantTurn(event.message);
    } else if (event?.type === 'error') {
      const message = event.error?.errorMessage || '供应商调用失败';
      const error = new Error(message);
      error.assistantMessage = event.error;
      throw error;
    }
  }

  if (isUsableAssistantTurn(finalTurn)) {
    return finalTurn;
  }

  return assembler.toTurn({
    rawMessage: finalTurn?.rawMessage || null,
    usage: finalTurn?.usage || null,
    diagnostics: finalTurn?.diagnostics || [],
  });
}
