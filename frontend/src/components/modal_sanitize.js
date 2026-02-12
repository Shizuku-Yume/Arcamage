/**
 * 危险内容确认弹窗组件
 * 
 * 用于检测和确认潜在危险内容（如 HTML/JavaScript）
 * 遵循 frontend_design.md 设计规范
 */

import Alpine from 'alpinejs';
import { confirm } from './modal.js';

// 危险模式检测规则
const DANGER_PATTERNS = {
  // XSS 相关
  script: /<script[\s>]/i,
  javascript: /javascript:/i,
  onEvent: /\bon\w+\s*=/i,
  
  // 数据窃取
  dataExfil: /document\.(cookie|location)/i,
  fetch: /fetch\s*\(/i,
  xmlhttp: /XMLHttpRequest/i,
  
  // DOM 操作
  evalCall: /\beval\s*\(/i,
  innerHTML: /innerHTML\s*=/i,
  documentWrite: /document\.write/i,
  
  // 注入攻击
  sqlInjection: /(\bUNION\b.*\bSELECT\b|\bDROP\b.*\bTABLE\b)/i,
  
  // 外部资源
  externalLink: /(?:src|href)\s*=\s*["']?https?:\/\//i,
  dataUri: /(?:src|href)\s*=\s*["']?data:/i,
  
  // iframe/embed
  iframe: /<iframe[\s>]/i,
  embed: /<embed[\s>]/i,
  object: /<object[\s>]/i,
};

// 警告级别
const SEVERITY = {
  critical: { label: '严重', color: 'red', priority: 3 },
  high: { label: '高危', color: 'orange', priority: 2 },
  medium: { label: '中危', color: 'amber', priority: 1 },
  low: { label: '低危', color: 'yellow', priority: 0 },
};

// 规则分类
const RULE_SEVERITY = {
  script: 'critical',
  javascript: 'critical',
  evalCall: 'critical',
  
  onEvent: 'high',
  dataExfil: 'high',
  innerHTML: 'high',
  documentWrite: 'high',
  
  fetch: 'medium',
  xmlhttp: 'medium',
  iframe: 'medium',
  embed: 'medium',
  object: 'medium',
  
  externalLink: 'low',
  dataUri: 'low',
  sqlInjection: 'medium',
};

// 规则描述
const RULE_DESCRIPTIONS = {
  script: '检测到 <script> 标签，可能包含恶意脚本',
  javascript: '检测到 javascript: 协议，可能执行恶意代码',
  onEvent: '检测到内联事件处理器 (如 onclick)，可能触发恶意代码',
  dataExfil: '检测到敏感数据访问（cookie/location），可能存在数据窃取',
  fetch: '检测到 fetch() 调用，可能发送敏感数据到外部',
  xmlhttp: '检测到 XMLHttpRequest，可能发送敏感数据到外部',
  evalCall: '检测到 eval() 调用，可能执行任意代码',
  innerHTML: '检测到 innerHTML 赋值，可能导致 XSS',
  documentWrite: '检测到 document.write，可能导致 XSS',
  sqlInjection: '检测到可能的 SQL 注入语句',
  externalLink: '检测到外部链接，可能加载外部资源',
  dataUri: '检测到 data: URI，可能包含嵌入内容',
  iframe: '检测到 <iframe> 标签，可能加载外部页面',
  embed: '检测到 <embed> 标签，可能加载外部内容',
  object: '检测到 <object> 标签，可能加载外部对象',
};

/**
 * 检测结果
 * @typedef {Object} ScanResult
 * @property {boolean} hasDanger - 是否有危险内容
 * @property {string} highestSeverity - 最高危险级别
 * @property {Array<Object>} matches - 匹配的规则列表
 */

/**
 * 扫描内容中的潜在危险
 * @param {string} content - 要扫描的内容
 * @returns {ScanResult} 扫描结果
 */
export function scanContent(content) {
  if (!content || typeof content !== 'string') {
    return { hasDanger: false, highestSeverity: null, matches: [] };
  }
  
  const matches = [];
  let highestPriority = -1;
  let highestSeverity = null;
  
  for (const [ruleName, pattern] of Object.entries(DANGER_PATTERNS)) {
    if (pattern.test(content)) {
      const severity = RULE_SEVERITY[ruleName] || 'low';
      const severityInfo = SEVERITY[severity];
      
      matches.push({
        rule: ruleName,
        severity,
        label: severityInfo.label,
        color: severityInfo.color,
        description: RULE_DESCRIPTIONS[ruleName] || `匹配规则: ${ruleName}`,
      });
      
      if (severityInfo.priority > highestPriority) {
        highestPriority = severityInfo.priority;
        highestSeverity = severity;
      }
    }
  }
  
  return {
    hasDanger: matches.length > 0,
    highestSeverity,
    matches,
  };
}

/**
 * 扫描卡片数据中的所有文本字段
 * @param {Object} cardData - 卡片数据
 * @returns {ScanResult} 合并的扫描结果
 */
export function scanCard(cardData) {
  if (!cardData?.data) {
    return { hasDanger: false, highestSeverity: null, matches: [], fields: [] };
  }
  
  const data = cardData.data;
  const fieldsToScan = [
    { name: 'description', label: '描述' },
    { name: 'personality', label: '性格' },
    { name: 'scenario', label: '场景' },
    { name: 'first_mes', label: '开场白' },
    { name: 'mes_example', label: '对话示例' },
    { name: 'system_prompt', label: '系统提示' },
    { name: 'post_history_instructions', label: '后置指令' },
    { name: 'creator_notes', label: '创作者注记' },
  ];
  
  const allMatches = [];
  const fieldResults = [];
  let highestPriority = -1;
  let highestSeverity = null;
  
  for (const field of fieldsToScan) {
    const content = data[field.name];
    if (content) {
      const result = scanContent(content);
      if (result.hasDanger) {
        fieldResults.push({
          field: field.name,
          label: field.label,
          matches: result.matches,
        });
        
        for (const match of result.matches) {
          const severity = SEVERITY[match.severity];
          if (severity.priority > highestPriority) {
            highestPriority = severity.priority;
            highestSeverity = match.severity;
          }
          
          // 添加字段信息
          allMatches.push({
            ...match,
            field: field.name,
            fieldLabel: field.label,
          });
        }
      }
    }
  }
  
  // 扫描备选开场白
  const greetings = data.alternate_greetings || [];
  for (let i = 0; i < greetings.length; i++) {
    const result = scanContent(greetings[i]);
    if (result.hasDanger) {
      fieldResults.push({
        field: `alternate_greetings[${i}]`,
        label: `备选开场白 #${i + 1}`,
        matches: result.matches,
      });
      
      for (const match of result.matches) {
        allMatches.push({
          ...match,
          field: `alternate_greetings[${i}]`,
          fieldLabel: `备选开场白 #${i + 1}`,
        });
      }
    }
  }
  
  return {
    hasDanger: allMatches.length > 0,
    highestSeverity,
    matches: allMatches,
    fields: fieldResults,
  };
}

/**
 * 显示危险内容确认弹窗
 * @param {ScanResult} scanResult - 扫描结果
 * @returns {Promise<boolean>} 用户确认继续返回 true
 */
export async function showSanitizeModal(scanResult) {
  if (!scanResult.hasDanger) return true;
  
  const severityLabel = SEVERITY[scanResult.highestSeverity]?.label || '未知';
  const matchCount = scanResult.matches.length;
  
  const title = `检测到潜在风险内容`;
  const message = `此卡片包含 ${matchCount} 处可能的风险内容（最高级别: ${severityLabel}）。这些内容可能包含恶意脚本或不安全的代码。是否仍要继续？`;
  
  return await confirm(title, message, {
    type: 'danger',
    confirmText: '了解风险，继续',
    cancelText: '取消',
  });
}

/**
 * 扫描并提示危险内容
 * @param {Object} cardData - 卡片数据
 * @param {Object} options - 配置选项
 * @param {boolean} options.showWarningOnly - 仅在有危险时显示 (默认 true)
 * @returns {Promise<boolean>} 用户确认继续返回 true
 */
export async function scanAndConfirm(cardData, options = {}) {
  const { showWarningOnly: _showWarningOnly = true } = options;
  
  const result = scanCard(cardData);
  
  if (!result.hasDanger) {
    return true;
  }
  
  // 只在 critical/high 级别时弹窗确认
  if (result.highestSeverity === 'critical' || result.highestSeverity === 'high') {
    return await showSanitizeModal(result);
  }
  
  // 中低危险级别显示 toast 警告
  Alpine.store('toast').show({
    message: `检测到 ${result.matches.length} 处潜在风险内容`,
    type: 'warning',
    duration: 5000,
  });
  
  return true;
}

/**
 * 获取安全级别徽章 HTML
 * @param {string} severity - 危险级别
 * @returns {string} HTML 字符串
 */
export function getSeverityBadgeHTML(severity) {
  const info = SEVERITY[severity];
  if (!info) return '';
  
  const colorClasses = {
    red: 'bg-danger-light text-danger ring-danger/30 dark:bg-danger-dark dark:text-danger-light dark:ring-danger/60',
    orange: 'bg-warning-light text-warning ring-warning/30 dark:bg-warning-dark dark:text-warning-light dark:ring-warning/60',
    amber: 'bg-warning-light text-warning ring-warning/30 dark:bg-warning-dark dark:text-warning-light dark:ring-warning/60',
    yellow: 'bg-brand-100 text-brand-700 ring-brand-300/50 dark:bg-brand-900/50 dark:text-brand-300 dark:ring-brand-700/60',
  };
  
  const classes = colorClasses[info.color] || colorClasses.yellow;
  
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-neo text-xs font-medium ring-1 ${classes}">${info.label}</span>`;
}

/**
 * 危险内容扫描组件
 * 使用方式: <div x-data="contentScanner({ content: '' })">...</div>
 */
export function contentScannerComponent(options = {}) {
  return {
    content: options.content || '',
    result: null,
    
    init() {
      if (this.content) {
        this.scan();
      }
    },
    
    scan() {
      this.result = scanContent(this.content);
    },
    
    get hasDanger() {
      return this.result?.hasDanger || false;
    },
    
    get matches() {
      return this.result?.matches || [];
    },
    
    get highestSeverity() {
      return this.result?.highestSeverity;
    },
    
    getSeverityBadge(severity) {
      return getSeverityBadgeHTML(severity);
    },
  };
}

/**
 * 注册内容扫描组件
 */
export function registerContentScannerComponent() {
  Alpine.data('contentScanner', contentScannerComponent);
}

// ============================================================
// 导出
// ============================================================

export default {
  scanContent,
  scanCard,
  showSanitizeModal,
  scanAndConfirm,
  getSeverityBadgeHTML,
  contentScannerComponent,
  registerContentScannerComponent,
  DANGER_PATTERNS,
  SEVERITY,
  RULE_DESCRIPTIONS,
};
