/**
 * 首页页面组件
 * 
 * Arcamage 的主入口，提供三种核心工作流：
 * 1. 上传现有卡片 (Left)
 * 2. 创建新卡 (Center)
 * 3. 导入与工具 (Right)
 */

import Alpine from 'alpinejs';
import { parseCard, ApiError } from '../api.js';
import { autoCheckDraft } from '../components/modal_recover.js';

/**
 * 首页组件
 */
export function homePage() {
  return {
    // 拖拽状态
    dragging: false,
    
    // 忙碌状态
    isProcessing: false,

    // 初始化
    async init() {
      // 检查草稿恢复
      await this.checkDraftRecovery();
    },
    
    // 检查草稿恢复
    async checkDraftRecovery() {
      try {
        await autoCheckDraft({
          onRecover: (draftData) => {
            if (draftData.card) {
              // 加载草稿到 Store
              const cardStore = Alpine.store('card');
              cardStore.loadCard({ card: draftData.card }, null, draftData.imageDataUrl);
              Alpine.store('history').init(cardStore.data);
              Alpine.store('toast').success('草稿已恢复');
              
              // 跳转到工作台
              Alpine.store('ui').currentPage = 'workshop';
            }
          },
          onDiscard: () => {
            Alpine.store('toast').info('草稿已丢弃');
          },
        });
      } catch (e) {
        console.warn('Draft recovery check failed:', e);
      }
    },

    // ============================================================
    // 左侧：上传处理
    // ============================================================

    handleDragOver(event) {
      event.preventDefault();
      this.dragging = true;
    },

    handleDragLeave(event) {
      event.preventDefault();
      this.dragging = false;
    },

    async handleDrop(event) {
      event.preventDefault();
      this.dragging = false;
      
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        await this.processFile(file);
      }
    },

    async handleFileSelect(event) {
      const file = event.target.files?.[0];
      if (file) {
        await this.processFile(file);
      }
      // 重置 input 以便再次选择同一文件
      event.target.value = '';
    },

    async processFile(file) {
      if (this.isProcessing) return;
      
      const ext = file.name.split('.').pop()?.toLowerCase();
      const validExts = ['png', 'json'];
      const validMimes = ['image/png', 'application/json'];
      const isValid = validExts.includes(ext) || validMimes.includes(file.type);
      
      if (!isValid) {
        Alpine.store('toast').error('不支持的文件格式，请上传 PNG 或 JSON 文件');
        return;
      }
      
      this.isProcessing = true;
      const toastId = Alpine.store('toast').loading('正在解析文件...');
      
      try {
        const result = await parseCard(file);
        
        let imageDataUrl = null;
        if (file.type.startsWith('image/')) {
          imageDataUrl = await this.readAsDataURL(file);
        }
        
        // 加载到 Store
        const cardStore = Alpine.store('card');
        cardStore.loadCard(result, file, imageDataUrl);
        Alpine.store('history').init(cardStore.data);
        
        Alpine.store('toast').dismiss(toastId);
        Alpine.store('toast').success(`已加载: ${result.card?.data?.name || '角色卡'}`);
        
        // 跳转到工作台
        Alpine.store('ui').currentPage = 'workshop';
        
      } catch (error) {
        Alpine.store('toast').dismiss(toastId);
        
        if (error instanceof ApiError) {
          Alpine.store('toast').error(error.getUserMessage());
        } else {
          console.error('Parse error:', error);
          Alpine.store('toast').error('解析失败: ' + (error.message || '未知错误'));
        }
      } finally {
        this.isProcessing = false;
      }
    },

    readAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },

    // ============================================================
    // 中间：新建
    // ============================================================

    // 创建新卡片
    createNew() {
      const cardStore = Alpine.store('card');
      cardStore.initNew();
      Alpine.store('history').init(cardStore.data);
      Alpine.store('toast').info('已创建新角色卡');
      Alpine.store('ui').currentPage = 'workshop';
    },

    // ============================================================
    // 右侧：工具与导入
    // ============================================================

    // 打开 Arcaferry 导入
    openFerryImport() {
      Alpine.store('modalStack').push({
        type: 'ferry',
        title: 'Arcaferry 导入',
        size: 'xl',
        closeable: true,
        showFooter: false,
      });
    }
  };
}

/**
 * 注册首页组件
 */
export function registerHomePageComponent() {
  Alpine.data('homePage', homePage);
}

export default {
  homePage,
  registerHomePageComponent,
};
