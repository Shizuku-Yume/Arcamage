/* global process */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertSupplier,
  formatSmokeError,
  normalizeSupplier,
  summarizeSupplier,
} from '../../../../scripts/llm_smoke.mjs';

const ENV_KEY = 'ARCAMAGE_UNIT_SMOKE_KEY';
const EXAMPLE_CONFIG_PATH = resolve(process.cwd(), '../docs/LLM_PROVIDER_SMOKE.example.json');

function caseKind(item) {
  if (item.toolErrorRetry) return 'toolErrorRetry';
  if (item.toolRound && item.toolRounds > 1) return 'toolRounds';
  if (item.toolRound) return 'toolRound';
  return 'text';
}

function caseId(item) {
  return `${item.provider}:${item.api}:${item.transport}:${caseKind(item)}`;
}

describe('LLM smoke script helpers', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('reads apiKeyEnv without keeping the env var name in supplier metadata', () => {
    process.env[ENV_KEY] = 'sk-envsecret123456';

    const supplier = normalizeSupplier({
      provider: 'openai-compatible',
      api: 'openai-completions',
      transport: 'direct',
      baseUrl: 'https://provider.example.test',
      apiKeyEnv: ENV_KEY,
      model: 'model-x',
    });

    expect(supplier.apiKey).toBe('sk-envsecret123456');
    expect(summarizeSupplier(supplier)).toEqual({
      provider: 'openai-compatible',
      api: 'openai-completions',
      transport: 'direct',
      baseUrl: 'https://provider.example.test',
      model: 'model-x',
      modelsPath: undefined,
    });
  });

  it('prefers explicit apiKey over apiKeyEnv', () => {
    process.env[ENV_KEY] = 'sk-envsecret123456';

    const supplier = normalizeSupplier({
      baseUrl: 'https://provider.example.test',
      apiKey: 'sk-explicit123456',
      apiKeyEnv: ENV_KEY,
      model: 'model-x',
    });

    expect(supplier.apiKey).toBe('sk-explicit123456');
  });

  it('reports missing apiKey when apiKeyEnv is unset', () => {
    const supplier = normalizeSupplier({
      baseUrl: 'https://provider.example.test',
      apiKeyEnv: ENV_KEY,
      model: 'model-x',
    });

    expect(() => assertSupplier('missing-env', supplier)).toThrow(
      'missing-env: missing supplier fields: apiKey',
    );
  });

  it('redacts keys in Error.message and generic string errors', () => {
    expect(formatSmokeError(new Error('Authorization: Bearer sk-secret123456'))).toBe(
      'Authorization: Bearer [redacted]',
    );
    expect(formatSmokeError('failed with sk-secret123456')).toBe('failed with [redacted]');
  });

  it('keeps the checked-in provider smoke example credential-free and gate-ready', () => {
    const parsed = JSON.parse(readFileSync(EXAMPLE_CONFIG_PATH, 'utf8'));
    const cases = parsed.cases;

    expect(Array.isArray(cases)).toBe(true);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.every((item) => item.apiKeyEnv && !item.apiKey)).toBe(true);

    const caseIds = new Set(cases.map((item) => caseId(item)));
    expect(caseIds).toContain('openai-compatible:openai-completions:direct:text');
    expect(caseIds).toContain('openai-compatible:openai-completions:direct:toolRound');
    expect(caseIds).toContain('openai-compatible:openai-completions:direct:toolRounds');
    expect(caseIds).toContain('openai-compatible:openai-completions:direct:toolErrorRetry');
    expect(caseIds).toContain('openai-compatible:openai-completions:arcamage-proxy:text');
    expect(caseIds).toContain('openai-compatible:openai-completions:arcamage-proxy:toolRound');
    expect(caseIds).toContain('openai:openai-responses:arcamage-proxy:text');
    expect(caseIds).toContain('openai:openai-responses:arcamage-proxy:toolRound');
    expect(caseIds).toContain('anthropic:anthropic-messages:arcamage-proxy:text');
    expect(caseIds).toContain('anthropic:anthropic-messages:arcamage-proxy:toolRound');
    expect(caseIds).toContain('google:google-generative-ai:arcamage-proxy:text');
    expect(caseIds).toContain('google:google-generative-ai:arcamage-proxy:toolRound');
    expect(caseIds).toContain('mistral:mistral-conversations:arcamage-proxy:text');
    expect(caseIds).toContain('mistral:mistral-conversations:arcamage-proxy:toolRound');
  });
});
