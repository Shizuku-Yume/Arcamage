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
      toolName: 'list_fields',
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
      toolName: 'view_field',
      args: { path: 'data.tags[0]' },
      card,
      context,
      toolCallId: 'tool_2',
    });

    expect(result.status).toBe('ok');
    expect(result.array_path).toBe('data.tags');
    expect(typeof result.array_hash).toBe('string');
  });

  it('rejects invalid path tokens', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'view_field',
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
      toolName: 'view_field',
      args: { path: '__proto__.polluted' },
      card,
      context,
      toolCallId: 'tool_2_unsafe_path',
    });

    expect(result.status).toBe('error');
    expect(result.error_code).toBe('E_PATH_INVALID');
  });

  it('truncates view_field response when max_chars set', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'view_field',
      args: { path: 'data.first_mes', max_chars: 5 },
      card,
      context,
      toolCallId: 'tool_2_truncate',
    });

    expect(result.status).toBe('ok');
    expect(result.value).toBe('Hello');
    expect(result.truncated).toBe(true);
  });

  it('requires old_hash for medium risk edit_field', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'edit_field',
      args: {
        path: 'data.first_mes',
        new_value: 'Hi {{user}}',
        old_value: 'Hello {{user}}',
      },
      card,
      context,
      toolCallId: 'tool_3',
    });

    expect(result.status).toBe('error');
    expect(result.error_code).toBe('E_PRECONDITION_FAILED');
  });

  it('detects CAS mismatch for edit_field', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'edit_field',
      args: {
        path: 'data.first_mes',
        new_value: 'Hi {{user}}',
        old_hash: 'bad_hash',
      },
      card,
      context,
      toolCallId: 'tool_4',
    });

    expect(result.status).toBe('error');
    expect(result.error_code).toBe('E_CAS_MISMATCH');
  });

  it('appends entry when old_hash matches', async () => {
    const card = createCard();
    const viewResult = await executeToolCall({
      toolName: 'view_field',
      args: { path: 'data.alternate_greetings' },
      card,
      context,
      toolCallId: 'tool_5_view',
    });

    const result = await executeToolCall({
      toolName: 'append_entry',
      args: {
        path: 'data.alternate_greetings',
        value: 'hey',
        old_hash: viewResult.current_hash,
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

  it('moves array entry by removing then inserting', async () => {
    const card = createCard();
    const viewResult = await executeToolCall({
      toolName: 'view_field',
      args: { path: 'data.tags' },
      card,
      context,
      toolCallId: 'tool_move_view',
    });

    const result = await executeToolCall({
      toolName: 'move_entry',
      args: {
        from_path: 'data.tags[0]',
        to_index: 1,
        old_hash: viewResult.current_hash,
      },
      card,
      context,
      toolCallId: 'tool_move_entry',
    });

    expect(result.status).toBe('ok');
    expect(result.new_card.data.tags).toEqual(['tag-b', 'tag-a']);
    expect(result.diff_summary.change_type).toBe('move');
  });

  it('ignores list_fields unknown filters', async () => {
    const card = createCard();
    const result = await executeToolCall({
      toolName: 'list_fields',
      args: { filters: { unknown: true } },
      card,
      context,
      toolCallId: 'tool_6',
    });

    expect(result.status).toBe('ok');
    expect(result.warnings?.some((warn) => warn.code === 'W_FILTER_IGNORED')).toBe(true);
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
      toolName: 'list_refs',
      args: {},
      card: createCard(),
      context,
      toolCallId: 'tool_7',
    });
    expect(listResult.status).toBe('ok');
    expect(listResult.refs.length).toBe(1);

    const viewResult = await executeToolCall({
      toolName: 'view_ref',
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
      toolName: 'list_refs',
      args: {},
      card: createCard(),
      context,
      toolCallId: 'tool_9',
    });

    const searchResult = await executeToolCall({
      toolName: 'search_ref',
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
      toolName: 'set_field',
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

  it('injects skill tool definitions only when enabled', () => {
    const withoutSkillTools = getToolDefinitions();
    const withSkillTools = getToolDefinitions({ includeSkillTools: true });

    const withoutNames = withoutSkillTools.map((item) => item.name);
    const withNames = withSkillTools.map((item) => item.name);

    expect(withoutNames.includes('list_skills')).toBe(false);
    expect(withNames.includes('list_skills')).toBe(true);
    expect(withNames.includes('save_skill')).toBe(true);
  });

  it('lists and views skill content with name-only references', async () => {
    const repository = createSkillRepository();

    const listResult = await executeToolCall({
      toolName: 'list_skills',
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
      toolName: 'view_skill',
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
      toolName: 'save_skill',
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
      toolName: 'save_skill',
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
      toolName: 'save_skill',
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
      toolName: 'save_skill',
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
      toolName: 'delete_skill',
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
