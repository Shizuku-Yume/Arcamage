import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupplierModels, testSupplierConnection } from '../api.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('supplier API proxy routing', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('loads models through the controlled LLM proxy for arcamage-proxy transport', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      data: { models: [{ id: 'model-a' }] },
      error: null,
      error_code: null,
    }));

    const models = await getSupplierModels({
      provider: 'openrouter',
      api: 'openai-completions',
      transport: 'arcamage-proxy',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
    });

    expect(models).toEqual([{ id: 'model-a' }]);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/llm/models');
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toMatchObject({
      provider: 'openrouter',
      api: 'openai-completions',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-test',
      path: '/models',
    });
  });

  it('tests connection through the controlled LLM proxy for arcamage-proxy transport', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      data: { models: [{ id: 'model-a' }] },
      error: null,
      error_code: null,
    }));

    const result = await testSupplierConnection({
      provider: 'openrouter',
      api: 'openai-completions',
      transport: 'arcamage-proxy',
      baseUrl: 'https://openrouter.ai/api',
      apiKey: 'sk-test',
    });

    expect(result).toEqual({
      success: true,
      message: '连接成功',
      models: [{ id: 'model-a' }],
    });
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toMatchObject({
      path: '/v1/models',
    });
  });

  it('uses Google model-list path for Gemini arcamage-proxy transport', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      data: { models: [{ id: 'models/gemini-test' }] },
      error: null,
      error_code: null,
    }));

    const models = await getSupplierModels({
      provider: 'google',
      api: 'google-generative-ai',
      transport: 'arcamage-proxy',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'google-key',
    });

    expect(models).toEqual([{ id: 'models/gemini-test' }]);
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toMatchObject({
      provider: 'google',
      api: 'google-generative-ai',
      base_url: 'https://generativelanguage.googleapis.com',
      path: '/v1beta/models',
    });
  });

  it('lets explicit modelsPath override provider defaults', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      data: { models: [{ id: 'custom-model' }] },
      error: null,
      error_code: null,
    }));

    await getSupplierModels({
      provider: 'google',
      api: 'google-generative-ai',
      transport: 'arcamage-proxy',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'google-key',
      modelsPath: '/custom/models',
    });

    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toMatchObject({
      path: '/custom/models',
    });
  });
});
