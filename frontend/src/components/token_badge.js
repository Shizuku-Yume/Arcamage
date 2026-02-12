/**
 * Token Badge 组件
 * 
 * 实时显示 Token 估算数量和阈值警告
 * 遵循 frontend_design.md §5.11 设计规范
 */

import Alpine from 'alpinejs';

const CJK_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\uff00-\uffef]/g;

/**
 * 估算文本 Token 数量
 * 公式: CJK字符/0.7 + 非CJK字符/4
 * 
 * @param {string} text - 输入文本
 * @returns {number} 估算的 Token 数量
 */
export function estimateTokens(text) {
  if (!text) return 0;
  
  const cjkMatches = text.match(CJK_PATTERN);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkCount = text.length - cjkCount;
  
  const cjkTokens = cjkCount / 0.7;
  const nonCjkTokens = nonCjkCount / 4;
  
  return Math.round(cjkTokens + nonCjkTokens);
}

/**
 * 估算卡片所有字段的 Token 总量
 * 
 * @param {Object} cardData - CCv3 卡片数据
 * @returns {Object} { total, breakdown: { field: count } }
 */
export function estimateCardTokens(cardData) {
  if (!cardData?.data) {
    return { total: 0, breakdown: {} };
  }
  
  const data = cardData.data;
  const breakdown = {};
  
  const textFields = [
    'name', 'description', 'first_mes', 'personality', 'scenario',
    'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes'
  ];
  
  for (const field of textFields) {
    if (data[field]) {
      breakdown[field] = estimateTokens(data[field]);
    }
  }
  
  if (data.alternate_greetings?.length) {
    breakdown.alternate_greetings = data.alternate_greetings.reduce(
      (sum, g) => sum + estimateTokens(g), 0
    );
  }
  
  if (data.group_only_greetings?.length) {
    breakdown.group_only_greetings = data.group_only_greetings.reduce(
      (sum, g) => sum + estimateTokens(g), 0
    );
  }
  
  if (data.character_book?.entries?.length) {
    let lorebookTotal = 0;
    for (const entry of data.character_book.entries) {
      if (!entry.enabled) continue;
      lorebookTotal += estimateTokens(entry.content);
      if (entry.keys?.length) {
        lorebookTotal += estimateTokens(entry.keys.join(' '));
      }
      if (entry.secondary_keys?.length) {
        lorebookTotal += estimateTokens(entry.secondary_keys.join(' '));
      }
    }
    breakdown.character_book = lorebookTotal;
  }
  
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  
  return { total, breakdown };
}

/**
 * 获取警告级别
 * 
 * @param {number} current - 当前 Token 数
 * @param {number} budget - Token 预算 (默认 8000)
 * @returns {string|null} 'warning' | 'danger' | null
 */
export function getWarningLevel(current, budget = 8000) {
  if (budget <= 0) return null;
  
  const percentage = (current / budget) * 100;
  
  if (percentage >= 90) return 'danger';
  if (percentage >= 70) return 'warning';
  return null;
}

/**
 * Token Badge Alpine 组件
 * 
 * 使用方式: <div x-data="tokenBadge({ budget: 8000 })">...</div>
 */
export function tokenBadgeComponent(options = {}) {
  return {
    budget: options.budget || 8000,
    total: 0,
    breakdown: {},
    level: null,
    percentage: 0,
    
    init() {
      this.update();
      
      this.$watch('$store.card.data', () => {
        this.update();
      });
    },
    
    update() {
      const cardStore = Alpine.store('card');
      if (!cardStore?.data) {
        this.total = 0;
        this.breakdown = {};
        this.level = null;
        this.percentage = 0;
        return;
      }
      
      const result = estimateCardTokens(cardStore.data);
      this.total = result.total;
      this.breakdown = result.breakdown;
      this.level = getWarningLevel(this.total, this.budget);
      this.percentage = Math.round((this.total / this.budget) * 100);
    },
    
    get badgeClass() {
      switch (this.level) {
        case 'danger':
          return 'bg-danger-light text-danger dark:bg-danger-dark dark:text-danger-light';
        case 'warning':
          return 'bg-warning-light text-warning dark:bg-warning-dark dark:text-warning-light';
        default:
          return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300';
      }
    },
    
    get statusText() {
      if (this.percentage >= 90) return '超出预算';
      if (this.percentage >= 70) return '接近上限';
      return '正常';
    },
    
    formatNumber(num) {
      return num.toLocaleString('zh-CN');
    },
  };
}

/**
 * 单字段 Token Badge 组件 (用于单个输入框旁)
 */
export function fieldTokenBadge(options = {}) {
  return {
    field: options.field || '',
    text: '',
    tokens: 0,
    
    init() {
      if (this.field) {
        this.$watch('$store.card.data.data.' + this.field, (value) => {
          this.text = value || '';
          this.tokens = estimateTokens(this.text);
        });
      }
    },
    
    updateFromText(text) {
      this.text = text || '';
      this.tokens = estimateTokens(this.text);
    },
  };
}

/**
 * 注册 Token Badge 组件
 */
export function registerTokenBadgeComponents() {
  Alpine.data('tokenBadge', tokenBadgeComponent);
  Alpine.data('fieldTokenBadge', fieldTokenBadge);
}

/**
 * 生成 Token Badge HTML
 * @param {Object} options - 配置
 * @returns {string} HTML 字符串
 */
export function generateTokenBadgeHTML(options = {}) {
  const { showBreakdown = false } = options;
  
  return `
<div x-data="tokenBadge({ budget: 8000 })"
     class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-neo text-xs font-medium transition-colors"
     :class="badgeClass">
  <span x-text="\`预计: \${formatNumber(total)} tokens\`"></span>
</div>
${showBreakdown ? `
<div x-show="Object.keys(breakdown).length > 0" class="mt-2 text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
  <template x-for="(count, field) in breakdown" :key="field">
    <div class="flex justify-between">
      <span x-text="field"></span>
      <span x-text="formatNumber(count)"></span>
    </div>
  </template>
</div>
` : ''}
  `;
}

export default {
  estimateTokens,
  estimateCardTokens,
  getWarningLevel,
  tokenBadgeComponent,
  fieldTokenBadge,
  registerTokenBadgeComponents,
  generateTokenBadgeHTML,
};
