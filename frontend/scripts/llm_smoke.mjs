#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { requestAssistantTurn } from '../src/agent/llm/client.js';

const CONFIG_ENV = 'ARCAMAGE_LLM_SMOKE_CONFIG';
const APP_BASE_ENV = 'ARCAMAGE_BASE_URL';
const REPORT_ENV = 'ARCAMAGE_LLM_SMOKE_REPORT';
const DEFAULT_APP_BASE_URL = 'http://127.0.0.1:8000';
const SECRET_KEY_PATTERN = /api[_-]?key|authorization|token|secret|password/i;

function installRelativeFetchProxy(baseUrl) {
  const nativeFetch = globalThis.fetch?.bind(globalThis);
  if (!nativeFetch) {
    throw new Error('This smoke script requires Node.js fetch support.');
  }
  const normalizedBase = String(baseUrl || DEFAULT_APP_BASE_URL).replace(/\/+$/, '');
  globalThis.fetch = (url, options) => {
    if (typeof url === 'string' && url.startsWith('/')) {
      return nativeFetch(`${normalizedBase}${url}`, options);
    }
    return nativeFetch(url, options);
  };
}

async function readConfig() {
  const configPath = process.env[CONFIG_ENV];
  if (!configPath) {
    throw new Error(`Set ${CONFIG_ENV} to a smoke config JSON file.`);
  }
  const raw = await readFile(resolve(configPath), 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.cases)) {
    throw new Error('Smoke config must contain a top-level "cases" array.');
  }
  return parsed.cases;
}

export function normalizeSupplier(caseConfig) {
  const supplier = caseConfig.supplier || caseConfig;
  const apiKeyEnv = typeof supplier.apiKeyEnv === 'string' ? supplier.apiKeyEnv.trim() : '';
  const apiKey = supplier.apiKey || (apiKeyEnv ? process.env[apiKeyEnv] : '');
  return {
    provider: supplier.provider || 'openai-compatible',
    api: supplier.api || 'openai-completions',
    transport: supplier.transport || 'direct',
    baseUrl: supplier.baseUrl,
    apiKey,
    model: supplier.model,
    temperature: supplier.temperature ?? 0,
    maxTokens: supplier.maxTokens ?? 1024,
    modelsPath: supplier.modelsPath,
    reasoning: supplier.reasoning === true,
    headers: supplier.headers || {},
    compat: supplier.compat || {},
  };
}

export function assertSupplier(caseName, supplier) {
  const missing = ['baseUrl', 'apiKey', 'model'].filter((key) => !supplier[key]);
  if (missing.length > 0) {
    throw new Error(`${caseName}: missing supplier fields: ${missing.join(', ')}`);
  }
}

function textMessages(prompt) {
  return [
    { role: 'system', content: 'You are running a short Arcamage LLM smoke test.' },
    { role: 'user', content: prompt || 'Reply with a short confirmation.' },
  ];
}

function smokeTool() {
  return {
    name: 'return_smoke_marker',
    description: 'Return a smoke-test marker string.',
    parameters: {
      type: 'object',
      properties: {
        marker: { type: 'string' },
      },
      required: ['marker'],
      additionalProperties: false,
    },
  };
}

function assistantToolMessage(turn) {
  return {
    role: 'assistant',
    content: [
      ...(turn.text ? [{ type: 'text', text: turn.text }] : []),
      ...turn.toolCalls.map((call) => ({
        type: 'toolCall',
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      })),
    ],
  };
}

function normalizeToolRoundCount(value) {
  const count = Number(value || 1);
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.floor(count);
}

function summarizeResult(result) {
  const text = typeof result?.text === 'string' ? result.text : '';
  const toolCalls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
  return {
    textLength: text.length,
    textPreview: text.slice(0, 240),
    toolCallCount: toolCalls.length,
    toolCallNames: toolCalls.map((call) => call?.name || '').filter(Boolean),
  };
}

export function summarizeSupplier(supplier) {
  return {
    provider: supplier.provider,
    api: supplier.api,
    transport: supplier.transport,
    baseUrl: supplier.baseUrl,
    model: supplier.model,
    modelsPath: supplier.modelsPath || undefined,
  };
}

function sanitizeErrorValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeErrorValue(item));
  }
  if (typeof value === 'string') {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(/\b(sk-[A-Za-z0-9._-]{6,}|test-[A-Za-z0-9._-]{6,})\b/g, '[redacted]');
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      sanitized[key] = '[redacted]';
      continue;
    }
    sanitized[key] = sanitizeErrorValue(item);
  }
  return sanitized;
}

export function formatSmokeError(error) {
  if (error instanceof Error && error.message) {
    return sanitizeErrorValue(error.message);
  }
  if (typeof error === 'string') {
    return sanitizeErrorValue(error);
  }
  try {
    return JSON.stringify(sanitizeErrorValue(error));
  } catch {
    return sanitizeErrorValue(String(error));
  }
}

function classifyCase(caseConfig) {
  if (caseConfig.toolErrorRetry) return 'toolErrorRetry';
  if (caseConfig.toolRound) return normalizeToolRoundCount(caseConfig.toolRounds) > 1
    ? 'toolRounds'
    : 'toolRound';
  return 'text';
}

async function writeReport(reportPath, report) {
  if (!reportPath) return;
  const absolutePath = resolve(reportPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Smoke report written to ${absolutePath}`);
}

async function runTextSmoke(caseConfig, supplier) {
  const turn = await requestAssistantTurn({
    messages: textMessages(caseConfig.prompt),
    supplier,
    tools: [],
    toolChoice: 'none',
  });
  const text = String(turn?.text || '').trim();
  if (!text) {
    throw new Error('provider returned no assistant text');
  }
  if (caseConfig.expectText && !text.includes(caseConfig.expectText)) {
    throw new Error(`assistant text did not contain ${JSON.stringify(caseConfig.expectText)}`);
  }
  return { text };
}

async function runToolRoundSmoke(caseConfig, supplier) {
  const roundCount = normalizeToolRoundCount(caseConfig.toolRounds);
  const baseMarker = caseConfig.marker || 'arcamage-tool-ok';
  const markers = [];
  const messages = [
    {
      role: 'system',
      content: 'Call the provided tool when asked. After tool outputs, answer with every marker text returned by the tools.',
    },
  ];
  const toolCalls = [];
  for (let index = 0; index < roundCount; index += 1) {
    const marker = roundCount > 1 ? `${baseMarker}-${index + 1}` : baseMarker;
    markers.push(marker);
    messages.push({
      role: 'user',
      content: `Call return_smoke_marker with marker ${marker}.`,
    });
    const turn = await requestAssistantTurn({
      messages,
      supplier,
      tools: [smokeTool()],
      toolChoice: 'required',
    });
    const toolCall = turn?.toolCalls?.find((call) => call.name === 'return_smoke_marker');
    if (!toolCall) {
      throw new Error('provider did not return the expected return_smoke_marker tool call');
    }
    toolCalls.push(toolCall);
    messages.push(
      assistantToolMessage(turn),
      {
        role: 'toolResult',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: 'text', text: JSON.stringify({ marker }) }],
      },
    );
  }
  messages.push({
    role: 'user',
    content: 'List every marker returned by the tool results.',
  });
  const followUp = await requestAssistantTurn({
    messages,
    supplier,
    tools: [smokeTool()],
    toolChoice: 'none',
  });
  const text = String(followUp?.text || '').trim();
  if (!text) {
    throw new Error('provider returned no final text after tool result');
  }
  for (const marker of markers) {
    if (!text.includes(marker)) {
      throw new Error(`final text did not contain marker ${JSON.stringify(marker)}`);
    }
  }
  return { text, toolCalls };
}

async function runToolErrorRetrySmoke(caseConfig, supplier) {
  const marker = caseConfig.marker || 'arcamage-tool-retry-ok';
  const messages = [
    {
      role: 'system',
      content: 'Call the provided tool when asked. If a tool result says it failed, retry the same tool call. After a successful tool result, answer with the marker text.',
    },
    {
      role: 'user',
      content: `Call return_smoke_marker with marker ${marker}.`,
    },
  ];
  const firstTurn = await requestAssistantTurn({
    messages,
    supplier,
    tools: [smokeTool()],
    toolChoice: 'required',
  });
  const firstToolCall = firstTurn?.toolCalls?.find((call) => call.name === 'return_smoke_marker');
  if (!firstToolCall) {
    throw new Error('provider did not return the first return_smoke_marker tool call');
  }
  messages.push(
    assistantToolMessage(firstTurn),
    {
      role: 'toolResult',
      toolCallId: firstToolCall.id,
      toolName: firstToolCall.name,
      content: [{ type: 'text', text: JSON.stringify({ error: 'temporary smoke-test failure', retry: true }) }],
      isError: true,
    },
    {
      role: 'user',
      content: `The previous tool result failed. Retry return_smoke_marker with marker ${marker}.`,
    },
  );
  const retryTurn = await requestAssistantTurn({
    messages,
    supplier,
    tools: [smokeTool()],
    toolChoice: 'required',
  });
  const retryToolCall = retryTurn?.toolCalls?.find((call) => call.name === 'return_smoke_marker');
  if (!retryToolCall) {
    throw new Error('provider did not retry the expected return_smoke_marker tool call');
  }
  messages.push(
    assistantToolMessage(retryTurn),
    {
      role: 'toolResult',
      toolCallId: retryToolCall.id,
      toolName: retryToolCall.name,
      content: [{ type: 'text', text: JSON.stringify({ marker }) }],
    },
  );
  const followUp = await requestAssistantTurn({
    messages,
    supplier,
    tools: [smokeTool()],
    toolChoice: 'none',
  });
  const text = String(followUp?.text || '').trim();
  if (!text) {
    throw new Error('provider returned no final text after retry tool result');
  }
  if (!text.includes(marker)) {
    throw new Error(`final retry text did not contain marker ${JSON.stringify(marker)}`);
  }
  return { text, toolCalls: [firstToolCall, retryToolCall] };
}

async function runCase(caseConfig) {
  const name = caseConfig.name || caseConfig.model || 'unnamed';
  const supplier = normalizeSupplier(caseConfig);
  assertSupplier(name, supplier);
  const startedAt = Date.now();
  let result;
  if (caseConfig.toolErrorRetry) {
    result = await runToolErrorRetrySmoke(caseConfig, supplier);
  } else if (caseConfig.toolRound) {
    result = await runToolRoundSmoke(caseConfig, supplier);
  } else {
    result = await runTextSmoke(caseConfig, supplier);
  }
  return {
    result,
    supplier: summarizeSupplier(supplier),
    kind: classifyCase(caseConfig),
    durationMs: Date.now() - startedAt,
  };
}

async function main() {
  const appBaseUrl = process.env[APP_BASE_ENV] || DEFAULT_APP_BASE_URL;
  installRelativeFetchProxy(appBaseUrl);
  const cases = await readConfig();
  const results = [];
  for (const caseConfig of cases) {
    const name = caseConfig.name || caseConfig.model || 'unnamed';
    const startedAt = Date.now();
    const supplier = normalizeSupplier(caseConfig);
    try {
      const { result, durationMs } = await runCase(caseConfig);
      results.push({
        name,
        ok: true,
        kind: classifyCase(caseConfig),
        supplier: summarizeSupplier(supplier),
        durationMs,
        result: summarizeResult(result),
      });
      console.log(`[ok] ${name}`);
    } catch (error) {
      const errorMessage = formatSmokeError(error);
      results.push({
        name,
        ok: false,
        kind: classifyCase(caseConfig),
        supplier: summarizeSupplier(supplier),
        durationMs: Date.now() - startedAt,
        error: errorMessage,
      });
      console.error(`[fail] ${name}: ${errorMessage}`);
    }
  }
  const failures = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failures.length}/${results.length} smoke cases passed`);
  await writeReport(process.env[REPORT_ENV], {
    generatedAt: new Date().toISOString(),
    appBaseUrl,
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    results,
  });
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(formatSmokeError(error));
    process.exitCode = 1;
  });
}
