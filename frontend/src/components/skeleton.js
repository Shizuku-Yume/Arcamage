/**
 * 骨架屏加载组件
 * 
 * 提供多种预设骨架屏样式，用于内容加载时的占位显示
 * 遵循 frontend_design.md §18 设计规范
 */

import Alpine from 'alpinejs';

/**
 * 骨架屏基础组件
 * 使用方式: <div x-data="skeleton({ type: 'text', lines: 3 })">...</div>
 */
export function skeletonComponent(options = {}) {
  return {
    type: options.type || 'text',
    lines: options.lines || 3,
    animated: options.animated !== false,
    
    init() {
      // 组件初始化
    },
    
    get animationClass() {
      return this.animated ? 'animate-pulse' : '';
    },
    
    get baseClass() {
      return 'bg-zinc-200 dark:bg-zinc-700 rounded-neo';
    },
  };
}

/**
 * 生成骨架屏 HTML - 文本块
 * @param {Object} options - 配置选项
 * @param {number} options.lines - 行数 (默认 3)
 * @param {boolean} options.hasTitle - 是否包含标题 (默认 false)
 * @returns {string} HTML 字符串
 */
export function getTextSkeletonHTML(options = {}) {
  const lines = options.lines || 3;
  const hasTitle = options.hasTitle || false;
  
  let html = '<div class="animate-pulse space-y-3">';
  
  if (hasTitle) {
    html += '<div class="h-5 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-1/3"></div>';
  }
  
  for (let i = 0; i < lines; i++) {
    const width = i === lines - 1 ? 'w-4/5' : 'w-full';
    html += `<div class="h-4 bg-zinc-200 dark:bg-zinc-700 rounded-neo ${width}"></div>`;
  }
  
  html += '</div>';
  return html;
}

/**
 * 生成骨架屏 HTML - 卡片
 * @returns {string} HTML 字符串
 */
export function getCardSkeletonHTML() {
  return `
    <div class="animate-pulse bg-white dark:bg-zinc-800 rounded-neo-lg shadow-neo-lift dark:shadow-neo-lift-dark p-4">
      <!-- 图片区域 -->
      <div class="w-full aspect-[3/4] bg-zinc-200 dark:bg-zinc-700 rounded-neo mb-4"></div>
      <!-- 标题 -->
      <div class="h-5 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-3/4 mb-2"></div>
      <!-- 副标题 -->
      <div class="h-4 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-1/2 mb-4"></div>
      <!-- 按钮 -->
      <div class="h-10 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-full"></div>
    </div>
  `;
}

/**
 * 生成骨架屏 HTML - 列表项
 * @param {Object} options - 配置选项
 * @param {number} options.count - 列表项数量 (默认 5)
 * @param {boolean} options.hasAvatar - 是否包含头像 (默认 false)
 * @returns {string} HTML 字符串
 */
export function getListSkeletonHTML(options = {}) {
  const count = options.count || 5;
  const hasAvatar = options.hasAvatar || false;
  
  let html = '<div class="animate-pulse space-y-4">';
  
  for (let i = 0; i < count; i++) {
    html += '<div class="flex items-center gap-3">';
    
    if (hasAvatar) {
      html += '<div class="w-10 h-10 bg-zinc-200 dark:bg-zinc-700 rounded-full flex-shrink-0"></div>';
    }
    
    html += `
      <div class="flex-1 space-y-2">
        <div class="h-4 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-3/4"></div>
        <div class="h-3 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-1/2"></div>
      </div>
    `;
    
    html += '</div>';
  }
  
  html += '</div>';
  return html;
}

/**
 * 生成骨架屏 HTML - 表单
 * @param {Object} options - 配置选项
 * @param {number} options.fields - 字段数量 (默认 4)
 * @returns {string} HTML 字符串
 */
export function getFormSkeletonHTML(options = {}) {
  const fields = options.fields || 4;
  
  let html = '<div class="animate-pulse space-y-6">';
  
  for (let i = 0; i < fields; i++) {
    html += `
      <div class="space-y-2">
        <div class="h-4 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-1/4"></div>
        <div class="h-10 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-full"></div>
      </div>
    `;
  }
  
  html += `
    <div class="flex justify-end gap-3 pt-4">
      <div class="h-10 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-24"></div>
      <div class="h-10 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-24"></div>
    </div>
  `;
  
  html += '</div>';
  return html;
}

/**
 * 生成骨架屏 HTML - 编辑器区块 (用于工作台)
 * @returns {string} HTML 字符串
 */
export function getEditorSectionSkeletonHTML() {
  return `
    <div class="animate-pulse bg-white dark:bg-zinc-800 rounded-neo-lg shadow-neo-lift dark:shadow-neo-lift-dark overflow-hidden">
      <!-- 头部 -->
      <div class="px-6 py-4 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-700">
        <div class="flex items-center gap-2">
          <div class="w-5 h-5 bg-zinc-200 dark:bg-zinc-700 rounded"></div>
          <div class="h-5 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-24"></div>
        </div>
        <div class="w-5 h-5 bg-zinc-200 dark:bg-zinc-700 rounded"></div>
      </div>
      <!-- 内容 -->
      <div class="px-6 py-6 space-y-4">
        <div class="space-y-2">
          <div class="h-4 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-1/5"></div>
          <div class="h-10 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-full"></div>
        </div>
        <div class="space-y-2">
          <div class="h-4 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-1/4"></div>
          <div class="h-24 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-full"></div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 生成骨架屏 HTML - 图片占位
 * @param {Object} options - 配置选项
 * @param {string} options.aspectRatio - 宽高比 (默认 '3/4')
 * @returns {string} HTML 字符串
 */
export function getImageSkeletonHTML(options = {}) {
  const aspectRatio = options.aspectRatio || '3/4';
  return `
    <div class="animate-pulse bg-zinc-200 dark:bg-zinc-700 rounded-neo w-full" style="aspect-ratio: ${aspectRatio};">
      <div class="w-full h-full flex items-center justify-center">
        <svg class="w-12 h-12 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
        </svg>
      </div>
    </div>
  `;
}

/**
 * 生成骨架屏 HTML - 世界书条目
 * @param {Object} options - 配置选项
 * @param {number} options.count - 条目数量 (默认 3)
 * @returns {string} HTML 字符串
 */
export function getLorebookSkeletonHTML(options = {}) {
  const count = options.count || 3;
  
  let html = '<div class="animate-pulse space-y-3">';
  
  for (let i = 0; i < count; i++) {
    html += `
      <div class="bg-zinc-50 dark:bg-zinc-800 rounded-neo p-4">
        <div class="flex items-start gap-3">
          <div class="w-6 h-6 bg-zinc-200 dark:bg-zinc-700 rounded-full flex-shrink-0"></div>
          <div class="flex-1 space-y-2">
            <div class="h-4 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-1/3"></div>
            <div class="flex gap-2">
              <div class="h-6 bg-zinc-200 dark:bg-zinc-700 rounded-full w-16"></div>
              <div class="h-6 bg-zinc-200 dark:bg-zinc-700 rounded-full w-20"></div>
              <div class="h-6 bg-zinc-200 dark:bg-zinc-700 rounded-full w-12"></div>
            </div>
            <div class="h-3 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-full"></div>
            <div class="h-3 bg-zinc-200 dark:bg-zinc-700 rounded-neo w-4/5"></div>
          </div>
        </div>
      </div>
    `;
  }
  
  html += '</div>';
  return html;
}

/**
 * 注册骨架屏组件
 */
export function registerSkeletonComponent() {
  Alpine.data('skeleton', skeletonComponent);
}

// ============================================================
// 导出
// ============================================================

export default {
  skeletonComponent,
  registerSkeletonComponent,
  getTextSkeletonHTML,
  getCardSkeletonHTML,
  getListSkeletonHTML,
  getFormSkeletonHTML,
  getEditorSectionSkeletonHTML,
  getImageSkeletonHTML,
  getLorebookSkeletonHTML,
};
