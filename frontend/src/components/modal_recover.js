/**
 * 草稿恢复弹窗组件
 * 
 * 提供检测和恢复 localStorage 中保存的草稿功能
 * 遵循 frontend_design.md 设计规范
 */

import Alpine from 'alpinejs';
import { confirm } from './modal.js';

// LocalStorage 键名
const DRAFT_KEY_PREFIX = 'arcamage_draft_';
const DRAFT_META_KEY = 'arcamage_draft_meta';
const DRAFT_IMAGE_DB = 'arcamage_draft_image_db';
const DRAFT_IMAGE_STORE = 'draft_images';

let draftImageDbPromise = null;

function canUseIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function openDraftImageDb() {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null);
  }

  if (!draftImageDbPromise) {
    draftImageDbPromise = new Promise((resolve) => {
      const request = indexedDB.open(DRAFT_IMAGE_DB, 1);

      request.onupgradeneeded = (event) => {
        const db = event.target?.result;
        if (!db.objectStoreNames.contains(DRAFT_IMAGE_STORE)) {
          db.createObjectStore(DRAFT_IMAGE_STORE, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = (event) => {
        console.warn('Failed to open draft image DB:', event?.target?.error || request.error);
        resolve(null);
      };
    });
  }

  return draftImageDbPromise;
}

export async function saveDraftImage(id, imageDataUrl) {
  if (!id) return false;

  const db = await openDraftImageDb();
  if (!db) return false;

  return await new Promise((resolve) => {
    const tx = db.transaction(DRAFT_IMAGE_STORE, 'readwrite');
    const store = tx.objectStore(DRAFT_IMAGE_STORE);

    tx.oncomplete = () => resolve(true);
    tx.onerror = (event) => {
      console.warn('Failed to save draft image:', event?.target?.error || tx.error);
      resolve(false);
    };
    tx.onabort = (event) => {
      console.warn('Draft image save aborted:', event?.target?.error || tx.error);
      resolve(false);
    };

    if (!imageDataUrl) {
      store.delete(id);
      return;
    }

    store.put({
      id,
      imageDataUrl,
      updatedAt: Date.now(),
    });
  });
}

export async function loadDraftImage(id) {
  if (!id) return null;

  const db = await openDraftImageDb();
  if (!db) return null;

  return await new Promise((resolve) => {
    const tx = db.transaction(DRAFT_IMAGE_STORE, 'readonly');
    const request = tx.objectStore(DRAFT_IMAGE_STORE).get(id);

    request.onsuccess = () => {
      resolve(request.result?.imageDataUrl || null);
    };

    request.onerror = (event) => {
      console.warn('Failed to load draft image:', event?.target?.error || request.error);
      resolve(null);
    };
  });
}

/**
 * 草稿元数据结构
 * @typedef {Object} DraftMeta
 * @property {string} id - 草稿 ID
 * @property {string} name - 卡片名称
 * @property {number} timestamp - 保存时间戳
 * @property {string} preview - 预览文本
 */

/**
 * 保存草稿
 * @param {Object} cardData - 卡片数据
 * @param {Object} options - 配置选项
 * @param {string} options.id - 草稿 ID (可选，默认使用当前时间)
 * @param {string} options.imageDataUrl - 图片数据 URL (可选)
 */
export function saveDraft(cardData, options = {}) {
  if (!cardData) return;
  
  const id = options.id || `draft_${Date.now()}`;
  const name = cardData?.data?.name || '未命名角色';
  const timestamp = Date.now();
  const preview = getPreviewText(cardData);
  
  try {
    // 保存草稿数据
    const draftData = {
      card: cardData,
      imageDataUrl: options.imageDataUrl || null,
    };
    localStorage.setItem(DRAFT_KEY_PREFIX + id, JSON.stringify(draftData));
    
    // 更新元数据
    const meta = getDraftMeta();
    meta[id] = { id, name, timestamp, preview };
    localStorage.setItem(DRAFT_META_KEY, JSON.stringify(meta));
    
    return id;
  } catch (e) {
    console.warn('Failed to save draft:', e);
    return null;
  }
}

/**
 * 获取预览文本
 * @param {Object} cardData - 卡片数据
 * @returns {string} 预览文本
 */
function getPreviewText(cardData) {
  const description = cardData?.data?.description || '';
  if (description.length > 100) {
    return description.substring(0, 100) + '...';
  }
  return description || '无描述';
}

/**
 * 获取草稿元数据
 * @returns {Object} 草稿元数据对象
 */
export function getDraftMeta() {
  try {
    const saved = localStorage.getItem(DRAFT_META_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

/**
 * 获取所有草稿列表
 * @returns {Array<DraftMeta>} 草稿列表，按时间降序
 */
export function listDrafts() {
  const meta = getDraftMeta();
  return Object.values(meta).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * 获取最新草稿
 * @returns {DraftMeta|null} 最新草稿元数据
 */
export function getLatestDraft() {
  const drafts = listDrafts();
  return drafts.length > 0 ? drafts[0] : null;
}

/**
 * 加载草稿数据
 * @param {string} id - 草稿 ID
 * @returns {Object|null} 草稿数据 { card, imageDataUrl }
 */
export async function loadDraft(id) {
  try {
    const saved = localStorage.getItem(DRAFT_KEY_PREFIX + id);
    if (!saved) return null;

    const parsed = JSON.parse(saved);
    if (parsed?.imageDataUrl) {
      return parsed;
    }

    const imageDataUrl = await loadDraftImage(id);
    return {
      ...parsed,
      imageDataUrl: imageDataUrl || null,
    };
  } catch (e) {
    console.warn('Failed to load draft:', e);
    return null;
  }
}

/**
 * 删除草稿
 * @param {string} id - 草稿 ID
 */
export function deleteDraft(id) {
  try {
    localStorage.removeItem(DRAFT_KEY_PREFIX + id);
    
    const meta = getDraftMeta();
    delete meta[id];
    localStorage.setItem(DRAFT_META_KEY, JSON.stringify(meta));

    if (canUseIndexedDb()) {
      void saveDraftImage(id, null);
    }
  } catch (e) {
    console.warn('Failed to delete draft:', e);
  }
}

/**
 * 清除所有草稿
 */
export function clearAllDrafts() {
  try {
    const meta = getDraftMeta();
    for (const id of Object.keys(meta)) {
      localStorage.removeItem(DRAFT_KEY_PREFIX + id);
    }
    localStorage.removeItem(DRAFT_META_KEY);

    if (canUseIndexedDb()) {
      void (async () => {
        const db = await openDraftImageDb();
        if (!db) return;

        await new Promise((resolve) => {
          const tx = db.transaction(DRAFT_IMAGE_STORE, 'readwrite');
          tx.objectStore(DRAFT_IMAGE_STORE).clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = (event) => {
            console.warn('Failed to clear draft images:', event?.target?.error || tx.error);
            resolve(false);
          };
          tx.onabort = (event) => {
            console.warn('Draft image clear aborted:', event?.target?.error || tx.error);
            resolve(false);
          };
        });
      })();
    }
  } catch (e) {
    console.warn('Failed to clear drafts:', e);
  }
}

/**
 * 检查是否有草稿
 * @returns {boolean} 是否有草稿
 */
export function hasDraft() {
  return listDrafts().length > 0;
}

/**
 * 格式化时间戳为可读字符串
 * @param {number} timestamp - 时间戳
 * @returns {string} 格式化后的时间字符串
 */
export function formatDraftTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  // 小于 1 分钟
  if (diff < 60 * 1000) {
    return '刚刚';
  }
  
  // 小于 1 小时
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes} 分钟前`;
  }
  
  // 小于 24 小时
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours} 小时前`;
  }
  
  // 超过 24 小时
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  
  return `${month}/${day} ${hour}:${minute}`;
}

/**
 * 显示恢复草稿弹窗 (使用现有 modal)
 * @param {DraftMeta} draft - 草稿元数据
 * @returns {Promise<boolean>} 用户选择恢复返回 true
 */
export async function showRecoverModal(draft) {
  if (!draft) return false;
  
  const timeStr = formatDraftTime(draft.timestamp);
  const message = `检测到 ${timeStr} 保存的草稿「${draft.name}」，是否恢复？`;
  
  return await confirm('发现未保存的草稿', message, {
    type: 'recovery',
    confirmText: '恢复',
    cancelText: '丢弃',
  });
}

/**
 * 自动检查并提示恢复草稿
 * @param {Object} options - 配置选项
 * @param {Function} options.onRecover - 恢复回调，接收 { card, imageDataUrl }
 * @param {Function} options.onDiscard - 丢弃回调
 * @returns {Promise<boolean>} 是否恢复了草稿
 */
export async function autoCheckDraft(options = {}) {
  const { onRecover, onDiscard } = options;
  
  const latestDraft = getLatestDraft();
  if (!latestDraft) return false;
  
  const shouldRecover = await showRecoverModal(latestDraft);
  
  if (shouldRecover) {
    const draftData = await loadDraft(latestDraft.id);
    if (draftData && onRecover) {
      onRecover(draftData);
      deleteDraft(latestDraft.id);
      return true;
    }
  } else {
    deleteDraft(latestDraft.id);
    if (onDiscard) {
      onDiscard();
    }
  }
  
  return false;
}

/**
 * 草稿管理组件
 * 使用方式: <div x-data="draftManager()">...</div>
 */
export function draftManagerComponent() {
  return {
    drafts: [],
    
    init() {
      this.refresh();
    },
    
    refresh() {
      this.drafts = listDrafts();
    },
    
    formatTime(timestamp) {
      return formatDraftTime(timestamp);
    },
    
    async recoverDraft(draft) {
      const draftData = await loadDraft(draft.id);
      if (draftData) {
        // 触发恢复事件
        this.$dispatch('draft-recover', draftData);
      }
    },
    
    async deleteDraft(draft) {
      const confirmed = await confirm('删除草稿', `确定要删除「${draft.name}」吗？此操作不可撤销。`, {
        type: 'danger',
        confirmText: '删除',
      });
      
      if (confirmed) {
        deleteDraft(draft.id);
        this.refresh();
        Alpine.store('toast').success('草稿已删除');
      }
    },
    
    async clearAll() {
      if (this.drafts.length === 0) return;
      
      const confirmed = await confirm('清除所有草稿', `确定要清除全部 ${this.drafts.length} 个草稿吗？此操作不可撤销。`, {
        type: 'danger',
        confirmText: '全部清除',
      });
      
      if (confirmed) {
        clearAllDrafts();
        this.refresh();
        Alpine.store('toast').success('已清除所有草稿');
      }
    },
  };
}

/**
 * 注册草稿管理组件
 */
export function registerDraftManagerComponent() {
  Alpine.data('draftManager', draftManagerComponent);
}

// ============================================================
// 导出
// ============================================================

export default {
  saveDraft,
  saveDraftImage,
  loadDraft,
  loadDraftImage,
  deleteDraft,
  clearAllDrafts,
  listDrafts,
  getLatestDraft,
  hasDraft,
  getDraftMeta,
  formatDraftTime,
  showRecoverModal,
  autoCheckDraft,
  draftManagerComponent,
  registerDraftManagerComponent,
};
