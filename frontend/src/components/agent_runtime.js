/**
 * AI Agent runtime
 *
 * Orchestrates tool-use flow and auto-apply pipeline.
 */

import Alpine from 'alpinejs';
import { deepClone, getByPath, setByPath } from '../store.js';
import { validateCard } from '../api.js';
import { completeChat, streamCompleteChat } from './ai_client.js';
import { REGISTRY_VERSION } from '../agent/field_registry.js';
import { executeToolCall, getToolDefinitions, TOOL_LIMITS } from '../agent/tool_executor.js';
import { recordToolEvent } from '../agent/tool_logger.js';
import { buildDelta, buildSnapshot, DEFAULT_SNAPSHOT_PATHS } from '../agent/snapshot_provider.js';
import { createEmptySkillContextMeta, buildSkillContext } from '../agent/skill_context.js';
import {
  exportSkillRepositoryState,
  importSkillRepositoryState,
  loadSkillCatalog,
  saveSkillPreferenceState,
} from '../agent/skill_manager.js';
import { SKILL_GUARDRAIL_PROMPT } from '../agent/skill_constants.js';

const MACRO_REGEX = /\{\{\s*[^}]+\s*\}\}/g;
const HTML_REGEX = /<[^>]+>/g;
const TOOL_SYSTEM_PROMPT = `你是 Arcamage 的 AI 角色卡助手，专门帮助用户创建、分析和优化 SillyTavern 角色卡。

## 你的能力

你可以：
- **阅读分析** - 读取卡片字段，分析角色设定、写作风格、叙事结构
- **创作辅助** - 翻译、润色、扩写、优化角色描述和对话
- **模拟体验** - 基于角色设定模拟对话风格，帮助用户预览角色表现
- **教学指导** - 解释字段作用、最佳实践、常见问题
- **诊断修复** - 发现设定矛盾、建议改进方案

## 角色卡核心字段速查

| 字段 | 用途 | 建议 |
|------|------|------|
| name | 角色名 | 简洁有辨识度 |
| description | 外貌/背景/性格详述 | AI理解角色的主要来源 |
| personality | 性格特征速写 | 简明扼要的关键词 |
| scenario | 场景设定 | 角色所处的世界和情境 |
| first_mes | 开场白 | 第一印象，定调全局 |
| mes_example | 对话示例 | 教AI如何扮演此角色 |
| system_prompt | 系统指令 | 高级用户的行为控制 |
| alternate_greetings | 备选开场白 | 多样化互动入口 |
| character_book | 世界书/Lorebook | 动态知识库 |

## 工作流程

**判断用户意图后选择模式：**

1. **修改模式**（用户要求编辑、翻译、优化等）
   - 先用 list_fields/view_field 确认当前值
   - 使用 edit_field/set_field/append_entry 等完成修改
   - 给出一句话摘要

2. **分析模式**（用户要求分析、评价、解释等）
   - 用 view_field 读取相关字段
   - 直接给出分析结论，无需工具修改

3. **模拟模式**（用户要求模拟对话、预览体验等）
   - 读取 personality、first_mes、mes_example 等
   - 基于角色设定生成示范性对话

4. **附件参考**（用户提供参考资料时）
   - 先 list_refs 查看附件列表
   - 用 view_ref/search_ref 检索内容
   - 结合附件和卡片字段完成任务

## 约束

- 使用工具访问字段，不要编造路径
- remove_entry 的 path 必须包含数组索引 [index]
- 对 risk>=medium 字段（如 first_mes、system_prompt）修改时使用 old_hash
- 保留原有宏（如 {{user}}、{{char}}）和 HTML 标签
- 不输出代码块，用自然语言交流
`;

const SKILL_TOOL_SYSTEM_PROMPT = `当技能工具可用时，你可以直接管理本地技能仓：
- list_skills: 列出技能目录
- view_skill: 读取技能（description/content/references）
- save_skill: 创建或更新技能；支持通过 previous_skill_id 重命名
- delete_skill: 删除技能

技能工具约束：
- skill_id / reference_name 必须是安全标识符（中英文字母数字空格/_/-）
- references 输入仅使用 [{ name, content }]，路径由系统映射为 references/<name>.md
- 仅允许本地仓库 markdown 内容，不可使用远程 URL 或路径穿越`; 

const TOOL_CALL_LIMIT = 50;
const TOOL_WRITE_LIMIT = TOOL_LIMITS.MAX_PATCH_CHARS;
const TOOL_WRITE_WARNING_RATIO = 0.9;
const TOOL_CONSECUTIVE_ERROR_LIMIT = 10;

function getToolCallLimit() {
  return Alpine.store('settings')?.agentToolCallLimit ?? TOOL_CALL_LIMIT;
}

const CAS_RECOVERABLE_ERRORS = new Set(['E_PRECONDITION_FAILED', 'E_CAS_MISMATCH']);
const CAS_RECOVERABLE_TOOLS = new Set([
  'edit_field',
  'set_field',
  'clear_field',
  'append_entry',
  'remove_entry',
  'move_entry',
]);

const TOOL_SUPPORT_CACHE = new Map();
const TOOL_UNSUPPORTED_KEYWORDS = [
  'tool_calls',
  'tool calls',
  'tool_choice',
  'tool choice',
  'function_call',
  'function call',
  'tools',
];
const TOOL_UNSUPPORTED_HINTS = [
  'not supported',
  'unsupported',
  'does not support',
  'not allowed',
  'cannot be used',
  'is not available',
];

const STREAMING_PLACEHOLDER_TEXT = '生成中...';

let runtimeInstance = null;
let messageSeq = 0;
let appliedSeq = 0;

function getAgentStore() {
  return Alpine.store('agent');
}

function getCardStore() {
  return Alpine.store('card');
}

function getSuppliersStore() {
  return Alpine.store('suppliers');
}

function getToastStore() {
  return Alpine.store('toast');
}

function normalizeSupplierUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return '';
  return baseUrl.trim().replace(/\/+$/, '');
}

function getToolSupportKey(suppliers) {
  const baseUrl = normalizeSupplierUrl(suppliers?.baseUrl || '');
  const model = typeof suppliers?.model === 'string' ? suppliers.model.trim() : '';
  const useProxy = suppliers?.useProxy ?? true;
  if (!baseUrl || !model) return '';
  return `${baseUrl}::${model}::${useProxy ? 'proxy' : 'direct'}`;
}

function getToolSupportState(suppliers) {
  const supportKey = getToolSupportKey(suppliers);
  if (!supportKey) return null;
  return TOOL_SUPPORT_CACHE.get(supportKey);
}

function setToolSupportState(suppliers, supported) {
  const supportKey = getToolSupportKey(suppliers);
  if (!supportKey) return;
  TOOL_SUPPORT_CACHE.set(supportKey, Boolean(supported));
}

function clearToolSupportCache() {
  TOOL_SUPPORT_CACHE.clear();
}

function shouldSkipToolFlowForUnsupportedSupplier(suppliers) {
  return getToolSupportState(suppliers) === false;
}

function isToolUnsupportedError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (!message) return false;
  const hasKeyword = TOOL_UNSUPPORTED_KEYWORDS.some((token) => message.includes(token));
  if (!hasKeyword) return false;
  return TOOL_UNSUPPORTED_HINTS.some((hint) => message.includes(hint));
}

function nextRunId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nextMessageId() {
  messageSeq += 1;
  return `msg_${Date.now()}_${messageSeq}`;
}

function nextAppliedId() {
  appliedSeq += 1;
  return `apply_${Date.now()}_${appliedSeq}`;
}

function extractMacros(text) {
  if (!text || typeof text !== 'string') return new Set();
  const matches = text.match(MACRO_REGEX) || [];
  return new Set(matches.map((item) => item.trim()));
}

function detectMacroLoss(before, after) {
  const beforeSet = extractMacros(before);
  const afterSet = extractMacros(after);
  const lost = [];
  for (const macro of beforeSet) {
    if (!afterSet.has(macro)) {
      lost.push(macro);
    }
  }
  return lost;
}

function hasHtml(text) {
  if (!text || typeof text !== 'string') return false;
  return HTML_REGEX.test(text);
}

function detectContentWarnings(beforeCard, afterCard) {
  const warnings = [];
  const checkTextField = (path, label) => {
    const before = getByPath(beforeCard, path);
    const after = getByPath(afterCard, path);

    if (typeof before === 'string' && typeof after === 'string') {
      const lostMacros = detectMacroLoss(before, after);
      if (lostMacros.length > 0) {
        warnings.push(`${label} 可能丢失宏：${lostMacros.join(', ')}`);
      }
      if (hasHtml(before) && !hasHtml(after)) {
        warnings.push(`${label} 可能移除了 HTML 标签`);
      }
    }
  };

  const checkArrayField = (path, label) => {
    const beforeArr = getByPath(beforeCard, path);
    const afterArr = getByPath(afterCard, path);
    if (!Array.isArray(beforeArr) || !Array.isArray(afterArr)) return;

    const beforeText = beforeArr.filter((item) => typeof item === 'string').join('\n');
    const afterText = afterArr.filter((item) => typeof item === 'string').join('\n');

    const lostMacros = detectMacroLoss(beforeText, afterText);
    if (lostMacros.length > 0) {
      warnings.push(`${label} 可能丢失宏：${lostMacros.join(', ')}`);
    }
    if (hasHtml(beforeText) && !hasHtml(afterText)) {
      warnings.push(`${label} 可能移除了 HTML 标签`);
    }
  };

  checkTextField('data.first_mes', '开场白');
  checkArrayField('data.alternate_greetings', '备选开场白');
  checkArrayField('data.group_only_greetings', '群聊开场白');

  return warnings;
}

function buildToolPromptPayload(payload, instruction) {
  const contextJson = JSON.stringify(payload, null, 2);
  return `当前上下文（snapshot/delta）：\n${contextJson}\n\n用户指令：${instruction}`;
}

function buildToolMessages(history, instruction, payload, skillRuntimeContext = null, options = {}) {
  const recent = Array.isArray(history) ? history.slice(-8) : [];
  const userMessage = {
    role: 'user',
    content: buildToolPromptPayload(payload, instruction),
  };
  const includeSkillTools = options?.includeSkillTools === true;
  const systemMessages = [{ role: 'system', content: TOOL_SYSTEM_PROMPT }];
  if (includeSkillTools) {
    systemMessages.push({ role: 'system', content: SKILL_TOOL_SYSTEM_PROMPT });
  }
  if (skillRuntimeContext?.contextText) {
    systemMessages.push({ role: 'system', content: SKILL_GUARDRAIL_PROMPT });
    systemMessages.push({ role: 'system', content: skillRuntimeContext.contextText });
  }
  return [...systemMessages, ...recent, userMessage];
}

function normalizeSkillSelectionByCatalog(selectedIds, catalog) {
  if (!Array.isArray(selectedIds)) return [];
  const catalogSet = new Set(
    (catalog || [])
      .map((entry) => String(entry?.id || '').trim())
      .filter(Boolean),
  );
  const normalized = selectedIds
    .map((item) => String(item || '').trim())
    .filter((item) => item && catalogSet.has(item));
  return Array.from(new Set(normalized));
}

async function resolveSkillRuntimeContext(agent, instruction) {
  const skillState = agent?.skills;
  if (!skillState) return null;
  const skillFeatureEnabled = Alpine.store('settings')?.skillsEnabled !== false;

  skillState.autoMatchedIds = [];
  skillState.loadedContextMeta = createEmptySkillContextMeta();
  skillState.lastError = null;

  if (!skillFeatureEnabled || skillState.enabled === false) {
    return null;
  }

  try {
    const catalogResult = await loadSkillCatalog();
    skillState.catalog = Array.isArray(catalogResult.catalog) ? catalogResult.catalog : [];
    if (catalogResult.error) {
      skillState.lastError = catalogResult.error;
      return null;
    }

    const normalizedSelected = normalizeSkillSelectionByCatalog(skillState.selectedIds, skillState.catalog);
    if (JSON.stringify(normalizedSelected) !== JSON.stringify(skillState.selectedIds || [])) {
      skillState.selectedIds = normalizedSelected;
      saveSkillPreferenceState({
        enabled: skillState.enabled !== false,
        selectedIds: skillState.selectedIds,
      });
    }

    const contextResult = await buildSkillContext({
      instruction,
      enabled: skillState.enabled !== false,
      selectedIds: skillState.selectedIds,
      catalog: skillState.catalog,
      autoMatchLimit: Alpine.store('settings')?.agentSkillAutoMatchLimit ?? 3,
    });

    skillState.autoMatchedIds = Array.isArray(contextResult.autoMatchedIds) ? contextResult.autoMatchedIds : [];
    skillState.loadedContextMeta = contextResult.meta || createEmptySkillContextMeta();
    skillState.lastError = contextResult.error || null;

    if (!contextResult.contextText) {
      return null;
    }
    return contextResult;
  } catch (error) {
    skillState.autoMatchedIds = [];
    skillState.loadedContextMeta = createEmptySkillContextMeta();
    skillState.lastError = error?.message || '技能上下文加载失败';
    return null;
  }
}

function extractCompletionMessage(response) {
  const choice = response?.choices?.[0];
  return choice?.message || null;
}

function isUsableCompletionMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
  if (message.tool_calls && typeof message.tool_calls === 'object') return true;
  if (message.function_call?.name) return true;
  return typeof message.content === 'string';
}

function resolveSupplierTemperature(suppliers) {
  const numeric = Number(suppliers?.temperature);
  if (!Number.isFinite(numeric)) return 1.0;
  return Math.min(2, Math.max(0, numeric));
}

async function requestToolRoundCompletion({
  toolMessages,
  suppliers,
  toolDefinitions,
  toolChoice,
  signal,
  onDelta,
  onThinkingDelta,
}) {
  const temperature = resolveSupplierTemperature(suppliers);
  try {
    const streamed = await streamCompleteChat({
      messages: toolMessages,
      model: suppliers.model,
      baseUrl: suppliers.baseUrl,
      apiKey: suppliers.apiKey,
      useProxy: suppliers.useProxy ?? true,
      temperature,
      tools: toolDefinitions,
      toolChoice,
      signal,
      onDelta,
      onThinkingDelta,
    });
    const streamMessage = extractCompletionMessage(streamed);
    if (isUsableCompletionMessage(streamMessage)) {
      return streamed;
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    if (isToolUnsupportedError(error)) {
      setToolSupportState(suppliers, false);
      throw error;
    }
  }

  try {
    const completion = await completeChat({
      messages: toolMessages,
      model: suppliers.model,
      baseUrl: suppliers.baseUrl,
      apiKey: suppliers.apiKey,
      useProxy: suppliers.useProxy ?? true,
      temperature,
      tools: toolDefinitions,
      toolChoice,
      signal,
    });
    const fallbackMessage = completion?.choices?.[0]?.message || null;
    const fallbackContent = fallbackMessage?.content;
    if (typeof fallbackContent === 'string' && fallbackContent) {
      const split = splitThinkTaggedContent(fallbackContent);
      if (split.visibleText) {
        onDelta?.(split.visibleText);
      }
      if (split.thinkingText) {
        onThinkingDelta?.(split.thinkingText);
      }
    }
    const fallbackReasoning = normalizeThinkingText(fallbackMessage?.reasoning_content || '');
    if (fallbackReasoning) {
      onThinkingDelta?.(fallbackReasoning);
    }
    return completion;
  } catch (error) {
    if (isToolUnsupportedError(error)) {
      setToolSupportState(suppliers, false);
    }
    throw error;
  }
}

function normalizeToolCalls(message, runId, toolCallsUsed) {
  if (!message || typeof message !== 'object') return [];
  const raw = message.tool_calls;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const name = raw.function?.name || raw.name;
    if (name) {
      return [{
        id: raw.id || `tool_${runId}_${toolCallsUsed + 1}`,
        function: {
          name,
          arguments: raw.function?.arguments || raw.arguments || '',
        },
      }];
    }
  }
  const fn = message.function_call;
  if (fn?.name) {
    return [{
      id: `tool_${runId}_${toolCallsUsed + 1}`,
      function: {
        name: fn.name,
        arguments: fn.arguments || '',
      },
    }];
  }
  return [];
}

function buildToolParseError({ context, toolCallId, message }) {
  return {
    status: 'error',
    error_code: 'E_CONSTRAINT_VIOLATION',
    message: message || '工具参数解析失败',
    warnings: [],
    diff_summary: null,
    diff_summaries: null,
    card_id: context?.card_id || null,
    registry_version: context?.registry_version || null,
    tool_call_id: toolCallId || null,
  };
}

function buildToolError({ context, toolCallId, code, message, warnings = [] }) {
  return {
    status: 'error',
    error_code: code,
    message,
    warnings,
    diff_summary: null,
    diff_summaries: null,
    card_id: context?.card_id || null,
    registry_version: context?.registry_version || null,
    tool_call_id: toolCallId || null,
  };
}

function normalizeToolArgs(toolName, args) {
  const effectiveToolName = String(toolName || '').trim().split(':').pop();
  const payload = args && typeof args === 'object' ? { ...args } : {};

  const moveAlias = (target, aliases) => {
    if (Object.prototype.hasOwnProperty.call(payload, target)) {
      aliases.forEach((alias) => {
        if (Object.prototype.hasOwnProperty.call(payload, alias)) {
          delete payload[alias];
        }
      });
      return;
    }
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(payload, alias)) {
        payload[target] = payload[alias];
        delete payload[alias];
        break;
      }
    }
  };

  moveAlias('path', ['field', 'field_path', 'fieldPath']);
  moveAlias('from_path', ['fromPath', 'from', 'source_path']);
  moveAlias('to_index', ['toIndex', 'targetIndex']);
  moveAlias('ref_id', ['refId', 'ref']);
  moveAlias('old_value', ['oldValue']);
  moveAlias('old_hash', ['oldHash']);
  moveAlias('new_value', ['newValue']);
  moveAlias('value', ['val']);
  moveAlias('include_indices', ['includeIndices']);
  moveAlias('max_chars', ['maxChars']);
  moveAlias('max_bytes', ['maxBytes']);
  moveAlias('max_hits', ['maxHits']);
  moveAlias('snippet_chars', ['snippetChars']);
  moveAlias('skill_id', ['skillId', 'id', 'skill_name', 'skillName', 'name']);
  moveAlias('previous_skill_id', ['previousSkillId', 'old_skill_id', 'oldSkillId', 'source_skill_id', 'sourceSkillId']);

  if (effectiveToolName === 'move_entry' && !payload.from_path && payload.path) {
    payload.from_path = payload.path;
    delete payload.path;
  }
  if (effectiveToolName === 'remove_entry' && !payload.path && payload.from_path) {
    payload.path = payload.from_path;
  }

  if (effectiveToolName === 'edit_field') {
    if (!Object.prototype.hasOwnProperty.call(payload, 'new_value')
      && Object.prototype.hasOwnProperty.call(payload, 'value')) {
      payload.new_value = payload.value;
      delete payload.value;
    }
  }
  if (effectiveToolName === 'set_field' || effectiveToolName === 'append_entry') {
    if (!Object.prototype.hasOwnProperty.call(payload, 'value')
      && Object.prototype.hasOwnProperty.call(payload, 'new_value')) {
      payload.value = payload.new_value;
      delete payload.new_value;
    }
  }

  if (effectiveToolName === 'list_fields') {
    if (!Object.prototype.hasOwnProperty.call(payload, 'filters')
      && Object.prototype.hasOwnProperty.call(payload, 'filter')) {
      payload.filters = payload.filter;
      delete payload.filter;
    }
    if (!payload.filters && (payload.path_prefix || payload.pathPrefix)) {
      payload.filters = {};
    }
    if (payload.path_prefix) {
      payload.filters = { ...(payload.filters || {}), path_prefix: payload.path_prefix };
      delete payload.path_prefix;
    }
    if (payload.pathPrefix) {
      payload.filters = { ...(payload.filters || {}), path_prefix: payload.pathPrefix };
      delete payload.pathPrefix;
    }
    if (payload.filters?.pathPrefix) {
      payload.filters.path_prefix = payload.filters.pathPrefix;
      delete payload.filters.pathPrefix;
    }
  }

  if (effectiveToolName === 'list_refs') {
    if (!Object.prototype.hasOwnProperty.call(payload, 'filters')
      && Object.prototype.hasOwnProperty.call(payload, 'filter')) {
      payload.filters = payload.filter;
      delete payload.filter;
    }
    if (payload.filters?.hasText !== undefined) {
      payload.filters.has_text = payload.filters.hasText;
      delete payload.filters.hasText;
    }
    if (payload.filters?.maxBytes !== undefined) {
      payload.filters.max_bytes = payload.filters.maxBytes;
      delete payload.filters.maxBytes;
    }
    if (payload.filters?.createdAfter !== undefined) {
      payload.filters.created_after = payload.filters.createdAfter;
      delete payload.filters.createdAfter;
    }
  }

  if (effectiveToolName === 'view_ref' || effectiveToolName === 'search_ref') {
    if (payload.refId && !payload.ref_id) {
      payload.ref_id = payload.refId;
      delete payload.refId;
    }
  }
  if (effectiveToolName === 'search_ref') {
    if (payload.keyword && !payload.query) {
      payload.query = payload.keyword;
      delete payload.keyword;
    }
  }

  if (effectiveToolName === 'save_skill') {
    if (!Object.prototype.hasOwnProperty.call(payload, 'references')) {
      if (Array.isArray(payload.refs)) {
        payload.references = payload.refs;
      } else if (Array.isArray(payload.reference_list)) {
        payload.references = payload.reference_list;
      }
      delete payload.refs;
      delete payload.reference_list;
    }

    if (Array.isArray(payload.references)) {
      payload.references = payload.references.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const normalized = { ...item };
        if (!Object.prototype.hasOwnProperty.call(normalized, 'name')) {
          if (Object.prototype.hasOwnProperty.call(normalized, 'ref_name')) {
            normalized.name = normalized.ref_name;
          } else if (Object.prototype.hasOwnProperty.call(normalized, 'reference_name')) {
            normalized.name = normalized.reference_name;
          }
        }
        if (!Object.prototype.hasOwnProperty.call(normalized, 'content')) {
          if (Object.prototype.hasOwnProperty.call(normalized, 'text')) {
            normalized.content = normalized.text;
          } else if (Object.prototype.hasOwnProperty.call(normalized, 'value')) {
            normalized.content = normalized.value;
          }
        }
        delete normalized.ref_name;
        delete normalized.reference_name;
        delete normalized.text;
        delete normalized.value;
        return normalized;
      });
    }
  }

  return payload;
}

function formatToolWarnings(warnings) {
  if (!Array.isArray(warnings)) return [];
  return warnings
    .map((item) => item?.message || item?.code)
    .filter(Boolean);
}

function trimTraceText(text, maxLength = 1200) {
  const normalized = normalizeThinkingText(text);
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function splitThinkTaggedContent(content) {
  const raw = String(content || '');
  if (!raw) {
    return { visibleText: '', thinkingText: '' };
  }

  const lower = raw.toLowerCase();
  const visibleParts = [];
  const thinkingParts = [];
  let cursor = 0;

  while (cursor < raw.length) {
    const open = lower.indexOf('<think>', cursor);
    if (open === -1) {
      visibleParts.push(raw.slice(cursor));
      break;
    }

    visibleParts.push(raw.slice(cursor, open));
    const thinkStart = open + 7;
    const close = lower.indexOf('</think>', thinkStart);
    if (close === -1) {
      thinkingParts.push(raw.slice(thinkStart));
      cursor = raw.length;
      break;
    }

    thinkingParts.push(raw.slice(thinkStart, close));
    cursor = close + 8;
  }

  const visibleText = visibleParts.join('').replace(/<\/?think>/gi, '');
  const thinkingText = thinkingParts.join('\n');
  return {
    visibleText,
    thinkingText,
  };
}

function normalizeThinkingText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mergeThinkingParts(parts) {
  if (!Array.isArray(parts)) return '';
  return normalizeThinkingText(
    parts
      .map((part) => normalizeThinkingText(part))
      .filter(Boolean)
      .join('\n\n'),
  );
}

function createThinkingTrace(content) {
  const text = trimTraceText(content, 1200);
  if (!text) return null;
  return {
    kind: 'thinking',
    text,
  };
}

function createToolTrace({ toolName, toolCallId, parsedArgs, toolResult, durationMs }) {
  const warnings = formatToolWarnings(toolResult?.warnings).slice(0, 5);
  const firstBatchPath = Array.isArray(toolResult?.diff_summaries)
    ? toolResult.diff_summaries[0]?.path
    : null;
  const path = parsedArgs?.path || parsedArgs?.from_path || toolResult?.diff_summary?.path || firstBatchPath || null;
  return {
    kind: 'tool',
    toolName: String(toolName || '').trim() || 'unknown_tool',
    toolCallId: toolCallId || null,
    status: toolResult?.status === 'ok' ? 'ok' : 'error',
    errorCode: toolResult?.error_code || null,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    path: path ? String(path) : null,
    warnings,
  };
}

function clearStreamingBuffers(agent) {
  if (!agent?.chat) return;
  agent.chat.streamingText = '';
  agent.chat.streamingThinking = '';
}

function pushTraceItem(trace, item, maxItems = 60) {
  if (!item) return;
  trace.push(item);
  if (trace.length > maxItems) {
    trace.splice(0, trace.length - maxItems);
  }
}

function buildSummaryFromDiffs(diffSummaries) {
  if (!Array.isArray(diffSummaries) || diffSummaries.length === 0) {
    return '未检测到变更';
  }
  if (diffSummaries.length === 1) {
    const summary = diffSummaries[0] || {};
    const path = summary.path || '';
    switch (summary.change_type) {
      case 'add':
        return `追加 ${path}`;
      case 'remove':
        return `删除 ${path}`;
      case 'move':
        return `移动 ${path}`;
      default:
        return `修改 ${path}`;
    }
  }
  return `修改 ${diffSummaries.length} 项内容`;
}

function collectToolDiffSummaries(toolResult) {
  if (!toolResult || typeof toolResult !== 'object') return [];
  if (Array.isArray(toolResult.diff_summaries) && toolResult.diff_summaries.length > 0) {
    return toolResult.diff_summaries;
  }
  if (toolResult.diff_summary && typeof toolResult.diff_summary === 'object') {
    return [toolResult.diff_summary];
  }
  return [];
}

function normalizeValueForStableStringify(value, seen) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValueForStableStringify(item, seen));
  }
  return Object.keys(value)
    .sort()
    .reduce((acc, entryKey) => {
      acc[entryKey] = normalizeValueForStableStringify(value[entryKey], seen);
      return acc;
    }, {});
}

function stableSerialize(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  try {
    return JSON.stringify(normalizeValueForStableStringify(value, new WeakSet()));
  } catch {
    return String(value);
  }
}

function isArrayReorder(beforeValue, afterValue) {
  if (!Array.isArray(beforeValue) || !Array.isArray(afterValue)) return false;
  if (beforeValue.length !== afterValue.length) return false;
  const sameOrder = beforeValue.every((item, index) => stableSerialize(item) === stableSerialize(afterValue[index]));
  if (sameOrder) return false;
  const countMap = new Map();
  for (const item of beforeValue) {
    const itemKey = stableSerialize(item);
    countMap.set(itemKey, (countMap.get(itemKey) || 0) + 1);
  }
  for (const item of afterValue) {
    const itemKey = stableSerialize(item);
    if (!countMap.has(itemKey)) return false;
    const nextCount = countMap.get(itemKey) - 1;
    if (nextCount < 0) return false;
    if (nextCount === 0) {
      countMap.delete(itemKey);
    } else {
      countMap.set(itemKey, nextCount);
    }
  }
  return countMap.size === 0;
}

function buildToolDiffs(beforeCard, afterCard, diffSummaries) {
  if (!Array.isArray(diffSummaries)) return [];
  return diffSummaries.map((summary, index) => {
    const resource = summary?.resource || 'card_field';
    const path = summary?.path || '';
    const changeType = summary?.change_type || 'update';
    const hasBeforeValue = Object.prototype.hasOwnProperty.call(summary || {}, 'before_value');
    const hasAfterValue = Object.prototype.hasOwnProperty.call(summary || {}, 'after_value');
    const before = resource === 'skill_file'
      ? (changeType === 'add' ? null : (summary?.before_value ?? null))
      : (hasBeforeValue ? summary?.before_value : (changeType === 'add' ? null : getByPath(beforeCard, path)));
    const after = resource === 'skill_file'
      ? (changeType === 'remove' ? null : (summary?.after_value ?? null))
      : (hasAfterValue ? summary?.after_value : (changeType === 'remove' ? null : getByPath(afterCard, path)));
    const op = changeType === 'update' && resource === 'card_field' && isArrayReorder(before, after)
      ? 'move'
      : changeType;
    return {
      id: `tool_${index + 1}`,
      op,
      path,
      resource,
      before,
      after,
    };
  });
}

function getWriteBytes(summary) {
  if (!summary) return 0;
  if (summary.change_type === 'noop') return 0;
  if (summary.change_type === 'remove') {
    return Number.isFinite(summary.before_bytes) ? summary.before_bytes : 0;
  }
  return Number.isFinite(summary.after_bytes) ? summary.after_bytes : 0;
}

function resolveCardId(agent, cardStore) {
  if (cardStore?.cardId) {
    if (agent?.runtime) agent.runtime.cardId = cardStore.cardId;
    return cardStore.cardId;
  }
  if (agent?.runtime?.cardId) return agent.runtime.cardId;
  const source = cardStore?.sourceFile;
  if (source?.name) {
    const stamp = [source.name, source.size, source.lastModified].filter(Boolean).join('_');
    const id = `file_${stamp}`;
    if (agent?.runtime) agent.runtime.cardId = id;
    return id;
  }
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  if (agent?.runtime) agent.runtime.cardId = id;
  return id;
}

async function runToolFlow({ agent, cardStore, suppliers, toast, instruction, runId, resumeSession = null }) {
  const includeSkillTools = agent?.skills?.enabled !== false && Alpine.store('settings')?.skillsEnabled !== false;
  const toolDefinitions = getToolDefinitions({ includeSkillTools });
  const toolChoice = 'auto';
  const cardId = resolveCardId(agent, cardStore);
  const context = { card_id: cardId, registry_version: REGISTRY_VERSION };
  const previousSnapshot = agent.runtime?.toolSnapshot || null;
  const previousHash = agent.runtime?.toolSnapshotHash || null;

  let toolMessages = resumeSession?.toolMessages || null;
  let workingCard = resumeSession?.workingCard || null;
  let workingSkillRepository = resumeSession?.workingSkillRepository || null;
  const diffSummaries = Array.isArray(resumeSession?.diffSummaries) ? [...resumeSession.diffSummaries] : [];
  const toolWarnings = Array.isArray(resumeSession?.toolWarnings) ? [...resumeSession.toolWarnings] : [];
  const activityTrace = Array.isArray(resumeSession?.activityTrace) ? [...resumeSession.activityTrace] : [];
  const truncatedPaths = new Set(resumeSession?.truncatedPaths || []);
  const controller = new AbortController();
  agent.runtime.abortController = controller;

  try {
    let sinceHashUsed = null;
    if (!toolMessages) {
      let payload;
      try {
        payload = await buildDelta({
          card: cardStore.data,
          context,
          paths: DEFAULT_SNAPSHOT_PATHS,
          sinceHash: previousHash,
          previousSnapshot,
        });
      } catch (error) {
        toast?.error?.(error?.message || '构建上下文失败');
        agent.runtime.status = 'error';
        setRuntimeError(agent, error?.message || '构建上下文失败');
        return { handled: true };
      }

      if (payload?.snapshot || payload?.snapshot_fallback) {
        agent.runtime.toolSnapshot = payload;
        agent.runtime.toolSnapshotHash = payload.snapshot_hash || null;
      }

      const skillRuntimeContext = await resolveSkillRuntimeContext(agent, instruction);
      toolMessages = buildToolMessages(
        agent.chat.messages,
        instruction,
        payload,
        skillRuntimeContext,
        { includeSkillTools },
      );
      sinceHashUsed = payload?.since_hash_used || null;
      if (payload?.snapshot_fallback) {
        toolWarnings.push('上下文快照回退 (W_SNAPSHOT_FALLBACK)');
      }
      workingCard = deepClone(cardStore.data);
      try {
        workingSkillRepository = await exportSkillRepositoryState();
      } catch (error) {
        toast?.error?.(error?.message || '读取技能仓快照失败');
        agent.runtime.status = 'error';
        setRuntimeError(agent, error?.message || '读取技能仓快照失败');
        return { handled: true };
      }
    } else {
      const message = String(instruction || '').trim() || '继续';
      toolMessages.push({ role: 'user', content: message });
      workingCard = workingCard || deepClone(cardStore.data);
      if (!workingSkillRepository) {
        try {
          workingSkillRepository = await exportSkillRepositoryState();
        } catch (error) {
          toast?.error?.(error?.message || '读取技能仓快照失败');
          agent.runtime.status = 'error';
          setRuntimeError(agent, error?.message || '读取技能仓快照失败');
          return { handled: true };
        }
      }
    }

    let toolCallsUsed = 0;
    let totalWriteBytes = 0;
    let consecutiveToolErrors = 0;
    const hasToolHistory = Array.isArray(toolMessages)
      && toolMessages.some((item) => item?.role === 'tool');
    if (hasToolHistory) {
      setToolSupportState(suppliers, true);
    }
    while (toolCallsUsed < getToolCallLimit()) {
      let completion;
      let streamedText = '';
      let streamedRawText = '';
      let streamedReasoning = '';
      const refreshStreamingPreview = () => {
        const split = splitThinkTaggedContent(streamedRawText);
        streamedText = split.visibleText;
        const mergedThinking = mergeThinkingParts([split.thinkingText, split.visibleText, streamedReasoning]);
        agent.chat.streamingText = STREAMING_PLACEHOLDER_TEXT;
        agent.chat.streamingThinking = mergedThinking;
      };
      try {
        completion = await requestToolRoundCompletion({
          toolMessages,
          suppliers,
          toolDefinitions,
          toolChoice,
          signal: controller.signal,
          onDelta: (delta) => {
            if (typeof delta !== 'string' || !delta) return;
            streamedRawText += delta;
            refreshStreamingPreview();
          },
          onThinkingDelta: (delta) => {
            if (typeof delta !== 'string' || !delta) return;
            streamedReasoning += delta;
            refreshStreamingPreview();
          },
        });
      } catch (error) {
        if (agent.runtime.runId !== runId) return { handled: true };
        if (isAbortError(error)) {
          const message = resolveRuntimeErrorMessage(error, '已停止生成');
          toast?.info?.(message);
          agent.runtime.status = 'idle';
          clearStreamingBuffers(agent);
          return { handled: true };
        }
        const message = resolveRuntimeErrorMessage(error, 'AI 请求失败');
        if (isToolUnsupportedError(error)) {
          return {
            handled: false,
            fallbackReason: 'tool_not_supported',
            fallbackMessage: message,
          };
        }
        return {
          handled: false,
          fallbackReason: 'tool_use_failed',
          fallbackMessage: message,
        };
      }

      if (agent.runtime.runId !== runId) return { handled: true };

      const message = extractCompletionMessage(completion);
      if (!message) {
        return { handled: false };
      }

      const splitMessage = splitThinkTaggedContent(message.content || '');
      const assistantText = String(splitMessage.visibleText || '').trim();
      const baseThinking = mergeThinkingParts([
        splitMessage.thinkingText,
        message?.reasoning_content,
        streamedReasoning,
      ]);

      const toolCalls = normalizeToolCalls(message, runId, toolCallsUsed);
      if (toolCalls.length === 0) {
        pushTraceItem(activityTrace, createThinkingTrace(baseThinking));
        return {
          handled: true,
          summary: assistantText || buildSummaryFromDiffs(diffSummaries),
          warnings: toolWarnings,
          activityTrace,
          workingCard,
          workingSkillRepository,
          diffSummaries,
        };
      }

      const toolRoundThinking = mergeThinkingParts([baseThinking, splitMessage.visibleText]);
      pushTraceItem(activityTrace, createThinkingTrace(toolRoundThinking));

      if (!streamedText) {
        agent.chat.streamingText = '正在调用工具…';
      }

      setToolSupportState(suppliers, true);

      toolMessages.push({
        role: 'assistant',
        content: assistantText,
        tool_calls: toolCalls,
      });

      let shouldRetry = false;
      for (const call of toolCalls) {
        if (toolCallsUsed >= getToolCallLimit()) {
          toolWarnings.push('工具调用次数达到上限 (W_TOOL_CALL_LIMIT_REACHED)');
          agent.runtime.toolSession = {
            toolMessages,
            workingCard,
            workingSkillRepository,
            diffSummaries,
            toolWarnings,
            activityTrace,
            truncatedPaths: Array.from(truncatedPaths),
          };
          return {
            handled: true,
            summary: '工具调用次数达到上限，请回复“继续”继续执行',
            warnings: toolWarnings,
            activityTrace,
            workingCard,
            workingSkillRepository,
            diffSummaries,
            pending: true,
          };
        }

        toolCallsUsed += 1;
        const toolCallId = call.id || `tool_${runId}_${toolCallsUsed}`;
        const toolName = call.function?.name || call.name || '';
        const rawArgs = call.function?.arguments || call.arguments || '';
        let parsedArgs = null;
        let toolResult;
        const startAt = Date.now();

        const displayToolName = String(toolName || '').trim() || 'unknown_tool';
        if (!streamedText) {
          agent.chat.streamingText = `正在调用工具：${displayToolName}`;
        }

        if (rawArgs && typeof rawArgs === 'string') {
          try {
            parsedArgs = JSON.parse(rawArgs);
          } catch {
            toolResult = buildToolParseError({
              context,
              toolCallId,
              message: '工具参数解析失败',
            });
          }
        } else if (rawArgs && typeof rawArgs === 'object') {
          parsedArgs = rawArgs;
        } else {
          parsedArgs = {};
        }

        if (!toolName) {
          toolResult = buildToolParseError({
            context,
            toolCallId,
            message: '缺少工具名称',
          });
        }

        if (!toolResult) {
          parsedArgs = normalizeToolArgs(toolName, parsedArgs || {});
          if (
            toolName === 'edit_field' &&
            Object.prototype.hasOwnProperty.call(parsedArgs || {}, 'old_value') &&
            !parsedArgs?.old_hash
          ) {
            const path = typeof parsedArgs?.path === 'string' ? parsedArgs.path.trim() : '';
            if (path && truncatedPaths.has(path)) {
              toolResult = buildToolError({
                context,
                toolCallId,
                code: 'E_PRECONDITION_FAILED',
                message: '截断读取后必须提供 old_hash',
              });
            }
          }
        }

        if (!toolResult) {
          toolResult = await executeToolCall({
            toolName,
            args: parsedArgs || {},
            card: workingCard,
            skillsRepository: workingSkillRepository,
            context,
            toolCallId,
          });
        }

        if (isOldHashError(toolResult) && !parsedArgs?._cas_recovered) {
          const viewPath = resolveCasViewPath(toolName, parsedArgs);
          if (viewPath) {
            const viewResult = await executeToolCall({
              toolName: 'view_field',
              args: { path: viewPath, max_chars: 0 },
              card: workingCard,
              skillsRepository: workingSkillRepository,
              context,
              toolCallId: `${toolCallId}_cas`,
            });
            const recoveredHash = resolveCasHashFromViewResult(toolName, viewResult);
            if (recoveredHash) {
              const nextArgs = { ...parsedArgs, old_hash: recoveredHash, _cas_recovered: true };
              if (toolName === 'edit_field' && Object.prototype.hasOwnProperty.call(nextArgs, 'old_value')) {
                delete nextArgs.old_value;
              }
              parsedArgs = nextArgs;
              toolResult = await executeToolCall({
                toolName,
                args: parsedArgs,
                card: workingCard,
                skillsRepository: workingSkillRepository,
                context,
                toolCallId,
              });
            }
          }
        }

        const resultDiffSummaries = collectToolDiffSummaries(toolResult);
        const primaryDiff = resultDiffSummaries[0] || null;

        await recordToolEvent({
          tool_name: toolName,
          path: parsedArgs?.path || parsedArgs?.from_path || primaryDiff?.path || null,
          canonical_path: primaryDiff?.canonical_path || toolResult?.canonical_path || null,
          ref_id: parsedArgs?.ref_id || null,
          query: parsedArgs?.query || null,
          status: toolResult?.status || 'error',
          error_code: toolResult?.error_code || null,
          warnings: Array.isArray(toolResult?.warnings)
            ? toolResult.warnings.map((warn) => warn?.code).filter(Boolean)
            : [],
          cas_used: Boolean(parsedArgs?.old_hash),
          since_hash_used: Boolean(sinceHashUsed),
          truncated: Boolean(toolResult?.truncated),
          registry_version: context?.registry_version || null,
          card_id: context?.card_id || null,
          request_id: runId,
          session_id: agent.runtime?.cardId || null,
          agent_id: suppliers?.model || null,
          tool_call_id: toolCallId,
          duration_ms: Date.now() - startAt,
          args: parsedArgs || {},
          result: toolResult,
        });

        pushTraceItem(activityTrace, createToolTrace({
          toolName,
          toolCallId,
          parsedArgs,
          toolResult,
          durationMs: Date.now() - startAt,
        }));

        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: JSON.stringify(toolResult),
        });

        toolWarnings.push(...formatToolWarnings(toolResult?.warnings));

        if (toolResult?.status !== 'ok') {
          consecutiveToolErrors += 1;
          if (consecutiveToolErrors >= TOOL_CONSECUTIVE_ERROR_LIMIT) {
            toolWarnings.push('工具调用连续失败 (W_TOOL_ERROR_LIMIT)');
            agent.runtime.toolSession = {
              toolMessages,
              workingCard,
              workingSkillRepository,
              diffSummaries,
              toolWarnings,
              activityTrace,
              truncatedPaths: Array.from(truncatedPaths),
            };
            return {
              handled: true,
              summary: '工具调用连续失败，已暂停。请调整指令后重试。',
              warnings: toolWarnings,
              activityTrace,
              workingCard,
              workingSkillRepository,
              diffSummaries,
              pending: true,
            };
          }
          shouldRetry = true;
          break;
        }

        consecutiveToolErrors = 0;

        if (toolName === 'view_field' && toolResult?.truncated) {
          const rawPath = typeof parsedArgs?.path === 'string' ? parsedArgs.path.trim() : '';
          const canonicalPath = toolResult?.canonical_path || '';
          if (rawPath) truncatedPaths.add(rawPath);
          if (canonicalPath) truncatedPaths.add(canonicalPath);
        }

        if (resultDiffSummaries.length > 0) {
          let writeLimitReached = false;
          for (const summary of resultDiffSummaries) {
            const writeBytes = getWriteBytes(summary);
            const nextTotal = totalWriteBytes + writeBytes;
            if (writeBytes > 0 && nextTotal > TOOL_WRITE_LIMIT) {
              const sizeError = buildToolError({
                context,
                toolCallId,
                code: 'E_SIZE_LIMIT',
                message: '单轮写入超过上限',
                warnings: [{
                  code: 'W_SIZE_NEAR_LIMIT',
                  message: '写入超过单轮上限',
                  severity: 'warn',
                }],
              });
              toolMessages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: JSON.stringify(sizeError),
              });
              toolWarnings.push('写入超过单轮上限');
              consecutiveToolErrors += 1;
              if (consecutiveToolErrors >= TOOL_CONSECUTIVE_ERROR_LIMIT) {
                agent.runtime.toolSession = {
                  toolMessages,
                  workingCard,
                  workingSkillRepository,
                  diffSummaries,
                  toolWarnings,
                  activityTrace,
                  truncatedPaths: Array.from(truncatedPaths),
                };
                return {
                  handled: true,
                  summary: '写入超过单轮上限，已暂停。请调整指令后重试。',
                  warnings: toolWarnings,
                  activityTrace,
                  workingCard,
                  workingSkillRepository,
                  diffSummaries,
                  pending: true,
                };
              }
              writeLimitReached = true;
              break;
            }
            totalWriteBytes = nextTotal;
            if (totalWriteBytes > TOOL_WRITE_LIMIT * TOOL_WRITE_WARNING_RATIO) {
              toolWarnings.push('写入接近上限 (W_SIZE_NEAR_LIMIT)');
            }
            diffSummaries.push(summary);
          }

          if (writeLimitReached) {
            shouldRetry = true;
            break;
          }
        }

        if (toolResult?.new_card) {
          workingCard = toolResult.new_card;
        }
        if (toolResult?.new_skill_repository) {
          workingSkillRepository = toolResult.new_skill_repository;
        }
      }

      if (shouldRetry) {
        continue;
      }
    }

    toolWarnings.push('工具调用次数达到上限 (W_TOOL_CALL_LIMIT_REACHED)');
    agent.runtime.toolSession = {
      toolMessages,
      workingCard,
      workingSkillRepository,
      diffSummaries,
      toolWarnings,
      activityTrace,
      truncatedPaths: Array.from(truncatedPaths),
    };
    return {
      handled: true,
      summary: '工具调用次数达到上限，请回复“继续”继续执行',
      warnings: toolWarnings,
      activityTrace,
      workingCard,
      workingSkillRepository,
      diffSummaries,
      pending: true,
    };
  } finally {
    if (agent.runtime.abortController === controller) {
      agent.runtime.abortController = null;
    }
  }
}

async function validateWithBackend(cardSnapshot) {
  try {
    const resp = await validateCard(cardSnapshot);
    const result = resp?.data || resp;
    if (result?.valid === false) {
      return { valid: false, errors: result?.errors || ['卡片校验失败'] };
    }
    return { valid: true };
  } catch (error) {
    const detail = error?.getUserMessage?.() || error?.message || '请求失败';
    return {
      valid: true,
      fallback: true,
      warning: `后端校验不可用，已跳过本次校验（${detail}）`,
    };
  }
}

function clearStaging(agent) {
  agent.stagingSummary = '';
  agent.stagingWarnings = [];
  agent.stagingDiffs = [];
  agent.stagingCard = null;
  agent.stagingAt = null;
}

function clearRuntimeError(agent) {
  agent.runtime.error = null;
}

function ensureAppliedEntries(agent) {
  if (!Array.isArray(agent.appliedEntries)) {
    agent.appliedEntries = [];
  }
  return agent.appliedEntries;
}

function getLatestAppliedEntry(agent) {
  const entries = ensureAppliedEntries(agent);
  return entries.length ? entries[entries.length - 1] : null;
}

function findAppliedEntry(agent, entryId) {
  if (!entryId) return null;
  const entries = ensureAppliedEntries(agent);
  return entries.find((entry) => entry.id === entryId) || null;
}

function syncLastApplied(agent) {
  const latest = getLatestAppliedEntry(agent);
  agent.lastApplied = latest
    ? {
      summary: latest.summary,
      warnings: latest.warnings,
      diffs: latest.diffs,
      ts: latest.appliedAt,
      entryId: latest.id,
      userMessageId: latest.userMessageId,
      assistantMessageId: latest.assistantMessageId,
    }
    : null;

  if (!agent.ui) return;
  if (!latest) {
    agent.ui.diffEntryId = null;
    agent.ui.diffPanelOpen = false;
    return;
  }
  const focusId = agent.ui.diffEntryId;
  if (!focusId || !findAppliedEntry(agent, focusId)) {
    agent.ui.diffEntryId = latest.id;
  }
}

function updateMessageContentById(agent, messageId, content, extra = {}) {
  if (!messageId || !Array.isArray(agent?.chat?.messages)) return false;
  const index = agent.chat.messages.findIndex((item) => item?.id === messageId);
  if (index === -1) return false;
  agent.chat.messages[index] = {
    ...agent.chat.messages[index],
    content,
    ...extra,
  };
  return true;
}

function getDiffKey(diff) {
  if (!diff || typeof diff !== 'object') return '';
  if (diff.id) return String(diff.id);
  const op = String(diff.op || 'update');
  const path = String(diff.path || '');
  return `${op}:${path}`;
}

function normalizePathForLookup(path) {
  const normalized = String(path || '').trim().replace(/\[(\d+)\]/g, '.$1');
  if (!normalized) return '';
  return normalized.replace(/\.{2,}/g, '.').replace(/^\./, '').replace(/\.$/, '');
}

function getArrayParentPath(path) {
  const normalizedPath = normalizePathForLookup(path);
  if (!normalizedPath) return '';
  const segments = normalizedPath.split('.').filter(Boolean);
  let lastArrayIndex = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (/^\d+$/.test(segments[i])) {
      lastArrayIndex = i;
    }
  }
  if (lastArrayIndex <= 0) return '';
  return segments.slice(0, lastArrayIndex).join('.');
}

function buildSummaryFromEntryDiffs(diffs) {
  const items = Array.isArray(diffs) ? diffs : [];
  if (!items.length) return '该次修改已全部不采纳';
  if (items.length === 1) {
    const diff = items[0] || {};
    const path = String(diff.path || '').trim();
    const op = String(diff.op || 'set').toLowerCase();
    if (op === 'add' || op === 'append') {
      return `追加 ${path}`;
    }
    if (op === 'remove') {
      return `删除 ${path}`;
    }
    if (op === 'move') {
      return `移动 ${path}`;
    }
    return `修改 ${path}`;
  }
  return `修改 ${items.length} 项内容`;
}

function removeMessageById(agent, messageId) {
  if (!messageId || !Array.isArray(agent?.chat?.messages)) return false;
  const idx = agent.chat.messages.findIndex((msg) => msg?.id === messageId);
  if (idx === -1) return false;
  agent.chat.messages.splice(idx, 1);
  return true;
}

function trimMessagesFrom(agent, messageId) {
  if (!messageId || !Array.isArray(agent?.chat?.messages)) return false;
  const idx = agent.chat.messages.findIndex((msg) => msg?.id === messageId);
  if (idx === -1) return false;
  agent.chat.messages.splice(idx);
  return true;
}

function trimMessagesAfter(agent, messageId) {
  if (!messageId || !Array.isArray(agent?.chat?.messages)) return false;
  const idx = agent.chat.messages.findIndex((msg) => msg?.id === messageId);
  if (idx === -1) return false;
  agent.chat.messages.splice(idx + 1);
  return true;
}

function applyCardState(cardStore, state) {
  if (!cardStore || !state) return;
  cardStore.data = deepClone(state);
  cardStore.checkChanges();
}

function rollbackLatestApplied(agent, { removeSummaryMessage = true } = {}) {
  const entries = ensureAppliedEntries(agent);
  if (!entries.length) return null;
  const latest = entries[entries.length - 1];
  const cardStore = getCardStore();
  const history = Alpine.store('history');
  let restored = null;
  if (history?.canUndo) {
    restored = history.undo();
  }
  if (latest.beforeSkillRepository) {
    try {
      importSkillRepositoryState(latest.beforeSkillRepository);
    } catch (error) {
      console.warn('[agent_runtime] Failed to rollback skill repository:', error);
    }
  }
  applyCardState(cardStore, restored || latest.beforeCard);
  entries.pop();
  if (removeSummaryMessage) {
    removeMessageById(agent, latest.assistantMessageId);
  }

  if (!entries.length && latest.userMessageId) {
    trimMessagesAfter(agent, latest.userMessageId);
  }

  syncLastApplied(agent);
  if (agent.ui) {
    agent.ui.showLastApplied = Boolean(agent.lastApplied);
  }
  return latest;
}

function rollbackFromEntry(agent, entryId, { trimFromUserMessage = false } = {}) {
  const entries = ensureAppliedEntries(agent);
  const targetIndex = entries.findIndex((entry) => entry.id === entryId);
  if (targetIndex === -1) return null;

  const rollbackEntries = entries.slice(targetIndex);
  const history = Alpine.store('history');
  rollbackEntries.forEach(() => {
    if (history?.canUndo) history.undo();
  });

  const target = entries[targetIndex];
  const cardStore = getCardStore();
  if (target.beforeSkillRepository) {
    try {
      importSkillRepositoryState(target.beforeSkillRepository);
    } catch (error) {
      console.warn('[agent_runtime] Failed to rollback skill repository:', error);
    }
  }
  applyCardState(cardStore, target.beforeCard);

  rollbackEntries.forEach((entry) => {
    removeMessageById(agent, entry.assistantMessageId);
  });

  if (trimFromUserMessage) {
    trimMessagesFrom(agent, target.userMessageId);
  }

  entries.splice(targetIndex);
  syncLastApplied(agent);
  if (agent.ui) {
    agent.ui.showLastApplied = Boolean(agent.lastApplied);
  }
  return target;
}

function discardLastApplied(agent, { removeSummaryMessage = false } = {}) {
  const undone = rollbackLatestApplied(agent, { removeSummaryMessage });
  if (agent.ui) {
    agent.ui.showLastApplied = Boolean(agent.lastApplied);
    if (!undone && !agent.lastApplied) {
      agent.ui.showLastApplied = false;
    }
  }
}

function setRuntimeError(agent, message) {
  agent.runtime.error = message;
}

function isAbortError(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return true;
  const message = String(error?.message || error);
  return /abort|aborted|signal is aborted/i.test(message);
}

function resolveRuntimeErrorMessage(error, fallback) {
  if (isAbortError(error)) return '已停止生成';
  return error?.message || fallback;
}

function normalizeUserFacingError(message) {
  const text = String(message || '').trim();
  if (!text) return '操作失败';
  if (text.includes('old_hash') || text.includes('old_value')) {
    return '数据已变更导致本次修改失效，请重试';
  }
  if (text.includes('remove_entry 需要数组项路径')) {
    return '删除失败：请指定数组项路径（包含 [index]）';
  }
  return text;
}

function isOldHashError(toolResult) {
  if (!toolResult || toolResult.status === 'ok') return false;
  if (!CAS_RECOVERABLE_ERRORS.has(toolResult.error_code)) return false;
  return true;
}

function resolveCasViewPath(toolName, args) {
  if (!CAS_RECOVERABLE_TOOLS.has(toolName)) return null;
  if (toolName === 'move_entry') return typeof args?.from_path === 'string' ? args.from_path.trim() : '';
  return typeof args?.path === 'string' ? args.path.trim() : '';
}

function resolveCasHashFromViewResult(toolName, viewResult) {
  if (!viewResult || viewResult.status !== 'ok') return null;
  if (toolName === 'remove_entry' || toolName === 'move_entry') {
    return viewResult.array_hash || viewResult.current_hash || null;
  }
  return viewResult.current_hash || null;
}

function appendMessage(agent, role, content, meta = {}) {
  const message = {
    id: nextMessageId(),
    role,
    content,
    ts: Date.now(),
    ...meta,
  };
  agent.chat.messages.push(message);
  return message;
}

function removeLastAssistantMessage(agent, matchText = null) {
  if (!agent?.chat?.messages?.length) return false;
  for (let i = agent.chat.messages.length - 1; i >= 0; i -= 1) {
    const msg = agent.chat.messages[i];
    if (msg?.role !== 'assistant') continue;
    if (matchText && msg.content !== matchText) continue;
    agent.chat.messages.splice(i, 1);
    return true;
  }
  return false;
}

function getLastUserMessageId(agent) {
  if (!Array.isArray(agent?.chat?.messages)) return null;
  for (let i = agent.chat.messages.length - 1; i >= 0; i -= 1) {
    const msg = agent.chat.messages[i];
    if (msg?.role === 'user') return msg.id || null;
  }
  return null;
}

function stopStreaming(agent) {
  if (agent.runtime.abortController) {
    try {
      agent.runtime.abortController.abort();
    } catch {
      // ignore
    }
  }
  agent.runtime.abortController = null;
}

export function getAgentRuntime() {
  if (runtimeInstance) return runtimeInstance;

  runtimeInstance = {
    async sendMessage(rawText, options = {}) {
      const agent = getAgentStore();
      const cardStore = getCardStore();
      const suppliers = getSuppliersStore();
      const toast = getToastStore();

      const text = String(rawText || agent.chat.input || '').trim();
      if (!text) return;

      const { skipUserMessage = false, sourceUserMessageId = null } = options || {};

      agent.runtime.lastUserInput = text;
      const resumeSession = agent.runtime.toolSession;
      const shouldResume = Boolean(resumeSession);
      if (!shouldResume && agent.runtime.toolSession) {
        agent.runtime.toolSession = null;
      }

      if (!cardStore?.data) {
        toast?.error?.('请先加载角色卡');
        return;
      }

      const baseUrl = normalizeSupplierUrl(suppliers?.baseUrl || '');
      const apiKey = typeof suppliers?.apiKey === 'string' ? suppliers.apiKey.trim() : '';
      const model = typeof suppliers?.model === 'string' ? suppliers.model.trim() : '';
      const supplierConfig = {
        ...suppliers,
        baseUrl,
        apiKey,
        model,
      };

      if (!baseUrl || !apiKey || !model) {
        toast?.error?.('请先在设置中配置 AI 供应商');
        return;
      }

      if (agent.runtime.stagingTimer) {
        clearTimeout(agent.runtime.stagingTimer);
        agent.runtime.stagingTimer = null;
      }

      stopStreaming(agent);
      clearRuntimeError(agent);
      clearStaging(agent);

      const runId = nextRunId();
      agent.runtime.runId = runId;
      agent.runtime.status = 'streaming';
      agent.chat.input = '';
      clearStreamingBuffers(agent);
      agent.chat.streamingText = STREAMING_PLACEHOLDER_TEXT;

      let linkedUserMessageId = sourceUserMessageId || null;
      if (!skipUserMessage) {
        const userMessage = appendMessage(agent, 'user', text, { kind: 'user_input' });
        linkedUserMessageId = userMessage.id;
      } else if (!linkedUserMessageId) {
        linkedUserMessageId = getLastUserMessageId(agent);
      }

      const handleFailure = (message, { toast: showToast = true } = {}) => {
        const safeMessage = normalizeUserFacingError(message);
        agent.runtime.status = 'idle';
        agent.runtime.toolSession = null;
        clearStreamingBuffers(agent);
        setRuntimeError(agent, safeMessage);
        if (showToast) {
          toast?.error?.(safeMessage);
        }
        appendMessage(agent, 'assistant', safeMessage);
      };

      const toolResult = await runToolFlow({
        agent,
        cardStore,
        suppliers: supplierConfig,
        toast,
        instruction: text,
        runId,
        resumeSession: shouldResume ? resumeSession : null,
      });

      if (!toolResult?.handled) {
        handleFailure(toolResult?.fallbackMessage || '供应商未返回工具调用');
        return;
      }

      if (toolResult?.error) {
        handleFailure(toolResult.error);
        return;
      }
      if (!toolResult?.workingCard) {
        if (agent.runtime.error) {
          handleFailure(agent.runtime.error, { toast: false });
        }
        clearStreamingBuffers(agent);
        return;
      }

      const backendValidation = await validateWithBackend(toolResult.workingCard);
      if (!backendValidation.valid) {
        const message = backendValidation.errors?.join('；') || '卡片校验失败';
        agent.runtime.status = 'error';
        clearStreamingBuffers(agent);
        setRuntimeError(agent, message);
        toast?.error?.(message);
        return;
      }
      if (backendValidation.fallback && backendValidation.warning) {
        toast?.info?.(backendValidation.warning);
      }

      const diffs = buildToolDiffs(cardStore.data, toolResult.workingCard, toolResult.diffSummaries);
      const warnings = [
        ...(toolResult.warnings || []),
        ...detectContentWarnings(cardStore.data, toolResult.workingCard),
      ];
      if (backendValidation.fallback && backendValidation.warning) {
        warnings.push({
          code: 'W_VALIDATION_FALLBACK',
          message: backendValidation.warning,
          severity: 'warn',
        });
      }

      const summary = toolResult.summary || buildSummaryFromDiffs(toolResult.diffSummaries);
      const entryId = nextAppliedId();
      clearStreamingBuffers(agent);
      const summaryMessage = appendMessage(agent, 'assistant', summary, {
        kind: 'diff_summary',
        entryId,
        userMessageId: linkedUserMessageId,
        activityTrace: Array.isArray(toolResult.activityTrace) ? toolResult.activityTrace : [],
      });

      if (agent.runtime.runId !== runId) return;

      const beforeCard = deepClone(cardStore.data);
      let beforeSkillRepository = null;
      try {
        beforeSkillRepository = await exportSkillRepositoryState();
      } catch (error) {
        console.warn('[agent_runtime] Failed to export skill repository snapshot:', error);
        beforeSkillRepository = null;
      }

      const afterSkillRepository = toolResult.workingSkillRepository
        ? deepClone(toolResult.workingSkillRepository)
        : beforeSkillRepository;

      if (afterSkillRepository) {
        try {
          importSkillRepositoryState(afterSkillRepository);
        } catch (error) {
          const message = normalizeUserFacingError(error?.message || '技能仓应用失败');
          agent.runtime.status = 'error';
          clearStreamingBuffers(agent);
          setRuntimeError(agent, message);
          toast?.error?.(message);
          return;
        }
      }

      const history = Alpine.store('history');
      history?.push?.(beforeCard);

      cardStore.data = toolResult.workingCard;
      cardStore.checkChanges();

      const entries = ensureAppliedEntries(agent);
      entries.push({
        id: entryId,
        summary,
        warnings,
        diffs,
        appliedAt: Date.now(),
        userMessageId: linkedUserMessageId,
        assistantMessageId: summaryMessage.id,
        instruction: text,
        beforeCard,
        afterCard: deepClone(toolResult.workingCard),
        beforeSkillRepository,
        afterSkillRepository,
      });

      syncLastApplied(agent);
      if (agent.ui) {
        agent.ui.showLastApplied = false;
        agent.ui.diffPanelOpen = false;
      }

      try {
        const nextSnapshot = await buildSnapshot({
          card: cardStore.data,
          context: { card_id: agent.runtime.cardId, registry_version: REGISTRY_VERSION },
          paths: DEFAULT_SNAPSHOT_PATHS,
        });
        agent.runtime.toolSnapshot = nextSnapshot;
        agent.runtime.toolSnapshotHash = nextSnapshot.snapshot_hash || null;
      } catch (error) {
        console.warn('[agent_runtime] Failed to refresh tool snapshot:', error);
      }

      clearStaging(agent);
      agent.runtime.status = 'idle';

      if (!toolResult?.pending) {
        agent.runtime.toolSession = null;
      }
    },

    stop() {
      const agent = getAgentStore();
      stopStreaming(agent);
      clearStreamingBuffers(agent);
      agent.runtime.status = 'idle';
    },

    retryLast() {
      const agent = getAgentStore();
      if (!agent.runtime.lastUserInput) return;
      if (agent.runtime.error) {
        removeLastAssistantMessage(agent, agent.runtime.error);
      }
      discardLastApplied(agent, { removeSummaryMessage: true });
      this.sendMessage(agent.runtime.lastUserInput, { skipUserMessage: true });
    },

    undoAppliedEntry(entryId, options = {}) {
      const agent = getAgentStore();
      const latest = getLatestAppliedEntry(agent);
      if (!latest || latest.id !== entryId) return false;
      const undone = rollbackLatestApplied(agent, {
        removeSummaryMessage: options.removeSummaryMessage !== false,
      });
      if (!undone) return false;
      if (agent.ui) {
        agent.ui.showLastApplied = Boolean(agent.lastApplied);
      }
      return true;
    },

    async rejectEntryDiff(entryId, diffKey) {
      const agent = getAgentStore();
      const cardStore = getCardStore();
      const entries = ensureAppliedEntries(agent);
      const targetIndex = entries.findIndex((entry) => entry?.id === entryId);
      if (targetIndex === -1) {
        return { ok: false, message: '变更记录不存在' };
      }

      if (targetIndex !== entries.length - 1) {
        return { ok: false, message: '仅支持对最新一条变更执行“不予采纳”' };
      }

      const entry = entries[targetIndex];
      const diffs = Array.isArray(entry?.diffs) ? entry.diffs : [];
      const targetKey = String(diffKey || '').trim();
      const diffIndex = diffs.findIndex((item) => getDiffKey(item) === targetKey);
      if (diffIndex === -1) {
        return { ok: false, message: '变更项不存在' };
      }

      const targetDiff = diffs[diffIndex] || null;
      if (!targetDiff || targetDiff.resource === 'skill_file') {
        return { ok: false, message: '该变更暂不支持“不予采纳”' };
      }

      if (!cardStore?.data || !entry?.beforeCard) {
        return { ok: false, message: '当前状态不可用，请重试' };
      }

      const normalizedPath = normalizePathForLookup(targetDiff.path || '');
      if (!normalizedPath) {
        return { ok: false, message: '变更路径无效，无法不予采纳' };
      }

      const beforeCard = entry.beforeCard;
      const afterCard = entry.afterCard || cardStore.data;
      const arrayParentPath = getArrayParentPath(targetDiff.path || '');
      const beforePathValue = getByPath(beforeCard, normalizedPath);
      const afterPathValue = getByPath(afterCard, normalizedPath);
      const arrayAnchorPath = arrayParentPath
        || (Array.isArray(beforePathValue) || Array.isArray(afterPathValue) ? normalizedPath : '');

      if (arrayAnchorPath) {
        const hasSiblingArrayDiff = diffs.some((item, index) => {
          if (index === diffIndex) return false;
          const itemPath = normalizePathForLookup(item?.path || '');
          if (!itemPath) return false;
          const itemParent = getArrayParentPath(item?.path || '');
          if (itemParent && itemParent === arrayAnchorPath) return true;
          if (itemPath === arrayAnchorPath) return true;
          return false;
        });
        if (hasSiblingArrayDiff) {
          return {
            ok: false,
            message: '同一数组存在多项联动变更，暂不支持逐项不予采纳，请改用“编辑字段”或“撤销”',
          };
        }
      }

      const restorePath = arrayAnchorPath || normalizedPath;
      const restoreValue = getByPath(beforeCard, restorePath);
      const nextCard = deepClone(cardStore.data);

      try {
        setByPath(nextCard, restorePath, deepClone(restoreValue));
      } catch (error) {
        return { ok: false, message: error?.message || '不予采纳失败' };
      }

      const history = Alpine.store('history');
      history?.push?.(deepClone(cardStore.data));
      applyCardState(cardStore, nextCard);

      const remainingDiffs = diffs.filter((_, index) => index !== diffIndex);
      entry.diffs = remainingDiffs;
      entry.summary = buildSummaryFromEntryDiffs(remainingDiffs);
      entry.afterCard = deepClone(nextCard);
      entry.appliedAt = Date.now();

      updateMessageContentById(agent, entry.assistantMessageId, entry.summary, {
        kind: 'diff_summary',
        entryId: entry.id,
        userMessageId: entry.userMessageId,
      });

      syncLastApplied(agent);
      if (agent.ui) {
        agent.ui.showLastApplied = Boolean(agent.lastApplied);
        if (!remainingDiffs.length) {
          agent.ui.diffPanelOpen = false;
        }
      }

      try {
        const nextSnapshot = await buildSnapshot({
          card: cardStore.data,
          context: { card_id: agent.runtime.cardId, registry_version: REGISTRY_VERSION },
          paths: DEFAULT_SNAPSHOT_PATHS,
        });
        agent.runtime.toolSnapshot = nextSnapshot;
        agent.runtime.toolSnapshotHash = nextSnapshot.snapshot_hash || null;
      } catch (error) {
        console.warn('[agent_runtime] Failed to refresh tool snapshot after diff rejection:', error);
      }

      return {
        ok: true,
        remainingCount: remainingDiffs.length,
      };
    },

    retryFromEntry(entryId, { messageText = '' } = {}) {
      const agent = getAgentStore();
      if (!entryId) return false;

      const entries = ensureAppliedEntries(agent);
      const targetIndex = entries.findIndex((entry) => entry.id === entryId);
      if (targetIndex === -1) return false;
      const retryWindowStart = Math.max(0, entries.length - 10);
      if (targetIndex < retryWindowStart) return false;

      stopStreaming(agent);
      clearRuntimeError(agent);
      clearStaging(agent);

      const target = rollbackFromEntry(agent, entryId, { trimFromUserMessage: true });
      if (!target) return false;

      const nextText = String(messageText || target.instruction || '').trim();
      if (!nextText) return false;

      agent.runtime.lastUserInput = nextText;
      this.sendMessage(nextText);
      return true;
    },

    discardLastApplied({ removeSummaryMessage = false } = {}) {
      const agent = getAgentStore();
      discardLastApplied(agent, { removeSummaryMessage });
    },

    reset() {
      const agent = getAgentStore();
      stopStreaming(agent);
      clearStaging(agent);
      agent.chat.messages = [];
      clearStreamingBuffers(agent);
      agent.chat.input = '';
      agent.runtime.status = 'idle';
      agent.runtime.error = null;
      agent.runtime.lastUserInput = '';
      agent.lastApplied = null;
      agent.appliedEntries = [];
      if (agent.skills) {
        agent.skills.autoMatchedIds = [];
        agent.skills.loadedContextMeta = createEmptySkillContextMeta();
        agent.skills.lastError = null;
      }
      if (agent.ui) {
        agent.ui.showLastApplied = true;
        agent.ui.diffEntryId = null;
        agent.ui.diffPanelOpen = false;
        agent.ui.fullscreenChatScrollTop = 0;
      }
    },
  };

  return runtimeInstance;
}

export default {
  getAgentRuntime,
};

export const __agentRuntimeTesting = {
  getToolSupportState,
  setToolSupportState,
  clearToolSupportCache,
  shouldSkipToolFlowForUnsupportedSupplier,
  requestToolRoundCompletion,
  buildToolMessages,
  collectToolDiffSummaries,
  buildToolDiffs,
  createToolTrace,
};
