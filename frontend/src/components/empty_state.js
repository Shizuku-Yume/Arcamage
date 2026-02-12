/**
 * 空状态组件
 * 
 * 提供多种场景化的空状态展示
 * 遵循 frontend_design.md §21 设计规范
 */

import Alpine from 'alpinejs';

// 预设图标 SVG
const ICONS = {
  document: `<svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
  </svg>`,
  
  book: `<svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
  </svg>`,
  
  chat: `<svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
  </svg>`,
  
  tag: `<svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
    <path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6Z" />
  </svg>`,
  
  sparkles: `<svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
  </svg>`,
  
  upload: `<svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
  </svg>`,
  
  folder: `<svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
  </svg>`,
  
  list: `<svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
  </svg>`,
  
  search: `<svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
  </svg>`,
  
  error: `<svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
  </svg>`,
};

// 预设场景配置
const PRESETS = {
  lorebook: {
    icon: 'book',
    title: '暂无世界书条目',
    description: '添加条目以丰富角色背景设定',
    actionText: '+ 添加条目',
  },
  greetings: {
    icon: 'chat',
    title: '暂无备选开场白',
    description: '添加多个开场白提供对话多样性',
    actionText: '+ 添加开场白',
  },
  tags: {
    icon: 'tag',
    title: '暂无标签',
    description: '添加标签便于分类管理',
    actionText: '+ 添加标签',
  },
  upload: {
    icon: 'upload',
    title: '上传角色卡开始',
    description: '支持 PNG/JSON 格式的 V2/V3 卡片',
    actionText: '选择文件',
  },
  noResults: {
    icon: 'search',
    title: '无搜索结果',
    description: '尝试使用其他关键词搜索',
    actionText: null,
  },
  error: {
    icon: 'error',
    title: '加载失败',
    description: '请检查网络连接后重试',
    actionText: '重试',
  },
  list: {
    icon: 'list',
    title: '列表为空',
    description: '暂无数据',
    actionText: null,
  },
};

/**
 * 空状态组件
 * 使用方式: <div x-data="emptyState({ preset: 'lorebook' })">...</div>
 * 
 * 注意：此组件用于获取配置和图标，按钮点击需在模板中手动绑定
 */
export function emptyStateComponent(options = {}) {
  const preset = options.preset ? PRESETS[options.preset] : null;
  
  return {
    icon: options.icon || preset?.icon || 'document',
    title: options.title || preset?.title || '暂无数据',
    description: options.description || preset?.description || '',
    actionText: options.actionText !== undefined ? options.actionText : preset?.actionText,
    compact: options.compact || false,
    
    getIconHTML() {
      return ICONS[this.icon] || ICONS.document;
    },
  };
}

/**
 * 生成空状态 HTML
 * @param {Object} options - 配置选项
 * @returns {string} HTML 字符串
 */
export function getEmptyStateHTML(options = {}) {
  const preset = options.preset ? PRESETS[options.preset] : null;
  const icon = options.icon || preset?.icon || 'document';
  const title = options.title || preset?.title || '暂无数据';
  const description = options.description || preset?.description || '';
  const actionText = options.actionText !== undefined ? options.actionText : preset?.actionText;
  const compact = options.compact || false;
  
  const padding = compact ? 'py-6' : 'py-12';
  const iconSize = compact ? 'w-12 h-12' : 'w-16 h-16';
  const iconInnerSize = compact ? 'w-6 h-6' : 'w-8 h-8';
  
  let html = `
    <div class="flex flex-col items-center justify-center ${padding} text-center">
      <div class="${iconSize} bg-zinc-100 dark:bg-zinc-700 rounded-neo flex items-center justify-center mb-4">
        <span class="${iconInnerSize} text-zinc-300 dark:text-zinc-500">${ICONS[icon] || ICONS.document}</span>
      </div>
      <p class="text-zinc-500 dark:text-zinc-400 font-medium mb-1">${title}</p>
  `;
  
  if (description) {
    html += `<p class="text-zinc-400 dark:text-zinc-500 text-sm mb-4">${description}</p>`;
  }
  
  if (actionText) {
    html += `
      <button class="btn-primary px-4 py-2">
        ${actionText}
      </button>
    `;
  }
  
  html += '</div>';
  return html;
}

/**
 * 生成拖放区空状态 HTML
 * @param {Object} options - 配置选项
 * @returns {string} HTML 字符串
 */
export function getDropZoneEmptyHTML(options = {}) {
  const title = options.title || '拖放文件到此处';
  const description = options.description || '或点击选择文件';
  
  return `
    <div class="border-2 border-dashed border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900/30 rounded-neo-lg p-8
                flex flex-col items-center justify-center
                hover:border-brand-400 dark:hover:border-brand-500 hover:bg-brand-50/30 dark:hover:bg-brand-900/20 transition-colors cursor-pointer">
      <span class="w-12 h-12 text-zinc-300 dark:text-zinc-500 mb-4">${ICONS.upload}</span>
      <p class="text-zinc-600 dark:text-zinc-300 font-medium mb-1">${title}</p>
      <p class="text-zinc-400 dark:text-zinc-500 text-sm">${description}</p>
    </div>
  `;
}

/**
 * 生成内联空状态 HTML (用于小区域)
 * @param {Object} options - 配置选项
 * @returns {string} HTML 字符串
 */
export function getInlineEmptyHTML(options = {}) {
  const message = options.message || '暂无数据';
  const actionText = options.actionText || null;
  
  let html = `
    <div class="text-center py-4 text-zinc-400 dark:text-zinc-500 text-sm">
      <span>${message}</span>
  `;
  
  if (actionText) {
    html += `
      <button class="ml-2 text-brand dark:text-brand-light hover:text-brand-dark dark:hover:text-brand font-medium transition-colors">
        ${actionText}
      </button>
    `;
  }
  
  html += '</div>';
  return html;
}

/**
 * 注册空状态组件
 */
export function registerEmptyStateComponent() {
  Alpine.data('emptyState', emptyStateComponent);
}

// ============================================================
// 导出
// ============================================================

export default {
  emptyStateComponent,
  registerEmptyStateComponent,
  getEmptyStateHTML,
  getDropZoneEmptyHTML,
  getInlineEmptyHTML,
  PRESETS,
  ICONS,
};
