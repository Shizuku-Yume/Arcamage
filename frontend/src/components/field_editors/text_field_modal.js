import Alpine from 'alpinejs';
import { estimateTokens } from '../token_badge.js';
import { confirm as confirmModal } from '../modal.js';

export function textFieldModal(modal) {
    return {
        _modal: modal,
        charCount: 0,
        tokenCount: 0,
        
        init() {
            this.updateStats();
            this.$watch('_modal.draft.value', () => this.updateStats());
        },
        
        get value() {
            return this._modal.draft.value || '';
        },
        
        set value(val) {
            this._modal.draft.value = val;
            this._modal.dirty = true;
        },
        
        updateStats() {
            const text = this.value;
            this.charCount = text.length;
            this.tokenCount = estimateTokens(text);
        },
        
        async copyToClipboard() {
            try {
                await navigator.clipboard.writeText(this.value);
                Alpine.store('toast').success('已复制到剪贴板');
            } catch (err) {
                console.error('Copy failed:', err);
                Alpine.store('toast').error('复制失败');
            }
        },
        
        async pasteFromClipboard() {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    this.value = (this.value || '') + text;
                    Alpine.store('toast').success('已粘贴内容');
                }
            } catch (err) {
                console.error('Paste failed:', err);
                Alpine.store('toast').info('请使用 Ctrl+V 粘贴');
            }
        },
        
        async clearText() {
            if (!this.value) return;
            const ok = await confirmModal('清空内容', '确定要清空内容吗？', {
                type: 'danger',
                confirmText: '清空',
                cancelText: '取消',
            });
            if (ok) {
                this.value = '';
                Alpine.store('toast').info('内容已清空');
            }
        },
        
        
    };
}

export function registerTextFieldModalComponent() {
    Alpine.data('textFieldModal', textFieldModal);
}

export function getTextFieldModalHTML() {
    return `
    <div x-data="textFieldModal(modal)" class="h-full flex flex-col">
        <!-- Toolbar -->
        <div class="flex items-center justify-between mb-2 px-1 flex-shrink-0">
            <div class="flex items-center gap-2"></div>
            <div class="flex items-center gap-1">
                <button @click="copyToClipboard()" type="button" class="btn-icon-ghost p-1.5 transition-colors" title="复制">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                </button>
                <button @click="pasteFromClipboard()" type="button" class="btn-icon-ghost p-1.5 transition-colors" title="粘贴">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                </button>
                <button @click="clearText()" type="button" class="btn-danger p-1.5 transition-colors" title="清空">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>
        </div>

        <!-- Textarea Container -->
        <div class="relative flex-1 min-h-0">
            <textarea 
                x-model="value" 
                :rows="modal.meta?.rows || 10"
                :placeholder="modal.meta?.placeholder"
                class="w-full h-full bg-zinc-900/[0.03] dark:bg-zinc-800/80 border-2 border-zinc-200/80 dark:border-zinc-700/80 rounded-neo p-4 outline-none resize-none font-mono text-sm leading-relaxed text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500  focus:border-brand dark:focus:border-brand-400  custom-scrollbar"
            ></textarea>
            
        </div>

        <!-- Stats Footer -->
        <div class="mt-2 flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500 px-1 flex-shrink-0">
            <div class="flex items-center gap-3">
                <span x-text="charCount + ' 字符'"></span>
                <span class="flex items-center gap-1">
                    <span x-text="tokenCount"></span>
                    <span>tokens</span>
                </span>
            </div>
            
            <template x-if="modal.meta?.enablePreview">
                <span class="text-zinc-300 dark:text-zinc-600">Markdown 预览可用</span>
            </template>
        </div>
    </div>
    `;
}

export default {
    textFieldModal,
    registerTextFieldModalComponent,
    getTextFieldModalHTML
};
