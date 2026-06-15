import { createInternalTextMessage } from '../llm/messages.js';
import { parseExampleMessages } from './examples.js';
import { activateLorebookEntries, formatLorebookSection } from './lorebook.js';
import {
  createMacroContext,
  expandCardPreviewMacros,
  normalizePreviewName,
  stripNamePrefix,
} from './macros.js';

const DEFAULT_USER_NAME = 'user';
const DEFAULT_CHAR_NAME = '角色';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object';
}

export function getCardPreviewData(card) {
  if (isObject(card?.data) && isObject(card.data.data)) return card.data.data;
  if (isObject(card?.data)) return card.data;
  return isObject(card) ? card : {};
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getCardPreviewNames(cardData = {}, options = {}) {
  const charName = normalizePreviewName(options.charName, normalizePreviewName(cardData?.name, DEFAULT_CHAR_NAME));
  const userName = normalizePreviewName(options.userName, DEFAULT_USER_NAME);
  return { charName, userName };
}

export function buildGreetingOptions(cardData = {}) {
  const options = [];
  const firstMes = normalizeText(cardData.first_mes);
  if (firstMes) {
    options.push({ id: 'first', label: '主开场白', content: cardData.first_mes });
  }

  asArray(cardData.alternate_greetings).forEach((content, index) => {
    if (normalizeText(content)) {
      options.push({ id: `alt_${index}`, label: `备用开场白 ${index + 1}`, content });
    }
  });

  asArray(cardData.group_only_greetings).forEach((content, index) => {
    if (normalizeText(content)) {
      options.push({ id: `group_${index}`, label: `群聊开场白 ${index + 1}`, content });
    }
  });

  if (!options.length) {
    options.push({ id: 'empty', label: '暂无开场白', content: '' });
  }
  return options;
}

export function resolveGreetingOption(cardData = {}, selectedGreetingId = '') {
  const options = buildGreetingOptions(cardData);
  return options.find((option) => option.id === selectedGreetingId) || options[0];
}

export function buildGreetingPreviewMessage(cardData = {}, selectedGreetingId = '', userName = DEFAULT_USER_NAME) {
  const names = getCardPreviewNames(cardData, { userName });
  const context = createMacroContext(names);
  const greeting = resolveGreetingOption(cardData, selectedGreetingId);
  const content = stripNamePrefix(
    expandCardPreviewMacros(greeting?.content || '', context).trim(),
    context.charName,
  ).trim();
  return {
    greeting,
    content,
    charName: names.charName,
    userName: names.userName,
  };
}

function buildBaseSystemPrompt({ charName, userName }) {
  return [
    '你正在 Arcamage 的“卡片效果预览”中模拟 SillyTavern 风格的一对一角色扮演。',
    `你必须扮演「${charName}」，用户名是「${userName}」。`,
    `只输出「${charName}」的下一条回复；不要代替用户行动，不要解释系统提示或角色卡结构。`,
    '保持角色卡设定、语气、场景与世界书信息的一致性。',
  ].join('\n');
}

function buildCoreCardPrompt(cardData, context) {
  const sections = [
    ['角色描述', cardData.description],
    ['性格', cardData.personality],
    ['场景', cardData.scenario],
    ['创作者备注（仅作角色理解参考，不要泄露给用户）', cardData.creator_notes],
  ]
    .map(([label, value]) => {
      const content = expandCardPreviewMacros(value || '', context).trim();
      return content ? `## ${label}\n${content}` : '';
    })
    .filter(Boolean);

  return sections.join('\n\n');
}

function normalizePreviewHistory(messages, greeting, context, userInput = '') {
  const greetingContent = stripNamePrefix(
    expandCardPreviewMacros(greeting?.content || '', context).trim(),
    context.charName,
  ).trim();
  let greetingConsumed = false;

  const history = asArray(messages)
    .map((message) => {
      const role = message?.role === 'assistant' ? 'assistant' : 'user';
      const greetingId = message?.greetingId || null;
      if (role === 'assistant' && message?.kind === 'greeting') {
        if (greetingId !== (greeting?.id || 'first')) return null;
        if (greetingConsumed) return null;
        greetingConsumed = true;
        return {
          role,
          content: greetingContent || expandCardPreviewMacros(message?.content || '', context).trim(),
          greetingId,
        };
      }
      return {
        role,
        content: expandCardPreviewMacros(message?.content || '', context).trim(),
        greetingId,
      };
    })
    .filter((message) => message?.content);

  if (greetingContent && !greetingConsumed) {
    history.unshift({ role: 'assistant', content: greetingContent, greetingId: greeting?.id || 'first' });
  }

  const currentInput = expandCardPreviewMacros(userInput || '', context).trim();
  const last = history.at(-1);
  if (currentInput && !(last?.role === 'user' && last.content === currentInput)) {
    history.push({ role: 'user', content: currentInput });
  }

  return history;
}

function createSystemMessage(text) {
  const content = String(text || '').trim();
  return content ? createInternalTextMessage('system', content) : null;
}

function toInternalHistoryMessages(history) {
  return history.map((message) => createInternalTextMessage(message.role, message.content));
}

function splitCurrentUserMessage(historyMessages) {
  const messages = [...historyMessages];
  const last = messages.at(-1);
  if (last?.role !== 'user') {
    return { priorMessages: messages, currentUserMessage: null };
  }
  return { priorMessages: messages.slice(0, -1), currentUserMessage: last };
}

export function buildCardPreviewMessages({ card, selectedGreetingId, userName, messages = [], userInput = '' } = {}) {
  const cardData = getCardPreviewData(card);
  const names = getCardPreviewNames(cardData, { userName });
  const context = createMacroContext(names);
  const greeting = resolveGreetingOption(cardData, selectedGreetingId);
  const history = normalizePreviewHistory(messages, greeting, context, userInput);
  const lorebook = activateLorebookEntries(cardData, {
    messages: history,
    userInput,
    context,
    budget: Number(cardData?.character_book?.token_budget) || undefined,
  });

  const systemMessages = [
    createSystemMessage(buildBaseSystemPrompt(names)),
    createSystemMessage(expandCardPreviewMacros(cardData.system_prompt || '', context)),
    createSystemMessage(formatLorebookSection(lorebook.before) ? `世界书（当前已激活，置于角色设定前）：\n${formatLorebookSection(lorebook.before)}` : ''),
    createSystemMessage(buildCoreCardPrompt(cardData, context)),
  ].filter(Boolean);

  const exampleMessages = parseExampleMessages(cardData.mes_example || '', context);
  const historyMessages = toInternalHistoryMessages(history);
  const { priorMessages, currentUserMessage } = splitCurrentUserMessage(historyMessages);
  const trailingMessages = [
    createSystemMessage(formatLorebookSection(lorebook.after) ? `世界书（当前已激活，置于聊天后）：\n${formatLorebookSection(lorebook.after)}` : ''),
    createSystemMessage(expandCardPreviewMacros(cardData.post_history_instructions || '', context)),
  ].filter(Boolean);

  return {
    messages: [
      ...systemMessages,
      ...exampleMessages,
      ...priorMessages,
      ...trailingMessages,
      ...(currentUserMessage ? [currentUserMessage] : []),
    ],
    meta: {
      charName: names.charName,
      userName: names.userName,
      greeting,
      activatedLorebookEntries: lorebook.activated,
    },
  };
}

export default {
  buildGreetingPreviewMessage,
  buildCardPreviewMessages,
  buildGreetingOptions,
  resolveGreetingOption,
  getCardPreviewData,
  getCardPreviewNames,
};
