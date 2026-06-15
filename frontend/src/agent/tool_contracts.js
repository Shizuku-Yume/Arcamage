export const TOOL_ARG_WHITELIST = {
  card_list_fields: ['path', 'filters', 'include_indices'],
  card_read_field: ['path', 'offset', 'max_chars', 'max_bytes'],
  card_set_field: ['path', 'value', 'expected_hash', 'return_value', 'max_chars', 'max_bytes', '_cas_recovered'],
  card_patch_text: ['path', 'patches', 'scope', 'expected_hash', 'return_value', 'max_chars', 'max_bytes', '_cas_recovered'],
  card_list_items: ['path', 'offset', 'limit', 'max_preview_chars'],
  card_edit_items: [
    'path',
    'operation',
    'value',
    'index',
    'from_index',
    'to_index',
    'expected_hash',
    'return_value',
    'max_chars',
    'max_bytes',
    '_cas_recovered',
  ],
  lorebook_summary: ['max_entries', 'max_preview_chars'],
  lorebook_search_entries: ['query', 'match', 'enabled', 'constant', 'max_hits', 'snippet_chars', 'mode', 'flags'],
  lorebook_read_entry: ['entry_ref', 'offset', 'max_chars', 'max_bytes'],
  lorebook_patch_entry: ['entry_ref', 'field', 'patches', 'expected_hash', 'return_value', 'max_chars', 'max_bytes', '_cas_recovered'],
  lorebook_upsert_entry: ['entry_ref', 'entry', 'expected_hash', 'return_value', 'max_chars', 'max_bytes', '_cas_recovered'],
  lorebook_remove_entry: ['entry_ref', 'expected_hash', '_cas_recovered'],
  lorebook_reorder_entries: ['entry_refs', 'expected_hash', '_cas_recovered'],
  lorebook_set_meta: ['meta', 'expected_hash', 'return_value', 'max_chars', 'max_bytes', '_cas_recovered'],
  ref_list: ['filters'],
  ref_read: ['ref_id', 'offset', 'max_chars', 'max_bytes'],
  ref_search: ['ref_id', 'query', 'max_hits', 'snippet_chars', 'mode', 'flags'],
  skill_list: ['filters'],
  skill_read: ['skill_id'],
  skill_upsert: ['skill_id', 'previous_skill_id', 'description', 'content', 'references'],
  skill_delete: ['skill_id', 'delete_files'],
};

export const CARD_ITEM_OPERATIONS = ['append', 'set', 'remove', 'move'];
export const TEXT_PATCH_TYPES = ['replace', 'insert_before', 'insert_after', 'delete', 'delete_between', 'replace_between'];

const matchModeProperty = { type: 'string', enum: ['exact', 'normalized', 'regex'] };

const textPatchSchema = {
  type: 'object',
  properties: {
    replace: {
      type: 'object',
      properties: {
        find: { type: 'string' },
        replace: { type: 'string' },
        occurrence: { anyOf: [{ type: 'number' }, { type: 'string', enum: ['all'] }] },
        case_sensitive: { type: 'boolean' },
        match_mode: matchModeProperty,
      },
      required: ['find', 'replace'],
    },
    insert_before: {
      type: 'object',
      properties: {
        anchor: { type: 'string' },
        text: { type: 'string' },
        occurrence: { type: 'number' },
        case_sensitive: { type: 'boolean' },
        match_mode: matchModeProperty,
      },
      required: ['anchor', 'text'],
    },
    insert_after: {
      type: 'object',
      properties: {
        anchor: { type: 'string' },
        text: { type: 'string' },
        occurrence: { type: 'number' },
        case_sensitive: { type: 'boolean' },
        match_mode: matchModeProperty,
      },
      required: ['anchor', 'text'],
    },
    delete: {
      type: 'object',
      properties: {
        find: { type: 'string' },
        occurrence: { anyOf: [{ type: 'number' }, { type: 'string', enum: ['all'] }] },
        case_sensitive: { type: 'boolean' },
        match_mode: matchModeProperty,
      },
      required: ['find'],
    },
    delete_between: {
      type: 'object',
      properties: {
        start_anchor: { type: 'string' },
        end_anchor: { type: 'string' },
        include_anchors: { type: 'boolean' },
        occurrence: { type: 'number' },
        case_sensitive: { type: 'boolean' },
        match_mode: matchModeProperty,
      },
      required: ['start_anchor', 'end_anchor'],
    },
    replace_between: {
      type: 'object',
      properties: {
        start_anchor: { type: 'string' },
        end_anchor: { type: 'string' },
        text: { type: 'string' },
        include_anchors: { type: 'boolean' },
        occurrence: { type: 'number' },
        case_sensitive: { type: 'boolean' },
        match_mode: matchModeProperty,
      },
      required: ['start_anchor', 'end_anchor', 'text'],
    },
  },
};

const entryRefSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    index: { type: 'number' },
    name: { type: 'string' },
  },
};

export function getToolDefinitions({ includeSkillTools = false } = {}) {
  const definitions = [
    {
      name: 'card_list_fields',
      description: '列出角色卡普通字段结构。data.character_book 请改用 lorebook_* 工具。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          filters: { type: 'object' },
          include_indices: { type: 'boolean' },
        },
      },
    },
    {
      name: 'card_read_field',
      description: '读取角色卡普通字段片段和当前哈希；禁止读取 data.character_book。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'number' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['path'],
      },
    },
    {
      name: 'card_set_field',
      description: '设置角色卡普通字段；长文本优先使用 card_patch_text；禁止写 data.character_book。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          value: {},
          expected_hash: { type: 'string' },
          return_value: { type: 'boolean' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['path', 'value'],
      },
    },
    {
      name: 'card_patch_text',
      description: '对普通字符串字段执行结构化文本补丁；禁止写 data.character_book。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          patches: { type: 'array', items: textPatchSchema },
          scope: { type: 'string', enum: ['field', 'items'] },
          expected_hash: { type: 'string' },
          return_value: { type: 'boolean' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['path', 'patches'],
      },
    },
    {
      name: 'card_list_items',
      description: '列出普通数组字段的紧凑条目；禁止读取 data.character_book.entries。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'number' },
          limit: { type: 'number' },
          max_preview_chars: { type: 'number' },
        },
        required: ['path'],
      },
    },
    {
      name: 'card_edit_items',
      description: '追加、设置、删除或移动普通数组字段条目；禁止写 data.character_book.entries。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          operation: { type: 'string', enum: CARD_ITEM_OPERATIONS },
          value: {},
          index: { type: 'number' },
          from_index: { type: 'number' },
          to_index: { type: 'number' },
          expected_hash: { type: 'string' },
          return_value: { type: 'boolean' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['path', 'operation'],
      },
    },
    {
      name: 'lorebook_summary',
      description: '返回世界书元信息与紧凑条目列表，不返回完整大字段。',
      parameters: {
        type: 'object',
        properties: {
          max_entries: { type: 'number' },
          max_preview_chars: { type: 'number' },
        },
      },
    },
    {
      name: 'lorebook_search_entries',
      description: '按名称、注释、关键词或内容检索世界书条目，返回紧凑命中。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          match: { type: 'string', enum: ['any', 'all'] },
          enabled: { type: 'boolean' },
          constant: { type: 'boolean' },
          max_hits: { type: 'number' },
          snippet_chars: { type: 'number' },
          mode: { type: 'string' },
          flags: { type: 'string' },
        },
        required: ['query'],
      },
    },
    {
      name: 'lorebook_read_entry',
      description: '读取单个世界书条目，可用 {id}、{index} 或 {name} 定位。',
      parameters: {
        type: 'object',
        properties: {
          entry_ref: entryRefSchema,
          offset: { type: 'number' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['entry_ref'],
      },
    },
    {
      name: 'lorebook_patch_entry',
      description: '对世界书条目的字符串字段执行结构化文本补丁，默认字段 content。',
      parameters: {
        type: 'object',
        properties: {
          entry_ref: entryRefSchema,
          field: { type: 'string' },
          patches: { type: 'array', items: textPatchSchema },
          expected_hash: { type: 'string' },
          return_value: { type: 'boolean' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['entry_ref', 'patches'],
      },
    },
    {
      name: 'lorebook_upsert_entry',
      description: '按 id/index/name 创建或更新世界书条目；未知字段会保留。',
      parameters: {
        type: 'object',
        properties: {
          entry_ref: entryRefSchema,
          entry: { type: 'object' },
          expected_hash: { type: 'string' },
          return_value: { type: 'boolean' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['entry'],
      },
    },
    {
      name: 'lorebook_remove_entry',
      description: '删除单个世界书条目。',
      parameters: {
        type: 'object',
        properties: {
          entry_ref: entryRefSchema,
          expected_hash: { type: 'string' },
        },
        required: ['entry_ref'],
      },
    },
    {
      name: 'lorebook_reorder_entries',
      description: '按稳定条目标识重排世界书条目。entry_refs 为目标完整顺序。',
      parameters: {
        type: 'object',
        properties: {
          entry_refs: { type: 'array', items: entryRefSchema },
          expected_hash: { type: 'string' },
        },
        required: ['entry_refs'],
      },
    },
    {
      name: 'lorebook_set_meta',
      description: '设置世界书 entries 之外的元字段，保留未知字段。',
      parameters: {
        type: 'object',
        properties: {
          meta: { type: 'object' },
          expected_hash: { type: 'string' },
          return_value: { type: 'boolean' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['meta'],
      },
    },
    {
      name: 'ref_list',
      description: '列出参考附件元信息。',
      parameters: {
        type: 'object',
        properties: {
          filters: { type: 'object' },
        },
      },
    },
    {
      name: 'ref_read',
      description: '读取参考附件文本片段。',
      parameters: {
        type: 'object',
        properties: {
          ref_id: { type: 'string' },
          offset: { type: 'number' },
          max_chars: { type: 'number' },
          max_bytes: { type: 'number' },
        },
        required: ['ref_id'],
      },
    },
    {
      name: 'ref_search',
      description: '检索参考附件文本内容。',
      parameters: {
        type: 'object',
        properties: {
          ref_id: { type: 'string' },
          query: { type: 'string' },
          max_hits: { type: 'number' },
          snippet_chars: { type: 'number' },
          mode: { type: 'string' },
          flags: { type: 'string' },
        },
        required: ['ref_id', 'query'],
      },
    },
  ];

  if (includeSkillTools) {
    definitions.push(
      {
        name: 'skill_list',
        description: '列出本地技能目录。',
        parameters: {
          type: 'object',
          properties: {
            filters: { type: 'object' },
          },
        },
      },
      {
        name: 'skill_read',
        description: '读取单个技能内容。',
        parameters: {
          type: 'object',
          properties: {
            skill_id: { type: 'string' },
          },
          required: ['skill_id'],
        },
      },
      {
        name: 'skill_upsert',
        description: '创建或更新技能；支持通过 previous_skill_id 重命名。',
        parameters: {
          type: 'object',
          properties: {
            skill_id: { type: 'string' },
            previous_skill_id: { type: 'string' },
            description: { type: 'string' },
            content: { type: 'string' },
            references: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  content: { type: 'string' },
                },
                required: ['name', 'content'],
              },
            },
          },
          required: ['skill_id'],
        },
      },
      {
        name: 'skill_delete',
        description: '删除技能。',
        parameters: {
          type: 'object',
          properties: {
            skill_id: { type: 'string' },
            delete_files: { type: 'boolean' },
          },
          required: ['skill_id'],
        },
      },
    );
  }

  return definitions;
}

export default {
  TOOL_ARG_WHITELIST,
  CARD_ITEM_OPERATIONS,
  TEXT_PATCH_TYPES,
  getToolDefinitions,
};
