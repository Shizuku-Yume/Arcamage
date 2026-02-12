/**
 * 自动保存组件
 * 
 * 提供 30 秒定时自动保存到 LocalStorage 的功能
 * 遵循 IMPLEMENTATION_PLAN P2-2 规范
 */

import Alpine from 'alpinejs';
import { saveDraft, saveDraftImage, deleteDraft, getLatestDraft } from './modal_recover.js';

const DRAFT_ID = 'current_editing';

let autoSaveTimer = null;
let lastSaveTime = 0;
let autoSaveInFlight = false;

/**
 * 启动自动保存
 * @param {Object} options - 配置选项
 * @param {Function} options.getData - 获取卡片数据的函数
 * @param {Function} options.getImageDataUrl - 获取图片 DataURL 的函数
 * @param {Function} options.onSave - 保存成功回调
 * @param {number} options.interval - 保存间隔 (秒), 默认 30
 */
export function startAutoSave(options = {}) {
  const {
    getData,
    getImageDataUrl,
    onSave,
    onError,
    interval = 30,
  } = options;
  
  stopAutoSave();
  const intervalMs = Math.max(5, Number(interval) || 30) * 1000;

  const saveTick = async () => {
    if (autoSaveInFlight) return;
    autoSaveInFlight = true;

    try {
      const settings = Alpine.store('settings');
      if (!settings?.autoSaveEnabled) return;

      const cardData = getData?.();
      if (!cardData) return;

      const cardStore = Alpine.store('card');
      if (!cardStore?.hasChanges) return;

      const lastChangedAt = cardStore?.lastChangedAt || 0;
      if (lastChangedAt > 0 && lastChangedAt <= lastSaveTime) return;

      const imageDataUrl = getImageDataUrl?.() || null;
      const id = saveDraft(cardData, {
        id: DRAFT_ID,
        imageDataUrl: null,
      });

      if (!id) {
        onError?.({ reason: 'save_failed' });
        return;
      }

      let imageIncluded = true;
      if (imageDataUrl) {
        imageIncluded = await saveDraftImage(DRAFT_ID, imageDataUrl);
      } else {
        await saveDraftImage(DRAFT_ID, null);
      }

      lastSaveTime = Date.now();
      if (!imageIncluded) {
        onError?.({ reason: 'image_save_failed' });
      }
      onSave?.(lastSaveTime, { imageIncluded });
    } finally {
      autoSaveInFlight = false;
    }
  };
  
  autoSaveTimer = setInterval(() => {
    void saveTick();
  }, intervalMs);
}

/**
 * 停止自动保存
 */
export function stopAutoSave() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  }
  autoSaveInFlight = false;
}

/**
 * 立即保存草稿
 * @param {Object} cardData - 卡片数据
 * @param {string} imageDataUrl - 图片 DataURL
 * @returns {Promise<boolean>} 是否保存成功
 */
export async function saveDraftNow(cardData, imageDataUrl = null) {
  if (!cardData) return false;

  const id = saveDraft(cardData, {
    id: DRAFT_ID,
    imageDataUrl: null,
  });

  if (id) {
    if (imageDataUrl) {
      await saveDraftImage(DRAFT_ID, imageDataUrl);
    } else {
      await saveDraftImage(DRAFT_ID, null);
    }
    lastSaveTime = Date.now();
    return true;
  }

  return false;
}

/**
 * 清除草稿 (导出成功后调用)
 */
export function clearDraft() {
  deleteDraft(DRAFT_ID);
  lastSaveTime = 0;
}

/**
 * 检查是否有待恢复的草稿
 * @returns {Object|null} 草稿元数据
 */
export function checkPendingDraft() {
  return getLatestDraft();
}

/**
 * 获取上次保存时间
 * @returns {number} 时间戳
 */
export function getLastSaveTime() {
  return lastSaveTime;
}

/**
 * 自动保存 Alpine 组件
 * 可在工作台中使用
 */
export function autoSaveComponent() {
  return {
    autoSaveStatus: '',
    lastSaveTime: 0,
    
    init() {
      const cardStore = Alpine.store('card');
      const settings = Alpine.store('settings');
      
      startAutoSave({
        getData: () => cardStore.data,
        getImageDataUrl: () => cardStore.imageDataUrl,
        onSave: (time) => {
          this.lastSaveTime = time;
          this.autoSaveStatus = '已自动保存';
          setTimeout(() => {
            this.autoSaveStatus = '';
          }, 2000);
        },
        interval: settings?.autoSaveInterval || 30,
      });
      
      this.$watch('$store.settings.autoSaveEnabled', (enabled) => {
        if (!enabled) {
          this.autoSaveStatus = '自动保存已禁用';
        } else {
          this.autoSaveStatus = '';
        }
      });
    },
    
    destroy() {
      stopAutoSave();
    },
    
    async saveNow() {
      const cardStore = Alpine.store('card');
      const success = await saveDraftNow(cardStore.data, cardStore.imageDataUrl);
      if (success) {
        this.lastSaveTime = Date.now();
        Alpine.store('toast').success('已保存草稿');
      }
    },
    
    formatTime(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      return date.toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    },
  };
}

/**
 * 注册自动保存组件
 */
export function registerAutoSaveComponent() {
  Alpine.data('autoSave', autoSaveComponent);
}

export const saveNow = saveDraftNow;

export default {
  startAutoSave,
  stopAutoSave,
  saveNow,
  clearDraft,
  checkPendingDraft,
  getLastSaveTime,
  autoSaveComponent,
  registerAutoSaveComponent,
};
