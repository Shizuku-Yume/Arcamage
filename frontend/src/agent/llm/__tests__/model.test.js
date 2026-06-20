import { describe, expect, it } from 'vitest';

import { normalizeSupplierConfig, resolveTransport, supplierToModel } from '../model.js';

describe('llm model config', () => {
  it('maps old supplier config into SupplierConfigV2 defaults', () => {
    const supplier = normalizeSupplierConfig({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'model-x',
      useProxy: true,
      temperature: 3,
    });

    expect(supplier.provider).toBe('openai-compatible');
    expect(supplier.api).toBe('openai-completions');
    expect(supplier.transport).toBe('arcamage-proxy');
    expect(supplier.useProxy).toBe(true);
    expect(supplier.temperature).toBe(2);
    expect(supplier.contextWindow).toBe(262144);
    expect(supplier.maxTokens).toBe(65536);
    expect(supplier.compat.supportsDeveloperRole).toBe(false);
  });

  it('prefers explicit transport over old useProxy inference', () => {
    expect(resolveTransport({ useProxy: true })).toBe('arcamage-proxy');
    expect(resolveTransport({ transport: 'legacy-proxy' })).toBe('arcamage-proxy');
    expect(resolveTransport({ useProxy: true, transport: 'direct' })).toBe('direct');
  });

  it('normalizes remembered supplier model lists', () => {
    const supplier = normalizeSupplierConfig({
      availableModels: [
        { id: 'model-a', label: 'A' },
        'model-b',
        { id: 'model-a', label: 'duplicate' },
        { id: '' },
      ],
    });

    expect(supplier.availableModels).toEqual([
      { id: 'model-a', label: 'A' },
      { id: 'model-b' },
    ]);
  });

  it('clamps supplier context and output token ranges', () => {
    expect(normalizeSupplierConfig({ contextWindow: 1, maxTokens: 1 })).toMatchObject({
      contextWindow: 65536,
      maxTokens: 4096,
    });

    expect(normalizeSupplierConfig({ contextWindow: 2000000, maxTokens: 500000 })).toMatchObject({
      contextWindow: 1048576,
      maxTokens: 262144,
    });
  });

  it('maps supplier config to a provider-neutral model object', () => {
    expect(supplierToModel({ model: 'model-x', provider: 'openrouter' })).toMatchObject({
      id: 'model-x',
      name: 'model-x',
      provider: 'openrouter',
      api: 'openai-completions',
      input: ['text'],
      contextWindow: 262144,
      maxTokens: 65536,
    });
  });

  it('allows explicit compat to override OpenAI-compatible defaults', () => {
    expect(supplierToModel({
      model: 'model-x',
      provider: 'openai-compatible',
      api: 'openai-completions',
      compat: {
        supportsDeveloperRole: true,
        supportsReasoningEffort: false,
      },
    }).compat).toMatchObject({
      supportsDeveloperRole: true,
      supportsReasoningEffort: false,
    });
  });

  it('normalizes OpenAI Responses model base URL to the v1 API root', () => {
    expect(supplierToModel({
      model: 'gpt-test',
      provider: 'openai',
      api: 'openai-responses',
      baseUrl: 'https://api.openai.com',
    }).baseUrl).toBe('https://api.openai.com/v1');

    expect(supplierToModel({
      model: 'gpt-test',
      provider: 'openai',
      api: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1/',
    }).baseUrl).toBe('https://api.openai.com/v1');
  });

  it('normalizes OpenAI-compatible completions model base URL to the v1 API root', () => {
    expect(supplierToModel({
      model: 'model-x',
      provider: 'openai-compatible',
      api: 'openai-completions',
      baseUrl: 'https://cli.shizukuyume.fun',
    }).baseUrl).toBe('https://cli.shizukuyume.fun/v1');

    expect(supplierToModel({
      model: 'model-x',
      provider: 'openai-compatible',
      api: 'openai-completions',
      baseUrl: 'https://cli.shizukuyume.fun/v1/',
    }).baseUrl).toBe('https://cli.shizukuyume.fun/v1');
  });
});
