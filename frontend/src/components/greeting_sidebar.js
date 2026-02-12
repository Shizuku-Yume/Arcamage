/**
 * Greeting preview sidebar component
 */

import Alpine from 'alpinejs';
import { generateIframeContent } from './preview_panel.js';

export function greetingSidebar() {
  return {
    previewSelection: null,

    get card() {
      return Alpine.store('card');
    },

    get previewTitle() {
      return this.card?.data?.data?.name || '角色卡';
    },

    get previewOptions() {
      const options = [];
      const data = this.card?.data?.data || {};

      if (data.first_mes) {
        options.push({ id: 'first', label: '主开场白', content: data.first_mes });
      }

      if (Array.isArray(data.alternate_greetings)) {
        data.alternate_greetings.forEach((text, index) => {
          if (text) {
            options.push({
              id: `alt_${index}`,
              label: `备用开场白 ${index + 1}`,
              content: text,
            });
          }
        });
      }

      if (Array.isArray(data.group_only_greetings)) {
        data.group_only_greetings.forEach((text, index) => {
          if (text) {
            options.push({
              id: `group_${index}`,
              label: `群聊开场白 ${index + 1}`,
              content: text,
            });
          }
        });
      }

      if (options.length === 0) {
        options.push({ id: 'empty', label: '暂无开场白', content: '' });
      }

      return options;
    },

    get previewContent() {
      const options = this.previewOptions;
      const selected = options.find((item) => item.id === this.previewSelection) || options[0];
      return selected?.content || '';
    },

    get iframeSandbox() {
      return 'allow-scripts';
    },

    get iframeContent() {
      return generateIframeContent(this.previewContent, {
        markdown: true,
        mode: 'first_mes_native',
        applyRegexScripts: false,
        expandMacros: true,
        includeUpdateBlock: false,
        allowScripts: true,
        macroContext: {
          user: 'user',
          char: 'user',
        },
        darkMode: document.documentElement.classList.contains('dark'),
      });
    },

    syncPreviewSelection() {
      const options = this.previewOptions;
      if (!options.length) {
        this.previewSelection = null;
        return;
      }
      if (!this.previewSelection) {
        this.previewSelection = options[0].id;
        return;
      }
      const exists = options.some((item) => item.id === this.previewSelection);
      if (!exists) {
        this.previewSelection = options[0].id;
      }
    },

    close() {
      const agent = Alpine.store('agent');
      if (agent?.ui) {
        agent.ui.isOpen = false;
      }
    },
  };
}

export function registerGreetingSidebarComponent() {
  Alpine.data('greetingSidebar', greetingSidebar);
}

export default {
  greetingSidebar,
  registerGreetingSidebarComponent,
};
