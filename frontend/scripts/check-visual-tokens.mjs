import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const FRONTEND_ROOT = path.resolve(process.cwd());

const HEX_COLOR_PATTERN = /#[0-9A-Fa-f]{3,8}\b/g;

const SCAN_TARGETS = [
  'index.html',
  'src/components',
  'src/pages',
];

const HEX_SOURCE_OF_TRUTH_FILES = new Set([
  'src/components/preview_panel.js',
]);

const HEX_ALLOWED_LINE_PATTERNS = [
  /stop-color="#[0-9A-Fa-f]{3,8}"/,
  /\bfill="#[0-9A-Fa-f]{3,8}"/,
  /placeholder="#7c3aed"/,
  /如 #7c3aed/,
];

const INFO_PATTERNS = [
  { label: 'rounded-xl', pattern: /\brounded-xl\b/g },
  { label: 'rounded-2xl', pattern: /\brounded-2xl\b/g },
  { label: 'shadow-2xl', pattern: /\bshadow-2xl\b/g },
  {
    label: 'legacy-red-amber-status-utility',
    pattern: /\b(?:bg|text|border|ring)-(?:red|amber)-\d{2,3}\b/g,
  },
];

const FORBIDDEN_UTILITY_PATTERNS = [
  {
    label: 'non-semantic-hue-utility',
    pattern: /\b(?:bg|text|border|ring)-(?:blue|green|purple|orange|yellow|rose|emerald)-\d{2,3}\b/g,
  },
  {
    label: 'arbitrary-z-index',
    pattern: /\bz-\[[^\]]+\]\b/g,
  },
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

async function collectFiles(targetPath) {
  const absoluteTarget = path.resolve(FRONTEND_ROOT, targetPath);
  const stat = await readdir(path.dirname(absoluteTarget), { withFileTypes: true })
    .then((entries) => entries.find((entry) => entry.name === path.basename(absoluteTarget)))
    .catch(() => null);

  if (!stat) return [];

  if (!stat.isDirectory()) {
    return [toPosix(path.relative(FRONTEND_ROOT, absoluteTarget))];
  }

  const files = [];
  const stack = [absoluteTarget];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absoluteEntry = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absoluteEntry);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(js|html)$/i.test(entry.name)) continue;
      files.push(toPosix(path.relative(FRONTEND_ROOT, absoluteEntry)));
    }
  }

  return files;
}

function hasAllowedHexLine(lineText) {
  return HEX_ALLOWED_LINE_PATTERNS.some((pattern) => pattern.test(lineText));
}

async function main() {
  const scanFiles = [];
  for (const target of SCAN_TARGETS) {
    const files = await collectFiles(target);
    scanFiles.push(...files);
  }

  const uniqueFiles = [...new Set(scanFiles)].sort();
  const violations = [];
  const forbiddenUtilityViolations = [];
  const infoCounts = Object.fromEntries(INFO_PATTERNS.map((entry) => [entry.label, 0]));

  for (const relativeFilePath of uniqueFiles) {
    const absoluteFilePath = path.resolve(FRONTEND_ROOT, relativeFilePath);
    const source = await readFile(absoluteFilePath, 'utf8');

    for (const infoRule of INFO_PATTERNS) {
      const matches = source.match(infoRule.pattern);
      if (matches?.length) {
        infoCounts[infoRule.label] += matches.length;
      }
    }

    if (HEX_SOURCE_OF_TRUTH_FILES.has(relativeFilePath)) {
      continue;
    }

    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!HEX_COLOR_PATTERN.test(line)) {
        HEX_COLOR_PATTERN.lastIndex = 0;
      } else {
        HEX_COLOR_PATTERN.lastIndex = 0;
        if (!hasAllowedHexLine(line)) {
          const lineMatches = [...line.matchAll(HEX_COLOR_PATTERN)];
          lineMatches.forEach((match) => {
            violations.push({
              filePath: relativeFilePath,
              line: index + 1,
              color: match[0],
              excerpt: line.trim(),
            });
          });
        }
      }

      FORBIDDEN_UTILITY_PATTERNS.forEach((rule) => {
        const matches = [...line.matchAll(rule.pattern)];
        rule.pattern.lastIndex = 0;
        matches.forEach((match) => {
          forbiddenUtilityViolations.push({
            filePath: relativeFilePath,
            line: index + 1,
            rule: rule.label,
            token: match[0],
            excerpt: line.trim(),
          });
        });
      });
    });
  }

  console.log('Visual token audit (raw hex in template surface):');
  if (violations.length === 0) {
    console.log('  ✓ No unauthorized raw hex color literal found.');
  } else {
    console.log(`  ✗ Found ${violations.length} unauthorized raw hex literal(s):`);
    violations.forEach((violation) => {
      console.log(`    - ${violation.filePath}:${violation.line} ${violation.color}`);
      console.log(`      ${violation.excerpt}`);
    });
  }

  console.log('\nToken drift telemetry (informational):');
  Object.entries(infoCounts).forEach(([label, count]) => {
    console.log(`  - ${label}: ${count}`);
  });

  console.log('\nForbidden utility guard:');
  if (forbiddenUtilityViolations.length === 0) {
    console.log('  ✓ No forbidden utility usage found.');
  } else {
    console.log(`  ✗ Found ${forbiddenUtilityViolations.length} forbidden utility usage(s):`);
    forbiddenUtilityViolations.forEach((violation) => {
      console.log(`    - [${violation.rule}] ${violation.filePath}:${violation.line} ${violation.token}`);
      console.log(`      ${violation.excerpt}`);
    });
  }

  if (violations.length > 0 || forbiddenUtilityViolations.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Failed to run visual token check:', error);
  process.exitCode = 1;
});
