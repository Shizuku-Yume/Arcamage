/**
 * 全局加载遮罩组件
 * 
 * 提供全屏加载状态显示，支持进度条和消息提示
 * 遵循 frontend_design.md 设计规范
 */

import Alpine from 'alpinejs';

/**
 * 加载遮罩组件
 * 使用方式: <div x-data="loadingOverlay()">...</div>
 */
export function loadingOverlayComponent() {
  return {
    get isLoading() {
      return Alpine.store('ui').globalLoading;
    },
    
    get message() {
      return Alpine.store('ui').loadingMessage || '处理中...';
    },
    
    get progress() {
      return Alpine.store('ui').loadingProgress;
    },
    
    get hasProgress() {
      return this.progress > 0;
    },
  };
}

/**
 * 显示全局加载遮罩
 * @param {string} message - 显示的消息
 */
export function showLoading(message = '处理中...') {
  Alpine.store('ui').setLoading(true, message);
}

/**
 * 隐藏全局加载遮罩
 */
export function hideLoading() {
  Alpine.store('ui').setLoading(false);
}

/**
 * 更新加载进度
 * @param {number} progress - 进度值 (0-100)
 */
export function setProgress(progress) {
  Alpine.store('ui').setProgress(progress);
}

/**
 * 更新加载消息
 * @param {string} message - 新的消息
 */
export function updateMessage(message) {
  Alpine.store('ui').loadingMessage = message;
}

/**
 * 执行带加载遮罩的异步操作
 * @param {Function} fn - 异步函数
 * @param {Object} options - 配置选项
 * @param {string} options.message - 加载消息
 * @param {string} options.successMessage - 成功消息 (可选，显示 toast)
 * @param {string} options.errorMessage - 错误消息前缀 (可选)
 * @returns {Promise<any>} 操作结果
 */
export async function withLoading(fn, options = {}) {
  const {
    message = '处理中...',
    successMessage = null,
    errorMessage = '操作失败',
  } = options;
  
  showLoading(message);
  
  try {
    const result = await fn();
    
    if (successMessage) {
      Alpine.store('toast').success(successMessage);
    }
    
    return result;
  } catch (error) {
    const errorMsg = error?.getUserMessage?.() || error?.message || '未知错误';
    Alpine.store('toast').error(`${errorMessage}: ${errorMsg}`);
    throw error;
  } finally {
    hideLoading();
  }
}

/**
 * 执行带进度的异步操作
 * @param {Function} fn - 异步函数，接收 updateProgress 回调
 * @param {Object} options - 配置选项
 * @returns {Promise<any>} 操作结果
 */
export async function withProgress(fn, options = {}) {
  const { message = '处理中...' } = options;
  
  showLoading(message);
  
  const updateProgress = (progress, newMessage) => {
    setProgress(progress);
    if (newMessage) {
      updateMessage(newMessage);
    }
  };
  
  try {
    const result = await fn(updateProgress);
    return result;
  } finally {
    hideLoading();
  }
}

/**
 * 生成加载遮罩 HTML
 * @returns {string} HTML 字符串
 */
export function getLoadingOverlayHTML() {
  return `
    <div x-data="loadingOverlay()"
         x-show="isLoading" 
         x-cloak
         class="fixed inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 flex items-center justify-center z-55"
         x-transition:enter="transition ease-out duration-200"
         x-transition:enter-start="opacity-0"
         x-transition:enter-end="opacity-100"
         x-transition:leave="transition ease-in duration-150"
         x-transition:leave-start="opacity-100"
         x-transition:leave-end="opacity-0">
      <div class="bg-white dark:bg-zinc-800 rounded-neo-lg shadow-neo-lift dark:shadow-neo-lift-dark p-6 flex flex-col items-center gap-4 min-w-[200px]">
        <!-- Spinner -->
        <div class="w-10 h-10 border-4 border-brand dark:border-brand-light border-t-transparent rounded-full animate-spin"></div>
        
        <!-- Message -->
        <p class="text-zinc-600 dark:text-zinc-300 text-center" x-text="message"></p>
        
        <!-- Progress Bar -->
      <div x-show="hasProgress" class="w-48 h-2 bg-zinc-100 dark:bg-zinc-700 rounded-neo overflow-hidden">
        <div class="h-full bg-brand dark:bg-brand-light transition-all duration-300 rounded-neo"
               :style="'width: ' + progress + '%'"></div>
        </div>
        
        <!-- Progress Percentage -->
        <span x-show="hasProgress" class="text-xs text-zinc-400 dark:text-zinc-500" x-text="Math.round(progress) + '%'"></span>
      </div>
    </div>
  `;
}

/**
 * 注册加载遮罩组件
 */
export function registerLoadingOverlayComponent() {
  Alpine.data('loadingOverlay', loadingOverlayComponent);
}

// ============================================================
// 导出
// ============================================================

export default {
  loadingOverlayComponent,
  registerLoadingOverlayComponent,
  getLoadingOverlayHTML,
  showLoading,
  hideLoading,
  setProgress,
  updateMessage,
  withLoading,
  withProgress,
};
