import { describe, expect, it } from 'vitest';

import {
  checkDirectObservationReport,
  checkReport,
  collectSecretFindings,
} from '../../../../scripts/check_llm_smoke_report.mjs';
import { checkPhase6Readiness } from '../../../../scripts/check_llm_phase6_readiness.mjs';

function result({ name, provider, api, kind, transport = 'arcamage-proxy' }) {
  return {
    name,
    ok: true,
    kind,
    supplier: {
      provider,
      api,
      transport,
      baseUrl: 'https://provider.example.test',
      model: `${name}-model`,
    },
  };
}

function directObservationReport() {
  return {
    results: [
      result({
        name: 'direct-text',
        provider: 'openai-compatible',
        api: 'openai-completions',
        kind: 'text',
        transport: 'direct',
      }),
      result({
        name: 'direct-tool',
        provider: 'openai-compatible',
        api: 'openai-completions',
        kind: 'toolRound',
        transport: 'direct',
      }),
      result({
        name: 'direct-multi-tool',
        provider: 'openai-compatible',
        api: 'openai-completions',
        kind: 'toolRounds',
        transport: 'direct',
      }),
      result({
        name: 'direct-tool-retry',
        provider: 'openai-compatible',
        api: 'openai-completions',
        kind: 'toolErrorRetry',
        transport: 'direct',
      }),
    ],
  };
}

function passingReport() {
  return {
    results: [
      result({
        name: 'openai-compatible-text',
        provider: 'openai-compatible',
        api: 'openai-completions',
        kind: 'text',
      }),
      result({
        name: 'openai-compatible-tool',
        provider: 'openai-compatible',
        api: 'openai-completions',
        kind: 'toolRound',
      }),
      result({
        name: 'openai-responses-text',
        provider: 'openai',
        api: 'openai-responses',
        kind: 'text',
      }),
      result({
        name: 'openai-responses-tool',
        provider: 'openai',
        api: 'openai-responses',
        kind: 'toolRound',
      }),
      result({
        name: 'anthropic-text',
        provider: 'anthropic',
        api: 'anthropic-messages',
        kind: 'text',
      }),
      result({
        name: 'anthropic-tool',
        provider: 'anthropic',
        api: 'anthropic-messages',
        kind: 'toolRound',
      }),
      result({
        name: 'google-text',
        provider: 'google',
        api: 'google-generative-ai',
        kind: 'text',
      }),
      result({
        name: 'google-tool',
        provider: 'google',
        api: 'google-generative-ai',
        kind: 'toolRound',
      }),
      result({
        name: 'mistral-text',
        provider: 'mistral',
        api: 'mistral-conversations',
        kind: 'text',
      }),
      result({
        name: 'mistral-tool',
        provider: 'mistral',
        api: 'mistral-conversations',
        kind: 'toolRound',
      }),
    ],
  };
}

describe('LLM smoke report checker', () => {
  it('accepts Phase 6 proxy coverage with text and tool cases', () => {
    expect(checkReport(passingReport())).toMatchObject({
      ok: true,
      missing: [],
      total: 10,
      passedProxy: 10,
    });
  });

  it('rejects missing provider coverage', () => {
    const report = passingReport();
    report.results = report.results.filter((item) => item.supplier.api !== 'google-generative-ai');

    const checked = checkReport(report);

    expect(checked.ok).toBe(false);
    expect(checked.missing).toContain('Google Generative AI arcamage-proxy text case');
    expect(checked.missing).toContain('Google Generative AI arcamage-proxy tool case');
  });

  it('rejects failed smoke cases even when coverage exists', () => {
    const report = passingReport();
    report.results[0] = {
      ...report.results[0],
      ok: false,
      error: 'provider returned no assistant text',
    };

    const checked = checkReport(report);

    expect(checked.ok).toBe(false);
    expect(checked.missing).toContain('1 smoke case(s) failed');
  });

  it('finds credential field names recursively', () => {
    expect(collectSecretFindings({
      results: [{ supplier: { apiKey: '[redacted]' } }],
    })).toEqual(['$.results[0].supplier.apiKey uses sensitive field name "apiKey"']);
  });

  it('rejects credential-shaped string values recursively', () => {
    const report = passingReport();
    report.results[0] = {
      ...report.results[0],
      error: 'upstream rejected Authorization: Bearer sk-secret123456',
    };

    const checked = checkReport(report);

    expect(checked.ok).toBe(false);
    expect(checked.missing[0]).toContain('smoke report contains sensitive data');
    expect(checked.missing[0]).toContain('$.results[0].error contains a credential-like value');
  });

  it('accepts direct observation reports with text and tool loop coverage', () => {
    expect(checkDirectObservationReport(directObservationReport())).toMatchObject({
      ok: true,
      missing: [],
      total: 4,
      passedDirect: 4,
    });
    expect(checkReport(directObservationReport(), 'direct-observation').ok).toBe(true);
  });

  it('rejects direct observation reports missing retry coverage', () => {
    const report = directObservationReport();
    report.results = report.results.filter((item) => item.kind !== 'toolErrorRetry');

    const checked = checkDirectObservationReport(report);

    expect(checked.ok).toBe(false);
    expect(checked.missing).toContain('OpenAI-compatible direct toolErrorRetry case');
  });

  it('rejects unknown smoke check modes', () => {
    expect(() => checkReport(passingReport(), 'typo-mode')).toThrow(
      'Unknown ARCAMAGE_LLM_SMOKE_CHECK: typo-mode',
    );
  });

  it('accepts Phase 6 readiness when proxy and direct reports pass', () => {
    expect(checkPhase6Readiness({
      proxyReport: passingReport(),
      directReport: directObservationReport(),
    })).toMatchObject({
      ok: true,
      missing: [],
      proxy: { passedProxy: 10 },
      direct: { passedDirect: 4 },
    });
  });

  it('rejects Phase 6 readiness when any required report is incomplete', () => {
    const proxyReport = passingReport();
    proxyReport.results = proxyReport.results.filter((item) => item.supplier.api !== 'mistral-conversations');
    const directReport = directObservationReport();
    directReport.results = directReport.results.filter((item) => item.kind !== 'toolRounds');

    const checked = checkPhase6Readiness({ proxyReport, directReport });

    expect(checked.ok).toBe(false);
    expect(checked.missing).toContain('proxy coverage: Mistral Conversations arcamage-proxy text case');
    expect(checked.missing).toContain('proxy coverage: Mistral Conversations arcamage-proxy tool case');
    expect(checked.missing).toContain('direct observation: OpenAI-compatible direct toolRounds case');
  });
});
