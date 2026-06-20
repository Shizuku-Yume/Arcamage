import { post } from '../../../api.js';
import { DEFAULT_MAX_TOKENS } from '../model.js';
import { contentToText, toLegacyOpenAiMessages, toInternalMessages } from '../messages.js';
import { toLegacyOpenAiTools } from '../tools.js';
import {
  isUsableAssistantTurn,
  legacyCompletionToAssistantTurn,
  normalizeThinkingText,
  piAiMessageToAssistantTurn,
  splitThinkTaggedContent,
} from '../events.js';

function resolveVersionedPath(baseUrl, resourcePath) {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
  return normalized.endsWith('/v1') ? resourcePath : `/v1${resourcePath}`;
}

const DONE_SIGNAL = '[DONE]';

function buildOpenAiCompletionsBody({ supplier, internalMessages, tools, toolChoice, stream = false }) {
  const body = {
    model: supplier.model,
    messages: toLegacyOpenAiMessages(internalMessages),
    stream,
  };
  if (supplier.temperature !== undefined && supplier.temperature !== null) {
    body.temperature = supplier.temperature;
  }
  const legacyTools = toLegacyOpenAiTools(tools);
  if (legacyTools !== undefined) {
    body.tools = legacyTools;
  }
  if (toolChoice !== undefined && toolChoice !== null) {
    body.tool_choice = toolChoice;
  }
  return body;
}

function extractStreamText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractStreamText(item)).join('');
  }
  if (!value || typeof value !== 'object') return '';
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (typeof value.output_text === 'string') return value.output_text;
  return '';
}

function extractStreamReasoning(value) {
  if (!value || typeof value !== 'object') return '';
  const keys = ['reasoning_content', 'reasoning', 'thinking', 'reasoning_text'];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const text = extractStreamText(value[key]);
      if (text) return text;
    }
  }
  return '';
}

function normalizeSseChunk(chunk) {
  return String(chunk || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseSseBlocks(chunk, state) {
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
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  return { eventType, data: dataLines.join('\n') };
}

function createStreamingToolCallAssembler() {
  const calls = [];
  const idToIndex = new Map();
  let lastIndex = -1;

  const resolveIndex = (entry) => {
    if (Number.isInteger(entry?.index) && entry.index >= 0) return entry.index;
    if (entry?.id && idToIndex.has(entry.id)) return idToIndex.get(entry.id);
    return lastIndex >= 0 ? lastIndex : calls.length;
  };

  const ensure = (index) => {
    if (!calls[index]) {
      calls[index] = {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      };
    }
    return calls[index];
  };

  const apply = (entries) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const index = resolveIndex(entry);
      const call = ensure(index);
      lastIndex = index;
      if (entry.id) {
        call.id = entry.id;
        idToIndex.set(entry.id, index);
      }
      if (entry.type) call.type = entry.type;
      const fn = entry.function || {};
      if (fn.name) call.function.name = fn.name;
      if (Object.prototype.hasOwnProperty.call(fn, 'arguments')) {
        call.function.arguments += typeof fn.arguments === 'string'
          ? fn.arguments
          : JSON.stringify(fn.arguments || {});
      }
    }
  };

  const toArray = () => calls
    .filter((call) => call?.id || call?.function?.name || call?.function?.arguments)
    .map((call) => ({
      id: call.id || undefined,
      type: call.type || 'function',
      function: {
        name: call.function?.name || '',
        arguments: call.function?.arguments || '',
      },
    }));

  return { apply, toArray };
}

function splitResponsesToolCallId(id) {
  const value = String(id || '');
  if (!value) return { callId: '', itemId: '' };
  const separator = value.indexOf('|');
  if (separator === -1) return { callId: value, itemId: '' };
  return {
    callId: value.slice(0, separator),
    itemId: value.slice(separator + 1),
  };
}

function toResponsesInputContent(content) {
  const text = contentToText(content);
  return text ? [{ type: 'input_text', text }] : [];
}

function toResponsesOutputContent(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === 'text' && String(block.text || ''))
    .map((block) => ({
      type: 'output_text',
      text: String(block.text || ''),
      annotations: [],
    }));
}

function toResponsesInput(internalMessages) {
  let fallbackItemIndex = 0;
  return toInternalMessages(internalMessages)
    .flatMap((message) => {
      if (message.role === 'system') {
        const content = contentToText(message.content);
        return content ? [{ role: 'system', content }] : [];
      }
      if (message.role === 'user') {
        const content = toResponsesInputContent(message.content);
        return content.length > 0 ? [{ role: 'user', content }] : [];
      }
      if (message.role === 'assistant') {
        const items = [];
        const content = toResponsesOutputContent(message.content);
        if (content.length > 0) {
          fallbackItemIndex += 1;
          items.push({
            type: 'message',
            role: 'assistant',
            content,
            status: 'completed',
            id: `msg_arcamage_${fallbackItemIndex}`,
          });
        }
        for (const block of Array.isArray(message.content) ? message.content : []) {
          if (block?.type !== 'toolCall') continue;
          const { callId, itemId } = splitResponsesToolCallId(block.id);
          fallbackItemIndex += 1;
          items.push({
            type: 'function_call',
            id: itemId || `fc_arcamage_${fallbackItemIndex}`,
            call_id: callId || `call_arcamage_${fallbackItemIndex}`,
            name: String(block.name || ''),
            arguments: JSON.stringify(block.arguments || {}),
          });
        }
        return items;
      }
      if (message.role === 'toolResult') {
        const { callId } = splitResponsesToolCallId(message.toolCallId);
        return [{
          type: 'function_call_output',
          call_id: callId || String(message.toolCallId || ''),
          output: contentToText(message.content) || (message.isError ? '[tool error]' : ''),
        }];
      }
      return [];
    });
}

function toResponsesTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description || '',
    parameters: tool.parameters || { type: 'object', properties: {} },
    strict: false,
  }));
}

function toResponsesToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  if (['auto', 'none', 'required'].includes(toolChoice)) return toolChoice;
  const name = toolChoice?.function?.name || toolChoice?.name;
  return name ? { type: 'function', name } : undefined;
}

function buildOpenAiResponsesBody({ supplier, internalMessages, tools, toolChoice }) {
  const body = {
    model: supplier.model,
    input: toResponsesInput(internalMessages),
    stream: false,
    store: false,
  };
  if (supplier.temperature !== undefined && supplier.temperature !== null) {
    body.temperature = supplier.temperature;
  }
  if (supplier.maxTokens) {
    body.max_output_tokens = supplier.maxTokens;
  }
  if (supplier.reasoning) {
    body.reasoning = { effort: 'medium', summary: 'auto' };
    body.include = ['reasoning.encrypted_content'];
  }
  const responsesTools = toResponsesTools(tools);
  if (responsesTools) body.tools = responsesTools;
  const responsesToolChoice = toResponsesToolChoice(toolChoice);
  if (responsesToolChoice) body.tool_choice = responsesToolChoice;
  return body;
}

function extractSystemPrompt(internalMessages) {
  return toInternalMessages(internalMessages)
    .filter((message) => message.role === 'system')
    .map((message) => contentToText(message.content))
    .filter(Boolean)
    .join('\n\n');
}

function toAnthropicContentBlocks(content) {
  const blocks = [];
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === 'text') {
      const text = String(block.text || '');
      if (text) blocks.push({ type: 'text', text });
    } else if (block?.type === 'toolCall') {
      blocks.push({
        type: 'tool_use',
        id: String(block.id || ''),
        name: String(block.name || ''),
        input: block.arguments && typeof block.arguments === 'object' ? block.arguments : {},
      });
    }
  }
  return blocks;
}

function toAnthropicMessages(internalMessages) {
  return toInternalMessages(internalMessages)
    .filter((message) => message.role !== 'system')
    .map((message) => {
      if (message.role === 'assistant') {
        const content = toAnthropicContentBlocks(message.content);
        return content.length > 0 ? { role: 'assistant', content } : null;
      }
      if (message.role === 'toolResult') {
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: String(message.toolCallId || ''),
            content: contentToText(message.content),
            is_error: message.isError === true,
          }],
        };
      }
      return {
        role: 'user',
        content: contentToText(message.content),
      };
    })
    .filter(Boolean);
}

function toAnthropicTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const normalized = tools
    .filter((tool) => tool?.name);
  if (normalized.length === 0) return undefined;
  return normalized.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    input_schema: tool.parameters || { type: 'object', properties: {} },
  }));
}

function toAnthropicToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  if (toolChoice === 'auto' || toolChoice === 'none') return { type: toolChoice };
  if (toolChoice === 'required') return { type: 'any' };
  const name = toolChoice?.function?.name || toolChoice?.name;
  if (name) return { type: 'tool', name };
  return undefined;
}

function buildAnthropicMessagesBody({ supplier, internalMessages, tools, toolChoice }) {
  const body = {
    model: supplier.model,
    max_tokens: supplier.maxTokens || DEFAULT_MAX_TOKENS,
    messages: toAnthropicMessages(internalMessages),
    stream: false,
  };
  const system = extractSystemPrompt(internalMessages);
  if (system) body.system = system;
  if (supplier.temperature !== undefined && supplier.temperature !== null) {
    body.temperature = supplier.temperature;
  }
  const anthropicTools = toAnthropicTools(tools);
  if (anthropicTools !== undefined) body.tools = anthropicTools;
  const anthropicToolChoice = toAnthropicToolChoice(toolChoice);
  if (anthropicToolChoice) body.tool_choice = anthropicToolChoice;
  return body;
}

function resolveGooglePath(baseUrl, model) {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
  const modelPath = `/models/${encodeURIComponent(model)}:generateContent`;
  return normalized.endsWith('/v1') || normalized.endsWith('/v1beta')
    ? modelPath
    : `/v1beta${modelPath}`;
}

function toGoogleParts(content) {
  return (Array.isArray(content) ? content : [])
    .map((block) => {
      if (block?.type === 'text') {
        const text = String(block.text || '');
        return text ? { text } : null;
      }
      if (block?.type === 'toolCall') {
        return {
          functionCall: {
            name: String(block.name || ''),
            args: block.arguments && typeof block.arguments === 'object' ? block.arguments : {},
          },
        };
      }
      return null;
    })
    .filter(Boolean);
}

function toGoogleContents(internalMessages) {
  return toInternalMessages(internalMessages)
    .filter((message) => message.role !== 'system')
    .map((message) => {
      if (message.role === 'assistant') {
        const parts = toGoogleParts(message.content);
        return parts.length > 0 ? { role: 'model', parts } : null;
      }
      if (message.role === 'toolResult') {
        return {
          role: 'user',
          parts: [{
            functionResponse: {
              name: String(message.toolName || ''),
              response: message.isError === true
                ? { error: contentToText(message.content) }
                : { output: contentToText(message.content) },
            },
          }],
        };
      }
      const text = contentToText(message.content);
      return text ? { role: 'user', parts: [{ text }] } : null;
    })
    .filter(Boolean);
}

function toGoogleTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return [{
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      parametersJsonSchema: tool.parameters || { type: 'object', properties: {} },
    })),
  }];
}

function toGoogleToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  if (toolChoice === 'none') return 'NONE';
  if (toolChoice === 'required' || toolChoice === 'any') return 'ANY';
  return 'AUTO';
}

function buildGoogleGenerativeBody({ supplier, internalMessages, tools, toolChoice }) {
  const body = {
    contents: toGoogleContents(internalMessages),
  };
  const system = extractSystemPrompt(internalMessages);
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const generationConfig = {};
  if (supplier.temperature !== undefined && supplier.temperature !== null) {
    generationConfig.temperature = supplier.temperature;
  }
  if (supplier.maxTokens) {
    generationConfig.maxOutputTokens = supplier.maxTokens;
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  const googleTools = toGoogleTools(tools);
  if (googleTools) body.tools = googleTools;
  const mode = toGoogleToolChoice(toolChoice);
  if (mode && googleTools) {
    body.toolConfig = { functionCallingConfig: { mode } };
  }
  return body;
}

function toMistralContentParts(content) {
  return (Array.isArray(content) ? content : [])
    .map((block) => {
      if (block?.type === 'text') {
        const text = String(block.text || '');
        return text ? { type: 'text', text } : null;
      }
      if (block?.type === 'thinking') {
        const text = String(block.thinking || '');
        return text ? { type: 'thinking', thinking: [{ type: 'text', text }] } : null;
      }
      return null;
    })
    .filter(Boolean);
}

function toMistralToolCalls(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === 'toolCall')
    .map((block) => ({
      id: String(block.id || ''),
      type: 'function',
      function: {
        name: String(block.name || ''),
        arguments: JSON.stringify(block.arguments || {}),
      },
    }));
}

function toMistralMessages(internalMessages) {
  return toInternalMessages(internalMessages)
    .map((message) => {
      if (message.role === 'system') {
        const content = contentToText(message.content);
        return content ? { role: 'system', content } : null;
      }
      if (message.role === 'assistant') {
        const contentParts = toMistralContentParts(message.content);
        const toolCalls = toMistralToolCalls(message.content);
        const result = { role: 'assistant' };
        if (contentParts.length === 1 && contentParts[0].type === 'text') {
          result.content = contentParts[0].text;
        } else if (contentParts.length > 0) {
          result.content = contentParts;
        }
        if (toolCalls.length > 0) result.tool_calls = toolCalls;
        return result.content || result.tool_calls ? result : null;
      }
      if (message.role === 'toolResult') {
        const text = contentToText(message.content).trim();
        return {
          role: 'tool',
          tool_call_id: String(message.toolCallId || ''),
          name: String(message.toolName || ''),
          content: message.isError === true ? `[tool error] ${text}` : text || '(no tool output)',
        };
      }
      return {
        role: 'user',
        content: contentToText(message.content),
      };
    })
    .filter(Boolean);
}

function toMistralTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters || { type: 'object', properties: {} },
      strict: false,
    },
  }));
}

function toMistralToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  if (['auto', 'none', 'any', 'required'].includes(toolChoice)) return toolChoice;
  const name = toolChoice?.function?.name || toolChoice?.name;
  return name ? { type: 'function', function: { name } } : undefined;
}

function buildMistralConversationsBody({ supplier, internalMessages, tools, toolChoice }) {
  const body = {
    model: supplier.model,
    messages: toMistralMessages(internalMessages),
    stream: false,
  };
  if (supplier.temperature !== undefined && supplier.temperature !== null) {
    body.temperature = supplier.temperature;
  }
  if (supplier.maxTokens) {
    body.max_tokens = supplier.maxTokens;
  }
  const mistralTools = toMistralTools(tools);
  if (mistralTools) body.tools = mistralTools;
  const mistralToolChoice = toMistralToolChoice(toolChoice);
  if (mistralToolChoice) body.tool_choice = mistralToolChoice;
  return body;
}

function anthropicStopReason(stopReason, hasToolCalls) {
  if (hasToolCalls || stopReason === 'tool_use') return 'toolUse';
  if (stopReason === 'max_tokens') return 'length';
  if (stopReason === 'error') return 'error';
  return 'stop';
}

function anthropicMessageToAssistantTurn(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  const blocks = content
    .map((block) => {
      if (block?.type === 'text') return { type: 'text', text: block.text || '' };
      if (block?.type === 'thinking') return { type: 'thinking', thinking: block.thinking || '' };
      if (block?.type === 'tool_use') {
        return {
          type: 'toolCall',
          id: block.id || '',
          name: block.name || '',
          arguments: block.input || {},
        };
      }
      return null;
    })
    .filter(Boolean);
  const hasToolCalls = blocks.some((block) => block.type === 'toolCall');
  return piAiMessageToAssistantTurn({
    role: 'assistant',
    content: blocks,
    stopReason: anthropicStopReason(message?.stop_reason, hasToolCalls),
    rawMessage: message,
    usage: message?.usage || null,
  });
}

function extractResponsesReasoningText(item) {
  const summary = Array.isArray(item?.summary)
    ? item.summary.map((part) => part?.text || '').filter(Boolean).join('\n\n')
    : '';
  if (summary) return summary;
  return Array.isArray(item?.content)
    ? item.content.map((part) => part?.text || '').filter(Boolean).join('\n\n')
    : '';
}

function parseResponsesToolArguments(value) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function responsesStopReason(response, hasToolCalls) {
  if (hasToolCalls) return 'toolUse';
  if (response?.status === 'incomplete') return 'length';
  if (response?.status === 'failed' || response?.status === 'cancelled') return 'error';
  return 'stop';
}

function openAiResponsesToAssistantTurn(response) {
  const blocks = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type === 'reasoning') {
      const thinking = extractResponsesReasoningText(item);
      if (thinking) blocks.push({ type: 'thinking', thinking });
      continue;
    }
    if (item?.type === 'message') {
      for (const part of Array.isArray(item.content) ? item.content : []) {
        if (part?.type === 'output_text' && typeof part.text === 'string') {
          blocks.push({ type: 'text', text: part.text });
        } else if (part?.type === 'refusal' && typeof part.refusal === 'string') {
          blocks.push({ type: 'text', text: part.refusal });
        }
      }
      continue;
    }
    if (item?.type === 'function_call') {
      blocks.push({
        type: 'toolCall',
        id: `${item.call_id || ''}|${item.id || ''}`,
        name: item.name || '',
        arguments: parseResponsesToolArguments(item.arguments),
      });
    }
  }
  if (blocks.length === 0 && typeof response?.output_text === 'string') {
    blocks.push({ type: 'text', text: response.output_text });
  }
  const hasToolCalls = blocks.some((block) => block.type === 'toolCall');
  return piAiMessageToAssistantTurn({
    role: 'assistant',
    content: blocks,
    stopReason: responsesStopReason(response, hasToolCalls),
    rawMessage: response,
    usage: response?.usage || null,
  });
}

function extractMistralThinking(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item?.text === 'string') return item.text;
        return '';
      })
      .join('');
  }
  if (typeof value?.text === 'string') return value.text;
  return '';
}

function parseMistralToolArguments(value) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mistralStopReason(finishReason, hasToolCalls) {
  if (hasToolCalls || finishReason === 'tool_calls') return 'toolUse';
  if (finishReason === 'length' || finishReason === 'model_length') return 'length';
  if (finishReason === 'error') return 'error';
  return 'stop';
}

function mistralMessageToAssistantTurn(response) {
  const choice = response?.choices?.[0] || {};
  const message = choice.message || {};
  const content = message.content;
  const blocks = [];

  if (typeof content === 'string') {
    if (content) blocks.push({ type: 'text', text: content });
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (item?.type === 'thinking') {
        const thinking = extractMistralThinking(item.thinking);
        if (thinking) blocks.push({ type: 'thinking', thinking });
      } else if (typeof item?.text === 'string') {
        blocks.push({ type: 'text', text: item.text });
      }
    }
  }

  const toolCalls = message.tool_calls || message.toolCalls || [];
  for (const toolCall of Array.isArray(toolCalls) ? toolCalls : []) {
    const fn = toolCall?.function || {};
    if (!fn.name) continue;
    blocks.push({
      type: 'toolCall',
      id: toolCall.id || '',
      name: fn.name,
      arguments: parseMistralToolArguments(fn.arguments),
    });
  }

  const hasToolCalls = blocks.some((block) => block.type === 'toolCall');
  return piAiMessageToAssistantTurn({
    role: 'assistant',
    content: blocks,
    stopReason: mistralStopReason(choice.finish_reason || choice.finishReason, hasToolCalls),
    rawMessage: message,
    usage: response?.usage || null,
  });
}

function googleStopReason(finishReason, hasToolCalls) {
  if (hasToolCalls) return 'toolUse';
  if (finishReason === 'MAX_TOKENS') return 'length';
  if (!finishReason || finishReason === 'STOP') return 'stop';
  return 'error';
}

function googleMessageToAssistantTurn(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  let callIndex = 0;
  const blocks = parts
    .map((part) => {
      if (typeof part?.text === 'string') {
        if (part.thought === true) return { type: 'thinking', thinking: part.text };
        return { type: 'text', text: part.text };
      }
      if (part?.functionCall) {
        callIndex += 1;
        return {
          type: 'toolCall',
          id: part.functionCall.id || `call_${callIndex}`,
          name: part.functionCall.name || '',
          arguments: part.functionCall.args || {},
        };
      }
      return null;
    })
    .filter(Boolean);
  const hasToolCalls = blocks.some((block) => block.type === 'toolCall');
  return piAiMessageToAssistantTurn({
    role: 'assistant',
    content: blocks,
    stopReason: googleStopReason(response?.candidates?.[0]?.finishReason, hasToolCalls),
    rawMessage: response,
    usage: response?.usageMetadata || null,
  });
}

function emitFallbackDeltas(turn, onTextDelta, onThinkingDelta) {
  if (!turn) return;
  const split = splitThinkTaggedContent(turn.text || '');
  if (split.visibleText) {
    onTextDelta?.(split.visibleText);
  }
  if (split.thinkingText) {
    onThinkingDelta?.(split.thinkingText);
  }
  const reasoning = normalizeThinkingText(turn.thinking || '');
  if (reasoning) {
    onThinkingDelta?.(reasoning);
  }
}

export function canUseLlmProxyProvider(supplier) {
  return supplier?.transport === 'arcamage-proxy'
    && [
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
      'google-generative-ai',
      'mistral-conversations',
    ].includes(supplier?.api);
}

async function requestLlmProxyOpenAiTurn({
  supplier,
  internalMessages,
  tools,
  toolChoice,
  signal,
  onTextDelta,
  onThinkingDelta,
}) {
  try {
    const streamedTurn = await requestLlmProxyOpenAiStreamTurn({
      supplier,
      internalMessages,
      tools,
      toolChoice,
      signal,
      onTextDelta,
      onThinkingDelta,
    });
    if (isUsableAssistantTurn(streamedTurn)) return streamedTurn;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error?.hasPartialStream) throw error;
  }

  const completion = await post('/api/llm/proxy', {
    provider: supplier.provider,
    api: supplier.api,
    base_url: supplier.baseUrl,
    api_key: supplier.apiKey,
    method: 'POST',
    path: resolveVersionedPath(supplier.baseUrl, '/chat/completions'),
    headers: supplier.headers || {},
    body: buildOpenAiCompletionsBody({ supplier, internalMessages, tools, toolChoice, stream: false }),
    stream: false,
  }, { timeout: 60000 });

  const turn = legacyCompletionToAssistantTurn(completion);
  emitFallbackDeltas(turn, onTextDelta, onThinkingDelta);
  if (!isUsableAssistantTurn(turn)) {
    throw new Error('供应商未返回可用响应');
  }
  return turn;
}

function buildOpenAiProxyPayload({ supplier, internalMessages, tools, toolChoice, stream }) {
  return {
    provider: supplier.provider,
    api: supplier.api,
    base_url: supplier.baseUrl,
    api_key: supplier.apiKey,
    method: 'POST',
    path: resolveVersionedPath(supplier.baseUrl, '/chat/completions'),
    headers: supplier.headers || {},
    body: buildOpenAiCompletionsBody({ supplier, internalMessages, tools, toolChoice, stream }),
    stream,
  };
}

async function parseLlmProxyStreamError(response) {
  try {
    const payload = await response.json();
    return payload?.error?.message || payload?.message || `请求失败 (${response.status})`;
  } catch {
    try {
      return await response.text() || `请求失败 (${response.status})`;
    } catch {
      return `请求失败 (${response.status})`;
    }
  }
}

function applyOpenAiStreamPayload(payload, state, onTextDelta, onThinkingDelta) {
  const choice = payload?.choices?.[0] || {};
  const delta = choice.delta || {};
  const content = extractStreamText(delta.content ?? delta.text ?? choice.message?.content ?? choice.text);
  const reasoning = extractStreamReasoning(delta) || extractStreamReasoning(choice.message || {});
  if (content) {
    state.textChunks.push(content);
    onTextDelta?.(content);
  }
  if (reasoning) {
    state.reasoningChunks.push(reasoning);
    onThinkingDelta?.(reasoning);
  }
  if (Array.isArray(delta.tool_calls)) {
    state.toolCallAssembler.apply(delta.tool_calls);
  }
  if (Array.isArray(choice.message?.tool_calls)) {
    state.toolCallAssembler.apply(choice.message.tool_calls);
  }
  if (choice.message && typeof choice.message === 'object') {
    state.upstreamMessage = choice.message;
  }
  if (choice.finish_reason) {
    state.finishReason = choice.finish_reason;
  }
}

function streamStateToOpenAiTurn(state) {
  const toolCalls = state.toolCallAssembler.toArray();
  const message = {
    role: state.upstreamMessage?.role || 'assistant',
    content: state.textChunks.join('') || state.upstreamMessage?.content || '',
  };
  const reasoning = state.reasoningChunks.join('')
    || extractStreamReasoning(state.upstreamMessage || {});
  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  } else if (Array.isArray(state.upstreamMessage?.tool_calls)) {
    message.tool_calls = state.upstreamMessage.tool_calls;
  }
  if (!message.tool_calls && state.upstreamMessage?.function_call) {
    message.function_call = state.upstreamMessage.function_call;
  }

  return legacyCompletionToAssistantTurn({
    choices: [{
      message,
      finish_reason: state.finishReason,
    }],
  });
}

function hasOpenAiStreamProgress(state) {
  return state.textChunks.length > 0
    || state.reasoningChunks.length > 0
    || state.toolCallAssembler.toArray().length > 0
    || Boolean(state.upstreamMessage);
}

async function requestLlmProxyOpenAiStreamTurn({
  supplier,
  internalMessages,
  tools,
  toolChoice,
  signal,
  onTextDelta,
  onThinkingDelta,
}) {
  const response = await fetch('/api/llm/proxy', {
    method: 'POST',
    headers: {
      'Accept': 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildOpenAiProxyPayload({
      supplier,
      internalMessages,
      tools,
      toolChoice,
      stream: true,
    })),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseLlmProxyStreamError(response));
  }
  if (!response.body) {
    throw new Error('响应为空，无法读取流');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parserState = { buffer: '' };
  const state = {
    textChunks: [],
    reasoningChunks: [],
    toolCallAssembler: createStreamingToolCallAssembler(),
    finishReason: null,
    upstreamMessage: null,
  };

  const handleBlock = (block) => {
    if (!block.trim()) return false;
    const { eventType, data } = parseSseBlock(block);
    if (!data) return false;
    if (eventType === 'error') {
      let message = data;
      try {
        const payload = JSON.parse(data);
        message = payload?.message || message;
      } catch {
        // keep raw message
      }
      const error = new Error(message);
      error.hasPartialStream = hasOpenAiStreamProgress(state);
      throw error;
    }
    if (data === DONE_SIGNAL) return true;
    try {
      applyOpenAiStreamPayload(JSON.parse(data), state, onTextDelta, onThinkingDelta);
    } catch {
      // Ignore malformed stream payloads and keep reading subsequent events.
    }
    return false;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const blocks = parseSseBlocks(decoder.decode(value, { stream: true }), parserState);
    for (const block of blocks) {
      if (handleBlock(block)) return streamStateToOpenAiTurn(state);
    }
  }

  const tail = decoder.decode();
  if (tail) {
    for (const block of parseSseBlocks(tail, parserState)) {
      if (handleBlock(block)) return streamStateToOpenAiTurn(state);
    }
  }
  if (parserState.buffer.trim()) {
    handleBlock(parserState.buffer);
  }

  return streamStateToOpenAiTurn(state);
}

async function requestLlmProxyOpenAiResponsesTurn({
  supplier,
  internalMessages,
  tools,
  toolChoice,
  onTextDelta,
  onThinkingDelta,
}) {
  const response = await post('/api/llm/proxy', {
    provider: supplier.provider,
    api: supplier.api,
    base_url: supplier.baseUrl,
    api_key: supplier.apiKey,
    method: 'POST',
    path: resolveVersionedPath(supplier.baseUrl, '/responses'),
    headers: supplier.headers || {},
    body: buildOpenAiResponsesBody({ supplier, internalMessages, tools, toolChoice }),
    stream: false,
  }, { timeout: 60000 });

  const turn = openAiResponsesToAssistantTurn(response);
  emitFallbackDeltas(turn, onTextDelta, onThinkingDelta);
  if (!isUsableAssistantTurn(turn)) {
    throw new Error('供应商未返回可用响应');
  }
  return turn;
}

async function requestLlmProxyAnthropicTurn({
  supplier,
  internalMessages,
  tools,
  toolChoice,
  onTextDelta,
  onThinkingDelta,
}) {
  const message = await post('/api/llm/proxy', {
    provider: supplier.provider,
    api: supplier.api,
    base_url: supplier.baseUrl,
    api_key: supplier.apiKey,
    method: 'POST',
    path: resolveVersionedPath(supplier.baseUrl, '/messages'),
    headers: supplier.headers || {},
    body: buildAnthropicMessagesBody({ supplier, internalMessages, tools, toolChoice }),
    stream: false,
  }, { timeout: 60000 });

  const turn = anthropicMessageToAssistantTurn(message);
  emitFallbackDeltas(turn, onTextDelta, onThinkingDelta);
  if (!isUsableAssistantTurn(turn)) {
    throw new Error('供应商未返回可用响应');
  }
  return turn;
}

async function requestLlmProxyGoogleTurn({
  supplier,
  internalMessages,
  tools,
  toolChoice,
  onTextDelta,
  onThinkingDelta,
}) {
  const response = await post('/api/llm/proxy', {
    provider: supplier.provider,
    api: supplier.api,
    base_url: supplier.baseUrl,
    api_key: supplier.apiKey,
    method: 'POST',
    path: resolveGooglePath(supplier.baseUrl, supplier.model),
    headers: supplier.headers || {},
    body: buildGoogleGenerativeBody({ supplier, internalMessages, tools, toolChoice }),
    stream: false,
  }, { timeout: 60000 });

  const turn = googleMessageToAssistantTurn(response);
  emitFallbackDeltas(turn, onTextDelta, onThinkingDelta);
  if (!isUsableAssistantTurn(turn)) {
    throw new Error('供应商未返回可用响应');
  }
  return turn;
}

async function requestLlmProxyMistralTurn({
  supplier,
  internalMessages,
  tools,
  toolChoice,
  onTextDelta,
  onThinkingDelta,
}) {
  const response = await post('/api/llm/proxy', {
    provider: supplier.provider,
    api: supplier.api,
    base_url: supplier.baseUrl,
    api_key: supplier.apiKey,
    method: 'POST',
    path: resolveVersionedPath(supplier.baseUrl, '/chat/completions'),
    headers: supplier.headers || {},
    body: buildMistralConversationsBody({ supplier, internalMessages, tools, toolChoice }),
    stream: false,
  }, { timeout: 60000 });

  const turn = mistralMessageToAssistantTurn(response);
  emitFallbackDeltas(turn, onTextDelta, onThinkingDelta);
  if (!isUsableAssistantTurn(turn)) {
    throw new Error('供应商未返回可用响应');
  }
  return turn;
}

export async function requestLlmProxyTurn(request) {
  if (request?.supplier?.api === 'openai-responses') {
    return requestLlmProxyOpenAiResponsesTurn(request);
  }
  if (request?.supplier?.api === 'anthropic-messages') {
    return requestLlmProxyAnthropicTurn(request);
  }
  if (request?.supplier?.api === 'google-generative-ai') {
    return requestLlmProxyGoogleTurn(request);
  }
  if (request?.supplier?.api === 'mistral-conversations') {
    return requestLlmProxyMistralTurn(request);
  }
  return requestLlmProxyOpenAiTurn(request);
}

export function openAiModelsProxyPayload(supplier) {
  return {
    provider: supplier.provider,
    api: supplier.api,
    base_url: supplier.baseUrl,
    api_key: supplier.apiKey,
    headers: supplier.headers || {},
    path: resolveVersionedPath(supplier.baseUrl, '/models'),
  };
}
