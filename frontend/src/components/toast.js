/**
 * Toast 通知组件
 * 
 * 提供成功/失败/加载中三态通知
 * 遵循 frontend_design.md 设计规范
 */

import Alpine from 'alpinejs';

// Toast 图标 SVG
const ICONS = {
  success: `<svg class="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>`,
  
  error: `<svg class="w-5 h-5 text-danger dark:text-danger-light" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
  </svg>`,

  warning: `<svg class="w-5 h-5 text-warning dark:text-warning-light" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
  </svg>`,
  
  loading: `<svg class="w-5 h-5 text-zinc-500 dark:text-zinc-400 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>`,
  
  info: `<svg class="w-5 h-5 text-zinc-600 dark:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
  </svg>`,
};

const BG_CLASSES = {
  success: 'bg-white dark:bg-zinc-800 border-brand-500',
  error: 'bg-white dark:bg-zinc-800 border-danger',
  warning: 'bg-white dark:bg-zinc-800 border-warning',
  loading: 'bg-white dark:bg-zinc-800 border-zinc-400',
  info: 'bg-white dark:bg-zinc-800 border-zinc-400',
};

/**
 * 创建 Toast 容器组件
 * 在 index.html 中使用: <div x-data="toastContainer()"></div>
 */
export function toastContainer() {
  return {
    get items() {
      return Alpine.store('toast').items;
    },

    getIcon(type) {
      return ICONS[type] || ICONS.info;
    },

    getBgClass(type) {
      return BG_CLASSES[type] || BG_CLASSES.info;
    },

    dismiss(id) {
      Alpine.store('toast').dismiss(id);
    },
  };
}

/**
 * Toast 快捷函数
 */
export function showToast(message, type = 'info', duration = 3000) {
  return Alpine.store('toast').show({ message, type, duration });
}

export function showSuccess(message, duration = 3000) {
  return Alpine.store('toast').success(message, duration);
}

export function showError(message, duration = 5000) {
  return Alpine.store('toast').error(message, duration);
}

export function showLoading(message) {
  return Alpine.store('toast').loading(message);
}

export function showInfo(message, duration = 3000) {
  return Alpine.store('toast').info(message, duration);
}

export function dismissToast(id) {
  Alpine.store('toast').dismiss(id);
}

export function updateToast(id, options) {
  Alpine.store('toast').update(id, options);
}

/**
 * 注册 Toast 组件到 Alpine
 */
export function registerToastComponent() {
  Alpine.data('toastContainer', toastContainer);
  
  // 运行时检查：确保 Toast 容器存在
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('[x-data="toastContainer()"]')) {
      console.warn('[toast] Toast container not found in DOM. Please add the toast container HTML to your page.');
    }
  });
}

/**
 * 生成 Toast 容器 HTML
 * 用于插入到页面中
 */
export function getToastContainerHTML() {
  return `
    <div x-data="toastContainer()" 
         class="fixed bottom-6 right-6 z-60 flex flex-col gap-2 max-w-sm"
         aria-live="polite">
      <template x-for="item in items" :key="item.id">
        <div class="flex items-start gap-3 p-4 rounded-neo border-l-4 shadow-neo-lift dark:shadow-neo-lift-dark transition-all duration-300"
             :class="getBgClass(item.type)"
             x-show="true"
             x-transition:enter="transition ease-out duration-300"
             x-transition:enter-start="opacity-0 translate-x-8"
             x-transition:enter-end="opacity-100 translate-x-0"
             x-transition:leave="transition ease-in duration-200"
             x-transition:leave-start="opacity-100 translate-x-0"
             x-transition:leave-end="opacity-0 translate-x-8">
          <div class="flex-shrink-0" x-html="getIcon(item.type)"></div>
          <p class="text-sm text-zinc-700 dark:text-zinc-200 flex-1" x-text="item.message"></p>
          <button x-show="item.type !== 'loading'"
                  @click="dismiss(item.id)"
                  class="flex-shrink-0 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
                  aria-label="关闭">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </template>
    </div>
  `;
}

// ============================================================
// 导出
// ============================================================

export default {
  toastContainer,
  registerToastComponent,
  getToastContainerHTML,
  showToast,
  showSuccess,
  showError,
  showLoading,
  showInfo,
  dismissToast,
  updateToast,
};
