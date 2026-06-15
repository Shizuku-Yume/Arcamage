#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  checkDirectObservationReport,
  checkProxyCoverageReport,
} from './check_llm_smoke_report.mjs';

const PROXY_REPORT_ENV = 'ARCAMAGE_LLM_PROXY_REPORT';
const DIRECT_REPORT_ENV = 'ARCAMAGE_LLM_DIRECT_REPORT';

function usage() {
  return `Set ${PROXY_REPORT_ENV} and ${DIRECT_REPORT_ENV} to LLM smoke JSON report paths.`;
}

async function readReport(envName) {
  const reportPath = process.env[envName];
  if (!reportPath) {
    throw new Error(usage());
  }
  const raw = await readFile(resolve(reportPath), 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.results)) {
    throw new Error(`${envName} must point to a smoke report with a top-level "results" array.`);
  }
  return parsed;
}

export function checkPhase6Readiness({ proxyReport, directReport }) {
  const proxy = checkProxyCoverageReport(proxyReport);
  const direct = checkDirectObservationReport(directReport);
  const missing = [
    ...proxy.missing.map((item) => `proxy coverage: ${item}`),
    ...direct.missing.map((item) => `direct observation: ${item}`),
  ];

  return {
    ok: proxy.ok && direct.ok,
    missing,
    proxy,
    direct,
  };
}

async function main() {
  const [proxyReport, directReport] = await Promise.all([
    readReport(PROXY_REPORT_ENV),
    readReport(DIRECT_REPORT_ENV),
  ]);
  const result = checkPhase6Readiness({
    proxyReport,
    directReport,
  });
  if (!result.ok) {
    console.error('LLM smoke reports do not satisfy Phase 6 readiness:');
    for (const item of result.missing) {
      console.error(`- ${item}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `LLM smoke reports satisfy Phase 6 readiness `
    + `(${result.proxy.passedProxy}/${result.proxy.total} proxy cases, `
    + `${result.direct.passedDirect}/${result.direct.total} direct cases).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
