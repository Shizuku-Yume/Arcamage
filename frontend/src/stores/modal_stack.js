/**
 * Modal Stack Store - 增强型模态框管理
 * 
 * 支持:
 * - 模态框堆叠 (列表 → 详情)
 * - 草稿模式 (Save/Cancel 控制)
 * - 键盘导航 (ESC 关闭, Tab 陷阱)
 * - 尺寸变体 (sm/md/lg/xl/full)
 */

import Alpine from 'alpinejs';
import { deepClone } from '../store.js';

// 生成唯一 ID
let modalIdCounter = 0;
function generateModalId() {
  return `modal_${Date.now()}_${++modalIdCounter}`;
}

/**
 * Modal 配置类型
 * @typedef {Object} ModalConfig
 * @property {string} id - 唯一标识
 * @property {string} type - 模态框类型 (text|array|lorebook|extensions|assets|settings|ai|custom)
 * @property {string} title - 标题
 * @property {string} [icon] - 图标 HTML
 * @property {string} size - 尺寸 (sm|md|lg|xl|full)
 * @property {Object} data - 传入的数据
 * @property {Object} draft - 草稿数据 (用于 Save/Cancel)
 * @property {boolean} dirty - 是否有未保存的更改
 * @property {Function} onSave - 保存回调
 * @property {Function} onCancel - 取消回调
 * @property {boolean} closeable - 是否可关闭
 * @property {boolean} showHeader - 是否显示头部
 * @property {boolean} showFooter - 是否显示底部
 * @property {Object} meta - 额外元数据
 */

/**
 * 初始化 Modal Stack Store
 */
export function initModalStackStore() {
  Alpine.store('modalStack', {
    // 模态框堆栈
    stack: [],

    // body 样式快照（用于正确恢复）
    _prevHtmlOverflow: '',
    _prevBodyOverflow: '',
    _prevBodyPosition: '',
    _prevBodyTop: '',
    _prevBodyLeft: '',
    _prevBodyRight: '',
    _prevBodyWidth: '',
    _prevBodyPaddingRight: '',
    _lockedScrollY: 0,
    _scrollLockApplied: false,
    
    // 是否正在过渡动画中
    transitioning: false,
    
    /**
     * 推入新模态框
     * @param {Partial<ModalConfig>} config - 模态框配置
     * @returns {string} 模态框 ID
     */
    push(config) {
      const id = config.id || generateModalId();
      
      const modal = {
        id,
        type: config.type || 'custom',
        title: config.title || '',
        icon: config.icon || null,
        size: config.size || 'lg',
        data: config.data || {},
        draft: config.draft !== undefined ? config.draft : deepClone(config.data || {}),
        dirty: false,
        onSave: config.onSave || null,
        onCancel: config.onCancel || null,
        closeable: config.closeable !== false,
        showHeader: config.showHeader !== false,
        showFooter: config.showFooter !== false,
        meta: config.meta || {},
      };
      
      this.stack.push(modal);
      
      // NOTE:
      // 不在这里修改 body/html overflow 或 position。
      // 工作台左侧预览面板使用 sticky 定位，设置 body overflow/position
      // 会导致 sticky 锚点错乱并出现“打开 modal 后背景位置跳动”。
      // 背景交互由 modal 覆盖层本身接管。
      if (this.stack.length === 1) {
        this._prevBodyOverflow = document.body.style.overflow || '';
        this._prevHtmlOverflow = document.documentElement.style.overflow || '';
        this._prevBodyPosition = document.body.style.position || '';
        this._prevBodyTop = document.body.style.top || '';
        this._prevBodyLeft = document.body.style.left || '';
        this._prevBodyRight = document.body.style.right || '';
        this._prevBodyWidth = document.body.style.width || '';
        this._prevBodyPaddingRight = document.body.style.paddingRight || '';
        this._lockedScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
        this._scrollLockApplied = false;
      }
      
      return id;
    },
    
    /**
     * 弹出顶部模态框
     * @param {boolean} confirmed - 是否确认保存
     * @returns {ModalConfig|null} 被弹出的模态框
     */
    pop(confirmed = false) {
      if (this.stack.length === 0) return null;
      
      const modal = this.stack.pop();
      
      if (confirmed && modal.onSave) {
        modal.onSave(modal.draft);
      } else if (!confirmed && modal.onCancel) {
        modal.onCancel();
      }
      
      if (this.stack.length === 0) {
        const html = document.documentElement;
        const body = document.body;

        if (html && body) {
          body.style.overflow = this._prevBodyOverflow;
          body.style.paddingRight = this._prevBodyPaddingRight;
          html.style.overflow = this._prevHtmlOverflow;
          body.style.position = this._prevBodyPosition;
          body.style.top = this._prevBodyTop;
          body.style.left = this._prevBodyLeft;
          body.style.right = this._prevBodyRight;
          body.style.width = this._prevBodyWidth;

          if (this._scrollLockApplied) {
            window.scrollTo(0, this._lockedScrollY);
          }
        }

        this._prevHtmlOverflow = '';
        this._prevBodyOverflow = '';
        this._prevBodyPosition = '';
        this._prevBodyTop = '';
        this._prevBodyLeft = '';
        this._prevBodyRight = '';
        this._prevBodyWidth = '';
        this._prevBodyPaddingRight = '';
        this._lockedScrollY = 0;
        this._scrollLockApplied = false;
      }
      
      return modal;
    },
    
    /**
     * 替换顶部模态框
     * @param {Partial<ModalConfig>} config - 新配置
     * @returns {string} 新模态框 ID
     */
    replace(config) {
      if (this.stack.length > 0) {
        this.stack.pop();
      }
      return this.push(config);
    },
    
    /**
     * 关闭指定模态框及其上方所有模态框
     * @param {string} id - 目标模态框 ID
     * @param {boolean} confirmed - 是否确认保存
     */
    closeToId(id, confirmed = false) {
      const index = this.stack.findIndex(m => m.id === id);
      if (index === -1) return;
      
      // 从顶部依次弹出到目标
      while (this.stack.length > index) {
        this.pop(confirmed);
      }
    },
    
    /**
     * 关闭所有模态框
     * @param {boolean} confirmed - 是否确认保存
     */
    closeAll(confirmed = false) {
      while (this.stack.length > 0) {
        this.pop(confirmed);
      }
    },
    
    /**
     * 更新顶部模态框的草稿数据
     * @param {Object} data - 新的草稿数据
     */
    updateDraft(data) {
      if (this.stack.length === 0) return;
      
      const current = this.current;
      current.draft = data;
      current.dirty = true;
    },
    
    /**
     * 更新顶部模态框草稿的指定字段
     * @param {string} path - 字段路径
     * @param {any} value - 新值
     */
    updateDraftField(path, value) {
      if (this.stack.length === 0) return;
      
      const current = this.current;
      const keys = path.split('.');
      let target = current.draft;
      
      for (let i = 0; i < keys.length - 1; i++) {
        if (target[keys[i]] === undefined) {
          target[keys[i]] = {};
        }
        target = target[keys[i]];
      }
      
      target[keys[keys.length - 1]] = value;
      current.dirty = true;
    },
    
    /**
     * 重置草稿到原始数据
     */
    resetDraft() {
      if (this.stack.length === 0) return;
      
      const current = this.current;
      current.draft = deepClone(current.data);
      current.dirty = false;
    },
    
    /**
     * 保存并关闭当前模态框
     */
    saveAndClose() {
      this.pop(true);
    },
    
    /**
     * 取消并关闭当前模态框
     */
    cancelAndClose() {
      this.pop(false);
    },
    
    /**
     * 处理 ESC 键
     */
    handleEscape() {
      if (this.stack.length === 0) return;
      
      const current = this.current;
      if (!current.closeable) return;
      
      // 如果有未保存的更改，可以在这里添加确认逻辑
      if (current.dirty) {
        // 暂时直接关闭，后续可以添加确认弹窗
        this.cancelAndClose();
      } else {
        this.cancelAndClose();
      }
    },
    
    /**
     * 获取当前模态框
     * @returns {ModalConfig|null}
     */
    get current() {
      return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
    },
    
    /**
     * 获取堆栈深度
     * @returns {number}
     */
    get depth() {
      return this.stack.length;
    },
    
    /**
     * 是否有打开的模态框
     * @returns {boolean}
     */
    get isOpen() {
      return this.stack.length > 0;
    },
    
    /**
     * 获取模态框通过 ID
     * @param {string} id
     * @returns {ModalConfig|null}
     */
    getById(id) {
      return this.stack.find(m => m.id === id) || null;
    },
  });
}

/**
 * 便捷方法：打开文本编辑模态框
 */
export function openTextEditor(options) {
  return Alpine.store('modalStack').push({
    type: 'text',
    title: options.title || '编辑文本',
    size: options.size || 'xl',
    data: { value: options.value || '', fieldPath: options.fieldPath },
    onSave: options.onSave,
    onCancel: options.onCancel,
    meta: {
      placeholder: options.placeholder || '',
      rows: options.rows || 10,
      enablePreview: options.enablePreview || false,
    },
  });
}

/**
 * 便捷方法：打开数组编辑模态框
 */
export function openArrayEditor(options) {
  return Alpine.store('modalStack').push({
    type: 'array',
    title: options.title || '编辑列表',
    size: options.size || 'xl',
    data: { items: options.items || [], fieldPath: options.fieldPath },
    onSave: options.onSave,
    onCancel: options.onCancel,
    meta: {
      itemLabel: options.itemLabel || '项目',
      addLabel: options.addLabel || '添加',
      enableReorder: options.enableReorder !== false,
    },
  });
}

/**
 * 便捷方法：打开标签编辑模态框
 */
export function openTagsEditor(options) {
  return Alpine.store('modalStack').push({
    type: 'tags',
    title: options.title || '编辑标签',
    size: 'md',
    data: { items: options.items || [], fieldPath: options.fieldPath },
    onSave: options.onSave,
    onCancel: options.onCancel,
  });
}

/**
 * 便捷方法：打开世界书编辑模态框
 */
export function openLorebookEditor(options) {
  return Alpine.store('modalStack').push({
    type: 'lorebook',
    title: options.title || '世界书',
    size: 'full',
    data: { lorebook: options.lorebook },
    onSave: options.onSave,
    onCancel: options.onCancel,
  });
}

/**
 * 便捷方法：打开设置模态框
 */
export function openSettings() {
  return Alpine.store('modalStack').push({
    type: 'settings',
    title: '设置',
    size: 'xl',
    data: {},
    closeable: true,
  });
}

/**
 * 注册 Modal Stack Store
 */
export function registerModalStackStore() {
  initModalStackStore();
}

export default {
  initModalStackStore,
  registerModalStackStore,
  openTextEditor,
  openArrayEditor,
  openTagsEditor,
  openLorebookEditor,
  openSettings,
};
