/**
 * 安全预览面板组件
 * 
 * 使用 sandboxed iframe 安全渲染 HTML 内容
 * 集成 DOMPurify 进行 XSS 防护
 * 集成 markdown-it 进行 Markdown 渲染
 * 
 * ⚠️ 保真红线: DOMPurify 仅用于预览渲染层，禁止将过滤结果回写到原始数据
 */

import Alpine from 'alpinejs';
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  breaks: true,
});

const HTML_DOCUMENT_PATTERN = /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i;
const HTML_FRAGMENT_PATTERN = /<\/?(?:div|span|p|br|img|table|thead|tbody|tr|th|td|details|summary|section|article|header|footer|main|ul|ol|li|blockquote|pre|code|h[1-6]|strong|em|a)\b/i;
const GAME_RESPONSE_BLOCK_PATTERN = /<game_response>([\s\S]*?)<\/game_response>/i;
const UPDATE_VARIABLE_BLOCK_PATTERN = /<updatevariable[\s\S]*?<\/updatevariable>/gi;
const FULL_COMMAND_LINE_PATTERN = /^\[([A-Za-z_][\w-]*)(?:\|([\s\S]*))?\]$/;
const INLINE_COMMAND_PATTERN = /\[([A-Za-z_][\w-]*)(?:\|([^\]]*))?\]/g;
const INLINE_COMMAND_PLACEHOLDER = '__CF_INLINE_CMD__';
const DIALOGUE_LINE_PATTERN = /^[^|\n]+\|[^|\n]*\|.+$/;

const UNSAFE_CSS_PATTERNS = [
  /@import[\s\S]*?;?/gi,
  /expression\s*\([^)]*\)/gi,
  /-moz-binding\s*:[^;]+;?/gi,
  /behavior\s*:[^;]+;?/gi,
];

function isLikelyHtmlDocument(content) {
  return HTML_DOCUMENT_PATTERN.test(content);
}

function isLikelyHtmlFragment(content) {
  return HTML_FRAGMENT_PATTERN.test(content);
}

function sanitizeStyleSheet(cssText) {
  if (!cssText) return '';

  let safeCss = String(cssText);
  UNSAFE_CSS_PATTERNS.forEach((pattern) => {
    safeCss = safeCss.replace(pattern, '');
  });

  safeCss = safeCss.replace(/url\s*\(\s*(['"]?)\s*javascript:[^)]*\1\s*\)/gi, 'none');
  safeCss = safeCss.replace(/url\s*\(\s*(['"]?)\s*data:\s*text\/html[^)]*\1\s*\)/gi, 'none');

  return safeCss.trim();
}

function sanitizeBodyClassName(bodyClass) {
  if (!bodyClass) return '';
  return bodyClass
    .split(/\s+/)
    .filter((token) => /^[A-Za-z0-9:_-]+$/.test(token))
    .join(' ');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPlainText(text) {
  const escaped = escapeHtml(text).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
  return `<div class="plain-text">${escaped}</div>`;
}

function extractHtmlPreviewParts(content, options = {}) {
  const rawContent = String(content || '');
  const removeScripts = options.removeScripts !== false;
  const sanitizeStyles = options.sanitizeStyles !== false;

  if (typeof DOMParser === 'undefined') {
    return {
      bodyHtml: rawContent,
      styleBlocks: [],
      bodyClass: '',
    };
  }

  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(rawContent, 'text/html');
    const styleBlocks = [];

    parsed.querySelectorAll('style').forEach((node) => {
      const cssText = node.textContent || '';
      const preparedCss = sanitizeStyles ? sanitizeStyleSheet(cssText) : String(cssText).trim();
      if (preparedCss) {
        styleBlocks.push(preparedCss);
      }
      node.remove();
    });

    if (removeScripts) {
      parsed.querySelectorAll('script').forEach((node) => {
        node.remove();
      });
    }

    return {
      bodyHtml: parsed.body?.innerHTML || rawContent,
      styleBlocks,
      bodyClass: sanitizeBodyClassName(parsed.body?.getAttribute('class') || ''),
    };
  } catch {
    return {
      bodyHtml: rawContent,
      styleBlocks: [],
      bodyClass: '',
    };
  }
}

function buildInjectedStyleTags(styleBlocks) {
  if (!Array.isArray(styleBlocks) || styleBlocks.length === 0) return '';
  return styleBlocks.map((css, index) => `<style data-preview-style="${index}">\n${css}\n</style>`).join('\n');
}

const PREVIEW_ACCENT_COLOR_FALLBACKS = Object.freeze({
  200: '#99f6e4',
  300: '#5eead4',
  400: '#2dd4bf',
  500: '#14b8a6',
  700: '#0f766e',
  800: '#115e59',
  900: '#134e4a',
});

const PREVIEW_NEUTRAL_TOKEN_FALLBACKS = Object.freeze({
  text: '#3f3f46',
  bg: '#fafafa',
  surface: '#f4f4f5',
  surfaceMuted: '#f9fafb',
  border: '#e4e4e7',
  borderStrong: '#d4d4d8',
  muted: '#71717a',
  heading: '#18181b',
  subtle: '#52525b',
  elevated: '#ffffff',
  scrollbarThumb: 'rgb(212 212 216)',
  scrollbarThumbHover: 'rgb(161 161 170)',
});

function normalizeCssColorValue(value, fallback) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return /^[#(),.%\sA-Za-z0-9-]+$/.test(text) ? text : fallback;
}

function readRootCssColorValue(variableName, fallback) {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return fallback;
  }

  const computed = window.getComputedStyle(document.documentElement);
  return normalizeCssColorValue(computed.getPropertyValue(variableName), fallback);
}

function buildPreviewThemeTokenOverrides() {
  const previewText = readRootCssColorValue('--preview-text', PREVIEW_NEUTRAL_TOKEN_FALLBACKS.text);
  const previewBg = readRootCssColorValue('--preview-bg', PREVIEW_NEUTRAL_TOKEN_FALLBACKS.bg);
  const previewSurface = readRootCssColorValue('--preview-surface', PREVIEW_NEUTRAL_TOKEN_FALLBACKS.surface);
  const previewSurfaceMuted = readRootCssColorValue('--preview-surface-muted', PREVIEW_NEUTRAL_TOKEN_FALLBACKS.surfaceMuted);
  const previewBorder = readRootCssColorValue('--preview-border', PREVIEW_NEUTRAL_TOKEN_FALLBACKS.border);
  const previewBorderStrong = readRootCssColorValue('--preview-border-strong', PREVIEW_NEUTRAL_TOKEN_FALLBACKS.borderStrong);
  const previewMuted = readRootCssColorValue('--preview-muted', PREVIEW_NEUTRAL_TOKEN_FALLBACKS.muted);
  const previewHeading = readRootCssColorValue('--preview-heading', PREVIEW_NEUTRAL_TOKEN_FALLBACKS.heading);
  const previewSubtle = readRootCssColorValue('--preview-subtle', PREVIEW_NEUTRAL_TOKEN_FALLBACKS.subtle);
  const previewElevated = readRootCssColorValue('--preview-elevated', PREVIEW_NEUTRAL_TOKEN_FALLBACKS.elevated);
  const previewScrollbarThumb = readRootCssColorValue('--preview-scrollbar-thumb', PREVIEW_NEUTRAL_TOKEN_FALLBACKS.scrollbarThumb);
  const previewScrollbarThumbHover = readRootCssColorValue('--preview-scrollbar-thumb-hover', PREVIEW_NEUTRAL_TOKEN_FALLBACKS.scrollbarThumbHover);
  const accent200 = readRootCssColorValue('--accent-200', PREVIEW_ACCENT_COLOR_FALLBACKS[200]);
  const accent300 = readRootCssColorValue('--accent-300', PREVIEW_ACCENT_COLOR_FALLBACKS[300]);
  const accent400 = readRootCssColorValue('--accent-400', PREVIEW_ACCENT_COLOR_FALLBACKS[400]);
  const accent500 = readRootCssColorValue('--accent-500', PREVIEW_ACCENT_COLOR_FALLBACKS[500]);
  const accent700 = readRootCssColorValue('--accent-700', PREVIEW_ACCENT_COLOR_FALLBACKS[700]);
  const accent800 = readRootCssColorValue('--accent-800', PREVIEW_ACCENT_COLOR_FALLBACKS[800]);
  const accent900 = readRootCssColorValue('--accent-900', PREVIEW_ACCENT_COLOR_FALLBACKS[900]);

  return `
<style data-preview-theme="accent-overrides">
  :root {
    --preview-text: ${previewText};
    --preview-bg: ${previewBg};
    --preview-surface: ${previewSurface};
    --preview-surface-muted: ${previewSurfaceMuted};
    --preview-border: ${previewBorder};
    --preview-border-strong: ${previewBorderStrong};
    --preview-muted: ${previewMuted};
    --preview-heading: ${previewHeading};
    --preview-subtle: ${previewSubtle};
    --preview-elevated: ${previewElevated};
    --preview-scrollbar-thumb: ${previewScrollbarThumb};
    --preview-scrollbar-thumb-hover: ${previewScrollbarThumbHover};
    --preview-accent-200: ${accent200};
    --preview-accent-300: ${accent300};
    --preview-accent-400: ${accent400};
    --preview-accent-500: ${accent500};
    --preview-accent-700: ${accent700};
    --preview-accent-800: ${accent800};
    --preview-accent-900: ${accent900};
  }
</style>
  `.trim();
}

const IFRAME_STYLES = `
  <style>
    :root {
      --preview-text: #3f3f46;
      --preview-bg: #fafafa;
      --preview-surface: #f4f4f5;
      --preview-surface-muted: #f9fafb;
      --preview-border: #e4e4e7;
      --preview-border-strong: #d4d4d8;
      --preview-muted: #71717a;
      --preview-heading: #18181b;
      --preview-subtle: #52525b;
      --preview-elevated: #ffffff;
      --preview-scrollbar-thumb: rgb(212 212 216);
      --preview-scrollbar-thumb-hover: rgb(161 161 170);
      --preview-accent-200: #99f6e4;
      --preview-accent-300: #5eead4;
      --preview-accent-400: #2dd4bf;
      --preview-accent-500: #14b8a6;
      --preview-accent-700: #0f766e;
      --preview-accent-800: #115e59;
      --preview-accent-900: #134e4a;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: var(--preview-text);
      background: var(--preview-bg);
      overflow-wrap: break-word;
      word-break: break-word;
    }
    html,
    body {
      scrollbar-width: thin;
      scrollbar-color: var(--preview-scrollbar-thumb) transparent;
    }
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background-color: var(--preview-scrollbar-thumb);
      border-radius: 999px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background-color: var(--preview-scrollbar-thumb-hover);
    }
    p { margin: 0 0 1em; }
    p:last-child { margin-bottom: 0; }
    a { color: var(--preview-accent-700); text-decoration: underline; }
    a:hover { color: var(--preview-accent-800); }
    strong, b { font-weight: 600; }
    em, i { font-style: italic; }
    code {
      background: var(--preview-surface);
      padding: 0.2em 0.4em;
      border-radius: 4px;
      font-size: 0.9em;
      font-family: 'SF Mono', Consolas, monospace;
    }
    pre {
      background: var(--preview-surface);
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1em 0;
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      margin: 1em 0;
      padding: 0.5em 1em;
      border-left: 4px solid var(--preview-accent-700);
      background: color-mix(in srgb, var(--preview-accent-200) 45%, white);
      color: var(--preview-accent-800);
    }
    hr {
      border: none;
      border-top: 1px solid var(--preview-border);
      margin: 1.5em 0;
    }
    ul, ol {
      margin: 1em 0;
      padding-left: 1.5em;
    }
    li { margin: 0.25em 0; }
    h1, h2, h3, h4, h5, h6 {
      margin: 1em 0 0.5em;
      font-weight: 600;
      line-height: 1.3;
    }
    h1 { font-size: 1.5em; }
    h2 { font-size: 1.3em; }
    h3 { font-size: 1.1em; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
    }
    th, td {
      border: 1px solid var(--preview-border);
      padding: 8px 12px;
      text-align: left;
    }
    th { background: var(--preview-surface); font-weight: 600; }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
    }
    details {
      margin: 0.75em 0;
      border: 1px solid var(--preview-border);
      border-radius: 8px;
      background: var(--preview-surface-muted);
      padding: 0.5em 0.75em;
    }
    summary {
      cursor: pointer;
      font-weight: 600;
      list-style: none;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    .plain-text {
      white-space: normal;
      line-height: 1.7;
    }
    /* 空内容提示 */
    .empty-hint {
      color: var(--preview-muted);
      font-style: italic;
      text-align: center;
      padding: 32px 16px;
    }
    .st-first-mes {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .st-command-line {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .st-command-chip,
    .st-inline-command {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--preview-border-strong);
      border-radius: 999px;
      background: var(--preview-surface);
      color: var(--preview-text);
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 12px;
      line-height: 1.4;
      padding: 2px 10px;
      word-break: break-all;
    }
    .st-inline-command {
      margin: 0 4px;
      vertical-align: baseline;
    }
    .st-dialogue-row {
      border: 1px solid var(--preview-border);
      border-radius: 12px;
      background: var(--preview-elevated);
      padding: 10px 12px;
    }
    .st-dialogue-row.st-narrator {
      background: var(--preview-bg);
      border-style: dashed;
    }
    .st-dialogue-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      font-size: 12px;
      color: var(--preview-muted);
    }
    .st-dialogue-speaker {
      font-weight: 700;
      color: var(--preview-heading);
    }
    .st-dialogue-sprite {
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 11px;
      border-radius: 999px;
      background: var(--preview-surface);
      border: 1px solid var(--preview-border);
      padding: 1px 8px;
      color: var(--preview-subtle);
    }
    .st-dialogue-body > *:last-child {
      margin-bottom: 0;
    }
    .st-choice-group {
      border: 1px solid var(--preview-border-strong);
      border-radius: 12px;
      background: var(--preview-surface-muted);
      padding: 10px;
    }
    .st-choice-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--preview-subtle);
      margin-bottom: 8px;
    }
    .st-choice-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .st-choice-option {
      border: 1px solid var(--preview-border-strong);
      background: var(--preview-elevated);
      color: var(--preview-text);
      border-radius: 10px;
      padding: 6px 10px;
      font-size: 12px;
      cursor: not-allowed;
      opacity: 0.9;
    }
    .st-update-hint {
      font-size: 12px;
      color: var(--preview-muted);
    }
    .st-update-block summary {
      font-size: 12px;
      color: var(--preview-subtle);
    }
    .st-update-block pre {
      margin: 10px 0 0;
      max-height: 240px;
    }
    
    /* Dark mode - uses prefers-color-scheme as iframe inherits system preference */
    @media (prefers-color-scheme: dark) {
      body.dark-mode {
        --preview-text: #d4d4d8;
        --preview-bg: #18181b;
        --preview-surface: #27272a;
        --preview-surface-muted: #1f1f23;
        --preview-border: #3f3f46;
        --preview-border-strong: #3f3f46;
        --preview-muted: #a1a1aa;
        --preview-heading: #fafafa;
        --preview-subtle: #a1a1aa;
        --preview-elevated: #27272a;
        --preview-scrollbar-thumb: rgb(63 63 70);
        --preview-scrollbar-thumb-hover: rgb(82 82 91);
        color-scheme: dark;
        scrollbar-color: var(--preview-scrollbar-thumb) transparent;
        color: var(--preview-text);
        background: var(--preview-bg);
      }
      body.dark-mode * {
        scrollbar-color: var(--preview-scrollbar-thumb) transparent;
      }
      body.dark-mode ::-webkit-scrollbar-track {
        background: transparent;
      }
      body.dark-mode ::-webkit-scrollbar-thumb {
        background-color: var(--preview-scrollbar-thumb);
      }
      body.dark-mode ::-webkit-scrollbar-thumb:hover {
        background-color: var(--preview-scrollbar-thumb-hover);
      }
      body.dark-mode a { color: var(--preview-accent-300); }
      body.dark-mode a:hover { color: var(--preview-accent-400); }
      body.dark-mode code {
        background: var(--preview-surface);
      }
      body.dark-mode pre {
        background: var(--preview-surface);
      }
      body.dark-mode blockquote {
        border-left-color: var(--preview-accent-500);
        background: color-mix(in srgb, var(--preview-accent-900) 40%, black);
        color: var(--preview-accent-300);
      }
      body.dark-mode hr {
        border-top-color: var(--preview-border);
      }
      body.dark-mode th, body.dark-mode td {
        border-color: var(--preview-border);
      }
      body.dark-mode th {
        background: var(--preview-surface);
      }
      body.dark-mode details {
        border-color: var(--preview-border);
        background: var(--preview-surface);
      }
      body.dark-mode .empty-hint {
        color: var(--preview-muted);
      }
      body.dark-mode .st-command-chip,
      body.dark-mode .st-inline-command {
        background: var(--preview-surface);
        border-color: var(--preview-border);
        color: var(--preview-text);
      }
      body.dark-mode .st-dialogue-row {
        background: var(--preview-surface-muted);
        border-color: var(--preview-border);
      }
      body.dark-mode .st-dialogue-row.st-narrator {
        background: var(--preview-bg);
      }
      body.dark-mode .st-dialogue-speaker {
        color: var(--preview-heading);
      }
      body.dark-mode .st-dialogue-head {
        color: var(--preview-muted);
      }
      body.dark-mode .st-dialogue-sprite {
        background: var(--preview-surface);
        border-color: var(--preview-border);
        color: var(--preview-text);
      }
      body.dark-mode .st-choice-group {
        background: var(--preview-surface-muted);
        border-color: var(--preview-border);
      }
      body.dark-mode .st-choice-option {
        background: var(--preview-surface);
        border-color: var(--preview-border);
        color: var(--preview-text);
      }
      body.dark-mode .st-update-hint,
      body.dark-mode .st-choice-title,
      body.dark-mode .st-update-block summary {
        color: var(--preview-muted);
      }
    }
  </style>
`;

/**
 * DOMPurify 配置
 */
const BASE_ALLOWED_TAGS = [
  'p', 'br', 'span', 'div', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'hr', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'sup', 'sub', 'mark', 'small',
  'details', 'summary', 'section', 'article', 'header', 'footer', 'main',
  'figure', 'figcaption', 'ruby', 'rt', 'rp', 'kbd', 'time', 'del', 'ins',
];

const BASE_ALLOWED_ATTR = [
  'href', 'target', 'rel', 'class', 'id', 'style',
  'src', 'alt', 'title', 'width', 'height',
  'colspan', 'rowspan',
  'open', 'align', 'valign', 'bgcolor', 'cellpadding', 'cellspacing',
  'face', 'size',
  'role', 'aria-label', 'aria-labelledby', 'aria-hidden',
];

const PURIFY_CONFIG = {
  ALLOWED_TAGS: BASE_ALLOWED_TAGS,
  ALLOWED_ATTR: BASE_ALLOWED_ATTR,
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['target'],
};

const RICH_PURIFY_CONFIG = {
  ALLOWED_TAGS: BASE_ALLOWED_TAGS,
  ALLOWED_ATTR: BASE_ALLOWED_ATTR,
  ALLOW_DATA_ATTR: true,
  ADD_ATTR: ['target'],
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/**
 * 清理 HTML (仅用于预览，不修改原始数据)
 * @param {string} html - 原始 HTML
 * @param {Object|string} [options] - 配置或 profile
 * @param {string} [options.profile] - 'default' | 'rich'
 * @returns {string} 清理后的 HTML
 */
export function sanitizeHTML(html, options = {}) {
  if (!html) return '';
  const profile = typeof options === 'string' ? options : options.profile;
  const config = profile === 'rich' ? RICH_PURIFY_CONFIG : PURIFY_CONFIG;
  return DOMPurify.sanitize(html, config);
}

/**
 * 渲染 Markdown 为 HTML
 * @param {string} markdown - Markdown 文本
 * @returns {string} HTML 字符串
 */
export function renderMarkdown(markdown) {
  if (!markdown) return '';
  return md.render(markdown);
}

function normalizeLineEndings(text) {
  return String(text || '').replace(/\r\n?/g, '\n');
}

function splitCommandArgs(rawArgChunk) {
  if (!rawArgChunk) return [];
  return String(rawArgChunk)
    .split('|')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseRegexPattern(patternText) {
  const source = String(patternText || '').trim();
  if (!source) return null;

  if (source.startsWith('/')) {
    for (let i = source.length - 1; i > 0; i -= 1) {
      if (source[i] !== '/') continue;
      const body = source.slice(1, i);
      const flags = source.slice(i + 1);
      try {
        return new RegExp(body, flags || 'g');
      } catch (error) {
        console.warn('[preview] invalid regex literal:', source, error);
        break;
      }
    }
  }

  try {
    return new RegExp(source, 'g');
  } catch (error) {
    console.warn('[preview] invalid regex source:', source, error);
    return null;
  }
}

function applyRegexScriptTransforms(content, regexScripts, options = {}) {
  let transformed = String(content || '');
  if (!Array.isArray(regexScripts) || regexScripts.length === 0) {
    return transformed;
  }

  regexScripts.forEach((script, index) => {
    if (!script || typeof script !== 'object') return;
    if (script.disabled) return;
    if (script.promptOnly) return;
    if (script.markdownOnly && options.markdown === false) return;

    const regex = parseRegexPattern(script.findRegex);
    if (!regex) return;

    const replaceWith = typeof script.replaceString === 'string' ? script.replaceString : '';
    try {
      transformed = transformed.replace(regex, replaceWith);
    } catch (error) {
      console.warn('[preview] failed to apply regex script:', script.scriptName || index, error);
    }
  });

  return transformed;
}

function replacePreviewMacros(content, macroContext = {}) {
  const userName = String(macroContext.user ?? macroContext.userName ?? 'user');
  const charName = String(macroContext.char ?? macroContext.charName ?? macroContext.character ?? userName);
  const macroMap = new Map([
    ['user', userName],
    ['username', userName],
    ['char', charName],
    ['character', charName],
    ['bot', charName],
  ]);

  return String(content || '').replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, rawKey) => {
    const key = String(rawKey || '').toLowerCase();
    if (!macroMap.has(key)) return match;
    return macroMap.get(key) ?? match;
  });
}

function extractFirstMesSections(content) {
  const normalized = normalizeLineEndings(content);
  const updateBlocks = [];

  normalized.replace(UPDATE_VARIABLE_BLOCK_PATTERN, (match) => {
    updateBlocks.push(match.trim());
    return match;
  });

  const wrapperMatch = normalized.match(GAME_RESPONSE_BLOCK_PATTERN);
  let mainContent = wrapperMatch ? wrapperMatch[1] : normalized;
  mainContent = mainContent.replace(UPDATE_VARIABLE_BLOCK_PATTERN, '').trim();

  return {
    mainContent,
    updateBlocks,
  };
}

function hasFirstMesDslMarkers(content) {
  const lines = normalizeLineEndings(content).split('\n');
  return lines.some((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return false;
    if (FULL_COMMAND_LINE_PATTERN.test(trimmed)) return true;
    if (trimmed.startsWith('[')) return false;
    return DIALOGUE_LINE_PATTERN.test(trimmed);
  });
}

function countHtmlFragmentTags(content) {
  const matches = String(content || '').match(/<\/?(?:div|span|p|br|img|table|thead|tbody|tr|th|td|details|summary|section|article|header|footer|main|ul|ol|li|blockquote|pre|code|h[1-6]|strong|em|a)\b/gi);
  return matches ? matches.length : 0;
}

function shouldRenderFirstMesAsHtml(content) {
  const rawContent = String(content || '');
  if (!rawContent.trim()) return false;

  const htmlDocumentLike = isLikelyHtmlDocument(rawContent);
  const containsStyleTag = /<style[\s>]/i.test(rawContent);
  const containsScriptTag = /<script[\s>]/i.test(rawContent);

  if (htmlDocumentLike || containsStyleTag || containsScriptTag) {
    return true;
  }

  if (hasFirstMesDslMarkers(rawContent)) {
    return false;
  }

  if (!isLikelyHtmlFragment(rawContent)) {
    return false;
  }

  return countHtmlFragmentTags(rawContent) >= 2;
}

function prepareFirstMesHtmlContent(content, options = {}) {
  const rawContent = String(content || '');
  if (options.allowScripts) {
    return prepareUnsafePreviewContent(rawContent, {
      ...options,
      markdown: false,
    });
  }

  const parts = extractHtmlPreviewParts(rawContent);
  return {
    html: sanitizeHTML(parts.bodyHtml, { profile: 'rich' }),
    styleBlocks: parts.styleBlocks,
    bodyClass: parts.bodyClass,
  };
}

function buildCommandChip(commandName, args = [], options = {}) {
  const command = String(commandName || '').trim();
  const normalizedArgs = Array.isArray(args)
    ? args.map((item) => String(item)).filter((item) => item.length > 0)
    : [];
  const displayText = `[${command}${normalizedArgs.length > 0 ? `|${normalizedArgs.join('|')}` : ''}]`;
  const className = options.inline ? 'st-inline-command' : 'st-command-chip';
  return `<span class="${className}">${escapeHtml(displayText)}</span>`;
}

function renderTextWithInlineCommands(text, options = {}) {
  const rawText = String(text || '');
  if (!rawText) return '';

  const placeholders = [];
  const placeholderText = rawText.replace(INLINE_COMMAND_PATTERN, (match, commandName, argChunk) => {
    const args = splitCommandArgs(argChunk);
    const placeholder = `${INLINE_COMMAND_PLACEHOLDER}${placeholders.length}__`;
    placeholders.push({
      placeholder,
      html: buildCommandChip(commandName, args, { inline: true }),
    });
    return placeholder;
  });

  const rendered = options.markdown === false ? renderPlainText(placeholderText) : renderMarkdown(placeholderText);
  let html = options.allowUnsafeHtml ? rendered : sanitizeHTML(rendered, { profile: 'rich' });

  placeholders.forEach((entry) => {
    html = html.split(entry.placeholder).join(entry.html);
  });

  return html;
}

function renderFirstMesCommandLine(commandName, args) {
  const normalizedName = String(commandName || '').toLowerCase();
  const normalizedArgs = Array.isArray(args)
    ? args.map((item) => String(item).trim()).filter((item) => item.length > 0)
    : [];

  if (normalizedName === 'choice' && normalizedArgs.length > 0) {
    const optionsHtml = normalizedArgs
      .map((item) => `<button type="button" class="st-choice-option" disabled>${escapeHtml(item)}</button>`)
      .join('');
    return `
<div class="st-choice-group">
  <div class="st-choice-title">可选分支</div>
  <div class="st-choice-list">${optionsHtml}</div>
</div>
    `.trim();
  }

  return `<div class="st-command-line">${buildCommandChip(commandName, normalizedArgs)}</div>`;
}

function renderFirstMesDialogueLine(speaker, sprite, text) {
  const normalizedSpeaker = String(speaker || '').trim();
  const normalizedSprite = String(sprite || '').trim();
  const normalizedText = String(text || '').trim();
  const isNarrator = normalizedSpeaker === '旁白' || (!normalizedSprite && normalizedSpeaker.includes('旁白'));
  const textHtml = renderTextWithInlineCommands(normalizedText, { markdown: true });
  const spriteHtml = normalizedSprite ? `<span class="st-dialogue-sprite">${escapeHtml(normalizedSprite)}</span>` : '';
  const headerHtml = `
<div class="st-dialogue-head">
  <span class="st-dialogue-speaker">${escapeHtml(normalizedSpeaker || '旁白')}</span>
  ${spriteHtml}
</div>
  `.trim();

  return `
<div class="st-dialogue-row${isNarrator ? ' st-narrator' : ''}">
  ${headerHtml}
  <div class="st-dialogue-body">${textHtml}</div>
</div>
  `.trim();
}

function prepareUnsafePreviewContent(content, options = {}) {
  const rawContent = String(content || '');
  if (!rawContent) {
    return {
      html: '<p class="empty-hint">暂无内容</p>',
      styleBlocks: [],
      bodyClass: '',
    };
  }

  const htmlDocumentLike = isLikelyHtmlDocument(rawContent);
  const htmlFragmentLike = isLikelyHtmlFragment(rawContent);
  const containsStyleTag = /<style[\s>]/i.test(rawContent);
  const containsScriptTag = /<script[\s>]/i.test(rawContent);

  if (htmlDocumentLike || containsStyleTag || containsScriptTag || (!options.markdown && htmlFragmentLike)) {
    const parts = extractHtmlPreviewParts(rawContent, {
      removeScripts: false,
      sanitizeStyles: false,
    });
    return {
      html: parts.bodyHtml,
      styleBlocks: parts.styleBlocks,
      bodyClass: parts.bodyClass,
    };
  }

  if (options.markdown) {
    return {
      html: renderMarkdown(rawContent),
      styleBlocks: [],
      bodyClass: '',
    };
  }

  return {
    html: renderPlainText(rawContent),
    styleBlocks: [],
    bodyClass: '',
  };
}

function prepareFirstMesNativeContent(content, options = {}) {
  let transformed = normalizeLineEndings(content);

  if (options.expandMacros) {
    transformed = replacePreviewMacros(transformed, options.macroContext || {});
  }

  if (options.applyRegexScripts) {
    transformed = applyRegexScriptTransforms(transformed, options.regexScripts, {
      markdown: options.markdown !== false,
    });
  }

  const sections = extractFirstMesSections(transformed);
  const mainContent = sections.mainContent;

  if (shouldRenderFirstMesAsHtml(mainContent)) {
    return prepareFirstMesHtmlContent(mainContent, options);
  }

  const rows = [];
  const lines = mainContent.split('\n');
  lines.forEach((line) => {
    const rawLine = String(line || '');
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    const commandMatch = trimmed.match(FULL_COMMAND_LINE_PATTERN);
    if (commandMatch) {
      rows.push(renderFirstMesCommandLine(commandMatch[1], splitCommandArgs(commandMatch[2])));
      return;
    }

    if (!trimmed.startsWith('[') && rawLine.includes('|')) {
      const parts = rawLine.split('|');
      if (parts.length >= 3) {
        const speaker = parts[0];
        const sprite = parts[1];
        const text = parts.slice(2).join('|');
        rows.push(renderFirstMesDialogueLine(speaker, sprite, text));
        return;
      }
    }

    rows.push(`<div class="st-dialogue-row st-narrator"><div class="st-dialogue-body">${renderTextWithInlineCommands(trimmed, { markdown: true })}</div></div>`);
  });

  if (sections.updateBlocks.length > 0) {
    if (options.includeUpdateBlock) {
      const updateHtml = sections.updateBlocks
        .map((block) => `<pre>${escapeHtml(block)}</pre>`)
        .join('');
      rows.push(`
<details class="st-update-block" open>
  <summary>UpdateVariable 逻辑块（只读预览，不执行）</summary>
  ${updateHtml}
</details>
      `.trim());
    } else {
      rows.push(`<div class="st-update-hint">已隐藏 ${sections.updateBlocks.length} 段 UpdateVariable 逻辑块</div>`);
    }
  }

  const html = rows.length > 0
    ? `<div class="st-first-mes">${rows.join('\n')}</div>`
    : '<p class="empty-hint">暂无内容</p>';

  return {
    html: options.allowScripts ? html : sanitizeHTML(html, { profile: 'rich' }),
    styleBlocks: [],
    bodyClass: '',
  };
}

function preparePreviewContent(content, options = {}) {
  if (!content) {
    return {
      html: '<p class="empty-hint">暂无内容</p>',
      styleBlocks: [],
      bodyClass: '',
    };
  }

  const rawContent = String(content);
  if (options.mode === 'first_mes_native') {
    return prepareFirstMesNativeContent(rawContent, options);
  }

  if (options.allowScripts) {
    return prepareUnsafePreviewContent(rawContent, options);
  }

  const htmlDocumentLike = isLikelyHtmlDocument(rawContent);
  const htmlFragmentLike = isLikelyHtmlFragment(rawContent);
  const containsStyleTag = /<style[\s>]/i.test(rawContent);

  if (htmlDocumentLike || containsStyleTag || (!options.markdown && htmlFragmentLike)) {
    const parts = extractHtmlPreviewParts(rawContent);
    return {
      html: sanitizeHTML(parts.bodyHtml, { profile: 'rich' }),
      styleBlocks: parts.styleBlocks,
      bodyClass: parts.bodyClass,
    };
  }

  if (options.markdown) {
    const renderedMarkdown = renderMarkdown(rawContent);
    return {
      html: sanitizeHTML(renderedMarkdown, { profile: htmlFragmentLike ? 'rich' : 'default' }),
      styleBlocks: [],
      bodyClass: '',
    };
  }

  return {
    html: renderPlainText(rawContent),
    styleBlocks: [],
    bodyClass: '',
  };
}

/**
 * 渲染内容 (自动检测 Markdown/HTML)
 * @param {string} content - 内容
 * @param {Object} options - 渲染选项
 * @param {boolean} options.markdown - 是否按 Markdown 渲染
 * @returns {string} 安全的 HTML
 */
export function renderContent(content, options = {}) {
  return preparePreviewContent(content, options).html;
}

/**
 * 生成 iframe srcdoc 内容
 * @param {string} content - 要渲染的内容
 * @param {Object} options - 渲染选项
 * @param {boolean} options.darkMode - 是否启用深色模式
 * @returns {string} 完整的 HTML 文档
 */
export function generateIframeContent(content, options = {}) {
  const prepared = preparePreviewContent(content, options);
  const bodyClass = [
    options.darkMode ? 'dark-mode' : '',
    prepared.bodyClass,
  ].filter(Boolean).join(' ');
  const themeTokenOverrides = buildPreviewThemeTokenOverrides();
  const injectedStyles = buildInjectedStyleTags(prepared.styleBlocks);
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${IFRAME_STYLES}
  ${themeTokenOverrides}
  ${injectedStyles}
</head>
<body class="${bodyClass}">
  ${prepared.html}
</body>
</html>
  `.trim();
}

/**
 * 预览面板 Alpine 组件
 */
export function previewPanelComponent(options = {}) {
  return {
    content: options.content || '',
    getContent: typeof options.getContent === 'function' ? options.getContent : null,
    isMarkdown: options.isMarkdown || false,
    isVisible: false,
    
    get isDarkMode() {
      return document.documentElement.classList.contains('dark');
    },
    
    get iframeContent() {
      const content = this.getContent ? this.getContent() : this.content;
      return generateIframeContent(content, { markdown: this.isMarkdown, darkMode: this.isDarkMode });
    },
    
    updateContent(content) {
      this.content = content || '';
    },

    setContentProvider(provider) {
      this.getContent = typeof provider === 'function' ? provider : null;
    },
    
    toggleMarkdown() {
      this.isMarkdown = !this.isMarkdown;
    },
    
    show() {
      this.isVisible = true;
    },
    
    hide() {
      this.isVisible = false;
    },
    
    toggle() {
      this.isVisible = !this.isVisible;
    },
  };
}

/**
 * Greeting 预览组件 (专门用于开场白预览)
 */
export function greetingPreviewComponent() {
  return {
    isVisible: false,
    currentGreeting: '',
    currentIndex: -1,
    
    get isDarkMode() {
      return document.documentElement.classList.contains('dark');
    },
    
    get iframeContent() {
      return generateIframeContent(this.currentGreeting, { markdown: true, darkMode: this.isDarkMode });
    },
    
    showFirstMes() {
      const cardStore = Alpine.store('card');
      this.currentGreeting = cardStore?.data?.data?.first_mes || '';
      this.currentIndex = -1;
      this.isVisible = true;
    },
    
    showAlternate(index) {
      const cardStore = Alpine.store('card');
      const greetings = cardStore?.data?.data?.alternate_greetings || [];
      this.currentGreeting = greetings[index] || '';
      this.currentIndex = index;
      this.isVisible = true;
    },
    
    close() {
      this.isVisible = false;
    },
    
    get title() {
      if (this.currentIndex === -1) return '开场白预览';
      return `备选开场白 #${this.currentIndex + 1} 预览`;
    },
  };
}

/**
 * 注册预览组件
 */
export function registerPreviewComponents() {
  Alpine.data('previewPanel', previewPanelComponent);
  Alpine.data('greetingPreview', greetingPreviewComponent);
}

/**
 * 生成预览面板 HTML
 * @returns {string} HTML 字符串
 */
export function generatePreviewPanelHTML() {
  return `
<!-- 预览面板 -->
<div x-data="previewPanel()"
     x-show="isVisible"
     x-transition:enter="transition ease-out duration-200"
     x-transition:enter-start="opacity-0"
     x-transition:enter-end="opacity-100"
     x-transition:leave="transition ease-in duration-150"
     x-transition:leave-start="opacity-100"
     x-transition:leave-end="opacity-0"
     class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 safe-area-inset-top safe-area-inset-bottom"
     x-cloak>
  
  <!-- 遮罩 -->
  <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm" @click="hide()"></div>
  
  <!-- 内容 -->
   <div class="relative bg-white dark:bg-zinc-900 rounded-neo-lg border border-zinc-200 dark:border-zinc-700 shadow-neo-lift dark:shadow-neo-lift-dark w-full max-w-3xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col"
       x-transition:enter="transition ease-out duration-200"
       x-transition:enter-start="opacity-0 scale-95"
       x-transition:enter-end="opacity-100 scale-100">
    
    <!-- 头部 -->
     <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/90 dark:bg-zinc-800/90">
        <h3 class="text-lg font-semibold text-zinc-800 dark:text-zinc-100">内容预览</h3>
        <div class="flex items-center gap-3 text-zinc-600 dark:text-zinc-300">
         <!-- Markdown 切换 -->
         <label class="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300 cursor-pointer">
           <input type="checkbox" x-model="isMarkdown" class="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-brand focus:ring-0">
            <span>Markdown 渲染</span>
          </label>
          <!-- 关闭按钮 -->
         <button @click="hide()" class="p-1 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-200">
           <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
             <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
           </svg>
        </button>
      </div>
    </div>
    
    <!-- iframe 容器 -->
    <div class="flex-1 overflow-hidden p-4">
      <iframe
        :srcdoc="iframeContent"
        sandbox=""
        class="w-full h-full min-h-[220px] sm:min-h-[300px] border-0 rounded-neo bg-zinc-50 dark:bg-zinc-900">
      </iframe>
    </div>
  </div>
</div>
  `;
}

/**
 * 生成 Greeting 预览面板 HTML
 * @returns {string} HTML 字符串
 */
export function generateGreetingPreviewHTML() {
  return `
<!-- Greeting 预览面板 -->
<div x-data="greetingPreview()"
     x-show="isVisible"
     x-transition:enter="transition ease-out duration-200"
     x-transition:enter-start="opacity-0"
     x-transition:enter-end="opacity-100"
     x-transition:leave="transition ease-in duration-150"
     x-transition:leave-start="opacity-100"
     x-transition:leave-end="opacity-0"
     class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 safe-area-inset-top safe-area-inset-bottom"
     x-cloak
     @greeting-preview.window="currentGreeting = $event.detail.content; currentIndex = $event.detail.index ?? -1; isVisible = true">
  
  <!-- 遮罩 -->
  <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm" @click="close()"></div>
  
  <!-- 内容 -->
   <div class="relative bg-white dark:bg-zinc-900 rounded-neo-lg border border-zinc-200 dark:border-zinc-700 shadow-neo-lift dark:shadow-neo-lift-dark w-full max-w-3xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col">
    
    <!-- 头部 -->
     <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/90 dark:bg-zinc-800/90">
        <h3 class="text-lg font-semibold text-zinc-800 dark:text-zinc-100" x-text="title"></h3>
        <div class="flex items-center text-zinc-600 dark:text-zinc-300">
          <!-- 关闭按钮 -->
          <button @click="close()" class="p-1 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-200">
           <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
             <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
           </svg>
        </button>
      </div>
    </div>
    
    <!-- iframe 容器 -->
    <div class="flex-1 overflow-hidden p-4">
      <iframe
        :srcdoc="iframeContent"
        sandbox=""
        class="w-full h-full min-h-[240px] sm:min-h-[360px] border-0 rounded-neo bg-zinc-50 dark:bg-zinc-900">
      </iframe>
    </div>
  </div>
</div>
  `;
}

export default {
  sanitizeHTML,
  renderMarkdown,
  renderContent,
  generateIframeContent,
  previewPanelComponent,
  greetingPreviewComponent,
  registerPreviewComponents,
  generatePreviewPanelHTML,
  generateGreetingPreviewHTML,
};
