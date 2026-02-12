/**
 * Arcamage 前端入口
 * 
 * 初始化 Alpine.js、全局状态、组件
 */

import Alpine from 'alpinejs';
import collapse from '@alpinejs/collapse';
import { OverlayScrollbars } from 'overlayscrollbars';
import 'overlayscrollbars/overlayscrollbars.css';

// 样式
import './styles/tailwind.css';

// 模块
import { initStores } from './store.js';
import { registerToastComponent, getToastContainerHTML } from './components/toast.js';
import { registerModalComponent, getModalContainerHTML } from './components/modal.js';
import { registerTagsInputComponent } from './components/tags_input.js';
import { registerUndoRedoComponent } from './components/undo_redo.js';
import { registerArrayEditorComponent } from './components/array_editor.js';
import { registerJsonEditorComponent } from './components/extensions_editor.js';
import { registerAssetsEditorComponent } from './components/assets_editor.js';
import { registerWorkshopComponents } from './pages/workshop.js';

// P2 辅助组件
import { registerSkeletonComponent } from './components/skeleton.js';
import { registerLoadingOverlayComponent, getLoadingOverlayHTML } from './components/loading_overlay.js';
import { registerEmptyStateComponent } from './components/empty_state.js';
import { registerDraftManagerComponent } from './components/modal_recover.js';
import { registerContentScannerComponent } from './components/modal_sanitize.js';

// P2 增强功能组件
import { registerAutoSaveComponent } from './components/auto_save.js';
import { registerTokenBadgeComponents } from './components/token_badge.js';
import { registerTextCleanerComponent } from './components/text_cleaner.js';
import { registerPreviewComponents, generateGreetingPreviewHTML } from './components/preview_panel.js';
import { registerAgentSidebarComponent } from './components/agent_sidebar.js';
import { registerGreetingSidebarComponent } from './components/greeting_sidebar.js';
import { registerAgentModalComponent, getAgentModalHTML } from './components/agent_modal.js';

// P2 世界书组件
import { registerLorebookEditorComponent } from './components/lorebook_editor.js';


// P6 首页
import { registerHomePageComponent } from './pages/home.js';

// P5 增强 Modal 系统 (前端重构)
import { registerModalStackStore } from './stores/modal_stack.js';
import { registerModalEnhancedComponent, getModalEnhancedHTML } from './components/modal_enhanced.js';
import { registerTextFieldModalComponent } from './components/field_editors/text_field_modal.js';
import { registerArrayFieldModalComponent } from './components/field_editors/array_field_modal.js';
import { registerTagsFieldModalComponent } from './components/field_editors/tags_field_modal.js';
import { registerSettingsModalComponent } from './components/settings_modal.js';
import { registerFerryModalComponent, getFerryModalHTML } from './components/ferry_modal.js';
import { registerFerryBatchComponent } from './components/ferry_batch.js';
import { registerFerryStagingComponent } from './components/ferry_staging.js';

// ============================================================
// Alpine.js 初始化
// ============================================================

// 注册 Alpine 插件
Alpine.plugin(collapse);

// 初始化全局状态
initStores();

// 注册核心组件
registerToastComponent();
registerModalComponent();
registerTagsInputComponent();
registerUndoRedoComponent();
registerArrayEditorComponent();
registerJsonEditorComponent();
registerAssetsEditorComponent();
registerWorkshopComponents();

// 注册辅助组件
registerSkeletonComponent();
registerLoadingOverlayComponent();
registerEmptyStateComponent();
registerDraftManagerComponent();
registerContentScannerComponent();

// 注册增强功能组件
registerAutoSaveComponent();
registerTokenBadgeComponents();
registerTextCleanerComponent();
registerPreviewComponents();
registerAgentSidebarComponent();
registerGreetingSidebarComponent();
registerAgentModalComponent();

// 注册世界书组件
registerLorebookEditorComponent();


// 注册首页组件
registerHomePageComponent();

// 注册增强 Modal 系统
registerModalStackStore();
registerModalEnhancedComponent();
registerTextFieldModalComponent();
registerArrayFieldModalComponent();
registerTagsFieldModalComponent();
registerSettingsModalComponent();
registerFerryModalComponent();
registerFerryBatchComponent();
registerFerryStagingComponent();

// 暴露到全局 (方便调试)
window.Alpine = Alpine;
window.getModalEnhancedHTML = getModalEnhancedHTML;
window.getFerryModalHTML = getFerryModalHTML;
window.getToastContainerHTML = getToastContainerHTML;
window.getLoadingOverlayHTML = getLoadingOverlayHTML;
window.getModalContainerHTML = getModalContainerHTML;
window.generateGreetingPreviewHTML = generateGreetingPreviewHTML;
window.getAgentModalHTML = getAgentModalHTML;

const agentModalHost = document.getElementById('agent-modal-host');
if (agentModalHost) {
  agentModalHost.innerHTML = getAgentModalHTML();
}

// 启动 Alpine
Alpine.start();

// ============================================================
// 应用初始化
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  Alpine.store('settings').load();
  Alpine.store('suppliers').load();
  Alpine.store('ferry').load();
  
  // 初始化 OverlayScrollbars (全局 body)
  OverlayScrollbars(document.body, {
    scrollbars: {
      autoHide: 'leave',
      autoHideDelay: 400,
      theme: 'os-theme-dark',
    },
    overflow: {
      x: 'hidden',
    },
  });
  
  // 标记应用就绪
  Alpine.store('app').ready = true;
  
  console.log('Arcamage v' + Alpine.store('app').version + ' initialized');
});

// ============================================================
// 全局键盘快捷键
// ============================================================

document.addEventListener('keydown', (e) => {
  // 排除输入框焦点，让浏览器处理原生 Undo/Redo
  if (e.target.matches('input, textarea, [contenteditable]')) {
    return;
  }
  
  // Ctrl/Cmd + Z: 撤销
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    const history = Alpine.store('history');
    const card = Alpine.store('card');
    
    if (history.canUndo && card.data) {
      const previous = history.undo();
      if (previous) {
        card.data = previous;
        card.checkChanges();
        Alpine.store('toast').info('已撤销');
      }
    }
  }
  
  // Ctrl/Cmd + Shift + Z 或 Ctrl + Y: 重做
  if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') ||
      ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
    e.preventDefault();
    const history = Alpine.store('history');
    const card = Alpine.store('card');
    
    if (history.canRedo && card.data) {
      const next = history.redo();
      if (next) {
        card.data = next;
        card.checkChanges();
        Alpine.store('toast').info('已重做');
      }
    }
  }
  
  // Ctrl/Cmd + S: 触发导出 PNG
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    const card = Alpine.store('card');
    if (card && card.data) {
      const exportBtn = document.querySelector('[data-export-png]');
      if (exportBtn) {
        exportBtn.click();
      } else {
        Alpine.store('toast').info('请先上传卡片后再导出');
      }
    } else {
      Alpine.store('toast').info('请先上传卡片');
    }
  }
});

// ============================================================
// 全局错误处理
// ============================================================

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  
  // 显示用户友好的错误提示
  if (event.reason?.getUserMessage) {
    Alpine.store('toast').error(event.reason.getUserMessage());
  } else {
    Alpine.store('toast').error('发生未知错误');
  }
});

// ============================================================
// 导出工具函数供页面使用
// ============================================================

export { parseCard, injectCard, validateCard, exportLorebook, importLorebook, ApiError } from './api.js';
export { showToast, showSuccess, showError, showLoading, dismissToast } from './components/toast.js';
export { showInfo, showWarning, showDanger, confirm, showRecovery } from './components/modal.js';
export { deepClone, deepEqual, getByPath, setByPath, createEmptyCard } from './store.js';
export { recordState } from './components/undo_redo.js';

// P2 辅助组件导出
export { 
  getTextSkeletonHTML, 
  getCardSkeletonHTML, 
  getListSkeletonHTML, 
  getFormSkeletonHTML,
  getEditorSectionSkeletonHTML,
  getImageSkeletonHTML,
  getLorebookSkeletonHTML,
} from './components/skeleton.js';
export { 
  showLoading as showGlobalLoading, 
  hideLoading, 
  setProgress, 
  withLoading, 
  withProgress,
} from './components/loading_overlay.js';
export { 
  getEmptyStateHTML, 
  getDropZoneEmptyHTML, 
  getInlineEmptyHTML,
} from './components/empty_state.js';
export { 
  saveDraft, 
  loadDraft, 
  deleteDraft, 
  listDrafts, 
  getLatestDraft, 
  hasDraft,
  autoCheckDraft,
} from './components/modal_recover.js';
export {
  scanContent,
  scanCard,
  scanAndConfirm,
  getSeverityBadgeHTML,
} from './components/modal_sanitize.js';

// P2 增强功能导出
export { 
  startAutoSave, 
  stopAutoSave, 
  saveNow, 
  clearDraft as clearAutoSaveDraft,
  checkPendingDraft,
} from './components/auto_save.js';
export { 
  estimateTokens, 
  estimateCardTokens, 
  getWarningLevel,
  generateTokenBadgeHTML,
} from './components/token_badge.js';
export { 
  cleanText, 
  cleanCardFields, 
  detectDirtyContent,
  fullwidthToHalfwidth,
  removeZeroWidth,
  SAFE_FIELDS,
  SENSITIVE_FIELDS,
} from './components/text_cleaner.js';
export { 
  sanitizeHTML, 
  renderMarkdown, 
  renderContent,
  generatePreviewPanelHTML,
  generateGreetingPreviewHTML,
} from './components/preview_panel.js';

// P2 世界书组件导出
export {
  lorebookEditor,
  registerLorebookEditorComponent,
  createEmptyEntry,
} from './components/lorebook_editor.js';

// P6 首页导出
export { homePage } from './pages/home.js';
