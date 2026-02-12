import Alpine from 'alpinejs';

export function tagsFieldModal(modal) {
  return {
    _modal: modal,
    newTag: '',
    maxLength: 50,
    maxTags: 100,
    
    init() {
      this.$nextTick(() => {
        if (this.$refs.tagInput) {
          this.$refs.tagInput.focus();
        }
      });
    },

    get items() {
      return this._modal.draft?.items || [];
    },

    set items(value) {
      if (this._modal && this._modal.draft) {
        this._modal.draft.items = value;
        this._modal.dirty = true;
      }
    },

    get meta() {
      return this._modal.meta || {};
    },

    addTag() {
      const value = this.newTag.trim();
      
      if (!value) return;
      
      if (this.items.length >= this.maxTags) {
        Alpine.store('toast')?.error?.(`最多添加 ${this.maxTags} 个标签`);
        return;
      }
      
      const exists = this.items.some(tag => 
        tag.toLowerCase() === value.toLowerCase()
      );
      
      if (exists) {
        Alpine.store('toast')?.info?.('标签已存在');
        this.newTag = '';
        return;
      }
      
      const items = [...this.items];
      items.push(value);
      this.items = items;
      this.newTag = '';
    },
    
    removeTag(index) {
      if (index >= 0 && index < this.items.length) {
        const items = [...this.items];
        items.splice(index, 1);
        this.items = items;
      }
    },
    
    handleBackspace(_event) {
      if (!this.newTag && this.items.length > 0) {
        this.removeTag(this.items.length - 1);
      }
    },
    
    clearAll() {
      this.items = [];
    }
  };
}

export function registerTagsFieldModalComponent() {
  Alpine.data('tagsFieldModal', tagsFieldModal);
}

export default {
  tagsFieldModal,
  registerTagsFieldModalComponent
};
