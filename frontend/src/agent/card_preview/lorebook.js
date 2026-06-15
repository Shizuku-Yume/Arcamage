import { expandCardPreviewMacros } from './macros.js';

const DEFAULT_LOREBOOK_BUDGET = 6000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toSearchText(value) {
  if (Array.isArray(value)) return value.map(toSearchText).join('\n');
  if (!value || typeof value !== 'object') return String(value || '');
  return [value.content, value.text].filter(Boolean).join('\n');
}

function normalizeFlags(entry) {
  const extensions = entry?.extensions || {};
  return {
    caseSensitive: entry?.case_sensitive === true || extensions.case_sensitive === true,
    wholeWords: entry?.match_whole_words === true || extensions.match_whole_words === true,
    useRegex: entry?.use_regex === true || extensions.use_regex === true,
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createKeywordPattern(keyword, flags) {
  const source = flags.useRegex ? String(keyword || '') : escapeRegExp(keyword);
  if (!source) return null;
  const wrapped = flags.wholeWords ? `(?:^|[^\\p{L}\\p{N}_])(${source})(?=$|[^\\p{L}\\p{N}_])` : source;
  try {
    return new RegExp(wrapped, flags.caseSensitive ? 'u' : 'iu');
  } catch {
    return null;
  }
}

function keywordMatches(keyword, text, flags) {
  const normalized = String(keyword || '').trim();
  if (!normalized) return false;
  const haystack = String(text || '');
  const pattern = createKeywordPattern(normalized, flags);
  if (pattern) return pattern.test(haystack);
  if (flags.caseSensitive) return haystack.includes(normalized);
  return haystack.toLowerCase().includes(normalized.toLowerCase());
}

function anyKeywordMatches(keys, text, flags) {
  return asArray(keys).some((key) => keywordMatches(key, text, flags));
}

function getEntryPosition(entry) {
  const position = String(entry?.position || entry?.extensions?.position || '').trim();
  if (position === 'after_char' || position === 'after') return 'after';
  return 'before';
}

function compareEntries(left, right) {
  const leftPriority = Number(left?.priority ?? 0) || 0;
  const rightPriority = Number(right?.priority ?? 0) || 0;
  if (leftPriority !== rightPriority) return rightPriority - leftPriority;
  const leftOrder = Number(left?.insertion_order ?? 0) || 0;
  const rightOrder = Number(right?.insertion_order ?? 0) || 0;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return String(left?.name || left?.id || '').localeCompare(String(right?.name || right?.id || ''));
}

function shouldActivateEntry(entry, scanText) {
  if (!entry || entry.enabled === false) return false;
  if (entry.constant === true) return true;

  const flags = normalizeFlags(entry);
  const primaryMatches = anyKeywordMatches(entry.keys, scanText, flags);
  if (!primaryMatches) return false;
  if (entry.selective !== true) return true;
  return anyKeywordMatches(entry.secondary_keys, scanText, flags);
}

function formatEntry(entry, context) {
  const title = String(entry?.name || entry?.comment || '').trim();
  const content = expandCardPreviewMacros(entry?.content || '', context).trim();
  if (!content) return '';
  return title ? `[${title}]\n${content}` : content;
}

function pushWithinBudget(target, entry, budgetState, context) {
  const content = formatEntry(entry, context);
  if (!content) return;
  const nextSize = budgetState.used + content.length;
  if (nextSize > budgetState.limit && target.length > 0) return;
  target.push({
    id: entry?.id ?? null,
    name: entry?.name || entry?.comment || '',
    position: getEntryPosition(entry),
    priority: Number(entry?.priority ?? 0) || 0,
    content,
  });
  budgetState.used = nextSize;
}

export function buildLorebookScanText({ messages = [], userInput = '', cardData = {} } = {}) {
  const recentMessages = asArray(messages).slice(-12).map(toSearchText).join('\n');
  return [
    recentMessages,
    userInput,
    cardData?.description,
    cardData?.personality,
    cardData?.scenario,
    cardData?.creator_notes,
  ].filter(Boolean).join('\n');
}

export function activateLorebookEntries(cardData = {}, { messages = [], userInput = '', context = {}, budget = DEFAULT_LOREBOOK_BUDGET } = {}) {
  const book = cardData?.character_book;
  const entries = asArray(book?.entries);
  if (!entries.length) {
    return { before: [], after: [], activated: [] };
  }

  const scanText = buildLorebookScanText({ messages, userInput, cardData });
  const activeEntries = entries
    .filter((entry) => shouldActivateEntry(entry, scanText))
    .sort(compareEntries);

  const before = [];
  const after = [];
  const budgetState = { used: 0, limit: Number.isFinite(budget) ? Math.max(0, budget) : DEFAULT_LOREBOOK_BUDGET };

  for (const entry of activeEntries) {
    const target = getEntryPosition(entry) === 'after' ? after : before;
    pushWithinBudget(target, entry, budgetState, context);
  }

  return {
    before,
    after,
    activated: [...before, ...after],
  };
}

export function formatLorebookSection(entries) {
  const usable = asArray(entries).map((entry) => String(entry?.content || '').trim()).filter(Boolean);
  if (!usable.length) return '';
  return usable.join('\n\n');
}

export default {
  activateLorebookEntries,
  buildLorebookScanText,
  formatLorebookSection,
};
