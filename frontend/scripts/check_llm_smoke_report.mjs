#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const REPORT_ENV = 'ARCAMAGE_LLM_SMOKE_REPORT';
const CHECK_ENV = 'ARCAMAGE_LLM_SMOKE_CHECK';
const CHECK_PROXY_COVERAGE = 'proxy-coverage';
const CHECK_DIRECT_OBSERVATION = 'direct-observation';
const CHECK_MODES = new Set([
  CHECK_PROXY_COVERAGE,
  CHECK_DIRECT_OBSERVATION,
]);
const SECRET_KEY_PATTERN = /api[_-]?key|authorization|token|secret|password/i;
const SECRET_VALUE_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+|\b(sk-[A-Za-z0-9._-]{6,}|test-[A-Za-z0-9._-]{6,})\b/i;

const REQUIRED_PROXY_COVERAGE = [
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible arcamage-proxy',
    matches: (item) => item.supplier?.provider === 'openai-compatible'
      && item.supplier?.api === 'openai-completions',
  },
  {
    id: 'openai-responses',
    label: 'OpenAI Responses arcamage-proxy',
    matches: (item) => item.supplier?.api === 'openai-responses',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Messages arcamage-proxy',
    matches: (item) => item.supplier?.api === 'anthropic-messages',
  },
  {
    id: 'google',
    label: 'Google Generative AI arcamage-proxy',
    matches: (item) => item.supplier?.api === 'google-generative-ai',
  },
  {
    id: 'mistral',
    label: 'Mistral Conversations arcamage-proxy',
    matches: (item) => item.supplier?.api === 'mistral-conversations',
  },
];

function usage() {
  return `Set ${REPORT_ENV} to an LLM smoke JSON report path.`;
}

async function readReport() {
  const reportPath = process.env[REPORT_ENV];
  if (!reportPath) {
    throw new Error(usage());
  }
  const raw = await readFile(resolve(reportPath), 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.results)) {
    throw new Error('Smoke report must contain a top-level "results" array.');
  }
  return parsed;
}

function passedProxyItems(results) {
  return results.filter((item) => item?.ok === true && item?.supplier?.transport === 'arcamage-proxy');
}

function hasTextCase(items, matcher) {
  return items.some((item) => matcher(item) && item.kind === 'text');
}

function hasToolCase(items, matcher) {
  return items.some((item) => matcher(item) && ['toolRound', 'toolRounds', 'toolErrorRetry'].includes(item.kind));
}

function hasKindCase(items, matcher, kind) {
  return items.some((item) => matcher(item) && item.kind === kind);
}

function passedTransportItems(results, transport) {
  return results.filter((item) => item?.ok === true && item?.supplier?.transport === transport);
}

export function collectSecretFindings(value, path = '$', findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSecretFindings(item, `${path}[${index}]`, findings));
    return findings;
  }

  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${path}.${key}`;
      if (SECRET_KEY_PATTERN.test(key)) {
        findings.push(`${itemPath} uses sensitive field name "${key}"`);
        continue;
      }
      collectSecretFindings(item, itemPath, findings);
    }
    return findings;
  }

  if (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)) {
    findings.push(`${path} contains a credential-like value`);
  }
  return findings;
}

function addCommonReportFailures(report, missing) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const failures = results.filter((item) => item?.ok !== true);
  const secretFindings = collectSecretFindings(report);

  if (failures.length > 0) {
    missing.push(`${failures.length} smoke case(s) failed`);
  }
  if (secretFindings.length > 0) {
    missing.push(`smoke report contains sensitive data: ${secretFindings.slice(0, 5).join('; ')}`);
  }
}

export function checkProxyCoverageReport(report) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const passedProxy = passedProxyItems(results);
  const missing = [];

  addCommonReportFailures(report, missing);
  for (const requirement of REQUIRED_PROXY_COVERAGE) {
    if (!hasTextCase(passedProxy, requirement.matches)) {
      missing.push(`${requirement.label} text case`);
    }
    if (!hasToolCase(passedProxy, requirement.matches)) {
      missing.push(`${requirement.label} tool case`);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    total: results.length,
    passedProxy: passedProxy.length,
  };
}

export function checkDirectObservationReport(report) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const passedDirect = passedTransportItems(results, 'direct');
  const missing = [];
  const isOpenAiCompatible = (item) => item.supplier?.provider === 'openai-compatible'
    && item.supplier?.api === 'openai-completions';

  addCommonReportFailures(report, missing);
  if (!hasTextCase(passedDirect, isOpenAiCompatible)) {
    missing.push('OpenAI-compatible direct text case');
  }
  if (!hasKindCase(passedDirect, isOpenAiCompatible, 'toolRound')) {
    missing.push('OpenAI-compatible direct toolRound case');
  }
  if (!hasKindCase(passedDirect, isOpenAiCompatible, 'toolRounds')) {
    missing.push('OpenAI-compatible direct toolRounds case');
  }
  if (!hasKindCase(passedDirect, isOpenAiCompatible, 'toolErrorRetry')) {
    missing.push('OpenAI-compatible direct toolErrorRetry case');
  }

  return {
    ok: missing.length === 0,
    missing,
    total: results.length,
    passedDirect: passedDirect.length,
  };
}

export function checkReport(report, mode = CHECK_PROXY_COVERAGE) {
  if (!CHECK_MODES.has(mode)) {
    throw new Error(`Unknown ${CHECK_ENV}: ${mode}`);
  }
  if (mode === CHECK_DIRECT_OBSERVATION) {
    return checkDirectObservationReport(report);
  }
  return checkProxyCoverageReport(report);
}

async function main() {
  const report = await readReport();
  const mode = process.env[CHECK_ENV] || CHECK_PROXY_COVERAGE;
  const result = checkReport(report, mode);
  if (!result.ok) {
    const labels = {
      [CHECK_DIRECT_OBSERVATION]: 'direct observation',
      [CHECK_PROXY_COVERAGE]: 'Phase 6 proxy coverage',
    };
    const label = labels[mode] || 'Phase 6 proxy coverage';
    console.error(`LLM smoke report does not satisfy ${label}:`);
    for (const item of result.missing) {
      console.error(`- ${item}`);
    }
    process.exitCode = 1;
    return;
  }

  if (mode === CHECK_DIRECT_OBSERVATION) {
    console.log(`LLM smoke report satisfies direct observation (${result.passedDirect}/${result.total} direct cases).`);
    return;
  }

  console.log(`LLM smoke report satisfies Phase 6 proxy coverage (${result.passedProxy}/${result.total} proxy cases).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
