/**
 * 工作台页面组件
 * 
 * 提供卡片上传、编辑、导出的完整工作流
 * 集成 P2 增强功能: Auto-save、Token Badge、文本清洗、安全预览
 */

import Alpine from 'alpinejs';
import { parseCard, injectCard, ApiError } from '../api.js';
import { deepClone } from '../store.js';
import { startAutoSave, stopAutoSave, clearDraft } from '../components/auto_save.js';
import { estimateCardTokens, estimateTokens } from '../components/token_badge.js';
import { cleanCardFields, SAFE_FIELDS, detectDirtyContent } from '../components/text_cleaner.js';
import { confirm as confirmModal } from '../components/modal.js';

/**
 * 工作台主组件
 */
export function workshopPage() {
  return {
    // 拖拽状态
    dragging: false,
    
    // 当前展开的编辑区域
    activeSection: 'basic',
    
    // 忙碌锁
    isParsing: false,
    isExporting: false,
    
    // 自动保存状态
    lastAutoSave: 0,
    autoSaveError: '',
    lastAutoSaveHasImage: true,
    
    // Token 估算
    tokenInfo: {
      total: 0,
      breakdown: {},
    },
    
    // 预览状态
    previewVisible: false,
    previewContent: '',
    previewTitle: '',
    previewMarkdown: false,
    
    // 计算属性
    get card() {
      return Alpine.store('card');
    },
    
    get hasCard() {
      return this.card.data !== null;
    },
    
    get cardName() {
      return this.card.data?.data?.name || '未命名角色';
    },
    
    get settings() {
      return Alpine.store('settings');
    },

    get exportStatusText() {
      if (this.card.hasChanges) return '有修改';
      if (this.card.lastSaved) return '已导出';
      return '未导出';
    },

    get exportStatusClass() {
      if (this.card.hasChanges) {
        return 'text-warning dark:text-warning-light';
      }
      if (this.card.lastSaved) {
        return 'text-brand dark:text-brand-light';
      }
      return 'text-zinc-500 dark:text-zinc-400';
    },

    get autoSavePending() {
      if (!this.settings?.autoSaveEnabled) return false;
      if (!this.card?.data || !this.card.hasChanges) return false;
      return !this.lastAutoSave || (this.card.lastChangedAt || 0) > this.lastAutoSave;
    },

    get autoSaveStatusText() {
      if (!this.card?.data) return '';
      if (!this.settings?.autoSaveEnabled) return '自动草稿已关闭';
      if (this.autoSaveError) return this.autoSaveError;
      if (this.autoSavePending) return '草稿待自动保存';
      if (this.lastAutoSave && (this.card.lastChangedAt || 0) <= this.lastAutoSave) {
        return this.lastAutoSaveHasImage
          ? '草稿已自动保存（含图片）'
          : '草稿已自动保存（图片保存失败）';
      }
      return '';
    },

    get autoSaveStatusClass() {
      if (this.autoSaveError) {
        return 'text-danger dark:text-danger-light';
      }
      if (!this.settings?.autoSaveEnabled) {
        return 'text-zinc-400 dark:text-zinc-500';
      }
      if (this.autoSavePending) {
        return 'text-warning dark:text-warning-light';
      }
      if (this.lastAutoSave && (this.card.lastChangedAt || 0) <= this.lastAutoSave) {
        return this.lastAutoSaveHasImage
          ? 'text-brand dark:text-brand-light'
          : 'text-danger dark:text-danger-light';
      }
      return 'text-zinc-500 dark:text-zinc-400';
    },
    
    // Token Badge 样式类
    get tokenBadgeClass() {
      return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300';
    },
    
    // 初始化
    async init() {
      // 启动自动保存
      this.initAutoSave();

      this.$watch('$store.settings.autoSaveInterval', () => {
        this.initAutoSave();
      });

      this.$watch('$store.settings.autoSaveEnabled', (enabled) => {
        if (!enabled) {
          this.autoSaveError = '';
        }
      });
      
      // 监听卡片变化更新 Token
      this.$watch('$store.card.data', () => {
        this.updateTokenInfo();
      });
      
      // 初始化时也更新一次 Token 信息
      this.updateTokenInfo();
    },
    
    // 初始化自动保存
    initAutoSave() {
      startAutoSave({
        getData: () => this.card.data,
        getImageDataUrl: () => this.card.imageDataUrl,
        onSave: (time, meta = {}) => {
          this.lastAutoSave = time;
          this.lastAutoSaveHasImage = meta.imageIncluded !== false;
          this.autoSaveError = '';
        },
        onError: () => {
          this.autoSaveError = '草稿保存失败，请检查浏览器存储空间';
        },
        interval: this.settings?.autoSaveInterval || 30,
      });
    },
    
    // 更新 Token 信息
    updateTokenInfo() {
      if (!this.card.data) {
        this.tokenInfo = { total: 0, breakdown: {} };
        return;
      }
      
      const result = estimateCardTokens(this.card.data);
      this.tokenInfo = {
        total: result.total,
        breakdown: result.breakdown,
      };
    },
    
    // 文件上传处理
    async handleFileSelect(event) {
      const file = event.target.files?.[0];
      if (file) {
        await this.processFile(file);
      }
      event.target.value = '';
    },
    
    // 拖拽处理
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
    
    // 处理文件
    async processFile(file) {
      if (this.isParsing) return;
      
      const ext = file.name.split('.').pop()?.toLowerCase();
      const validExts = ['png', 'json'];
      const validMimes = ['image/png', 'application/json'];
      const isValid = validExts.includes(ext) || validMimes.includes(file.type);
      
      if (!isValid) {
        Alpine.store('toast').error('不支持的文件格式，请上传 PNG 或 JSON 文件');
        return;
      }
      
      this.isParsing = true;
      const toastId = Alpine.store('toast').loading('正在解析文件...');
      
      try {
        const result = await parseCard(file);
        
        let imageDataUrl = null;
        if (file.type.startsWith('image/')) {
          imageDataUrl = await this.readAsDataURL(file);
        }
        
        this.card.loadCard(result, file, imageDataUrl);
        this.lastAutoSave = 0;
        this.lastAutoSaveHasImage = true;
        this.autoSaveError = '';
        Alpine.store('history').init(this.card.data);
        
        // 更新 Token 信息
        this.updateTokenInfo();
        
        Alpine.store('toast').dismiss(toastId);
        Alpine.store('toast').success(`已加载: ${result.card?.data?.name || '角色卡'}`);
        
      } catch (error) {
        Alpine.store('toast').dismiss(toastId);
        
        if (error instanceof ApiError) {
          Alpine.store('toast').error(error.getUserMessage());
        } else {
          console.error('Parse error:', error);
          Alpine.store('toast').error('解析失败: ' + (error.message || '未知错误'));
        }
      } finally {
        this.isParsing = false;
      }
    },
    
    // 读取文件为 Data URL
    readAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },
    
    // 更换图片
    async handleImageChange(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      
      if (file.type !== 'image/png') {
        Alpine.store('toast').error('请上传 PNG 格式的图片');
        return;
      }
      
      try {
        const imageDataUrl = await this.readAsDataURL(file);
        this.card.imageDataUrl = imageDataUrl;
        this.card.imageFile = file;
        this.card.checkChanges();
        Alpine.store('toast').success('图片已更换');
      } catch (error) {
        console.error('Image read error:', error);
        Alpine.store('toast').error('读取图片失败');
      }
      
      event.target.value = '';
    },
    
    // 创建新卡片
    createNew() {
      this.card.initNew();
      this.lastAutoSave = 0;
      this.lastAutoSaveHasImage = true;
      this.autoSaveError = '';
      Alpine.store('history').clear();
      this.updateTokenInfo();
      Alpine.store('toast').info('已创建新角色卡');
    },
    
    // 重置卡片
    async resetCard() {
      const ok = await confirmModal('重置卡片', '确定要重置为原始状态吗？所有修改将丢失。', {
        type: 'danger',
        confirmText: '重置',
        cancelText: '取消',
      });
      if (!ok) return;
      this.card.reset();
      this.lastAutoSave = 0;
      this.lastAutoSaveHasImage = true;
      this.autoSaveError = '';
      this.updateTokenInfo();
      Alpine.store('toast').info('已重置到原始状态');
    },
    
    // 关闭卡片
    async closeCard() {
      if (this.card.hasChanges) {
        const ok = await confirmModal('关闭卡片', '有未保存的修改，确定要关闭吗？', {
          type: 'warning',
          confirmText: '关闭',
          cancelText: '取消',
        });
        if (!ok) return;
      }
      this.card.clear();
      this.lastAutoSave = 0;
      this.lastAutoSaveHasImage = true;
      this.autoSaveError = '';
      Alpine.store('history').clear();
      this.tokenInfo = { total: 0, breakdown: {}, level: null, percentage: 0 };
      Alpine.store('ui').currentPage = 'home';
    },
    
    // 导出 PNG
    async exportPNG() {
      if (this.isExporting) return;
      
      if (!this.card.data) {
        Alpine.store('toast').error('没有可导出的卡片');
        return;
      }
      
      if (!this.card.imageFile && !this.card.imageDataUrl) {
        Alpine.store('toast').error('需要先上传图片才能导出 PNG');
        return;
      }
      
      this.isExporting = true;
      const toastId = Alpine.store('toast').loading('正在导出...');
      
      try {
        let imageFile = this.card.imageFile;
        if (!imageFile && this.card.imageDataUrl) {
          imageFile = await this.dataURLtoFile(this.card.imageDataUrl, 'card.png');
        }
        
        const blob = await injectCard(
          imageFile,
          this.card.data,
          this.settings?.includeV2Compat ?? true
        );
        
        const filename = this.generateFilename();
        this.downloadBlob(blob, filename);
        
        // 标记已保存并清除草稿
        this.card.markSaved();
        clearDraft();
        this.lastAutoSave = 0;
        this.lastAutoSaveHasImage = true;
        this.autoSaveError = '';
        
        Alpine.store('toast').dismiss(toastId);
        Alpine.store('toast').success('导出成功: ' + filename);
        
      } catch (error) {
        Alpine.store('toast').dismiss(toastId);
        
        if (error instanceof ApiError) {
          Alpine.store('toast').error(error.getUserMessage());
        } else {
          console.error('Export error:', error);
          Alpine.store('toast').error('导出失败: ' + (error.message || '未知错误'));
        }
      } finally {
        this.isExporting = false;
      }
    },
    
    // 生成文件名 {Name}_{Date}_{Time}.png
    generateFilename() {
      const name = this.card.data?.data?.name || 'Character';
      const safeName = name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
      const now = new Date();
      const date = now.toISOString().split('T')[0].replace(/-/g, '');
      const time = now.toTimeString().split(' ')[0].replace(/:/g, '').substring(0, 4);
      return `${safeName}_${date}_${time}.png`;
    },
    
    // Data URL 转 File
    async dataURLtoFile(dataURL, filename) {
      const res = await fetch(dataURL);
      const blob = await res.blob();
      return new File([blob], filename, { type: blob.type });
    },
    
    // 下载 Blob
    downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    
    // 导出 JSON
    exportJSON() {
      if (!this.card.data) {
        Alpine.store('toast').error('没有可导出的卡片');
        return;
      }
      
      const json = JSON.stringify(this.card.data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const filename = this.generateFilename().replace('.png', '.json');
      
      this.downloadBlob(blob, filename);
      this.card.markSaved();
      clearDraft();
      this.lastAutoSave = 0;
      this.lastAutoSaveHasImage = true;
      this.autoSaveError = '';
      Alpine.store('toast').success('JSON 导出成功');
    },
    
    // 更新字段值 (支持撤销)
    updateField(path, value) {
      Alpine.store('history').push(deepClone(this.card.data));
      this.card.updateField(path, value);
    },
    
    // 切换编辑区域
    setActiveSection(section) {
      this.activeSection = section;
    },

    // 打开字段编辑器
    openFieldEditor(fieldType, fieldPath, title) {
      const keys = fieldPath.split('.');
      let value = this.card.data;
      for (const key of keys) {
        if (value && value[key] !== undefined) {
          value = value[key];
        } else {
          value = null;
          break;
        }
      }

      const isTagsField = fieldPath === 'data.tags';
      const actualType = isTagsField ? 'tags' : fieldType;
      const modalSize = isTagsField ? 'md' : (fieldType === 'lorebook' ? 'xl' : (fieldType === 'array' ? 'lg' : 'xl'));

      Alpine.store('modalStack').push({
        type: actualType,
        title: title,
        size: modalSize, 
        data: { 
          value: value,
          fieldPath: fieldPath,
          lorebook: fieldType === 'lorebook' ? value : undefined,
          items: (fieldType === 'array' || isTagsField) ? value : undefined
        },
        meta: {
            placeholder: `请输入${title}...`,
            itemLabel: this.getItemLabelForField(fieldPath),
            addLabel: this.getAddLabelForField(fieldPath),
            singleLine: this.isSingleLineField(fieldPath)
        },
        onSave: (draft) => {
            let finalValue = draft.value;
            if (fieldType === 'lorebook') finalValue = draft.lorebook;
            if (fieldType === 'array' || isTagsField) finalValue = draft.items;
            
            this.updateField(fieldPath, finalValue);
            this.updateTokenInfo();
            Alpine.store('toast').success(`${title}已更新`);
        }
      });
    },

    getItemLabelForField(fieldPath) {
      const labelMap = {
        'data.tags': '标签',
        'data.alternate_greetings': '开场白',
        'data.group_only_greetings': '群聊开场白'
      };
      return labelMap[fieldPath] || '项目';
    },

    getAddLabelForField(fieldPath) {
      const labelMap = {
        'data.tags': '添加标签',
        'data.alternate_greetings': '添加开场白',
        'data.group_only_greetings': '添加群聊开场白'
      };
      return labelMap[fieldPath] || '添加项目';
    },

    isSingleLineField(fieldPath) {
      const singleLineFields = ['data.tags'];
      return singleLineFields.includes(fieldPath);
    },

    getFieldPreview(fieldPath, maxLength = 100) {
        if (!this.card.data) return '';
        
        const keys = fieldPath.split('.');
        let value = this.card.data;
        for (const key of keys) {
            value = value?.[key];
        }
        
        if (!value) return '(空)';
        
        if (typeof value === 'string') {
            // 移除换行符，让预览更紧凑
            const cleanText = value.replace(/\n/g, ' ');
            return cleanText.length > maxLength ? cleanText.substring(0, maxLength) + '...' : cleanText;
        }
        
        if (Array.isArray(value)) {
            return `${value.length} 项`;
        }
        
        if (typeof value === 'object') {
            if (fieldPath.includes('character_book')) {
                const count = value?.entries?.length || 0;
                return `${count} 个条目`;
            }
            return '已配置';
        }
        
        return '...';
    },

    // 获取字段 Token 数
    getFieldTokens(fieldPath) {
        if (!this.card.data) return 0;
        
        const keys = fieldPath.split('.');
        let value = this.card.data;
        for (const key of keys) {
            value = value?.[key];
        }
        
        if (!value) return 0;
        
        if (typeof value === 'string') {
            return estimateTokens(value);
        }
        
        if (Array.isArray(value)) {
             // 简单的字符串数组累加
             return value.reduce((sum, item) => sum + (typeof item === 'string' ? estimateTokens(item) : 0), 0);
        }

        // Lorebook token count
        if (fieldPath.includes('character_book') && value.entries) {
             let total = 0;
             for (const entry of value.entries) {
                if (entry.enabled) {
                    total += estimateTokens(entry.content || '');
                    if (entry.keys) total += estimateTokens(entry.keys.join(' '));
                }
             }
             return total;
        }
        
        return 0;
    },
    
    // ===== P2 增强功能 =====
    
    // 打开预览
    showPreview(content, title = '内容预览') {
      this.previewContent = content || '';
      this.previewTitle = title;
      this.previewVisible = true;
    },
    
    // 关闭预览
    closePreview() {
      this.previewVisible = false;
    },
    
    // 预览开场白
    previewFirstMes() {
      this.showPreview(this.card.data?.data?.first_mes, '开场白预览');
    },
    
    // 预览备选开场白
    previewAlternateGreeting(index) {
      const greetings = this.card.data?.data?.alternate_greetings || [];
      const content = greetings[index];
      if (content) {
        this.showPreview(content, `备选开场白 #${index + 1} 预览`);
      }
    },

    // 打开开场白预览侧边栏
    openGreetingPreviewSidebar() {
      const agent = Alpine.store('agent');
      if (!agent?.ui) return;

      const isDesktop = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(min-width: 1024px)').matches;

      if (isDesktop) {
        agent.ui.sidebarMode = 'greeting';
        agent.ui.isOpen = true;
        return;
      }

      window.dispatchEvent(new CustomEvent('greeting-preview', {
        detail: {
          content: this.card.data?.data?.first_mes || '',
          index: -1,
        },
      }));
    },

    // 打开移动端高级工具全屏
    openMobileAdvancedTools() {
      const agent = Alpine.store('agent');
      if (!agent?.ui) return;
      agent.ui.sidebarMode = 'agent';
      agent.ui.isOpen = false;
      agent.ui.diffPanelOpen = false;
      agent.ui.isFullscreen = true;
    },
    
    // 清洗安全字段
    async cleanSafeFields() {
      if (!this.card.data) {
        Alpine.store('toast').error('没有可清洗的卡片');
        return;
      }
      
      Alpine.store('history').push(deepClone(this.card.data));
      
      const { cardData, changes } = cleanCardFields(
        this.card.data,
        SAFE_FIELDS
      );
      
      const changedCount = Object.keys(changes).length;
      
      if (changedCount === 0) {
        Alpine.store('toast').info('未发现需要清洗的内容');
        return;
      }
      
      this.card.data = cardData;
      this.card.checkChanges();
      this.updateTokenInfo();
      
      Alpine.store('toast').success(`已清洗 ${changedCount} 个字段`);
    },
    
    // 检测脏内容
    detectDirty(text) {
      return detectDirtyContent(text);
    },
    
    // 销毁时清理
    destroy() {
      stopAutoSave();
    },
  };
}

/**
 * 注册工作台组件
 */
export function registerWorkshopComponents() {
  Alpine.data('workshopPage', workshopPage);
}

export default {
  workshopPage,
  registerWorkshopComponents,
};
