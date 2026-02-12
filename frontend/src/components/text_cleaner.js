/**
 * 文本清洗组件
 * 
 * 提供全角→半角转换、零宽字符去除等文本清洗功能
 * 遵循 IMPLEMENTATION_PLAN P2-3 规范
 * 
 * ⚠️ 保真红线: greeting 字段默认禁用清洗，需要用户二次确认
 */

import Alpine from 'alpinejs';
import { confirm } from './modal.js';
import { deepClone } from '../store.js';

/**
 * 全角字符映射表 (ASCII 范围)
 */
const FULLWIDTH_MAP = {};
for (let i = 0x21; i <= 0x7e; i++) {
  const fullwidth = String.fromCharCode(i + 0xfee0);
  const halfwidth = String.fromCharCode(i);
  FULLWIDTH_MAP[fullwidth] = halfwidth;
}
FULLWIDTH_MAP['　'] = ' ';

/**
 * 零宽字符正则
 */
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF\u2060\u180E]/g;

/**
 * 多余空行正则 (3个及以上连续换行符)
 */
const EXCESS_NEWLINES_REGEX = /\n{3,}/g;

/**
 * 多余空格正则 (2个及以上连续空格)
 */
const EXCESS_SPACES_REGEX = / {2,}/g;

/**
 * 清洗选项
 * @typedef {Object} CleanOptions
 * @property {boolean} fullwidthToHalfwidth - 全角→半角
 * @property {boolean} removeZeroWidth - 移除零宽字符
 * @property {boolean} trimExcessNewlines - 减少多余空行
 * @property {boolean} trimExcessSpaces - 减少多余空格
 * @property {boolean} trimWhitespace - 首尾空白
 */

/**
 * 默认清洗选项
 */
export const DEFAULT_OPTIONS = {
  fullwidthToHalfwidth: true,
  removeZeroWidth: true,
  trimExcessNewlines: true,
  trimExcessSpaces: false,
  trimWhitespace: true,
};

/**
 * Greeting 字段保守清洗选项 (默认禁用大部分)
 */
export const GREETING_OPTIONS = {
  fullwidthToHalfwidth: false,
  removeZeroWidth: true,
  trimExcessNewlines: false,
  trimExcessSpaces: false,
  trimWhitespace: false,
};

/**
 * 全角转半角
 * @param {string} text - 输入文本
 * @returns {string} 转换后的文本
 */
export function fullwidthToHalfwidth(text) {
  if (!text) return text;
  
  let result = '';
  for (const char of text) {
    result += FULLWIDTH_MAP[char] || char;
  }
  return result;
}

/**
 * 移除零宽字符
 * @param {string} text - 输入文本
 * @returns {string} 清理后的文本
 */
export function removeZeroWidth(text) {
  if (!text) return text;
  return text.replace(ZERO_WIDTH_REGEX, '');
}

/**
 * 减少多余空行 (3个及以上换行符变为2个)
 * @param {string} text - 输入文本
 * @returns {string} 处理后的文本
 */
export function trimExcessNewlines(text) {
  if (!text) return text;
  return text.replace(EXCESS_NEWLINES_REGEX, '\n\n');
}

/**
 * 减少多余空格 (2个及以上空格变为1个)
 * @param {string} text - 输入文本
 * @returns {string} 处理后的文本
 */
export function trimExcessSpaces(text) {
  if (!text) return text;
  return text.replace(EXCESS_SPACES_REGEX, ' ');
}

/**
 * 清洗单个文本
 * @param {string} text - 输入文本
 * @param {CleanOptions} options - 清洗选项
 * @returns {string} 清洗后的文本
 */
export function cleanText(text, options = DEFAULT_OPTIONS) {
  if (!text || typeof text !== 'string') return text;
  
  let result = text;
  
  if (options.fullwidthToHalfwidth) {
    result = fullwidthToHalfwidth(result);
  }
  
  if (options.removeZeroWidth) {
    result = removeZeroWidth(result);
  }
  
  if (options.trimExcessNewlines) {
    result = trimExcessNewlines(result);
  }
  
  if (options.trimExcessSpaces) {
    result = trimExcessSpaces(result);
  }
  
  if (options.trimWhitespace) {
    result = result.trim();
  }
  
  return result;
}

/**
 * 检测文本是否有可清洗内容
 * @param {string} text - 输入文本
 * @returns {Object} { hasDirty, issues: string[] }
 */
export function detectDirtyContent(text) {
  if (!text) return { hasDirty: false, issues: [] };
  
  const issues = [];
  
  const fullwidthChars = text.match(/[\uFF01-\uFF5E\u3000]/g);
  if (fullwidthChars?.length) {
    issues.push(`${fullwidthChars.length} 个全角字符`);
  }
  
  const zeroWidthChars = text.match(ZERO_WIDTH_REGEX);
  if (zeroWidthChars?.length) {
    issues.push(`${zeroWidthChars.length} 个零宽字符`);
  }
  
  const excessNewlines = text.match(EXCESS_NEWLINES_REGEX);
  if (excessNewlines?.length) {
    issues.push(`${excessNewlines.length} 处多余空行`);
  }
  
  return { hasDirty: issues.length > 0, issues };
}

/**
 * 清洗卡片的指定字段
 * @param {Object} cardData - CCv3 卡片数据
 * @param {string[]} fields - 要清洗的字段列表
 * @param {CleanOptions} options - 清洗选项
 * @returns {Object} { cardData, changes: { field: { before, after } } }
 */
export function cleanCardFields(cardData, fields, options = DEFAULT_OPTIONS) {
  if (!cardData?.data) {
    return { cardData, changes: {} };
  }
  
  const cloned = deepClone(cardData);
  const changes = {};
  
  for (const field of fields) {
    if (typeof cloned.data[field] === 'string') {
      const before = cloned.data[field];
      const after = cleanText(before, options);
      
      if (before !== after) {
        changes[field] = { before, after };
        cloned.data[field] = after;
      }
    }
  }
  
  return { cardData: cloned, changes };
}

/**
 * 需要二次确认的敏感字段 (含 HTML 内容)
 */
export const SENSITIVE_FIELDS = [
  'first_mes',
  'alternate_greetings',
  'group_only_greetings',
];

/**
 * 可安全清洗的字段
 */
export const SAFE_FIELDS = [
  'name', 'description', 'personality', 'scenario',
  'mes_example', 'system_prompt', 'post_history_instructions', 
  'creator_notes', 'creator',
];

/**
 * 显示清洗确认弹窗 (用于敏感字段)
 * @param {string} fieldName - 字段名
 * @param {Object} preview - { before, after }
 * @returns {Promise<boolean>} 用户是否确认
 */
export async function confirmClean(fieldName, preview) {
  const fieldLabels = {
    first_mes: '开场白',
    alternate_greetings: '备选开场白',
    group_only_greetings: '群组开场白',
  };
  
  const label = fieldLabels[fieldName] || fieldName;
  const beforeLen = preview.before?.length || 0;
  const afterLen = preview.after?.length || 0;
  const diff = beforeLen - afterLen;
  
  const message = `
即将清洗「${label}」字段:
• 原始长度: ${beforeLen} 字符
• 清洗后: ${afterLen} 字符
• 移除: ${diff} 字符

⚠️ 此字段可能包含 HTML 格式内容，清洗可能影响显示效果。
清洗前会保留副本用于撤销。

确定要继续吗？
  `.trim();
  
  return await confirm('清洗敏感字段', message, {
    type: 'warning',
    confirmText: '确认清洗',
    cancelText: '取消',
  });
}

/**
 * 文本清洗 Alpine 组件
 */
export function textCleanerComponent() {
  return {
    options: { ...DEFAULT_OPTIONS },
    
    async cleanCurrentCard() {
      const cardStore = Alpine.store('card');
      if (!cardStore?.data) {
        Alpine.store('toast').error('没有可清洗的卡片');
        return;
      }
      
      const historyStore = Alpine.store('history');
      historyStore.push(deepClone(cardStore.data));
      
      const { cardData, changes } = cleanCardFields(
        cardStore.data,
        SAFE_FIELDS,
        this.options
      );
      
      const changedCount = Object.keys(changes).length;
      
      if (changedCount === 0) {
        Alpine.store('toast').info('未发现需要清洗的内容');
        return;
      }
      
      cardStore.data = cardData;
      cardStore.checkChanges();
      
      Alpine.store('toast').success(`已清洗 ${changedCount} 个字段`);
    },
    
    async cleanField(fieldName) {
      const cardStore = Alpine.store('card');
      if (!cardStore?.data?.data) return;
      
      const isSensitive = SENSITIVE_FIELDS.includes(fieldName);
      const fieldValue = cardStore.data.data[fieldName];
      if (!fieldValue) return;
      
      const opts = isSensitive ? GREETING_OPTIONS : this.options;
      
      // 处理数组字段 (alternate_greetings, group_only_greetings)
      if (Array.isArray(fieldValue)) {
        const cleanedArray = fieldValue.map(item => 
          typeof item === 'string' ? cleanText(item, opts) : item
        );
        
        // 检查是否有变化
        const hasChanges = fieldValue.some((item, i) => item !== cleanedArray[i]);
        if (!hasChanges) {
          Alpine.store('toast').info('此字段无需清洗');
          return;
        }
        
        // 敏感字段需二次确认
        if (isSensitive) {
          const totalBefore = fieldValue.join('').length;
          const totalAfter = cleanedArray.join('').length;
          const confirmed = await confirmClean(fieldName, { 
            before: { length: totalBefore },
            after: { length: totalAfter }
          });
          if (!confirmed) return;
        }
        
        const historyStore = Alpine.store('history');
        historyStore.push(deepClone(cardStore.data));
        
        cardStore.data.data[fieldName] = cleanedArray;
        cardStore.checkChanges();
        
        Alpine.store('toast').success('字段已清洗');
        return;
      }
      
      // 处理字符串字段
      const text = fieldValue;
      const after = cleanText(text, opts);
      
      if (text === after) {
        Alpine.store('toast').info('此字段无需清洗');
        return;
      }
      
      if (isSensitive) {
        const confirmed = await confirmClean(fieldName, { before: text, after });
        if (!confirmed) return;
      }
      
      const historyStore = Alpine.store('history');
      historyStore.push(deepClone(cardStore.data));
      
      cardStore.data.data[fieldName] = after;
      cardStore.checkChanges();
      
      Alpine.store('toast').success('字段已清洗');
    },
    
    detectDirty(text) {
      return detectDirtyContent(text);
    },
  };
}

/**
 * 注册文本清洗组件
 */
export function registerTextCleanerComponent() {
  Alpine.data('textCleaner', textCleanerComponent);
}

export default {
  cleanText,
  fullwidthToHalfwidth,
  removeZeroWidth,
  trimExcessNewlines,
  trimExcessSpaces,
  detectDirtyContent,
  cleanCardFields,
  confirmClean,
  textCleanerComponent,
  registerTextCleanerComponent,
  DEFAULT_OPTIONS,
  GREETING_OPTIONS,
  SAFE_FIELDS,
  SENSITIVE_FIELDS,
};
