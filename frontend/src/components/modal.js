/**
 * 通用模态框组件
 * 
 * 提供恢复提示、危险操作确认等模态框功能
 * 遵循 frontend_design.md §5.7 设计规范
 */

import Alpine from 'alpinejs';

// 模态框图标 SVG
const ICONS = {
  warning: `<svg class="w-5 h-5 text-warning dark:text-warning-light" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
  </svg>`,
  
  danger: `<svg class="w-5 h-5 text-danger dark:text-danger-light" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
  </svg>`,
  
  info: `<svg class="w-5 h-5 text-brand dark:text-brand-light" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
  </svg>`,
  
  success: `<svg class="w-5 h-5 text-brand-600 dark:text-brand-light" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>`,
  
  recovery: `<svg class="w-5 h-5 text-brand-600 dark:text-brand-light" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>`,
};

// 图标背景色
const ICON_BG_CLASSES = {
  warning: 'bg-warning-light dark:bg-warning-dark',
  danger: 'bg-danger-light dark:bg-danger-dark',
  info: 'bg-brand-100 dark:bg-zinc-700',
  success: 'bg-brand-100 dark:bg-zinc-700',
  recovery: 'bg-brand-100 dark:bg-zinc-700',
};

// 确认按钮样式
const CONFIRM_BTN_CLASSES = {
  warning: 'bg-warning hover:bg-warning-dark',
  danger: 'bg-danger hover:bg-danger-dark',
  info: 'bg-brand hover:bg-brand-dark',
  success: 'bg-brand hover:bg-brand-dark',
  recovery: 'bg-brand hover:bg-brand-dark',
};

/**
 * 模态框组件
 * 使用方式: <div x-data="modalComponent()">...</div>
 */
export function modalComponent() {
  return {
    get modal() {
      return Alpine.store('modal');
    },
    
    get isOpen() {
      return this.modal.isOpen;
    },
    
    get config() {
      return this.modal.config;
    },
    
    getIcon(type) {
      return ICONS[type] || ICONS.info;
    },
    
    getIconBgClass(type) {
      return ICON_BG_CLASSES[type] || ICON_BG_CLASSES.info;
    },
    
    getConfirmBtnClass(type) {
      return CONFIRM_BTN_CLASSES[type] || CONFIRM_BTN_CLASSES.info;
    },
    
    close() {
      this.modal.close();
    },
    
    confirm() {
      this.modal.confirm();
    },
    
    cancel() {
      this.modal.cancel();
    },
  };
}

/**
 * 初始化模态框 Store
 * 应在 initStores() 之后调用
 */
export function initModalStore() {
  Alpine.store('modal', {
    isOpen: false,
    config: {
      type: 'info',
      title: '',
      message: '',
      confirmText: '确认',
      cancelText: '取消',
      showCancel: true,
      closeable: true,
      onConfirm: null,
      onCancel: null,
    },
    
    /**
     * 打开模态框
     * @param {Object} options 配置选项
     */
    open(options = {}) {
      this.config = {
        type: options.type || 'info',
        title: options.title || '',
        message: options.message || '',
        confirmText: options.confirmText || '确认',
        cancelText: options.cancelText || '取消',
        showCancel: options.showCancel !== false,
        closeable: options.closeable !== false,
        onConfirm: options.onConfirm || null,
        onCancel: options.onCancel || null,
      };
      this.isOpen = true;
    },
    
    /**
     * 关闭模态框
     */
    close() {
      this.isOpen = false;
    },
    
    /**
     * 确认操作
     */
    confirm() {
      if (this.config.onConfirm) {
        this.config.onConfirm();
      }
      this.close();
    },
    
    /**
     * 取消操作
     */
    cancel() {
      if (this.config.onCancel) {
        this.config.onCancel();
      }
      this.close();
    },
  });
}

/**
 * 便捷方法：显示信息模态框
 */
export function showInfo(title, message, options = {}) {
  Alpine.store('modal').open({
    type: 'info',
    title,
    message,
    showCancel: false,
    ...options,
  });
}

/**
 * 便捷方法：显示警告模态框
 */
export function showWarning(title, message, options = {}) {
  Alpine.store('modal').open({
    type: 'warning',
    title,
    message,
    ...options,
  });
}

/**
 * 便捷方法：显示危险操作确认模态框
 */
export function showDanger(title, message, options = {}) {
  Alpine.store('modal').open({
    type: 'danger',
    title,
    message,
    confirmText: options.confirmText || '确认删除',
    ...options,
  });
}

/**
 * 便捷方法：显示确认模态框 (Promise 版本)
 * @returns {Promise<boolean>} 用户点击确认返回 true，取消返回 false
 */
export function confirm(title, message, options = {}) {
  return new Promise((resolve) => {
    const { onConfirm: _onConfirm, onCancel: _onCancel, closeable: _closeable, ...safeOptions } = options;
    
    Alpine.store('modal').open({
      type: safeOptions.type || 'warning',
      title,
      message,
      confirmText: safeOptions.confirmText || '确认',
      cancelText: safeOptions.cancelText || '取消',
      closeable: false,
      showCancel: safeOptions.showCancel !== false,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/**
 * 便捷方法：显示恢复提示模态框
 */
export function showRecovery(options = {}) {
  Alpine.store('modal').open({
    type: 'recovery',
    title: options.title || '发现未保存的草稿',
    message: options.message || '检测到上次编辑的未保存内容，是否恢复？',
    confirmText: options.confirmText || '恢复',
    cancelText: options.cancelText || '丢弃',
    closeable: false,
    ...options,
  });
}

/**
 * 注册模态框组件
 */
export function registerModalComponent() {
  Alpine.data('modalComponent', modalComponent);
  initModalStore();
}

/**
 * 生成模态框容器 HTML
 */
export function getModalContainerHTML() {
  return `
         <div x-data="modalComponent()"
           x-show="isOpen" 
           x-cloak
         class="fixed inset-0 z-59 flex items-end sm:items-center justify-center p-2 sm:p-4 safe-area-inset-top safe-area-inset-bottom"
          x-transition:enter="transition ease-out duration-300"
          x-transition:enter-start="opacity-0"
          x-transition:enter-end="opacity-100"
         x-transition:leave="transition ease-in duration-200"
          x-transition:leave-start="opacity-100"
          x-transition:leave-end="opacity-0"
          @keydown.escape.window="config.closeable && close()">
      <!-- 遮罩 -->
      <div class="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-950/70 backdrop-blur-sm" 
           @click="config.closeable && close()"></div>
      
      <!-- 内容 -->
       <div class="relative bg-white dark:bg-zinc-800 rounded-neo-lg shadow-neo-lift dark:shadow-neo-lift-dark p-6 max-w-lg w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto"
           x-transition:enter="transition ease-out duration-300"
           x-transition:enter-start="opacity-0 scale-95"
           x-transition:enter-end="opacity-100 scale-100"
         x-transition:leave="transition ease-in duration-200"
           x-transition:leave-start="opacity-100 scale-100"
           x-transition:leave-end="opacity-0 scale-95"
           @click.stop>
        
        <!-- 关闭按钮 -->
        <button x-show="config.closeable"
                @click="close()" 
                class="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        <!-- 图标和标题 -->
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full flex items-center justify-center"
               :class="getIconBgClass(config.type)">
            <span x-html="getIcon(config.type)"></span>
          </div>
           <h2 class="text-xl font-bold text-zinc-900 dark:text-zinc-100" x-text="config.title"></h2>
        </div>
        
        <!-- 消息内容 -->
        <p class="text-zinc-600 dark:text-zinc-300 mb-6" x-text="config.message"></p>
        
        <!-- 按钮组 -->
        <div class="flex justify-end gap-3">
           <button x-show="config.showCancel"
                   @click="cancel()"
                   class="bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 shadow-neo-lift dark:shadow-neo-lift-dark px-4 py-2.5 rounded-neo hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-100 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-brand-900/30 dark:focus-visible:ring-offset-zinc-800">
            <span x-text="config.cancelText"></span>
          </button>
           <button @click="confirm()"
                   class="text-white px-4 py-2.5 rounded-neo shadow-neo-lift dark:shadow-neo-lift-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-100 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-brand-900/30 dark:focus-visible:ring-offset-zinc-800"
                   :class="getConfirmBtnClass(config.type)">
            <span x-text="config.confirmText"></span>
          </button>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// 导出
// ============================================================

export default {
  modalComponent,
  registerModalComponent,
  initModalStore,
  getModalContainerHTML,
  showInfo,
  showWarning,
  showDanger,
  confirm,
  showRecovery,
};
