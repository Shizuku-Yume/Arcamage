import { createInternalTextMessage } from '../llm/messages.js';
import { expandCardPreviewMacros, stripNamePrefix } from './macros.js';

const START_PATTERN = /<START>/i;
const MAX_EXAMPLE_MESSAGES = 16;

function splitExampleBlocks(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  return normalized
    .split(START_PATTERN)
    .map((block) => block.trim())
    .filter(Boolean);
}

function detectSpeaker(line, context) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;

  const userNames = [context.userName, '{{user}}', '<USER>', 'user', 'User'];
  const charNames = [context.charName, '{{char}}', '<BOT>', 'char', 'Char'];

  for (const name of userNames) {
    const stripped = stripNamePrefix(trimmed, name);
    if (stripped !== trimmed) return { role: 'user', content: stripped };
  }
  for (const name of charNames) {
    const stripped = stripNamePrefix(trimmed, name);
    if (stripped !== trimmed) return { role: 'assistant', content: stripped };
  }
  return null;
}

function flushMessage(messages, current, context) {
  if (!current) return;
  const content = expandCardPreviewMacros(current.lines.join('\n').trim(), context).trim();
  if (!content) return;
  messages.push(createInternalTextMessage(current.role, content, { name: current.role === 'user' ? 'example_user' : 'example_assistant' }));
}

export function parseExampleMessages(mesExample, context = {}, options = {}) {
  const maxMessages = Number.isFinite(options.maxMessages) ? Math.max(0, options.maxMessages) : MAX_EXAMPLE_MESSAGES;
  if (maxMessages === 0) return [];

  const messages = [];
  for (const block of splitExampleBlocks(mesExample)) {
    let current = null;
    const lines = block.split('\n');

    for (const line of lines) {
      const speaker = detectSpeaker(line, context);
      if (speaker) {
        flushMessage(messages, current, context);
        current = { role: speaker.role, lines: [speaker.content] };
      } else if (current) {
        current.lines.push(line);
      }

      if (messages.length >= maxMessages) return messages.slice(0, maxMessages);
    }

    flushMessage(messages, current, context);
    if (messages.length >= maxMessages) return messages.slice(0, maxMessages);
  }

  return messages.slice(0, maxMessages);
}

export default {
  parseExampleMessages,
};
