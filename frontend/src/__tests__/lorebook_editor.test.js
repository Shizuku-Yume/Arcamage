import { describe, expect, it } from 'vitest';

import { lorebookEditor } from '../components/lorebook_editor.js';

function createEditor(entries) {
  const editor = lorebookEditor({
    lorebook: {
      name: 'Test Book',
      entries,
    },
  });
  return editor;
}

describe('lorebook editor filters', () => {
  it('filters entries by enabled, constant, selective and position dimensions', () => {
    const editor = createEditor([
      { id: 'enabled-default', name: 'Enabled Default', keys: ['alpha'], content: 'alpha', enabled: true, constant: false, selective: false, position: null },
      { id: 'disabled-constant', name: 'Disabled Constant', keys: [], content: 'beta', enabled: false, constant: true, selective: false, position: 'before_char' },
      { id: 'enabled-selective', name: 'Enabled Selective', keys: ['gamma'], content: 'gamma', enabled: true, constant: false, selective: true, position: 'after_char' },
    ]);

    expect(editor.filteredEntries.map((entry) => entry.id)).toEqual([
      'enabled-default',
      'disabled-constant',
      'enabled-selective',
    ]);

    editor.setFilter('enabled', 'enabled');
    expect(editor.filteredEntries.map((entry) => entry.id)).toEqual(['enabled-default', 'enabled-selective']);

    editor.setFilter('selective', 'selective');
    expect(editor.filteredEntries.map((entry) => entry.id)).toEqual(['enabled-selective']);

    editor.setFilter('position', 'after_char');
    expect(editor.filteredEntries.map((entry) => entry.id)).toEqual(['enabled-selective']);

    editor.clearFilters();
    editor.setFilter('constant', 'constant');
    expect(editor.filteredEntries.map((entry) => entry.id)).toEqual(['disabled-constant']);
  });

  it('combines text search with advanced filters and reports active filter count', () => {
    const editor = createEditor([
      { id: 'alpha', name: 'Alpha', keys: ['moon'], content: 'silver gate', enabled: true, constant: true, selective: false, position: null },
      { id: 'beta', name: 'Beta', keys: ['sun'], content: 'gold gate', enabled: true, constant: false, selective: false, position: 'an_top' },
    ]);

    editor.searchQuery = 'moon';
    editor.setFilter('enabled', 'enabled');
    editor.setFilter('position', 'default');

    expect(editor.activeFilterCount).toBe(2);
    expect(editor.filterSummaryLabel).toBe('2 个筛选');
    expect(editor.filteredEntries.map((entry) => entry.id)).toEqual(['alpha']);
  });
});
