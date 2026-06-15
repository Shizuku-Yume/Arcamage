import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const FRONTEND_ROOT = path.resolve(process.cwd());
const SRC_ROOT = path.join(FRONTEND_ROOT, 'src');

const ALLOWED_AI_CLIENT_IMPORTERS = new Set();

const ALLOWED_PI_AI_IMPORTERS = new Set([
  'src/agent/llm/providers/pi_ai_browser.js',
]);

const RUNTIME_PROVIDER_RESPONSE_PATTERNS = [
  { label: 'OpenAI choices response parsing', pattern: /\bchoices\s*(?:\.|\[|\?)/ },
  { label: 'OpenAI tool_calls field parsing', pattern: /\btool_calls\b/ },
  { label: 'OpenAI function_call field parsing', pattern: /\bfunction_call\b/ },
  { label: 'OpenAI reasoning_content field parsing', pattern: /\breasoning_content\b/ },
  { label: 'OpenAI finish_reason field parsing', pattern: /\bfinish_reason\b/ },
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

async function collectJsFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(absolutePath);
      }
    }
  }
  return files;
}

function isTestFile(relativePath) {
  return relativePath.includes('/__tests__/') || /\.test\.js$/.test(relativePath);
}

function importsLegacyAiClient(source) {
  return /from\s+['"][^'"]*components\/ai_client\.js['"]/.test(source)
    || /from\s+['"][^'"]*\/ai_client\.js['"]/.test(source)
    || /vi\.mock\(\s*['"][^'"]*components\/ai_client\.js['"]/.test(source);
}

function importsPiAiPackage(source) {
  return /(?:from\s+['"]@earendil-works\/pi-ai['"]|import\(\s*['"]@earendil-works\/pi-ai['"]\s*\))/.test(source)
    || /vi\.mock\(\s*['"]@earendil-works\/pi-ai['"]/.test(source);
}

function runtimeProviderResponseLeaks(source) {
  return RUNTIME_PROVIDER_RESPONSE_PATTERNS
    .filter((item) => item.pattern.test(source))
    .map((item) => item.label);
}

const violations = [];
const files = await collectJsFiles(SRC_ROOT);
for (const absolutePath of files) {
  const relativePath = toPosix(path.relative(FRONTEND_ROOT, absolutePath));
  if (isTestFile(relativePath)) continue;

  const source = await readFile(absolutePath, 'utf8');
  if (importsLegacyAiClient(source) && !ALLOWED_AI_CLIENT_IMPORTERS.has(relativePath)) {
    violations.push(`${relativePath}: components/ai_client.js`);
  }
  if (importsPiAiPackage(source) && !ALLOWED_PI_AI_IMPORTERS.has(relativePath)) {
    violations.push(`${relativePath}: @earendil-works/pi-ai`);
  }
  if (relativePath === 'src/components/agent_runtime.js') {
    for (const leak of runtimeProviderResponseLeaks(source)) {
      violations.push(`${relativePath}: ${leak}`);
    }
  }
}

if (violations.length > 0) {
  console.error('LLM boundary violation: provider-specific imports escaped their adapter boundary.');
  for (const item of violations) {
    console.error(`  - ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log('LLM boundary audit: provider-specific imports and runtime response parsing are contained.');
}
