import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';

import { executeToolCall, getToolDefinitions } from '../agent/tool_executor.js';
import { REGISTRY_VERSION } from '../agent/field_registry.js';
import { registerRefFile, resetRefRegistry } from '../agent/ref_registry.js';
import { createEmptyCard } from '../store.js';

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
  }
});

beforeEach(() => {
  resetRefRegistry();
});

const context = {
  card_id: 'test_card',
  registry_version: REGISTRY_VERSION,
};

function createMockFile({ name, type, content }) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);
  return {
    name,
    type,
    size: bytes.byteLength,
    text: async () => content,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function createCard() {
  const card = createEmptyCard();
  card.data.name = 'Alice';
  card.data.tags = ['tag-a', 'tag-b'];
  card.data.alternate_greetings = ['hi', 'hello'];
  card.data.first_mes = 'Hello {{user}}';
  card.data.character_book = {
    name: 'Book',
    scan_depth: 4,
    extensions: { preserved: true },
    entries: [
      {
        id: 'alpha',
        name: 'Alpha',
        comment: 'First',
        enabled: true,
        constant: true,
        keys: [],
        secondary_keys: ['alt'],
        content: 'Alpha content with anchor.\nSecond line.',
        extra_field: 'keep',
      },
      {
        id: 'beta',
        name: 'Duplicate',
        comment: 'Second',
        enabled: false,
        constant: false,
        keys: ['beta'],
        secondary_keys: [],
        content: 'Beta content.',
      },
      {
        id: 'gamma',
        name: 'Duplicate',
        comment: 'Third',
        enabled: true,
        constant: false,
        keys: ['gamma'],
        secondary_keys: [],
        content: 'Gamma content.',
      },
    ],
  };
  return card;
}

function createSkillRepository() {
  return {
    version: 1,
    catalog: [{
      id: 'demo',
      description: 'Demo description',
      path: 'demo/SKILL.md',
      tags: [],
    }],
    files: {
      'SKILLS.md': '---\nname: Arcamage Skill Catalog\ndescription: Frontend local markdown skill catalog.\n---\n\n- id: demo\n  description: Demo description\n  path: demo/SKILL.md\n  tags: []\n',
      'demo/SKILL.md': '---\nname: Demo Skill\ndescription: Demo description\nreferences:\n  - references/背景.md\n---\n\n## Body\n\nhello',
      'demo/references/背景.md': '# Ref\n\ncontent',
    },
  };
}

describe('agent_tool_executor', () => {
  it('ignores include_indices without path or path_prefix', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'card_list_fields',
      args: { include_indices: true },
      card,
      context,
      toolCallId: 'tool_1',
    });

    expect(result.status).toBe('ok');
    expect(result.warnings?.some((warn) => warn.code === 'W_INCLUDE_INDICES_IGNORED')).toBe(true);
  });

  it('returns array_path and array_hash for array item view', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'card_read_field',
      args: { path: 'data.tags[0]' },
      card,
      context,
      toolCallId: 'tool_2',
    });

    expect(result.status).toBe('ok');
    expect(result.canonical_path).toBe('data.tags[0]');
    expect(result.array_path).toBe('data.tags');
    expect(typeof result.array_hash).toBe('string');
    expect(typeof result.current_hash).toBe('string');
  });

  it('rejects invalid path tokens', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'card_read_field',
      args: { path: 'data.tags[abc]' },
      card,
      context,
      toolCallId: 'tool_2_invalid_path',
    });

    expect(result.status).toBe('error');
    expect(result.error_code).toBe('E_PATH_INVALID');
  });

  it('rejects unsafe path tokens', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'card_read_field',
      args: { path: '__proto__.polluted' },
      card,
      context,
      toolCallId: 'tool_2_unsafe_path',
    });

    expect(result.status).toBe('error');
    expect(result.error_code).toBe('E_PATH_INVALID');
  });

  it('truncates card_read_field response when max_chars set', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'card_read_field',
      args: { path: 'data.first_mes', max_chars: 5 },
      card,
      context,
      toolCallId: 'tool_2_truncate',
    });

    expect(result.status).toBe('ok');
    expect(result.value).toBe('Hello');
    expect(result.truncated).toBe(true);
  });

  it('reads card string fields from an offset', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'card_read_field',
      args: { path: 'data.first_mes', offset: 6, max_chars: 8 },
      card,
      context,
      toolCallId: 'tool_read_offset',
    });

    expect(result.status).toBe('ok');
    expect(result.value).toBe('{{user}}');
    expect(result.offset).toBe(6);
    expect(result.returned_chars).toBe(8);
    expect(result.total_chars).toBe(14);
  });

  it('requires expected_hash for medium risk card_set_field', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'card_set_field',
      args: {
        path: 'data.first_mes',
        value: 'Hi {{user}}',
      },
      card,
      context,
      toolCallId: 'tool_3',
    });

    expect(result.status).toBe('error');
    expect(result.error_code).toBe('E_PRECONDITION_FAILED');
  });

  it('detects CAS mismatch for card_set_field', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'card_set_field',
      args: {
        path: 'data.first_mes',
        value: 'Hi {{user}}',
        expected_hash: 'bad_hash',
      },
      card,
      context,
      toolCallId: 'tool_4',
    });

    expect(result.status).toBe('error');
    expect(result.error_code).toBe('E_CAS_MISMATCH');
  });

  it('appends entry when expected_hash matches', async () => {
    const card = createCard();
    const viewResult = await executeToolCall({
      toolName: 'card_read_field',
      args: { path: 'data.alternate_greetings' },
      card,
      context,
      toolCallId: 'tool_5_view',
    });

    const result = await executeToolCall({
      toolName: 'card_edit_items',
      args: {
        path: 'data.alternate_greetings',
        operation: 'append',
        value: 'hey',
        expected_hash: viewResult.current_hash,
      },
      card,
      context,
      toolCallId: 'tool_5_append',
    });

    expect(result.status).toBe('ok');
    expect(result.new_card.data.alternate_greetings).toEqual(['hi', 'hello', 'hey']);
    expect(result.diff_summary.change_type).toBe('add');
    expect(result.diff_summary.path).toBe('data.alternate_greetings[2]');
    expect(result.diff_summary.after_value).toBe('hey');
  });

  it('patches a string array item with card_patch_text', async () => {
    const card = createCard();
    const viewResult = await executeToolCall({
      toolName: 'card_read_field',
      args: { path: 'data.alternate_greetings[0]' },
      card,
      context,
      toolCallId: 'tool_patch_array_item_view',
    });

    const result = await executeToolCall({
      toolName: 'card_patch_text',
      args: {
        path: 'data.alternate_greetings[0]',
        expected_hash: viewResult.array_hash,
        patches: [{ replace: { find: 'hi', replace: 'hey' } }],
      },
      card,
      context,
      toolCallId: 'tool_patch_array_item',
    });

    expect(result.status).toBe('ok');
    expect(result.new_card.data.alternate_greetings).toEqual(['hey', 'hello']);
    expect(result.changed_indices).toEqual([0]);
    expect(result.diff_summary.path).toBe('data.alternate_greetings[0]');
  });

  it('patches string array items with partial success', async () => {
    const card = createCard();
    card.data.alternate_greetings = ['hello one', 'no match', 'hello two'];
    const viewResult = await executeToolCall({
      toolName: 'card_read_field',
      args: { path: 'data.alternate_greetings' },
      card,
      context,
      toolCallId: 'tool_patch_array_items_view',
    });

    const result = await executeToolCall({
      toolName: 'card_patch_text',
      args: {
        path: 'data.alternate_greetings',
        scope: 'items',
        expected_hash: viewResult.current_hash,
        patches: [{ replace: { find: 'hello', replace: 'hi' } }],
      },
      card,
      context,
      toolCallId: 'tool_patch_array_items',
    });

    expect(result.status).toBe('ok');
    expect(result.new_card.data.alternate_greetings).toEqual(['hi one', 'no match', 'hi two']);
    expect(result.matched_indices).toEqual([0, 2]);
    expect(result.changed_indices).toEqual([0, 2]);
    expect(result.failed_items).toHaveLength(1);
    expect(result.failed_items[0].index).toBe(1);
    expect(result.warnings?.some((warn) => warn.code === 'W_PARTIAL_PATCH_APPLIED')).toBe(true);
    expect(result.diff_summaries.map((item) => item.path)).toEqual([
      'data.alternate_greetings[0]',
      'data.alternate_greetings[2]',
    ]);
  });

  it('rejects card_patch_text on non-string array items', async () => {
    const card = createCard();
    card.data.tags = ['ok', 42];
    const result = await executeToolCall({
      toolName: 'card_patch_text',
      args: {
        path: 'data.tags',
        scope: 'items',
        patches: [{ replace: { find: 'ok', replace: 'fine' } }],
      },
      card,
      context,
      toolCallId: 'tool_patch_non_string_items',
    });

    expect(result.status).toBe('error');
    expect(result.error_code).toBe('E_TYPE_MISMATCH');
  });

  it('replaces all occurrences in a string patch', async () => {
    const card = createCard();
    card.data.creator_notes = 'red blue red';
    const result = await executeToolCall({
      toolName: 'card_patch_text',
      args: {
        path: 'data.creator_notes',
        patches: [{ replace: { find: 'red', replace: 'green', occurrence: 'all' } }],
      },
      card,
      context,
      toolCallId: 'tool_patch_all',
    });

    expect(result.status).toBe('ok');
    expect(result.new_card.data.creator_notes).toBe('green blue green');
  });

  it('moves array entry by removing then inserting', async () => {
    const card = createCard();
    const viewResult = await executeToolCall({
      toolName: 'card_read_field',
      args: { path: 'data.tags' },
      card,
      context,
      toolCallId: 'tool_move_view',
    });

    const result = await executeToolCall({
      toolName: 'card_edit_items',
      args: {
        path: 'data.tags',
        operation: 'move',
        from_index: 0,
        to_index: 1,
        expected_hash: viewResult.current_hash,
      },
      card,
      context,
      toolCallId: 'tool_card_set_field',
    });

    expect(result.status).toBe('ok');
    expect(result.new_card.data.tags).toEqual(['tag-b', 'tag-a']);
    expect(result.diff_summary.change_type).toBe('move');
  });

  it('ignores card_list_fields unknown filters', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'card_list_fields',
      args: { filters: { unknown: true } },
      card,
      context,
      toolCallId: 'tool_6',
    });

    expect(result.status).toBe('ok');
    expect(result.warnings?.some((warn) => warn.code === 'W_FILTER_IGNORED')).toBe(true);
  });

  it('blocks generic card field tools from data.character_book', async () => {
    const card = createCard();
    const readResult = await executeToolCall({
      toolName: 'card_read_field',
      args: { path: 'data.character_book' },
      card,
      context,
      toolCallId: 'tool_book_block_read',
    });
    expect(readResult.status).toBe('error');
    expect(readResult.message).toContain('lorebook');

    const setResult = await executeToolCall({
      toolName: 'card_set_field',
      args: { path: 'data.character_book', value: {} },
      card,
      context,
      toolCallId: 'tool_book_block_set',
    });
    expect(setResult.status).toBe('error');
    expect(setResult.error_code).toBe('E_PERMISSION_DENIED');
  });

  it('summarizes and searches lorebook entries without full content', async () => {
    const card = createCard();
    const summary = await executeToolCall({
      toolName: 'lorebook_summary',
      args: { max_preview_chars: 8 },
      card,
      context,
      toolCallId: 'tool_book_summary',
    });
    expect(summary.status).toBe('ok');
    expect(summary.total).toBe(3);
    expect(summary.meta.extensions.preserved).toBe(true);
    expect(summary.entries[0]).toMatchObject({
      id: 'alpha',
      constant: true,
      keys: [],
    });
    expect(summary.entries[0].content_preview.length).toBeLessThanOrEqual(8);

    const search = await executeToolCall({
      toolName: 'lorebook_search_entries',
      args: { query: 'Beta', max_hits: 5 },
      card,
      context,
      toolCallId: 'tool_book_search',
    });
    expect(search.status).toBe('ok');
    expect(search.snippets).toHaveLength(1);
    expect(search.snippets[0].id).toBe('beta');
    expect(search.snippets[0].entry_id).toBe('beta');
    expect(search.snippets[0].entry_index).toBe(1);
    expect(search.snippets[0].matched_fields).toContain('id');
    expect(search.snippets[0].content).toBeUndefined();
  });

  it('returns lorebook search diagnostics for zero hits', async () => {
    const card = createCard();
    const search = await executeToolCall({
      toolName: 'lorebook_search_entries',
      args: { query: 'absent words', match: 'all', max_hits: 5 },
      card,
      context,
      toolCallId: 'tool_book_search_none',
    });

    expect(search.status).toBe('ok');
    expect(search.total).toBe(0);
    expect(search.search_diagnostics).toMatchObject({
      query: 'absent words',
      match: 'all',
      total_entries: 3,
    });
  });

  it('reads and patches a lorebook entry by id with CAS', async () => {
    const card = createCard();
    const read = await executeToolCall({
      toolName: 'lorebook_read_entry',
      args: { entry_ref: { id: 'alpha' }, max_chars: 12 },
      card,
      context,
      toolCallId: 'tool_book_read',
    });
    expect(read.status).toBe('ok');
    expect(read.entry.content).toBe('Alpha conten');
    expect(read.truncated).toBe(true);
    expect(typeof read.content_hash).toBe('string');

    const patch = await executeToolCall({
      toolName: 'lorebook_patch_entry',
      args: {
        entry_ref: { id: 'alpha' },
        expected_hash: read.content_hash,
        patches: [
          { insert_after: { anchor: 'anchor', text: ' inserted' } },
        ],
      },
      card,
      context,
      toolCallId: 'tool_book_patch',
    });
    expect(patch.status).toBe('ok');
    expect(patch.new_card.data.character_book.entries[0].content).toContain('anchor inserted');
    expect(patch.new_card.data.character_book.entries[0].extra_field).toBe('keep');
    expect(patch.diff_summary.path).toBe('data.character_book.entries[id=alpha].content');
  });

  it('reports missing anchors, ambiguous names, and CAS mismatch for lorebook patches', async () => {
    const card = createCard();
    const missingAnchor = await executeToolCall({
      toolName: 'lorebook_patch_entry',
      args: {
        entry_ref: { id: 'alpha' },
        patches: [{ insert_before: { anchor: 'missing', text: 'x' } }],
      },
      card,
      context,
      toolCallId: 'tool_book_missing_anchor',
    });
    expect(missingAnchor.status).toBe('error');
    expect(missingAnchor.error_code).toBe('E_ANCHOR_NOT_FOUND');
    expect(Array.isArray(missingAnchor.candidate_snippets)).toBe(true);

    const ambiguous = await executeToolCall({
      toolName: 'lorebook_read_entry',
      args: { entry_ref: { name: 'Duplicate' } },
      card,
      context,
      toolCallId: 'tool_book_ambiguous',
    });
    expect(ambiguous.status).toBe('error');
    expect(ambiguous.error_code).toBe('E_AMBIGUOUS_ENTRY');
    expect(ambiguous.candidates).toHaveLength(2);

    const mismatch = await executeToolCall({
      toolName: 'lorebook_patch_entry',
      args: {
        entry_ref: { id: 'alpha' },
        expected_hash: 'bad',
        patches: [{ delete: { find: 'Alpha' } }],
      },
      card,
      context,
      toolCallId: 'tool_book_cas',
    });
    expect(mismatch.status).toBe('error');
    expect(mismatch.error_code).toBe('E_CAS_MISMATCH');
  });

  it('patches lorebook content with normalized matches and range deletion', async () => {
    const card = createCard();
    card.data.character_book.entries[0].content = '他说“你好”。\nSTART\nremove me\nEND\nkeep';
    const read = await executeToolCall({
      toolName: 'lorebook_read_entry',
      args: { entry_ref: { id: 'alpha' } },
      card,
      context,
      toolCallId: 'tool_book_normalized_read',
    });

    const normalized = await executeToolCall({
      toolName: 'lorebook_patch_entry',
      args: {
        entry_ref: { id: 'alpha' },
        expected_hash: read.content_hash,
        patches: [{ replace: { find: '他说"你好".', replace: '她说「你好」。', match_mode: 'normalized' } }],
      },
      card,
      context,
      toolCallId: 'tool_book_normalized_patch',
    });

    expect(normalized.status).toBe('ok');
    expect(normalized.new_card.data.character_book.entries[0].content).toContain('她说「你好」。');
    expect(normalized.warnings?.some((warn) => warn.code === 'W_NORMALIZED_MATCH_USED')).toBe(true);

    const rangeRead = await executeToolCall({
      toolName: 'lorebook_read_entry',
      args: { entry_ref: { id: 'alpha' } },
      card: normalized.new_card,
      context,
      toolCallId: 'tool_book_range_read',
    });
    const rangeDelete = await executeToolCall({
      toolName: 'lorebook_patch_entry',
      args: {
        entry_ref: { id: 'alpha' },
        expected_hash: rangeRead.content_hash,
        patches: [{ delete_between: { start_anchor: 'START', end_anchor: 'END', include_anchors: true } }],
      },
      card: normalized.new_card,
      context,
      toolCallId: 'tool_book_range_delete',
    });

    expect(rangeDelete.status).toBe('ok');
    expect(rangeDelete.new_card.data.character_book.entries[0].content).not.toContain('remove me');
    expect(rangeDelete.new_card.data.character_book.entries[0].content).not.toContain('START');
    expect(rangeDelete.new_card.data.character_book.entries[0].content).toContain('keep');
  });

  it('patches lorebook content with regex across lines', async () => {
    const card = createCard();
    card.data.character_book.entries[0].content = 'before\n<block>\nremove\n</block>\nafter';
    const read = await executeToolCall({
      toolName: 'lorebook_read_entry',
      args: { entry_ref: { id: 'alpha' } },
      card,
      context,
      toolCallId: 'tool_book_regex_read',
    });

    const patch = await executeToolCall({
      toolName: 'lorebook_patch_entry',
      args: {
        entry_ref: { id: 'alpha' },
        expected_hash: read.content_hash,
        patches: [{ delete: { find: '<block>[\\s\\S]*?</block>\\n?', match_mode: 'regex' } }],
      },
      card,
      context,
      toolCallId: 'tool_book_regex_patch',
    });

    expect(patch.status).toBe('ok');
    expect(patch.new_card.data.character_book.entries[0].content).toBe('before\nafter');
    expect(patch.warnings?.some((warn) => warn.code === 'W_REGEX_MATCH_USED')).toBe(true);
  });

  it('upserts removes and reorders lorebook entries by stable ids', async () => {
    const card = createCard();
    const upsert = await executeToolCall({
      toolName: 'lorebook_upsert_entry',
      args: {
        entry_ref: { id: 'alpha' },
        entry: { content: 'Updated alpha', unknown: 'preserved' },
      },
      card,
      context,
      toolCallId: 'tool_book_upsert',
    });
    expect(upsert.status).toBe('ok');
    expect(upsert.new_card.data.character_book.entries[0]).toMatchObject({
      id: 'alpha',
      content: 'Updated alpha',
      extra_field: 'keep',
      unknown: 'preserved',
    });

    const remove = await executeToolCall({
      toolName: 'lorebook_remove_entry',
      args: { entry_ref: { index: 1 } },
      card: upsert.new_card,
      context,
      toolCallId: 'tool_book_remove',
    });
    expect(remove.status).toBe('ok');
    expect(remove.new_card.data.character_book.entries.map((entry) => entry.id)).toEqual(['alpha', 'gamma']);

    const reorder = await executeToolCall({
      toolName: 'lorebook_reorder_entries',
      args: { entry_refs: [{ id: 'gamma' }, { id: 'alpha' }] },
      card: remove.new_card,
      context,
      toolCallId: 'tool_book_reorder',
    });
    expect(reorder.status).toBe('ok');
    expect(reorder.new_card.data.character_book.entries.map((entry) => entry.id)).toEqual(['gamma', 'alpha']);
  });

  it('lists and views reference attachments', async () => {
    const file = createMockFile({
      name: 'note.txt',
      type: 'text/plain',
      content: 'hello world',
    });
    const addResult = await registerRefFile(file);
    expect(addResult.status).toBe('ok');

    const listResult = await executeToolCall({
      toolName: 'ref_list',
      args: {},
      card: createCard(),
      context,
      toolCallId: 'tool_7',
    });
    expect(listResult.status).toBe('ok');
    expect(listResult.refs.length).toBe(1);

    const viewResult = await executeToolCall({
      toolName: 'ref_read',
      args: { ref_id: listResult.refs[0].ref_id },
      card: createCard(),
      context,
      toolCallId: 'tool_8',
    });
    expect(viewResult.status).toBe('ok');
    expect(viewResult.content).toBe('hello world');
  });

  it('supports regex search for refs', async () => {
    const file = createMockFile({
      name: 'note.txt',
      type: 'text/plain',
      content: 'hello world\nHELLO WORLD',
    });
    await registerRefFile(file);

    const listResult = await executeToolCall({
      toolName: 'ref_list',
      args: {},
      card: createCard(),
      context,
      toolCallId: 'tool_9',
    });

    const searchResult = await executeToolCall({
      toolName: 'ref_search',
      args: {
        ref_id: listResult.refs[0].ref_id,
        query: 'hello\\s+world',
        mode: 'regex',
        flags: 'i',
      },
      card: createCard(),
      context,
      toolCallId: 'tool_10',
    });
    expect(searchResult.status).toBe('ok');
    expect(searchResult.hits.length).toBeGreaterThan(0);
    expect(searchResult.hits[0].length).toBeGreaterThan(0);
  });

  it('ignores unknown tool args and returns warning', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'card_set_field',
      args: {
        path: 'data.name',
        value: 'Alicia',
        unknown_arg: true,
      },
      card,
      context,
      toolCallId: 'tool_ignore_unknown_args',
    });

    expect(result.status).toBe('ok');
    expect(result.new_card.data.name).toBe('Alicia');
    expect(result.warnings?.some((warn) => warn.code === 'W_ARG_IGNORED')).toBe(true);
  });

  it('rejects old tool names and old argument aliases', async () => {
    const card = createCard();
    const oldToolResult = await executeToolCall({
      toolName: 'set_field',
      args: { path: 'data.name', value: 'Alicia' },
      card,
      context,
      toolCallId: 'tool_old_name',
    });

    expect(oldToolResult.status).toBe('error');
    expect(oldToolResult.message).toContain('未知工具');

    const oldAliasResult = await executeToolCall({
      toolName: 'card_set_field',
      args: {
        fieldPath: 'data.name',
        newValue: 'Alicia',
      },
      card,
      context,
      toolCallId: 'tool_old_alias',
    });

    expect(oldAliasResult.status).toBe('error');
    expect(oldAliasResult.error_code).toBe('E_CONSTRAINT_VIOLATION');
  });

  it('injects skill tool definitions only when enabled', () => {
    const withoutSkillTools = getToolDefinitions();
    const withSkillTools = getToolDefinitions({ includeSkillTools: true });

    const withoutNames = withoutSkillTools.map((item) => item.name);
    const withNames = withSkillTools.map((item) => item.name);

    expect(withoutNames.includes('skill_list')).toBe(false);
    expect(withNames.includes('skill_list')).toBe(true);
    expect(withNames.includes('skill_upsert')).toBe(true);
  });

  it('lists and views skill content with name-only references', async () => {
    const repository = createSkillRepository();

    const listResult = await executeToolCall({
      toolName: 'skill_list',
      args: {},
      card: createCard(),
      skillsRepository: repository,
      context,
      toolCallId: 'tool_skill_list',
    });
    expect(listResult.status).toBe('ok');
    expect(listResult.total).toBe(1);
    expect(listResult.skills[0].id).toBe('demo');

    const viewResult = await executeToolCall({
      toolName: 'skill_read',
      args: { skill_id: 'demo' },
      card: createCard(),
      skillsRepository: repository,
      context,
      toolCallId: 'tool_skill_view',
    });
    expect(viewResult.status).toBe('ok');
    expect(viewResult.skill.name).toBe('Demo Skill');
    expect(viewResult.skill.references).toEqual([
      { name: '背景', content: '# Ref\n\ncontent' },
    ]);
  });

  it('saves skill files and returns skill_file diff_summaries', async () => {
    const repository = createSkillRepository();
    const result = await executeToolCall({
      toolName: 'skill_upsert',
      args: {
        skill_id: '写作 助手',
        description: '用于写作润色',
        content: '## Body\n\nupdated',
        references: [
          { name: '示例', content: '# Example' },
        ],
      },
      card: createCard(),
      skillsRepository: repository,
      context,
      toolCallId: 'tool_skill_save',
    });

    expect(result.status).toBe('ok');
    expect(result.new_skill_repository.catalog.some((item) => item.id === '写作 助手')).toBe(true);
    expect(result.new_skill_repository.files['写作 助手/references/示例.md']).toBe('# Example');
    expect(Array.isArray(result.diff_summaries)).toBe(true);
    expect(result.diff_summaries.length).toBeGreaterThan(0);
    expect(result.diff_summaries.every((item) => item.resource === 'skill_file')).toBe(true);
    expect(result.diff_summaries.some((item) => item.path.startsWith('skills/'))).toBe(true);
  });

  it('rejects duplicate skill id on rename', async () => {
    const repository = createSkillRepository();
    repository.catalog.push({
      id: 'taken',
      description: 'Taken desc',
      path: 'taken/SKILL.md',
      tags: [],
    });
    repository.files['taken/SKILL.md'] = '---\nname: Taken\ndescription: Taken desc\nreferences: []\n---\n\nTaken';

    const result = await executeToolCall({
      toolName: 'skill_upsert',
      args: {
        previous_skill_id: 'demo',
        skill_id: 'taken',
        description: 'x',
        content: 'x',
        references: [],
      },
      card: createCard(),
      skillsRepository: repository,
      context,
      toolCallId: 'tool_skill_rename_dup',
    });

    expect(result.status).toBe('error');
    expect(result.error_code).toBe('E_CONSTRAINT_VIOLATION');
  });

  it('rejects invalid skill identifier and duplicate reference names', async () => {
    const repository = createSkillRepository();

    const invalidIdResult = await executeToolCall({
      toolName: 'skill_upsert',
      args: {
        skill_id: 'bad/id',
      },
      card: createCard(),
      skillsRepository: repository,
      context,
      toolCallId: 'tool_skill_invalid_id',
    });
    expect(invalidIdResult.status).toBe('error');
    expect(invalidIdResult.error_code).toBe('E_CONSTRAINT_VIOLATION');

    const duplicateRefResult = await executeToolCall({
      toolName: 'skill_upsert',
      args: {
        skill_id: 'demo',
        description: 'Demo description',
        content: 'Body',
        references: [
          { name: '重复', content: 'A' },
          { name: '重复', content: 'B' },
        ],
      },
      card: createCard(),
      skillsRepository: repository,
      context,
      toolCallId: 'tool_skill_duplicate_ref',
    });
    expect(duplicateRefResult.status).toBe('error');
    expect(duplicateRefResult.error_code).toBe('E_CONSTRAINT_VIOLATION');
  });

  it('deletes skill and returns repository diff summaries', async () => {
    const repository = createSkillRepository();
    const result = await executeToolCall({
      toolName: 'skill_delete',
      args: { skill_id: 'demo' },
      card: createCard(),
      skillsRepository: repository,
      context,
      toolCallId: 'tool_skill_delete',
    });

    expect(result.status).toBe('ok');
    expect(result.new_skill_repository.catalog.some((item) => item.id === 'demo')).toBe(false);
    expect(result.new_skill_repository.files['demo/SKILL.md']).toBeUndefined();
    expect(result.diff_summaries.some((item) => item.change_type === 'remove')).toBe(true);
  });
});
