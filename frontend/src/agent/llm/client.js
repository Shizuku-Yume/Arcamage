import { normalizeSupplierConfig } from './model.js';
import { toInternalMessages } from './messages.js';
import { normalizeToolDefinitions } from './tools.js';
import { canUseLlmProxyProvider, requestLlmProxyTurn } from './providers/llm_proxy.js';
import { canUsePiAiBrowserProvider, requestPiAiBrowserTurn } from './providers/pi_ai_browser.js';

export async function requestAssistantTurn({
  messages,
  supplier,
  tools,
  toolChoice,
  signal,
  onTextDelta,
  onThinkingDelta,
}) {
  const normalizedSupplier = normalizeSupplierConfig(supplier);
  const internalMessages = toInternalMessages(messages);
  const normalizedTools = normalizeToolDefinitions(tools);

  if (normalizedSupplier.transport === 'arcamage-proxy') {
    if (!canUseLlmProxyProvider(normalizedSupplier)) {
      throw new Error(
        'Arcamage LLM proxy currently supports openai-completions, openai-responses, anthropic-messages, google-generative-ai, and mistral-conversations only',
      );
    }
    return requestLlmProxyTurn({
      supplier: normalizedSupplier,
      internalMessages,
      tools: normalizedTools,
      toolChoice,
      signal,
      onTextDelta,
      onThinkingDelta,
    });
  }

  if (canUsePiAiBrowserProvider(normalizedSupplier)) {
    return requestPiAiBrowserTurn({
      supplier: normalizedSupplier,
      internalMessages,
      tools: normalizedTools,
      toolChoice,
      signal,
      onTextDelta,
      onThinkingDelta,
    });
  }

  throw new Error(`Unsupported LLM transport or API: ${normalizedSupplier.transport}/${normalizedSupplier.api}`);
}
