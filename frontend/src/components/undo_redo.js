/**
 * 撤销/重做组件 (Undo/Redo)
 * 
 * 提供 10 步历史记录的撤销重做功能
 * 遵循 frontend_design.md §5.14 设计规范
 * 采用单栈+指针方案
 */

import Alpine from 'alpinejs';
import { deepClone } from '../store.js';

/**
 * Undo/Redo 工具栏组件
 */
export function undoRedoToolbar() {
  return {
    get history() {
      return Alpine.store('history');
    },
    
    get canUndo() {
      return this.history.canUndo;
    },
    
    get canRedo() {
      return this.history.canRedo;
    },
    
    get currentIndex() {
      return this.history.index;
    },
    
    get stackLength() {
      return this.history.stack.length;
    },
    
    undo() {
      if (!this.canUndo) return;
      
      const state = this.history.undo();
      if (state) {
        Alpine.store('card').data = state;
        Alpine.store('card').checkChanges();
        Alpine.store('toast').info('已撤销');
      }
    },
    
    redo() {
      if (!this.canRedo) return;
      
      const state = this.history.redo();
      if (state) {
        Alpine.store('card').data = state;
        Alpine.store('card').checkChanges();
        Alpine.store('toast').info('已重做');
      }
    },
  };
}

/**
 * 增强的历史记录 Store
 * 采用单栈+指针方案，而非双栈
 */
export function initHistoryStore() {
  Alpine.store('history', {
    stack: [],
    index: -1,
    maxSize: 10,
    
    /**
     * 记录新状态
     * @param {Object} state - 要记录的状态
     */
    push(state) {
      // 如果当前不在栈顶，裁剪掉指针后面的状态
      if (this.index < this.stack.length - 1) {
        this.stack = this.stack.slice(0, this.index + 1);
      }
      
      // 添加新状态
      this.stack.push(deepClone(state));
      this.index = this.stack.length - 1;
      
      // 限制栈大小
      if (this.stack.length > this.maxSize) {
        this.stack.shift();
        this.index--;
      }
    },
    
    /**
     * 撤销操作
     * @returns {Object|null} 撤销后的状态
     */
    undo() {
      if (!this.canUndo) return null;
      
      this.index--;
      return deepClone(this.stack[this.index]);
    },
    
    /**
     * 重做操作
     * @returns {Object|null} 重做后的状态
     */
    redo() {
      if (!this.canRedo) return null;
      
      this.index++;
      return deepClone(this.stack[this.index]);
    },
    
    /**
     * 清空历史
     */
    clear() {
      this.stack = [];
      this.index = -1;
    },
    
    /**
     * 初始化（保存当前状态作为初始状态）
     * @param {Object} initialState - 初始状态
     */
    init(initialState) {
      this.clear();
      this.push(initialState);
    },
    
    /**
     * 是否可以撤销
     */
    get canUndo() {
      return this.index > 0;
    },
    
    /**
     * 是否可以重做
     */
    get canRedo() {
      return this.index < this.stack.length - 1;
    },
  });
}

/**
 * 注册 Undo/Redo 组件
 */
export function registerUndoRedoComponent() {
  Alpine.data('undoRedoToolbar', undoRedoToolbar);
}

/**
 * 便捷方法：记录当前状态到历史
 */
export function recordState() {
  const card = Alpine.store('card');
  if (card && card.data) {
    Alpine.store('history').push(card.data);
  }
}

/**
 * 生成 Undo/Redo 工具栏 HTML
 */
export function getUndoRedoToolbarHTML() {
  return `
    <div x-data="undoRedoToolbar()"
         class="inline-flex items-center gap-1 bg-white dark:bg-zinc-800 rounded-neo shadow-neo-lift dark:shadow-neo-lift-dark border border-zinc-100 dark:border-zinc-700 p-1">
      <!-- Undo 按钮 -->
      <button @click="undo()"
              :disabled="!canUndo"
              :class="canUndo ? 'hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700' : 'opacity-30 cursor-not-allowed'"
              class="p-1.5 rounded-neo text-zinc-400 dark:text-zinc-500 transition-colors"
              title="撤销 (Ctrl+Z)">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
        </svg>
      </button>
      
      <!-- Redo 按钮 -->
      <button @click="redo()"
              :disabled="!canRedo"
              :class="canRedo ? 'hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700' : 'opacity-30 cursor-not-allowed'"
              class="p-1.5 rounded-neo text-zinc-400 dark:text-zinc-500 transition-colors"
              title="重做 (Ctrl+Shift+Z)">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
        </svg>
      </button>
      
      <!-- 分隔线 -->
      <span class="w-px h-5 bg-zinc-200 dark:bg-zinc-600 mx-1"></span>
      
      <!-- 历史步数指示 -->
      <span class="text-xs text-zinc-400 dark:text-zinc-500 px-1 min-w-[32px] text-center"
            x-text="(currentIndex + 1) + '/' + stackLength"></span>
    </div>
  `;
}

// ============================================================
// 导出
// ============================================================

export default {
  undoRedoToolbar,
  initHistoryStore,
  registerUndoRedoComponent,
  recordState,
  getUndoRedoToolbarHTML,
};
